/**
 * studyLockState.ts — Ticket M1.6A: the workspace-side study-lock and
 * assignment rules, PURE (same pattern as workspaceReportState.ts /
 * reportingWorkflow.ts). The hook (useStudyLock) and the workflow controller
 * wire these to React; the SERVER remains authoritative for every decision —
 * these rules only drive display and pre-flight UX.
 *
 * Lock expiry always comes from the server (`lockExpiresAt`, computed as
 * lock_last_activity_at + configured TTL) — no client ever derives expiry
 * from its own clock plus a guessed window.
 */

// ─── Lock display state ──────────────────────────────────────────────────────

/** Lock fields as served by the pacs-worklist rows and the lock endpoints. */
export interface LockInfo {
  lockUserId?: number | null;
  lockUserName?: string | null;
  lockTime?: string | null;
  lockLastActivityAt?: string | null;
  lockExpiresAt?: string | null;
}

export type LockDisplayState = "unlocked" | "mine" | "other" | "expired";

export function lockStateFor(lock: LockInfo | null | undefined, myUserId: number | null, nowMs: number): LockDisplayState {
  if (!lock || lock.lockUserId == null) return "unlocked";
  const expires = lock.lockExpiresAt ? new Date(lock.lockExpiresAt).getTime() : NaN;
  const active = Number.isFinite(expires) && expires > nowMs;
  if (!active) return "expired";
  return lock.lockUserId === myUserId ? "mine" : "other";
}

export function isRowLockedByOther(lock: LockInfo | null | undefined, myUserId: number | null, nowMs: number): boolean {
  return lockStateFor(lock, myUserId, nowMs) === "other";
}

/** The workspace status messages (Phase 5) — one place, exact wording. */
export function lockStatusMessage(
  status: "idle" | "claiming" | "mine" | "locked-by-other" | "expired-lost" | "completed" | "connection-lost",
  ownerName: string | null,
): string {
  switch (status) {
    case "claiming": return "Claiming study…";
    case "mine": return "Claimed by you";
    case "locked-by-other": return `Locked by ${ownerName ?? "another user"}`;
    case "expired-lost": return "Lock expired — reclaim to continue";
    case "completed": return "Report completed — no claim needed";
    case "connection-lost": return "Connection lost — lock may expire";
    default: return "";
  }
}

// ─── Assignment-aware queue (Phase 6 / M1.6B1) ───────────────────────────────

/** Static scopes + the dynamic "By Radiologist" scope (`rad:<staffId>`). */
export type QueueScope = "all" | "mine" | "unassigned" | "pool" | `rad:${number}`;

export const QUEUE_SCOPE_LABELS: Record<"all" | "mine" | "unassigned" | "pool", string> = {
  all: "All permitted",
  mine: "My Studies",
  unassigned: "Unassigned",
  pool: "Department Pool",
};

export function parseQueueScope(raw: string | null | undefined): QueueScope {
  if (raw === "mine" || raw === "unassigned" || raw === "pool" || raw === "all") return raw;
  if (raw && /^rad:\d+$/.test(raw)) return raw as QueueScope;
  return "all";
}

export function scopeRadiologistId(scope: QueueScope): number | null {
  const m = /^rad:(\d+)$/.exec(scope);
  return m ? Number(m[1]) : null;
}

export interface AssignableRow {
  assignedRadiologist?: string | null;
  /** M1.6B1 — canonical id-based assignment; the name stays the legacy mirror. */
  assignedRadiologistId?: number | null;
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export type AssignmentCategory = "mine" | "unassigned" | "other";

/** Assignment semantics: the stable staff ID is canonical when both sides
 *  have one; the legacy NAME mirror (trimmed, case-insensitive) covers
 *  pre-M1.6B1 rows. Never patient-name based; this is the RADIOLOGIST. */
export function assignmentCategoryOf(row: AssignableRow, myName: string | null, myUserId?: number | null): AssignmentCategory {
  if (row.assignedRadiologistId != null) {
    return myUserId != null && row.assignedRadiologistId === myUserId ? "mine" : "other";
  }
  const assigned = normalizeName(row.assignedRadiologist);
  if (!assigned) return "unassigned";
  return myName != null && assigned === normalizeName(myName) ? "mine" : "other";
}

/**
 * Queue scope filter:
 *   mine       — assigned to me
 *   unassigned — no assigned radiologist
 *   pool       — the department pot I could pick from (unassigned + assigned
 *                to others); my own assignments live under "mine"
 *   rad:<id>   — assigned to that specific radiologist (id-based only)
 *   all        — everything this account is permitted to see
 */
export function rowInScope(row: AssignableRow, scope: QueueScope, myName: string | null, myUserId?: number | null): boolean {
  const byRad = scopeRadiologistId(scope);
  if (byRad != null) return row.assignedRadiologistId === byRad;
  const category = assignmentCategoryOf(row, myName, myUserId);
  switch (scope) {
    case "mine": return category === "mine";
    case "unassigned": return category === "unassigned";
    case "pool": return category !== "mine";
    default: return true;
  }
}

export function filterQueueByScope<T extends AssignableRow>(queue: T[], scope: QueueScope, myName: string | null, myUserId?: number | null): T[] {
  if (scope === "all") return queue;
  return queue.filter((row) => rowInScope(row, scope, myName, myUserId));
}

/** Next-study preference tiers (Phase 6): assigned-to-me first, then
 *  unassigned/claimable, then other-assigned pool studies. */
export function assignmentPreferenceTier(row: AssignableRow, myName: string | null, myUserId?: number | null): 0 | 1 | 2 {
  const category = assignmentCategoryOf(row, myName, myUserId);
  return category === "mine" ? 0 : category === "unassigned" ? 1 : 2;
}
