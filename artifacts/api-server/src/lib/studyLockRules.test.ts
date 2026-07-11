import { describe, it, expect } from "vitest";
import {
  type LockRow, type LockActor,
  decideClaim, decideRefresh, decideRelease, canForceRelease,
  lockExpiresAt, isLockActive, writeBlockedByLock,
  DEFAULT_LOCK_TTL_SECONDS, LOCK_OVERRIDE_PERMISSION,
} from "./studyLockRules";

// Ticket M1.6A — the study-lock decision matrix, pure. The transactional
// service (studyLocks.ts) is a thin I/O shell over these rules; the
// SELECT-FOR-UPDATE race behavior is proven against real PostgreSQL in the
// M1.6A verification harness.

const NOW = new Date("2026-07-11T10:00:00Z");
const TTL = DEFAULT_LOCK_TTL_SECONDS; // 300s

const me: LockActor = { userId: 1, userName: "Dr. Asha Rao", role: "radiologist", permissions: ["/radiology", "/reports:sign"] };
const other: LockActor = { userId: 2, userName: "Dr. Vikram Iyer", role: "radiologist", permissions: ["/radiology"] };

const row = (over: Partial<LockRow> = {}): LockRow => ({
  id: 7, status: "REPORT_PENDING", patientId: 42, assignedRadiologist: null,
  lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null, lockWorkstation: null,
  ...over,
});

const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

const activeLock = (owner: LockActor) => row({
  lockUserId: owner.userId, lockUserName: owner.userName,
  lockTime: secondsAgo(120), lockLastActivityAt: secondsAgo(30),
});
const expiredLock = (owner: LockActor) => row({
  lockUserId: owner.userId, lockUserName: owner.userName,
  lockTime: secondsAgo(2000), lockLastActivityAt: secondsAgo(TTL + 60),
});

describe("expiry derivation", () => {
  it("unlocked rows have no expiry and are never active", () => {
    expect(lockExpiresAt(row(), TTL)).toBeNull();
    expect(isLockActive(row(), NOW, TTL)).toBe(false);
  });

  it("expiry anchors on lock_last_activity_at (heartbeat), falling back to lock_time", () => {
    const r = activeLock(me);
    expect(lockExpiresAt(r, TTL)?.getTime()).toBe(secondsAgo(30).getTime() + TTL * 1000);
    const noHeartbeat = row({ lockUserId: 1, lockTime: secondsAgo(60), lockLastActivityAt: null });
    expect(lockExpiresAt(noHeartbeat, TTL)?.getTime()).toBe(secondsAgo(60).getTime() + TTL * 1000);
  });

  it("a corrupt owner-without-timestamps row reads as expired (reclaimable), not active", () => {
    const corrupt = row({ lockUserId: 9, lockUserName: "ghost" });
    expect(lockExpiresAt(corrupt, TTL)).toBeNull();
    expect(isLockActive(corrupt, NOW, TTL)).toBe(false);
  });
});

describe("decideClaim", () => {
  it("missing row → NOT_FOUND; completed studies refuse new claims", () => {
    expect(decideClaim(null, me, NOW, TTL).outcome).toBe("NOT_FOUND");
    for (const status of ["REPORT_FINAL", "DELIVERED"]) {
      expect(decideClaim(row({ status }), me, NOW, TTL)).toEqual({ outcome: "COMPLETED", acquire: false, refreshOnly: false });
    }
  });

  it("first claim on a free study acquires", () => {
    expect(decideClaim(row(), me, NOW, TTL)).toEqual({ outcome: "CLAIMED", acquire: true, refreshOnly: false });
  });

  it("same user re-claim refreshes, never re-acquires", () => {
    expect(decideClaim(activeLock(me), me, NOW, TTL)).toEqual({ outcome: "ALREADY_OWNED", acquire: false, refreshOnly: true });
  });

  it("an ACTIVE foreign lock can never be stolen", () => {
    expect(decideClaim(activeLock(other), me, NOW, TTL)).toEqual({ outcome: "LOCKED_BY_OTHER", acquire: false, refreshOnly: false });
  });

  it("an EXPIRED lock is reclaimable — visibly (EXPIRED_AND_RECLAIMED)", () => {
    expect(decideClaim(expiredLock(other), me, NOW, TTL)).toEqual({ outcome: "EXPIRED_AND_RECLAIMED", acquire: true, refreshOnly: false });
    // even my own lapsed lock is a visible re-acquire, not a silent refresh
    expect(decideClaim(expiredLock(me), me, NOW, TTL)).toEqual({ outcome: "EXPIRED_AND_RECLAIMED", acquire: true, refreshOnly: false });
  });

  it("expiry boundary: exactly at expiry is NOT active", () => {
    const atBoundary = row({ lockUserId: 2, lockUserName: "x", lockTime: secondsAgo(TTL), lockLastActivityAt: secondsAgo(TTL) });
    expect(decideClaim(atBoundary, me, NOW, TTL).outcome).toBe("EXPIRED_AND_RECLAIMED");
  });
});

describe("decideRefresh (heartbeat)", () => {
  it("owner with an active lock refreshes", () => {
    expect(decideRefresh(activeLock(me), me, NOW, TTL)).toBe("REFRESHED");
  });
  it("my lock lapsed → EXPIRED (must re-claim, never silently extended)", () => {
    expect(decideRefresh(expiredLock(me), me, NOW, TTL)).toBe("EXPIRED");
  });
  it("someone else's active lock → LOCKED_BY_OTHER; free/foreign-expired → NOT_OWNED", () => {
    expect(decideRefresh(activeLock(other), me, NOW, TTL)).toBe("LOCKED_BY_OTHER");
    expect(decideRefresh(row(), me, NOW, TTL)).toBe("NOT_OWNED");
    expect(decideRefresh(expiredLock(other), me, NOW, TTL)).toBe("NOT_OWNED");
  });
  it("completed / missing rows classify first", () => {
    expect(decideRefresh(row({ status: "REPORT_FINAL" }), me, NOW, TTL)).toBe("COMPLETED");
    expect(decideRefresh(null, me, NOW, TTL)).toBe("NOT_FOUND");
  });
});

describe("decideRelease", () => {
  it("owner releases own lock (active or lapsed)", () => {
    expect(decideRelease(activeLock(me), me, NOW, TTL, { force: false })).toBe("RELEASED");
    expect(decideRelease(expiredLock(me), me, NOW, TTL, { force: false })).toBe("RELEASED");
  });
  it("unlocked → NOT_LOCKED; active foreign → LOCKED_BY_OTHER; expired foreign is clearable", () => {
    expect(decideRelease(row(), me, NOW, TTL, { force: false })).toBe("NOT_LOCKED");
    expect(decideRelease(activeLock(other), me, NOW, TTL, { force: false })).toBe("LOCKED_BY_OTHER");
    expect(decideRelease(expiredLock(other), me, NOW, TTL, { force: false })).toBe("RELEASED");
  });
  it("force requires the admin override gate", () => {
    expect(decideRelease(activeLock(other), me, NOW, TTL, { force: true })).toBe("FORBIDDEN");
    const admin: LockActor = { ...me, role: "admin" };
    expect(decideRelease(activeLock(other), admin, NOW, TTL, { force: true })).toBe("RELEASED");
    const granted: LockActor = { ...me, permissions: [...me.permissions, LOCK_OVERRIDE_PERMISSION] };
    expect(decideRelease(activeLock(other), granted, NOW, TTL, { force: true })).toBe("RELEASED");
  });
});

describe("canForceRelease", () => {
  it("full-access roles and the explicit grant pass; plain staff do not", () => {
    expect(canForceRelease({ ...me, role: "admin" })).toBe(true);
    expect(canForceRelease({ ...me, role: "Super Admin" })).toBe(true);
    expect(canForceRelease({ ...me, permissions: [LOCK_OVERRIDE_PERMISSION] })).toBe(true);
    expect(canForceRelease(me)).toBe(false);
    expect(canForceRelease({ ...me, role: "typist", permissions: [] })).toBe(false);
  });
});

describe("writeBlockedByLock (save/finalize server gate)", () => {
  it("no lock, my lock, or an expired foreign lock never blocks", () => {
    expect(writeBlockedByLock(row(), me.userId, NOW, TTL).blocked).toBe(false);
    expect(writeBlockedByLock(activeLock(me), me.userId, NOW, TTL).blocked).toBe(false);
    expect(writeBlockedByLock(expiredLock(other), me.userId, NOW, TTL).blocked).toBe(false);
  });
  it("an active foreign lock blocks, naming the owner", () => {
    expect(writeBlockedByLock(activeLock(other), me.userId, NOW, TTL)).toEqual({ blocked: true, lockedBy: "Dr. Vikram Iyer" });
  });
});
