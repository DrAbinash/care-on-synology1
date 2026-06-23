import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Phase 21: Critical Finding Escalation
export const criticalFindingsTable = pgTable(
  "critical_findings",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id").notNull(),
    worklistId: integer("worklist_id"),
    patientId: integer("patient_id"),
    findingKeywords: text("finding_keywords").notNull(), // JSON array of matched keywords
    severity: text("severity").notNull().default("high"), // high | critical
    status: text("status").notNull().default("pending_notification"), // pending_notification | notified | acknowledged | escalated
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    notifiedTo: text("notified_to"), // email or phone
    notificationMethod: text("notification_method"), // email | sms | whatsapp
    escalationReason: text("escalation_reason"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    reportIdx: index("cf_report_idx").on(t.reportId),
    statusIdx: index("cf_status_idx").on(t.status),
    patientIdx: index("cf_patient_idx").on(t.patientId),
  }),
);
export type CriticalFinding = typeof criticalFindingsTable.$inferSelect;
