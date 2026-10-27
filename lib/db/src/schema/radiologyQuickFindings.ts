import { sql } from "drizzle-orm";
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
    // Phase 4 engine: auto-filled Technique + one-click baseline normals
    techniqueText: text("technique_text").notNull().default(""),
    normalText: text("normal_text").notNull().default(""),
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
    // Denormalized display / legacy name. Authoritative link: study_tab_id.
    studyType: text("study_type").notNull(),
    studyTabId: integer("study_tab_id"),              // FK-soft → radiology_study_tabs.id
    label: text("label").notNull(),
    findingText: text("finding_text").notNull().default(""),
    impressionText: text("impression_text").notNull().default(""),
    // Phase 2 smart-report fields (add_radiology_smart_reporting.sql)
    techniqueText: text("technique_text").notNull().default(""),
    recommendationText: text("recommendation_text").notNull().default(""),
    icdCode: text("icd_code"),
    tags: text("tags").notNull().default(""),           // comma-separated
    suggests: text("suggests").notNull().default(""),   // comma-separated labels
    // Phase 4 engine: which property chips this button shows when selected
    // (comma list of: side, severity, chronicity, level, measurement)
    properties: text("properties").notNull().default(""),
    category: text("category"),
    // ── Phase 6: Smart Findings engine ─────────────────────────────────────
    // The structured-report section this finding belongs to. When it matches a
    // loaded template section label (findingsItems[].label), selecting the
    // finding flips that section from its baseline normal to this finding's
    // text (intelligent replace + anatomical order + conflict resolution), in
    // structured mode. Empty → the finding appends to free-text findings as
    // before.
    anatomicalSection: text("anatomical_section").notNull().default(""),
    // Findings sharing a non-empty conflictGroup within a study are mutually
    // exclusive — selecting one deselects the others (e.g. Fazekas 1 vs 2).
    conflictGroup: text("conflict_group").notNull().default(""),
    // Optional exact baseline normal sentence this finding supersedes (used in
    // free-text mode / fine-grained replacement). In structured mode the whole
    // mapped section's normal is replaced.
    baselineReplaces: text("baseline_replaces").notNull().default(""),
    // Structured Finding Assistant: JSON array of question definitions
    // ({key, label, type, options, default, required, sortOrder}). When
    // non-empty, clicking the finding opens a compact dialog to collect these
    // values, then generates the finding/impression text from the {key} /
    // [optional clause] templates in finding_text/impression_text. Empty → the
    // finding inserts immediately (fewest clicks).
    questionsJson: text("questions_json").notNull().default("[]"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // ── Self-service authoring (Quick Select strip owns every box) ──────────
    // Father → son ownership. A father is a real clinical box in its own right
    // (it writes Findings / Impression / Recommendation); parent_id NULL means
    // the row is top-level. Exactly two levels exist: a row whose parent_id is
    // set may not itself be a parent. That rule needs a join, so it lives in the
    // write API rather than in a CHECK constraint — a trigger would break the
    // repo's table-census scripts.
    parentId: integer("parent_id"),                    // FK-soft → radiology_quick_findings.id
    // What a son does when its father is clicked:
    //   ''        the row is a father or a standalone box
    //   'grade'   one-of-a-set; picking a grade RETIRES the father's own
    //             wording in the sections the son fills
    //   'include' pre-ticked; ADDS its own wording alongside the father's
    //   'list'    navigation only, writes nothing
    sonKind: text("son_kind").notNull().default(""),
    // The report section this box primarily writes, and therefore the strip tab
    // its tree lives under: findings | impression | recommendation | technique
    // | clinicalHistory.
    field: text("field").notNull().default("findings"),
    mnemonic: text("mnemonic").notNull().default(""),
    // Clinical concept id from CLINICAL_CONTENT_PACKS. Decides whether the box
    // may conclude (isImpressionworthyAbnormal) and which scaffold normals it
    // supersedes. Empty → the box is prose only and the editor refuses to let
    // an abnormal box fill the Impression without one.
    concept: text("concept").notNull().default(""),
    scopeModality: text("scope_modality").notNull().default(""),
    // Stable identity of the factory definition this row came from — NOT the
    // label, because a label the doctor renames must not resurrect the old box
    // on the next deploy. Empty for a row the clinic authored itself.
    factoryKey: text("factory_key").notNull().default(""),
    // JSON snapshot of that factory definition's wording. Non-empty is what
    // makes "Restore defaults" a real action instead of a dead button; the
    // badge shown in the UI is derived from these three columns and nothing
    // else: '' → your box, snapshot+untouched → built-in, snapshot+customized
    // → your version.
    factoryDefinition: text("factory_definition").notNull().default(""),
    // Set the moment the clinic's wording diverges from factoryDefinition. A
    // deploy refresh overwrites only rows where this is NULL, so an edit made
    // in the clinic can never be undone by shipping new factory content.
    customizedAt: timestamp("customized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyTabLabelUq: uniqueIndex("radiology_quick_findings_study_tab_label_uq").on(t.studyTabId, t.label),
    legacyStudyLabelUq: uniqueIndex("radiology_quick_findings_legacy_study_label_uq").on(t.studyType, t.label),
    byStudy: index("radiology_quick_findings_study_idx").on(t.studyType, t.isActive, t.sortOrder),
    byStudyTab: index("radiology_quick_findings_study_tab_idx").on(t.studyTabId, t.isActive, t.sortOrder),
    factoryKeyUq: uniqueIndex("radiology_quick_findings_factory_key_uq")
      .on(t.factoryKey)
      .where(sql`${t.factoryKey} <> ''`),
    byParent: index("radiology_quick_findings_parent_idx").on(t.parentId, t.isActive, t.sortOrder),
  }),
);

export type RadiologyStudyTab = typeof radiologyStudyTabsTable.$inferSelect;
export type RadiologyQuickFinding = typeof radiologyQuickFindingsTable.$inferSelect;

// Per-radiologist click counts, the second key of the strip's ordering
// (starred first, then most used). Distinct from radiology_quick_favorites,
// which is the manual star, and from radiology_learned_patterns, which records
// what free text followed a button rather than how often it was pressed.
export const radiologyQuickFindingUsageTable = pgTable(
  "radiology_quick_finding_usage",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    findingId: integer("finding_id")
      .notNull()
      .references(() => radiologyQuickFindingsTable.id, { onDelete: "cascade" }),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userFindingUq: uniqueIndex("radiology_quick_finding_usage_user_finding_uq").on(t.userId, t.findingId),
    byFinding: index("radiology_quick_finding_usage_finding_idx").on(t.findingId),
  }),
);

export type RadiologyQuickFindingUsage = typeof radiologyQuickFindingUsageTable.$inferSelect;

// Audit of every authoring act. Deliberately NOT a foreign key to the finding:
// a box can be deleted and the record of who wrote what must outlive it, which
// is why the label at the time of the change is snapshotted onto the row.
export const radiologyQuickFindingHistoryTable = pgTable(
  "radiology_quick_finding_history",
  {
    id: serial("id").primaryKey(),
    findingId: integer("finding_id").notNull(),
    factoryKey: text("factory_key").notNull().default(""),
    label: text("label").notNull().default(""),
    studyType: text("study_type").notNull().default(""),
    userId: integer("user_id"),
    userName: text("user_name").notNull().default(""),
    // create | edit | disable | enable | re-parent | restore-defaults | delete
    action: text("action").notNull(),
    fieldName: text("field_name").notNull().default(""),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byFinding: index("radiology_quick_finding_history_finding_idx").on(t.findingId, t.changedAt),
    byTime: index("radiology_quick_finding_history_changed_idx").on(t.changedAt),
  }),
);

export type RadiologyQuickFindingHistory = typeof radiologyQuickFindingHistoryTable.$inferSelect;

// ── Measurement library (Phase 2) ─────────────────────────────────────────────
export const radiologyQuickMeasurementsTable = pgTable(
  "radiology_quick_measurements",
  {
    id: serial("id").primaryKey(),
    studyType: text("study_type").notNull(),
    label: text("label").notNull(),
    // {value} placeholder is replaced at insert time
    templateText: text("template_text").notNull(),
    unit: text("unit").notNull().default("mm"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyLabelUq: uniqueIndex("radiology_quick_measurements_study_label_uq").on(t.studyType, t.label),
    byStudy: index("radiology_quick_measurements_study_idx").on(t.studyType, t.isActive, t.sortOrder),
  }),
);

// ── Per-radiologist favorites (Phase 2) ───────────────────────────────────────
export const radiologyQuickFavoritesTable = pgTable(
  "radiology_quick_favorites",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    findingId: integer("finding_id").notNull().references(() => radiologyQuickFindingsTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userFindingUq: uniqueIndex("radiology_quick_favorites_user_finding_uq").on(t.userId, t.findingId),
    byUser: index("radiology_quick_favorites_user_idx").on(t.userId),
  }),
);

export type RadiologyMeasurement = typeof radiologyQuickMeasurementsTable.$inferSelect;
export type RadiologyQuickFavorite = typeof radiologyQuickFavoritesTable.$inferSelect;

// A Protocol is an indication-specific Technique preset within a body region
// (radiology_study_tabs) — e.g. "MRI Brain Trauma" vs "MRI Brain Stroke".
// Authoritative link: study_tab_id → radiology_study_tabs.id.
// study_type remains as a denormalized display/legacy name.
export const radiologyProtocolsTable = pgTable(
  "radiology_protocols",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),                 // "MRI Brain Trauma"
    studyType: text("study_type").notNull(),       // denormalized region name
    studyTabId: integer("study_tab_id"),           // FK-soft → radiology_study_tabs.id
    modality: text("modality").notNull().default(""), // MRI/CT/USG/XR/Mammo/Doppler
    checklistJson: text("checklist_json").notNull().default("[]"),
    techniqueText: text("technique_text").notNull().default(""),
    normalText: text("normal_text").notNull().default(""),
    recommendationText: text("recommendation_text").notNull().default(""),
    requiredMeasurements: text("required_measurements").notNull().default(""), // comma list
    isGoldStandard: boolean("is_gold_standard").notNull().default(false),
    // The single "default" protocol auto-highlighted for its study region.
    // At most one per studyType — the write API clears the previous default
    // when a new one is set. Distinct from isGoldStandard (a quality marker
    // that may apply to several protocols in a region).
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    // Uniqueness: (study_tab_id, lower(trim(name))) — see zzzzz_protocol_study_tab_name_uq.sql
    byStudy: index("radiology_protocols_study_idx").on(t.studyType, t.isActive, t.sortOrder),
    byStudyTab: index("radiology_protocols_study_tab_idx").on(t.studyTabId, t.isActive, t.sortOrder),
  }),
);

// ── Learning Engine (Phase 5) — per-radiologist, suggestion-only ─────────────
// Tracks how often a radiologist follows a given quick-finding button with a
// particular piece of free text, so the workspace can (with a suggest-only
// UI, never automatic insertion) offer it after repeated use.
export const radiologyLearnedPatternsTable = pgTable(
  "radiology_learned_patterns",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    triggerLabel: text("trigger_label").notNull(),
    suggestedText: text("suggested_text").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("radiology_learned_patterns_uq").on(t.userId, t.triggerLabel, t.suggestedText),
    byUserTrigger: index("radiology_learned_patterns_user_idx").on(t.userId, t.triggerLabel),
  }),
);

export type RadiologyProtocol = typeof radiologyProtocolsTable.$inferSelect;
export type RadiologyLearnedPattern = typeof radiologyLearnedPatternsTable.$inferSelect;

// Clinical History chips belong to a Study Tab by study_tab_id (authoritative).
// study_type remains as denormalized display / legacy migration text.
export const radiologyClinicalHistoryChipsTable = pgTable(
  "radiology_clinical_history_chips",
  {
    id: serial("id").primaryKey(),
    studyType: text("study_type").notNull(),          // denormalized region name
    studyTabId: integer("study_tab_id"),              // FK-soft → radiology_study_tabs.id
    displayLabel: text("display_label").notNull(),      // "Headache" (chip text)
    insertedText: text("inserted_text").notNull().default(""), // "Headache." (inserted)
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false), // seeded vs admin-added
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    studyLabelUq: uniqueIndex("radiology_clinical_history_chips_study_label_uq").on(t.studyType, t.displayLabel),
    byStudy: index("radiology_clinical_history_chips_study_idx").on(t.studyType, t.isActive, t.sortOrder),
    byStudyTab: index("radiology_clinical_history_chips_study_tab_idx").on(t.studyTabId, t.isActive, t.sortOrder),
  }),
);

export type RadiologyClinicalHistoryChip = typeof radiologyClinicalHistoryChipsTable.$inferSelect;
export type NewRadiologyClinicalHistoryChip = typeof radiologyClinicalHistoryChipsTable.$inferInsert;
