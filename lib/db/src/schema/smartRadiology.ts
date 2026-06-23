import {
  pgTable, serial, integer, text, boolean, timestamp, index, real,
} from "drizzle-orm/pg-core";

// ── 1. AI Impressions ── AI-generated impressions per modality, editable, never auto-finalized
export const aiImpressionsTable = pgTable(
  "ai_impressions",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id"),
    reportDraftId: integer("report_draft_id"),
    modality: text("modality").notNull(), // USG_ABDOMEN | USG_PELVIS | OB_GROWTH | DOPPLER | CT_BRAIN | MRI_BRAIN | MRI_SPINE
    findingsText: text("findings_text"),
    aiGeneratedImpression: text("ai_generated_impression"),
    editedImpression: text("edited_impression"),
    // null = not edited; if edited, this is the radiologist's version
    isAiSuggested: boolean("is_ai_suggested").notNull().default(true),
    // Always true for AI-generated rows
    verifiedById: integer("verified_by_id"),
    verifiedByName: text("verified_by_name"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // verification required before use in any report
    status: text("status").notNull().default("pending"),
    // pending | verified | rejected
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("ai_imp_study_idx").on(t.studyId),
    draftIdx: index("ai_imp_draft_idx").on(t.reportDraftId),
    modalityIdx: index("ai_imp_modality_idx").on(t.modality),
    statusIdx: index("ai_imp_status_idx").on(t.status),
  }),
);
export type AiImpression = typeof aiImpressionsTable.$inferSelect;

// ── 2. Report Quality Checks ── Pre-finalization validation results
export const reportQualityChecksTable = pgTable(
  "report_quality_checks",
  {
    id: serial("id").primaryKey(),
    reportDraftId: integer("report_draft_id").notNull(),
    studyId: integer("study_id"),
    overallResult: text("overall_result").notNull().default("pending"),
    // PASS | WARNING | BLOCKER
    missingImpression: boolean("missing_impression").notNull().default(false),
    missingFindings: boolean("missing_findings").notNull().default(false),
    missingCriticalValues: boolean("missing_critical_values").notNull().default(false),
    impossibleObValues: boolean("impossible_ob_values").notNull().default(false),
    eddGaMismatch: boolean("edd_ga_mismatch").notNull().default(false),
    leftRightMismatch: boolean("left_right_mismatch").notNull().default(false),
    unapprovedOcrUsed: boolean("unapproved_ocr_used").notNull().default(false),
    blankRequiredFields: boolean("blank_required_fields").notNull().default(false),
    reportTooShort: boolean("report_too_short").notNull().default(false),
    normalDespiteAbnormalFindings: boolean("normal_despite_abnormal_findings").notNull().default(false),
    // Additional free-text detail per check
    detailsJson: text("details_json"),
    // JSON of per-check messages
    checkedById: integer("checked_by_id"),
    checkedByName: text("checked_by_name"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedById: integer("acknowledged_by_id"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    draftIdx: index("qc_draft_idx").on(t.reportDraftId),
    studyIdx: index("qc_study_idx").on(t.studyId),
    resultIdx: index("qc_result_idx").on(t.overallResult),
  }),
);
export type ReportQualityCheck = typeof reportQualityChecksTable.$inferSelect;

// ── 3. Follow-Up Recommendations ── Auto-suggested follow-ups based on report content
export const followUpRecommendationsTable = pgTable(
  "follow_up_recommendations",
  {
    id: serial("id").primaryKey(),
    reportDraftId: integer("report_draft_id").notNull(),
    studyId: integer("study_id"),
    triggerRule: text("trigger_rule").notNull(),
    // e.g. "abnormal_doppler", "placenta_previa", "growth_lag", "adnexal_cyst", "fatty_liver", "hydronephrosis", "suspicious_mass"
    recommendationText: text("recommendation_text").notNull(),
    // e.g. "Urgent clinical correlation recommended"
    priority: text("priority").notNull().default("routine"),
    // routine | urgent | stat
    isAiSuggested: boolean("is_ai_suggested").notNull().default(true),
    editedText: text("edited_text"),
    // radiologist's edited version
    accepted: boolean("accepted").notNull().default(false),
    acceptedById: integer("accepted_by_id"),
    acceptedByName: text("accepted_by_name"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    draftIdx: index("fu_draft_idx").on(t.reportDraftId),
    studyIdx: index("fu_study_idx").on(t.studyId),
    ruleIdx: index("fu_rule_idx").on(t.triggerRule),
  }),
);
export type FollowUpRecommendation = typeof followUpRecommendationsTable.$inferSelect;

// ── 4. Template Learning ── Saved phrase patterns and normal templates
export const templateLearningTable = pgTable(
  "template_learning",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    modality: text("modality"),
    bodyPart: text("body_part"),
    templateType: text("template_type").notNull().default("normal"),
    // normal | doctor_specific | modality_specific | recommendation
    doctorId: integer("doctor_id"),
    // null = global template
    doctorName: text("doctor_name"),
    content: text("content").notNull(),
    // the actual template text
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdById: integer("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    modalityIdx: index("tl_modality_idx").on(t.modality),
    doctorIdx: index("tl_doctor_idx").on(t.doctorId),
    typeIdx: index("tl_type_idx").on(t.templateType),
  }),
);
export type TemplateLearning = typeof templateLearningTable.$inferSelect;

// ── 5. Report Translations ── English + Hindi patient-friendly summaries
export const reportTranslationsTable = pgTable(
  "report_translations",
  {
    id: serial("id").primaryKey(),
    reportDraftId: integer("report_draft_id").notNull(),
    studyId: integer("study_id"),
    originalLanguage: text("original_language").notNull().default("en"),
    // Patient-friendly Hindi summary
    hindiSummary: text("hindi_summary"),
    hindiSummaryGeneratedAt: timestamp("hindi_summary_generated_at", { withTimezone: true }),
    // Bilingual summary (English + Hindi side by side)
    bilingualSummary: text("bilingual_summary"),
    bilingualGeneratedAt: timestamp("bilingual_generated_at", { withTimezone: true }),
    // AI-generated flag
    isAiTranslated: boolean("is_ai_translated").notNull().default(true),
    // Editable by radiologist
    editedHindiSummary: text("edited_hindi_summary"),
    editedById: integer("edited_by_id"),
    editedByName: text("edited_by_name"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    draftIdx: index("trans_draft_idx").on(t.reportDraftId),
    studyIdx: index("trans_study_idx").on(t.studyId),
  }),
);
export type ReportTranslation = typeof reportTranslationsTable.$inferSelect;

// ── 6. Sonographer Drafts ── Tablet workflow drafts awaiting radiologist verification
export const sonographerDraftsTable = pgTable(
  "sonographer_drafts",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    sonographerId: integer("sonographer_id"),
    sonographerName: text("sonographer_name"),
    // Measurements approved by sonographer
    approvedMeasurementsJson: text("approved_measurements_json"),
    // JSON array of measurement IDs approved
    keyImageIdsJson: text("key_image_ids_json"),
    // JSON array of selected key image references
    voiceDictationText: text("voice_dictation_text"),
    // Transcribed text from voice dictation
    draftReportText: text("draft_report_text"),
    // Generated draft from measurements + dictation
    status: text("status").notNull().default("draft"),
    // draft | submitted_for_review | reviewed | rejected
    reviewedById: integer("reviewed_by_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("sono_study_idx").on(t.studyId),
    statusIdx: index("sono_status_idx").on(t.status),
    sonographerIdx: index("sono_sonographer_idx").on(t.sonographerId),
  }),
);
export type SonographerDraft = typeof sonographerDraftsTable.$inferSelect;

// ── 7. DICOM Routing Rules ── Admin-configurable routing by modality/body part/keywords/doctor/priority
export const smartRoutingRulesTable = pgTable(
  "smart_routing_rules",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Match conditions (all conditions must match; null = wildcard)
    modality: text("modality"),
    bodyPart: text("body_part"),
    studyDescriptionKeywords: text("study_description_keywords"),
    // comma-separated keywords to match in study description
    referringDoctorId: integer("referring_doctor_id"),
    referringDoctorName: text("referring_doctor_name"),
    priority: text("priority"),
    // emergency | stat | icu | inpatient | outpatient | corporate | routine
    // Action: target queue / module
    targetQueue: text("target_queue").notNull(),
    // e.g. "NEURO", "SPINE", "FETAL", "VASCULAR", "STAT", "GENERAL"
    targetModulePath: text("target_module_path"),
    // e.g. "/radiology/neuro", "/usg"
    autoAssignRadiologistId: integer("auto_assign_radiologist_id"),
    autoAssignRadiologistName: text("auto_assign_radiologist_name"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdById: integer("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    modalityIdx: index("route_modality_idx").on(t.modality),
    queueIdx: index("route_queue_idx").on(t.targetQueue),
    activeIdx: index("route_active_idx").on(t.isActive),
  }),
);
export type SmartRoutingRule = typeof smartRoutingRulesTable.$inferSelect;

// ── 8. Study TAT Metrics ── SLA tracking timestamps
export const studyTatMetricsTable = pgTable(
  "study_tat_metrics",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull().unique(),
    accessionNumber: text("accession_number"),
    modality: text("modality"),
    priority: text("priority"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    // study ingested / received from PACS
    assignedToRadiologistAt: timestamp("assigned_to_radiologist_at", { withTimezone: true }),
    reportStartedAt: timestamp("report_started_at", { withTimezone: true }),
    reportVerifiedAt: timestamp("report_verified_at", { withTimezone: true }),
    reportFinalizedAt: timestamp("report_finalized_at", { withTimezone: true }),
    // Computed TAT in minutes (null until finalized)
    totalTatMinutes: integer("total_tat_minutes"),
    reportTatMinutes: integer("report_tat_minutes"),
    // from started to finalized
    verifiedTatMinutes: integer("verified_tat_minutes"),
    // from started to verified
    isDelayed: boolean("is_delayed").notNull().default(false),
    delayReason: text("delay_reason"),
    radiologistId: integer("radiologist_id"),
    radiologistName: text("radiologist_name"),
    slaBreached: boolean("sla_breached").notNull().default(false),
    // true if TAT exceeded SLA threshold
    slaThresholdMinutes: integer("sla_threshold_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("study_tat_metrics_study_idx").on(t.studyId),
    modalityIdx: index("study_tat_metrics_modality_idx").on(t.modality),
    delayedIdx: index("study_tat_metrics_delayed_idx").on(t.isDelayed),
    radiologistIdx: index("study_tat_metrics_radiologist_idx").on(t.radiologistId),
    slaIdx: index("study_tat_metrics_sla_idx").on(t.slaBreached),
  }),
);
export type StudyTatMetric = typeof studyTatMetricsTable.$inferSelect;

// ── 9. Report Amendments ── Immutable finalized reports + amendment addendums
export const reportAmendmentsTable = pgTable(
  "report_amendments",
  {
    id: serial("id").primaryKey(),
    reportDraftId: integer("report_draft_id").notNull(),
    studyId: integer("study_id"),
    // Prior version snapshot
    priorContent: text("prior_content").notNull(),
    priorVersionHash: text("prior_version_hash"),
    // SHA-256 hash of prior content for integrity
    // Amendment details
    addendumText: text("addendum_text").notNull(),
    amendmentReason: text("amendment_reason").notNull(),
    amendedById: integer("amended_by_id"),
    amendedByName: text("amended_by_name"),
    amendedAt: timestamp("amended_at", { withTimezone: true }).notNull().defaultNow(),
    // New version
    newContent: text("new_content").notNull(),
    newVersionHash: text("new_version_hash"),
    // Visible label
    amendmentLabel: text("amendment_label").notNull().default("AMENDED"),
    // sequence number (1st amendment, 2nd amendment, etc.)
    sequenceNumber: integer("sequence_number").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    draftIdx: index("amend_draft_idx").on(t.reportDraftId),
    studyIdx: index("amend_study_idx").on(t.studyId),
    seqIdx: index("amend_seq_idx").on(t.sequenceNumber),
  }),
);
export type ReportAmendment = typeof reportAmendmentsTable.$inferSelect;

// ── 10. DICOM SR Export Queue ── Future DICOM SR export architecture
export const dicomSrExportQueueTable = pgTable(
  "dicom_sr_export_queue",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    reportDraftId: integer("report_draft_id"),
    // Measurements to export as DICOM SR
    measurementsJson: text("measurements_json"),
    // JSON of measurement data for SR encoding
    exportStatus: text("export_status").notNull().default("pending"),
    // pending | in_progress | exported | failed | retrying
    pacsDestinationAeTitle: text("pacs_destination_ae_title"),
    pacsDestinationHost: text("pacs_destination_host"),
    pacsDestinationPort: integer("pacs_destination_port"),
    // DICOM C-STORE result
    dicomSopInstanceUid: text("dicom_sop_instance_uid"),
    exportAttemptCount: integer("export_attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    // Audit
    requestedById: integer("requested_by_id"),
    requestedByName: text("requested_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyIdx: index("sr_study_idx").on(t.studyId),
    statusIdx: index("sr_status_idx").on(t.exportStatus),
    draftIdx: index("sr_draft_idx").on(t.reportDraftId),
  }),
);
export type DicomSrExportQueue = typeof dicomSrExportQueueTable.$inferSelect;
