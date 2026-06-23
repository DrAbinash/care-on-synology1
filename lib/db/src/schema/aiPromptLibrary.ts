import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── AI Prompt Library (Phase 7A) ──────────────────────────────────────────
// Enterprise prompt manager with 16 categories × 9 prompt types stored as JSON.
// One row per category per library owner. Prompts are versioned and auditable.
//
// Categories: MRI Brain, MRI Spine, MRI Knee, MRI Shoulder, MRI Abdomen,
//   MRI Pelvis, CT Brain, CT Trauma, CT Chest, HRCT Chest, USG Abdomen,
//   Obstetric USG, Doppler, Mammography, X-Ray, Generic Reporting
//
// Prompt Types: system, image_review, findings, impression, differential,
//   followup, quality, polish, formatting
export const aiPromptLibraryTable = pgTable(
  "ai_prompt_library",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g. "MRI Brain"
    modality: text("modality").notNull(), // MRI | CT | USG | X-Ray | OTHER
    // JSON object with all 9 prompt types:
    // { system, image_review, findings, impression, differential, followup, quality, polish, formatting }
    promptsJson: jsonb("prompts_json").notNull().default({}),
    version: integer("version").notNull().default(1),
    // Library owner: "care_diagnostics", "dr_sugandha", "dr_abinash", "hope_hospital"
    libraryOwner: text("library_owner").notNull().default("care_diagnostics"),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byModality: index("ai_prompt_lib_modality_idx").on(t.modality),
    byOwner: index("ai_prompt_lib_owner_idx").on(t.libraryOwner),
    byActive: index("ai_prompt_lib_active_idx").on(t.isActive),
    // Unique per category per library owner
    uniqueNameOwner: uniqueIndex("ai_prompt_lib_name_owner_uq").on(t.name, t.libraryOwner),
  }),
);

export type AiPromptLibrary = typeof aiPromptLibraryTable.$inferSelect;
export type NewAiPromptLibrary = typeof aiPromptLibraryTable.$inferInsert;

// ─── AI Prompt Library Versions ───────────────────────────────────────────────
// Immutable version history for prompt library entries.
export const aiPromptLibraryVersionsTable = pgTable(
  "ai_prompt_library_versions",
  {
    id: serial("id").primaryKey(),
    libraryId: integer("library_id").notNull(),
    version: integer("version").notNull(),
    promptsJson: jsonb("prompts_json").notNull().default({}),
    changeNotes: text("change_notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byLibraryId: index("ai_prompt_lib_ver_lib_id_idx").on(t.libraryId),
    byVersion: index("ai_prompt_lib_ver_ver_idx").on(t.libraryId, t.version),
  }),
);

export type AiPromptLibraryVersion = typeof aiPromptLibraryVersionsTable.$inferSelect;
export type NewAiPromptLibraryVersion = typeof aiPromptLibraryVersionsTable.$inferInsert;
