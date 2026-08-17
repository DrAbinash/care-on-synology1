/**
 * radiologyJobs.ts — Ticket BEND-1 Phase 3: durable job execution.
 *
 * Reuses the EXISTING dicom_retry_queue table (it already had operation_type,
 * retry_count, max_retries, next_retry_at and a status vocabulary — but no
 * worker ever drained it). BEND-1 adds payload/idempotency/lock columns and
 * this runner:
 *
 *   enqueue (idempotent) → claim (FOR UPDATE SKIP LOCKED, → running)
 *   → handler → success | bounded retry with backoff | abandoned (dead-letter)
 *
 * Restart safety: a worker that dies leaves its job "running"; the next tick
 * requeues stale running jobs. Handlers are idempotent and re-check their
 * subject's state before any EXTERNAL send, so a requeue never double-sends.
 * The runner claims ONLY operation types it has handlers for — it never
 * touches the pre-existing manual DICOM retry entries.
 */

import { db } from "@workspace/db";
import { dicomRetryQueueTable } from "@workspace/db/schema";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  CLAIMABLE_STATUSES, decideFailure, decideDeadLetterRetry, isStaleRunning,
  type RadiologyJobStatus,
} from "./radiologyJobRules";

export interface RadiologyJobRow {
  id: number;
  operationType: string;
  entityType: string;
  entityId: number | null;
  payload: unknown;
  retryCount: number;
  maxRetries: number;
  status: string;
  idempotencyKey: string | null;
}

export type RadiologyJobHandler = (job: RadiologyJobRow) => Promise<{ ok: boolean; detail?: string }>;

/** Idempotent enqueue: the same idempotency key never creates a second job.
 *  Returns the job id (existing or new). */
export async function enqueueRadiologyJob(args: {
  operationType: string;
  entityType: string;
  entityId?: number | null;
  payload?: unknown;
  idempotencyKey: string;
  maxRetries?: number;
}): Promise<{ id: number; created: boolean }> {
  const inserted = await db
    .insert(dicomRetryQueueTable)
    .values({
      operationType: args.operationType,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      payload: args.payload ?? null,
      idempotencyKey: args.idempotencyKey,
      maxRetries: args.maxRetries ?? 5,
      status: "pending",
      nextRetryAt: new Date(),
    })
    .onConflictDoNothing({ target: dicomRetryQueueTable.idempotencyKey })
    .returning({ id: dicomRetryQueueTable.id });
  if (inserted.length > 0) return { id: inserted[0].id, created: true };
  const [existing] = await db
    .select({ id: dicomRetryQueueTable.id })
    .from(dicomRetryQueueTable)
    .where(eq(dicomRetryQueueTable.idempotencyKey, args.idempotencyKey))
    .limit(1);
  return { id: existing?.id ?? -1, created: false };
}

/** Requeue running jobs whose lock went stale (worker died/restarted). */
export async function requeueStaleRunningJobs(handledTypes: string[], staleMs = 10 * 60_000): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ id: dicomRetryQueueTable.id, lockedAt: dicomRetryQueueTable.lockedAt, status: dicomRetryQueueTable.status })
    .from(dicomRetryQueueTable)
    .where(and(eq(dicomRetryQueueTable.status, "running"), inArray(dicomRetryQueueTable.operationType, handledTypes)));
  const stale = rows.filter((r) =>
    isStaleRunning({ status: r.status as RadiologyJobStatus, lockedAt: r.lockedAt, now, staleMs }));
  if (stale.length === 0) return 0;
  await db
    .update(dicomRetryQueueTable)
    .set({ status: "retrying", lockedBy: null, lockedAt: null, nextRetryAt: now, updatedAt: now })
    .where(inArray(dicomRetryQueueTable.id, stale.map((r) => r.id)));
  return stale.length;
}

/** Claim the next due job of the handled types — FOR UPDATE SKIP LOCKED so
 *  concurrent workers/restarts never claim the same row twice. */
async function claimNextJob(workerId: string, handledTypes: string[]): Promise<RadiologyJobRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(dicomRetryQueueTable)
      .where(and(
        inArray(dicomRetryQueueTable.status, [...CLAIMABLE_STATUSES]),
        inArray(dicomRetryQueueTable.operationType, handledTypes),
        or(isNull(dicomRetryQueueTable.nextRetryAt), lte(dicomRetryQueueTable.nextRetryAt, new Date())),
      ))
      .orderBy(asc(dicomRetryQueueTable.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    const now = new Date();
    await tx
      .update(dicomRetryQueueTable)
      .set({
        status: "running",
        lockedBy: workerId,
        lockedAt: now,
        startedAt: row.startedAt ?? now,
        lastAttemptedAt: now,
        updatedAt: now,
      })
      .where(eq(dicomRetryQueueTable.id, row.id));
    return {
      id: row.id,
      operationType: row.operationType,
      entityType: row.entityType,
      entityId: row.entityId,
      payload: row.payload,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      status: "running",
      idempotencyKey: row.idempotencyKey,
    };
  });
}

async function completeJob(id: number, detail?: string): Promise<void> {
  const now = new Date();
  await db
    .update(dicomRetryQueueTable)
    .set({
      status: "success", completedAt: now, resolvedAt: now,
      lockedBy: null, lockedAt: null, updatedAt: now,
      ...(detail ? { errorDetailsJson: null, failureReason: detail.slice(0, 500) } : {}),
    })
    .where(eq(dicomRetryQueueTable.id, id));
}

async function failJob(job: RadiologyJobRow, error: string): Promise<RadiologyJobStatus> {
  const now = new Date();
  const next = decideFailure({ retryCount: job.retryCount, maxRetries: job.maxRetries, now });
  await db
    .update(dicomRetryQueueTable)
    .set({
      status: next.status,
      retryCount: next.retryCount,
      nextRetryAt: next.nextRetryAt,
      failureReason: error.slice(0, 500),
      lockedBy: null, lockedAt: null, updatedAt: now,
    })
    .where(eq(dicomRetryQueueTable.id, job.id));
  return next.status;
}

/** One worker tick: requeue stale claims, then run up to maxJobs due jobs.
 *  Returns what happened (used by cron, the ops tick endpoint and tests).
 *
 *  concurrencyByType: optional per-operationType ceiling on concurrently RUNNING
 *  jobs (e.g. ai_shadow_pipeline → 1). When the ceiling is already hit, that
 *  type is skipped for this tick so a failed/completed job releases the slot
 *  and the next study can start on a later tick — never blocks other job types.
 */
export async function runRadiologyJobTick(
  handlers: Record<string, RadiologyJobHandler>,
  opts: {
    workerId?: string;
    maxJobs?: number;
    concurrencyByType?: Record<string, number>;
  } = {},
): Promise<{ requeuedStale: number; ran: Array<{ id: number; operationType: string; outcome: string }> }> {
  const handledTypes = Object.keys(handlers);
  if (handledTypes.length === 0) return { requeuedStale: 0, ran: [] };
  const workerId = opts.workerId ?? `api-${process.pid}`;
  const requeuedStale = await requeueStaleRunningJobs(handledTypes);
  const ran: Array<{ id: number; operationType: string; outcome: string }> = [];
  const maxJobs = opts.maxJobs ?? 5;
  const concurrencyByType = opts.concurrencyByType ?? {};

  // Pre-compute which types are at capacity so we don't claim them.
  const blockedTypes = new Set<string>();
  for (const [op, limit] of Object.entries(concurrencyByType)) {
    if (limit <= 0) { blockedTypes.add(op); continue; }
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dicomRetryQueueTable)
      .where(and(
        eq(dicomRetryQueueTable.operationType, op),
        eq(dicomRetryQueueTable.status, "running"),
      ));
    if ((row?.count ?? 0) >= limit) blockedTypes.add(op);
  }

  const claimableTypes = handledTypes.filter((t) => !blockedTypes.has(t));
  if (claimableTypes.length === 0) return { requeuedStale, ran };

  for (let i = 0; i < maxJobs; i++) {
    // Re-check AI concurrency mid-tick so we never start two shadow jobs in one loop.
    const stillClaimable = claimableTypes.filter((t) => {
      const lim = concurrencyByType[t];
      if (lim == null) return true;
      const startedThisTick = ran.filter((r) => r.operationType === t).length;
      return startedThisTick < lim;
    });
    if (stillClaimable.length === 0) break;

    const job = await claimNextJob(workerId, stillClaimable);
    if (!job) break;

    // If this op has a concurrency ceiling and we somehow claimed past it, abandon claim.
    const lim = concurrencyByType[job.operationType];
    if (lim != null) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dicomRetryQueueTable)
        .where(and(
          eq(dicomRetryQueueTable.operationType, job.operationType),
          eq(dicomRetryQueueTable.status, "running"),
        ));
      // count includes the job we just claimed
      if ((row?.count ?? 1) > lim) {
        await db
          .update(dicomRetryQueueTable)
          .set({
            status: "pending",
            lockedBy: null,
            lockedAt: null,
            nextRetryAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(dicomRetryQueueTable.id, job.id));
        break;
      }
    }

    try {
      const result = await handlers[job.operationType](job);
      if (result.ok) {
        await completeJob(job.id, result.detail);
        ran.push({ id: job.id, operationType: job.operationType, outcome: "success" });
      } else {
        const status = await failJob(job, result.detail ?? "handler reported failure");
        ran.push({ id: job.id, operationType: job.operationType, outcome: status });
      }
    } catch (err) {
      const status = await failJob(job, err instanceof Error ? err.message : String(err));
      ran.push({ id: job.id, operationType: job.operationType, outcome: status });
    }
  }
  return { requeuedStale, ran };
}

/** Dead-letter visibility (abandoned = retries exhausted). */
export async function listDeadLetterJobs(handledTypes?: string[]): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select()
    .from(dicomRetryQueueTable)
    .where(and(
      eq(dicomRetryQueueTable.status, "abandoned"),
      ...(handledTypes ? [inArray(dicomRetryQueueTable.operationType, handledTypes)] : []),
    ))
    .orderBy(asc(dicomRetryQueueTable.id));
  return rows.map((r) => ({
    id: r.id, operationType: r.operationType, entityType: r.entityType, entityId: r.entityId,
    retryCount: r.retryCount, maxRetries: r.maxRetries, failureReason: r.failureReason,
    createdAt: r.createdAt, lastAttemptedAt: r.lastAttemptedAt,
  }));
}

/** Repair action: make a dead/failed job retryable again (due immediately). */
export async function markJobRetryable(id: number): Promise<boolean> {
  const [row] = await db.select({ status: dicomRetryQueueTable.status }).from(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.id, id));
  if (!row) return false;
  const next = decideDeadLetterRetry(row.status as RadiologyJobStatus, new Date());
  if (!next) return false;
  await db
    .update(dicomRetryQueueTable)
    .set({ status: next.status, nextRetryAt: next.nextRetryAt, retryCount: 0, updatedAt: new Date() })
    .where(eq(dicomRetryQueueTable.id, id));
  return true;
}

/** Count claimable (pending/retrying and due) jobs of one operation type. */
export async function countDueJobs(operationType: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dicomRetryQueueTable)
    .where(and(
      eq(dicomRetryQueueTable.operationType, operationType),
      inArray(dicomRetryQueueTable.status, [...CLAIMABLE_STATUSES]),
      or(isNull(dicomRetryQueueTable.nextRetryAt), lte(dicomRetryQueueTable.nextRetryAt, now)),
    ));
  return row?.count ?? 0;
}

/** Backlog counts for the ops health endpoint. */
export async function jobBacklogCounts(handledTypes: string[]): Promise<{ pending: number; running: number; deadLetter: number }> {
  const rows = await db
    .select({ status: dicomRetryQueueTable.status, count: sql<number>`count(*)::int` })
    .from(dicomRetryQueueTable)
    .where(inArray(dicomRetryQueueTable.operationType, handledTypes))
    .groupBy(dicomRetryQueueTable.status);
  const get = (s: string) => rows.find((r) => r.status === s)?.count ?? 0;
  return { pending: get("pending") + get("retrying"), running: get("running"), deadLetter: get("abandoned") };
}
