import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

// ── Radiology Quick Select ────────────────────────────────────────────────────
// Configurable study tabs (Brain, LS Spine, Knee, …) and the quick-finding
// buttons linked to each tab, used by the Radiology Reporting Workspace
// side panel. Modeled after the Billing Desk quick-slot concept but with its
// own tables — the billing module is untouched.
//
// Created by migrations/add_radiology_quick_findings.sql (idempotent,
// CREATE TABLE IF NOT EXISTS + seeded defaults with ON CONFLICT DO NOTHING).

export const radiologyStudyTabsTable = pgTable(
  "radiology_study_tabs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    nameUq: uniqueIndex("radiology_study_tabs_name_uq").on(t.name),
  }),
);

export const radiologyQuickFindingsTable = pgTable(
  "radiology_quick_findings",
  {
    id: serial("id").primaryKey(),
    // References the tab by name (not FK) so tabs can be renamed/re-seeded
    // without cascading deletes wiping a radiologist's configured buttons.
    studyType: text("study_type").notNull(),
    label: text("label").notNull(),
    findingText: text("finding_text").notNull().default(""),
    impressionText: text("impression_text").notNull().default(""),
    category: text("category"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyLabelUq: uniqueIndex("radiology_quick_findings_study_label_uq").on(t.studyType, t.label),
    byStudy: index("radiology_quick_findings_study_idx").on(t.studyType, t.isActive, t.sortOrder),
  }),
);

export type RadiologyStudyTab = typeof radiologyStudyTabsTable.$inferSelect;
export type RadiologyQuickFinding = typeof radiologyQuickFindingsTable.$inferSelect;
