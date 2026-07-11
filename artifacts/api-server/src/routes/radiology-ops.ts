/**
 * radiology-ops.ts — Ticket BEND-1 Phases 4–8: the operational surface of
 * Backend v1.
 *
 * Mounted at /api/radiology-ops behind requireStaffAuth +
 * requireStaffPermission("/radiology"). GET /health is readable by radiology
 * staff (endpoint topology masked); everything else is ADMIN ONLY. All GET
 * endpoints are read-only; repairs demand dryRun-first + an explicit
 * confirmation token, run in transactions where they mutate, are fully
 * audited, and cover ONLY mechanically unambiguous cases. Signed structured
 * JSON and clinical prose are never touched by anything here.
 */

import { Router, type Response } from "express";
import { db } from "@workspace/db";
import {
  radiologyOpsChecksTable, radiologyRedeliveryObligationsTable, radiologyWorklistTable,
  featureFlagsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import { buildRadiologyOpsHealth } from "../lib/radiologyOpsHealth";
import { runConsistencyChecks } from "../lib/radiologyConsistency";
import { runAuditChainVerification } from "../lib/auditVerification";
import { listObligations, transitionObligation, createObligationsForAmendment } from "../lib/redeliveryObligations";
import {
  enqueueRadiologyJob, listDeadLetterJobs, markJobRetryable, runRadiologyJobTick,
} from "../lib/radiologyJobs";
import { RADIOLOGY_JOB_HANDLERS, REDELIVERY_SEND_JOB, PACS_REARCHIVE_JOB } from "../lib/radiologyJobHandlers";
import { scanDraftsForStructuredJsonDrift } from "../lib/radiologyStructuredJsonDrift";
import { regenerateDraftStructuredJson } from "../lib/radiologyStructuredJsonCache";
import { RADIOLOGY_FLAG_REGISTRY, validateFlagDependencies, safeEnableOrder } from "../lib/radiologyFeatureFlagRegistry";
import { FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";

export const radiologyOpsRouter = Router();

function isAdmin(req: StaffAuthRequest): boolean {
  // staffSession.role is already normalized by requireStaffAuth.
  return FULL_ACCESS_ROLES.has(req.staffSession?.role ?? "");
}

function actorOf(req: StaffAuthRequest) {
  return {
    userId: req.staffSession?.subjectId ?? null,
    userName: req.staffSession?.subjectName ?? "unknown",
    role: req.staffSession?.role ?? "unknown",
  };
}

// ── Phase 4 — health (staff-readable; topology masked for non-admin) ────────
radiologyOpsRouter.get("/health", async (req: StaffAuthRequest, res: Response) => {
  const health = await buildRadiologyOpsHealth({ maskTopology: !isAdmin(req) });
  res.json(health);
});

// ── Phase 5 — consistency checks (admin, read-only) ─────────────────────────
radiologyOpsRouter.get("/consistency", requireAdminRole, async (_req: StaffAuthRequest, res: Response) => {
  const report = await runConsistencyChecks();
  await db.insert(radiologyOpsChecksTable).values({
    checkName: "consistency",
    status: report.errorCount > 0 ? "fail" : report.warningCount > 0 ? "warn" : "pass",
    ranBy: "ops-endpoint",
    detail: { errorCount: report.errorCount, warningCount: report.warningCount, findings: report.findings },
  }).catch(() => undefined);
  res.json(report);
});

// ── Phase 2 — re-delivery obligation backlog + transitions (admin) ──────────
radiologyOpsRouter.get("/obligations", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json({ obligations: await listObligations({ status }) });
});

radiologyOpsRouter.post("/obligations/:id/:action", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const action = String(req.params.action);
  if (!Number.isInteger(id) || id <= 0 || !["acknowledge", "dismiss", "queue"].includes(action)) {
    res.status(400).json({ error: "valid obligation id and action (acknowledge|dismiss|queue) required" });
    return;
  }
  const result = await transitionObligation(id, action as "acknowledge" | "dismiss" | "queue", actorOf(req) as { userId: number | null; userName: string; role: string });
  if (!result.ok) {
    res.status(409).json({ ok: false, error: result.error });
    return;
  }
  if (action === "queue") {
    await enqueueRadiologyJob({
      operationType: REDELIVERY_SEND_JOB,
      entityType: "redelivery_obligation",
      entityId: id,
      payload: { obligationId: id },
      idempotencyKey: `${REDELIVERY_SEND_JOB}:${id}:${Date.now()}`,
    });
  }
  res.json({ ok: true, status: result.status });
});

// ── Phase 3 — durable jobs: dead-letter visibility + ops tick (admin) ────────
radiologyOpsRouter.get("/jobs/dead-letter", requireAdminRole, async (_req: StaffAuthRequest, res: Response) => {
  res.json({ jobs: await listDeadLetterJobs(Object.keys(RADIOLOGY_JOB_HANDLERS)) });
});

radiologyOpsRouter.post("/jobs/tick", requireAdminRole, async (_req: StaffAuthRequest, res: Response) => {
  // Synchronous one-tick drain — operational lever when cron schedulers are
  // disabled (and the verification harness's deterministic driver).
  const result = await runRadiologyJobTick(RADIOLOGY_JOB_HANDLERS, { maxJobs: 5, workerId: "ops-tick" });
  res.json(result);
});

// ── Phase 7 — audit-chain verification (admin) ───────────────────────────────
radiologyOpsRouter.post("/audit-verify", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const body = (req.body ?? {}) as { mode?: string; limit?: number };
  const report = await runAuditChainVerification({
    mode: body.mode === "full" ? "full" : "window",
    limit: typeof body.limit === "number" ? body.limit : undefined,
    ranBy: req.staffSession?.subjectName ?? "ops-endpoint",
  });
  res.json(report);
});

// ── Phase 5/A5 — structured drift scan, persisted (admin) ───────────────────
radiologyOpsRouter.post("/drift-scan", requireAdminRole, async (_req: StaffAuthRequest, res: Response) => {
  const summary = await scanDraftsForStructuredJsonDrift();
  await db.insert(radiologyOpsChecksTable).values({
    checkName: "structured_drift",
    status: summary.driftCount > 0 ? "warn" : "pass",
    ranBy: "ops-endpoint",
    detail: { checkedCount: summary.checkedCount, driftCount: summary.driftCount, drifted: summary.results.filter((r) => r.driftDetected).slice(0, 50) },
  }).catch(() => undefined);
  res.json(summary);
});

// ── Phase 8 — restore-verification proof (admin; runs as a durable job) ─────
radiologyOpsRouter.post("/restore-verify", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const body = (req.body ?? {}) as { backupPath?: string };
  const job = await enqueueRadiologyJob({
    operationType: "radiology_restore_verify",
    entityType: "backup",
    payload: { backupPath: typeof body.backupPath === "string" ? body.backupPath : null, ranBy: req.staffSession?.subjectName ?? "ops" },
    idempotencyKey: `restore_verify:${Date.now()}`,
    maxRetries: 1, // expensive; never auto-retried
  });
  res.status(202).json({ ok: true, jobId: job.id, note: "queued — result lands in radiology_ops_checks (health → restoreVerification)" });
});

// ── Phase 10 — flag registry (admin) ─────────────────────────────────────────
radiologyOpsRouter.get("/flags", requireAdminRole, async (_req: StaffAuthRequest, res: Response) => {
  const rows = await db.select().from(featureFlagsTable).where(like(featureFlagsTable.key, "ff_radiology_%"));
  const live: Record<string, boolean> = {};
  for (const r of rows) live[r.key] = r.enabled;
  res.json({
    registry: RADIOLOGY_FLAG_REGISTRY.map((e) => ({ ...e, enabled: live[e.key] ?? false })),
    violations: validateFlagDependencies(live),
    safeEnableOrder: safeEnableOrder(),
  });
});

// ── Phase 6 — safe repairs: dry-run first, confirm token, transaction, audit ─

interface RepairOutcome {
  action: string;
  dryRun: boolean;
  affected: Array<Record<string, unknown>>;
  executed: boolean;
}

const REPAIR_ACTIONS = new Set([
  "release_stale_locks",
  "retry_dead_job",
  "clear_duplicate_obligation",
  "reconcile_amendment_obligations",
  "regenerate_draft_structured_cache",
]);

radiologyOpsRouter.post("/repair", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const body = (req.body ?? {}) as {
    action?: string; dryRun?: boolean; confirmToken?: string;
    jobId?: number; obligationId?: number; draftId?: number;
  };
  const action = String(body.action ?? "");
  if (!REPAIR_ACTIONS.has(action)) {
    res.status(400).json({ error: `action must be one of: ${[...REPAIR_ACTIONS].join(", ")}` });
    return;
  }
  // Dry-run is the DEFAULT; execution demands the explicit token.
  const dryRun = body.dryRun !== false;
  if (!dryRun && body.confirmToken !== `REPAIR-${action}`) {
    res.status(400).json({ error: `execution requires confirmToken "REPAIR-${action}" (run dryRun first)` });
    return;
  }

  const outcome: RepairOutcome = { action, dryRun, affected: [], executed: false };

  try {
    if (action === "release_stale_locks") {
      // Unambiguous: expiry is DERIVED; anything >1h past expiry is dead.
      const staleRows = await db.execute(sql`
        SELECT w.id, w.lock_user_name, COALESCE(w.lock_last_activity_at, w.lock_time) AS last_active
        FROM radiology_worklist w
        WHERE w.lock_user_id IS NOT NULL
          AND COALESCE(w.lock_last_activity_at, w.lock_time) IS NOT NULL
          AND COALESCE(w.lock_last_activity_at, w.lock_time)
              + (COALESCE((SELECT value::int FROM pacs_settings WHERE key = 'radiology_lock_ttl_seconds' LIMIT 1), 300) * interval '1 second')
              < NOW() - interval '1 hour'`);
      outcome.affected = staleRows.rows as Array<Record<string, unknown>>;
      if (!dryRun && outcome.affected.length > 0) {
        await db.transaction(async (tx) => {
          await tx.update(radiologyWorklistTable)
            .set({ lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null, lockWorkstation: null })
            .where(inArray(radiologyWorklistTable.id, outcome.affected.map((r) => Number(r.id))));
        });
        outcome.executed = true;
      }
    } else if (action === "retry_dead_job") {
      const jobId = Number(body.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) { res.status(400).json({ error: "jobId required" }); return; }
      outcome.affected = [{ jobId }];
      if (!dryRun) outcome.executed = await markJobRetryable(jobId);
    } else if (action === "clear_duplicate_obligation") {
      // Unambiguous ONLY when an identical COMPLETED obligation exists for
      // the same revision+channel+recipient — the open twin is then noise.
      const dupes = await db.execute(sql`
        SELECT o.id FROM radiology_redelivery_obligations o
        WHERE o.status IN ('pending','acknowledged','failed')
          AND EXISTS (SELECT 1 FROM radiology_redelivery_obligations c
            WHERE c.id <> o.id AND c.report_id = o.report_id AND c.channel = o.channel
              AND c.recipient_fingerprint = o.recipient_fingerprint AND c.status = 'completed')`);
      outcome.affected = dupes.rows as Array<Record<string, unknown>>;
      if (!dryRun && outcome.affected.length > 0) {
        await db.transaction(async (tx) => {
          await tx.update(radiologyRedeliveryObligationsTable)
            .set({ status: "dismissed", actedBy: "repair:duplicate-with-completed", actedAt: new Date(), updatedAt: new Date() })
            .where(and(
              inArray(radiologyRedeliveryObligationsTable.id, outcome.affected.map((r) => Number(r.id))),
              inArray(radiologyRedeliveryObligationsTable.status, ["pending", "acknowledged", "failed"]),
            ));
        });
        outcome.executed = true;
      }
    } else if (action === "reconcile_amendment_obligations") {
      // Repair MISSING derived state from the immutable amendment + share
      // history (creation is idempotent — never duplicates, never resurrects
      // completed/dismissed duties).
      const missing = await db.execute(sql`
        SELECT a.amended_report_id AS id FROM patient_report_amendments a
        WHERE NOT EXISTS (SELECT 1 FROM radiology_redelivery_obligations o WHERE o.report_id = a.amended_report_id)
        ORDER BY a.amended_report_id DESC LIMIT 100`);
      outcome.affected = missing.rows as Array<Record<string, unknown>>;
      if (!dryRun) {
        for (const row of outcome.affected) {
          await createObligationsForAmendment(Number(row.id), actorOf(req) as { userId: number | null; userName: string; role: string });
        }
        outcome.executed = true;
      }
    } else if (action === "regenerate_draft_structured_cache") {
      // UNSIGNED draft cache only — regenerated from report_finding_instances
      // (the source of truth). Never touches structured_json_d1 or any signed
      // document.
      const draftId = Number(body.draftId);
      if (!Number.isInteger(draftId) || draftId <= 0) { res.status(400).json({ error: "draftId required" }); return; }
      outcome.affected = [{ draftId }];
      if (!dryRun) {
        await regenerateDraftStructuredJson(draftId);
        outcome.executed = true;
      }
    }

    await auditFromRequest(req, {
      userId: req.staffSession?.subjectId ?? null,
      userName: req.staffSession?.subjectName ?? "unknown",
      role: req.staffSession?.role ?? "unknown",
      action: dryRun ? "radiology_repair_dry_run" : "radiology_repair_executed",
      module: "radiology",
      entityType: "radiology_repair",
      entityId: action,
      newValue: JSON.stringify({ affectedCount: outcome.affected.length, executed: outcome.executed, sample: outcome.affected.slice(0, 10) }),
    });
    res.json(outcome);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
