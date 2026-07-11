/**
 * studyLocks.ts — Ticket M1.6A: the transactional study-lock service.
 *
 * All lock writes go through here: SELECT ... FOR UPDATE inside one
 * transaction makes claim/refresh/release race-safe (two simultaneous claims
 * serialize on the row lock — exactly one wins), the DECISIONS are the pure
 * rules in studyLockRules.ts, identity is always the server-side staff
 * session (never client-supplied), and every state change lands in the
 * hash-chained audit log.
 */

import { db } from "@workspace/db";
import { radiologyWorklistTable, pacsSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { auditLog } from "./audit";
import { getCached, setCached } from "./ttlCache";
import {
  type LockRow, type LockActor,
  type ClaimOutcome, type RefreshOutcome, type ReleaseOutcome,
  decideClaim, decideRefresh, decideRelease, canForceRelease,
  lockExpiresAt, writeBlockedByLock, DEFAULT_LOCK_TTL_SECONDS, LOCK_TTL_SETTING_KEY,
} from "./studyLockRules";

export type { LockActor } from "./studyLockRules";

const TTL_CACHE_KEY = "study-locks:ttl-seconds";

/** Configurable expiry with a safe default (pacs_settings, cached 30s). */
export async function getLockTtlSeconds(): Promise<number> {
  const cached = getCached<number>(TTL_CACHE_KEY);
  if (cached !== undefined) return cached;
  let ttl = DEFAULT_LOCK_TTL_SECONDS;
  try {
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, LOCK_TTL_SETTING_KEY))
      .limit(1);
    const parsed = Number(row?.value);
    if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 24 * 3600) ttl = Math.floor(parsed);
  } catch { /* settings unreadable → safe default */ }
  setCached(TTL_CACHE_KEY, ttl, 30_000);
  return ttl;
}

/** The lock state served to clients — expiry is server-computed so no client
 *  ever derives it from its own clock + guessed TTL. */
export interface StudyLockView {
  worklistId: number;
  status: string;
  patientId: number | null;
  assignedRadiologist: string | null;
  lockUserId: number | null;
  lockUserName: string | null;
  lockTime: string | null;
  lockLastActivityAt: string | null;
  lockExpiresAt: string | null;
  lockTtlSeconds: number;
}

function viewOf(row: LockRow, ttlSeconds: number): StudyLockView {
  return {
    worklistId: row.id,
    status: row.status,
    patientId: row.patientId,
    assignedRadiologist: row.assignedRadiologist,
    lockUserId: row.lockUserId,
    lockUserName: row.lockUserName,
    lockTime: row.lockTime?.toISOString() ?? null,
    lockLastActivityAt: row.lockLastActivityAt?.toISOString() ?? null,
    lockExpiresAt: lockExpiresAt(row, ttlSeconds)?.toISOString() ?? null,
    lockTtlSeconds: ttlSeconds,
  };
}

const LOCK_COLUMNS = {
  id: radiologyWorklistTable.id,
  status: radiologyWorklistTable.status,
  patientId: radiologyWorklistTable.patientId,
  assignedRadiologist: radiologyWorklistTable.assignedRadiologist,
  lockUserId: radiologyWorklistTable.lockUserId,
  lockUserName: radiologyWorklistTable.lockUserName,
  lockTime: radiologyWorklistTable.lockTime,
  lockLastActivityAt: radiologyWorklistTable.lockLastActivityAt,
  lockWorkstation: radiologyWorklistTable.lockWorkstation,
} as const;

function audit(actor: LockActor, action: string, worklistId: number, detail: Record<string, unknown>): void {
  // Fire-and-forget: the lock state change is already committed; an audit
  // hiccup must not turn a successful claim into a failed request. auditLog
  // itself never throws (it catches internally), this guards the promise.
  void auditLog({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action,
    module: "radiology",
    entityType: "radiology_worklist",
    entityId: String(worklistId),
    oldValue: null,
    newValue: JSON.stringify(detail),
    reason: typeof detail.reason === "string" ? detail.reason : null,
  });
}

export interface ClaimResult { outcome: ClaimOutcome; lock: StudyLockView | null }

/** Atomic claim. Same user refreshes; expired foreign locks are visibly
 *  reclaimed; active foreign locks are never stolen. */
export async function claimStudy(worklistId: number, actor: LockActor, workstation?: string | null): Promise<ClaimResult> {
  const ttl = await getLockTtlSeconds();
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx.select(LOCK_COLUMNS).from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId)).for("update");
    const decision = decideClaim((row as LockRow | undefined) ?? null, actor, now, ttl);
    if (decision.refreshOnly && row) {
      await tx.update(radiologyWorklistTable)
        .set({ lockLastActivityAt: now })
        .where(eq(radiologyWorklistTable.id, worklistId));
      return { outcome: decision.outcome, lock: viewOf({ ...(row as LockRow), lockLastActivityAt: now }, ttl) };
    }
    if (decision.acquire && row) {
      const previousOwner = (row as LockRow).lockUserName;
      await tx.update(radiologyWorklistTable)
        .set({
          lockUserId: actor.userId,
          lockUserName: actor.userName,
          lockTime: now,
          lockLastActivityAt: now,
          lockWorkstation: workstation?.slice(0, 120) ?? null,
        })
        .where(eq(radiologyWorklistTable.id, worklistId));
      audit(actor, decision.outcome === "EXPIRED_AND_RECLAIMED" ? "study_lock_reclaimed_expired" : "study_lock_claimed",
        worklistId, { previousOwner, workstation: workstation ?? null });
      return {
        outcome: decision.outcome,
        lock: viewOf({ ...(row as LockRow), lockUserId: actor.userId, lockUserName: actor.userName, lockTime: now, lockLastActivityAt: now }, ttl),
      };
    }
    return { outcome: decision.outcome, lock: row ? viewOf(row as LockRow, ttl) : null };
  });
}

export interface RefreshResult { outcome: RefreshOutcome; lock: StudyLockView | null }

/** Heartbeat: bump lock_last_activity_at, owner only, active lock only. */
export async function refreshStudyLock(worklistId: number, actor: LockActor): Promise<RefreshResult> {
  const ttl = await getLockTtlSeconds();
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx.select(LOCK_COLUMNS).from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId)).for("update");
    const outcome = decideRefresh((row as LockRow | undefined) ?? null, actor, now, ttl);
    if (outcome === "REFRESHED" && row) {
      await tx.update(radiologyWorklistTable)
        .set({ lockLastActivityAt: now })
        .where(eq(radiologyWorklistTable.id, worklistId));
      return { outcome, lock: viewOf({ ...(row as LockRow), lockLastActivityAt: now }, ttl) };
    }
    return { outcome, lock: row ? viewOf(row as LockRow, ttl) : null };
  });
}

export interface ReleaseResult { outcome: ReleaseOutcome; lock: StudyLockView | null }

/** Owner release (or clearing an expired foreign lock). `force` is the
 *  audited admin override — permission-gated in the rules. */
export async function releaseStudy(
  worklistId: number,
  actor: LockActor,
  opts: { force?: boolean; reason?: string | null } = {},
): Promise<ReleaseResult> {
  const ttl = await getLockTtlSeconds();
  const now = new Date();
  const force = opts.force === true;
  return db.transaction(async (tx) => {
    const [row] = await tx.select(LOCK_COLUMNS).from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId)).for("update");
    const outcome = decideRelease((row as LockRow | undefined) ?? null, actor, now, ttl, { force });
    if (outcome === "RELEASED" && row) {
      const prior = row as LockRow;
      await tx.update(radiologyWorklistTable)
        .set({ lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null, lockWorkstation: null })
        .where(eq(radiologyWorklistTable.id, worklistId));
      const wasForeign = prior.lockUserId !== actor.userId;
      audit(
        actor,
        force && wasForeign ? "study_lock_force_released" : "study_lock_released",
        worklistId,
        { previousOwner: prior.lockUserName, previousOwnerId: prior.lockUserId, forced: force && wasForeign, reason: opts.reason ?? null },
      );
      return { outcome, lock: viewOf({ ...prior, lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null, lockWorkstation: null }, ttl) };
    }
    return { outcome, lock: row ? viewOf(row as LockRow, ttl) : null };
  });
}

/** Admin override — separate entry point so routes can't reach force by
 *  accident; the permission gate lives in the rules (canForceRelease). */
export async function forceReleaseStudy(worklistId: number, actor: LockActor, reason: string | null): Promise<ReleaseResult> {
  if (!canForceRelease(actor)) return { outcome: "FORBIDDEN", lock: null };
  return releaseStudy(worklistId, actor, { force: true, reason });
}

/** Read-only lock view. */
export async function getStudyLock(worklistId: number): Promise<StudyLockView | null> {
  const ttl = await getLockTtlSeconds();
  const [row] = await db.select(LOCK_COLUMNS).from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId)).limit(1);
  return row ? viewOf(row as LockRow, ttl) : null;
}

/**
 * Write-path gate (Phase 7): should a draft save / finalize flip by `userId`
 * be refused because ANOTHER user holds an ACTIVE lock? Unlocked, own, or
 * expired locks never block — flows that don't participate in locking keep
 * working exactly as before when nobody holds a lock.
 */
export async function checkWriteLock(worklistId: number, userId: number): Promise<{ blocked: boolean; lockedBy: string | null }> {
  const ttl = await getLockTtlSeconds();
  const [row] = await db.select(LOCK_COLUMNS).from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId)).limit(1);
  if (!row) return { blocked: false, lockedBy: null };
  return writeBlockedByLock(row as LockRow, userId, new Date(), ttl);
}

/** Completed studies hold no locks: clear on the REPORT_FINAL/DELIVERED flip
 *  (release-on-finalize is server-authoritative, not a client courtesy). */
export async function clearLockOnCompletion(worklistId: number): Promise<void> {
  await db.update(radiologyWorklistTable)
    .set({ lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null, lockWorkstation: null })
    .where(eq(radiologyWorklistTable.id, worklistId));
}
