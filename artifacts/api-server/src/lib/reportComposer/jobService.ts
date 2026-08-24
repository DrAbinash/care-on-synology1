/**
 * Background AI Report Composer job service.
 *
 * Canonical input model (Guard 8): Model B — frozen snapshot is authoritative.
 * Server verifies revision/hashes from the snapshot and against persisted report
 * when present. Worker never re-reads the live editor.
 *
 * Apply is CLIENT-SIDE through Zustand/pathologyPatch (Guard 3) — server only
 * records applied/discarded after client confirms, or marks APPLIED metadata.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  radiologyWorklistTable,
  patientReportsTable,
  clinicSettingsTable,
  type AiComposeJobKind,
  type AiComposeJobStatus,
} from "@workspace/db/schema";
import { enqueueRadiologyJob } from "../radiologyJobs";
import {
  ComposerInputSnapshotSchema,
  type ComposerInputSnapshot,
  type TrackedChange,
} from "./types";
import { computeSnapshotHashes, dedupeObservations, summarizeSources } from "./snapshot";
import { runReportComposer } from "./composeEngine";
import { validateComposerOutput } from "./validateOutput";
import { buildTrackedChanges } from "./trackedChanges";

export const AI_REPORT_COMPOSE_JOB = "ai_report_compose";

const ACTIVE = ["QUEUED", "COMPOSING"] as const;
const TERMINAL_FOR_DEDUPE = ["QUEUED", "COMPOSING"] as const;

export type EnqueueComposeArgs = {
  snapshot: unknown;
  jobKind?: AiComposeJobKind;
  createdBy?: string;
  createdByStaffId?: number | null;
  /** Optional client hint of persisted report content hash — verified server-side. */
  persistedContentToken?: string | null;
};

export type EnqueueComposeResult =
  | { ok: true; jobId: number; deduped: boolean; status: string; reportRevision: string; inputHash: string; sources: Record<string, number> }
  | { ok: false; error: string; code?: string };

function priorityForKind(kind: AiComposeJobKind): number {
  // Lower number = higher priority in our table; claim order uses this + FIFO.
  // selection/section > full compose > overnight (overnight is separate queue lane)
  switch (kind) {
    case "SELECTION_EDIT":
    case "SECTION_EDIT":
    case "REPHRASE":
    case "SHORTEN":
    case "EXPAND":
    case "TRANSLATE":
      return 10;
    case "IMPRESSION":
      return 20;
    case "FULL_REPORT":
    default:
      return 40;
  }
}

async function loadPersistedReportToken(reportId: number | null | undefined): Promise<{
  status: string | null;
  token: string | null;
  finalized: boolean;
}> {
  if (!reportId || !Number.isInteger(reportId)) return { status: null, token: null, finalized: false };
  try {
    const [row] = await db
      .select({
        status: patientReportsTable.status,
        impression: patientReportsTable.impression,
        body: patientReportsTable.body,
      })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportId))
      .limit(1);
    if (!row) return { status: null, token: null, finalized: false };
    const finalized = ["final", "FINAL", "signed", "SIGNED", "amended", "verified", "delivered"].includes(
      String(row.status),
    );
    const token = createHash("sha256")
      .update(`${row.body ?? ""}\u001e${row.impression ?? ""}`)
      .digest("hex")
      .slice(0, 32);
    return { status: row.status, token, finalized };
  } catch {
    return { status: null, token: null, finalized: false };
  }
}

async function getComposerSettings(): Promise<{
  backgroundEnabled: boolean;
  concurrency: number;
  retentionDays: number;
}> {
  try {
    const [row] = await db
      .select({
        backgroundEnabled: clinicSettingsTable.reportComposerBackgroundEnabled,
        concurrency: clinicSettingsTable.reportComposerConcurrency,
        retentionDays: clinicSettingsTable.reportComposerSnapshotRetentionDays,
      })
      .from(clinicSettingsTable)
      .orderBy(desc(clinicSettingsTable.id))
      .limit(1);
    return {
      backgroundEnabled: row?.backgroundEnabled !== false,
      concurrency: Math.max(1, Math.min(3, Number(row?.concurrency ?? 1))),
      retentionDays: Math.max(1, Math.min(90, Number(row?.retentionDays ?? 14))),
    };
  } catch {
    return { backgroundEnabled: true, concurrency: 1, retentionDays: 14 };
  }
}

export async function enqueueComposeJob(args: EnqueueComposeArgs): Promise<EnqueueComposeResult> {
  const settings = await getComposerSettings();
  if (!settings.backgroundEnabled) {
    return { ok: false, error: "Background report composer is disabled", code: "disabled" };
  }

  const parsed = ComposerInputSnapshotSchema.safeParse(args.snapshot);
  if (!parsed.success) {
    return { ok: false, error: "Invalid composition snapshot", code: "bad_snapshot" };
  }

  const snapshot: ComposerInputSnapshot = {
    ...parsed.data,
    observations: dedupeObservations(parsed.data.observations ?? []),
  };
  const jobKind = (args.jobKind ?? "FULL_REPORT") as AiComposeJobKind;
  snapshot.jobKindHint = jobKind;

  const hashes = computeSnapshotHashes(snapshot);

  // Server-verified revision: if client sent a hint that disagrees with snapshot-derived revision, reject.
  if (snapshot.clientRevisionHint && snapshot.clientRevisionHint !== hashes.reportRevision) {
    // Allow if client hint is a prior hash they think they have — treat as stale browser state
    return {
      ok: false,
      error: "Browser report state is outdated relative to the composition snapshot. Refresh and try again.",
      code: "stale_browser",
    };
  }

  const worklistId = snapshot.worklistId ?? null;
  const reportId = snapshot.reportId ?? null;
  const persisted = await loadPersistedReportToken(reportId);
  if (persisted.finalized) {
    return { ok: false, error: "Report is finalized — composition not allowed", code: "finalized" };
  }
  if (args.persistedContentToken && persisted.token && args.persistedContentToken !== persisted.token) {
    return {
      ok: false,
      error: "Persisted report changed in another session. Re-open the study and compose again.",
      code: "stale_persisted",
    };
  }

  // Dedupe active identical jobs
  if (worklistId) {
    const [existing] = await db
      .select()
      .from(aiReportComposeJobsTable)
      .where(
        and(
          eq(aiReportComposeJobsTable.worklistId, worklistId),
          eq(aiReportComposeJobsTable.sourceReportRevision, hashes.reportRevision),
          eq(aiReportComposeJobsTable.inputHash, hashes.inputHash),
          eq(aiReportComposeJobsTable.jobKind, jobKind),
          inArray(aiReportComposeJobsTable.status, [...TERMINAL_FOR_DEDUPE]),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        ok: true,
        jobId: existing.id,
        deduped: true,
        status: existing.status,
        reportRevision: hashes.reportRevision,
        inputHash: hashes.inputHash,
        sources: summarizeSources(snapshot.observations),
      };
    }
  }

  const [inserted] = await db
    .insert(aiReportComposeJobsTable)
    .values({
      studyId: snapshot.studyId ?? null,
      worklistId,
      reportId,
      jobKind,
      status: "QUEUED",
      sourceReportRevision: hashes.reportRevision,
      sourceFindingsHash: hashes.findingsHash,
      sourceImpressionHash: hashes.impressionHash,
      sourceRecommendationHash: hashes.recommendationHash,
      inputHash: hashes.inputHash,
      inputSnapshotJson: JSON.stringify(snapshot),
      createdBy: args.createdBy ?? null,
      createdByStaffId: args.createdByStaffId ?? null,
      priority: priorityForKind(jobKind),
    })
    .returning();

  const queue = await enqueueRadiologyJob({
    operationType: AI_REPORT_COMPOSE_JOB,
    entityType: "ai_report_compose_job",
    entityId: inserted.id,
    payload: { composeJobId: inserted.id, jobKind, priority: priorityForKind(jobKind) },
    idempotencyKey: `ai:compose:${worklistId ?? "x"}:${hashes.reportRevision}:${hashes.inputHash}:${jobKind}`,
    maxRetries: 2,
  });

  await db
    .update(aiReportComposeJobsTable)
    .set({ queueJobId: queue.id > 0 ? queue.id : null, updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, inserted.id));

  if (worklistId) {
    await db
      .update(radiologyWorklistTable)
      .set({
        aiComposeStatus: "QUEUED",
        aiComposeJobId: inserted.id,
        aiComposeUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(radiologyWorklistTable.id, worklistId));
  }

  return {
    ok: true,
    jobId: inserted.id,
    deduped: false,
    status: "QUEUED",
    reportRevision: hashes.reportRevision,
    inputHash: hashes.inputHash,
    sources: summarizeSources(snapshot.observations),
  };
}

export async function processComposeJob(composeJobId: number): Promise<{ ok: boolean; detail?: string }> {
  const [job] = await db
    .select()
    .from(aiReportComposeJobsTable)
    .where(eq(aiReportComposeJobsTable.id, composeJobId))
    .limit(1);
  if (!job) return { ok: true, detail: "compose job missing — no-op" };
  if (["APPLIED", "DISCARDED", "CANCELLED", "OBSOLETE"].includes(job.status)) {
    return { ok: true, detail: `already ${job.status}` };
  }

  // Finalized report → OBSOLETE, never mutate
  const persisted = await loadPersistedReportToken(job.reportId);
  if (persisted.finalized) {
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "OBSOLETE", completedAt: new Date(), safeError: "report_finalized", updatedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, job.id));
    await syncWorklistStatus(job.worklistId, "OBSOLETE", job.id);
    return { ok: true, detail: "obsolete — finalized" };
  }

  await db
    .update(aiReportComposeJobsTable)
    .set({ status: "COMPOSING", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, job.id));
  await syncWorklistStatus(job.worklistId, "COMPOSING", job.id);

  let snapshot: ComposerInputSnapshot;
  try {
    snapshot = ComposerInputSnapshotSchema.parse(JSON.parse(job.inputSnapshotJson));
  } catch {
    await failJob(job.id, job.worklistId, "bad_stored_snapshot");
    return { ok: false, detail: "bad_stored_snapshot" };
  }

  const run = await runReportComposer({
    kind: job.jobKind as AiComposeJobKind,
    snapshot,
    allowDeterministicFallback: true,
  });

  if (!run.ok || !run.draft) {
    await failJob(job.id, job.worklistId, run.safeError ?? "compose_failed", run.model, run.fallbackUsed, run.latencyMs);
    // Do not retry endlessly on config errors
    if (run.safeError === "composer_model_not_configured" || run.safeError === "malformed_json") {
      return { ok: true, detail: run.safeError };
    }
    return { ok: false, detail: run.safeError };
  }

  const validation = validateComposerOutput(snapshot, run.draft);
  if (!validation.ok) {
    await failJob(
      job.id,
      job.worklistId,
      validation.errors.join(",") || "validation_failed",
      run.model,
      run.fallbackUsed,
      run.latencyMs,
      validation,
    );
    return { ok: true, detail: "validation_failed" };
  }

  const tracked = buildTrackedChanges({
    jobId: job.id,
    model: run.model,
    originalFindings: snapshot.findings,
    originalImpression: snapshot.impression,
    originalRecommendation: snapshot.recommendation,
    draft: run.draft,
  });

  // STALE check: compare frozen snapshot revision to any newer READY job supersession only.
  // Worker uses frozen snapshot — does not read live editor. STALE is decided at read/apply time
  // when client presents current hashes; here we mark READY.
  await db
    .update(aiReportComposeJobsTable)
    .set({
      status: "READY",
      outputPlanJson: JSON.stringify(run.draft),
      trackedChangesJson: JSON.stringify(tracked),
      proposedFindings: run.draft.findings,
      proposedImpression: run.draft.impression,
      proposedRecommendation: run.draft.recommendation,
      validationJson: JSON.stringify(validation),
      model: run.model ?? null,
      fallbackUsed: run.fallbackUsed ?? false,
      latencyMs: run.latencyMs ?? null,
      completedAt: new Date(),
      safeError: null,
      updatedAt: new Date(),
    })
    .where(eq(aiReportComposeJobsTable.id, job.id));
  await syncWorklistStatus(job.worklistId, "READY", job.id);

  return { ok: true, detail: `ready changes=${tracked.length}` };
}

async function failJob(
  id: number,
  worklistId: number | null,
  safeError: string,
  model?: string,
  fallbackUsed?: boolean,
  latencyMs?: number,
  validation?: unknown,
): Promise<void> {
  await db
    .update(aiReportComposeJobsTable)
    .set({
      status: "FAILED",
      safeError,
      model: model ?? null,
      fallbackUsed: fallbackUsed ?? false,
      latencyMs: latencyMs ?? null,
      validationJson: validation ? JSON.stringify(validation) : null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(aiReportComposeJobsTable.id, id));
  await syncWorklistStatus(worklistId, "FAILED", id);
}

async function syncWorklistStatus(
  worklistId: number | null,
  status: string,
  jobId: number,
): Promise<void> {
  if (!worklistId) return;
  await db
    .update(radiologyWorklistTable)
    .set({
      aiComposeStatus: status,
      aiComposeJobId: jobId,
      aiComposeUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(radiologyWorklistTable.id, worklistId));
}

export async function getComposeJob(id: number) {
  const [job] = await db.select().from(aiReportComposeJobsTable).where(eq(aiReportComposeJobsTable.id, id)).limit(1);
  return job ?? null;
}

export async function getLatestComposeJob(worklistId: number) {
  const [job] = await db
    .select()
    .from(aiReportComposeJobsTable)
    .where(eq(aiReportComposeJobsTable.worklistId, worklistId))
    .orderBy(desc(aiReportComposeJobsTable.id))
    .limit(1);
  return job ?? null;
}

/** Evaluate STALE against client-provided current hashes (live editor). Never mutates report. */
export async function evaluateJobFreshness(
  jobId: number,
  current: { findingsHash: string; impressionHash: string; recommendationHash: string; reportRevision: string },
): Promise<{ status: AiComposeJobStatus; stale: boolean }> {
  const job = await getComposeJob(jobId);
  if (!job) return { status: "FAILED", stale: false };
  if (!["READY", "STALE_READY"].includes(job.status)) {
    return { status: job.status as AiComposeJobStatus, stale: false };
  }
  const stale =
    current.reportRevision !== job.sourceReportRevision ||
    current.findingsHash !== job.sourceFindingsHash ||
    current.impressionHash !== job.sourceImpressionHash;
  if (stale && job.status === "READY") {
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "STALE_READY", updatedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, jobId));
    await syncWorklistStatus(job.worklistId, "STALE_READY", jobId);
    return { status: "STALE_READY", stale: true };
  }
  return { status: job.status as AiComposeJobStatus, stale };
}

export async function updateTrackedChangeState(
  jobId: number,
  changeId: string,
  reviewState: TrackedChange["reviewState"],
): Promise<{ ok: boolean; changes?: TrackedChange[]; error?: string }> {
  const job = await getComposeJob(jobId);
  if (!job) return { ok: false, error: "not_found" };
  if (!["READY", "STALE_READY"].includes(job.status)) return { ok: false, error: "not_ready" };
  let changes: TrackedChange[] = [];
  try {
    changes = JSON.parse(job.trackedChangesJson ?? "[]") as TrackedChange[];
  } catch {
    return { ok: false, error: "bad_changes" };
  }
  const now = new Date().toISOString();
  const next = changes.map((c) => {
    if (c.id !== changeId) return c;
    return {
      ...c,
      reviewState,
      acceptedAt: reviewState === "ACCEPTED" || reviewState === "EDITED" ? now : c.acceptedAt,
      rejectedAt: reviewState === "REJECTED" ? now : c.rejectedAt,
    };
  });
  await db
    .update(aiReportComposeJobsTable)
    .set({ trackedChangesJson: JSON.stringify(next), updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, jobId));
  // Job remains READY — change review state is separate (Guard 2)
  return { ok: true, changes: next };
}

export async function markComposeApplied(opts: {
  jobId: number;
  appliedBy?: string;
  appliedByStaffId?: number | null;
  /** Client must confirm which change ids were accepted into canonical report. */
  acceptedChangeIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const job = await getComposeJob(opts.jobId);
  if (!job) return { ok: false, error: "not_found" };
  if (!["READY", "STALE_READY"].includes(job.status)) return { ok: false, error: "not_ready" };
  if (job.status === "STALE_READY") return { ok: false, error: "stale_ready" };
  const persisted = await loadPersistedReportToken(job.reportId);
  if (persisted.finalized) return { ok: false, error: "finalized" };

  let changes: TrackedChange[] = [];
  try {
    changes = JSON.parse(job.trackedChangesJson ?? "[]") as TrackedChange[];
  } catch {
    return { ok: false, error: "bad_changes" };
  }
  const now = new Date().toISOString();
  const accepted = new Set(opts.acceptedChangeIds);
  const next = changes.map((c) =>
    accepted.has(c.id)
      ? { ...c, reviewState: "ACCEPTED" as const, acceptedAt: now }
      : c.reviewState === "PENDING"
        ? { ...c, reviewState: "REJECTED" as const, rejectedAt: now }
        : c,
  );

  await db
    .update(aiReportComposeJobsTable)
    .set({
      status: "APPLIED",
      trackedChangesJson: JSON.stringify(next),
      appliedAt: new Date(),
      appliedBy: opts.appliedBy ?? null,
      appliedByStaffId: opts.appliedByStaffId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(aiReportComposeJobsTable.id, opts.jobId));
  await syncWorklistStatus(job.worklistId, "APPLIED", opts.jobId);
  return { ok: true };
}

export async function discardComposeJob(opts: {
  jobId: number;
  by?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const job = await getComposeJob(opts.jobId);
  if (!job) return { ok: false, error: "not_found" };
  if (ACTIVE.includes(job.status as (typeof ACTIVE)[number])) {
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "CANCELLED", discardedAt: new Date(), updatedAt: new Date(), safeError: "cancelled_by_user" })
      .where(eq(aiReportComposeJobsTable.id, opts.jobId));
    await syncWorklistStatus(job.worklistId, "CANCELLED", opts.jobId);
    return { ok: true };
  }
  await db
    .update(aiReportComposeJobsTable)
    .set({ status: "DISCARDED", discardedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, opts.jobId));
  await syncWorklistStatus(job.worklistId, "DISCARDED", opts.jobId);
  void opts.by;
  return { ok: true };
}

/** PHI retention: prune input snapshots for terminal jobs older than retention days. */
export async function pruneComposeSnapshots(): Promise<number> {
  const { retentionDays } = await getComposerSettings();
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  const result = await db
    .update(aiReportComposeJobsTable)
    .set({
      inputSnapshotJson: "{\"pruned\":true}",
      snapshotPrunedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(aiReportComposeJobsTable.status, ["APPLIED", "DISCARDED", "FAILED", "CANCELLED", "OBSOLETE"]),
        lt(aiReportComposeJobsTable.completedAt, cutoff),
        sql`${aiReportComposeJobsTable.snapshotPrunedAt} IS NULL`,
      ),
    )
    .returning({ id: aiReportComposeJobsTable.id });
  return result.length;
}

export function publicJobView(job: typeof aiReportComposeJobsTable.$inferSelect) {
  let trackedChanges: TrackedChange[] = [];
  let validation: unknown = null;
  let draft: unknown = null;
  try {
    trackedChanges = JSON.parse(job.trackedChangesJson ?? "[]");
  } catch { /* ignore */ }
  try {
    validation = job.validationJson ? JSON.parse(job.validationJson) : null;
  } catch { /* ignore */ }
  try {
    draft = job.outputPlanJson ? JSON.parse(job.outputPlanJson) : null;
  } catch { /* ignore */ }

  let sources: Record<string, number> = {};
  try {
    const snap = JSON.parse(job.inputSnapshotJson) as ComposerInputSnapshot;
    sources = summarizeSources(snap.observations ?? []);
  } catch { /* pruned */ }

  return {
    id: job.id,
    studyId: job.studyId,
    worklistId: job.worklistId,
    reportId: job.reportId,
    jobKind: job.jobKind,
    status: job.status,
    sourceReportRevision: job.sourceReportRevision,
    sourceFindingsHash: job.sourceFindingsHash,
    sourceImpressionHash: job.sourceImpressionHash,
    sourceRecommendationHash: job.sourceRecommendationHash,
    inputHash: job.inputHash,
    proposedFindings: job.proposedFindings,
    proposedImpression: job.proposedImpression,
    proposedRecommendation: job.proposedRecommendation,
    trackedChanges,
    draft,
    validation,
    sources,
    model: job.model,
    fallbackUsed: job.fallbackUsed,
    latencyMs: job.latencyMs,
    safeError: job.safeError,
    createdBy: job.createdBy,
    appliedBy: job.appliedBy,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    appliedAt: job.appliedAt,
    discardedAt: job.discardedAt,
    // Never return full input snapshot in list/GET by default — PHI
    hasSnapshot: !job.snapshotPrunedAt && job.inputSnapshotJson !== "{\"pruned\":true}",
  };
}

export async function composeDiagnostics() {
  const settings = await getComposerSettings();
  const counts = await db.execute(sql`
    SELECT status, count(*)::int AS c
    FROM ai_report_compose_jobs
    WHERE created_at > now() - interval '7 days'
    GROUP BY status
  `);
  const rows = (counts as { rows?: Array<{ status: string; c: number }> }).rows
    ?? (Array.isArray(counts) ? (counts as Array<{ status: string; c: number }>) : []);
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r.c;

  const [lastOk] = await db
    .select({ id: aiReportComposeJobsTable.id, completedAt: aiReportComposeJobsTable.completedAt, model: aiReportComposeJobsTable.model })
    .from(aiReportComposeJobsTable)
    .where(inArray(aiReportComposeJobsTable.status, ["READY", "APPLIED"]))
    .orderBy(desc(aiReportComposeJobsTable.completedAt))
    .limit(1);
  const [lastFail] = await db
    .select({ id: aiReportComposeJobsTable.id, completedAt: aiReportComposeJobsTable.completedAt, safeError: aiReportComposeJobsTable.safeError })
    .from(aiReportComposeJobsTable)
    .where(eq(aiReportComposeJobsTable.status, "FAILED"))
    .orderBy(desc(aiReportComposeJobsTable.completedAt))
    .limit(1);

  return {
    backgroundEnabled: settings.backgroundEnabled,
    concurrency: settings.concurrency,
    retentionDays: settings.retentionDays,
    queueDepth: (byStatus.QUEUED ?? 0) + (byStatus.COMPOSING ?? 0),
    byStatus,
    lastSuccess: lastOk ?? null,
    lastFailure: lastFail ?? null,
  };
}
