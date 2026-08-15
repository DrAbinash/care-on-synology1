import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ── usg_measurements ──────────────────────────────────────────────────────────
export const usgMeasurementsTable = pgTable(
  "usg_measurements",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id"),
    studyId: integer("study_id"),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    patientId: integer("patient_id"),
    extractionRunId: integer("extraction_run_id"),

    source: text("source").notNull().default("ocr"),
    overallConfidence: text("overall_confidence").notNull().default("low"),

    bpd: text("bpd"),                    bpdConfidence: text("bpd_confidence"),
    hc: text("hc"),                      hcConfidence: text("hc_confidence"),
    ac: text("ac"),                      acConfidence: text("ac_confidence"),
    fl: text("fl"),                      flConfidence: text("fl_confidence"),
    crl: text("crl"),                    crlConfidence: text("crl_confidence"),
    efw: text("efw"),                    efwConfidence: text("efw_confidence"),
    ga: text("ga"),                      gaConfidence: text("ga_confidence"),
    edd: text("edd"),                    eddConfidence: text("edd_confidence"),
    fhr: text("fhr"),                    fhrConfidence: text("fhr_confidence"),
    placentaPosition: text("placenta_position"),
    liquorAfi: text("liquor_afi"),
    fetalPresentation: text("fetal_presentation"),

    uterusSize: text("uterus_size"),           uterusSizeConfidence: text("uterus_size_confidence"),
    endometrium: text("endometrium"),          endometriumConfidence: text("endometrium_confidence"),
    rightOvary: text("right_ovary"),           rightOvaryConfidence: text("right_ovary_confidence"),
    leftOvary: text("left_ovary"),             leftOvaryConfidence: text("left_ovary_confidence"),
    follicles: text("follicles"),
    adnexalLesion: text("adnexal_lesion"),

    liverSize: text("liver_size"),             liverSizeConfidence: text("liver_size_confidence"),
    spleenSize: text("spleen_size"),           spleenSizeConfidence: text("spleen_size_confidence"),
    rightKidney: text("right_kidney"),         rightKidneyConfidence: text("right_kidney_confidence"),
    leftKidney: text("left_kidney"),           leftKidneyConfidence: text("left_kidney_confidence"),
    cbd: text("cbd"),                          cbdConfidence: text("cbd_confidence"),
    gbWall: text("gb_wall"),                   gbWallConfidence: text("gb_wall_confidence"),
    prostateVolume: text("prostate_volume"),   prostateVolumeConfidence: text("prostate_volume_confidence"),

    // ── Structured measurement fields (numeric, for auto-calculation engine) ──
    rightKidneyLengthMm:   real("right_kidney_length_mm"),
    rightKidneyWidthMm:    real("right_kidney_width_mm"),
    rightKidneyThicknessMm: real("right_kidney_thickness_mm"),
    leftKidneyLengthMm:    real("left_kidney_length_mm"),
    leftKidneyWidthMm:     real("left_kidney_width_mm"),
    leftKidneyThicknessMm:  real("left_kidney_thickness_mm"),
    rightCorticalThicknessMm: real("right_cortical_thickness_mm"),
    leftCorticalThicknessMm:  real("left_cortical_thickness_mm"),

    prostateLengthMm:      real("prostate_length_mm"),
    prostateWidthMm:       real("prostate_width_mm"),
    prostateHeightMm:      real("prostate_height_mm"),

    thyroidRightLobeLengthMm:  real("thyroid_right_lobe_length_mm"),
    thyroidRightLobeWidthMm:   real("thyroid_right_lobe_width_mm"),
    thyroidRightLobeThicknessMm: real("thyroid_right_lobe_thickness_mm"),
    thyroidLeftLobeLengthMm:     real("thyroid_left_lobe_length_mm"),
    thyroidLeftLobeWidthMm:      real("thyroid_left_lobe_width_mm"),
    thyroidLeftLobeThicknessMm:  real("thyroid_left_lobe_thickness_mm"),
    thyroidIsthmusMm:          real("thyroid_isthmus_mm"),
    thyroidNoduleSizeMm:       real("thyroid_nodule_size_mm"),
    thyroidTiradsScore:        text("thyroid_tirads_score"),

    liverSpanMm:           real("liver_span_mm"),
    cbdMm:                 real("cbd_mm"),
    gbWallMm:              real("gb_wall_mm"),

    uterusLengthMm:        real("uterus_length_mm"),
    uterusWidthMm:         real("uterus_width_mm"),
    uterusHeightMm:        real("uterus_height_mm"),
    rightOvaryLengthMm:    real("right_ovary_length_mm"),
    rightOvaryWidthMm:     real("right_ovary_width_mm"),
    rightOvaryHeightMm:    real("right_ovary_height_mm"),
    leftOvaryLengthMm:     real("left_ovary_length_mm"),
    leftOvaryWidthMm:      real("left_ovary_width_mm"),
    leftOvaryHeightMm:     real("left_ovary_height_mm"),
    follicleCount:         integer("follicle_count"),
    largestFollicleMm:     real("largest_follicle_mm"),

    extraMeasurementsJson: text("extra_measurements_json").notNull().default("{}"),

    manufacturer: text("manufacturer"),
    manufacturerModel: text("manufacturer_model"),
    institutionName: text("institution_name"),
    studyDescription: text("study_description"),
    studyDate: text("study_date"),

    status: text("status").notNull().default("pending_review"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),

    provenanceJson: text("provenance_json").notNull().default("{}"),
    engineVersion: text("engine_version").notNull().default("1.5.0"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudyUID: index("usg_meas_study_uid_idx").on(t.studyInstanceUID),
    byWorklist: index("usg_meas_worklist_idx").on(t.worklistId),
    byStatus: index("usg_meas_status_idx").on(t.status),
    byPatient: index("usg_meas_patient_idx").on(t.patientId),
  }),
);

// ── usg_extraction_logs ───────────────────────────────────────────────────────
export const usgExtractionLogsTable = pgTable(
  "usg_extraction_logs",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id"),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    extractionType: text("extraction_type").notNull(),
    status: text("status").notNull().default("pending"),
    framesProcessed: integer("frames_processed").notNull().default(0),
    framesFailed: integer("frames_failed").notNull().default(0),
    srFound: boolean("sr_found").notNull().default(false),
    aiNormalized: boolean("ai_normalized").notNull().default(false),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    triggeredBy: text("triggered_by").notNull().default("auto"),
    triggeredByUserId: integer("triggered_by_user_id"),
    rawOcrTextJson: text("raw_ocr_text_json"),
    rawSrJson: text("raw_sr_json"),
    provenanceJson: text("provenance_json").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    byStudy: index("usg_log_study_idx").on(t.studyInstanceUID),
    byWorklist: index("usg_log_worklist_idx").on(t.worklistId),
    byStatus: index("usg_log_status_idx").on(t.status),
  }),
);

// ── usg_key_images ────────────────────────────────────────────────────────────
export const usgKeyImagesTable = pgTable(
  "usg_key_images",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id"),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    patientId: integer("patient_id"),
    seriesInstanceUID: text("series_instance_uid"),
    sopInstanceUID: text("sop_instance_uid"),
    seriesNumber: text("series_number"),
    imageNumber: text("image_number"),
    frameNumber: integer("frame_number").notNull().default(1),
    label: text("label").notNull().default(""),
    wadoUrl: text("wado_url"),
    thumbnailBase64: text("thumbnail_base64"),
    sortOrder: integer("sort_order").notNull().default(0),
    addedBy: text("added_by"),
    addedByUserId: integer("added_by_user_id"),
    pregnancyEpisodeId: integer("pregnancy_episode_id"),
    rank: integer("rank"),
    confidence: real("confidence"),
    isApproved: boolean("is_approved").default(false),
    isRejected: boolean("is_rejected").default(false),
    source: text("source"),
    measurementKey: text("measurement_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudy: index("usg_key_img_study_idx").on(t.studyInstanceUID),
    byWorklist: index("usg_key_img_worklist_idx").on(t.worklistId),
  }),
);

// ── usg_doppler_measurements ──────────────────────────────────────────────────
// One row per vessel / Doppler acquisition per study.
// All velocity/index fields are nullable text so mixed machine units are preserved.
export const usgDopplerMeasurementsTable = pgTable(
  "usg_doppler_measurements",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id"),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    patientId: integer("patient_id"),
    extractionRunId: integer("extraction_run_id"),

    vesselName: text("vessel_name").notNull().default(""),
    side: text("side").notNull().default("unknown"), // left | right | bilateral | midline | unknown

    psv: text("psv"),            // peak systolic velocity  e.g. "45.2 cm/s"
    edv: text("edv"),            // end diastolic velocity  e.g. "12.1 cm/s"
    ri: text("ri"),              // resistive index         e.g. "0.73"
    pi: text("pi"),              // pulsatility index       e.g. "1.21"
    sdRatio: text("sd_ratio"),   // S/D ratio               e.g. "3.73"

    waveformLabel: text("waveform_label"),
    waveformDescription: text("waveform_description"),

    confidence: text("confidence").notNull().default("low"), // high | medium | low
    source: text("source").notNull().default("manual"), // dicom_sr | ocr | manual

    status: text("status").notNull().default("pending_review"), // pending_review | approved | rejected
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),

    provenanceJson: text("provenance_json").notNull().default("{}"),
    waveformSopInstanceUid: text("waveform_sop_instance_uid"),
    waveformFrameNumber: integer("waveform_frame_number"),
    engineVersion: text("engine_version").notNull().default("1.5.0"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy:    index("usg_dop_study_idx").on(t.studyInstanceUID),
    byWorklist: index("usg_dop_worklist_idx").on(t.worklistId),
    byStatus:   index("usg_dop_status_idx").on(t.status),
    byPatient:  index("usg_dop_patient_idx").on(t.patientId),
  }),
);

// ── usg_extraction_settings ───────────────────────────────────────────────────
// Singleton table (always id=1). Stores all AI extraction pipeline settings.
export const usgExtractionSettingsTable = pgTable(
  "usg_extraction_settings",
  {
    id: serial("id").primaryKey(),

    ocrEnabled:               boolean("ocr_enabled").notNull().default(true),
    aiNormalizeEnabled:       boolean("ai_normalize_enabled").notNull().default(true),
    srPriorityMode:           boolean("sr_priority_mode").notNull().default(true),
    autoRejectLowConfidence:  boolean("auto_reject_low_confidence").notNull().default(true),
    humanReviewRequired:      boolean("human_review_required").notNull().default(true),
    autoFinalize:             boolean("auto_finalize").notNull().default(false),

    confidenceThreshold: real("confidence_threshold").notNull().default(0.80),
    lowConfidenceCutoff: real("low_confidence_cutoff").notNull().default(0.60),
    maxFramesToOcr:      integer("max_frames_to_ocr").notNull().default(20),

    geAeTitle: text("ge_ae_title").notNull().default("GE_USG"),
    geIp:      text("ge_ip").notNull().default(""),
    gePort:    text("ge_port").notNull().default("11112"),

    /** When false, ERP does not ingest/extract US studies (machine still C-STOREs to Orthanc). */
    pipelineEnabled: boolean("pipeline_enabled").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

// ── usg_machine_profiles ──────────────────────────────────────────────────────
// Registry of ultrasound / Doppler machines available in the centre.
export const usgMachineProfilesTable = pgTable(
  "usg_machine_profiles",
  {
    id: serial("id").primaryKey(),
    machineName:  text("machine_name").notNull(),
    manufacturer: text("manufacturer").notNull().default("GE"),
    modelName:    text("model_name"),
    aeTitle:      text("ae_title"),
    ipAddress:    text("ip_address"),
    port:         text("port").notNull().default("11112"),
    modality:     text("modality").notNull().default("USG"), // USG | DOPPLER | BOTH
    active:       boolean("active").notNull().default(true),
    capabilities: text("capabilities").notNull().default("[]"), // JSON string array
    notes:        text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byActive: index("usg_machine_active_idx").on(t.active),
  }),
);

// ── usg_report_drafts ─────────────────────────────────────────────────────────
// Draft USG/Doppler reports generated (optionally auto-filled) from approved measurements.
export const usgReportDraftsTable = pgTable(
  "usg_report_drafts",
  {
    id: serial("id").primaryKey(),
    worklistId:       integer("worklist_id"),
    studyInstanceUID: text("study_instance_uid"),
    patientId:        integer("patient_id"),
    accessionNumber:  text("accession_number"),

    templateType: text("template_type").notNull().default("WHOLE_ABDOMEN"),
    // OB_EARLY | OB_GROWTH | OB_ANOMALY | PELVIS_FEMALE | WHOLE_ABDOMEN |
    // KUB | PROSTATE | SCROTUM | THYROID | BREAST | ARTERIAL_DOPPLER |
    // VENOUS_DOPPLER | CAROTID_DOPPLER | CUSTOM

    draftContent: text("draft_content").notNull().default(""),
    // status lifecycle: draft → pending_review → verified → finalized
    //                     (post-finalize: amended | addendum | archived)
    status: text("status").notNull().default("draft"),

    autoFilledFromMeasurementId: integer("auto_filled_from_measurement_id"),
    autoFilledFromDopplerId:     integer("auto_filled_from_doppler_id"),

    // Lifecycle actors
    createdBy:    text("created_by"),
    verifiedBy:   text("verified_by"),
    finalizedBy:  text("finalized_by"),
    amendedBy:    text("amended_by"),

    // For amendments / addenda — points to the previous version
    priorVersionId: integer("prior_version_id"),

    // Critical-finding linkage (id of usg-flavoured critical_findings_alerts row)
    criticalAlertId: integer("critical_alert_id"),

    // Medico-legal safety fields
    finalizedReportHash:   text("finalized_report_hash"),
    finalizedPdfVersionId: text("finalized_pdf_version_id"),
    amendmentReason:       text("amendment_reason"),
    syncStatus:            text("sync_status").notNull().default("synced"), // synced | pending_sync | conflict
    lockedBy:              text("locked_by"), // user name who currently holds edit lock

    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    verifiedAt:  timestamp("verified_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    amendedAt:   timestamp("amended_at", { withTimezone: true }),
  },
  (t) => ({
    byStudy:    index("usg_draft_study_idx").on(t.studyInstanceUID),
    byWorklist: index("usg_draft_worklist_idx").on(t.worklistId),
    byStatus:   index("usg_draft_status_idx").on(t.status),
    byPatient:  index("usg_draft_patient_idx").on(t.patientId),
    byHash:     index("usg_draft_hash_idx").on(t.finalizedReportHash),
  }),
);

// ── usg_report_amendments ────────────────────────────────────────────────────
// Full amendment history — every change after finalization creates a row here.
export const usgReportAmendmentsTable = pgTable(
  "usg_report_amendments",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id").notNull(),          // the new amended draft
    priorVersionId: integer("prior_version_id").notNull(), // the original finalized draft
    amendmentReason: text("amendment_reason").notNull().default(""),
    amendedBy: text("amended_by").notNull(),
    amendedById: integer("amended_by_id"),
    priorContent: text("prior_content").notNull().default(""),
    newContent: text("new_content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDraft: index("usg_amend_draft_idx").on(t.draftId),
    byPrior: index("usg_amend_prior_idx").on(t.priorVersionId),
  }),
);

// ── usg_finding_image_links ─────────────────────────────────────────────────
// Links report findings to key images / frames.
export const usgFindingImageLinksTable = pgTable(
  "usg_finding_image_links",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id").notNull(),
    findingIndex: integer("finding_index").notNull().default(0),
    imageId: integer("image_id").notNull(),        // FK → usg_key_images.id
    frameNumber: integer("frame_number"),
    annotationLabel: text("annotation_label"),
    measurementReference: text("measurement_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDraft: index("usg_fimg_draft_idx").on(t.draftId),
    byImage: index("usg_fimg_image_idx").on(t.imageId),
  }),
);

// ── usg_audit_log ─────────────────────────────────────────────────────────────
// Single immutable audit table for every USG / Doppler action — measurement
// edit, approval/rejection, draft generation, report finalization, viewer
// opened, critical alert triggered. NEVER mutate or delete rows.
export const usgAuditLogTable = pgTable(
  "usg_audit_log",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    // measurement | doppler | draft | key_image | viewer | critical_alert | settings
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    // create | update | approve | reject | finalize | verify | amend |
    // viewer_open | critical_flag | critical_ack | regenerate | delete |
    // settings_change
    performedBy: text("performed_by").notNull(),
    performedById: integer("performed_by_id"),
    performedByRole: text("performed_by_role"),
    studyInstanceUID: text("study_instance_uid"),
    patientId: integer("patient_id"),
    details: text("details").notNull().default("{}"), // JSON string
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byEntity:  index("usg_audit_entity_idx").on(t.entityType, t.entityId),
    byStudy:   index("usg_audit_study_idx").on(t.studyInstanceUID),
    byPatient: index("usg_audit_patient_idx").on(t.patientId),
    byUser:    index("usg_audit_user_idx").on(t.performedById),
    byCreated: index("usg_audit_created_idx").on(t.createdAt),
  }),
);

export type UsgMeasurement        = typeof usgMeasurementsTable.$inferSelect;
export type UsgExtractionLog      = typeof usgExtractionLogsTable.$inferSelect;
export type UsgKeyImage           = typeof usgKeyImagesTable.$inferSelect;
export type UsgDopplerMeasurement = typeof usgDopplerMeasurementsTable.$inferSelect;
export type UsgExtractionSettings = typeof usgExtractionSettingsTable.$inferSelect;
export type UsgMachineProfile     = typeof usgMachineProfilesTable.$inferSelect;
export type UsgReportDraft        = typeof usgReportDraftsTable.$inferSelect;
export type UsgReportAmendment    = typeof usgReportAmendmentsTable.$inferSelect;
export type UsgFindingImageLink   = typeof usgFindingImageLinksTable.$inferSelect;
export type UsgAuditLog           = typeof usgAuditLogTable.$inferSelect;
