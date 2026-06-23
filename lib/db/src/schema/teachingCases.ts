/**
 * Phase 8: Teaching Files & Interesting Cases Registry
 * Anonymized teaching cases for education, research, and conference.
 */
import {
  pgTable, serial, integer, text, timestamp, date, boolean,
  uniqueIndex, index, jsonb,
} from "drizzle-orm/pg-core";

export const teachingCasesTable = pgTable(
  "teaching_cases",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    diagnosis: text("diagnosis"),
    // Category: MRI Brain, CT Brain, USG Abdomen, etc.
    category: text("category").notNull(),
    // Difficulty: beginner, intermediate, advanced, expert
    difficulty: text("difficulty").notNull().default("intermediate"),
    // Source: auto-imported from report, manually created
    source: text("source").notNull().default("manual"),
    // DICOM references
    studyInstanceUid: text("study_instance_uid"),
    seriesInstanceUid: text("series_instance_uid"),
    sopInstanceUid: text("sop_instance_uid"),
    // Conquest PACS reference
    pacsUrl: text("pacs_url"),
    // Anonymized patient data (age, gender only)
    patientAge: text("patient_age"),
    patientGender: text("patient_gender"),
    // Original study data (auto-imported)
    modality: text("modality"),
    bodyPart: text("body_part"),
    studyDescription: text("study_description"),
    findings: text("findings"),
    impression: text("impression"),
    measurements: text("measurements"),
    // AI-generated content
    aiNotes: text("ai_notes"),
    aiSummary: text("ai_summary"),
    // Teaching content
    learningPoints: text("learning_points"),
    pearls: text("pearls"),
    pitfalls: text("pitfalls"),
    // Research tracking
    isResearchCandidate: boolean("is_research_candidate").notNull().default(false),
    researchStatus: text("research_status"), // case_report, poster, conference, publication, literature_review
    // Tags as JSON array for fast filtering
    tagsJson: text("tags_json").default("[]"),
    // Classification systems used
    classification: text("classification"), // BI-RADS, TI-RADS, etc.
    classificationValue: text("classification_value"),
    // Who created it
    createdById: integer("created_by_id").notNull(),
    createdByName: text("created_by_name"),
    // Anonymization status
    isAnonymized: boolean("is_anonymized").notNull().default(false),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    // View counts
    viewCount: integer("view_count").notNull().default(0),
    shareCount: integer("share_count").notNull().default(0),
    // Status
    status: text("status").notNull().default("draft"), // draft, published, archived
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byCategory: index("teaching_cases_category_idx").on(t.category),
    byDifficulty: index("teaching_cases_difficulty_idx").on(t.difficulty),
    byStatus: index("teaching_cases_status_idx").on(t.status),
    byModality: index("teaching_cases_modality_idx").on(t.modality),
    byBodyPart: index("teaching_cases_body_part_idx").on(t.bodyPart),
    byDiagnosis: index("teaching_cases_diagnosis_idx").on(t.diagnosis),
    byCreatedBy: index("teaching_cases_created_by_idx").on(t.createdById),
    byResearch: index("teaching_cases_research_idx").on(t.isResearchCandidate),
  }),
);

export const teachingCaseImagesTable = pgTable(
  "teaching_case_images",
  {
    id: serial("id").primaryKey(),
    teachingCaseId: integer("teaching_case_id").notNull(),
    // Image reference
    imageUrl: text("image_url"),
    imageData: text("image_data"), // base64 for small thumbnails
    thumbnailUrl: text("thumbnail_url"),
    // PACS reference
    studyInstanceUid: text("study_instance_uid"),
    seriesInstanceUid: text("series_instance_uid"),
    sopInstanceUid: text("sop_instance_uid"),
    frameNumber: integer("frame_number"),
    // Metadata
    isKeyImage: boolean("is_key_image").notNull().default(false),
    description: text("description"),
    annotationData: text("annotation_data"), // JSON annotations
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCase: index("teaching_case_images_case_idx").on(t.teachingCaseId),
    byKeyImage: index("teaching_case_images_key_idx").on(t.isKeyImage),
  }),
);

export const teachingCaseCollectionsTable = pgTable(
  "teaching_case_collections",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // Owner: Dr Sugandha, Dr Abinash, Care, Hope, or shared
    ownerId: integer("owner_id"),
    ownerName: text("owner_name"),
    isShared: boolean("is_shared").notNull().default(false),
    // Case IDs as JSON array
    caseIdsJson: text("case_ids_json").default("[]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byOwner: index("teaching_case_collections_owner_idx").on(t.ownerId),
  }),
);

export const teachingCaseFavoritesTable = pgTable(
  "teaching_case_favorites",
  {
    id: serial("id").primaryKey(),
    teachingCaseId: integer("teaching_case_id").notNull(),
    userId: integer("user_id").notNull(),
    userName: text("user_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("teaching_case_favorites_uq").on(t.teachingCaseId, t.userId),
  }),
);

export const teachingCaseViewsTable = pgTable(
  "teaching_case_views",
  {
    id: serial("id").primaryKey(),
    teachingCaseId: integer("teaching_case_id").notNull(),
    userId: integer("user_id"),
    userName: text("user_name"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCase: index("teaching_case_views_case_idx").on(t.teachingCaseId),
  }),
);

export const teachingCaseNotesTable = pgTable(
  "teaching_case_notes",
  {
    id: serial("id").primaryKey(),
    teachingCaseId: integer("teaching_case_id").notNull(),
    userId: integer("user_id").notNull(),
    userName: text("user_name"),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCase: index("teaching_case_notes_case_idx").on(t.teachingCaseId),
  }),
);

export const measurementHistoryTable = pgTable(
  "measurement_history",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull(),
    // What was measured
    measurementType: text("measurement_type").notNull(), // e.g., "brain_lesion", "thyroid_nodule", "liver_lesion"
    measurementLabel: text("measurement_label").notNull(), // e.g., "Right frontal lobe mass"
    value: text("value").notNull(), // e.g., "14"
    unit: text("unit").default("mm"),
    // Location context
    bodyPart: text("body_part"),
    side: text("side"), // left, right, bilateral, midline
    level: text("level"), // e.g., L4-L5, T1, C3
    // Study reference
    studyId: integer("study_id"),
    studyInstanceUid: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    seriesNumber: text("series_number"),
    imageNumber: text("image_number"),
    modality: text("modality"),
    // Who measured
    measuredById: integer("measured_by_id"),
    measuredByName: text("measured_by_name"),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPatient: index("measurement_history_patient_idx").on(t.patientId),
    byType: index("measurement_history_type_idx").on(t.measurementType),
    byStudy: index("measurement_history_study_idx").on(t.studyId),
  }),
);
