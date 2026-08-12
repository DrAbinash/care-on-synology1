/**
 * Durable MWL .wl cleanup retry — reuses dicom_retry_queue + radiology job runner.
 *
 * When ERP/MWL DB state is cancelled but unlink of the live Orthanc .wl fails,
 * we enqueue operationType `mwl_wl_cleanup` (idempotent per accession). The
 * existing cron tick drains it with bounded exponential backoff. Handlers
 * NEVER call writeWorklistFile — remove only.
 */

import { db } from "@workspace/db";
import { dicomRetryQueueTable, radiologyScheduledProceduresTable } from "@workspace/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import {
  enqueueRadiologyJob,
  markJobRetryable,
  runRadiologyJobTick,
  type RadiologyJobHandler,
  type RadiologyJobRow,
} from "../radiologyJobs";
import {
  removeWorklistFile,
  type RemoveWorklistResult,
} from "./mwlWorklistWriter";
import {
  assessMwlCleanupTrafficLight,
  decideCleanupAfterRemove,
  isTerminalMwlStatus,
  mwlCleanupIdempotencyKey,
  MWL_WL_CLEANUP_JOB,
  MWL_WL_CLEANUP_MAX_RETRIES,
} from "./mwlWlCleanupRules";

export {
  assessMwlCleanupTrafficLight,
  decideCleanupAfterRemove,
  isTerminalMwlStatus,
  mwlCleanupIdempotencyKey,
  MWL_WL_CLEANUP_JOB,
  MWL_WL_CLEANUP_MAX_RETRIES,
} from "./mwlWlCleanupRules";

export type MwlCleanupPayload = {
  accessionNumber: string;
  operation: "REMOVE_MWL";
  terminalStatus: "CANCELLED";
  billId?: number | null;
  orderId?: number | null;
  orderTestId?: number | null;
  studyId?: number | null;
  reason?: string;
};

const ACTIVE_JOB_STATUSES = ["pending", "retrying", "running"] as const;

/**
 * Enqueue (or reactivate) a single REMOVE_MWL cleanup job for this accession.
 * Idempotent: at most one active job per accession.
 */
export async function enqueueMwlWlCleanup(payload: MwlCleanupPayload): Promise<{
  id: number;
  created: boolean;
  reactivated: boolean;
}> {
  const accessionNumber = (payload.accessionNumber || "").trim();
  if (!accessionNumber) return { id: -1, created: false, reactivated: false };

  const idempotencyKey = mwlCleanupIdempotencyKey(accessionNumber);
  const fullPayload: MwlCleanupPayload = {
    ...payload,
    accessionNumber,
    operation: "REMOVE_MWL",
    terminalStatus: "CANCELLED",
  };

  try {
    const enqueued = await enqueueRadiologyJob({
      operationType: MWL_WL_CLEANUP_JOB,
      entityType: "mwl_procedure",
      entityId: payload.studyId ?? payload.orderTestId ?? payload.billId ?? null,
      payload: fullPayload,
      idempotencyKey,
      maxRetries: MWL_WL_CLEANUP_MAX_RETRIES,
    });

    if (enqueued.created) {
      return { id: enqueued.id, created: true, reactivated: false };
    }

    if (enqueued.id < 0) return { id: -1, created: false, reactivated: false };

    const [existing] = await db
      .select({
        id: dicomRetryQueueTable.id,
        status: dicomRetryQueueTable.status,
      })
      .from(dicomRetryQueueTable)
      .where(eq(dicomRetryQueueTable.id, enqueued.id))
      .limit(1);

    if (!existing) return { id: enqueued.id, created: false, reactivated: false };

    if ((ACTIVE_JOB_STATUSES as readonly string[]).includes(existing.status)) {
      // Already pending — update payload context but do not duplicate.
      await db
        .update(dicomRetryQueueTable)
        .set({ payload: fullPayload, updatedAt: new Date() })
        .where(eq(dicomRetryQueueTable.id, existing.id));
      return { id: existing.id, created: false, reactivated: false };
    }

    // success / abandoned / failed → reactivate for another cleanup attempt
    const now = new Date();
    await db
      .update(dicomRetryQueueTable)
      .set({
        status: "pending",
        retryCount: 0,
        nextRetryAt: now,
        payload: fullPayload,
        failureReason: null,
        completedAt: null,
        resolvedAt: null,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(eq(dicomRetryQueueTable.id, existing.id));
    return { id: existing.id, created: false, reactivated: true };
  } catch (err) {
    logger.warn({ err, accessionNumber }, "mwl: enqueueMwlWlCleanup failed (non-fatal)");
    return { id: -1, created: false, reactivated: false };
  }
}

/** Ensure scheduled procedure stays terminal; never republish. */
async function assertStillTerminal(accessionNumber: string): Promise<{
  ok: boolean;
  detail: string;
  status: string | null;
}> {
  const [row] = await db
    .select({ status: radiologyScheduledProceduresTable.status })
    .from(radiologyScheduledProceduresTable)
    .where(eq(radiologyScheduledProceduresTable.accessionNumber, accessionNumber))
    .limit(1);

  if (!row) {
    // No ERP row — still safe to remove a stray .wl
    return { ok: true, detail: "no scheduled procedure row — remove stray .wl if present", status: null };
  }

  const status = (row.status || "").toUpperCase();
  if (!isTerminalMwlStatus(status)) {
    return {
      ok: false,
      detail: `procedure status is ${status} — refusing cleanup (not terminal)`,
      status,
    };
  }
  return { ok: true, detail: `terminal status ${status}`, status };
}

export const mwlWlCleanupHandler: RadiologyJobHandler = async (job: RadiologyJobRow) => {
  const payload = (job.payload ?? {}) as Partial<MwlCleanupPayload>;
  const accessionNumber = String(payload.accessionNumber ?? "").trim();
  if (!accessionNumber) {
    return { ok: false, detail: "invalid payload: accessionNumber required" };
  }

  const gate = await assertStillTerminal(accessionNumber);
  if (!gate.ok) {
    // Not terminal anymore — complete the job without writing (never republish).
    return { ok: true, detail: gate.detail };
  }

  // REMOVE ONLY — never writeWorklistFile.
  const result = await removeWorklistFile(accessionNumber);
  if (isRemoveWorklistSuccess(result)) {
    return {
      ok: true,
      detail: `MWL cleanup ${result.outcome} for ${accessionNumber}`,
    };
  }
  return {
    ok: false,
    detail: result.outcome === "failed" ? result.error : `cleanup ${result.outcome}`,
  };
};

export type MwlCleanupDiagnostics = {
  pending: number;
  retrying: number;
  abandoned: number;
  overdue: number;
  oldestPendingAgeMs: number | null;
  lastSuccessAt: string | null;
  /** GREEN | AMBER | RED */
  trafficLight: "green" | "amber" | "red";
  detail: string;
};

/** Read-only summary for Settings → Radiology → MWL (no PHI). */
export async function getMwlCleanupDiagnostics(now = new Date()): Promise<MwlCleanupDiagnostics> {
  try {
    const rows = await db
      .select({
        status: dicomRetryQueueTable.status,
        nextRetryAt: dicomRetryQueueTable.nextRetryAt,
        createdAt: dicomRetryQueueTable.createdAt,
        completedAt: dicomRetryQueueTable.completedAt,
        retryCount: dicomRetryQueueTable.retryCount,
      })
      .from(dicomRetryQueueTable)
      .where(eq(dicomRetryQueueTable.operationType, MWL_WL_CLEANUP_JOB));

    let pending = 0;
    let retrying = 0;
    let abandoned = 0;
    let overdue = 0;
    let oldestPending: Date | null = null;
    let lastSuccessAt: Date | null = null;

    for (const r of rows) {
      if (r.status === "pending") pending += 1;
      else if (r.status === "retrying" || r.status === "running") retrying += 1;
      else if (r.status === "abandoned") abandoned += 1;
      else if (r.status === "success" && r.completedAt) {
        if (!lastSuccessAt || r.completedAt > lastSuccessAt) lastSuccessAt = r.completedAt;
      }

      if ((r.status === "pending" || r.status === "retrying") && r.nextRetryAt && r.nextRetryAt < now && (r.retryCount ?? 0) >= 2) {
        overdue += 1;
      }
      if (r.status === "pending" || r.status === "retrying" || r.status === "running") {
        if (!oldestPending || r.createdAt < oldestPending) oldestPending = r.createdAt;
      }
    }

    const light = assessMwlCleanupTrafficLight({ pending, retrying, abandoned, overdue });
    return {
      pending,
      retrying,
      abandoned,
      overdue,
      oldestPendingAgeMs: oldestPending ? Math.max(0, now.getTime() - oldestPending.getTime()) : null,
      lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
      trafficLight: light.trafficLight,
      detail: light.detail,
    };
  } catch (err) {
    logger.warn({ err }, "mwl: getMwlCleanupDiagnostics failed");
    return {
      pending: 0,
      retrying: 0,
      abandoned: 0,
      overdue: 0,
      oldestPendingAgeMs: null,
      lastSuccessAt: null,
      trafficLight: "amber",
      detail: "Could not read MWL cleanup queue",
    };
  }
}

/** Count cancelled/completed procedures that still have a live .wl (stale file). */
export async function countStaleTerminalWlFiles(
  wlExists: (accession: string) => Promise<boolean>,
  limit = 50,
): Promise<number> {
  const rows = await db
    .select({
      accessionNumber: radiologyScheduledProceduresTable.accessionNumber,
      status: radiologyScheduledProceduresTable.status,
    })
    .from(radiologyScheduledProceduresTable)
    .where(inArray(radiologyScheduledProceduresTable.status, ["CANCELLED", "CANCELED", "COMPLETED", "DISCONTINUED"]))
    .orderBy(desc(radiologyScheduledProceduresTable.updatedAt))
    .limit(limit);

  let stale = 0;
  for (const r of rows) {
    if (await wlExists(r.accessionNumber)) stale += 1;
  }
  return stale;
}

/** Admin-only: drain pending MWL cleanup jobs only (never publishes). */
export async function retryMwlCleanupNow(opts: { maxJobs?: number } = {}): Promise<{
  ran: number;
  succeeded: number;
  failed: number;
  requeuedStale: number;
}> {
  const handlers = { [MWL_WL_CLEANUP_JOB]: mwlWlCleanupHandler };
  const result = await runRadiologyJobTick(handlers, {
    maxJobs: opts.maxJobs ?? 20,
    workerId: "mwl-cleanup-manual",
  });
  let succeeded = 0;
  let failed = 0;
  for (const r of result.ran) {
    if (r.outcome === "success") succeeded += 1;
    else failed += 1;
  }
  return {
    ran: result.ran.length,
    succeeded,
    failed,
    requeuedStale: result.requeuedStale,
  };
}

/** Re-export for repair tooling. */
export { markJobRetryable };

/** Apply remove result after DB cancel — enqueue retry when unlink fails. */
export async function afterCancelEnsureWlRemoved(
  accessionNumber: string,
  removeResult: RemoveWorklistResult,
  context: Omit<MwlCleanupPayload, "accessionNumber" | "operation" | "terminalStatus">,
): Promise<{ wlRemoved: boolean; cleanupPending: boolean; jobId?: number }> {
  const decision = decideCleanupAfterRemove(removeResult);
  if (!decision.shouldEnqueue) {
    return { wlRemoved: decision.wlRemoved, cleanupPending: false };
  }
  const job = await enqueueMwlWlCleanup({
    accessionNumber,
    operation: "REMOVE_MWL",
    terminalStatus: "CANCELLED",
    ...context,
    reason: removeResult.outcome === "failed" ? removeResult.error : removeResult.outcome,
  });
  return {
    wlRemoved: false,
    cleanupPending: job.id > 0,
    jobId: job.id > 0 ? job.id : undefined,
  };
}
