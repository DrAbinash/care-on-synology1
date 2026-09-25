import { pgTable, serial, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";

/**
 * WhatsApp Delivery v2 — Lane 1 staff-click queue + audit.
 * No Meta/Cloud API dispatch. Rows hold prefilled wa.me payloads for humans.
 */

export const waDeliveryQueueTable = pgTable(
  "wa_delivery_queue",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // booking | report | bill | chatbot_handoff
    status: text("status").notNull().default("pending"), // pending | sent | cancelled
    patientPhone: text("patient_phone").notNull().default(""),
    doctorPhone: text("doctor_phone").notNull().default(""),
    prefilledMessage: text("prefilled_message").notNull().default(""),
    recordId: text("record_id").notNull().default(""), // bookingRef / billId / reportId
    patientName: text("patient_name").notNull().default(""),
    bookingRef: text("booking_ref").notNull().default(""),
    source: text("source").notNull().default(""), // online_booking | chatbot | staff
    createdByName: text("created_by_name").notNull().default(""),
    sentByName: text("sent_by_name"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("wa_delivery_queue_status_idx").on(t.status),
    index("wa_delivery_queue_kind_idx").on(t.kind),
  ],
);

export const waDeliveryAuditTable = pgTable(
  "wa_delivery_audit",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull().default(""),
    kind: text("kind").notNull(), // report | bill | booking | chatbot_handoff | override
    recordId: text("record_id").notNull().default(""),
    maskedPhone: text("masked_phone").notNull().default("****"),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
    channel: text("channel").notNull().default("wa-me"), // wa-me | clipboard | override
    consentOverride: boolean("consent_override").notNull().default(false),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wa_delivery_audit_created_idx").on(t.createdAt)],
);

export type WaDeliveryQueueRow = typeof waDeliveryQueueTable.$inferSelect;
export type WaDeliveryAuditRow = typeof waDeliveryAuditTable.$inferSelect;
