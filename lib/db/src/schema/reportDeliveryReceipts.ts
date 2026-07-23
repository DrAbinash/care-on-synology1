import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Read-receipt / delivery-status tracking for STAFF-SELECTED WhatsApp report
 * sends. One row per (report → patient) WhatsApp delivery a staff member
 * explicitly triggers from the delivery-tracking screen. This is deliberately
 * NOT a bulk send-everything log — staff pick which reports go out (the clinic
 * has no infra to push every report online), and only those sends are tracked
 * here for delivery/read receipts and unread-reminders.
 *
 * The Meta WhatsApp Cloud API returns a message id (`provider_message_id`) at
 * send time and later POSTs sent/delivered/read/failed callbacks to the
 * webhook keyed by that same id — so the id is how a receipt row is matched and
 * advanced through its status lifecycle. Additive, non-financial.
 */
export const reportDeliveryReceiptsTable = pgTable(
  "report_delivery_receipts",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id"),                 // FK → patient_reports.id (soft)
    patientId: integer("patient_id"),               // FK → patients.id (soft)
    providerMessageId: text("provider_message_id"), // Meta wa-id; matched by the webhook
    phone: text("phone").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    reportNumber: text("report_number"),
    testName: text("test_name"),
    patientName: text("patient_name"),
    viewerUrl: text("viewer_url"),
    // sent → delivered → read (happy path); failed at any point.
    status: text("status").notNull().default("sent"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    sentBy: text("sent_by"),          // staff subjectId
    sentByName: text("sent_by_name"), // staff display name
    remindersCount: integer("reminders_count").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byReport: index("rdr_report_idx").on(t.reportId),
    byPatient: index("rdr_patient_idx").on(t.patientId),
    byStatus: index("rdr_status_idx").on(t.status),
    byProviderMsg: index("rdr_provider_msg_idx").on(t.providerMessageId),
  }),
);

export type ReportDeliveryReceipt = typeof reportDeliveryReceiptsTable.$inferSelect;
