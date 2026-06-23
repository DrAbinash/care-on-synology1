import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Library of pre-canned abnormal findings that can be auto-suggested or
// inserted by voice in the Report Generator. Each finding belongs to a test
// (or to a category, when testId is null) and has a keyword used for
// matching against speech / typed input plus the long-form description that
// gets dropped into the report.
//
// Examples:
//   testId=USG-WHOLE-ABDOMEN  keyword="fatty liver"
//     description="The liver is enlarged with diffusely increased echogenicity..."
//   testId=USG-WHOLE-ABDOMEN  keyword="cholelithiasis"
//     description="A 12 mm echogenic focus with posterior acoustic shadowing is seen in the gallbladder lumen..."
export const abnormalFindingsTable = pgTable("abnormal_findings", {
  id: serial("id").primaryKey(),
  testId: integer("test_id"),                         // nullable → applies to all tests in the modality
  modality: text("modality"),                         // optional grouping (USG, CT, MRI, X-RAY, LAB, etc.)
  category: text("category"),                         // organ / system, e.g. "Liver", "Gallbladder"
  keyword: text("keyword").notNull(),                 // short label/trigger, e.g. "fatty liver"
  aliases: text("aliases"),                           // comma-separated synonyms ("steatosis, fatty change")
  description: text("description").notNull(),         // long-form text inserted into report
  severity: text("severity").notNull().default("moderate"), // mild | moderate | severe
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),  // updated each time it's inserted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byTest: index("abnormal_findings_by_test_idx").on(t.testId),
  byModality: index("abnormal_findings_by_modality_idx").on(t.modality),
}));

export const insertAbnormalFindingSchema = createInsertSchema(abnormalFindingsTable).omit({
  id: true, createdAt: true, updatedAt: true, usageCount: true,
});
export type InsertAbnormalFinding = z.infer<typeof insertAbnormalFindingSchema>;
export type AbnormalFinding = typeof abnormalFindingsTable.$inferSelect;
