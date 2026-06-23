import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Structured radiology report templates.
 * Unlike reportTemplates (per-test), these are modality/bodyPart-based
 * and carry rich JSON sections (technique, findings items, impression,
 * macros, placeholders) for structured reporting workflows.
 */
export const structuredReportTemplatesTable = pgTable(
  "structured_report_templates",
  {
    id: serial("id").primaryKey(),
    templateName: text("template_name").notNull(),
    modality: text("modality").notNull(),    // MRI | CT | USG | X-RAY | DOPPLER | etc.
    bodyPart: text("body_part").notNull(),   // BRAIN | LS_SPINE | CHEST | ABDOMEN | etc.
    studyType: text("study_type"),           // PLAIN | CONTRAST | DOPPLER | STROKE_PROTOCOL | etc.
    // JSON: { technique, findingsItems: [{label, normal}], impression, placeholders }
    sectionsJson: text("sections_json"),
    defaultFindings: text("default_findings"),    // normal findings prose
    defaultImpression: text("default_impression"), // normal impression prose
    // JSON array: [{ key, label, text }] — quick-insert macros
    macrosJson: text("macros_json"),
    isActive: boolean("is_active").notNull().default(true),
    isPreset: boolean("is_preset").notNull().default(false), // built-in presets
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byModality: index("srt_modality_idx").on(t.modality),
    byBodyPart: index("srt_body_part_idx").on(t.bodyPart),
  }),
);

export type StructuredReportTemplate = typeof structuredReportTemplatesTable.$inferSelect;
export type InsertStructuredReportTemplate = typeof structuredReportTemplatesTable.$inferInsert;
