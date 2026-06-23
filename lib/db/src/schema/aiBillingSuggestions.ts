import { pgTable, serial, integer, text, real, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Phase 16: AI-Assisted Billing Code Suggestions
// Stores AI-generated CPT/ICD code suggestions linked to worklist entries.
// Status: pending | reviewed | accepted | rejected
export const aiBillingSuggestionsTable = pgTable(
  "ai_billing_suggestions",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id").notNull(),
    reportId: integer("report_id"),
    cptCodes: text("cpt_codes"), // JSON array of { code, description, confidence }
    icdCodes: text("icd_codes"), // JSON array of { code, description, confidence }
    overallConfidence: real("overall_confidence"),
    aiSafetyLabel: text("ai_safety_label").notNull().default("AI Draft – Requires Radiologist Review"),
    status: text("status").notNull().default("pending"),
    reviewedById: integer("reviewed_by_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedNotes: text("reviewed_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    worklistIdx: index("ai_billing_wl_idx").on(t.worklistId),
    statusIdx: index("ai_billing_status_idx").on(t.status),
  }),
);
export type AiBillingSuggestion = typeof aiBillingSuggestionsTable.$inferSelect;
