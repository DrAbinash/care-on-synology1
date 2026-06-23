/**
 * Phase 10C: Image Annotation Layer
 * Metadata/overlay annotations on DICOM key images, linked to teaching files.
 * Annotations are records (not pixel edits) — they store coordinates + labels.
 */
import {
  pgTable, serial, integer, text, timestamp, jsonb, boolean, index,
} from "drizzle-orm/pg-core";

export const radiologyAnnotationsTable = pgTable(
  "radiology_annotations",
  {
    id: serial("id").primaryKey(),
    // DICOM image reference
    studyInstanceUid: text("study_instance_uid").notNull(),
    seriesInstanceUid: text("series_instance_uid"),
    sopInstanceUid: text("sop_instance_uid"), // specific image
    frameNumber: integer("frame_number"),
    // Annotation type
    annotationType: text("annotation_type").notNull(), // arrow, circle, measurement, label, teaching_note, polygon
    // Coordinates as JSONB — format depends on type:
    // arrow: [{x, y}, {x, y}] (start, end)
    // circle: [{cx, cy, r}]
    // measurement: [{x, y}, {x, y}, {label}]
    // label/teaching_note: [{x, y}]
    coordinates: jsonb("coordinates"),
    // Display
    labelText: text("label_text"),
    color: text("color").default("#FFFF00"), // default yellow
    strokeWidth: integer("stroke_width").default(2),
    // Teaching case link
    linkedTeachingCaseId: integer("linked_teaching_case_id"),
    isKeyAnnotation: boolean("is_key_annotation").notNull().default(false),
    // Study context (denormalized for fast lookup)
    orderId: integer("order_id"),
    studyId: integer("study_id"),
    patientId: integer("patient_id"),
    // Who created it
    createdById: integer("created_by_id").notNull(),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("radiology_annotations_study_idx").on(t.studyInstanceUid),
    bySeries: index("radiology_annotations_series_idx").on(t.seriesInstanceUid),
    byTeachingCase: index("radiology_annotations_teaching_case_idx").on(t.linkedTeachingCaseId),
    byOrder: index("radiology_annotations_order_idx").on(t.orderId),
    byPatient: index("radiology_annotations_patient_idx").on(t.patientId),
  }),
);
