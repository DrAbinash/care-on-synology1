/**
 * Overnight AI draft queue helpers over the EXISTING dicom_retry_queue.
 *
 * No new table. Latest ai_shadow_pipeline row per studyInstanceUid is the
 * source of QUEUED vs RUNNING vs STUCK, timestamps, attempts, and errors.
 */
import { db } from "@workspace/db";
import { dicomRetryQueueTable, radiologyWorklistTable } from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";
import {
  buildOvernightDisplay,
  shadowJobFreshnessRank,
  type OvernightDisplay,
  type OvernightJobSnapshot,
} from "./overnightAiDraftStatus";
import { markJobRetryable } from "../radiologyJobs";
import type { RadiologyJobStatus } from "../radiologyJobRules";

const IN_FLIGHT: RadiologyJobStatus[] = ["pending", "retrying", "running"];

function uidFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const uid = (payload as { studyInstanceUid?: unknown }).studyInstanceUid;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

export function overnightIdempotencyKey(studyInstanceUid: string): string {
  return `ai:shadow:${studyInstanceUid}:overnight`;
}

export async function listActiveShadowJobs(uids?: string[]): Promise<Array<{
  id: number;
  status: string;
  uid: string | null;
  createdAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastAttemptedAt: Date | null;
  retryCount: number;
  failureReason: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
}>> {
  if (uids && uids.length === 0) return [];
  const uidFilter = uids && uids.length > 0
    ? sql`(${dicomRetryQueueTable.payload}->>'studyInstanceUid') in (${sql.join(uids.map((u) => sql`${u}`), sql`, `)})`
    : undefined;
  const rows = await db
    .select({
      id: dicomRetryQueueTable.id,
      status: dicomRetryQueueTable.status,
      payload: dicomRetryQueueTable.payload,
      createdAt: dicomRetryQueueTable.createdAt,
      startedAt: dicomRetryQueueTable.startedAt,
      completedAt: dicomRetryQueueTable.completedAt,
      lastAttemptedAt: dicomRetryQueueTable.lastAttemptedAt,
      retryCount: dicomRetryQueueTable.retryCount,
      failureReason: dicomRetryQueueTable.failureReason,
      lockedAt: dicomRetryQueueTable.lockedAt,
      lockedBy: dicomRetryQueueTable.lockedBy,
    })
    .from(dicomRetryQueueTable)
    .where(uidFilter
      ? and(eq(dicomRetryQueueTable.operationType, AI_SHADOW_PIPELINE_JOB), uidFilter)
      : eq(dicomRetryQueueTable.operationType, AI_SHADOW_PIPELINE_JOB));
  const wanted = uids ? new Set(uids) : null;
  return rows
    .map((r) => ({ ...r, uid: uidFromPayload(r.payload) }))
    .filter((r) => r.uid && (!wanted || wanted.has(r.uid)));
}

/** Latest shadow job per UID, preferring in-flight over terminal. */
export function pickLatestJobByUid(
  rows: Awaited<ReturnType<typeof listActiveShadowJobs>>,
): Map<string, OvernightJobSnapshot> {
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!row.uid) continue;
    const prev = best.get(row.uid);
    if (!prev) {
      best.set(row.uid, row);
      continue;
    }
    const rank = shadowJobFreshnessRank(row.status) - shadowJobFreshnessRank(prev.status);
    if (rank < 0 || (rank === 0 && row.id > prev.id)) best.set(row.uid, row);
  }
  const out = new Map<string, OvernightJobSnapshot>();
  for (const [uid, row] of best) {
    out.set(uid, {
      jobId: row.id,
      jobStatus: row.status,
      queuedAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      lastAttemptAt: row.lastAttemptedAt,
      attemptCount: row.retryCount ?? 0,
      lastError: row.failureReason,
      lockedAt: row.lockedAt,
      lockedBy: row.lockedBy,
    });
  }
  return out;
}

export function queuePositionsByJobId(
  rows: Awaited<ReturnType<typeof listActiveShadowJobs>>,
): Map<number, number> {
  const waiting = rows
    .filter((r) => r.status === "pending" || r.status === "retrying")
    .sort((a, b) => a.id - b.id);
  const pos = new Map<number, number>();
  waiting.forEach((r, i) => pos.set(r.id, i + 1));
  return pos;
}

export async function enrichWorklistOvernightAi<T extends {
  studyInstanceUID?: string | null;
  aiDraftStatus?: string | null;
}>(rows: T[], now = new Date()): Promise<Array<T & { overnightAi: OvernightDisplay; overnightEligible?: boolean }>> {
  const uids = rows.map((r) => r.studyInstanceUID).filter((u): u is string => !!u);
  const jobs = await listActiveShadowJobs(uids.length > 0 ? uids : undefined);
  const byUid = pickLatestJobByUid(jobs);
  const positions = queuePositionsByJobId(jobs);
  return rows.map((r) => {
    const uid = r.studyInstanceUID ?? "";
    const job = uid ? byUid.get(uid) ?? null : null;
    const overnightAi = buildOvernightDisplay({
      worklistAiDraftStatus: r.aiDraftStatus,
      job,
      queuePosition: job?.jobId != null ? positions.get(job.jobId) ?? null : null,
      now,
    });
    return { ...r, overnightAi };
  });
}

export async function findInFlightShadowJob(studyInstanceUid: string): Promise<{
  id: number;
  status: string;
} | null> {
  const jobs = await listActiveShadowJobs([studyInstanceUid]);
  const inFlight = jobs
    .filter((j) => IN_FLIGHT.includes(j.status as RadiologyJobStatus))
    .sort((a, b) => shadowJobFreshnessRank(a.status) - shadowJobFreshnessRank(b.status) || b.id - a.id)[0];
  return inFlight ? { id: inFlight.id, status: inFlight.status } : null;
}

export async function findLatestShadowJob(studyInstanceUid: string): Promise<{
  id: number;
  status: string;
  failureReason: string | null;
} | null> {
  const jobs = await listActiveShadowJobs([studyInstanceUid]);
  const map = pickLatestJobByUid(jobs);
  const snap = map.get(studyInstanceUid);
  return snap?.jobId
    ? { id: snap.jobId, status: snap.jobStatus ?? "", failureReason: snap.lastError ?? null }
    : null;
}

export async function worklistIsReady(studyInstanceUid: string): Promise<boolean> {
  const [row] = await db
    .select({ status: radiologyWorklistTable.aiDraftStatus })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUid))
    .limit(1);
  return (row?.status ?? "").toUpperCase() === "READY";
}

/**
 * Skip enqueue when a valid READY draft exists or a job is already
 * queued/running/retrying. Returns the skip reason, or null if enqueue is OK.
 */
export async function duplicateEnqueueReason(
  studyInstanceUid: string,
  opts: { forceRetry?: boolean } = {},
): Promise<string | null> {
  const inFlight = await findInFlightShadowJob(studyInstanceUid);
  if (inFlight) {
    return `already ${inFlight.status} (job ${inFlight.id})`;
  }
  if (!opts.forceRetry && await worklistIsReady(studyInstanceUid)) {
    return "already READY";
  }
  return null;
}

/** Cancel queued jobs only. Never touches running (Ollama in flight). */
export async function cancelQueuedShadowJobs(jobIds: number[]): Promise<{
  cancelled: number;
  skippedRunning: number;
  skippedOther: number;
}> {
  let cancelled = 0;
  let skippedRunning = 0;
  let skippedOther = 0;
  if (jobIds.length === 0) return { cancelled, skippedRunning, skippedOther };
  const rows = await db
    .select({
      id: dicomRetryQueueTable.id,
      status: dicomRetryQueueTable.status,
      payload: dicomRetryQueueTable.payload,
      op: dicomRetryQueueTable.operationType,
    })
    .from(dicomRetryQueueTable)
    .where(inArray(dicomRetryQueueTable.id, jobIds));
  for (const row of rows) {
    if (row.op !== AI_SHADOW_PIPELINE_JOB) {
      skippedOther++;
      continue;
    }
    if (row.status === "running") {
      skippedRunning++;
      continue;
    }
    if (row.status !== "pending" && row.status !== "retrying") {
      skippedOther++;
      continue;
    }
    await db
      .update(dicomRetryQueueTable)
      .set({
        status: "abandoned",
        failureReason: "cancelled by operator (queued only)",
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(dicomRetryQueueTable.id, row.id));
    const uid = uidFromPayload(row.payload);
    if (uid) {
      await db
        .update(radiologyWorklistTable)
        .set({ aiDraftStatus: "NONE", updatedAt: new Date() })
        .where(and(
          eq(radiologyWorklistTable.studyInstanceUID, uid),
          eq(radiologyWorklistTable.aiDraftStatus, "PENDING"),
        ));
    }
    cancelled++;
  }
  return { cancelled, skippedRunning, skippedOther };
}

/**
 * Idempotent retry of ERROR jobs: requeue the existing abandoned/failed row.
 * Refuses if a job is already in flight for the same study (no double draft).
 */
export async function retryShadowJobs(jobIds: number[]): Promise<{
  retried: number;
  skippedInFlight: number;
  skippedOther: number;
}> {
  let retried = 0;
  let skippedInFlight = 0;
  let skippedOther = 0;
  if (jobIds.length === 0) return { retried, skippedInFlight, skippedOther };
  const rows = await db
    .select({
      id: dicomRetryQueueTable.id,
      status: dicomRetryQueueTable.status,
      payload: dicomRetryQueueTable.payload,
      op: dicomRetryQueueTable.operationType,
    })
    .from(dicomRetryQueueTable)
    .where(inArray(dicomRetryQueueTable.id, jobIds));
  for (const row of rows) {
    if (row.op !== AI_SHADOW_PIPELINE_JOB) {
      skippedOther++;
      continue;
    }
    const uid = uidFromPayload(row.payload);
    if (uid) {
      const inFlight = await findInFlightShadowJob(uid);
      if (inFlight && inFlight.id !== row.id) {
        skippedInFlight++;
        continue;
      }
    }
    if (row.status === "running") {
      skippedInFlight++;
      continue;
    }
    const ok = await markJobRetryable(row.id);
    if (!ok) {
      skippedOther++;
      continue;
    }
    if (uid) {
      await db
        .update(radiologyWorklistTable)
        .set({ aiDraftStatus: "PENDING", updatedAt: new Date() })
        .where(eq(radiologyWorklistTable.studyInstanceUID, uid));
    }
    retried++;
  }
  return { retried, skippedInFlight, skippedOther };
}

export async function overnightQueueStats(now = new Date()) {
  const jobs = await listActiveShadowJobs();
  const waiting = jobs.filter((j) => j.status === "pending" || j.status === "retrying");
  const running = jobs.filter((j) => j.status === "running");
  const staleRunning = running.filter((j) => {
    if (!j.lockedAt) return true;
    return now.getTime() - j.lockedAt.getTime() > 10 * 60_000;
  });
  const oldestQueued = waiting
    .slice()
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))[0] ?? null;
  const lastSuccess = jobs
    .filter((j) => j.status === "success" && j.completedAt)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ?? null;
  const lastError = jobs
    .filter((j) => (j.status === "abandoned" || j.status === "failed") && j.failureReason)
    .sort((a, b) => (b.lastAttemptedAt?.getTime() ?? b.id) - (a.lastAttemptedAt?.getTime() ?? a.id))[0] ?? null;
  const abandoned = jobs.filter((j) => j.status === "abandoned");
  const abandonedReasons: Record<string, number> = {};
  for (const j of abandoned) {
    const key = (j.failureReason ?? "(no reason)").slice(0, 160);
    abandonedReasons[key] = (abandonedReasons[key] ?? 0) + 1;
  }
  const topAbandonedReasons = Object.entries(abandonedReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
  return {
    queueDepth: waiting.length,
    running: running.length,
    abandoned: abandoned.length,
    staleRunning: staleRunning.length,
    oldestQueuedAt: oldestQueued?.createdAt?.toISOString() ?? null,
    lastSuccessfulDraftAt: lastSuccess?.completedAt?.toISOString() ?? null,
    lastError: lastError?.failureReason ?? null,
    lastErrorAt: lastError?.lastAttemptedAt?.toISOString() ?? null,
    topAbandonedReasons,
  };
}

function executeRows<T>(res: unknown): T[] {
  const withRows = res as { rows?: T[] };
  if (Array.isArray(withRows.rows)) return withRows.rows;
  return Array.isArray(res) ? (res as T[]) : [];
}

/** Read-only composition of ai_shadow_pipeline rows. Never deletes or reseeds. */
export async function shadowQueueComposition() {
  const statusRows = executeRows<{ status: string; n: number }>(await db.execute(sql`
    SELECT status, count(*)::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
    GROUP BY status
  `));
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  const pending = (byStatus.pending ?? 0) + (byStatus.retrying ?? 0);

  const dueNow = executeRows<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending','retrying')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  `))[0]?.n ?? 0;

  const retryBuckets = executeRows<{ retry_count: number; n: number }>(await db.execute(sql`
    SELECT retry_count, count(*)::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending','retrying')
    GROUP BY retry_count
    ORDER BY retry_count
  `));

  const ageBuckets = executeRows<{ bucket: string; n: number }>(await db.execute(sql`
    SELECT bucket, count(*)::int AS n FROM (
      SELECT CASE
        WHEN created_at > NOW() - INTERVAL '3 hours' THEN '0-3h'
        WHEN created_at > NOW() - INTERVAL '10 hours' THEN '3-10h'
        WHEN created_at > NOW() - INTERVAL '24 hours' THEN '10-24h'
        WHEN created_at > NOW() - INTERVAL '7 days' THEN '1-7d'
        ELSE '7d+'
      END AS bucket
      FROM dicom_retry_queue
      WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
        AND status IN ('pending','retrying')
    ) t
    GROUP BY bucket
  `));

  const modalities = executeRows<{ modality: string; n: number }>(await db.execute(sql`
    SELECT COALESCE(NULLIF(upper(payload->>'modality'), ''), '(none)') AS modality, count(*)::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending','retrying')
    GROUP BY 1
    ORDER BY n DESC
  `));

  const reasons = executeRows<{ reason: string; n: number }>(await db.execute(sql`
    SELECT COALESCE(left(failure_reason, 160), '(no reason)') AS reason, count(*)::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status = 'abandoned'
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 10
  `));

  const duplicateIdentity = executeRows<{ studies: number; extraJobs: number }>(await db.execute(sql`
    SELECT
      count(*)::int AS studies,
      COALESCE(sum(n - 1), 0)::int AS "extraJobs"
    FROM (
      SELECT payload->>'studyInstanceUid' AS uid, count(*)::int AS n
      FROM dicom_retry_queue
      WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
        AND status IN ('pending','retrying')
        AND payload->>'studyInstanceUid' IS NOT NULL
      GROUP BY 1
      HAVING count(*) > 1
    ) d
  `))[0] ?? { studies: 0, extraJobs: 0 };

  const uniqueStudies = executeRows<{ n: number }>(await db.execute(sql`
    SELECT count(DISTINCT payload->>'studyInstanceUid')::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending','retrying')
  `))[0]?.n ?? 0;

  const arrivalKeyed = executeRows<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending','retrying')
      AND idempotency_key LIKE 'ai:shadow:%:dicom-arrival:%'
  `))[0]?.n ?? 0;

  const overnightKeyed = executeRows<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n
    FROM dicom_retry_queue
    WHERE operation_type = ${AI_SHADOW_PIPELINE_JOB}
      AND status IN ('pending','retrying')
      AND idempotency_key LIKE 'ai:shadow:%:overnight'
  `))[0]?.n ?? 0;

  const lockWaiters = executeRows<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE c.relname = 'dicom_retry_queue' AND NOT l.granted
  `))[0]?.n ?? 0;

  return {
    byStatus,
    pending,
    running: byStatus.running ?? 0,
    abandoned: byStatus.abandoned ?? 0,
    success: byStatus.success ?? 0,
    dueNow,
    uniqueStudies,
    duplicateStudies: duplicateIdentity.studies,
    duplicateExtraJobs: duplicateIdentity.extraJobs,
    arrivalKeyedDuplicates: arrivalKeyed,
    overnightKeyed,
    age: Object.fromEntries(ageBuckets.map((r) => [r.bucket, r.n])),
    retryCount: retryBuckets.map((r) => ({ retryCount: r.retry_count, n: r.n })),
    modality: modalities,
    abandonedReasons: reasons,
    ungrantedLocks: lockWaiters,
  };
}

export { IN_FLIGHT as SHADOW_IN_FLIGHT_STATUSES };
