/**
 * AI Evaluation Framework — Phase P2 / Gate G8.
 *
 * Golden dataset + evaluation runs + a version lifecycle (shadow → candidate →
 * live) gated by human approval. No model/prompt version reaches a radiologist
 * (a later phase) until an evaluation run meets thresholds AND a human approves.
 *
 *   ai_model_versions        — a (model, prompt, digest) version + its lifecycle state
 *   ai_golden_cases          — reference studies with a known-correct structured report
 *   ai_evaluation_runs       — one run of a version against the golden set + metrics
 *   ai_evaluation_case_results — per-case pass/fail + diffs
 */
import { pgTable, serial, integer, text, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const aiModelVersionsTable = pgTable(
  "ai_model_versions",
  {
    id: serial("id").primaryKey(),
    versionRef: text("version_ref").notNull(), // stable label, e.g. "chest-v1"
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelDigest: text("model_digest"),
    promptVersion: text("prompt_version").notNull(),
    // Lifecycle: shadow (default) → candidate (met thresholds) → live (human-approved) → retired
    state: text("state").notNull().default("shadow"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({ versionKey: uniqueIndex("ai_model_version_ref_key").on(t.versionRef) }),
);
export type AiModelVersion = typeof aiModelVersionsTable.$inferSelect;

export const aiGoldenCasesTable = pgTable(
  "ai_golden_cases",
  {
    id: serial("id").primaryKey(),
    caseKey: text("case_key").notNull(), // stable id for the case
    modality: text("modality"),
    studyInstanceUid: text("study_instance_uid"), // optional link to a real study
    // The known-correct structured report (findings + measurements + impression).
    referenceJson: jsonb("reference_json").notNull(),
    // The critical findings that MUST be recalled (subset of reference).
    referenceCriticalsJson: jsonb("reference_criticals_json"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ caseKey: uniqueIndex("ai_golden_case_key").on(t.caseKey) }),
);
export type AiGoldenCase = typeof aiGoldenCasesTable.$inferSelect;

export const aiEvaluationRunsTable = pgTable(
  "ai_evaluation_runs",
  {
    id: serial("id").primaryKey(),
    versionRef: text("version_ref").notNull(),
    goldenSetSize: integer("golden_set_size").notNull().default(0),
    // Aggregate metrics: { criticalRecall, validationRate, findingF1, caseCount, ... }
    metricsJson: jsonb("metrics_json"),
    passed: boolean("passed").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ versionIdx: index("ai_eval_run_version_idx").on(t.versionRef) }),
);
export type AiEvaluationRun = typeof aiEvaluationRunsTable.$inferSelect;

export const aiEvaluationCaseResultsTable = pgTable(
  "ai_evaluation_case_results",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => aiEvaluationRunsTable.id),
    caseKey: text("case_key").notNull(),
    passed: boolean("passed").notNull().default(false),
    validationOk: boolean("validation_ok").notNull().default(false),
    criticalRecall: integer("critical_recall"), // 0-100
    diffsJson: jsonb("diffs_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ runIdx: index("ai_eval_case_run_idx").on(t.runId) }),
);
export type AiEvaluationCaseResult = typeof aiEvaluationCaseResultsTable.$inferSelect;
