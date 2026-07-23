/**
 * Performance service — wires the pure score engine to the DB.
 * ============================================================================
 * Pure mapping helpers (categoriesToPolicy / eventRowsToScoreEvents) are
 * exported and unit-tested; the DB functions load config + approved events and
 * run the engine. The official score is ALWAYS computed here (server-side),
 * never trusted from the client. Advisory only — writing a performance_scores
 * row changes no payroll.
 */
import { db } from "@workspace/db";
import {
  performanceCategoriesTable,
  performanceEventsTable,
  performanceScoresTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { computeScore, type ScoreResult } from "./scoreEngine";
import { categoriesToPolicy, eventRowsToScoreEvents } from "./performanceMapping";

// Re-export the pure mappers so existing importers keep working.
export { categoriesToPolicy, eventRowsToScoreEvents, APPLIED_STATUSES } from "./performanceMapping";

/** Compute a staff member's live score for a cycle (does not persist). */
export async function computeCycleScore(cycleId: number, staffId: number): Promise<ScoreResult> {
  const [cats, events] = await Promise.all([
    db.select().from(performanceCategoriesTable),
    db
      .select()
      .from(performanceEventsTable)
      .where(and(eq(performanceEventsTable.cycleId, cycleId), eq(performanceEventsTable.staffId, staffId))),
  ]);
  const policy = categoriesToPolicy(cats);
  return computeScore(policy, eventRowsToScoreEvents(events));
}

/** Compute and PERSIST a staff member's score for a cycle, snapshotting the
 *  category policy used so the finalized score is reproducible. */
export async function finalizeStaffCycleScore(
  cycleId: number,
  staffId: number,
  finalizedByUserId: number | null,
): Promise<{ result: ScoreResult; scoreId: number }> {
  const cats = await db.select().from(performanceCategoriesTable);
  const policy = categoriesToPolicy(cats);
  const events = await db
    .select()
    .from(performanceEventsTable)
    .where(and(eq(performanceEventsTable.cycleId, cycleId), eq(performanceEventsTable.staffId, staffId)));
  const result = computeScore(policy, eventRowsToScoreEvents(events));

  const values = {
    cycleId,
    staffId,
    total: String(result.total),
    maxTotal: String(result.maxTotal),
    breakdown: result as unknown,
    disqualified: result.disqualified,
    ruleSnapshot: { categories: policy.categories } as unknown,
    finalizedByUserId,
    finalizedAt: new Date(),
  };

  const [row] = await db
    .insert(performanceScoresTable)
    .values(values)
    .onConflictDoUpdate({
      target: [performanceScoresTable.cycleId, performanceScoresTable.staffId],
      set: {
        total: values.total,
        maxTotal: values.maxTotal,
        breakdown: values.breakdown,
        disqualified: values.disqualified,
        ruleSnapshot: values.ruleSnapshot,
        finalizedByUserId,
        finalizedAt: values.finalizedAt,
      },
    })
    .returning({ id: performanceScoresTable.id });

  return { result, scoreId: row.id };
}
