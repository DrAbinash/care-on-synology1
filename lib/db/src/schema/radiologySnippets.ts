import {
  pgTable, serial, integer, text, boolean, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Unified snippet store for radiology reporting.
 * Types: quick_add | smart_format | favorite | macro
 *
 * quick_add   — small reusable finding/impression line (one-click insert)
 * smart_format — full or partial structured report section (mergeable)
 * favorite    — user-saved reusable text block
 * macro       — typed shortcut expansion (e.g. "/brain_normal")
 */
export const radiologySnippetsTable = pgTable(
  "radiology_snippets",
  {
    id: serial("id").primaryKey(),

    // ── Classification ──
    type: text("type").notNull(),
    // quick_add | smart_format | favorite | macro
    label: text("label").notNull(),
    // display label in UI
    shortcut: text("shortcut"),
    // trigger text for macro type, or Alt-key for quick_add
    tags: text("tags").array(),
    // e.g. ["liver", "abnormal", "common"]

    // ── Context matching ──
    modality: text("modality"),
    // US, USG, MR, MRI, CT, CR, DX, etc.
    bodyPart: text("body_part"),
    // abdomen, brain, pelvis, lspine, cspine, etc.
    testKeywords: text("test_keywords"),
    // comma-separated keywords to match study description

    // ── Report content (varies by type) ──
    titleText: text("title_text"),
    // report title/procedure name
    techniqueText: text("technique_text"),
    // technique section
    findingsText: text("findings_text"),
    // findings body
    impressionText: text("impression_text"),
    // impression/conclusion
    adviceText: text("advice_text"),
    // recommendation / follow-up

    // ── Quick add specific ──
    insertTarget: text("insert_target").default("findings"),
    // findings | impression | cursor

    // ── Smart format specific ──
    mergePriority: integer("merge_priority").notNull().default(0),
    // higher = merged first
    abnormalOverride: boolean("abnormal_override").notNull().default(false),
    // if true, this format overrides normal lines for same organ
    isPartialSection: boolean("is_partial_section").notNull().default(false),
    // true = partial section, not full report

    // ── Macro specific ──
    expansionText: text("expansion_text"),
    // full expansion text for macro type

    // ── Ownership & lifecycle ──
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    // center-default snippet
    isGlobal: boolean("is_global").notNull().default(false),
    // visible to all users
    createdById: integer("created_by_id"),
    // staff user id
    createdByName: text("created_by_name"),
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    typeIdx: index("rad_snippets_type_idx").on(t.type),
    modalityIdx: index("rad_snippets_new_modality_idx").on(t.modality),
    bodyPartIdx: index("rad_snippets_new_body_part_idx").on(t.bodyPart),
    activeIdx: index("rad_snippets_new_active_idx").on(t.isActive),
    creatorIdx: index("rad_snippets_new_creator_idx").on(t.createdById),
    sortIdx: index("rad_snippets_new_sort_idx").on(t.sortOrder),
  }),
);

export type RadiologySnippet = typeof radiologySnippetsTable.$inferSelect;

export const insertRadiologySnippetSchema = createInsertSchema(radiologySnippetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRadiologySnippet = z.infer<typeof insertRadiologySnippetSchema>;
