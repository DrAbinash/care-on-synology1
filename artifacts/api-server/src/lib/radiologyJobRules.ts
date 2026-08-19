/**
 * radiologyJobRules.ts — Ticket BEND-1 Phase 3, pure.
 *
 * State rules for the durable radiology job runner over dicom_retry_queue.
 * The table already had retry columns (retry_count, max_retries,
 * next_retry_at, status pending|retrying|success|failed|abandoned) but no
 * worker; BEND-1 adds "running" plus lock/idempotency columns and THESE
 * transition rules, exhaustively unit-tested.
 */

export type RadiologyJobStatus =
  | "pending" | "retrying" | "running" | "success" | "failed" | "abandoned";

/** Statuses a worker may claim (with next_retry_at due). */
export const CLAIMABLE_STATUSES: ReadonlySet<RadiologyJobStatus> = new Set(["pending", "retrying"]);

/** Dead-letter = abandoned: retries exhausted, visible, never auto-retried. */
export const DEAD_LETTER_STATUS: RadiologyJobStatus = "abandoned";

/** Exponential backoff with a hard cap — never a tight retry loop. */
export function computeBackoffMs(retryCount: number): number {
  const base = 60_000; // 1 minute
  const capped = Math.min(retryCount, 6); // 2^6 → max 64 min
  return base * 2 ** capped;
}

/** Failures that will not succeed on retry (bad payload, or DICOM never arriving). */
export function isPermanentShadowFailure(error: string): boolean {
  const e = error.toLowerCase();
  return e.includes("invalid payload: studyinstanceuid required")
    || e.includes("no dicom instances found");
}

/** After a failed attempt: bounded retries, then dead-letter. NEVER an
 *  infinite retry — maxRetries is a hard ceiling.
 *  Permanently invalid studies stop quickly so they cannot occupy the single
 *  AI claim slot for hours while tonight's MRI waits. */
export function decideFailure(args: {
  retryCount: number;   // attempts already recorded BEFORE this failure
  maxRetries: number;
  now: Date;
  error?: string | null;
}): { status: RadiologyJobStatus; retryCount: number; nextRetryAt: Date | null } {
  const retryCount = args.retryCount + 1;
  const err = args.error ?? "";
  const ceiling = /invalid payload: studyinstanceuid required/i.test(err)
    ? 1
    : /no dicom instances found/i.test(err)
      ? Math.min(2, Math.max(1, args.maxRetries))
      : Math.max(1, args.maxRetries);
  if (retryCount >= ceiling) {
    return { status: "abandoned", retryCount, nextRetryAt: null };
  }
  return {
    status: "retrying",
    retryCount,
    nextRetryAt: new Date(args.now.getTime() + computeBackoffMs(retryCount)),
  };
}

/** A "running" job whose lock is older than the stale window belongs to a
 *  worker that died/restarted — requeue it. Handlers must therefore be
 *  idempotent; external-send handlers re-check their subject's state before
 *  acting (see radiologyJobHandlers), so a requeue never double-sends. */
export function isStaleRunning(args: {
  status: RadiologyJobStatus;
  lockedAt: Date | null;
  now: Date;
  staleMs?: number;
}): boolean {
  if (args.status !== "running") return false;
  if (!args.lockedAt) return true; // running without a lock stamp is corrupt → requeue
  return args.now.getTime() - args.lockedAt.getTime() > (args.staleMs ?? 10 * 60_000);
}

/** Manual dead-letter retry (repair tool): abandoned → retrying, due now. */
export function decideDeadLetterRetry(current: RadiologyJobStatus, now: Date):
  { status: RadiologyJobStatus; nextRetryAt: Date } | null {
  if (current !== "abandoned" && current !== "failed") return null;
  return { status: "retrying", nextRetryAt: now };
}
