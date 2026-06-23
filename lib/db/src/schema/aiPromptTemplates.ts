import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── AI prompt templates (Phase 1: AI Prompt Template Engine) ─────────────────
// Modality-aware, editable-without-code prompt presets used to drive AI radiology
// draft generation. Replaces the previously hardcoded AI_PROMPT_TEMPLATES map.
//
// Workflow: Study Type → matching prompt selected → AI report generated.
// Templates are fully editable via Settings → AI Prompt Templates (no code change).
export const aiPromptTemplatesTable = pgTable(
  "ai_prompt_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g. "MRI Brain"
    modality: text("modality").notNull(), // MRI | CT | USG | X-Ray | OTHER
    promptContent: text("prompt_content").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false), // seeded preset
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    byModality: index("ai_prompt_tpl_modality_idx").on(t.modality),
    byActive: index("ai_prompt_tpl_active_idx").on(t.isActive),
    // Hard DB guarantee against exact-duplicate names so prompt resolution by
    // name is deterministic. Case-insensitive uniqueness is additionally
    // enforced at the API layer (and via a functional lower(name) index in SQL).
    uniqueName: uniqueIndex("ai_prompt_tpl_name_uq").on(t.name),
  }),
);

export type AiPromptTemplate = typeof aiPromptTemplatesTable.$inferSelect;
export type NewAiPromptTemplate = typeof aiPromptTemplatesTable.$inferInsert;
