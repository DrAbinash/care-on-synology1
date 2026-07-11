import { describe, it, expect } from "vitest";
import {
  decideAssignment, canManageAssignments, isAssignableRadiologist,
  ASSIGN_MANAGE_PERMISSION, type AssignmentRow, type AssignmentActor,
} from "./studyAssignmentRules";
import { DEFAULT_LOCK_TTL_SECONDS } from "./studyLockRules";

// Ticket M1.6B1 — assignment decision matrix, pure. Assignment is
// organizational ownership; the lock is active reporting ownership — these
// rules never touch the lock, they only gate WHO may move the assignment.

const NOW = new Date("2026-07-11T10:00:00Z");
const TTL = DEFAULT_LOCK_TTL_SECONDS;

const staff: AssignmentActor = { userId: 1, userName: "Dr. Asha Rao", role: "radiologist", permissions: ["/radiology", "/reports:sign"] };
const admin: AssignmentActor = { userId: 9, userName: "Admin Owner", role: "admin", permissions: [] };
const granted: AssignmentActor = { userId: 3, userName: "Coordinator", role: "receptionist", permissions: [ASSIGN_MANAGE_PERMISSION] };

const row = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: 7, status: "REPORT_PENDING", patientId: 42, assignedRadiologist: null,
  assignedRadiologistId: null,
  lockUserId: null, lockUserName: null, lockTime: null, lockLastActivityAt: null, lockWorkstation: null,
  ...over,
});

const lockedBy = (userId: number) => ({
  lockUserId: userId, lockUserName: `User ${userId}`,
  lockTime: new Date(NOW.getTime() - 60_000), lockLastActivityAt: new Date(NOW.getTime() - 30_000),
});

describe("permission gates", () => {
  it("managers: full-access roles or the explicit /radiology:assign grant", () => {
    expect(canManageAssignments(admin)).toBe(true);
    expect(canManageAssignments({ ...staff, role: "Super Admin" })).toBe(true);
    expect(canManageAssignments(granted)).toBe(true);
    expect(canManageAssignments(staff)).toBe(false);
  });

  it("assignable targets: active reporting doctors only", () => {
    expect(isAssignableRadiologist({ isActive: true, role: "radiologist", permissions: [] })).toBe(true);
    expect(isAssignableRadiologist({ isActive: true, role: "Sonologist", permissions: [] })).toBe(true);
    expect(isAssignableRadiologist({ isActive: true, role: "doctor", permissions: ["/reports:sign"] })).toBe(true);
    expect(isAssignableRadiologist({ isActive: false, role: "radiologist", permissions: [] })).toBe(false);
    expect(isAssignableRadiologist({ isActive: true, role: "typist", permissions: [] })).toBe(false);
    expect(isAssignableRadiologist({ isActive: true, role: "admin", permissions: [] })).toBe(false);
  });
});

describe("decideAssignment — assign / reassign", () => {
  it("missing row → NOT_FOUND; completed studies cannot be (re)assigned", () => {
    expect(decideAssignment(null, admin, 1, NOW, TTL).outcome).toBe("NOT_FOUND");
    for (const status of ["REPORT_FINAL", "DELIVERED"]) {
      expect(decideAssignment(row({ status }), admin, 1, NOW, TTL).outcome).toBe("COMPLETED");
      expect(decideAssignment(row({ status, assignedRadiologistId: 2 }), admin, null, NOW, TTL).outcome).toBe("COMPLETED");
    }
  });

  it("manager assigns an unassigned study → ASSIGNED; over an existing one → REASSIGNED", () => {
    expect(decideAssignment(row(), admin, 2, NOW, TTL)).toEqual({ outcome: "ASSIGNED", write: true });
    expect(decideAssignment(row({ assignedRadiologistId: 1 }), admin, 2, NOW, TTL)).toEqual({ outcome: "REASSIGNED", write: true });
  });

  it("assigning to the current assignee is a no-op → ALREADY_ASSIGNED", () => {
    expect(decideAssignment(row({ assignedRadiologistId: 2 }), admin, 2, NOW, TTL)).toEqual({ outcome: "ALREADY_ASSIGNED", write: false });
  });

  it("regular staff may self-grab an UNASSIGNED study only", () => {
    expect(decideAssignment(row(), staff, staff.userId, NOW, TTL)).toEqual({ outcome: "ASSIGNED", write: true });
    // …not assign someone else
    expect(decideAssignment(row(), staff, 2, NOW, TTL).outcome).toBe("FORBIDDEN");
    // …not touch an existing assignment (no tug-of-war)
    expect(decideAssignment(row({ assignedRadiologistId: 2 }), staff, staff.userId, NOW, TTL).outcome).toBe("FORBIDDEN");
  });

  it("an active FOREIGN lock blocks non-managers but not managers (lock untouched either way)", () => {
    const locked = row({ ...lockedBy(2) });
    expect(decideAssignment(locked, staff, staff.userId, NOW, TTL).outcome).toBe("LOCKED_BY_OTHER");
    expect(decideAssignment(locked, admin, 3, NOW, TTL).outcome).toBe("ASSIGNED");
    // my own lock never blocks my self-grab
    const mine = row({ ...lockedBy(staff.userId) });
    expect(decideAssignment(mine, staff, staff.userId, NOW, TTL).outcome).toBe("ASSIGNED");
    // an EXPIRED foreign lock blocks nobody
    const expired = row({ lockUserId: 2, lockUserName: "x", lockTime: new Date(NOW.getTime() - 10_000_000), lockLastActivityAt: new Date(NOW.getTime() - 10_000_000) });
    expect(decideAssignment(expired, staff, staff.userId, NOW, TTL).outcome).toBe("ASSIGNED");
  });
});

describe("decideAssignment — unassign", () => {
  it("unassigning an unassigned study is an idempotent no-op", () => {
    expect(decideAssignment(row(), admin, null, NOW, TTL)).toEqual({ outcome: "UNASSIGNED", write: false });
  });

  it("managers unassign anyone; staff only themselves", () => {
    expect(decideAssignment(row({ assignedRadiologistId: 2 }), admin, null, NOW, TTL)).toEqual({ outcome: "UNASSIGNED", write: true });
    expect(decideAssignment(row({ assignedRadiologistId: staff.userId }), staff, null, NOW, TTL)).toEqual({ outcome: "UNASSIGNED", write: true });
    expect(decideAssignment(row({ assignedRadiologistId: 2 }), staff, null, NOW, TTL).outcome).toBe("FORBIDDEN");
  });

  it("self-unassign is blocked by an active foreign lock (non-managers)", () => {
    const r = row({ assignedRadiologistId: staff.userId, ...lockedBy(2) });
    expect(decideAssignment(r, staff, null, NOW, TTL).outcome).toBe("LOCKED_BY_OTHER");
    expect(decideAssignment(r, admin, null, NOW, TTL).outcome).toBe("UNASSIGNED");
  });
});
