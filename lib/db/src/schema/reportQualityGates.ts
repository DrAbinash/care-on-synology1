import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Phase 20: Report Quality Gate
export const reportQualityGatesTable = pgTable(
  "report_quality_gates",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id").notNull().unique(),
    findingsPresent: boolean("findings_present").notNull().default(false),
    impressionPresent: boolean("impression_present").notNull().default(false),
    signaturePresent: boolean("signature_present").notNull().default(false),
    clinicalHistoryPresent: boolean("clinical_history_present").notNull().default(false),
    techniquePresent: boolean("technique_present").notNull().default(false),
    comparisonPresent: boolean("comparison_present").notNull().default(false),
    allPassed: boolean("all_passed").notNull().default(false),
    failedChecks: text("failed_checks"), // JSON array of failed check names
    passedAt: timestamp("passed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    reportIdx: index("rqg_report_idx").on(t.reportId),
    passedIdx: index("rqg_passed_idx").on(t.allPassed),
  }),
);
export type ReportQualityGate = typeof reportQualityGatesTable.$inferSelect;
