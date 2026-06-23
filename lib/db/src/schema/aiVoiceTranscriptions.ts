import { pgTable, serial, integer, text, real, boolean, timestamp } from "drizzle-orm/pg-core";

export const aiVoiceTranscriptionsTable = pgTable("ai_voice_transcriptions", {
  id: serial("id").primaryKey(),
  worklistId: integer("worklist_id"),
  reportId: integer("report_id"),
  patientId: integer("patient_id"),
  radiologistId: integer("radiologist_id"),
  radiologistName: text("radiologist_name"),
  audioUrl: text("audio_url"),
  audioDurationSeconds: real("audio_duration_seconds"),
  rawTranscript: text("raw_transcript"),
  confidenceScore: real("confidence_score"),
  correctedText: text("corrected_text"),
  insertedIntoReport: boolean("inserted_into_report").notNull().default(false),
  status: text("status").notNull().default("pending"),
  modality: text("modality"),
  bodyPart: text("body_part"),
  aiSafetyLabel: text("ai_safety_label").notNull().default("AI Draft – Requires Radiologist Review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
