import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * operational_health_runs — recent Deployment Smoke Test / Operational Health
 * results (Phase 6). Populated by the `smoke:production` CLI (--save-result)
 * and the admin "Run full smoke test" action. Never stores secrets or PHI:
 * `checks_json` holds only the already-redacted per-check summaries.
 *
 * A small purpose-specific table — no existing canonical table stores a
 * multi-service smoke-test run (audit_logs are per-action; ops_check_history is
 * the radiology-integrity persisted-proof store, a different concern). Retention
 * is bounded by the writer (keeps the newest N rows).
 */
export const operationalHealthRunsTable = pgTable(
  "operational_health_runs",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    // deployment | cli | admin | scheduled
    trigger: text("trigger").notNull(),
    // PASS | WARNING | FAIL | SKIPPED | UNKNOWN
    overallStatus: text("overall_status").notNull(),
    version: text("version"),
    gitCommit: text("git_commit"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    // { pass, warning, fail, skipped, unknown, total }
    summaryJson: jsonb("summary_json").notNull(),
    // [{ id, name, category, status, message, durationMs, recommendedAction }] — safe, redacted
    checksJson: jsonb("checks_json").notNull(),
    // Human label for a manual admin run (staff name); null for CLI/deployment.
    initiatedBy: text("initiated_by"),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreated: index("operational_health_runs_created_idx").on(t.createdAt),
  }),
);

export type OperationalHealthRun = typeof operationalHealthRunsTable.$inferSelect;
