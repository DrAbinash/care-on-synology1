import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ── echo_measurements ─────────────────────────────────────────────────────────
// Adult 2D Echocardiography measurements — one row per study
export const echoMeasurementsTable = pgTable(
  "echo_measurements",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(), // FK → radiology_studies.id
    patientId: integer("patient_id"),
    // Patient vitals
    heightCm: real("height_cm"),
    weightKg: real("weight_kg"),
    bsa: real("bsa"), // Body Surface Area (auto-calculated)
    bpSystolic: integer("bp_systolic"),
    bpDiastolic: integer("bp_diastolic"),
    heartRate: integer("heart_rate"),
    // 2D Measurements (mm)
    ivsd: real("ivsd"), // Interventricular Septum diastole
    ivss: real("ivss"), // Interventricular Septum systole
    lvidd: real("lvidd"), // LV Internal Dimension diastole
    lvids: real("lvids"), // LV Internal Dimension systole
    lvpwd: real("lvpwd"), // LV Posterior Wall diastole
    lvpws: real("lvpws"), // LV Posterior Wall systole
    laDiameter: real("la_diameter"),
    laVolume: real("la_volume"),
    laVolumeIndex: real("la_volume_index"),
    raSize: real("ra_size"),
    aorticRoot: real("aortic_root"),
    ascendingAorta: real("ascending_aorta"),
    rvBasal: real("rv_basal"),
    rvMid: real("rv_mid"),
    rvLength: real("rv_length"),
    tapase: real("tapase"), // Tricuspid Annular Plane Systolic Excursion
    rvsp: real("rvsp"), // RV Systolic Pressure (estimated from TR)
    // EF & Function
    efSimpson: real("ef_simpson"),
    efTeichholz: real("ef_teichholz"),
    fractionalShortening: real("fractional_shortening"),
    lvMass: real("lv_mass"),
    lvMassIndex: real("lv_mass_index"),
    // Doppler
    mvE: real("mv_e"), // Mitral valve E velocity
    mvA: real("mv_a"), // Mitral valve A velocity
    mvEaRatio: real("mv_ea_ratio"),
    mvDecelTime: real("mv_decel_time"),
    mvEePrime: real("mv_ee_prime"), // E/e' ratio
    septalEPrime: real("septal_e_prime"),
    lateralEPrime: real("lateral_e_prime"),
    avVelocity: real("av_velocity"),
    avGradient: real("av_gradient"),
    avArea: real("av_area"),
    trVelocity: real("tr_velocity"),
    trGradient: real("tr_gradient"),
    pulmonaryVelocity: real("pulmonary_velocity"),
    pulmonaryGradient: real("pulmonary_gradient"),
    // Calculated / Auto-derived
    lvh: boolean("lvh"), // Left Ventricular Hypertrophy
    relativeWallThickness: real("relative_wall_thickness"),
    lvGeometry: text("lv_geometry"), // normal, concentric_remodeling, concentric_lvh, eccentric_lvh
    diastolicDysfunctionGrade: text("diastolic_dysfunction_grade"), // none, grade_i, grade_ii, grade_iii
    pulmonaryHypertension: boolean("pulmonary_hypertension"),
    // Metadata
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("echo_measurements_study_idx").on(t.studyId),
    byPatient: index("echo_measurements_patient_idx").on(t.patientId),
  }),
);

// ── echo_valve_assessment ─────────────────────────────────────────────────────
export const echoValveAssessmentTable = pgTable(
  "echo_valve_assessment",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    valveName: text("valve_name").notNull(), // mitral | aortic | tricuspid | pulmonary
    // Morphology
    morphology: text("morphology"), // normal | thickened | calcified | prolapse | myxomatous | rheumatic
    // Stenosis
    stenosis: text("stenosis"), // none | mild | moderate | severe
    stenosisNotes: text("stenosis_notes"),
    // Regurgitation
    regurgitation: text("regurgitation"), // none | mild | mild-moderate | moderate | moderate-severe | severe
    regurgitationNotes: text("regurgitation_notes"),
    // Additional
    additionalFindings: text("additional_findings"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("echo_valve_study_idx").on(t.studyId),
  }),
);

// ── echo_regional_walls ───────────────────────────────────────────────────────
export const echoRegionalWallTable = pgTable(
  "echo_regional_walls",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    segment: text("segment").notNull(), // anterior | anteroseptal | inferoseptal | inferior | inferolateral | anterolateral | apex
    motion: text("motion").notNull().default("normal"), // normal | hypokinesia | akinesia | dyskinesia | hyperkinesia
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudy: index("echo_wall_study_idx").on(t.studyId),
  }),
);

// ── echo_reports ──────────────────────────────────────────────────────────────
export const echoReportsTable = pgTable(
  "echo_reports",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull().unique(),
    patientId: integer("patient_id"),
    // Report sections
    leftVentricle: text("left_ventricle"),
    rightVentricle: text("right_ventricle"),
    leftAtrium: text("left_atrium"),
    rightAtrium: text("right_atrium"),
    interatrialSeptum: text("interatrial_septum"),
    interventricularSeptum: text("interventricular_septum"),
    aorticValve: text("aortic_valve"),
    mitralValve: text("mitral_valve"),
    tricuspidValve: text("tricuspid_valve"),
    pulmonaryValve: text("pulmonary_valve"),
    pericardium: text("pericardium"),
    dopplerFindings: text("doppler_findings"),
    impression: text("impression"),
    recommendation: text("recommendation"),
    // Status
    status: text("status").notNull().default("draft"), // draft | reviewed | final
    draftedBy: text("drafted_by"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    finalizedBy: text("finalized_by"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    // Critical alerts acknowledged
    criticalAlertsAcknowledged: boolean("critical_alerts_acknowledged").notNull().default(false),
    // AI
    aiDraft: text("ai_draft"),
    aiDraftAt: timestamp("ai_draft_at", { withTimezone: true }),
    // Metadata
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("echo_reports_study_idx").on(t.studyId),
    byStatus: index("echo_reports_status_idx").on(t.status),
  }),
);

// ── echo_audit_logs ─────────────────────────────────────────────────────────────
export const echoAuditLogsTable = pgTable(
  "echo_audit_logs",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    action: text("action").notNull(), // measurement_entered | ai_draft_generated | draft_saved | reviewed | finalized | amended
    performedBy: text("performed_by"),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudy: index("echo_audit_study_idx").on(t.studyId),
  }),
);

// ── fetal_echo_studies ────────────────────────────────────────────────────────
export const fetalEchoStudiesTable = pgTable(
  "fetal_echo_studies",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull().unique(), // FK → radiology_studies.id
    patientId: integer("patient_id"),
    // Maternal
    gaWeeks: real("ga_weeks"),
    gaDays: integer("ga_days"),
    edd: text("edd"),
    lmp: text("lmp"),
    // Fetal Parameters
    fetalHeartRate: integer("fetal_heart_rate"),
    situs: text("situs"), // solitus | inversus | ambiguous
    cardiacAxis: text("cardiac_axis"),
    cardiacPosition: text("cardiac_position"),
    avConcordance: text("av_concordance"), // concordant | discordant
    vaConcordance: text("va_concordance"), // concordant | discordant
    // Chambers
    raNormal: boolean("ra_normal").default(true),
    laNormal: boolean("la_normal").default(true),
    rvNormal: boolean("rv_normal").default(true),
    lvNormal: boolean("lv_normal").default(true),
    // Views
    fourChamberView: text("four_chamber_view"), // normal | abnormal | not_visualized
    lvot: text("lvot"),
    rvot: text("rvot"),
    threeVesselView: text("three_vessel_view"),
    threeVesselTracheaView: text("three_vessel_trachea_view"),
    aorticArch: text("aortic_arch"),
    ductalArch: text("ductal_arch"),
    // Septa
    interatrialSeptum: text("interatrial_septum"),
    interventricularSeptum: text("interventricular_septum"),
    // Valves
    mitralValve: text("mitral_valve"),
    tricuspidValve: text("tricuspid_valve"),
    aorticValve: text("aortic_valve"),
    pulmonaryValve: text("pulmonary_valve"),
    // Rhythm
    rhythm: text("rhythm").default("normal_sinus"), // normal_sinus | tachycardia | bradycardia | arrhythmia
    rhythmNotes: text("rhythm_notes"),
    // Doppler
    umbilicalArteryPi: real("umbilical_artery_pi"),
    umbilicalArteryRi: real("umbilical_artery_ri"),
    ductusVenoususPi: real("ductus_venosus_pi"),
    ductusVenoususAWave: text("ductus_venosus_a_wave"), // positive | absent | reversed
    mcaPi: real("mca_pi"),
    mcaRi: real("mca_ri"),
    // Abnormalities
    suspectedAbnormalities: text("suspected_abnormalities"), // JSON array of strings
    // Status
    status: text("status").notNull().default("draft"),
    draftedBy: text("drafted_by"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    finalizedBy: text("finalized_by"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    criticalAlertsAcknowledged: boolean("critical_alerts_acknowledged").notNull().default(false),
    // AI
    aiDraft: text("ai_draft"),
    aiDraftAt: timestamp("ai_draft_at", { withTimezone: true }),
    // Metadata
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("fetal_echo_study_idx").on(t.studyId),
    byStatus: index("fetal_echo_status_idx").on(t.status),
  }),
);

// ── fetal_echo_audit_logs ─────────────────────────────────────────────────────
export const fetalEchoAuditLogsTable = pgTable(
  "fetal_echo_audit_logs",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    action: text("action").notNull(),
    performedBy: text("performed_by"),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudy: index("fetal_echo_audit_study_idx").on(t.studyId),
  }),
);
