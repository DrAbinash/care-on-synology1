import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Audit log for voice dictation sessions.
 * Every start / stop / generate / insert action is recorded here
 * for compliance and usage analytics.
 */
export const voiceDictationLogsTable = pgTable("voice_dictation_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name"),
  studyId: integer("study_id"),
  accessionNumber: text("accession_number"),
  // started | stopped | generated | inserted | ai_cleaned
  action: text("action").notNull(),
  durationSecs: integer("duration_secs"),
  wordCount: integer("word_count"),
  wasAiCleaned: boolean("was_ai_cleaned").notNull().default(false),
  insertedToReport: boolean("inserted_to_report").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VoiceDictationLog = typeof voiceDictationLogsTable.$inferSelect;
