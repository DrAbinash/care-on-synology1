/**
 * Phase 10A: Lesion Tracker — longitudinal lesion monitoring across studies.
 * All features OFF by default. Radiologist is always final authority.
 */

import {
  pgTable, serial, integer, text, timestamp, boolean, real, index,
} from "drizzle-orm/pg-core";

// ── radiology_lesions — master lesion registry ──
export const radiologyLesionsTable = pgTable(
  "radiology_lesions",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    // Identifiers
    lesionLabel: text("lesion_label").notNull(),
    location: text("location").notNull(),
    organ: text("organ"),
    subLocation: text("sub_location"),
    // Modality context
    modality: text("modality").notNull(),
    bodyPart: text("body_part"),
    // First detection
    firstStudyId: integer("first_study_id"),
    firstOrderId: integer("first_order_id"),
    firstDetectedAt: timestamp("first_detected_at"),
    firstDetectedBy: text("first_detected_by"),
    // Current state
    status: text("status").notNull().default("active"),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"),
    // Classification
    lesionType: text("lesion_type"),
    classification: text("classification"),
    classificationValue: text("classification_value"),
    morphology: text("morphology"),
    // Notes
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    patientIdx: index("radiology_lesions_patient_idx").on(t.patientId),
    statusIdx: index("radiology_lesions_status_idx").on(t.status),
  }),
);

// ── radiology_lesion_timeline — per-study measurements for each lesion ──
export const radiologyLesionTimelineTable = pgTable(
  "radiology_lesion_timeline",
  {
    id: serial("id").primaryKey(),
    lesionId: integer("lesion_id").notNull(),
    patientId: integer("patient_id").notNull(),
    studyId: integer("study_id"),
    orderId: integer("order_id"),
    // Measurement
    measurementMm: real("measurement_mm"),
    measurementMm2: real("measurement_mm2"),
    measurementMm3: real("measurement_mm3"),
    volumeCc: real("volume_cc"),
    // Image reference
    seriesNumber: text("series_number"),
    imageNumber: text("image_number"),
    sliceLocation: text("slice_location"),
    // Status assessment
    changeStatus: text("change_status"),
    changePercent: real("change_percent"),
    // Signal/density/enhancement
    signalCharacteristics: text("signal_characteristics"),
    enhancement: text("enhancement"),
    // Reporter
    reportedBy: text("reported_by"),
    reportedAt: timestamp("reported_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    lesionIdx: index("radiology_lesion_timeline_lesion_idx").on(t.lesionId),
    patientIdx: index("radiology_lesion_timeline_patient_idx").on(t.patientId),
    studyIdx: index("radiology_lesion_timeline_study_idx").on(t.studyId),
  }),
);

// ── radiology_measurements — structured measurement records linked to study ──
export const radiologyMeasurementsTable = pgTable(
  "radiology_measurements",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    studyId: integer("study_id"),
    orderId: integer("order_id"),
    modality: text("modality").notNull(),
    bodyPart: text("body_part").notNull(),
    measurementType: text("measurement_type").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    normalRangeLow: real("normal_range_low"),
    normalRangeHigh: real("normal_range_high"),
    isAbnormal: boolean("is_abnormal"),
    notes: text("notes"),
    reportedBy: text("reported_by"),
    reportedAt: timestamp("reported_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    patientIdx: index("radiology_measurements_patient_idx").on(t.patientId),
    studyIdx: index("radiology_measurements_study_idx").on(t.studyId),
    modalityIdx: index("radiology_measurements_modality_idx").on(t.modality),
  }),
);
