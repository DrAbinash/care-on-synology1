import { pgTable, serial, integer, varchar, timestamp, json, boolean, text, numeric } from "drizzle-orm/pg-core";
import { radiologyStudiesTable } from "./radiology";

export const fetalUsgStudiesTable = pgTable("fetal_usg_studies", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => radiologyStudiesTable.id),
  patientId: integer("patient_id").notNull(),
  studyType: varchar("study_type", { length: 40 }).notNull().default("unknown"), // early, nt, anomaly, growth, doppler, bpp, twin, followup
  trimester: varchar("trimester", { length: 10 }).notNull().default("unknown"), // first, second, third
  lmp: varchar("lmp", { length: 20 }),
  gaWeeks: integer("ga_weeks"),
  gaDays: integer("ga_days"),
  edd: varchar("edd", { length: 20 }),
  lmpGa: integer("lmp_ga"),
  biometricGa: integer("biometric_ga"),
  compositeGa: integer("composite_ga"),
  parity: varchar("parity", { length: 20 }),
  gravida: integer("gravida"),
  isTwin: boolean("is_twin").default(false),
  chorionicity: varchar("chorionicity", { length: 20 }),
  amnionicity: varchar("amnionicity", { length: 20 }),
  dopplerStudyDone: boolean("doppler_study_done").default(false),
  bppDone: boolean("bpp_done").default(false),
  status: varchar("status", { length: 20 }).notNull().default("received"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const fetalUsgMeasurementsTable = pgTable("fetal_usg_measurements", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => fetalUsgStudiesTable.id),
  // Gestational age measurements
  crl: numeric("crl", { precision: 6, scale: 2 }),
  msd: numeric("msd", { precision: 6, scale: 2 }),
  yolkSac: numeric("yolk_sac", { precision: 6, scale: 2 }),
  fetalHeartRate: integer("fetal_heart_rate"),
  // NT scan
  nt: numeric("nt", { precision: 5, scale: 2 }),
  nasalBone: varchar("nasal_bone", { length: 20 }),
  ductusVenousus: varchar("ductus_venosus", { length: 20 }),
  tricuspidFlow: varchar("tricuspid_flow", { length: 20 }),
  // Biometry
  bpd: numeric("bpd", { precision: 6, scale: 2 }),
  hc: numeric("hc", { precision: 6, scale: 2 }),
  ac: numeric("ac", { precision: 6, scale: 2 }),
  fl: numeric("fl", { precision: 6, scale: 2 }),
  hl: numeric("hl", { precision: 6, scale: 2 }),
  efw: numeric("efw", { precision: 8, scale: 2 }),
  efwPercentile: numeric("efw_percentile", { precision: 5, scale: 2 }),
  // Liquor
  afi: numeric("afi", { precision: 5, scale: 1 }),
  afiInterpretation: varchar("afi_interpretation", { length: 30 }),
  sdp: numeric("sdp", { precision: 5, scale: 1 }),
  // Placenta
  placentaLocation: varchar("placenta_location", { length: 30 }),
  placentaGrade: varchar("placenta_grade", { length: 10 }),
  // Presentation
  presentation: varchar("presentation", { length: 20 }),
  // Cervical
  cervicalLength: numeric("cervical_length", { precision: 5, scale: 2 }),
  cervicalLengthInterpretation: varchar("cervical_length_interpretation", { length: 30 }),
  // Doppler
  umbilicalArteryPi: numeric("umbilical_artery_pi", { precision: 5, scale: 2 }),
  umbilicalArteryRi: numeric("umbilical_artery_ri", { precision: 5, scale: 2 }),
  umbilicalArterySd: numeric("umbilical_artery_sd", { precision: 5, scale: 2 }),
  mcaPi: numeric("mca_pi", { precision: 5, scale: 2 }),
  mcaRi: numeric("mca_ri", { precision: 5, scale: 2 }),
  cpr: numeric("cpr", { precision: 5, scale: 2 }),
  ductusVenoususPi: numeric("ductus_venosus_pi", { precision: 5, scale: 2 }),
  ductusVenoususAWave: varchar("ductus_venosus_a_wave", { length: 10 }),
  uterineArteryPi: numeric("uterine_artery_pi", { precision: 5, scale: 2 }),
  uterineArteryRi: numeric("uterine_artery_ri", { precision: 5, scale: 2 }),
  // Confidence
  extractedFrom: varchar("extracted_from", { length: 20 }).default("manual"), // manual, dicom_sr, ocr
  confidenceScore: integer("confidence_score"), // 0-100
  // Twin A
  twinA_fhr: integer("twin_a_fhr"),
  twinA_bpd: numeric("twin_a_bpd", { precision: 6, scale: 2 }),
  twinA_hc: numeric("twin_a_hc", { precision: 6, scale: 2 }),
  twinA_ac: numeric("twin_a_ac", { precision: 6, scale: 2 }),
  twinA_fl: numeric("twin_a_fl", { precision: 6, scale: 2 }),
  twinA_efw: numeric("twin_a_efw", { precision: 8, scale: 2 }),
  twinA_presentation: varchar("twin_a_presentation", { length: 20 }),
  // Twin B
  twinB_fhr: integer("twin_b_fhr"),
  twinB_bpd: numeric("twin_b_bpd", { precision: 6, scale: 2 }),
  twinB_hc: numeric("twin_b_hc", { precision: 6, scale: 2 }),
  twinB_ac: numeric("twin_b_ac", { precision: 6, scale: 2 }),
  twinB_fl: numeric("twin_b_fl", { precision: 6, scale: 2 }),
  twinB_efw: numeric("twin_b_efw", { precision: 8, scale: 2 }),
  twinB_presentation: varchar("twin_b_presentation", { length: 20 }),
  discordancePercent: numeric("discordance_percent", { precision: 5, scale: 2 }),
  // BPP
  bppFetalBreathing: integer("bpp_fetal_breathing"),
  bppFetalMovement: integer("bpp_fetal_movement"),
  bppFetalTone: integer("bpp_fetal_tone"),
  bppAfi: integer("bpp_afi"),
  bppTotal: integer("bpp_total"),
  nstDone: boolean("nst_done").default(false),
  nstResult: varchar("nst_result", { length: 30 }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const fetalUsgChecklistsTable = pgTable("fetal_usg_checklists", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => fetalUsgStudiesTable.id),
  // Anomaly scan checklist
  skullBrain: varchar("skull_brain", { length: 20 }).default("not_assessed"),
  face: varchar("face", { length: 20 }).default("not_assessed"),
  spine: varchar("spine", { length: 20 }).default("not_assessed"),
  thorax: varchar("thorax", { length: 20 }).default("not_assessed"),
  heartFourChamber: varchar("heart_four_chamber", { length: 20 }).default("not_assessed"),
  outflowTracts: varchar("outflow_tracts", { length: 20 }).default("not_assessed"),
  abdomen: varchar("abdomen", { length: 20 }).default("not_assessed"),
  stomachBubble: varchar("stomach_bubble", { length: 20 }).default("not_assessed"),
  kidneys: varchar("kidneys", { length: 20 }).default("not_assessed"),
  urinaryBladder: varchar("urinary_bladder", { length: 20 }).default("not_assessed"),
  cordInsertion: varchar("cord_insertion", { length: 20 }).default("not_assessed"),
  limbs: varchar("limbs", { length: 20 }).default("not_assessed"),
  placenta: varchar("placenta", { length: 20 }).default("not_assessed"),
  liquor: varchar("liquor", { length: 20 }).default("not_assessed"),
  cervix: varchar("cervix", { length: 20 }).default("not_assessed"),
  // Additional notes
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const fetalUsgReportsTable = pgTable("fetal_usg_reports", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => fetalUsgStudiesTable.id),
  findings: text("findings"),
  impression: text("impression"),
  recommendation: text("recommendation"),
  aiDraft: text("ai_draft"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  finalizedBy: integer("finalized_by"),
  finalizedAt: timestamp("finalized_at", { mode: "date" }),
  criticalAlertsAcknowledged: boolean("critical_alerts_acknowledged").default(false),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const fetalUsgAuditLogsTable = pgTable("fetal_usg_audit_logs", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => fetalUsgStudiesTable.id),
  action: varchar("action", { length: 40 }).notNull(),
  performedBy: varchar("performed_by", { length: 100 }).notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const fetalUsgCriticalAlertsTable = pgTable("fetal_usg_critical_alerts", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => fetalUsgStudiesTable.id),
  alertType: varchar("alert_type", { length: 40 }).notNull(),
  alertMessage: text("alert_message").notNull(),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedBy: varchar("acknowledged_by", { length: 100 }),
  acknowledgedAt: timestamp("acknowledged_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const fetalUsgTemplatePreferencesTable = pgTable("fetal_usg_template_preferences", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  studyType: varchar("study_type", { length: 40 }).notNull(),
  templateJson: json("template_json").notNull(),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
