/**
 * Overnight AI Draft display-status mapper.
 *
 * Worklist `ai_draft_status` only stores NONE | PENDING | READY | ERROR.
 * PENDING is set at enqueue (markWorklistPending) and covers queued, running,
 * retrying, and failed-but-not-abandoned — so the worklist column alone cannot
 * tell a radiologist whether Ollama is actually processing a case.
 *
 * Canonical job state lives on dicom_retry_queue (ai_shadow_pipeline):
 * pending | retrying | running | success | failed | abandoned, plus
 * created_at / started_at / completed_at / last_attempted_at / locked_at.
 *
 * This module derives QUEUED vs RUNNING vs STUCK from those fields.
 * It does not invent a new queue.
 */
import { isStaleRunning, type RadiologyJobStatus } from "../radiologyJobRules";

export const OVERNIGHT_STALE_RUNNING_MS = 10 * 60_000;

export type OvernightDisplayStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRYING"
  | "READY"
  | "ERROR"
  | "STUCK"
  | "NONE";

export interface OvernightJobSnapshot {
  jobId: number | null;
  jobStatus: string | null;
  queuedAt: Date | string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  lastAttemptAt: Date | string | null;
  attemptCount: number;
  lastError: string | null;
  lockedAt: Date | string | null;
  lockedBy: string | null;
}

export interface OvernightDisplay {
  displayStatus: OvernightDisplayStatus;
  jobId: number | null;
  jobStatus: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  lastError: string | null;
  queuePosition: number | null;
  stale: boolean;
  canCancel: boolean;
  canRetry: boolean;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function canCancelOvernightJob(jobStatus: string | null | undefined): boolean {
  const s = (jobStatus ?? "").toLowerCase();
  return s === "pending" || s === "retrying";
}

export function canRetryOvernightJob(displayStatus: OvernightDisplayStatus): boolean {
  return displayStatus === "ERROR";
}

/**
 * Derive radiologist-facing status from worklist + latest shadow job.
 *
 * Priority: an in-flight job (running / pending / retrying / stale running)
 * wins over a READY worklist row (explicit retry). READY wins over a leftover
 * success job. Abandoned/failed jobs surface as ERROR even if the worklist
 * was left PENDING (overnight currently does not always write ERROR).
 */
export function deriveOvernightDisplayStatus(input: {
  worklistAiDraftStatus: string | null | undefined;
  jobStatus: string | null | undefined;
  lockedAt: Date | string | null | undefined;
  now?: Date;
  staleMs?: number;
}): OvernightDisplayStatus {
  const job = (input.jobStatus ?? "").toLowerCase() as RadiologyJobStatus | "";
  const now = input.now ?? new Date();
  const staleMs = input.staleMs ?? OVERNIGHT_STALE_RUNNING_MS;
  const lockedAt = toDate(input.lockedAt ?? null);

  if (job === "running") {
    if (isStaleRunning({ status: "running", lockedAt, now, staleMs })) return "STUCK";
    return "RUNNING";
  }
  if (job === "retrying") return "RETRYING";
  if (job === "pending") return "QUEUED";

  const wl = (input.worklistAiDraftStatus ?? "NONE").toUpperCase();
  if (wl === "READY" || job === "success") return "READY";
  if (job === "failed" || job === "abandoned" || wl === "ERROR") return "ERROR";
  if (wl === "PENDING") return "QUEUED";
  return "NONE";
}

export function buildOvernightDisplay(input: {
  worklistAiDraftStatus: string | null | undefined;
  job: OvernightJobSnapshot | null;
  queuePosition?: number | null;
  now?: Date;
  staleMs?: number;
}): OvernightDisplay {
  const job = input.job;
  const displayStatus = deriveOvernightDisplayStatus({
    worklistAiDraftStatus: input.worklistAiDraftStatus,
    jobStatus: job?.jobStatus,
    lockedAt: job?.lockedAt,
    now: input.now,
    staleMs: input.staleMs,
  });
  return {
    displayStatus,
    jobId: job?.jobId ?? null,
    jobStatus: job?.jobStatus ?? null,
    queuedAt: toIso(job?.queuedAt),
    startedAt: toIso(job?.startedAt),
    completedAt: toIso(job?.completedAt),
    lastAttemptAt: toIso(job?.lastAttemptAt),
    attemptCount: job?.attemptCount ?? 0,
    lastError: job?.lastError ?? null,
    queuePosition: displayStatus === "QUEUED" || displayStatus === "RETRYING"
      ? input.queuePosition ?? null
      : null,
    stale: displayStatus === "STUCK",
    canCancel: canCancelOvernightJob(job?.jobStatus),
    canRetry: canRetryOvernightJob(displayStatus),
  };
}

/** Lower rank sorts first in the Overnight AI Drafts view. */
export function overnightSortRank(status: OvernightDisplayStatus): number {
  switch (status) {
    case "RUNNING":
      return 0;
    case "READY":
      return 1;
    case "ERROR":
    case "STUCK":
      return 2;
    case "QUEUED":
    case "RETRYING":
      return 3;
    default:
      return 4;
  }
}

export interface OvernightSortRow {
  displayStatus: OvernightDisplayStatus;
  completedAt: string | null;
  startedAt: string | null;
  lastAttemptAt: string | null;
  queuePosition: number | null;
  queuedAt: string | null;
  jobId: number | null;
  createdAt?: string | null;
}

function ts(v: string | null | undefined): number {
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Overnight-only sort: RUNNING, then READY (newest completed first), then
 * ERROR/STUCK, then QUEUED/RETRYING in canonical FIFO (queue position / job id).
 */
export function compareOvernightDraftRows(a: OvernightSortRow, b: OvernightSortRow): number {
  const rank = overnightSortRank(a.displayStatus) - overnightSortRank(b.displayStatus);
  if (rank !== 0) return rank;
  switch (a.displayStatus) {
    case "READY":
      return ts(b.completedAt) - ts(a.completedAt) || ts(b.createdAt) - ts(a.createdAt);
    case "RUNNING":
      return ts(b.startedAt) - ts(a.startedAt);
    case "ERROR":
    case "STUCK":
      return ts(b.lastAttemptAt) - ts(a.lastAttemptAt);
    case "QUEUED":
    case "RETRYING": {
      const pa = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
      const pb = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const ida = a.jobId ?? Number.MAX_SAFE_INTEGER;
      const idb = b.jobId ?? Number.MAX_SAFE_INTEGER;
      if (ida !== idb) return ida - idb;
      return ts(a.queuedAt) - ts(b.queuedAt);
    }
    default:
      return ts(b.createdAt) - ts(a.createdAt);
  }
}

export function overnightCountBucket(status: OvernightDisplayStatus): "queued" | "running" | "ready" | "errors" | null {
  switch (status) {
    case "QUEUED":
    case "RETRYING":
      return "queued";
    case "RUNNING":
      return "running";
    case "READY":
      return "ready";
    case "ERROR":
    case "STUCK":
      return "errors";
    default:
      return null;
  }
}

/** Prefer in-flight jobs over terminal ones when several rows exist for one UID. */
export function shadowJobFreshnessRank(status: string | null | undefined): number {
  switch ((status ?? "").toLowerCase()) {
    case "running":
      return 0;
    case "pending":
      return 1;
    case "retrying":
      return 2;
    case "abandoned":
    case "failed":
      return 3;
    case "success":
      return 4;
    default:
      return 5;
  }
}
