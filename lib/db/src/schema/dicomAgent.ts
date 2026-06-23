import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// dicom_pull_agent_logs — structured event log written by the Windows/Linux
// DICOM Pull Agent for every operational event.
// Written via POST /api/internal/dicom-agent/log (Bearer INTERNAL_API_KEY).
export const dicomPullAgentLogsTable = pgTable("dicom_pull_agent_logs", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name"),
  agentHost: text("agent_host"),
  eventType: text("event_type").notNull(),   // C_ECHO | C_FIND | C_MOVE | C_STORE | HEARTBEAT | ERP_POST
  sourceAeTitle: text("source_ae_title"),
  sourceIp: text("source_ip"),
  modality: text("modality"),
  studyInstanceUID: text("study_instance_uid"),
  accessionNumber: text("accession_number"),
  patientName: text("patient_name"),
  patientId: text("patient_id"),
  status: text("status").notNull().default("INFO"),  // SUCCESS | FAILED | WARNING | INFO
  message: text("message").notNull(),
  rawPayload: text("raw_payload"),   // JSON-serialised for traceability
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DicomPullAgentLog = typeof dicomPullAgentLogsTable.$inferSelect;

// dicom_pull_agent_status — one row per named agent; upserted on each heartbeat.
// Written via POST /api/internal/dicom-agent/heartbeat (Bearer INTERNAL_API_KEY).
export const dicomPullAgentStatusTable = pgTable("dicom_pull_agent_status", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name").notNull(),
  agentHost: text("agent_host").notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  lastSuccessfulPullAt: timestamp("last_successful_pull_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  isOnline: boolean("is_online").notNull().default(false),
  studiesFoundToday: integer("studies_found_today").notNull().default(0),
  studiesPulledToday: integer("studies_pulled_today").notNull().default(0),
  failedToday: integer("failed_today").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DicomPullAgentStatus = typeof dicomPullAgentStatusTable.$inferSelect;
