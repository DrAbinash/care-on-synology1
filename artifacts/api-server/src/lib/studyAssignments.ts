/**
 * studyAssignments.ts — Ticket M1.6B1: the transactional assignment service.
 *
 * Same shape as studyLocks.ts: SELECT ... FOR UPDATE per operation (race
 * safe), decisions from the pure rules (studyAssignmentRules.ts), identity
 * from the server session only, every change in the hash-chained audit log.
 * Writes touch ONLY the assignment columns (+ the mirrored legacy name) —
 * never report, draft, findings, structured data, or the lock.
 */

import { db } from "@workspace/db";
import { radiologyWorklistTable, usersTable } from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { auditLog } from "./audit";
import { getLockTtlSeconds } from "./studyLocks";
import { lockExpiresAt, isLockActive } from "./studyLockRules";
import {
  decideAssignment, isAssignableRadiologist, canManageAssignments,
  type AssignmentActor, type AssignmentRow, type AssignOutcome,
} from "./studyAssignmentRules";

export type { AssignmentActor } from "./studyAssignmentRules";

const ROW_COLUMNS = {
  id: radiologyWorklistTable.id,
  status: radiologyWorklistTable.status,
  patientId: radiologyWorklistTable.patientId,
  assignedRadiologist: radiologyWorklistTable.assignedRadiologist,
  assignedRadiologistId: radiologyWorklistTable.assignedRadiologistId,
  assignedAt: radiologyWorklistTable.assignedAt,
  assignedById: radiologyWorklistTable.assignedById,
  assignedByName: radiologyWorklistTable.assignedByName,
  lockUserId: radiologyWorklistTable.lockUserId,
  lockUserName: radiologyWorklistTable.lockUserName,
  lockTime: radiologyWorklistTable.lockTime,
  lockLastActivityAt: radiologyWorklistTable.lockLastActivityAt,
  lockWorkstation: radiologyWorklistTable.lockWorkstation,
} as const;

export interface AssignmentView {
  worklistId: number;
  status: string;
  assignedRadiologistId: number | null;
  assignedRadiologistName: string | null;
  assignedAt: string | null;
  assignedById: number | null;
  assignedByName: string | null;
  lockUserId: number | null;
  lockUserName: string | null;
  lockExpiresAt: string | null;
}

type Row = AssignmentRow & {
  assignedRadiologist: string | null;
  assignedAt: Date | null;
  assignedById: number | null;
  assignedByName: string | null;
};

function viewOf(row: Row, ttlSeconds: number): AssignmentView {
  return {
    worklistId: row.id,
    status: row.status,
    assignedRadiologistId: row.assignedRadiologistId,
    assignedRadiologistName: row.assignedRadiologist,
    assignedAt: row.assignedAt?.toISOString() ?? null,
    assignedById: row.assignedById,
    assignedByName: row.assignedByName,
    lockUserId: row.lockUserId,
    lockUserName: row.lockUserName,
    lockExpiresAt: lockExpiresAt(row, ttlSeconds)?.toISOString() ?? null,
  };
}

export interface AssignResult {
  outcome: AssignOutcome | "INVALID_RADIOLOGIST";
  assignment: AssignmentView | null;
}

/** Assign or reassign (`radiologistId`) or unassign (`null`). Atomic. */
export async function assignStudy(
  worklistId: number,
  actor: AssignmentActor,
  radiologistId: number | null,
  reason: string | null,
): Promise<AssignResult> {
  const ttl = await getLockTtlSeconds();
  const now = new Date();

  // Validate the TARGET before touching the row: must be a real, active,
  // assignable reporting doctor (never patient-name or free-text based).
  let targetName: string | null = null;
  if (radiologistId !== null) {
    const [user] = await db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, permissions: usersTable.permissions, isActive: usersTable.isActive })
      .from(usersTable).where(eq(usersTable.id, radiologistId)).limit(1);
    if (!user) return { outcome: "INVALID_RADIOLOGIST", assignment: null };
    let permissions: string[] = [];
    try {
      const parsed = user.permissions ? JSON.parse(user.permissions) : [];
      if (Array.isArray(parsed)) permissions = parsed.filter((p): p is string => typeof p === "string");
    } catch { /* empty */ }
    if (!isAssignableRadiologist({ isActive: user.isActive, role: user.role, permissions })) {
      return { outcome: "INVALID_RADIOLOGIST", assignment: null };
    }
    targetName = user.name;
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.select(ROW_COLUMNS).from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId)).for("update");
    const decision = decideAssignment((row as Row | undefined) ?? null, actor, radiologistId, now, ttl);
    if (!decision.write) {
      return { outcome: decision.outcome, assignment: row ? viewOf(row as Row, ttl) : null };
    }
    const prior = row as Row;
    const next = radiologistId === null
      ? { assignedRadiologist: null, assignedRadiologistId: null, assignedAt: null, assignedById: null, assignedByName: null }
      : { assignedRadiologist: targetName, assignedRadiologistId: radiologistId, assignedAt: now, assignedById: actor.userId, assignedByName: actor.userName };
    await tx.update(radiologyWorklistTable).set(next).where(eq(radiologyWorklistTable.id, worklistId));
    void auditLog({
      userId: actor.userId,
      userName: actor.userName,
      role: actor.role,
      action: decision.outcome === "UNASSIGNED" ? "study_unassigned"
        : decision.outcome === "REASSIGNED" ? "study_reassigned" : "study_assigned",
      module: "radiology",
      entityType: "radiology_worklist",
      entityId: String(worklistId),
      oldValue: JSON.stringify({ assignedRadiologistId: prior.assignedRadiologistId, assignedRadiologistName: prior.assignedRadiologist }),
      newValue: JSON.stringify({ assignedRadiologistId: radiologistId, assignedRadiologistName: targetName }),
      reason,
    });
    return {
      outcome: decision.outcome,
      assignment: viewOf({ ...prior, ...next } as Row, ttl),
    };
  });
}

export async function getAssignment(worklistId: number): Promise<AssignmentView | null> {
  const ttl = await getLockTtlSeconds();
  const [row] = await db.select(ROW_COLUMNS).from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId)).limit(1);
  return row ? viewOf(row as Row, ttl) : null;
}

export interface RadiologistOption { id: number; name: string; role: string }

/** Active assignable reporting doctors — the assignment target list. */
export async function listRadiologists(): Promise<RadiologistOption[]> {
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, permissions: usersTable.permissions, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));
  return rows
    .filter((u) => {
      let permissions: string[] = [];
      try {
        const parsed = u.permissions ? JSON.parse(u.permissions) : [];
        if (Array.isArray(parsed)) permissions = parsed.filter((p): p is string => typeof p === "string");
      } catch { /* empty */ }
      return isAssignableRadiologist({ isActive: u.isActive, role: u.role, permissions });
    })
    .map((u) => ({ id: u.id, name: u.name, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface WorkloadRow {
  radiologistId: number;
  radiologistName: string;
  assignedPending: number;
  lockedNow: number;
  completedToday: number;
  avgPendingAgeHours: number | null;
}

export interface WorkloadSummary {
  radiologists: WorkloadRow[];
  unassignedPending: number;
  generatedAt: string;
}

const COMPLETED = ["REPORT_FINAL", "DELIVERED"];

/** Live workload per assignable radiologist — reuses the worklist data only. */
export async function workloadSummary(): Promise<WorkloadSummary> {
  const ttl = await getLockTtlSeconds();
  const now = new Date();
  const radiologists = await listRadiologists();
  const ids = radiologists.map((r) => r.id);

  const rows = ids.length
    ? await db
        .select({
          id: radiologyWorklistTable.id,
          status: radiologyWorklistTable.status,
          assignedRadiologistId: radiologyWorklistTable.assignedRadiologistId,
          lockUserId: radiologyWorklistTable.lockUserId,
          lockTime: radiologyWorklistTable.lockTime,
          lockLastActivityAt: radiologyWorklistTable.lockLastActivityAt,
          createdAt: radiologyWorklistTable.createdAt,
          updatedAt: radiologyWorklistTable.updatedAt,
        })
        .from(radiologyWorklistTable)
        .where(sql`(${radiologyWorklistTable.assignedRadiologistId} = ANY(${sql.param(ids)}::int[])
          OR ${radiologyWorklistTable.lockUserId} = ANY(${sql.param(ids)}::int[])
          OR ${radiologyWorklistTable.assignedRadiologistId} IS NULL)`)
    : [];

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const byRad = new Map<number, WorkloadRow>(radiologists.map((r) => [r.id, {
    radiologistId: r.id, radiologistName: r.name,
    assignedPending: 0, lockedNow: 0, completedToday: 0, avgPendingAgeHours: null,
  }]));
  const pendingAges = new Map<number, number[]>();
  let unassignedPending = 0;

  for (const row of rows) {
    const completed = COMPLETED.includes(row.status);
    if (!completed && row.assignedRadiologistId == null) unassignedPending++;
    const w = row.assignedRadiologistId != null ? byRad.get(row.assignedRadiologistId) : undefined;
    if (w) {
      if (!completed) {
        w.assignedPending++;
        const ageH = (now.getTime() - new Date(row.createdAt).getTime()) / 3_600_000;
        pendingAges.set(w.radiologistId, [...(pendingAges.get(w.radiologistId) ?? []), ageH]);
      } else if (row.updatedAt && new Date(row.updatedAt) >= todayStart) {
        w.completedToday++;
      }
    }
    if (row.lockUserId != null && isLockActive(row, now, ttl)) {
      const lw = byRad.get(row.lockUserId);
      if (lw) lw.lockedNow++;
    }
  }
  for (const [id, ages] of pendingAges) {
    const w = byRad.get(id);
    if (w && ages.length) w.avgPendingAgeHours = Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10;
  }
  return { radiologists: [...byRad.values()], unassignedPending, generatedAt: now.toISOString() };
}

export { canManageAssignments };
