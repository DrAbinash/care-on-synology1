/**
 * radiologyOpsHealth.ts — Ticket BEND-1 Phase 4: ONE truthful, read-only
 * radiology backend health service.
 *
 * Aggregates: database, startup/migrations, schema deploy state, radiology
 * feature flags (+dependency validation), durable jobs, delivery + amendment
 * re-delivery backlog, PACS archive backlog, viewer/PACS reachability, audit
 * chain, structured drift, stale locks, orphan counts, latest backup and
 * restore-verification proof, and build/version info.
 *
 * Statuses: HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN. UNKNOWN is honest
 * "never verified / stale" — it never masquerades as HEALTHY. No secrets, no
 * patient data; endpoint topology is masked for non-admin staff.
 */

import { db } from "@workspace/db";
import {
  backupJobLogsTable, featureFlagsTable, pacsSettingsTable, radiologyWorklistTable,
} from "@workspace/db/schema";
import { desc, eq, like, sql } from "drizzle-orm";
import { getStartupState, startupHealth } from "./startupState";
import { latestOpsCheck } from "./auditVerification";
import { jobBacklogCounts } from "./radiologyJobs";
import { RADIOLOGY_JOB_HANDLERS } from "./radiologyJobHandlers";
import { redeliveryBacklog } from "./redeliveryObligations";
import { RADIOLOGY_FLAG_REGISTRY, validateFlagDependencies } from "./radiologyFeatureFlagRegistry";
import { runConsistencyChecks } from "./radiologyConsistency";

export type OpsStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

const RANK: Record<OpsStatus, number> = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, UNHEALTHY: 3 };

/** Overall = worst component (UNKNOWN sits between HEALTHY and DEGRADED). */
export function worstStatus(statuses: OpsStatus[]): OpsStatus {
  return statuses.reduce<OpsStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "HEALTHY");
}

/** Persisted-check status: pass→HEALTHY, warn→DEGRADED, fail→UNHEALTHY;
 *  missing or older than maxAgeHours → UNKNOWN (never a stale "healthy"). */
export function statusFromPersistedCheck(
  check: { status: string; ranAt: Date } | null,
  now: Date,
  maxAgeHours: number,
): OpsStatus {
  if (!check) return "UNKNOWN";
  const ageHours = (now.getTime() - new Date(check.ranAt).getTime()) / 3600_000;
  if (ageHours > maxAgeHours) return "UNKNOWN";
  if (check.status === "pass") return "HEALTHY";
  if (check.status === "warn") return "DEGRADED";
  return "UNHEALTHY";
}

/** Job backlog verdict: dead-letters degrade; a large due backlog degrades. */
export function jobsComponentStatus(counts: { pending: number; running: number; deadLetter: number }): OpsStatus {
  if (counts.deadLetter > 0) return "DEGRADED";
  if (counts.pending > 100) return "DEGRADED";
  return "HEALTHY";
}

export interface OpsHealthComponent {
  status: OpsStatus;
  detail: string;
  data?: Record<string, unknown>;
}

export interface RadiologyOpsHealth {
  overall: OpsStatus;
  ranAt: string;
  components: Record<string, OpsHealthComponent>;
}

async function probe(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function buildRadiologyOpsHealth(opts: { maskTopology: boolean }): Promise<RadiologyOpsHealth> {
  const now = new Date();
  const components: Record<string, OpsHealthComponent> = {};

  // ── database ───────────────────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    components.database = { status: "HEALTHY", detail: `reachable (${Date.now() - t0}ms)` };
  } catch (err) {
    components.database = { status: "UNHEALTHY", detail: `unreachable: ${err instanceof Error ? err.message : String(err)}` };
    // Without a database nothing below can be answered truthfully.
    return { overall: "UNHEALTHY", ranAt: now.toISOString(), components };
  }

  // ── startup / in-process migrations ───────────────────────────────────────
  {
    const s = startupHealth(getStartupState());
    components.startup = { status: s.status, detail: s.detail, data: { phase: s.phase } };
  }

  // ── container migration / schema verification state ──────────────────────
  try {
    const raw = await db.execute(sql`SELECT key, value FROM public.schema_deploy_state ORDER BY key LIMIT 30`);
    const state: Record<string, string> = {};
    for (const row of raw.rows as Array<{ key: string; value: string }>) state[row.key] = row.value;
    const patchOk = state["db_patch_ok"] === "true";
    const verify = state["schema_verify_status"];
    // "failed" is the current blocking-error value ("full_fail" is the
    // legacy one, still accepted); "pass_with_warnings" means startup was
    // safe but non-blocking drift remains — DEGRADED, same bucket as
    // failed/full_fail, not HEALTHY, so it stays visible instead of hidden.
    const migrationsStatus: OpsStatus =
      !patchOk ? "UNHEALTHY"
      : (verify === "failed" || verify === "full_fail") ? "DEGRADED"
      : (verify === "sql_pass" || verify === "full_pass") ? "HEALTHY"
      : verify === "pass_with_warnings" ? "DEGRADED"
      : "UNKNOWN";
    components.migrations = {
      status: migrationsStatus,
      detail: !patchOk
        ? "db-patch-v2 did not complete"
        : `db_patch_ok=true, schema_verify_status=${verify ?? "missing"}`,
    };
  } catch {
    components.migrations = { status: "UNKNOWN", detail: "schema_deploy_state not present (container migration pipeline not used in this environment)" };
  }

  // ── radiology feature flags + dependency validation ───────────────────────
  try {
    const rows = await db.select().from(featureFlagsTable).where(like(featureFlagsTable.key, "ff_radiology_%"));
    const live: Record<string, boolean> = {};
    for (const r of rows) live[r.key] = r.enabled;
    const violations = validateFlagDependencies(live);
    const enabled = Object.entries(live).filter(([, v]) => v).map(([k]) => k);
    components.featureFlags = {
      status: violations.length > 0 ? "DEGRADED" : "HEALTHY",
      detail: violations.length > 0
        ? `dependency violations: ${violations.map((v) => `${v.key} missing ${v.missingDependencies.join("+")}`).join("; ")}`
        : `${enabled.length}/${RADIOLOGY_FLAG_REGISTRY.length} radiology flags enabled`,
      data: { enabled, violations },
    };
  } catch (err) {
    components.featureFlags = { status: "UNKNOWN", detail: `flags unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }

  // ── durable jobs ───────────────────────────────────────────────────────────
  try {
    const counts = await jobBacklogCounts(Object.keys(RADIOLOGY_JOB_HANDLERS));
    components.jobs = {
      status: jobsComponentStatus(counts),
      detail: `pending=${counts.pending} running=${counts.running} deadLetter=${counts.deadLetter}`,
      data: counts,
    };
  } catch (err) {
    components.jobs = { status: "UNKNOWN", detail: String(err) };
  }

  // ── delivery + amendment re-delivery + PACS archive backlogs ─────────────
  try {
    const backlog = await redeliveryBacklog();
    components.redelivery = {
      status: backlog.failed > 0 ? "DEGRADED" : backlog.open > 0 ? "DEGRADED" : "HEALTHY",
      detail: `open=${backlog.open} failed=${backlog.failed}${backlog.oldestOpenAgeHours != null ? ` oldest=${backlog.oldestOpenAgeHours}h` : ""}`,
      data: backlog,
    };
    components.pacsArchive = {
      status: backlog.pacsPending > 0 ? "DEGRADED" : "HEALTHY",
      detail: `revisions pending/failed=${backlog.pacsPending}`,
    };
  } catch (err) {
    components.redelivery = { status: "UNKNOWN", detail: String(err) };
    components.pacsArchive = { status: "UNKNOWN", detail: String(err) };
  }

  // ── viewer/PACS endpoint reachability (server-side probes) ────────────────
  try {
    const rows = await db.select().from(pacsSettingsTable);
    const get = (key: string) => rows.find((r) => r.key === key)?.value?.trim() || null;
    const targets: Array<{ name: string; url: string | null }> = [
      { name: "orthanc", url: get("orthanc_url") },
      { name: "ohif", url: get("ohif_base_url") },
    ];
    const results: Record<string, string> = {};
    let anyConfigured = false;
    let anyDown = false;
    for (const t of targets) {
      if (!t.url) { results[t.name] = "not configured"; continue; }
      anyConfigured = true;
      const ok = await probe(t.url);
      if (!ok) anyDown = true;
      results[t.name] = ok
        ? (opts.maskTopology ? "reachable" : `reachable (${t.url})`)
        : (opts.maskTopology ? "UNREACHABLE" : `UNREACHABLE (${t.url})`);
    }
    components.viewerPacs = {
      status: !anyConfigured ? "UNKNOWN" : anyDown ? "DEGRADED" : "HEALTHY",
      detail: Object.entries(results).map(([k, v]) => `${k}: ${v}`).join(" · "),
    };
  } catch (err) {
    components.viewerPacs = { status: "UNKNOWN", detail: String(err) };
  }

  // ── audit chain / drift / restore-verification (persisted proofs) ─────────
  {
    const audit = await latestOpsCheck("audit_chain");
    components.auditChain = {
      status: statusFromPersistedCheck(audit, now, 48),
      detail: audit ? `last verified ${new Date(audit.ranAt).toISOString()} → ${audit.status}` : "never verified",
      data: audit?.detail ? { last: audit.detail } : undefined,
    };
    const drift = await latestOpsCheck("structured_drift");
    components.structuredDrift = {
      status: statusFromPersistedCheck(drift, now, 48),
      detail: drift ? `last scan ${new Date(drift.ranAt).toISOString()} → ${drift.status}` : "never scanned",
      data: drift?.detail ? { last: drift.detail } : undefined,
    };
    const restore = await latestOpsCheck("restore_verification");
    components.restoreVerification = {
      status: statusFromPersistedCheck(restore, now, 24 * 14),
      detail: restore ? `last proof ${new Date(restore.ranAt).toISOString()} → ${restore.status}` : "never proven",
    };
  }

  // ── latest successful backup ───────────────────────────────────────────────
  try {
    const [latest] = await db
      .select()
      .from(backupJobLogsTable)
      .where(eq(backupJobLogsTable.status, "success"))
      .orderBy(desc(backupJobLogsTable.id))
      .limit(1);
    const ageHours = latest?.createdAt ? (now.getTime() - new Date(latest.createdAt).getTime()) / 3600_000 : null;
    components.backups = {
      status: latest == null ? "UNKNOWN" : ageHours != null && ageHours > 48 ? "DEGRADED" : "HEALTHY",
      detail: latest
        ? `latest success ${new Date(latest.createdAt!).toISOString()} (${latest.sizeBytes ?? "?"} bytes)`
        : "no successful backup recorded (the Synology pull path records nothing here — restore-verification is the proof that matters)",
    };
  } catch (err) {
    components.backups = { status: "UNKNOWN", detail: String(err) };
  }

  // ── stale locks + orphan counts (cheap consistency rollup) ────────────────
  try {
    const [locks] = await db
      .select({ stale: sql<number>`count(*)::int` })
      .from(radiologyWorklistTable)
      .where(sql`lock_user_id IS NOT NULL
        AND COALESCE(lock_last_activity_at, lock_time) IS NOT NULL
        AND COALESCE(lock_last_activity_at, lock_time) + interval '1 hour' < NOW()`);
    components.staleLocks = {
      status: (locks?.stale ?? 0) > 0 ? "DEGRADED" : "HEALTHY",
      detail: `${locks?.stale ?? 0} locks held >1h past activity (expiry is derived — release is a safe repair)`,
    };
  } catch (err) {
    components.staleLocks = { status: "UNKNOWN", detail: String(err) };
  }
  try {
    const consistency = await runConsistencyChecks({ hashSweepLimit: 50 });
    components.consistency = {
      status: consistency.errorCount > 0 ? "UNHEALTHY" : consistency.warningCount > 0 ? "DEGRADED" : "HEALTHY",
      detail: `${consistency.errorCount} ERROR, ${consistency.warningCount} WARNING checks (GET /consistency for detail)`,
      data: { errorChecks: consistency.findings.filter((f) => f.severity === "ERROR" && f.count > 0).map((f) => f.check) },
    };
  } catch (err) {
    components.consistency = { status: "UNKNOWN", detail: String(err) };
  }

  // ── version/build (already exposed by /health — repeated for one-stop ops) ─
  components.version = {
    status: "HEALTHY",
    detail: `version=${process.env.npm_package_version ?? "unknown"} commit=${(process.env.GIT_COMMIT ?? "unknown").slice(0, 8)}`,
  };

  return {
    overall: worstStatus(Object.values(components).map((c) => c.status)),
    ranAt: now.toISOString(),
    components,
  };
}
