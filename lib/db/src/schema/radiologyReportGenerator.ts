import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// radiology_report_drafts — working document for the report generator module.
// Supports both PACS-worklist mode (studyId / worklistId linked) and manual
// entry mode (no study link). Promoted to patient_reports on final save.
export const radiologyReportDraftsTable = pgTable(
  "radiology_report_drafts",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id"),        // FK → radiology_studies.id  (null in manual mode)
    worklistId: integer("worklist_id"),  // FK → radiology_worklist.id (null if internal)
    patientId: integer("patient_id"),    // FK → patients.id
    templateId: text("template_id"),     // e.g. "MRI_BRAIN_PLAIN"
    modality: text("modality"),          // MRI | CT | USG | X-RAY
    studyName: text("study_name"),
    clinicalHistory: text("clinical_history"),
    rawFindings: text("raw_findings"),
    // JSON object: { [sectionName: string]: string } — one entry per template section
    findingsSections: text("findings_sections"),
    // JSON array of impression bullet strings
    impression: text("impression"),
    recommendation: text("recommendation"),
    formattedReportHtml: text("formatted_report_html"),
    formattedReportText: text("formatted_report_text"),
    // DRAFT | FINAL
    status: text("status").notNull().default("DRAFT"),
    // Set once promoted to patient_reports
    finalReportId: integer("final_report_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("rad_report_drafts_study_idx").on(t.studyId),
    byPatient: index("rad_report_drafts_patient_idx").on(t.patientId),
    byStatus: index("rad_report_drafts_status_idx").on(t.status),
  }),
);

// radiology_voice_logs — immutable audit of every voice-dictation + cleanup event.
export const radiologyVoiceLogsTable = pgTable(
  "radiology_voice_logs",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id"),
    studyId: integer("study_id"),
    patientId: integer("patient_id"),
    targetField: text("target_field"),   // which form field the transcript was inserted into
    rawTranscript: text("raw_transcript"),
    cleanedText: text("cleaned_text"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDraft: index("rad_voice_logs_draft_idx").on(t.draftId),
  }),
);

// radiology_text_macros — user-defined shortcut expansions for report dictation.
// e.g. shortcut ".pol" expands to "polydipsia, polyuria, and polyphagia."
export const radiologyTextMacrosTable = pgTable(
  "radiology_text_macros",
  {
    id: serial("id").primaryKey(),
    createdBy: text("created_by").notNull(),          // staff username / email
    shortcut: text("shortcut").notNull(),              // trigger text, e.g. ".pol"
    expansion: text("expansion").notNull(),            // full replacement text
    modality: text("modality"),                        // optional filter: MRI | CT | USG | X-RAY
    isGlobal: boolean("is_global").notNull().default(false), // admin-created global macros
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byCreator: index("rad_macros_creator_idx").on(t.createdBy),
    byShortcut: index("rad_macros_shortcut_idx").on(t.shortcut),
    byModality: index("rad_macros_modality_idx").on(t.modality),
  }),
);

// radiology_report_preferences — per-user formatting settings for generated reports.
export const radiologyReportPreferencesTable = pgTable(
  "radiology_report_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),      // FK → staff.id
    // Section heading case: "all_caps" | "title_case"
    headingCase: text("heading_case").notNull().default("all_caps"),
    // Section spacing: "spaced" | "compact"
    sectionSpacing: text("section_spacing").notNull().default("spaced"),
    // Impression style: "bulleted" | "numbered" | "plain"
    impressionStyle: text("impression_style").notNull().default("bulleted"),
    // Show "End of Report" footer line
    showEndOfReportFooter: boolean("show_end_of_report_footer").notNull().default(true),
    // Optional footer text above "End of Report"
    footerText: text("footer_text"),
    // Two-line header: line 1 (department / institution)
    headerLine1: text("header_line_1"),
    // Two-line header: line 2 source — "template_name" | "custom"
    headerLine2Source: text("header_line_2_source").notNull().default("template_name"),
    // Custom line 2 text (when headerLine2Source === "custom")
    headerLine2Custom: text("header_line_2_custom"),
    // Workspace layout preference: "3_panel" | "preview_first" | "workflow"
    workspaceLayout: text("workspace_layout").notNull().default("3_panel"),
    // Print mode: "letterhead" | "plain_paper"
    printMode: text("print_mode").notNull().default("letterhead"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byUser: index("rad_prefs_user_idx").on(t.userId),
  }),
);

// radiology_report_key_images — screenshots captured from DICOM viewer or
// uploaded by the technician / radiologist to annotate the report.
// Only JPG/PNG/WebP screenshots (not raw DICOM data) are stored here.
export const radiologyReportKeyImagesTable = pgTable(
  "radiology_report_key_images",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id"),
    studyId: integer("study_id"),
    patientId: integer("patient_id"),
    accessionNumber: text("accession_number"),
    imageUrl: text("image_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    caption: text("caption").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    includeInReport: boolean("include_in_report").notNull().default(true),
    // UPLOAD | PACS_SCREENSHOT
    sourceType: text("source_type").notNull().default("UPLOAD"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byDraft: index("rad_key_images_draft_idx").on(t.draftId),
    byStudy: index("rad_key_images_study_idx").on(t.studyId),
  }),
);

// radiology_image_references — structured key image references attached to a report draft
export const radiologyImageReferencesTable = pgTable(
  "radiology_image_references",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id").notNull(),
    studyId: integer("study_id"),
    seriesNumber: text("series_number"),
    imageNumber: text("image_number"),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byDraft: index("rad_img_refs_draft_idx").on(t.draftId),
    byStudy: index("rad_img_refs_study_idx").on(t.studyId),
  }),
);

// radiology_normal_snippets — one-click normal report shortcuts
export const radiologyNormalSnippetsTable = pgTable(
  "radiology_normal_snippets",
  {
    id: serial("id").primaryKey(),
    shortcut: text("shortcut").notNull(),
    label: text("label").notNull(),
    modality: text("modality"),
    bodyPart: text("body_part"),
    text: text("text").notNull(),
    impression: text("impression"),
    recommendation: text("recommendation"),
    isGlobal: boolean("is_global").notNull().default(false),
    createdBy: text("created_by"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byShortcut: index("rad_snippets_shortcut_idx").on(t.shortcut),
    byModality: index("rad_snippets_modality_idx").on(t.modality),
  }),
);

// radiologist_style_preferences — per-radiologist AI impression style
export const radiologistStylePreferencesTable = pgTable(
  "radiologist_style_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    impressionStyle: text("impression_style").notNull().default("concise"),
    terminologyLevel: text("terminology_level").notNull().default("standard"),
    autoNumberImpressions: boolean("auto_number_impressions").notNull().default(true),
    includeDifferential: boolean("include_differential").notNull().default(false),
    includeMeasurements: boolean("include_measurements").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

// radiology_report_lifecycle_log — audit trail for report edits/amendments/reprints
export const radiologyReportLifecycleLogTable = pgTable(
  "radiology_report_lifecycle_log",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    draftId: integer("draft_id"),
    action: text("action").notNull(),
    actorId: integer("actor_id"),
    actorName: text("actor_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudy: index("rad_lifecycle_study_idx").on(t.studyId),
    byAction: index("rad_lifecycle_action_idx").on(t.action),
  }),
);

// spinal_measurements — per-vertebral-level canal/cord measurements for spine MRI reports
export const spinalMeasurementsTable = pgTable(
  "spinal_measurements",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    draftId: integer("draft_id"),
    patientId: integer("patient_id"),
    worklistId: integer("worklist_id"),
    // Vertebral level: C1-C7, T1-T12, L1-L5, S1
    vertebraLevel: text("vertebra_level").notNull(),
    // Spinal canal dimensions (mm)
    canalAP: text("canal_ap"),          // anterior-posterior diameter
    canalTransverse: text("canal_transverse"), // transverse diameter
    canalArea: text("canal_area"),      // cross-sectional area mm²
    // Spinal cord dimensions (mm)
    cordAP: text("cord_ap"),            // cord AP diameter
    cordTransverse: text("cord_transverse"), // cord transverse diameter
    cordArea: text("cord_area"),        // cord cross-sectional area mm²
    // Disc height
    discHeight: text("disc_height"),    // mm
    // Stenosis / compression grading
    stenosisGrade: text("stenosis_grade").notNull().default("none"), // none | mild | moderate | severe
    stenosisNotes: text("stenosis_notes"),
    // Foraminal narrowing
    leftForaminal: text("left_foraminal").notNull().default("normal"), // normal | mild | moderate | severe
    rightForaminal: text("right_foraminal").notNull().default("normal"),
    // Alignment
    alignment: text("alignment").notNull().default("normal"), // normal | kyphosis | lordosis | scoliosis | listhesis
    alignmentNotes: text("alignment_notes"),
    // Who measured and when
    measuredBy: text("measured_by").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("spinal_measurements_study_idx").on(t.studyId),
    byDraft: index("spinal_measurements_draft_idx").on(t.draftId),
    byLevel: index("spinal_measurements_level_idx").on(t.vertebraLevel),
    byStenosis: index("spinal_measurements_stenosis_idx").on(t.stenosisGrade),
  }),
);

// radiology_text_macro_v2 — measurement-aware smart macros
export const radiologySmartMacrosTable = pgTable(
  "radiology_smart_macros",
  {
    id: serial("id").primaryKey(),
    createdBy: text("created_by").notNull(),
    shortcut: text("shortcut").notNull(),
    expansion: text("expansion").notNull(),
    modality: text("modality"),
    bodyPart: text("body_part"),
    // Measurement macro: if true, expansion may contain placeholders
    isMeasurementMacro: boolean("is_measurement_macro").notNull().default(false),
    // Measurement parameters (JSON): vertebraLevel, canalAP, canalTransverse, etc.
    measurementParams: text("measurement_params"),
    // Auto-suggest: triggers when this bodyPart + modality is active
    autoSuggestOn: boolean("auto_suggest_on").notNull().default(false),
    isGlobal: boolean("is_global").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byCreator: index("smart_macros_creator_idx").on(t.createdBy),
    byShortcut: index("smart_macros_shortcut_idx").on(t.shortcut),
    byModality: index("smart_macros_modality_idx").on(t.modality),
    byBodyPart: index("smart_macros_body_part_idx").on(t.bodyPart),
  }),
);
