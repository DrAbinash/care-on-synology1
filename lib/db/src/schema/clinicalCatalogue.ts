// ─────────────────────────────────────────────────────────────────────────────
// CARE CLINICAL REPORTING ENGINE v4.0 — Stage B: the unified clinical catalogue.
//
// Declares the fourteen tables created by
// `migrations/zzzz_add_clinical_catalogue_v4.sql`, which extend the B1/B2 canonical
// catalog (radiologyCatalog.ts) with the entities it does not model: an examination,
// an anatomical section with an explicit ordinal, a normal-observation slot, an
// authoring tile, a published tile version, a declarative parameter contract,
// selection relationships, combination rules, recommendation rules, a publication and
// the publication's tile-version manifest.
//
// DORMANT BY DESIGN: no runtime code reads these tables yet. The read path arrives
// in Stage C behind a feature flag, so this PR cannot change any report, bill or
// signed record.
//
// Conventions are imported from radiologyCatalog.ts rather than re-typed: bigserial
// PKs, an immutable text `key` unique among live rows, `deleted_at` soft delete, and
// (status, version) lifecycle.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DECLARE, and why that is not a gap:
//   • CHECK constraints — drizzle cannot express them, and declaring a drizzle copy
//     would name a constraint the migration does not create.
//   • The composite foreign keys that make a section reference mean "a section of THIS
//     examination". drizzle's `.references()` takes a single column, so the columns
//     below that participate in one (`parentSectionId`, `sectionId`, `defaultOptionId`)
//     are declared as plain foreign-key columns and the pair is enforced in SQL only.
//     This is the same asymmetry the B1/B2 file already accepts for CHECKs, and the
//     reason the database is built from migrations/*.sql and never from `db:push`: a
//     push of this file would create a WEAKER schema than the one the clinic runs, and
//     a cross-examination section reference would then be accepted in production.
//     clinicalCatalogue.schema.test.ts pins each composite key to the SQL text so the
//     two cannot drift apart silently.
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable, bigserial, bigint, text, integer, boolean, numeric, timestamp, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  auditTimestamps, lifecycle, fk,
  findingDefinitionsTable, parameterGroupsTable,
} from "./radiologyCatalog";

const review = {
  // 'uncertain' is the honest state for a clinical relationship nobody has ratified;
  // it must be storable, or the catalogue would record invented certainty.
  reviewState: text("review_state").notNull().default("unreviewed"),
  reviewNote: text("review_note"),
};

// ── 1. Examination ───────────────────────────────────────────────────────────
export const clinicalExaminationsTable = pgTable(
  "clinical_examinations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    modality: text("modality").notNull(),
    bodyPart: text("body_part").notNull(),
    protocolScope: text("protocol_scope").notNull().default("Standard"),
    // FK-soft: structured_report_templates is a production int4 table, and a dormant
    // catalogue must not gain a live dependency on it.
    templateKey: text("template_key"),
    ...review,
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clinical_examinations_key_uq").on(t.key).where(sql`deleted_at IS NULL`),
    // A booked examination must resolve to exactly one catalogue row.
    scopeUq: uniqueIndex("clinical_examinations_scope_uq")
      .on(sql`modality, lower(trim(body_part)), lower(trim(protocol_scope))`)
      .where(sql`deleted_at IS NULL`),
    modalityIdx: index("clinical_examinations_modality_idx").on(t.modality, t.status),
  }),
);

// ── 2. Anatomical section ────────────────────────────────────────────────────
export const clinicalAnatomicalSectionsTable = pgTable(
  "clinical_anatomical_sections",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    examinationId: fk("examination_id").notNull()
      .references(() => clinicalExaminationsTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    // Composite with examination_id in SQL (clinical_section_parent_same_exam_fkey): a
    // section may only nest inside a section of the same examination.
    parentSectionId: fk("parent_section_id"),
    sectionField: text("section_field").notNull().default("findings"),
    // The order is data, never alphabetical and never insertion order (§16). NULL means
    // "not yet placed" — a fact about a draft, not a lie about order — and the
    // publication gate refuses to publish an examination that still has one.
    ordinal: integer("ordinal"),
    emitsHeading: boolean("emits_heading").notNull().default(true),
    ...review,
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clinical_sections_key_uq")
      .on(t.examinationId, t.key).where(sql`deleted_at IS NULL`),
    ordinalUq: uniqueIndex("clinical_sections_ordinal_uq")
      .on(t.examinationId, t.ordinal).where(sql`deleted_at IS NULL AND ordinal IS NOT NULL`),
    parentIdx: index("clinical_sections_parent_idx").on(t.parentSectionId),
  }),
);

// ── 3. Normal observation slot ───────────────────────────────────────────────
export const clinicalNormalSlotsTable = pgTable(
  "clinical_normal_slots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    examinationId: fk("examination_id").notNull()
      .references(() => clinicalExaminationsTable.id, { onDelete: "restrict" }),
    // Placement metadata, not identity: where the sentence prints. Composite with
    // examination_id in SQL (clinical_slot_section_same_exam_fkey).
    sectionId: fk("section_id"),
    conceptId: fk("concept_id").notNull()
      .references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    slotField: text("slot_field").notNull().default("findings"),
    renderedText: text("rendered_text").notNull(),
    level: text("level"),
    laterality: text("laterality"),
    region: text("region"),
    ordinal: integer("ordinal"),
    ...review,
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clinical_normal_slots_key_uq")
      .on(t.examinationId, t.key).where(sql`deleted_at IS NULL`),
    // Slot identity is the runtime's own: lib/baseline-manifest documents the persisted
    // identity as `region | concept | level | laterality` and buildSlotKey in
    // artifacts/diagnostic-erp/src/lib/observationSlot.ts builds exactly that, so the
    // catalogue keys the same four dimensions scoped to the examination and the field.
    // Section is deliberately absent: five legitimate lumbar normals at one level share
    // a section, and one basal-ganglia claim must not be storable twice.
    slotUq: uniqueIndex("clinical_normal_slots_slot_uq")
      .on(sql`examination_id, slot_field, coalesce(lower(trim(region)), '*'), concept_id, coalesce(lower(trim(level)), ''), coalesce(lower(trim(laterality)), '')`)
      .where(sql`deleted_at IS NULL`),
    examIdx: index("clinical_normal_slots_exam_idx").on(t.examinationId, t.ordinal),
    conceptIdx: index("clinical_normal_slots_concept_idx").on(t.conceptId),
  }),
);

// ── 4. Tile ──────────────────────────────────────────────────────────────────
export const clinicalTilesTable = pgTable(
  "clinical_tiles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    conceptId: fk("concept_id").notNull()
      .references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    tileCategory: text("tile_category").notNull().default("abnormal"),
    findingsText: text("findings_text").notNull().default(""),
    impressionText: text("impression_text").notNull().default(""),
    recommendationText: text("recommendation_text").notNull().default(""),
    techniqueText: text("technique_text").notNull().default(""),
    conflictGroup: text("conflict_group").notNull().default(""),
    ...review,
    provenanceKind: text("provenance_kind").notNull().default("unrecorded"),
    provenanceRef: text("provenance_ref"),
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clinical_tiles_key_uq").on(t.key).where(sql`deleted_at IS NULL`),
    conceptIdx: index("clinical_tiles_concept_idx").on(t.conceptId),
    conflictIdx: index("clinical_tiles_conflict_idx")
      .on(t.conflictGroup)
      .where(sql`conflict_group <> '' AND deleted_at IS NULL`),
  }),
);

// ── 5. Tile × examination placement ──────────────────────────────────────────
export const clinicalTileExaminationsTable = pgTable(
  "clinical_tile_examinations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tileId: fk("tile_id").notNull()
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    examinationId: fk("examination_id").notNull()
      .references(() => clinicalExaminationsTable.id, { onDelete: "restrict" }),
    // Composite with examination_id in SQL (clin_tile_exam_section_same_exam_fkey): the
    // tile of one examination cannot be filed into another examination's anatomy.
    sectionId: fk("section_id"),
    // NULL = "not yet placed". An implicit position (the DEFAULT 0 this column used to
    // carry) made the SECOND tile added to an examination fail, which is the opposite of
    // how authoring works. Reordering is unplace-then-place inside one transaction.
    ordinal: integer("ordinal"),
    isFeatured: boolean("is_featured").notNull().default(false),
    ...auditTimestamps,
  },
  (t) => ({
    tileExamUq: uniqueIndex("clin_tile_exam_uq")
      .on(t.tileId, t.examinationId).where(sql`deleted_at IS NULL`),
    placementUq: uniqueIndex("clin_tile_exam_ordinal_uq")
      .on(sql`examination_id, coalesce(section_id, 0), ordinal`).where(sql`deleted_at IS NULL AND ordinal IS NOT NULL`),
    examIdx: index("clin_tile_exam_exam_idx").on(t.examinationId, t.ordinal),
    tileIdx: index("clin_tile_exam_tile_idx").on(t.tileId),
  }),
);

// ── 6. Tile version snapshot (append-only) ───────────────────────────────────
export const clinicalTileVersionsTable = pgTable(
  "clinical_tile_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tileId: fk("tile_id").notNull()
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    snapshotJson: jsonb("snapshot_json").notNull(),
    changeNote: text("change_note"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionUq: uniqueIndex("clin_tile_versions_uq").on(t.tileId, t.version),
    tileIdx: index("clin_tile_versions_tile_idx").on(t.tileId, t.publishedAt),
  }),
);

// ── 7. Declarative parameter contract ────────────────────────────────────────
export const clinicalTileParametersTable = pgTable(
  "clinical_tile_parameters",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tileId: fk("tile_id").notNull()
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    parameterGroupId: fk("parameter_group_id")
      .references(() => parameterGroupsTable.id, { onDelete: "restrict" }),
    // Composite with parameter_group_id in SQL (clin_tile_param_option_in_group_fkey →
    // parameter_options (group_id, id)): an answer taken from a different parameter's
    // option list is not a default, it is a different parameter's value.
    defaultOptionId: fk("default_option_id"),
    dataType: text("data_type").notNull().default("option"),
    isRequired: boolean("is_required").notNull().default(true),
    allowMultiple: boolean("allow_multiple").notNull().default(false),
    unit: text("unit"),
    minValue: numeric("min_value"),
    maxValue: numeric("max_value"),
    ordinal: integer("ordinal").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clin_tile_params_key_uq")
      .on(sql`tile_id, lower(trim(key))`).where(sql`deleted_at IS NULL`),
    tileIdx: index("clin_tile_params_tile_idx").on(t.tileId, t.ordinal),
  }),
);

// ── 8. Tile → normal slot replacement ────────────────────────────────────────
export const clinicalTileNormalReplacementsTable = pgTable(
  "clinical_tile_normal_replacements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tileId: fk("tile_id").notNull()
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    normalSlotId: fk("normal_slot_id").notNull()
      .references(() => clinicalNormalSlotsTable.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    replacesUq: uniqueIndex("clin_tile_replaces_uq")
      .on(t.tileId, t.normalSlotId).where(sql`deleted_at IS NULL`),
    slotIdx: index("clin_tile_replaces_slot_idx").on(t.normalSlotId),
  }),
);

// ── 9. Selection relationships ───────────────────────────────────────────────
export const clinicalTileRelationshipsTable = pgTable(
  "clinical_tile_relationships",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tileId: fk("tile_id").notNull()
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    relatedTileId: fk("related_tile_id")
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    relatedConceptId: fk("related_concept_id")
      .references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    relationKind: text("relation_kind").notNull(),
    conditionJson: jsonb("condition_json"),
    ordinal: integer("ordinal").notNull().default(0),
    ...review,
    ...auditTimestamps,
  },
  (t) => ({
    relUq: uniqueIndex("clin_tile_rel_uq")
      .on(sql`tile_id, relation_kind, coalesce(related_tile_id, 0), coalesce(related_concept_id, 0)`)
      .where(sql`deleted_at IS NULL`),
    kindIdx: index("clin_tile_rel_kind_idx").on(t.relationKind),
  }),
);

// ── 10. Deterministic combination rules ──────────────────────────────────────
export const clinicalCombinationRulesTable = pgTable(
  "clinical_combination_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    examinationId: fk("examination_id").notNull()
      .references(() => clinicalExaminationsTable.id, { onDelete: "restrict" }),
    // Composite with examination_id in SQL (clin_combo_rule_section_same_exam_fkey).
    sectionId: fk("section_id"),
    label: text("label").notNull(),
    targetField: text("target_field").notNull().default("impression"),
    combinedText: text("combined_text").notNull(),
    // NO DEFAULT, on purpose. FALSE here means "print the members' own sentences AND
    // this summary", which is the duplicate Impression the owner's Fazekas case forbids;
    // a default would make that the accidental outcome of forgetting a column.
    suppressMembers: boolean("suppress_members").notNull(),
    requiresOnlyMembers: boolean("requires_only_members").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    ...review,
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clin_combo_rules_key_uq")
      .on(t.examinationId, t.key).where(sql`deleted_at IS NULL`),
    examIdx: index("clin_combo_rules_exam_idx").on(t.examinationId, t.targetField, t.ordinal),
  }),
);

export const clinicalCombinationRuleMembersTable = pgTable(
  "clinical_combination_rule_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ruleId: fk("rule_id").notNull()
      .references(() => clinicalCombinationRulesTable.id, { onDelete: "restrict" }),
    tileId: fk("tile_id").references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    conceptId: fk("concept_id")
      .references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    requiredValue: text("required_value"),
    isOptional: boolean("is_optional").notNull().default(false),
    ordinal: integer("ordinal").notNull().default(0),
    ...auditTimestamps,
  },
  (t) => ({
    memberUq: uniqueIndex("clin_combo_member_uq")
      .on(sql`rule_id, coalesce(tile_id, 0), coalesce(concept_id, 0)`).where(sql`deleted_at IS NULL`),
    ruleIdx: index("clin_combo_member_rule_idx").on(t.ruleId, t.ordinal),
    // What the publication gate looks for when it refuses a rule that requires nothing.
    requiredIdx: index("clin_combo_member_required_idx")
      .on(t.ruleId).where(sql`NOT is_optional AND deleted_at IS NULL`),
  }),
);

// ── 11. Conditional recommendation rules ─────────────────────────────────────
export const clinicalRecommendationRulesTable = pgTable(
  "clinical_recommendation_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    examinationId: fk("examination_id").notNull()
      .references(() => clinicalExaminationsTable.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    tileId: fk("tile_id").references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    conceptId: fk("concept_id")
      .references(() => findingDefinitionsTable.id, { onDelete: "restrict" }),
    parameterKey: text("parameter_key"),
    parameterValue: text("parameter_value"),
    adviceText: text("advice_text").notNull(),
    priority: text("priority"),
    emitPolicy: text("emit_policy").notNull().default("always"),
    ordinal: integer("ordinal").notNull().default(0),
    ...review,
    ...lifecycle,
    ...auditTimestamps,
  },
  (t) => ({
    keyUq: uniqueIndex("clin_rec_rules_key_uq")
      .on(t.examinationId, t.key).where(sql`deleted_at IS NULL`),
    examIdx: index("clin_rec_rules_exam_idx").on(t.examinationId, t.ordinal),
  }),
);

// ── 12. Publication ──────────────────────────────────────────────────────────
export const clinicalPublicationsTable = pgTable(
  "clinical_publications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    examinationId: fk("examination_id")
      .references(() => clinicalExaminationsTable.id, { onDelete: "restrict" }),
    publicationKey: text("publication_key").notNull(),
    contentHash: text("content_hash").notNull(),
    summaryJson: jsonb("summary_json"),
    notes: text("notes"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUq: uniqueIndex("clin_publications_key_uq").on(t.publicationKey),
    examIdx: index("clin_publications_exam_idx").on(t.examinationId, t.publishedAt),
  }),
);

// ── 13. Publication manifest: which tile at which stored version ─────────────
// Without this row a publication is a hash. Rollback would have nothing to restore and
// a signed report could not name the wording it was composed from. Append-only like the
// version it points at: clin_pub_tiles_append_only refuses UPDATE and DELETE.
export const clinicalPublicationTilesTable = pgTable(
  "clinical_publication_tiles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicationId: fk("publication_id").notNull()
      .references(() => clinicalPublicationsTable.id, { onDelete: "restrict" }),
    tileId: fk("tile_id").notNull()
      .references(() => clinicalTilesTable.id, { onDelete: "restrict" }),
    tileVersion: integer("tile_version").notNull(),
    // Composite in SQL (clin_pub_tile_version_fkey → clinical_tile_versions (tile_id,
    // version)): a publication may only name a wording that was actually snapshotted.
    ordinal: integer("ordinal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pubTileUq: uniqueIndex("clin_pub_tile_uq").on(t.publicationId, t.tileId),
    tileIdx: index("clin_pub_tile_tile_idx").on(t.tileId),
    pubIdx: index("clin_pub_tile_pub_idx").on(t.publicationId, t.ordinal),
  }),
);

// ── Inferred types ───────────────────────────────────────────────────────────
export type ClinicalExamination = typeof clinicalExaminationsTable.$inferSelect;
export type ClinicalAnatomicalSection = typeof clinicalAnatomicalSectionsTable.$inferSelect;
export type ClinicalNormalSlot = typeof clinicalNormalSlotsTable.$inferSelect;
export type ClinicalTile = typeof clinicalTilesTable.$inferSelect;
export type InsertClinicalTile = typeof clinicalTilesTable.$inferInsert;
export type ClinicalTileExaminationPlacement = typeof clinicalTileExaminationsTable.$inferSelect;
export type ClinicalTileVersion = typeof clinicalTileVersionsTable.$inferSelect;
export type ClinicalTileParameter = typeof clinicalTileParametersTable.$inferSelect;
export type ClinicalTileNormalReplacement = typeof clinicalTileNormalReplacementsTable.$inferSelect;
export type ClinicalTileRelationship = typeof clinicalTileRelationshipsTable.$inferSelect;
export type ClinicalCombinationRule = typeof clinicalCombinationRulesTable.$inferSelect;
export type ClinicalCombinationRuleMember = typeof clinicalCombinationRuleMembersTable.$inferSelect;
export type ClinicalRecommendationRule = typeof clinicalRecommendationRulesTable.$inferSelect;
export type ClinicalPublication = typeof clinicalPublicationsTable.$inferSelect;
export type ClinicalPublicationTile = typeof clinicalPublicationTilesTable.$inferSelect;
