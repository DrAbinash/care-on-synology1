import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

// Canonical Report Quality Engine persistence (PR #101 Phase 2).
//
// APPEND-ONLY by design (requirements 4-7): every evaluation is a new row and
// is never updated in place; every override is appended to history and never
// overwrites a prior one. Findings are stored STRUCTURED (JSON of the canonical
// QualityFindingDTO), not rendered text, so wording can change without breaking
// analytics. Versioning columns (engine/rule/knowledge-pack) make historical
// evaluations reproducible.
//
// SHADOW: these tables run alongside the legacy report_quality_checks /
// report_quality_gates (which are untouched). Nothing in production reads them
// yet; they establish the canonical contract.

// ── Report Quality Evaluations ── one immutable row per engine run
export const reportQualityEvaluationsTable = pgTable(
  "report_quality_evaluations",
  {
    id: serial("id").primaryKey(),
    reportDraftId: integer("report_draft_id"),
    reportId: integer("report_id"),
    // Which caller/adapter produced this run (workspace | smart-radiology | usg | ...).
    source: text("source").notNull().default("unknown"),
    modality: text("modality"),
    studyType: text("study_type"),
    // Result summary
    score: integer("score").notNull(),
    blockingCount: integer("blocking_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    infoCount: integer("info_count").notNull().default(0),
    evaluatedRuleCount: integer("evaluated_rule_count").notNull().default(0),
    deterministicRuleCount: integer("deterministic_rule_count").notNull().default(0),
    heuristicRuleCount: integer("heuristic_rule_count").notNull().default(0),
    // Rule ids skipped for missing structured data (JSON array) — honest coverage.
    notEvaluatedJson: text("not_evaluated_json").notNull().default("[]"),
    // Execution time in milliseconds (requirement 9).
    runtimeMs: integer("runtime_ms").notNull().default(0),
    // Versioning for reproducibility (requirement 6).
    engineVersion: text("engine_version").notNull(),
    ruleVersion: text("rule_version").notNull(),
    knowledgePackVersion: text("knowledge_pack_version"),
    // Structured findings (JSON of QualityFindingDTO[]) — NOT rendered text.
    findingsJson: text("findings_json").notNull().default("[]"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
    // Append-only: no updatedAt; rows are never mutated after insert.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    draftIdx: index("rqe_draft_idx").on(t.reportDraftId),
    reportIdx: index("rqe_report_idx").on(t.reportId),
    modalityIdx: index("rqe_modality_idx").on(t.modality),
    createdIdx: index("rqe_created_idx").on(t.createdAt),
  }),
);
export type ReportQualityEvaluation = typeof reportQualityEvaluationsTable.$inferSelect;

// ── Report Quality Findings ── normalized, queryable finding rows (Phase 2.5)
//
// Written ALONGSIDE the immutable findings_json blob on the evaluation. The blob
// stays the full-fidelity record for point reads; these rows exist so dashboards
// can index and aggregate by rule_id / canonical_id / category / severity across
// millions of evaluations (a JSON blob cannot be GROUP BY'd efficiently).
// Append-only children of an immutable evaluation.
export const reportQualityFindingsTable = pgTable(
  "report_quality_findings",
  {
    id: serial("id").primaryKey(),
    evaluationId: integer("evaluation_id").notNull(),
    // Denormalized from the parent evaluation for single-table analytics.
    reportDraftId: integer("report_draft_id"),
    reportId: integer("report_id"),
    // Stable identity — flat id + hierarchical canonical id.
    ruleId: text("rule_id").notNull(),
    canonicalId: text("canonical_id"),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    tier: text("tier").notNull(),
    modality: text("modality"),
    studyType: text("study_type"),
    knowledgePackSource: text("knowledge_pack_source"),
    // Score deduction this finding contributed.
    weight: integer("weight"),
    // Rendered message kept for display; the STRUCTURE above is what analytics use.
    message: text("message"),
    evidence: text("evidence"),
    suggestedFix: text("suggested_fix"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    evalIdx: index("rqf_eval_idx").on(t.evaluationId),
    ruleIdx: index("rqf_rule_idx").on(t.ruleId),
    canonicalIdx: index("rqf_canonical_idx").on(t.canonicalId),
    draftIdx: index("rqf_draft_idx").on(t.reportDraftId),
    categoryIdx: index("rqf_category_idx").on(t.category),
    severityIdx: index("rqf_severity_idx").on(t.severity),
  }),
);
export type ReportQualityFinding = typeof reportQualityFindingsTable.$inferSelect;

// ── Report Quality Overrides ── append-only override/acknowledge history
export const reportQualityOverridesTable = pgTable(
  "report_quality_overrides",
  {
    id: serial("id").primaryKey(),
    // Links to the evaluation whose finding is being overridden (nullable so an
    // override can also be recorded against a draft directly).
    evaluationId: integer("evaluation_id"),
    reportDraftId: integer("report_draft_id"),
    // The stable rule id being overridden (never message text).
    ruleId: text("rule_id").notNull(),
    // override | acknowledge | suppress | justify
    action: text("action").notNull().default("override"),
    reason: text("reason").notNull(),
    overriddenById: integer("overridden_by_id"),
    overriddenByName: text("overridden_by_name"),
    // Append-only history: each override is a new row; prior rows are never
    // updated or deleted.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    evalIdx: index("rqo_eval_idx").on(t.evaluationId),
    draftIdx: index("rqo_draft_idx").on(t.reportDraftId),
    ruleIdx: index("rqo_rule_idx").on(t.ruleId),
  }),
);
export type ReportQualityOverride = typeof reportQualityOverridesTable.$inferSelect;
