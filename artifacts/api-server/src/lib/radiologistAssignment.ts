/**
 * radiologistAssignment.ts
 * Auto-assigns radiologists to studies based on:
 *   - modality
 *   - body part / subspecialty
 *   - current shift
 *   - workload balance
 *   - manual override / backup fallback
 *
 * Workload counts are maintained in radiologist_workloads for fast lookup.
 */
import { db } from "@workspace/db";
import {
  radiologistAssignmentRulesTable,
  radiologistSubspecialtiesTable,
  radiologistWorkloadsTable,
  radiologyStudiesTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, asc, sql, inArray } from "drizzle-orm";

export type AssignmentContext = {
  modality: string;
  bodyPart?: string | null;
  subspecialtyHint?: string | null;
  studyId: number;
};

/**
 * Return current time as "HH:MM" in 24-hour format for shift matching.
 */
function currentShiftTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Check if current time falls within a shift window [start, end].
 * Supports overnight shifts (e.g. 22:00 → 06:00).
 */
function isInShift(start: string | null, end: string | null): boolean {
  if (!start || !end) return true; // no shift restriction
  const now = currentShiftTime();
  if (start <= end) {
    return now >= start && now <= end;
  }
  // overnight shift
  return now >= start || now <= end;
}

/**
 * Load all active assignment rules, ordered by sortOrder.
 */
export async function loadActiveAssignmentRules(): Promise<
  typeof radiologistAssignmentRulesTable.$inferSelect[]
> {
  return db
    .select()
    .from(radiologistAssignmentRulesTable)
    .where(eq(radiologistAssignmentRulesTable.isActive, true))
    .orderBy(asc(radiologistAssignmentRulesTable.sortOrder));
}

/**
 * Find the subspecialty of a user, if any.
 */
export async function getUserSubspecialties(userId: number): Promise<string[]> {
  const rows = await db
    .select({ subspecialty: radiologistSubspecialtiesTable.subspecialty })
    .from(radiologistSubspecialtiesTable)
    .where(eq(radiologistSubspecialtiesTable.userId, userId));
  return rows.map((r) => r.subspecialty);
}

/**
 * Get or initialise a workload row for a user.
 */
export async function getWorkload(
  userId: number,
): Promise<typeof radiologistWorkloadsTable.$inferSelect> {
  const [row] = await db
    .select()
    .from(radiologistWorkloadsTable)
    .where(eq(radiologistWorkloadsTable.userId, userId));
  if (row) return row;

  const [created] = await db
    .insert(radiologistWorkloadsTable)
    .values({ userId })
    .returning();
  return created;
}

/**
 * Increment a radiologist's workload counter.
 */
export async function bumpWorkload(userId: number, field: "assigned" | "inProgress" | "pending" | "todayReported"): Promise<void> {
  const map: Record<string, keyof typeof radiologistWorkloadsTable> = {
    assigned: "assignedCount",
    inProgress: "inProgressCount",
    pending: "pendingCount",
    todayReported: "todayReportedCount",
  };
  const col = map[field];
  if (!col) return;
  await db.execute(
    sql`UPDATE radiologist_workloads SET ${sql.raw(String(col))} = ${sql.raw(String(col))} + 1, last_assigned_at = NOW() WHERE user_id = ${userId}`,
  );
}

/**
 * Decrement a counter (e.g. when a study is completed or reassigned).
 */
export async function dropWorkload(userId: number, field: "assigned" | "inProgress" | "pending"): Promise<void> {
  const map: Record<string, string> = {
    assigned: "assigned_count",
    inProgress: "in_progress_count",
    pending: "pending_count",
  };
  const col = map[field];
  if (!col) return;
  await db.execute(
    sql`UPDATE radiologist_workloads SET ${sql.raw(col)} = GREATEST(${sql.raw(col)} - 1, 0) WHERE user_id = ${userId}`,
  );
}

/**
 * Compute the best radiologist for a study.
 * Returns { radiologistId, radiologistName, ruleId, isBackup } or null.
 */
export async function computeAssignment(
  ctx: AssignmentContext,
): Promise<{
  radiologistId: number;
  radiologistName: string;
  ruleId: number;
  isBackup: boolean;
} | null> {
  const rules = await loadActiveAssignmentRules();
  const now = currentShiftTime();

  for (const rule of rules) {
    // Modality match
    if (rule.modality.toUpperCase() !== ctx.modality.toUpperCase()) continue;

    // Body part match (if rule specifies one)
    if (rule.bodyPart && ctx.bodyPart) {
      if (!ctx.bodyPart.toUpperCase().includes(rule.bodyPart.toUpperCase())) continue;
    } else if (rule.bodyPart) {
      continue;
    }

    // Subspecialty match (if rule specifies one)
    if (rule.subspecialty) {
      const userSubs = await getUserSubspecialties(rule.primaryRadiologistId);
      if (!userSubs.some((s) => s.toLowerCase() === rule.subspecialty!.toLowerCase())) {
        // Try backup
        if (rule.backupRadiologistId) {
          const backupSubs = await getUserSubspecialties(rule.backupRadiologistId);
          if (!backupSubs.some((s) => s.toLowerCase() === rule.subspecialty!.toLowerCase())) {
            continue;
          }
        } else {
          continue;
        }
      }
    }

    // Shift match
    const shiftOk = isInShift(rule.shiftStart, rule.shiftEnd);
    if (!shiftOk) continue;

    // Pick primary vs backup based on workload
    const primaryWl = await getWorkload(rule.primaryRadiologistId);
    const primaryLoad = primaryWl.assignedCount + primaryWl.inProgressCount;

    let chosenId = rule.primaryRadiologistId;
    let isBackup = false;

    if (rule.backupRadiologistId) {
      const backupWl = await getWorkload(rule.backupRadiologistId);
      const backupLoad = backupWl.assignedCount + backupWl.inProgressCount;
      // If backup has 30%+ less load, prefer backup for balance
      if (backupLoad < primaryLoad * 0.7) {
        chosenId = rule.backupRadiologistId;
        isBackup = true;
      }
    }

    // Resolve name
    const [user] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, chosenId))
      .limit(1);

    if (!user) continue;

    return {
      radiologistId: chosenId,
      radiologistName: user.name,
      ruleId: rule.id,
      isBackup,
    };
  }

  return null;
}

/**
 * Assign a radiologist to a study and update workload counters.
 */
export async function assignRadiologistToStudy(
  studyId: number,
  ctx: AssignmentContext,
  override?: { radiologistId: number; radiologistName: string; reason: string },
): Promise<{
  radiologistId: number;
  radiologistName: string;
  ruleId: number | null;
  isBackup: boolean;
  isManualOverride: boolean;
} | null> {
  if (override) {
    await db
      .update(radiologyStudiesTable)
      .set({
        assignedRadiologistId: override.radiologistId,
        assignedRadiologistName: `${override.radiologistName} (manual: ${override.reason})`,
      })
      .where(eq(radiologyStudiesTable.id, studyId));
    await bumpWorkload(override.radiologistId, "assigned");
    return {
      radiologistId: override.radiologistId,
      radiologistName: override.radiologistName,
      ruleId: null,
      isBackup: false,
      isManualOverride: true,
    };
  }

  const match = await computeAssignment(ctx);
  if (!match) return null;

  await db
    .update(radiologyStudiesTable)
    .set({
      assignedRadiologistId: match.radiologistId,
      assignedRadiologistName: match.radiologistName,
    })
    .where(eq(radiologyStudiesTable.id, studyId));

  await bumpWorkload(match.radiologistId, "assigned");

  return { ...match, isManualOverride: false };
}
