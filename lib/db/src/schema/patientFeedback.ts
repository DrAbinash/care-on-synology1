import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Post-report patient feedback / NPS — additive, non-financial, feature-flagged
 * (ff_feedback_nps, Shadow Mode). After a report is delivered, a daily job mints
 * a tokenized, unauthenticated feedback link and WhatsApps it to the patient.
 * The patient opens it (no login) and submits an NPS score (0–10) + optional
 * comment. One request per report (unique report_id); one response per request.
 */
export const feedbackRequestsTable = pgTable(
  "feedback_requests",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull(),
    patientId: integer("patient_id").notNull(),
    reportId: integer("report_id"),                  // one request per report
    phone: text("phone"),
    patientName: text("patient_name"),
    testName: text("test_name"),
    channel: text("channel").notNull().default("whatsapp"),
    // pending → sent → responded; expired if the link lapses unused.
    status: text("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    tokenUq: uniqueIndex("feedback_requests_token_uq").on(t.token),
    reportUq: uniqueIndex("feedback_requests_report_uq").on(t.reportId),
    byStatus: index("feedback_requests_status_idx").on(t.status),
    byPatient: index("feedback_requests_patient_idx").on(t.patientId),
  }),
);

export const feedbackResponsesTable = pgTable(
  "feedback_responses",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    patientId: integer("patient_id"),
    reportId: integer("report_id"),
    npsScore: integer("nps_score").notNull(),         // 0–10
    stars: integer("stars"),                          // optional 1–5
    comment: text("comment"),
    category: text("category"),                       // promoter | passive | detractor (denormalized)
    userAgent: text("user_agent"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRequest: index("feedback_responses_request_idx").on(t.requestId),
    bySubmitted: index("feedback_responses_submitted_idx").on(t.submittedAt),
  }),
);

export type FeedbackRequest = typeof feedbackRequestsTable.$inferSelect;
export type FeedbackResponse = typeof feedbackResponsesTable.$inferSelect;
