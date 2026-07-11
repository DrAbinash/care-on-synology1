import { describe, it, expect } from "vitest";
import {
  lockStateFor, isRowLockedByOther, lockStatusMessage,
  assignmentCategoryOf, rowInScope, filterQueueByScope, assignmentPreferenceTier,
  parseQueueScope, scopeRadiologistId,
  type LockInfo, type QueueScope,
} from "./studyLockState";

// Ticket M1.6A — workspace-side lock display + assignment-scope rules, pure.

const NOW = new Date("2026-07-11T10:00:00Z").getTime();
const inFuture = new Date(NOW + 60_000).toISOString();
const inPast = new Date(NOW - 60_000).toISOString();

describe("lockStateFor / isRowLockedByOther", () => {
  it("uses ONLY the server-computed expiry — never a client-derived window", () => {
    const mine: LockInfo = { lockUserId: 1, lockUserName: "Me", lockExpiresAt: inFuture };
    const theirs: LockInfo = { lockUserId: 2, lockUserName: "Them", lockExpiresAt: inFuture };
    const lapsed: LockInfo = { lockUserId: 2, lockUserName: "Them", lockExpiresAt: inPast };
    expect(lockStateFor(null, 1, NOW)).toBe("unlocked");
    expect(lockStateFor({ lockUserId: null }, 1, NOW)).toBe("unlocked");
    expect(lockStateFor(mine, 1, NOW)).toBe("mine");
    expect(lockStateFor(theirs, 1, NOW)).toBe("other");
    expect(lockStateFor(lapsed, 1, NOW)).toBe("expired");
    // owner without expiry data → treated as expired, never as active
    expect(lockStateFor({ lockUserId: 2 }, 1, NOW)).toBe("expired");
    expect(isRowLockedByOther(theirs, 1, NOW)).toBe(true);
    expect(isRowLockedByOther(mine, 1, NOW)).toBe(false);
    expect(isRowLockedByOther(lapsed, 1, NOW)).toBe(false);
  });
});

describe("lockStatusMessage", () => {
  it("exact workspace wording (Phase 5)", () => {
    expect(lockStatusMessage("mine", null)).toBe("Claimed by you");
    expect(lockStatusMessage("locked-by-other", "Dr. X")).toBe("Locked by Dr. X");
    expect(lockStatusMessage("locked-by-other", null)).toBe("Locked by another user");
    expect(lockStatusMessage("expired-lost", null)).toBe("Lock expired — reclaim to continue");
    expect(lockStatusMessage("connection-lost", null)).toBe("Connection lost — lock may expire");
  });
});

describe("assignment categories + scopes (Phase 6)", () => {
  const ME = "Dr. Asha Rao";
  it("assignment matches the RADIOLOGIST name, trimmed and case-insensitive", () => {
    expect(assignmentCategoryOf({ assignedRadiologist: " dr. asha rao " }, ME)).toBe("mine");
    expect(assignmentCategoryOf({ assignedRadiologist: "Dr. Vikram Iyer" }, ME)).toBe("other");
    expect(assignmentCategoryOf({ assignedRadiologist: "" }, ME)).toBe("unassigned");
    expect(assignmentCategoryOf({ assignedRadiologist: null }, ME)).toBe("unassigned");
    expect(assignmentCategoryOf({ assignedRadiologist: "Dr. Asha Rao" }, null)).toBe("other");
  });

  const rows = [
    { id: 1, assignedRadiologist: "Dr. Asha Rao" },
    { id: 2, assignedRadiologist: null },
    { id: 3, assignedRadiologist: "Dr. Vikram Iyer" },
  ];

  it("scope semantics: mine / unassigned / pool / all", () => {
    const ids = (scope: QueueScope) => filterQueueByScope(rows, scope, ME).map((r) => r.id);
    expect(ids("mine")).toEqual([1]);
    expect(ids("unassigned")).toEqual([2]);
    expect(ids("pool")).toEqual([2, 3]); // the shared pot: everything not mine
    expect(ids("all")).toEqual([1, 2, 3]);
    expect(rowInScope(rows[0], "pool", ME)).toBe(false);
  });

  it("next-study preference tiers: mine → unassigned → other-assigned", () => {
    expect(assignmentPreferenceTier(rows[0], ME)).toBe(0);
    expect(assignmentPreferenceTier(rows[1], ME)).toBe(1);
    expect(assignmentPreferenceTier(rows[2], ME)).toBe(2);
  });
});

describe("M1.6B1 — id-based assignment + By-Radiologist scope", () => {
  it("the stable staff ID is canonical when present; the name mirror covers legacy rows", () => {
    // id disagreeing with the name: the ID wins.
    expect(assignmentCategoryOf({ assignedRadiologistId: 7, assignedRadiologist: "Dr. Asha Rao" }, "Dr. Asha Rao", 1)).toBe("other");
    expect(assignmentCategoryOf({ assignedRadiologistId: 1, assignedRadiologist: "someone else" }, "Dr. Asha Rao", 1)).toBe("mine");
    // legacy name-only row still matches by name.
    expect(assignmentCategoryOf({ assignedRadiologist: "dr. asha rao" }, "Dr. Asha Rao", 1)).toBe("mine");
  });

  it("parseQueueScope accepts the static scopes and rad:<id>, rejecting junk", () => {
    expect(parseQueueScope("mine")).toBe("mine");
    expect(parseQueueScope("rad:42")).toBe("rad:42");
    expect(parseQueueScope("rad:abc")).toBe("all");
    expect(parseQueueScope(null)).toBe("all");
    expect(scopeRadiologistId("rad:42" as QueueScope)).toBe(42);
    expect(scopeRadiologistId("mine")).toBeNull();
  });

  it("By-Radiologist scope filters by the assignment ID only", () => {
    const rows = [
      { id: 1, assignedRadiologistId: 42, assignedRadiologist: "Dr. X" },
      { id: 2, assignedRadiologistId: 7, assignedRadiologist: "Dr. Y" },
      { id: 3, assignedRadiologist: "Dr. X" }, // legacy row, no id → not matched
    ];
    expect(filterQueueByScope(rows, "rad:42" as QueueScope, null, null).map((r) => r.id)).toEqual([1]);
  });
});
