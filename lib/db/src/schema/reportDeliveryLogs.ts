import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Audit log for every WhatsApp / email report delivery attempt.
 * Both successful sends and failures are recorded here.
 */
export const reportDeliveryLogsTable = pgTable(
  "report_delivery_logs",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id"),           // FK → patient_reports.id (nullable for worklist-only)
    patientId: integer("patient_id"),
    studyId: integer("study_id"),
    accessionNumber: text("accession_number"),
    deliveryMode: text("delivery_mode").notNull(), // WHATSAPP | EMAIL | BOTH
    recipientPhone: text("recipient_phone"),
    recipientEmail: text("recipient_email"),
    status: text("status").notNull().default("pending"), // pending | sent | failed | retried
    messageText: text("message_text"),
    sentBy: text("sent_by"),                  // staff name
    sentAt: timestamp("sent_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    rawResponse: text("raw_response"),        // JSON response from provider
    errorMessage: text("error_message"),
    pdfAttached: text("pdf_attached"),        // "yes" | "no" | null
    verificationLink: text("verification_link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReport: index("rdl_report_idx").on(t.reportId),
    byPatient: index("rdl_patient_idx").on(t.patientId),
    byCreated: index("rdl_created_idx").on(t.createdAt),
  }),
);

export type ReportDeliveryLog = typeof reportDeliveryLogsTable.$inferSelect;
