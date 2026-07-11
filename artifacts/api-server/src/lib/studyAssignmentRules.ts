/**
 * studyAssignmentRules.ts — Ticket M1.6B1: assignment decision rules, PURE.
 *
 * Assignment = ORGANIZATIONAL ownership of a worklist study; the M1.6A lock
 * = ACTIVE reporting ownership. The two never silently change each other:
 * these rules only ever decide assignment-column writes, and an active
 * foreign lock merely gates WHO may move the assignment (managers may,
 * others may not) — the lock itself is untouched either way.
 */

import { isLockActive, type LockRow, type LockActor } from "./studyLockRules";

export type AssignmentActor = LockActor;

/** Permission granting assign/reassign/unassign over OTHER people's studies. */
export const ASSIGN_MANAGE_PERMISSION = "/radiology:assign";

export function canManageAssignments(actor: AssignmentActor): boolean {
  const role = actor.role.toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (role === "admin" || role === "super_admin" || role === "superadmin" || role === "owner" || role === "super") return true;
  return actor.permissions.includes(ASSIGN_MANAGE_PERMISSION);
}

/** Who may be an assignment TARGET: active reporting doctors. */
export function isAssignableRadiologist(user: { isActive: boolean; role: string; permissions: string[] }): boolean {
  if (!user.isActive) return false;
  const role = user.role.toLowerCase();
  if (role.includes("radiolog") || role.includes("sonolog")) return true;
  return user.permissions.includes("/reports:sign");
}

export interface AssignmentRow extends LockRow {
  assignedRadiologistId: number | null;
}

export type AssignOutcome =
  | "ASSIGNED"
  | "REASSIGNED"
  | "UNASSIGNED"
  | "ALREADY_ASSIGNED"
  | "LOCKED_BY_OTHER"
  | "COMPLETED"
  | "FORBIDDEN"
  | "NOT_FOUND";

export interface AssignDecision {
  outcome: AssignOutcome;
  /** True when the service must write the assignment columns. */
  write: boolean;
}

const COMPLETED_STATUSES = new Set(["REPORT_FINAL", "DELIVERED"]);

/**
 * Decide an assign/reassign/unassign. `target` null = unassign.
 *
 * Permission model:
 *  - managers (admin/super_admin or /radiology:assign) may assign, reassign
 *    and unassign anyone — even past an active foreign lock (audited; the
 *    lock is never touched).
 *  - regular /radiology staff may take an UNASSIGNED study for THEMSELVES
 *    and may unassign THEMSELVES; anything touching someone else's
 *    assignment is FORBIDDEN, and any active foreign lock blocks them
 *    (LOCKED_BY_OTHER) — no assignment tug-of-war under a live reporting
 *    session.
 */
export function decideAssignment(
  row: AssignmentRow | null,
  actor: AssignmentActor,
  targetRadiologistId: number | null,
  now: Date,
  ttlSeconds: number,
): AssignDecision {
  if (!row) return { outcome: "NOT_FOUND", write: false };
  if (COMPLETED_STATUSES.has(row.status)) return { outcome: "COMPLETED", write: false };

  const manager = canManageAssignments(actor);
  const current = row.assignedRadiologistId;
  const lockHeldByOther = row.lockUserId != null && row.lockUserId !== actor.userId && isLockActive(row, now, ttlSeconds);

  // ── Unassign ──
  if (targetRadiologistId === null) {
    if (current === null) return { outcome: "UNASSIGNED", write: false }; // idempotent no-op
    if (!manager && current !== actor.userId) return { outcome: "FORBIDDEN", write: false };
    if (!manager && lockHeldByOther) return { outcome: "LOCKED_BY_OTHER", write: false };
    return { outcome: "UNASSIGNED", write: true };
  }

  // ── Assign / reassign ──
  if (current === targetRadiologistId) return { outcome: "ALREADY_ASSIGNED", write: false };
  if (!manager) {
    // Self-grab of an unassigned study is the only non-manager assignment.
    if (current !== null) return { outcome: "FORBIDDEN", write: false };
    if (targetRadiologistId !== actor.userId) return { outcome: "FORBIDDEN", write: false };
    if (lockHeldByOther) return { outcome: "LOCKED_BY_OTHER", write: false };
    return { outcome: "ASSIGNED", write: true };
  }
  return { outcome: current === null ? "ASSIGNED" : "REASSIGNED", write: true };
}
