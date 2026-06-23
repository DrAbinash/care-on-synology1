import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const aiPatientCommunicationsTable = pgTable("ai_patient_communications", {
  id: serial("id").primaryKey(),
  worklistId: integer("worklist_id"),
  reportId: integer("report_id"),
  patientId: integer("patient_id"),
  communicationType: text("communication_type").notNull().default("result_summary"),
  language: text("language").notNull().default("en"),
  originalText: text("original_text"),
  aiDraft: text("ai_draft"),
  aiSafetyLabel: text("ai_safety_label").notNull().default("AI Draft – Requires Radiologist Review"),
  status: text("status").notNull().default("pending"),
  reviewedById: integer("reviewed_by_id"),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentById: integer("sent_by_id"),
  sentByName: text("sent_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
