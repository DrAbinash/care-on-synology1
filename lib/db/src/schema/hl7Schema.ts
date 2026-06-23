import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

/**
 * HL7 integration settings — one row per installation.
 * This is a foundation / placeholder — no live network listener is started
 * automatically. Inbound messages arrive via POST /api/internal/hl7/inbound
 * authenticated with an endpoint secret.
 */
export const hl7IntegrationSettingsTable = pgTable("hl7_integration_settings", {
  id: serial("id").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  sendingFacility: text("sending_facility"),
  receivingFacility: text("receiving_facility"),
  hl7Version: text("hl7_version").notNull().default("2.5"),
  // Comma-separated: ADT,ORM,ORU
  enabledMessageTypes: text("enabled_message_types"),
  // Bearer token that protects the inbound endpoint
  inboundEndpointSecret: text("inbound_endpoint_secret"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Log of every inbound and outbound HL7 message.
 */
export const hl7MessagesTable = pgTable(
  "hl7_messages",
  {
    id: serial("id").primaryKey(),
    direction: text("direction").notNull(), // INBOUND | OUTBOUND
    messageType: text("message_type").notNull(), // ADT | ORM | ORU
    sendingFacility: text("sending_facility"),
    receivingFacility: text("receiving_facility"),
    patientId: text("patient_id"),
    accessionNumber: text("accession_number"),
    messageControlId: text("message_control_id"),
    status: text("status").notNull().default("received"), // received | processed | error | ignored
    rawMessage: text("raw_message"),
    parsedJson: text("parsed_json"),
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byType: index("hl7_msg_type_idx").on(t.messageType),
    byCreated: index("hl7_msg_created_idx").on(t.createdAt),
  }),
);

export type Hl7IntegrationSettings = typeof hl7IntegrationSettingsTable.$inferSelect;
export type Hl7Message = typeof hl7MessagesTable.$inferSelect;
