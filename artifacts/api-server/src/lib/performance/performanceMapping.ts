/**
 * Pure mappers: DB rows → the score engine's inputs.
 * ============================================================================
 * Deliberately DB-free (imports only TYPES from the schema, never the db
 * client) so these can be unit-tested without a live Postgres. performanceService.ts
 * composes these with db reads.
 */
import type { PerformanceCategory, PerformanceEvent } from "@workspace/db/schema";
import type { ScoringPolicy, ScoreEvent, CategoryStrategy } from "./scoreEngine";

/** Statuses at which an event counts toward the official score. */
export const APPLIED_STATUSES = new Set(["approved", "score_applied"]);

/** Map DB category rows → the engine's ScoringPolicy (pure). */
export function categoriesToPolicy(rows: PerformanceCategory[], label?: string): ScoringPolicy {
  const active = rows
    .filter((r) => r.isActive)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.key < b.key ? -1 : 1));
  const categories = active.map((r) => ({
    key: r.key,
    label: r.label,
    maxMarks: r.maxMarks,
    strategy: (r.strategy === "earned" ? "earned" : "deduction") as CategoryStrategy,
    baseline: r.baseline ?? undefined,
  }));
  // expectedTotal = sum so a mid-edit non-100 config doesn't throw; the "should
  // be 100" check is surfaced separately by the route, not enforced here.
  const expectedTotal = categories.reduce((a, c) => a + c.maxMarks, 0);
  return { label, categories, expectedTotal, roundTo: 0 };
}

/** Map DB event rows → the engine's ScoreEvent[] (pure). Non-approved events
 *  are passed with approved:false so the engine excludes them but they remain
 *  visible in `unapplied` for transparency. */
export function eventRowsToScoreEvents(rows: PerformanceEvent[]): ScoreEvent[] {
  return rows.map((r) => ({
    id: r.id,
    category: r.categoryKey,
    points: r.points,
    approved: APPLIED_STATUSES.has(r.status),
    disqualifying: r.disqualifying,
    date: r.eventDate ?? undefined,
    label: r.description ?? undefined,
  }));
}
