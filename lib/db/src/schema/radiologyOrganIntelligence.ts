/**
 * Phase 10B: Organ Intelligence
 * Spine Intelligence, Brain Intelligence, Tumor Follow-up tracking tables.
 */
import {
  pgTable, serial, integer, text, timestamp, numeric, boolean, jsonb, index,
} from "drizzle-orm/pg-core";

// ─── Spine Intelligence ──────────────────────────────────────────────────────

export const radiologySpineSessionsTable = pgTable(
  "radiology_spine_sessions",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    orderId: integer("order_id"),
    studyId: integer("study_id"),
    studyInstanceUid: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    modality: text("modality"),
    region: text("region"), // cervical, thoracic, lumbar, sacral, whole
    technique: text("technique"),
    contrastUsed: boolean("contrast_used").notNull().default(false),
    clinicalIndication: text("clinical_indication"),
    overallImpression: text("overall_impression"),
    recordedById: integer("recorded_by_id"),
    recordedByName: text("recorded_by_name"),
    studyDate: timestamp("study_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPatient: index("radiology_spine_sessions_patient_idx").on(t.patientId),
    byOrder: index("radiology_spine_sessions_order_idx").on(t.orderId),
  }),
);

export const radiologySpineLevelsTable = pgTable(
  "radiology_spine_levels",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    patientId: integer("patient_id").notNull(),
    // Vertebral level: C3, C4-C5, L4-L5, T6-T7, etc.
    level: text("level").notNull(),
    // Disc parameters
    discStatus: text("disc_status"), // normal, bulge, protrusion, extrusion, sequestration
    discHeight: text("disc_height"), // maintained, reduced_mild, reduced_moderate, reduced_severe, collapsed
    // Canal measurements
    canalDiameter: numeric("canal_diameter", { precision: 5, scale: 2 }), // in mm
    canalStenosis: text("canal_stenosis"), // none, mild, moderate, severe
    // Foraminal assessment
    foraminalStenosis: text("foraminal_stenosis"), // none, mild_left, mild_right, mild_bilateral, moderate_left, moderate_right, moderate_bilateral, severe_left, severe_right, severe_bilateral
    // Neural compromise
    cordCompression: boolean("cord_compression").notNull().default(false),
    cordSignalChange: boolean("cord_signal_change").notNull().default(false),
    nerveRootCompression: text("nerve_root_compression"), // none, left, right, bilateral
    // Vertebral body
    vertebralCollapse: boolean("vertebral_collapse").notNull().default(false),
    compressionFracture: boolean("compression_fracture").notNull().default(false),
    fractureSeverity: text("fracture_severity"), // mild, moderate, severe
    // Marrow changes
    modicChange: text("modic_change"), // none, type_1, type_2, type_3
    schmorlNode: boolean("schmorl_node").notNull().default(false),
    // Alignment
    spondylolisthesis: text("spondylolisthesis"), // none, grade_1, grade_2, grade_3, grade_4
    // Facet joints
    facetArthrosis: text("facet_arthrosis"), // none, mild, moderate, severe
    // Free text notes
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySession: index("radiology_spine_levels_session_idx").on(t.sessionId),
    byPatient: index("radiology_spine_levels_patient_idx").on(t.patientId),
    byLevel: index("radiology_spine_levels_level_idx").on(t.level),
  }),
);

// ─── Brain Intelligence ──────────────────────────────────────────────────────

export const radiologyBrainSessionsTable = pgTable(
  "radiology_brain_sessions",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    orderId: integer("order_id"),
    studyId: integer("study_id"),
    studyInstanceUid: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    modality: text("modality"),
    technique: text("technique"),
    contrastUsed: boolean("contrast_used").notNull().default(false),
    clinicalIndication: text("clinical_indication"),
    // Midline shift (mm, positive = right, negative = left)
    midlineShift: numeric("midline_shift", { precision: 5, scale: 2 }),
    midlineShiftDirection: text("midline_shift_direction"), // left, right, none
    // Ventricles
    ventricleSizeStatus: text("ventricle_size_status"), // normal, mildly_enlarged, moderately_enlarged, severely_enlarged, collapsed
    hydrocephalus: text("hydrocephalus"), // none, communicating, obstructive, ex_vacuo
    // Infarct
    infarctPresent: boolean("infarct_present").notNull().default(false),
    infarctSizeMm: numeric("infarct_size_mm", { precision: 6, scale: 2 }),
    infarctTerritory: text("infarct_territory"), // MCA_left, MCA_right, PCA_left, PCA_right, ACA_left, ACA_right, posterior_fossa, watershed, lacunar
    infarctPhase: text("infarct_phase"), // hyperacute, acute, subacute, chronic
    // Hemorrhage
    hemorrhagePresent: boolean("hemorrhage_present").notNull().default(false),
    hemorrhageSizeMm: numeric("hemorrhage_size_mm", { precision: 6, scale: 2 }),
    hemorrhageType: text("hemorrhage_type"), // EDH, SDH, SAH, IPH, IVH, mixed
    hemorrhageLocation: text("hemorrhage_location"),
    // Mass/Tumor
    massPresent: boolean("mass_present").notNull().default(false),
    massVolumeCc: numeric("mass_volume_cc", { precision: 8, scale: 3 }),
    massLocation: text("mass_location"),
    massEnhancement: text("mass_enhancement"), // none, ring, solid, heterogeneous
    // Edema
    edemaPresent: boolean("edema_present").notNull().default(false),
    edemaSeverity: text("edema_severity"), // mild, moderate, severe
    edemaType: text("edema_type"), // vasogenic, cytotoxic, mixed
    // Mass effect
    massEffect: text("mass_effect"), // none, mild, moderate, severe
    // Sulci / gyri
    sulcalEfacement: text("sulcal_efacement"), // none, mild, moderate, severe
    corticalAtrophy: text("cortical_atrophy"), // none, mild, moderate, severe
    // White matter
    wmChanges: text("wm_changes"), // none, mild_periventricular, moderate_periventricular, deep_wm, confluent
    // Posterior fossa
    cerebellumNormal: boolean("cerebellum_normal").notNull().default(true),
    brainstemNormal: boolean("brainstem_normal").notNull().default(true),
    // Overall impression
    overallImpression: text("overall_impression"),
    recordedById: integer("recorded_by_id"),
    recordedByName: text("recorded_by_name"),
    studyDate: timestamp("study_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPatient: index("radiology_brain_sessions_patient_idx").on(t.patientId),
    byOrder: index("radiology_brain_sessions_order_idx").on(t.orderId),
  }),
);

// ─── Tumor Follow-up ─────────────────────────────────────────────────────────

export const radiologyTumorFollowupsTable = pgTable(
  "radiology_tumor_followups",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    // Link to a lesion (from lesion tracker) for continuity
    lesionId: integer("lesion_id"),
    // Study that produced this measurement
    orderId: integer("order_id"),
    studyId: integer("study_id"),
    studyInstanceUid: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    studyDate: timestamp("study_date", { withTimezone: true }),
    modality: text("modality"),
    // Tumor details
    tumorLabel: text("tumor_label").notNull(), // e.g. "Right frontal GBM"
    tumorLocation: text("tumor_location"),
    histologyType: text("histology_type"), // e.g. GBM, metastasis, meningioma
    // Measurements
    sizeMmAxis1: numeric("size_mm_axis1", { precision: 6, scale: 2 }), // longest axis
    sizeMmAxis2: numeric("size_mm_axis2", { precision: 6, scale: 2 }), // perpendicular
    sizeMmAxis3: numeric("size_mm_axis3", { precision: 6, scale: 2 }), // craniocaudal
    volumeCc: numeric("volume_cc", { precision: 8, scale: 3 }),
    // Change from prior (calculated)
    changePct: numeric("change_pct", { precision: 6, scale: 2 }),
    changeStatus: text("change_status"), // increased, decreased, stable, resolved, new_lesion
    // RECIST-like response
    responseStatus: text("response_status"), // CR, PR, SD, PD, NE (not evaluable)
    // Enhancement
    enhancementStatus: text("enhancement_status"), // none, peripheral, solid, heterogeneous, ring
    // Treatment context
    treatmentPhase: text("treatment_phase"), // pre_treatment, post_op, adjuvant, surveillance
    concurrentTreatment: text("concurrent_treatment"),
    // Notes
    notes: text("notes"),
    recordedById: integer("recorded_by_id"),
    recordedByName: text("recorded_by_name"),
    isBaseline: boolean("is_baseline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPatient: index("radiology_tumor_followups_patient_idx").on(t.patientId),
    byLesion: index("radiology_tumor_followups_lesion_idx").on(t.lesionId),
    byOrder: index("radiology_tumor_followups_order_idx").on(t.orderId),
  }),
);
