import { pgTable, serial, text, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Structured radiology report templates.
 * Unlike reportTemplates (per-test), these are modality/bodyPart-based
 * and carry rich JSON sections (technique, findings items, impression,
 * macros, placeholders) for structured reporting workflows.
 *
 * sections_json schemaVersion:
 *   1 — { technique, findingsItems: [{label, normal}] }
 *   2 — StructuredFormatDoc (sections + repeating groups + fields)
 * The v1 shape remains valid; the reporting engine adapters it.
 */
export const structuredReportTemplatesTable = pgTable(
  "structured_report_templates",
  {
    id: serial("id").primaryKey(),
    templateName: text("template_name").notNull(),
    modality: text("modality").notNull(),    // MRI | CT | USG | X-RAY | DOPPLER | etc.
    bodyPart: text("body_part").notNull(),   // BRAIN | LS_SPINE | CHEST | ABDOMEN | etc.
    studyType: text("study_type"),           // PLAIN | CONTRAST | DOPPLER | STROKE_PROTOCOL | etc.
    // JSON: v1 findingsItems OR v2 StructuredFormatDoc
    sectionsJson: text("sections_json"),
    defaultFindings: text("default_findings"),    // normal findings prose
    defaultImpression: text("default_impression"), // normal impression prose
    // JSON array: [{ key, label, text }] — quick-insert macros
    macrosJson: text("macros_json"),
    isActive: boolean("is_active").notNull().default(true),
    isPreset: boolean("is_preset").notNull().default(false), // built-in presets
    // Additive v2 metadata (nullable/defaulted so existing rows stay valid)
    schemaVersion: integer("schema_version").notNull().default(1),
    formatVersion: integer("format_version").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    tags: text("tags").notNull().default(""),
    protocolKey: text("protocol_key"),
    parentId: integer("parent_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // JSON array of { archivedAt, formatVersion, sectionsJson } — never delete original JSON
    previousVersions: text("previous_versions").notNull().default("[]"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byModality: index("srt_modality_idx").on(t.modality),
    byBodyPart: index("srt_body_part_idx").on(t.bodyPart),
    byDefault: index("srt_default_idx").on(t.bodyPart, t.isDefault, t.isActive),
  }),
);

export type StructuredReportTemplate = typeof structuredReportTemplatesTable.$inferSelect;
export type InsertStructuredReportTemplate = typeof structuredReportTemplatesTable.$inferInsert;
