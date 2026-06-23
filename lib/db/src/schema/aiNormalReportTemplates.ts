import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const aiNormalReportTemplatesTable = pgTable("ai_normal_report_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  modality: text("modality").notNull(),
  bodyPart: text("body_part"),
  category: text("category").notNull().default("normal"),
  // normal | pathology | trauma | screening | contrast
  findings: text("findings").notNull(),
  impression: text("impression").notNull(),
  technique: text("technique"),
  clinicalHistory: text("clinical_history"),
  comparison: text("comparison"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
