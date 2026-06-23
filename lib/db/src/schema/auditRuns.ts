import { pgTable, serial, text, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";

/**
 * Persisted snapshot of a Money-Trail / Books-Sanity audit. Created either
 * manually from the super-admin "Money Trail Audit" page (when the operator
 * clicks "Mark Audit Complete") or automatically by the monthly cron job on
 * the 1st of each month.
 *
 * `snapshot` stores the full report JSON (periodTotals + anomalies[]) so the
 * historical record stays readable even if the underlying bills/payments are
 * later edited.
 */
export const auditRunsTable = pgTable("audit_runs", {
  id: serial("id").primaryKey(),
  periodFrom: text("period_from").notNull(),                     // YYYY-MM-DD
  periodTo: text("period_to").notNull(),                         // YYYY-MM-DD
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),                        // null = draft / auto-run not yet reviewed
  completedBy: text("completed_by"),                             // who marked it complete (or "system:cron")
  source: text("source").notNull().default("manual"),            // "manual" | "cron"
  notes: text("notes"),                                          // free-text reviewer notes
  anomalyCount: integer("anomaly_count").notNull().default(0),
  highCount: integer("high_count").notNull().default(0),
  totalImpact: numeric("total_impact", { precision: 14, scale: 2 }).notNull().default("0"),
  snapshot: jsonb("snapshot").notNull(),                          // full report payload
  emailSentAt: timestamp("email_sent_at"),                        // populated when cron emails it
});

export type AuditRun = typeof auditRunsTable.$inferSelect;
export type NewAuditRun = typeof auditRunsTable.$inferInsert;
