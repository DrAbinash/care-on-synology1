import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ══ dicom_studies ══ Canonical study registry ═══════════════════════════════════════
// One row per unique DICOM study. Ingested from any source (Orthanc, Conquest,
// DICOMweb, local folder, HL7). Serves as the single source of truth for the
// RIS/PACS workflow layer sitting above Phase 9 USG reporting.
export const dicomStudiesTable = pgTable(
  "dicom_studies",
  {
    id: serial("id").primaryKey(),
    // ── Core DICOM identifiers ──
    studyInstanceUID:  text("study_instance_uid").notNull().unique(),
    seriesInstanceUID: text("series_instance_uid"),  // primary series (or first)
    sopInstanceUID:    text("sop_instance_uid"),       // representative image
    accessionNumber:   text("accession_number"),
    // ── Patient demographics (from DICOM tags; ERP patientId resolved separately) ──
    patientId:         integer("patient_id"),          // FK → patients.id when matched
    dicomPatientId:    text("dicom_patient_id"),       // raw DICOM PatientID tag
    patientName:       text("patient_name").notNull(),
    patientAge:        text("patient_age"),
    patientSex:        text("patient_sex"),
    // ── Study metadata ──
    modality:          text("modality").notNull().default("OT"),
    studyDate:         text("study_date"),
    studyTime:         text("study_time"),
    referringDoctor:   text("referring_doctor"),
    performingTechnician: text("performing_technician"),
    studyDescription:  text("study_description"),
    bodyPartExamined:  text("body_part_examined"),
    institutionName:   text("institution_name"),
    stationName:       text("station_name"),
    numberOfSeries:    integer("number_of_series").notNull().default(0),
    numberOfImages:    integer("number_of_images").notNull().default(0),
    // ── Ingest lifecycle ──
    ingestStatus: text("ingest_status").notNull().default("pending"),
    // pending | ingested | failed | duplicate | linked
    ingestError:  text("ingest_error"),
    ingestSource: text("ingest_source").notNull().default("orthanc"),
    // orthanc | conquest | dicomweb | local_folder | hl7 | manual
    // ── ERP linkage ──
    linkedReportId:    integer("linked_report_id"),    // FK → usg_report_drafts.id
    linkedBillId:      integer("linked_bill_id"),      // FK → bills.id
    linkedOrderId:     integer("linked_order_id"),   // FK → orders.id
    linkStatus:        text("link_status").notNull().default("unlinked"),
    // linked | suggested | conflict | unlinked
    linkConfidence:    text("link_confidence"),        // high | medium | low
    linkReason:        text("link_reason"),            // human-readable why linked
    // ── Worklist assignment ──
    assignedRadiologistId:   integer("assigned_radiologist_id"),
    assignedRadiologistName: text("assigned_radiologist_name"),
    assignedTechnicianId:    integer("assigned_technician_id"),
    assignedTechnicianName:  text("assigned_technician_name"),
    priority: text("priority").notNull().default("routine"),
    // emergency | stat | icu | inpatient | outpatient | corporate | routine
    priorityReason: text("priority_reason"),
    // ── PACS sync ──
    pacsSource:       text("pacs_source").notNull().default("orthanc"),
    lastSyncAt:       timestamp("last_sync_at", { withTimezone: true }),
    syncStatus:       text("sync_status").notNull().default("pending"),
    // synced | pending | failed | conflict
    syncError:        text("sync_error"),
    syncRetryCount:   integer("sync_retry_count").notNull().default(0),
    // ── Report lifecycle (mirrors/extends Phase 9) ──
    reportStatus: text("report_status").notNull().default("not_started"),
    // not_started | draft | verified | finalized | amended | addendum
    reportId:     integer("report_id"),  // FK → usg_report_drafts.id (or future report table)
    // ── Raw metadata blob (full DICOM tags JSON for future use) ──
    dicomMetadata: jsonb("dicom_metadata").notNull().default("{}"),
    // ── Timestamps ──
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    uidIdx:   index("dicom_studies_uid_idx").on(t.studyInstanceUID),
    accIdx:   index("dicom_studies_accession_idx").on(t.accessionNumber),
    patIdx:   index("dicom_studies_patient_idx").on(t.patientId),
    statusIdx:index("dicom_studies_status_idx").on(t.ingestStatus),
    linkIdx:  index("dicom_studies_link_idx").on(t.linkStatus),
    modIdx:   index("dicom_studies_modality_idx").on(t.modality),
    radIdx:   index("dicom_studies_radiologist_idx").on(t.assignedRadiologistId),
    priorityIdx:index("dicom_studies_priority_idx").on(t.priority),
    reportIdx:  index("dicom_studies_report_idx").on(t.reportId),
  }),
);

export type DicomStudy = typeof dicomStudiesTable.$inferSelect;
export const insertDicomStudySchema = createInsertSchema(dicomStudiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDicomStudy = z.infer<typeof insertDicomStudySchema>;

// ══ dicom_study_series ══ Series-level detail per study ══════════════════════════════════════
export const dicomStudySeriesTable = pgTable(
  "dicom_study_series",
  {
    id: serial("id").primaryKey(),
    studyId:         integer("study_id").notNull(),       // FK → dicom_studies.id
    seriesInstanceUID:text("series_instance_uid").notNull(),
    seriesNumber:    integer("series_number").notNull().default(1),
    modality:        text("modality"),
    seriesDescription:text("series_description"),
    bodyPartExamined:text("body_part_examined"),
    numberOfImages:  integer("number_of_images").notNull().default(0),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    studyIdx: index("dicom_series_study_idx").on(t.studyId),
    uidIdx:   index("dicom_series_uid_idx").on(t.seriesInstanceUID),
  }),
);

export type DicomStudySeries = typeof dicomStudySeriesTable.$inferSelect;

// ══ dicom_study_audit_log ══ Immutable append-only lifecycle log ════════════════════════
export const dicomStudyAuditLogTable = pgTable(
  "dicom_study_audit_log",
  {
    id: serial("id").primaryKey(),
    studyId:         integer("study_id").notNull(),
    studyInstanceUID:text("study_instance_uid"),
    action:          text("action").notNull(),
    // study_ingested | duplicate_detected | study_linked | study_unlinked |
    // viewer_opened | technician_scan_completed | radiologist_assigned |
    // ai_suggestion_generated | ai_suggestion_accepted | ai_suggestion_rejected |
    // ocr_value_accepted | ocr_value_rejected | priority_changed |
    // report_created | sync_retry | sync_failed | sync_resolved
    actorId:         integer("actor_id"),
    actorName:       text("actor_name"),
    actorRole:       text("actor_role"),
    details:         text("details"),  // JSON string
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    studyIdx: index("dicom_audit_study_idx").on(t.studyId),
    actionIdx:index("dicom_audit_action_idx").on(t.action),
  }),
);

export type DicomStudyAuditLog = typeof dicomStudyAuditLogTable.$inferSelect;

// ══ ai_extraction_results ══ AI/OCR extraction output with human review state ════════════════════════
export const aiExtractionResultsTable = pgTable(
  "ai_extraction_results",
  {
    id: serial("id").primaryKey(),
    studyId:         integer("study_id").notNull(),
    extractionType:  text("extraction_type").notNull(),
    // dicom_metadata | key_images | measurements_from_overlay |
    // report_template_suggestion | findings_suggestion | prior_comparison | quality_check
    sourceData:      text("source_data"),  // JSON of raw extraction input
    extractedData:   text("extracted_data"), // JSON of extracted output
    confidence:      text("confidence"),  // 0.00–1.00 as string
    reviewStatus:    text("review_status").notNull().default("pending"),
    // pending | accepted | rejected | modified
    reviewedById:    integer("reviewed_by_id"),
    reviewedByName:  text("reviewed_by_name"),
    reviewedAt:      timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes:     text("review_notes"),
    // Tag every AI suggestion so it never enters a final report un-reviewed
    isAiSuggested:   boolean("is_ai_suggested").notNull().default(true),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx:  index("ai_extraction_study_idx").on(t.studyId),
    typeIdx:   index("ai_extraction_type_idx").on(t.extractionType),
    statusIdx: index("ai_extraction_status_idx").on(t.reviewStatus),
  }),
);

export type AiExtractionResult = typeof aiExtractionResultsTable.$inferSelect;

// ══ hanging_protocols ══ Viewer layout + template/checklist config ═════════════════════════════════════════
export const hangingProtocolsTable = pgTable(
  "hanging_protocols",
  {
    id: serial("id").primaryKey(),
    name:              text("name").notNull().unique(),
    modality:          text("modality").notNull(),  // US | CT | MR | CR | DX | MG | OT
    bodyPartExamined:  text("body_part_examined"),
    studyDescriptionPattern: text("study_description_pattern"),  // regex-like pattern for auto-match
    // ── Protocol config ──
    preferredViewerLayout: text("preferred_viewer_layout").notNull().default("default"),
    // default | side_by_side | stack | cine | mpr
    suggestedReportTemplate: text("suggested_report_template"),
    // maps to usg template ID or future report template
    requiredMeasurementChecklist: text("required_measurement_checklist"),
    // JSON array of measurement field names required before report can finalize
    normalTemplateBody: text("normal_template_body"),
    // default normal-findings text for this protocol
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    modIdx: index("hanging_protocol_modality_idx").on(t.modality),
  }),
);

export type HangingProtocol = typeof hangingProtocolsTable.$inferSelect;

// ══ technician_workflow ══ Scan metadata per study ══════════════════════════════════════════════════
export const technicianWorkflowTable = pgTable(
  "technician_workflow",
  {
    id: serial("id").primaryKey(),
    studyId:         integer("study_id").notNull().unique(),
    scanStartedAt:   timestamp("scan_started_at", { withTimezone: true }),
    scanCompletedAt: timestamp("scan_completed_at", { withTimezone: true }),
    technicianNotes: text("technician_notes"),
    imageQuality:    text("image_quality"),   // good | acceptable | repeat_needed
    repeatReason:    text("repeat_reason"),
    patientCooperation: text("patient_cooperation"), // good | poor | sedated | emergency
    contrastUsed:    boolean("contrast_used").notNull().default(false),
    contrastName:    text("contrast_name"),
    contrastDose:    text("contrast_dose"),
    adverseReaction: boolean("adverse_reaction").notNull().default(false),
    reactionNotes:   text("reaction_notes"),
    technicianId:    integer("technician_id"),
    technicianName:  text("technician_name"),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("tech_workflow_study_idx").on(t.studyId),
  }),
);

export type TechnicianWorkflow = typeof technicianWorkflowTable.$inferSelect;

// ══ modality_routing_map ══ Modality → ERP module routing rules ══════════════════════════════════════════
export const modalityRoutingMapTable = pgTable(
  "modality_routing_map",
  {
    id: serial("id").primaryKey(),
    modalityCode:    text("modality_code").notNull().unique(),  // US | CT | MR | CR | DX | MG | XA | OT
    modulePath:      text("module_path").notNull(),
    // /usg | /ct | /mri | /xray | /mammography | /radiology
    moduleName:      text("module_name").notNull(),
    // "USG / DOPPLER" | "CT" | "MRI" | "X-Ray" | "Mammography" | "General Radiology"
    isActive:        boolean("is_active").notNull().default(true),
    autoRouteOnIngest: boolean("auto_route_on_ingest").notNull().default(true),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

export type ModalityRoutingMap = typeof modalityRoutingMapTable.$inferSelect;
