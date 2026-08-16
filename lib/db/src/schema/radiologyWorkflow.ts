/**
 * Radiology Workflow & DICOM Operations Schema — Phase 12
 * Real modular architecture for:
 *   - MWL entries, acquisition gateway, AI pipeline
 *   - radiologist productivity tools, critical alerts, storage lifecycle
 *   - enterprise security access logs
 */

import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { radiologyStudiesTable } from "./radiology";

// ── 1. MWL Entries ─────────────────────────────────────────────────────────────────────────────────────────

export const mwlEntriesTable = pgTable(
  "mwl_entries",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    accessionNumber: text("accession_number").notNull(),
    modality: text("modality").notNull().default("OT"),
    scheduledProcedureStepId: text("scheduled_procedure_step_id"),
    scheduledAETitle: text("scheduled_ae_title"),
    scheduledStationName: text("scheduled_station_name"),
    scheduledStartDate: text("scheduled_start_date"),
    scheduledStartTime: text("scheduled_start_time"),
    referringDoctor: text("referring_doctor"),
    bodyPart: text("body_part"),
    studyDescription: text("study_description"),
    priority: text("priority").notNull().default("routine"), // routine | urgent | stat
    status: text("status").notNull().default("scheduled"),
    // scheduled | arrived | in_progress | completed | reported | cancelled
    // Status lifecycle for MWL entries
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    duplicateOfId: integer("duplicate_of_id"),
    // If this MWL was detected as a duplicate, link to the original
    resentAt: timestamp("resent_at", { withTimezone: true }),
    resentCount: integer("resent_count").notNull().default(0),
    pollStatus: text("poll_status").default("pending"),
    // pending | polled | failed
    pollError: text("poll_error"),
    pollFailedAt: timestamp("poll_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    accIdx: index("mwl_accession_idx").on(t.accessionNumber),
    statusIdx: index("mwl_status_idx").on(t.status),
    patientIdx: index("mwl_patient_idx").on(t.patientId),
    modDateIdx: index("mwl_mod_date_idx").on(t.modality, t.scheduledStartDate),
  }),
);
export type MwlEntry = typeof mwlEntriesTable.$inferSelect;

// ── 2. DICOM Incoming Studies (Acquisition Gateway) ─────────────────────────────────────────────────────────────────────────────────

export const dicomIncomingStudiesTable = pgTable(
  "dicom_incoming_studies",
  {
    id: serial("id").primaryKey(),
    studyInstanceUID: text("study_instance_uid").notNull(),
    seriesInstanceUID: text("series_instance_uid"),
    accessionNumber: text("accession_number"),
    modality: text("modality").notNull().default("OT"),
    aeTitle: text("ae_title"),
    expectedAeTitle: text("expected_ae_title"),
    patientName: text("patient_name"),
    patientId: text("patient_id"),
    studyDescription: text("study_description"),
    bodyPart: text("body_part"),
    imageCount: integer("image_count").notNull().default(0),
    seriesCount: integer("series_count").notNull().default(0),
    lastImageReceivedAt: timestamp("last_image_received_at", { withTimezone: true }),
    transferStatus: text("transfer_status").notNull().default("receiving"),
    // receiving | complete | incomplete | failed | quarantined | reprocessed
    transferError: text("transfer_error"),
    aeMismatch: boolean("ae_mismatch").notNull().default(false),
    duplicateStudy: boolean("duplicate_study").notNull().default(false),
    incompleteStudy: boolean("incomplete_study").notNull().default(false),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    quarantineReason: text("quarantine_reason"),
    reprocessedAt: timestamp("reprocessed_at", { withTimezone: true }),
    reprocessCount: integer("reprocess_count").notNull().default(0),
    ingestSource: text("ingest_source").notNull().default("conquest"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    uidIdx: index("incoming_uid_idx").on(t.studyInstanceUID),
    statusIdx: index("incoming_status_idx").on(t.transferStatus),
    modIdx: index("incoming_modality_idx").on(t.modality),
    accIdx: index("incoming_accession_idx").on(t.accessionNumber),
  }),
);
export type DicomIncomingStudy = typeof dicomIncomingStudiesTable.$inferSelect;

// ── 3. AI Job Queue (LEGACY — do not use for overnight MRI) ─────────────────
// Overnight / on-arrival MRI shadow drafts use dicom_retry_queue op
// `ai_shadow_pipeline` (see shadowPipeline.ts). This table remains for
// historical radiology-workflow CRUD/ops surfaces only; do not enqueue new
// overnight work here. Data is retained — do not DROP.

export const aiJobQueueTable = pgTable(
  "ai_job_queue",
  {
    id: serial("id").primaryKey(),
    // FK to the order/financial study spine (Gate G3). The value is always
    // resolved server-side from a canonical identity — never trusted from a
    // client request. The production constraint is added NOT VALID via
    // migrations/add_canonical_study_crosswalk.sql (safe on existing rows).
    studyId: integer("study_id").notNull().references(() => radiologyStudiesTable.id),
    jobType: text("job_type").notNull(),
    // ocr_extraction | impression | structured_report | critical_detection | template_recommendation | auto_coding
    modality: text("modality").notNull().default("OT"),
    status: text("status").notNull().default("queued"),
    // queued | processing | completed | failed | cancelled
    priority: integer("priority").notNull().default(5), // 1 = highest
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    confidenceScore: integer("confidence_score"), // 0-100
    inferenceTimeMs: integer("inference_time_ms"),
    gpuMode: boolean("gpu_mode").notNull().default(false),
    resultJson: text("result_json"),
    errorMessage: text("error_message"),
    humanOverridden: boolean("human_overridden").notNull().default(false),
    overriddenBy: text("overridden_by"),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("ai_job_study_idx").on(t.studyId),
    statusIdx: index("ai_job_status_idx").on(t.status),
    typeIdx: index("ai_job_type_idx").on(t.jobType),
  }),
);
export type AiJobQueue = typeof aiJobQueueTable.$inferSelect;

// ── 4. Radiologist Shortcuts / Hotkeys ────────────────────────────────────────────────────────────────────────────────────

export const radiologistShortcutsTable = pgTable(
  "radiologist_shortcuts",
  {
    id: serial("id").primaryKey(),
    radiologistId: integer("radiologist_id").notNull(),
    keyCombo: text("key_combo").notNull(), // e.g. "ctrl+s", "ctrl+shift+n"
    action: text("action").notNull(),
    // save_draft | approve_report | next_study | insert_template | compare_previous | critical_alert | toggle_ai
    actionParamsJson: text("action_params_json"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    radIdx: index("shortcut_rad_idx").on(t.radiologistId),
  }),
);
export type RadiologistShortcut = typeof radiologistShortcutsTable.$inferSelect;

// ── 5. Radiologist Text Macros ────────────────────────────────────────────────────────────────────────────────────────────────

export const radiologistMacrosTable = pgTable(
  "radiologist_macros",
  {
    id: serial("id").primaryKey(),
    radiologistId: integer("radiologist_id").notNull(),
    trigger: text("trigger").notNull(), // e.g. ".nl" expands to "No abnormality detected"
    expansion: text("expansion").notNull(),
    category: text("category").default("general"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    radIdx: index("macro_rad_idx").on(t.radiologistId),
    triggerIdx: index("macro_trigger_idx").on(t.trigger),
  }),
);
export type RadiologistMacro = typeof radiologistMacrosTable.$inferSelect;

// ── 6. Viewer Window Presets ───────────────────────────────────────────────────────────────────────────────────────────────

export const viewerPresetsTable = pgTable(
  "viewer_presets",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // Brain, Stroke, Bone, Chest, Spine, Abdomen
    modality: text("modality").notNull().default("CT"),
    bodyPart: text("body_part"),
    windowCenter: integer("window_center").notNull(),
    windowWidth: integer("window_width").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    modIdx: index("preset_modality_idx").on(t.modality),
  }),
);
export type ViewerPreset = typeof viewerPresetsTable.$inferSelect;

// ── 7. Study Access Log (Enterprise Security) ───────────────────────────────────────────────────────────────────────────────────────

export const studyAccessLogTable = pgTable(
  "study_access_log",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    userId: integer("user_id").notNull(),
    userName: text("user_name"),
    userRole: text("user_role"),
    action: text("action").notNull(),
    // view | download | print | edit | share | export | watermark_download | break_glass
    ipAddress: text("ip_address"),
    deviceInfo: text("device_info"),
    sessionId: text("session_id"),
    detailsJson: text("details_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    studyIdx: index("access_study_idx").on(t.studyId),
    userIdx: index("access_user_idx").on(t.userId),
    actionIdx: index("access_action_idx").on(t.action),
  }),
);
export type StudyAccessLog = typeof studyAccessLogTable.$inferSelect;

// ── 8. PACS Storage Tier / Lifecycle ──────────────────────────────────────────────────────────────────────────────────────────

export const pacsStorageTierTable = pgTable(
  "pacs_storage_tier",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    modality: text("modality").notNull().default("OT"),
    currentTier: text("current_tier").notNull().default("hot"),
    // hot | warm | cold | archive
    previousTier: text("previous_tier"),
    migratedAt: timestamp("migrated_at", { withTimezone: true }),
    migrateReason: text("migrate_reason"),
    // auto_archive | manual | compression | orphan_cleanup
    compressionRatio: integer("compression_ratio"), // percentage saved
    isOrphan: boolean("is_orphan").notNull().default(false),
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    originalStudyId: integer("original_study_id"),
    sizeBytes: integer("size_bytes"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("tier_study_idx").on(t.studyId),
    tierIdx: index("tier_current_idx").on(t.currentTier),
  }),
);
export type PacsStorageTier = typeof pacsStorageTierTable.$inferSelect;
