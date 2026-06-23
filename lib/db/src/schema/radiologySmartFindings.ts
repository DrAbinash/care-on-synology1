// ── Phase 5: Structured Smart Reporting Engine Schema ──
// Deterministic, rules-based text generation. NO AI.
// All generated text is editable, auditable, and explainable.

import {
  pgTable, serial, integer, text, timestamp, boolean, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── 1. SMART FINDINGS (per worklist entry) ──
// Stores structured finding selections for a specific report.
// Each entry is a JSON snapshot of all builder selections.
export const radiologySmartFindingsTable = pgTable(
  "radiology_smart_findings",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id").notNull(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    studyType: text("study_type").notNull(), // "MRI Brain", "MRI Cervical Spine", "USG Abdomen", etc.
    builderType: text("builder_type").notNull(), // "mri_brain", "mri_cervical_spine", "mri_lumbar_spine", "usg_abdomen"
    selections: jsonb("selections").$type<Record<string, unknown>>().notNull(),
    generatedFindings: text("generated_findings"), // The auto-generated text
    generatedImpression: text("generated_impression"), // The auto-generated impression
    ruleVersion: text("rule_version").notNull().default("v1.0"),
    isEdited: boolean("is_edited").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    worklistUq: uniqueIndex("radiology_smart_findings_worklist_uq").on(t.worklistId, t.builderType),
    byWorklist: index("radiology_smart_findings_worklist_idx").on(t.worklistId),
    byStaff: index("radiology_smart_findings_staff_idx").on(t.staffId),
    byStudyType: index("radiology_smart_findings_studytype_idx").on(t.studyType),
    byActive: index("radiology_smart_findings_active_idx").on(t.isActive),
  })
);

// ── 2. IMPRESSION RULES (admin-editable) ──
// Rule engine definitions. Admins can CRUD these.
// When a rule matches structured findings, it generates the impression text.
export const radiologyImpressionRulesTable = pgTable(
  "radiology_impression_rules",
  {
    id: serial("id").primaryKey(),
    ruleName: text("rule_name").notNull(),
    builderType: text("builder_type").notNull(), // "mri_brain", "mri_cervical_spine", etc.
    // Match conditions: JSON array of { field, operator, value } e.g. [{"field":"whiteMatter","operator":"equals","value":"fazekas3"}]
    conditions: jsonb("conditions").$type<{ field: string; operator: string; value: string | string[] }[]>().notNull(),
    generatedText: text("generated_text").notNull(), // The impression text to generate
    priority: text("priority").default("normal"), // "normal", "urgent", "critical"
    severity: text("severity").default("moderate"), // "mild", "moderate", "severe"
    version: text("version").notNull().default("v1.0"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byBuilder: index("radiology_impression_rules_builder_idx").on(t.builderType),
    byActive: index("radiology_impression_rules_active_idx").on(t.isActive),
  })
);

// ── 3. FAVORITE FINDING SETS (per-user) ──
// Users can save their common finding configurations as named sets.
// One-click reuse for "Common MRI Brain", "Common Lumbar Spine", etc.
export const radiologyFavoriteFindingSetsTable = pgTable(
  "radiology_favorite_finding_sets",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    setName: text("set_name").notNull(),
    builderType: text("builder_type").notNull(),
    selections: jsonb("selections").$type<Record<string, unknown>>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffSetUq: uniqueIndex("radiology_favorite_sets_staff_uq").on(t.staffId, t.setName, t.builderType),
    byStaff: index("radiology_favorite_sets_staff_idx").on(t.staffId),
    byBuilder: index("radiology_favorite_sets_builder_idx").on(t.builderType),
  })
);

// ── 4. SMART USAGE ANALYTICS ──
// Track usage of smart features for productivity dashboard.
export const radiologySmartUsageTable = pgTable(
  "radiology_smart_usage",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    worklistId: integer("worklist_id"),
    featureType: text("feature_type").notNull(), // "smart_findings", "impression_rules", "favorite_set", "generate_impression"
    builderType: text("builder_type"), // "mri_brain", etc.
    action: text("action").notNull(), // "open", "generate", "save", "edit", "apply_favorite"
    durationMs: integer("duration_ms"), // Time spent in builder
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStaff: index("radiology_smart_usage_staff_idx").on(t.staffId),
    byFeature: index("radiology_smart_usage_feature_idx").on(t.featureType),
    byBuilder: index("radiology_smart_usage_builder_idx").on(t.builderType),
    byGeneratedAt: index("radiology_smart_usage_generated_idx").on(t.generatedAt),
  })
);

// ── 5. SMART FINDINGS AUDIT LOG ──
// Medico-legal safety: every generation, edit, deletion is logged.
export const radiologySmartFindingsAuditTable = pgTable(
  "radiology_smart_findings_audit",
  {
    id: serial("id").primaryKey(),
    smartFindingId: integer("smart_finding_id").notNull(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // "generated", "edited", "deleted", "restored"
    previousText: text("previous_text"),
    newText: text("new_text"),
    ruleVersion: text("rule_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySmartFinding: index("radiology_smart_audit_finding_idx").on(t.smartFindingId),
    byStaff: index("radiology_smart_audit_staff_idx").on(t.staffId),
  })
);
