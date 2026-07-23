import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Recall / follow-up engine — additive, non-financial, feature-flagged
 * (ff_recall_engine, Shadow Mode). A recall RULE maps reports (by test name or
 * all) to a follow-up interval; a daily job derives a recall QUEUE entry due
 * `intervalDays` after a report was delivered, then WhatsApps the patient a
 * gentle follow-up reminder. Patients can be opted out per-queue-entry.
 */
export const recallRulesTable = pgTable(
  "recall_rules",
  {
    id: serial("id").primaryKey(),
    label: text("label").notNull(),
    // 'test' → report title contains matchValue (case-insensitive); 'all' → every delivered report.
    matchType: text("match_type").notNull().default("all"),
    matchValue: text("match_value"),
    intervalDays: integer("interval_days").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    messageTemplate: text("message_template").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({ byEnabled: index("recall_rules_enabled_idx").on(t.enabled) }),
);

export const recallQueueTable = pgTable(
  "recall_queue",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    reportId: integer("report_id"),
    ruleId: integer("rule_id"),
    testName: text("test_name"),
    phone: text("phone"),
    patientName: text("patient_name"),
    dueDate: text("due_date").notNull(),                 // YYYY-MM-DD (IST)
    // pending → sent (happy path); snoozed | opted_out | cancelled otherwise.
    status: text("status").notNull().default("pending"),
    channel: text("channel").notNull().default("whatsapp"),
    messageSnapshot: text("message_snapshot"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    remindersCount: integer("reminders_count").notNull().default(0),
    lastError: text("last_error"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStatus: index("recall_queue_status_idx").on(t.status),
    byDue: index("recall_queue_due_idx").on(t.dueDate),
    byPatient: index("recall_queue_patient_idx").on(t.patientId),
    // Idempotency: one recall per (patient, report, rule) so re-running
    // generation never duplicates. (report_id NULL rows are always distinct.)
    uq: uniqueIndex("recall_queue_dedupe_uq").on(t.patientId, t.reportId, t.ruleId),
  }),
);

export type RecallRule = typeof recallRulesTable.$inferSelect;
export type RecallQueueEntry = typeof recallQueueTable.$inferSelect;
