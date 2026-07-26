import { pgTable, serial, text, boolean, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// =============================================================================
// wa_outbox — the single enqueue point for every outbound WhatsApp send.
//
// Modeled directly on services/integration/outbox.ts's integration_outbox
// (CARE -> HOPE transactional outbox): rows are inserted by
// enqueueWhatsAppMessage(), a background dispatcher claims pending rows with
// FOR UPDATE SKIP LOCKED, attempts delivery via the Meta Cloud API, and
// records each attempt in wa_delivery_attempts. Idempotent on
// idempotency_key. No access tokens or unnecessary PHI are stored here —
// payload_json holds only the rendered message body/template params, not
// credentials.
// =============================================================================
export const waOutboxTable = pgTable("wa_outbox", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id"),
  appointmentId: integer("appointment_id"),
  billId: integer("bill_id"),
  reportId: integer("report_id"),
  phoneNumberId: text("phone_number_id"),
  recipientPhone: text("recipient_phone").notNull(),
  // appointment_reminder | dues_reminder | report_ready | bill_created | payment_link | otp | chatbot_reply | manual_staff_send | test_send
  messagePurpose: text("message_purpose").notNull(),
  templateKey: text("template_key"),
  templateVersion: text("template_version"),
  payloadJson: text("payload_json").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull(),
  // queued | processing | accepted | sent | delivered | read | retry_scheduled | failed | dead_letter | suppressed
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(5),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  providerMessageId: text("provider_message_id"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  suppressedReason: text("suppressed_reason"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("wa_outbox_idempotency_key_uq").on(t.idempotencyKey),
  index("wa_outbox_status_next_attempt_idx").on(t.status, t.nextAttemptAt),
  index("wa_outbox_recipient_phone_idx").on(t.recipientPhone),
  index("wa_outbox_patient_idx").on(t.patientId),
  index("wa_outbox_provider_message_idx").on(t.providerMessageId),
]);

// Per-attempt delivery log for the dispatcher + admin diagnostics view.
export const waDeliveryAttemptsTable = pgTable("wa_delivery_attempts", {
  id: serial("id").primaryKey(),
  outboxId: integer("outbox_id").notNull().references(() => waOutboxTable.id),
  attemptNo: integer("attempt_no").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  httpStatus: integer("http_status"),
  providerErrorCode: text("provider_error_code"),
  responseSanitized: text("response_sanitized"),
  success: boolean("success").notNull().default(false),
  retryScheduledAt: timestamp("retry_scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("wa_delivery_attempts_outbox_idx").on(t.outboxId),
]);

export type WaOutboxRow = typeof waOutboxTable.$inferSelect;
export type InsertWaOutboxRow = typeof waOutboxTable.$inferInsert;
export type WaDeliveryAttempt = typeof waDeliveryAttemptsTable.$inferSelect;
