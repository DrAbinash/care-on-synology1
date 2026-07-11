/**
 * studyLockRules.ts — Ticket M1.6A: the study-lock decision rules, PURE.
 *
 * Everything that decides a claim/refresh/release outcome lives here with no
 * DB, no clock, no session — the transactional service (studyLocks.ts) feeds
 * it the row it read under SELECT ... FOR UPDATE plus the server-derived
 * actor and `now`. Exhaustively unit-testable; the service owns only I/O.
 *
 * Lock model (columns on radiology_worklist):
 *   lock_user_id / lock_user_name  — owner (server-derived, never client-sent)
 *   lock_time                      — acquired at
 *   lock_last_activity_at          — heartbeat; EXPIRY = this + TTL
 *   lock_workstation               — informational label only
 * A lock with no heartbeat within the TTL is EXPIRED and reclaimable —
 * browser close cannot be trusted, so expiry is authoritative.
 */

export const DEFAULT_LOCK_TTL_SECONDS = 300;
/** pacs_settings key that overrides the TTL (seconds). */
export const LOCK_TTL_SETTING_KEY = "radiology_lock_ttl_seconds";
/** Permission granting non-admin staff the force-release (admin override). */
export const LOCK_OVERRIDE_PERMISSION = "/radiology:lock-override";

/** Worklist statuses on which a NEW claim is refused (report already done). */
export const LOCK_COMPLETED_STATUSES: ReadonlySet<string> = new Set(["REPORT_FINAL", "DELIVERED"]);

export interface LockRow {
  id: number;
  status: string;
  patientId: number | null;
  assignedRadiologist: string | null;
  lockUserId: number | null;
  lockUserName: string | null;
  lockTime: Date | null;
  lockLastActivityAt: Date | null;
  lockWorkstation: string | null;
}

export interface LockActor {
  userId: number;
  userName: string;
  role: string;
  permissions: string[];
}

export function lockTtlMs(ttlSeconds: number): number {
  return (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_LOCK_TTL_SECONDS) * 1000;
}

/** The instant a lock stops being authoritative (null when unlocked). */
export function lockExpiresAt(row: Pick<LockRow, "lockUserId" | "lockTime" | "lockLastActivityAt">, ttlSeconds: number): Date | null {
  if (row.lockUserId == null) return null;
  const anchor = row.lockLastActivityAt ?? row.lockTime;
  if (!anchor) return null; // corrupt row: owner without timestamps → treated as expired
  return new Date(anchor.getTime() + lockTtlMs(ttlSeconds));
}

export function isLockActive(row: Pick<LockRow, "lockUserId" | "lockTime" | "lockLastActivityAt">, now: Date, ttlSeconds: number): boolean {
  const expires = lockExpiresAt(row, ttlSeconds);
  return expires !== null && expires.getTime() > now.getTime();
}

/** Admin override gate: full-access roles or the explicit override grant. */
export function canForceRelease(actor: LockActor): boolean {
  const role = actor.role.toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (role === "admin" || role === "super_admin" || role === "superadmin" || role === "owner" || role === "super") return true;
  return actor.permissions.includes(LOCK_OVERRIDE_PERMISSION);
}

// ─── Claim ───────────────────────────────────────────────────────────────────

export type ClaimOutcome =
  | "CLAIMED"
  | "ALREADY_OWNED"
  | "LOCKED_BY_OTHER"
  | "EXPIRED_AND_RECLAIMED"
  | "COMPLETED"
  | "NOT_FOUND";

export interface ClaimDecision {
  outcome: ClaimOutcome;
  /** True when the service must write the actor's lock onto the row. */
  acquire: boolean;
  /** True when the service must only bump lock_last_activity_at. */
  refreshOnly: boolean;
}

export function decideClaim(row: LockRow | null, actor: LockActor, now: Date, ttlSeconds: number): ClaimDecision {
  if (!row) return { outcome: "NOT_FOUND", acquire: false, refreshOnly: false };
  if (LOCK_COMPLETED_STATUSES.has(row.status)) return { outcome: "COMPLETED", acquire: false, refreshOnly: false };
  const active = isLockActive(row, now, ttlSeconds);
  if (active && row.lockUserId === actor.userId) {
    // Same user refreshing their own lock — never a new acquisition.
    return { outcome: "ALREADY_OWNED", acquire: false, refreshOnly: true };
  }
  if (active) return { outcome: "LOCKED_BY_OTHER", acquire: false, refreshOnly: false };
  if (row.lockUserId != null) {
    // Somebody held it but the heartbeat lapsed — reclaimable, and the
    // outcome says so explicitly so the takeover is visible and auditable.
    return { outcome: "EXPIRED_AND_RECLAIMED", acquire: true, refreshOnly: false };
  }
  return { outcome: "CLAIMED", acquire: true, refreshOnly: false };
}

// ─── Heartbeat / refresh ─────────────────────────────────────────────────────

export type RefreshOutcome = "REFRESHED" | "NOT_OWNED" | "LOCKED_BY_OTHER" | "EXPIRED" | "COMPLETED" | "NOT_FOUND";

export function decideRefresh(row: LockRow | null, actor: LockActor, now: Date, ttlSeconds: number): RefreshOutcome {
  if (!row) return "NOT_FOUND";
  if (LOCK_COMPLETED_STATUSES.has(row.status)) return "COMPLETED";
  const active = isLockActive(row, now, ttlSeconds);
  if (active && row.lockUserId === actor.userId) return "REFRESHED";
  if (active) return "LOCKED_BY_OTHER";
  if (row.lockUserId === actor.userId) return "EXPIRED"; // my lock lapsed — must re-claim, not silently refresh
  return "NOT_OWNED";
}

// ─── Release ─────────────────────────────────────────────────────────────────

export type ReleaseOutcome = "RELEASED" | "NOT_LOCKED" | "LOCKED_BY_OTHER" | "FORBIDDEN" | "NOT_FOUND";

export function decideRelease(
  row: LockRow | null,
  actor: LockActor,
  now: Date,
  ttlSeconds: number,
  opts: { force: boolean },
): ReleaseOutcome {
  if (!row) return "NOT_FOUND";
  if (row.lockUserId == null) return "NOT_LOCKED";
  if (opts.force) {
    return canForceRelease(actor) ? "RELEASED" : "FORBIDDEN";
  }
  // Owners may always release their own lock, active or lapsed; an EXPIRED
  // foreign lock may also be cleared by whoever notices (it holds nothing).
  if (row.lockUserId === actor.userId) return "RELEASED";
  return isLockActive(row, now, ttlSeconds) ? "LOCKED_BY_OTHER" : "RELEASED";
}

// ─── Write-path enforcement (save/finalize, Phase 7) ─────────────────────────

/**
 * Whether a write (draft save / finalize status flip) by `actor` must be
 * refused because another user holds an ACTIVE lock. No lock, my lock, or an
 * expired lock never blocks — pages and automations that don't participate
 * in locking keep working exactly as before when nobody holds a lock.
 */
export function writeBlockedByLock(
  row: Pick<LockRow, "lockUserId" | "lockUserName" | "lockTime" | "lockLastActivityAt">,
  actorUserId: number,
  now: Date,
  ttlSeconds: number,
): { blocked: boolean; lockedBy: string | null } {
  if (row.lockUserId == null || row.lockUserId === actorUserId) return { blocked: false, lockedBy: null };
  if (!isLockActive(row, now, ttlSeconds)) return { blocked: false, lockedBy: null };
  return { blocked: true, lockedBy: row.lockUserName ?? `user #${row.lockUserId}` };
}
