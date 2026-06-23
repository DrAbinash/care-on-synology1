import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-test report templates. A test can have many templates (e.g. an X-RAY
// test might have a "PA View" and a "Lateral View" template); one is marked
// default and is auto-loaded by the report generator.
export const reportTemplatesTable = pgTable("report_templates", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull(),       // FK → diagnostic_tests.id
  name: text("name").notNull(),               // human label, e.g. "Standard PA View"
  format: text("format").notNull().default("text"), // text | html
  content: text("content").notNull(),         // template body with [PLACEHOLDERS]
  isDefault: boolean("is_default").notNull().default(false),
  // Comma-separated finding keywords this template covers, e.g.
  //   "fatty liver, hepatomegaly"  →  voice/auto-pick will choose this template
  //   when those terms are mentioned. A template with empty tags is treated as
  //   the all-normal default.
  tags: text("tags"),
  modality: text("modality"),                          // USG, CT, MRI, X-RAY, LAB, ECG, ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byTest: index("report_templates_by_test_idx").on(t.testId),
}));

export const insertReportTemplateSchema = createInsertSchema(reportTemplatesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertReportTemplate = z.infer<typeof insertReportTemplateSchema>;
export type ReportTemplate = typeof reportTemplatesTable.$inferSelect;
