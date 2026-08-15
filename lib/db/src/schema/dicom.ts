import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// DICOM modality registry. Each row is one imaging device or PACS node that
// the ERP knows about (CT scanner, MRI, CR/DR, ultrasound, etc.) — used for
// the DICOM Node Configuration page, MWL push targets, and connection tests.
//
// Auto-Pull fields: when autoPull=true the ERP's cron scheduler creates a
// dicom_pull_job every pullIntervalMinutes. The local DICOM Pull Agent
// (dicom-pull-agent/ service, running on the Conquest server) picks up the job,
// runs findscu + movescu against the machine, and reports results back.
export const dicomNodesTable = pgTable("dicom_nodes", {
  id: serial("id").primaryKey(),
  aeTitle: text("ae_title").notNull().unique(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(104),
  // Modality short code per DICOM PS3.3 C.7.3.1.1.1
  modality: text("modality").notNull().default("OT"),
  // Friendly display name (e.g. "UIH MRI", "CT Machine", "Voluson USG")
  name: text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),

  // ── Auto-Pull (Q/R) configuration ──────────────────────────────────────────
  // When enabled the cron scheduler creates pull jobs on the configured interval.
  autoPull: boolean("auto_pull").notNull().default(false),
  // How often to pull in seconds (300 = 5 min; MRI preset uses 1200 = 20 min).
  pullIntervalSeconds: integer("pull_interval_seconds").notNull().default(300),
  // How many hours back the C-FIND query should cover (24 = 1 day).
  queryLookbackHours: integer("query_lookback_hours").notNull().default(24),
  // Conquest PACS destination — the AE Title, host, and port that movescu will
  // move studies INTO. Defaults to the global CONQUEST_AE_TITLE env var when blank.
  conquestAeTitle: text("conquest_ae_title").notNull().default(""),
  conquestHost: text("conquest_host").notNull().default(""),
  conquestPort: integer("conquest_port").notNull().default(5678),

  // Preferred retrieve method for this node.
  // C_MOVE | C_GET | C_STORE | WATCH_FOLDER | C_STORE_OR_WATCH_FOLDER | USB_DICOMDIR | NON_DICOM_JPG_PNG
  preferredRetrieveMethod: text("preferred_retrieve_method").notNull().default("C_MOVE"),

  // ── USG / Voluson-specific file-system import paths ─────────────────────────
  watchFolderPath: text("watch_folder_path").notNull().default(""),
  processedFolderPath: text("processed_folder_path").notNull().default(""),
  failedFolderPath: text("failed_folder_path").notNull().default(""),

  // ── Acquisition & matching flags (USG / non-DICOM) ─────────────────────────
  allowNonDicomImages: boolean("allow_non_dicom_images").notNull().default(false),
  maxUploadSizeMB: integer("max_upload_size_mb").notNull().default(512),
  thumbnailPreview: boolean("thumbnail_preview").notNull().default(true),
  multiFrameSupport: boolean("multi_frame_support").notNull().default(true),
  // JSON objects stored as text for acquisitionModes and matchingRules
  acquisitionModesJson: text("acquisition_modes_json").notNull().default("{}"),
  matchingRulesJson: text("matching_rules_json").notNull().default("{}"),

  // ── Auto-Pull status ────────────────────────────────────────────────────────
  lastPullAt: timestamp("last_pull_at", { withTimezone: true }),
  lastPullStatus: text("last_pull_status"),   // 'success' | 'failed' | 'partial'
  lastPullMessage: text("last_pull_message"),

  // ── Connection test telemetry ───────────────────────────────────────────────
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestStatus: text("last_test_status"),   // 'success' | 'failed' | null
  lastTestMessage: text("last_test_message"),
  lastTestLatencyMs: integer("last_test_latency_ms"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDicomNodeSchema = createInsertSchema(dicomNodesTable).omit({
  id: true, createdAt: true, updatedAt: true,
  lastTestAt: true, lastTestStatus: true, lastTestMessage: true, lastTestLatencyMs: true,
  lastPullAt: true, lastPullStatus: true, lastPullMessage: true,
});
export type InsertDicomNode = z.infer<typeof insertDicomNodeSchema>;
export type DicomNode = typeof dicomNodesTable.$inferSelect;

// ── DICOM Pull Jobs ──────────────────────────────────────────────────────────
// One row per pull attempt. The local DICOM Pull Agent picks up rows with
// status='pending', sets them to 'running', then writes the final outcome.
//
// Lifecycle: pending → running → completed | failed | partial
export const dicomPullJobsTable = pgTable("dicom_pull_jobs", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id").notNull(),          // FK → dicom_nodes.id
  // 'manual' = triggered by staff button; 'auto' = triggered by cron
  triggerType: text("trigger_type").notNull().default("manual"),
  // Status: pending | running | completed | failed | partial
  status: text("status").notNull().default("pending"),
  // ISO date string (YYYY-MM-DD) of the study date range to query
  queryDateFrom: text("query_date_from").notNull(),
  queryDateTo: text("query_date_to").notNull(),
  // Results reported by the agent
  studiesFound: integer("studies_found"),
  studiesPulled: integer("studies_pulled"),
  studiesFailed: integer("studies_failed"),
  studyInstanceUIDs: text("study_instance_uids"),  // JSON array of pulled UIDs
  errorMessage: text("error_message"),
  // Agent telemetry
  agentId: text("agent_id"),                       // hostname of the agent machine
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DicomPullJob = typeof dicomPullJobsTable.$inferSelect;
