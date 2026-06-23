/**
 * Phase 10C: Multi-AI Review Audit Log
 * Persists every multi-provider AI review and the radiologist's winner selection.
 */
import {
  pgTable, serial, integer, text, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const radiologyAiReviewAuditsTable = pgTable("radiology_ai_review_audits", {
  id: serial("id").primaryKey(),
  modality: text("modality"),
  bodyPart: text("body_part"),
  studyUid: text("study_uid"),
  orderId: integer("order_id"),
  providersQueried: jsonb("providers_queried"),
  winnerProvider: text("winner_provider"),
  selectedById: integer("selected_by_id"),
  selectedByName: text("selected_by_name"),
  createdAt: timestamp("created_at").defaultNow(),
});
