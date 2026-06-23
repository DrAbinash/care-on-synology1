/**
 * Phase 9: Radiology Memory + Context Engine
 * Persistent radiology memory that learns reporting preferences over time.
 * All features are OFF by default. Radiologist remains final authority.
 */

import {
  pgTable, serial, integer, text, timestamp, boolean, jsonb, index,
} from "drizzle-orm/pg-core";

// ── radiology_memory — master memory table ──
export const radiologyMemoryTable = pgTable(
  "radiology_memory",
  {
    id: serial("id").primaryKey(),
    // Context
    staffId: integer("staff_id").notNull(),
    staffName: text("staff_name").notNull(),
    modality: text("modality").notNull(),
    bodyPart: text("body_part").notNull(),
    // Key content
    findingKey: text("finding_key").notNull(), // Normalized finding signature
    findingText: text("finding_text").notNull(),
    impressionText: text("impression_text"),
    impressionStyle: text("impression_style"), // bullet, numbered, paragraph
    // Classification
    classification: text("classification"), // BI-RADS, TI-RADS, etc.
    classificationValue: text("classification_value"),
    // Follow-up
    followUpText: text("follow_up_text"),
    // Template reference
    templateId: integer("template_id"),
    templateName: text("template_name"),
    // Source
    source: text("source").notNull().default("manual"), // manual, ai_accepted, template
    orderId: integer("order_id"),
    reportId: integer("report_id"),
    // Frequency tracking
    usageCount: integer("usage_count").notNull().default(1),
    acceptanceCount: integer("acceptance_count").notNull().default(0),
    rejectionCount: integer("rejection_count").notNull().default(0),
    editCount: integer("edit_count").notNull().default(0),
    // Last used
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    // AI safety
    isAiDraft: boolean("is_ai_draft").notNull().default(false),
    aiLabel: text("ai_label").default("AI Draft — Requires Radiologist Review"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("memory_staff_modality_idx").on(table.staffId, table.modality),
    index("memory_body_part_idx").on(table.bodyPart),
    index("memory_finding_key_idx").on(table.findingKey),
    index("memory_usage_count_idx").on(table.usageCount),
    index("memory_last_used_idx").on(table.lastUsedAt),
  ],
);

// ── radiology_memory_patterns — style patterns (wording preferences) ──
export const radiologyMemoryPatternsTable = pgTable(
  "radiology_memory_patterns",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    patternType: text("pattern_type").notNull(), // wording, impression_style, template_style, formatting, terminology
    // The normalized form
    key: text("key").notNull(),
    // The actual variant (e.g., "Diffuse disc bulge" vs "Posterior diffuse disc bulge")
    variant: text("variant").notNull(),
    // How many times this doctor chose this variant
    chosenCount: integer("chosen_count").notNull().default(1),
    // How many times alternatives were chosen
    alternativeCount: integer("alternative_count").notNull().default(0),
    // Acceptance rate
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pattern_staff_type_idx").on(table.staffId, table.patternType),
    index("pattern_key_idx").on(table.key),
  ],
);

// ── radiology_memory_measurements — measurement history tracking ──
export const radiologyMemoryMeasurementsTable = pgTable(
  "radiology_memory_measurements",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    patientId: integer("patient_id").notNull(),
    studyId: integer("study_id"),
    // Measurement context
    modality: text("modality").notNull(),
    bodyPart: text("body_part").notNull(),
    measurementType: text("measurement_type").notNull(), // brain_lesion, breast_lesion, thyroid_nodule, etc.
    // Values
    value: text("value").notNull(),
    unit: text("unit"),
    referenceRange: text("reference_range"),
    // Prior values for comparison
    priorValues: jsonb("prior_values").$type<string[]>(),
    // Classification if applicable
    classification: text("classification"),
    // Source
    source: text("source").notNull().default("manual"),
    // Usage tracking
    usageCount: integer("usage_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("measurement_staff_patient_idx").on(table.staffId, table.patientId),
    index("measurement_type_idx").on(table.measurementType),
    index("measurement_study_idx").on(table.studyId),
  ],
);

// ── radiology_memory_classifications — classification usage tracking ──
export const radiologyMemoryClassificationsTable = pgTable(
  "radiology_memory_classifications",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    classification: text("classification").notNull(), // BI-RADS, TI-RADS, PI-RADS, LI-RADS, Fazekas, Bosniak, Lung-RADS
    value: text("value").notNull(),
    // Context
    modality: text("modality"),
    bodyPart: text("body_part"),
    // Usage
    usageCount: integer("usage_count").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("classification_staff_idx").on(table.staffId, table.classification),
    index("classification_value_idx").on(table.value),
  ],
);

// ── radiology_memory_phrases — commonly used phrases ──
export const radiologyMemoryPhrasesTable = pgTable(
  "radiology_memory_phrases",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    // Context
    modality: text("modality").notNull(),
    bodyPart: text("body_part").notNull(),
    // Trigger: what the radiologist was typing
    trigger: text("trigger").notNull(),
    // Full phrase suggestion
    phrase: text("phrase").notNull(),
    // Phrase type
    phraseType: text("phrase_type").notNull().default("finding"), // finding, impression, measurement, recommendation
    // Frequency
    usageCount: integer("usage_count").notNull().default(1),
    acceptanceCount: integer("acceptance_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("phrase_staff_trigger_idx").on(table.staffId, table.trigger),
    index("phrase_type_idx").on(table.phraseType),
  ],
);

// ── radiology_memory_impressions — approved impression memory ──
export const radiologyMemoryImpressionsTable = pgTable(
  "radiology_memory_impressions",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    // Normalized signature of findings
    findingSignature: text("finding_signature").notNull(),
    // The impression text
    impressionText: text("impression_text").notNull(),
    // Context
    modality: text("modality"),
    bodyPart: text("body_part"),
    // Acceptance tracking
    usageCount: integer("usage_count").notNull().default(1),
    acceptanceCount: integer("acceptance_count").notNull().default(1),
    rejectionCount: integer("rejection_count").notNull().default(0),
    editCount: integer("edit_count").notNull().default(0),
    // Statistics
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("impression_staff_signature_idx").on(table.staffId, table.findingSignature),
    index("impression_body_part_idx").on(table.bodyPart),
  ],
);

// ── radiology_memory_decisions — accept/reject/edit tracking ──
export const radiologyMemoryDecisionsTable = pgTable(
  "radiology_memory_decisions",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    // What was suggested
    suggestionType: text("suggestion_type").notNull(), // impression, followup, measurement, phrase, classification
    suggestionText: text("suggestion_text").notNull(),
    // What the radiologist did
    action: text("action").notNull(), // accepted, rejected, edited
    // If edited, the final text
    finalText: text("final_text"),
    // Source
    source: text("source").notNull().default("ai"), // ai, template, memory
    // Context
    modality: text("modality"),
    bodyPart: text("body_part"),
    orderId: integer("order_id"),
    reportId: integer("report_id"),
    // Learning metadata
    timeToDecideMs: integer("time_to_decide_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("decision_staff_type_idx").on(table.staffId, table.suggestionType),
    index("decision_action_idx").on(table.action),
    index("decision_created_idx").on(table.createdAt),
  ],
);

// ── radiology_memory_feedback — explicit feedback buttons ──
export const radiologyMemoryFeedbackTable = pgTable(
  "radiology_memory_feedback",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    // The suggestion being rated
    suggestionType: text("suggestion_type").notNull(),
    suggestionText: text("suggestion_text").notNull(),
    // Feedback
    rating: text("rating").notNull(), // useful, not_useful, partially_useful
    // Comments
    comment: text("comment"),
    // Context
    modality: text("modality"),
    bodyPart: text("body_part"),
    orderId: integer("order_id"),
    reportId: integer("report_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("feedback_staff_rating_idx").on(table.staffId, table.rating),
    index("feedback_suggestion_idx").on(table.suggestionType),
  ],
);

// ── radiology_memory_usage — per-session usage stats ──
export const radiologyMemoryUsageTable = pgTable(
  "radiology_memory_usage",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    // Session summary
    sessionDate: text("session_date").notNull(), // YYYY-MM-DD
    // Counts
    suggestionsOffered: integer("suggestions_offered").notNull().default(0),
    suggestionsAccepted: integer("suggestions_accepted").notNull().default(0),
    suggestionsRejected: integer("suggestions_rejected").notNull().default(0),
    suggestionsEdited: integer("suggestions_edited").notNull().default(0),
    // Template usage
    templatesUsed: integer("templates_used").notNull().default(0),
    // Time stats
    avgReportTimeMs: integer("avg_report_time_ms"),
    // Auto-complete
    autocompleteUsed: integer("autocomplete_used").notNull().default(0),
    macrosUsed: integer("macros_used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_staff_date_idx").on(table.staffId, table.sessionDate),
    index("usage_date_idx").on(table.sessionDate),
  ],
);
