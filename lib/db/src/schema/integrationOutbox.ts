import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { integrationPartnersTable } from "./integrationPartners";

// ============================================================================
// Transactional outbox for outbound inter-org events (CARE → HOPE).
//
// The brief requires the workflow to survive downtime: a doctor's prescription
// must still save when CARE is unavailable, and CARE-side status/result events
// must reach HOPE reliably. There is no outbox in the codebase today, so we add
// one modelled on the sync_queue / ai_job_queue shapes already used here.
//
// Rows are written in the SAME transaction as the state change that produced
// them (e.g. a report finalisation), then a node-cron dispatcher claims pending
// rows, POSTs them to the partner's signed callback URL, and records each
// attempt. Idempotency: unique event_id + unique idempotency_key; the receiver
// (HOPE) also dedupes on event_id. Dead-lettering after max_attempts.
// ============================================================================
export const integrationOutboxTable = pgTable("integration_outbox", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(), // e.g. diagnostic_report.finalised
  eventVersion: text("event_version").notNull().default("1.0"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  correlationId: text("correlation_id"), // referral_uuid, ties a saga together
  aggregateType: text("aggregate_type").notNull().default("diagnostic_referral"),
  aggregateId: text("aggregate_id"),
  partnerId: integer("partner_id").references(() => integrationPartnersTable.id),
  sourceOrg: text("source_org").notNull().default("CARE"),
  destinationOrg: text("destination_org").notNull().default("HOPE"),
  payload: jsonb("payload").notNull(),
  // pending | sending | sent | failed | dead
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(8),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  // Worker claim marker so concurrent dispatchers don't double-send.
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Per-attempt delivery log for the admin failed-integrations view.
export const integrationDeliveryAttemptsTable = pgTable("integration_delivery_attempts", {
  id: serial("id").primaryKey(),
  outboxId: integer("outbox_id").notNull().references(() => integrationOutboxTable.id),
  attemptNo: integer("attempt_no").notNull(),
  status: text("status").notNull(), // success | failure
  httpStatus: integer("http_status"),
  responseBody: text("response_body"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IntegrationOutbox = typeof integrationOutboxTable.$inferSelect;
export type InsertIntegrationOutbox = typeof integrationOutboxTable.$inferInsert;
export type IntegrationDeliveryAttempt = typeof integrationDeliveryAttemptsTable.$inferSelect;
