import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// Ticket R1.2 — versioned report PRESENTATION templates (distinct from
// report_template_versions, which versions CLINICAL structured templates).
//
// radiology_presentation_templates — one row per (template_key, version).
// Published versions are IMMUTABLE: editing creates the next version;
// deletion is soft retirement (status='retired'). The 8 system templates
// (care-classic … referrer-copy) live as code seeds at version 1 and only
// gain rows here when an admin publishes an edit — resolution checks the
// database first and falls back to the seed.
export const radiologyPresentationTemplatesTable = pgTable(
  "radiology_presentation_templates",
  {
    id: serial("id").primaryKey(),
    templateKey: text("template_key").notNull(),   // immutable slug
    version: integer("version").notNull(),          // 1..n per key
    displayName: text("display_name").notNull(),
    description: text("description"),
    // Scope hierarchy reserved for multi-centre (global|organization|branch|
    // department); only "global" is used today.
    orgScope: text("org_scope").notNull().default("global"),
    // standard | patient | referrer
    copyType: text("copy_type").notNull().default("standard"),
    // published | retired (drafts never persist — validation happens pre-insert)
    status: text("status").notNull().default("published"),
    // Renderer contract the definition was authored against (import gate).
    rendererVersion: integer("renderer_version").notNull().default(1),
    isSystem: boolean("is_system").notNull().default(false),
    // The validated TemplateDefinition (typography/colors/page/…).
    definition: jsonb("definition").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredBy: text("retired_by"),
  },
  (t) => ({
    keyVersionUq: uniqueIndex("rpt_key_version_uq").on(t.templateKey, t.version),
    byKey: index("rpt_key_idx").on(t.templateKey),
    byStatus: index("rpt_status_idx").on(t.status),
  }),
);

// radiology_report_presentation_freeze — the template identity a report was
// SIGNED under (Phase 3 immutability). One row per signed report revision;
// the snapshot keeps the resolved definition so historical rendering is
// reproducible even if a version row is somehow lost. Never updated, never
// deleted; reports without a row (pre-R1.2) fall back to the active
// selection — the documented historical fallback.
export const radiologyReportPresentationFreezeTable = pgTable(
  "radiology_report_presentation_freeze",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id").notNull(),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    snapshot: jsonb("snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reportUq: uniqueIndex("rrpf_report_uq").on(t.reportId),
  }),
);

export type RadiologyPresentationTemplate = typeof radiologyPresentationTemplatesTable.$inferSelect;
export type RadiologyReportPresentationFreeze = typeof radiologyReportPresentationFreezeTable.$inferSelect;
