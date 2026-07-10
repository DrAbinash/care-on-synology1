// ─────────────────────────────────────────────────────────────────────────────
// Radiology Canonical Catalog (Tickets B1 + B2) — FOUNDATION ONLY
//
// The single canonical parameter library + finding graph that every structured
// finding, Quick Select tile, YAML pack and AI rule will eventually reference.
// This is additive and DORMANT: nothing in the running system reads these
// tables yet, and every endpoint that touches them is gated behind the
// `ff_radiology_catalog` feature flag. No legacy table is migrated or modified.
//
// Design rules (from the ticket):
//   • Immutable IDs — every entity has a bigint surrogate PK (never reused) AND
//     an immutable text `key` that external references (YAML packs, AI rules)
//     point at. Keys are unique among *live* (non-soft-deleted) rows via partial
//     unique indexes, so a key frees up only after a soft delete.
//   • Never duplicate parameter values — option values live once in
//     parameter_options and are referenced; findings never inline them.
//   • Everything references shared libraries via real FKs (ON DELETE RESTRICT —
//     we soft-delete, we never hard-cascade clinical reference data).
//   • Version aware — versionable entities carry (status, version).
//
// PK type is bigserial (bigint) on purpose: this catalog is meant to outlive the
// int4 tables and be referenced everywhere for 10+ years (see risk-review C1).
// It is self-contained and does not FK to any legacy int4 table.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable, bigserial, bigint, text, integer, boolean, numeric, timestamp,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Shared column fragments (kept identical across tables for consistency).
const auditTimestamps = {
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // Soft delete only — a non-null value means the row is retired but retained.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

const lifecycle = {
  // draft → active → deprecated (one-directional; enforced in the validation layer)
  status: text("status").notNull().default("draft"),
  // Monotonic; bumped by exactly 1 on each content change (optimistic locking).
  version: integer("version").notNull().default(1),
};

// A bigint FK column helper (mode:number → JS number, safe below 2^53).
const fk = (col: string) => bigint(col, { mode: "number" });

// ── Parameter library ────────────────────────────────────────────────────────

// A reusable parameter (attribute) that structured findings bind to, e.g.
// "echogenicity", "laterality", "size". Option-typed parameters own a set of
// reusable parameter_options.
export const parameterGroupsTable = pgTable(
  "parameter_groups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(), // immutable external identifier, e.g. "echogenicity"
    label: text("label").notNull(),
    description: text("description"),
    // option | numeric | text | boolean
    dataType: text("data_type").notNull().default("option"),
    unit: text("unit"), // for numeric parameters, e.g. "mm"
    allowMultiple: boolean("allow_multiple").notNull().default(false),
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("parameter_groups_key_uq").on(t.key).where(sql`deleted_at IS NULL`),
    statusIdx: index("parameter_groups_status_idx").on(t.status),
  }),
);

// A single reusable value for an option-typed parameter, e.g. "hyperechoic".
export const parameterOptionsTable = pgTable(
  "parameter_options",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    groupId: fk("group_id").notNull().references(() => parameterGroupsTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(), // unique within its group among live rows
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Optional coded-vocabulary anchors (LOINC/SNOMED/RadLex/…) — import-ready,
    // never required (see risk-review C2). Values live here once and are reused.
    codeSystem: text("code_system"),
    codeValue: text("code_value"),
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    groupKeyUq: uniqueIndex("parameter_options_group_key_uq").on(t.groupId, t.key).where(sql`deleted_at IS NULL`),
    groupIdx: index("parameter_options_group_idx").on(t.groupId, t.sortOrder),
  }),
);

// ── Finding catalog ──────────────────────────────────────────────────────────

// Hierarchical finding category, e.g. "Abdomen" → "Liver". parent_id forms a
// forest; the validation layer forbids cycles.
export const findingCategoriesTable = pgTable(
  "finding_categories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    parentId: fk("parent_id").references((): any => findingCategoriesTable.id, { onDelete: "restrict" }),
    modality: text("modality"), // optional: MRI | CT | USG | …
    sortOrder: integer("sort_order").notNull().default(0),
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("finding_categories_key_uq").on(t.key).where(sql`deleted_at IS NULL`),
    parentIdx: index("finding_categories_parent_idx").on(t.parentId),
  }),
);

// The canonical finding, e.g. "Simple hepatic cyst".
export const findingDefinitionsTable = pgTable(
  "finding_definitions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    categoryId: fk("category_id").notNull().references(() => findingCategoriesTable.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    description: text("description"),
    // Canonical narrative fragments. STORED ONLY — report rendering is untouched
    // by this ticket; these are here so the render pipeline can adopt them later.
    narrative: text("narrative"),
    impression: text("impression"),
    codeSystem: text("code_system"),
    codeValue: text("code_value"),
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("finding_definitions_key_uq").on(t.key).where(sql`deleted_at IS NULL`),
    categoryIdx: index("finding_definitions_category_idx").on(t.categoryId),
    labelIdx: index("finding_definitions_label_idx").on(t.label),
  }),
);

// ── Finding graph (edges — every row references shared libraries) ─────────────

// Which parameters apply to a finding, and whether required + a default option.
export const findingParameterBindingsTable = pgTable(
  "finding_parameter_bindings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    parameterGroupId: fk("parameter_group_id").notNull().references(() => parameterGroupsTable.id, { onDelete: "restrict" }),
    required: boolean("required").notNull().default(false),
    defaultOptionId: fk("default_option_id").references(() => parameterOptionsTable.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    findingParamUq: uniqueIndex("finding_parameter_bindings_uq").on(t.findingId, t.parameterGroupId).where(sql`deleted_at IS NULL`),
    findingIdx: index("finding_parameter_bindings_finding_idx").on(t.findingId),
    groupIdx: index("finding_parameter_bindings_group_idx").on(t.parameterGroupId),
  }),
);

// Searchable alternate labels for a finding (free text, per finding).
export const findingSynonymsTable = pgTable(
  "finding_synonyms",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    synonym: text("synonym").notNull(),
    normalized: text("normalized").notNull(), // lower(trim(synonym)) — for search + dedup
    ...auditTimestamps,
  },
  (t) => ({
    findingNormUq: uniqueIndex("finding_synonyms_finding_norm_uq").on(t.findingId, t.normalized).where(sql`deleted_at IS NULL`),
    normIdx: index("finding_synonyms_norm_idx").on(t.normalized),
  }),
);

// Globally-unique alias KEYS that map some external token (e.g. a legacy Quick
// Select label) onto a canonical finding. Global uniqueness among live rows is
// the "no duplicate aliases" guarantee.
export const findingAliasesTable = pgTable(
  "finding_aliases",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    aliasKey: text("alias_key").notNull(),
    normalized: text("normalized").notNull(), // lower(trim(aliasKey))
    source: text("source"), // e.g. "legacy_quick_select", "yaml_pack:abdomen"
    ...auditTimestamps,
  },
  (t) => ({
    aliasUq: uniqueIndex("finding_aliases_normalized_uq").on(t.normalized).where(sql`deleted_at IS NULL`),
    findingIdx: index("finding_aliases_finding_idx").on(t.findingId),
  }),
);

// Anatomical locations applicable to a finding.
export const findingLocationsTable = pgTable(
  "finding_locations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(), // e.g. "right_lobe"
    label: text("label").notNull(),
    laterality: text("laterality"), // left | right | bilateral | midline | null
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    findingKeyUq: uniqueIndex("finding_locations_finding_key_uq").on(t.findingId, t.key).where(sql`deleted_at IS NULL`),
    findingIdx: index("finding_locations_finding_idx").on(t.findingId),
  }),
);

// Recommendation text bound to a finding.
export const findingRecommendationsTable = pgTable(
  "finding_recommendations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    recommendationText: text("recommendation_text").notNull(),
    priority: text("priority"), // routine | urgent | critical | null
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    findingIdx: index("finding_recommendations_finding_idx").on(t.findingId),
  }),
);

// Severity scale entries bound to a finding.
export const findingSeverityBindingsTable = pgTable(
  "finding_severity_bindings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(), // e.g. "mild"
    label: text("label").notNull(),
    rank: integer("rank").notNull().default(0), // ordering of severity
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    findingKeyUq: uniqueIndex("finding_severity_bindings_finding_key_uq").on(t.findingId, t.key).where(sql`deleted_at IS NULL`),
    findingIdx: index("finding_severity_bindings_finding_idx").on(t.findingId),
  }),
);

// Measurement definitions bound to a finding (typed numeric, coded unit).
export const findingMeasurementBindingsTable = pgTable(
  "finding_measurement_bindings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    findingId: fk("finding_id").notNull().references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(), // e.g. "long_axis"
    label: text("label").notNull(),
    unit: text("unit").notNull().default("mm"),
    valueType: text("value_type").notNull().default("numeric"),
    minValue: numeric("min_value"),
    maxValue: numeric("max_value"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    findingKeyUq: uniqueIndex("finding_measurement_bindings_finding_key_uq").on(t.findingId, t.key).where(sql`deleted_at IS NULL`),
    findingIdx: index("finding_measurement_bindings_finding_idx").on(t.findingId),
  }),
);

// ── Inferred types ───────────────────────────────────────────────────────────
export type ParameterGroup = typeof parameterGroupsTable.$inferSelect;
export type InsertParameterGroup = typeof parameterGroupsTable.$inferInsert;
export type ParameterOption = typeof parameterOptionsTable.$inferSelect;
export type InsertParameterOption = typeof parameterOptionsTable.$inferInsert;
export type FindingCategory = typeof findingCategoriesTable.$inferSelect;
export type InsertFindingCategory = typeof findingCategoriesTable.$inferInsert;
export type FindingDefinition = typeof findingDefinitionsTable.$inferSelect;
export type InsertFindingDefinition = typeof findingDefinitionsTable.$inferInsert;
export type FindingParameterBinding = typeof findingParameterBindingsTable.$inferSelect;
export type FindingSynonym = typeof findingSynonymsTable.$inferSelect;
export type FindingAlias = typeof findingAliasesTable.$inferSelect;
export type FindingLocation = typeof findingLocationsTable.$inferSelect;
export type FindingRecommendation = typeof findingRecommendationsTable.$inferSelect;
export type FindingSeverityBinding = typeof findingSeverityBindingsTable.$inferSelect;
export type FindingMeasurementBinding = typeof findingMeasurementBindingsTable.$inferSelect;
