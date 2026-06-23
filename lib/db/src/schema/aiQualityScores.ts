import {
  pgTable, serial, integer, text, real, timestamp, index,
} from "drizzle-orm/pg-core";

// ── AI Quality Scores (Phase 5) ── Computed quality metrics for AI radiology drafts
// Populated by backend aggregation from radiology_worklist.ai_feedback and
// ai_prompt_templates usage. Each row represents a snapshot per modality/template/date.
export const aiQualityScoresTable = pgTable(
  "ai_quality_scores",
  {
    id: serial("id").primaryKey(),
    // Scope: overall | modality | template | radiologist
    scope: text("scope").notNull(),
    scopeKey: text("scope_key"), // modality code, template name, or radiologist id
    // Date range this snapshot covers
    dateFrom: timestamp("date_from", { withTimezone: true }).notNull(),
    dateTo: timestamp("date_to", { withTimezone: true }).notNull(),
    // Counts
    totalDrafts: integer("total_drafts").notNull().default(0),
    totalWithFeedback: integer("total_with_feedback").notNull().default(0),
    helpfulCount: integer("helpful_count").notNull().default(0),
    needsImprovementCount: integer("needs_improvement_count").notNull().default(0),
    inaccurateCount: integer("inaccurate_count").notNull().default(0),
    // Computed scores (0-100)
    helpfulRate: real("helpful_rate").notNull().default(0), // percentage of helpful / total_with_feedback
    qualityScore: real("quality_score").notNull().default(0), // weighted: helpful=100, needs_improvement=50, inaccurate=0
    // Average turnaround (minutes) from draft READY to REPORT_FINAL
    avgTurnaroundMinutes: real("avg_turnaround_minutes"),
    // Computed at
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeKeyIdx: index("ai_qs_scope_key_idx").on(t.scope, t.scopeKey),
    dateIdx: index("ai_qs_date_idx").on(t.dateFrom, t.dateTo),
    computedIdx: index("ai_qs_computed_idx").on(t.computedAt),
  }),
);
export type AiQualityScore = typeof aiQualityScoresTable.$inferSelect;
