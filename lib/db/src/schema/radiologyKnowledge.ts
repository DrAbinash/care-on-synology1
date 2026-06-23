// ── Radiology Knowledge Platform Schema ──
// Phase 4: Database-backed master templates, personal library, version control,
// knowledge base, sign-off profiles, and analytics.

import {
  pgTable, serial, integer, text, timestamp, boolean, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ── 1. MASTER TEMPLATES ──
// Locked master templates. Only super-admin can edit. Normal users can clone to personal library.
// Groups: DR_SUGANDHA_MASTER, DR_ABINASH_MASTER, CARE_DIAGNOSTICS_MASTER, HOPE_HOSPITAL_MASTER
export const radiologyMasterTemplatesTable = pgTable(
  "radiology_master_templates",
  {
    id: serial("id").primaryKey(),
    groupName: text("group_name").notNull(), // DR_SUGANDHA_MASTER, DR_ABINASH_MASTER, etc.
    templateName: text("template_name").notNull(),
    modality: text("modality").notNull(), // MR, US, CT, XR, etc.
    studyType: text("study_type"), // e.g. "MRI Brain", "USG Abdomen"
    bodyPart: text("body_part"),
    findings: text("findings").notNull(),
    impression: text("impression").notNull(),
    recommendations: text("recommendations"),
    tags: jsonb("tags").$type<string[]>().default([]),
    version: integer("version").notNull().default(1),
    isLocked: boolean("is_locked").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    modifiedBy: text("modified_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    groupUq: uniqueIndex("radiology_master_group_name_uq").on(t.groupName, t.templateName),
    byGroup: index("radiology_master_group_idx").on(t.groupName),
    byModality: index("radiology_master_modality_idx").on(t.modality),
    byBodyPart: index("radiology_master_bodypart_idx").on(t.bodyPart),
    byStudyType: index("radiology_master_studytype_idx").on(t.studyType),
    byActive: index("radiology_master_active_idx").on(t.isActive),
  })
);

// ── 2. TEMPLATE VERSIONS ──
// Audit log of every master template change. Immutable.
export const radiologyTemplateVersionsTable = pgTable(
  "radiology_template_versions",
  {
    id: serial("id").primaryKey(),
    masterTemplateId: integer("master_template_id").notNull().references(() => radiologyMasterTemplatesTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    findings: text("findings").notNull(),
    impression: text("impression").notNull(),
    recommendations: text("recommendations"),
    tags: jsonb("tags").$type<string[]>().default([]),
    changeNotes: text("change_notes"), // what changed in this version
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    masterVersionUq: uniqueIndex("radiology_template_versions_uq").on(t.masterTemplateId, t.version),
    byMaster: index("radiology_template_versions_master_idx").on(t.masterTemplateId),
  })
);

// ── 3. PERSONAL TEMPLATES ──
// Per-radiologist saved templates (cloned from master or created from scratch)
export const radiologyPersonalTemplatesTable = pgTable(
  "radiology_personal_templates",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    folder: text("folder").notNull().default("General"), // Brain, Spine, Chest, Abdomen, Pelvis, MSK, Obstetric, General
    templateName: text("template_name").notNull(),
    modality: text("modality"),
    studyType: text("study_type"),
    bodyPart: text("body_part"),
    findings: text("findings"),
    impression: text("impression"),
    recommendations: text("recommendations"),
    measurements: jsonb("measurements").$type<string[]>().default([]),
    macros: jsonb("macros").$type<string[]>().default([]),
    tags: jsonb("tags").$type<string[]>().default([]),
    sourceMasterId: integer("source_master_id"), // null if created from scratch
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffFolderUq: uniqueIndex("radiology_personal_staff_folder_uq").on(t.staffId, t.folder, t.templateName),
    byStaff: index("radiology_personal_staff_idx").on(t.staffId),
    byFolder: index("radiology_personal_folder_idx").on(t.folder),
    byModality: index("radiology_personal_modality_idx").on(t.modality),
    byBodyPart: index("radiology_personal_bodypart_idx").on(t.bodyPart),
  })
);

// ── 4. TEMPLATE PACKS ──
// Reusable multi-template packs (e.g., "MRI Brain Pack", "Trauma Pack")
export const radiologyTemplatePacksTable = pgTable(
  "radiology_template_packs",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    packName: text("pack_name").notNull(),
    description: text("description"),
    modality: text("modality"),
    // Array of template IDs (personal or master) and their order
    templateIds: jsonb("template_ids").$type<number[]>().default([]),
    templateSources: jsonb("template_sources").$type<string[]>().default([]), // "master" or "personal"
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffPackUq: uniqueIndex("radiology_template_packs_staff_uq").on(t.staffId, t.packName),
    byStaff: index("radiology_template_packs_staff_idx").on(t.staffId),
  })
);

// ── 5. KNOWLEDGE BASE ──
// Searchable radiology knowledge database
export const radiologyKnowledgeBaseTable = pgTable(
  "radiology_knowledge_base",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(), // Brain, Spine, Chest, Abdomen, Pelvis, MSK, Obstetrics
    title: text("title").notNull(),
    content: text("content").notNull(),
    // Structured data for classification systems
    classificationSystem: text("classification_system"), // Fazekas, PI-RADS, BI-RADS, LI-RADS, TI-RADS, etc.
    classificationGrades: jsonb("classification_grades").$type<string[]>().default([]),
    measurementReferences: jsonb("measurement_references").$type<string[]>().default([]),
    reportingTips: jsonb("reporting_tips").$type<string[]>().default([]),
    tags: jsonb("tags").$type<string[]>().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byCategory: index("radiology_kb_category_idx").on(t.category),
    byClassification: index("radiology_kb_classification_idx").on(t.classificationSystem),
    byActive: index("radiology_kb_active_idx").on(t.isActive),
  })
);

// ── 6. RADIOLOGIST PROFILES ──
// Sign-off profiles with template preferences, defaults
export const radiologistProfilesTable = pgTable(
  "radiologist_profiles",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
    profileName: text("profile_name").notNull().default("Default"),
    // Default template preferences
    defaultMasterGroup: text("default_master_group").default("DR_SUGANDHA_MASTER"),
    defaultModality: text("default_modality"),
    defaultBodyPart: text("default_body_part"),
    // Default template IDs for quick access
    defaultTemplateIds: jsonb("default_template_ids").$type<number[]>().default([]),
    // Personal settings
    autoImpression: boolean("auto_impression").default(false),
    autoPriority: boolean("auto_priority").default(false),
    showKnowledgeBase: boolean("show_knowledge_base").default(true),
    showTemplatePacks: boolean("show_template_packs").default(true),
    // AI readiness (future)
    aiDraftEnabled: boolean("ai_draft_enabled").default(false),
    aiComparisonEnabled: boolean("ai_comparison_enabled").default(false),
    aiVoiceEnabled: boolean("ai_voice_enabled").default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStaff: index("radiologist_profiles_staff_idx").on(t.staffId),
  })
);

// ── 7. TEMPLATE USAGE ANALYTICS ──
// Track usage for smart learning system
export const radiologyTemplateUsageTable = pgTable(
  "radiology_template_usage",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    templateId: integer("template_id").notNull(),
    templateSource: text("template_source").notNull(), // "master" or "personal"
    templateName: text("template_name").notNull(),
    modality: text("modality"),
    bodyPart: text("body_part"),
    action: text("action").notNull(), // "view", "apply", "clone", "favorite", "search"
    studyId: integer("study_id"), // optional reference to actual study
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStaff: index("radiology_template_usage_staff_idx").on(t.staffId),
    byTemplate: index("radiology_template_usage_template_idx").on(t.templateId, t.templateSource),
    byAction: index("radiology_template_usage_action_idx").on(t.action),
    byDate: index("radiology_template_usage_date_idx").on(t.createdAt),
  })
);

// ── 8. TEMPLATE FAVORITES ──
// Per-user favorites (both master and personal templates)
export const radiologyTemplateFavoritesTable = pgTable(
  "radiology_template_favorites",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    templateId: integer("template_id").notNull(),
    templateSource: text("template_source").notNull(), // "master" or "personal"
    folder: text("folder").default("Favorites"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffTemplateUq: uniqueIndex("radiology_template_favorites_uq").on(t.staffId, t.templateId, t.templateSource),
    byStaff: index("radiology_template_favorites_staff_idx").on(t.staffId),
  })
);

// ── 9. TEMPLATE COMPARISON SNAPSHOTS ──
// Store comparison snapshots for template comparison tool
export const radiologyTemplateComparisonTable = pgTable(
  "radiology_template_comparison",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    personalTemplateId: integer("personal_template_id").notNull().references(() => radiologyPersonalTemplatesTable.id, { onDelete: "cascade" }),
    masterTemplateId: integer("master_template_id").notNull().references(() => radiologyMasterTemplatesTable.id, { onDelete: "cascade" }),
    personalSnapshot: text("personal_snapshot").notNull(),
    masterSnapshot: text("master_snapshot").notNull(),
    differences: jsonb("differences").$type<{ field: string; personal: string; master: string }[]>().default([]),
    comparedAt: timestamp("compared_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStaff: index("radiology_template_comparison_staff_idx").on(t.staffId),
  })
);

// Import usersTable for foreign key references
import { usersTable } from "./users";
