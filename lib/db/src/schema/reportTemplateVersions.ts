import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

// Phase 15: Report Template Versioning — tracks every change to structured templates
export const reportTemplateVersionsTable = pgTable(
  "report_template_versions",
  {
    id: serial("id").primaryKey(),
    templateId: text("template_id").notNull(), // e.g. "MRI_brain_sequence"
    version: integer("version").notNull(),
    content: text("content").notNull(), // JSON or template text
    name: text("name").notNull(),
    createdById: integer("created_by_id"),
    createdByName: text("created_by_name"),
    changeNotes: text("change_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    templateIdx: index("rtv_template_idx").on(t.templateId),
    versionIdx: index("rtv_version_idx").on(t.templateId, t.version),
  }),
);
export type ReportTemplateVersion = typeof reportTemplateVersionsTable.$inferSelect;
