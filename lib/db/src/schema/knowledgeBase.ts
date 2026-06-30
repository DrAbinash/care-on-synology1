// ── AI Receptionist Knowledge Base ──
// Epic 1 (Knowledge Engine) per AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md.
//
// This is intentionally a separate table from rag_document_embeddings
// (radiology report/finding embeddings, patient/study-scoped) and from
// radiology_master_templates (locked clinical report templates). Neither
// of those fits this table's purpose: patient- and staff-facing
// informational content (hospital info, prep instructions, FAQs,
// policies, SOPs) that any AI face — WhatsApp bot, future website
// assistant, internal staff assistant — queries for grounded answers.
//
// Design decisions, each tied to a specific requirement from the
// roadmap/blueprint documents:
//   - "suggested, never auto-applied" lifecycle → status column with an
//     explicit 'suggested' state, separate from 'published'
//   - versioning → version integer + a separate history table, not an
//     in-place overwrite, so a bad edit is always recoverable
//   - clinically-sensitive categories require a stricter editor role
//     → sensitiveCategory boolean, enforced in the route layer (not
//     just documented), since a DB column alone doesn't stop a bad query
//   - "no KB hit → escalate, don't improvise" → the retrieval layer
//     (not this schema) is responsible for returning an explicit
//     no-match signal; this schema only needs to make "is there
//     published content matching X" answerable correctly

import {
  pgTable, serial, integer, text, boolean, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Canonical category list — kept in code (not a DB enum) so adding a
// category is a code review, not a migration, matching how
// PERMISSION_MODULES/ERP_ROLES are already done in this codebase.
export const KB_CATEGORIES = [
  "hospital_info",
  "doctors",
  "departments",
  "tests",
  "packages",
  "preparation_instructions",
  "faqs",
  "policies",
  "insurance",
  "refund_rules",
  "vip_rules",
  "pcpndt_faqs",
  "radiology_faqs",
  "laboratory_faqs",
  "contact_information",
  "emergency_contacts",
  "clinical_escalation_triggers", // red-flag phrases, see 04_ §4.4
  // Staff-facing categories (Master Vision §11.2 — extends scope beyond
  // patient-facing content to internal SOPs, same engine, same lifecycle)
  "radiology_sops",
  "laboratory_sops",
  "machine_sops",
  "training_material",
  "administrative_policies",
  "patient_education",
  "marketing_content",
] as const;
export type KbCategory = typeof KB_CATEGORIES[number];

// Categories that require a clinically-authorized editor role, not just
// general Admin — per 03_ §5.1 and 04_ §6.2's explicit requirement.
// Enforced in the route layer; listed here so the route layer has one
// canonical source for this list rather than duplicating it.
export const KB_SENSITIVE_CATEGORIES: ReadonlySet<KbCategory> = new Set([
  "preparation_instructions",
  "pcpndt_faqs",
  "clinical_escalation_triggers",
]);

export const KB_STATUSES = ["draft", "suggested", "published", "archived"] as const;
export type KbStatus = typeof KB_STATUSES[number];

export const knowledgeBaseEntriesTable = pgTable(
  "knowledge_base_entries",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(), // one of KB_CATEGORIES
    title: text("title").notNull(),
    content: text("content").notNull(),
    // Keyword/tag list for retrieval — see 03_ §5.3's recommendation to
    // start with keyword/category retrieval, not vector search, until
    // real usage data justifies the added complexity of pgvector.
    keywords: text("keywords").notNull().default(""), // comma-separated
    status: text("status").notNull().default("draft"), // one of KB_STATUSES
    version: integer("version").notNull().default(1),
    // True for categories in KB_SENSITIVE_CATEGORIES at time of creation —
    // denormalized for fast filtering without joining against the
    // category list; route layer still re-checks against
    // KB_SENSITIVE_CATEGORIES on every write, this is a query-speed aid
    // only, never the sole gate.
    isSensitive: boolean("is_sensitive").notNull().default(false),
    // Suggestion provenance — populated only when status = 'suggested',
    // per the "AI suggests, never auto-applies" lifecycle. Null for
    // human-authored entries.
    suggestedFromQuestion: text("suggested_from_question"),
    suggestedReason: text("suggested_reason"),
    createdBy: text("created_by").notNull().default(""),
    updatedBy: text("updated_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    categoryIdx: index("kb_entries_category_idx").on(t.category),
    statusIdx: index("kb_entries_status_idx").on(t.status),
    categoryStatusIdx: index("kb_entries_category_status_idx").on(t.category, t.status),
  }),
);

// Version history — every publish/edit of a *published* entry snapshots
// the prior version here before overwriting, so rollback (04_ §2.7) is
// always a real, recoverable action, not just a design intention.
export const knowledgeBaseHistoryTable = pgTable(
  "knowledge_base_history",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id").notNull().references(() => knowledgeBaseEntriesTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    keywords: text("keywords").notNull().default(""),
    changedBy: text("changed_by").notNull().default(""),
    changeType: text("change_type").notNull().default("edit"), // edit | rollback | publish
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entryIdx: index("kb_history_entry_idx").on(t.entryId),
    entryVersionUq: uniqueIndex("kb_history_entry_version_uq").on(t.entryId, t.version),
  }),
);

// Search-query log — feeds two things per the roadmap: "Top FAQs"
// analytics (what's asked most) and knowledge-gap detection (what's
// asked and returns no match, 04_ §6.4's detection signal 1).
export const knowledgeBaseSearchLogTable = pgTable(
  "knowledge_base_search_log",
  {
    id: serial("id").primaryKey(),
    query: text("query").notNull(),
    matchedEntryId: integer("matched_entry_id").references(() => knowledgeBaseEntriesTable.id, { onDelete: "set null" }),
    matched: boolean("matched").notNull().default(false),
    // Which AI face/channel issued this query — 'whatsapp' | 'staff_assistant' | etc.
    // Free text, not an enum, since new channels are added over time
    // (03_ Deliverable 10's phased channel rollout) and this log
    // shouldn't need a migration every time one ships.
    channel: text("channel").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    matchedIdx: index("kb_search_log_matched_idx").on(t.matched),
    createdAtIdx: index("kb_search_log_created_at_idx").on(t.createdAt),
  }),
);

export const insertKnowledgeBaseEntrySchema = createInsertSchema(knowledgeBaseEntriesTable).omit({
  id: true, version: true, publishedAt: true, createdAt: true, updatedAt: true,
});
export type InsertKnowledgeBaseEntry = z.infer<typeof insertKnowledgeBaseEntrySchema>;
export type KnowledgeBaseEntry = typeof knowledgeBaseEntriesTable.$inferSelect;
export type KnowledgeBaseHistory = typeof knowledgeBaseHistoryTable.$inferSelect;
export type KnowledgeBaseSearchLog = typeof knowledgeBaseSearchLogTable.$inferSelect;
