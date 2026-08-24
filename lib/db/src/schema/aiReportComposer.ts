/**
 * Background AI Report Composer — job artifacts (assistant only until Apply).
 * Guard: model output is NEVER the report of record until explicit Apply
 * through the canonical workspace mutation path.
 */
import { pgTable, serial, integer, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Lifecycle of the composition JOB (not per-change review state).
 * Tracked changes inside a READY draft keep their own reviewState:
 * PENDING | ACCEPTED | REJECTED | EDITED.
 */
export const AI_COMPOSE_JOB_STATUSES = [
  "QUEUED",
  "COMPOSING",
  "READY",
  "STALE_READY",
  "FAILED",
  "CANCELLED",
  "OBSOLETE",
  "DISCARDED",
  "APPLIED",
] as const;
export type AiComposeJobStatus = (typeof AI_COMPOSE_JOB_STATUSES)[number];

export const AI_COMPOSE_JOB_KINDS = [
  "FULL_REPORT",
  "IMPRESSION",
  "SECTION_EDIT",
  "SELECTION_EDIT",
  "TRANSLATE",
  "REPHRASE",
  "SHORTEN",
  "EXPAND",
] as const;
export type AiComposeJobKind = (typeof AI_COMPOSE_JOB_KINDS)[number];

export const aiReportComposeJobsTable = pgTable(
  "ai_report_compose_jobs",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id"),
    worklistId: integer("worklist_id"),
    reportId: integer("report_id"),
    jobKind: text("job_kind").notNull().default("FULL_REPORT"),
    status: text("status").notNull().default("QUEUED"),
    // Snapshot / revision — server-verified; AI input is the frozen snapshot (Model B).
    sourceReportRevision: text("source_report_revision").notNull(),
    sourceFindingsHash: text("source_findings_hash").notNull(),
    sourceImpressionHash: text("source_impression_hash").notNull(),
    sourceRecommendationHash: text("source_recommendation_hash").notNull().default(""),
    inputHash: text("input_hash").notNull(),
    inputSnapshotJson: text("input_snapshot_json").notNull(),
    // Outputs — assistant artifacts only until Apply
    outputPlanJson: text("output_plan_json"),
    trackedChangesJson: text("tracked_changes_json"),
    proposedFindings: text("proposed_findings"),
    proposedImpression: text("proposed_impression"),
    proposedRecommendation: text("proposed_recommendation"),
    validationJson: text("validation_json"),
    model: text("model"),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    latencyMs: integer("latency_ms"),
    safeError: text("safe_error"),
    createdBy: text("created_by"),
    createdByStaffId: integer("created_by_staff_id"),
    appliedBy: text("applied_by"),
    appliedByStaffId: integer("applied_by_staff_id"),
    queueJobId: integer("queue_job_id"),
    priority: integer("priority").notNull().default(50),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    // Retention: when input_snapshot_json was pruned (audit metadata retained)
    snapshotPrunedAt: timestamp("snapshot_pruned_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byWorklist: index("ai_report_compose_jobs_worklist_idx").on(t.worklistId),
    byStudy: index("ai_report_compose_jobs_study_idx").on(t.studyId),
    byStatus: index("ai_report_compose_jobs_status_idx").on(t.status),
    byInputHash: index("ai_report_compose_jobs_input_hash_idx").on(t.worklistId, t.inputHash, t.status),
    idemUq: uniqueIndex("ai_report_compose_jobs_idem_uq")
      .on(t.worklistId, t.sourceReportRevision, t.inputHash, t.jobKind)
      .where(sql`${t.status} IN ('QUEUED', 'COMPOSING')`),
  }),
);

export type AiReportComposeJob = typeof aiReportComposeJobsTable.$inferSelect;
export type InsertAiReportComposeJob = typeof aiReportComposeJobsTable.$inferInsert;
