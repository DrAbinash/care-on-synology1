import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { testsTable } from "./tests";
import { packagesTable } from "./packages";

// ============================================================================
// Canonical diagnostic service mapping layer: HOPE test code/name → CARE test
// or package.
//
// HOPE prescribes investigations as FREE TEXT (opd_visits.lab_tests /
// radiology_tests) or, in its diagnostics module, as billing_heads.code. CARE
// bills from diagnostic_tests.code / packages. This table is the deterministic
// bridge. The brief is explicit: "Do not use free-text matching as the sole
// production mechanism" — so an inbound test resolves ONLY through:
//   1. an exact source_code match (mapping_status='active'), or
//   2. a normalized source_name / synonym match (mapping_status='active'), or
//   3. otherwise → itemStatus='unmapped' → admin review queue.
//
// Cardinality:
//   1:1     one HOPE item → one CARE test (care_test_id set)
//   1:pkg   one HOPE item → one CARE package (care_package_id set)
//   1:many  one HOPE panel → several CARE tests (several active rows sharing
//           the same source_code/source_name — the resolver returns all)
// Versioned + effective-dated + retire-able; synonyms live in a child table.
// ============================================================================
export const serviceCatalogueMappingsTable = pgTable("service_catalogue_mappings", {
  id: serial("id").primaryKey(),
  sourceSystem: text("source_system").notNull(), // "HOPE"
  sourceCode: text("source_code"), // HOPE billing_heads.code (may be null when name-only)
  // Normalized (lower, trimmed, punctuation-collapsed) source test name.
  sourceName: text("source_name").notNull().default(""),
  sourceNameNormalized: text("source_name_normalized").notNull().default(""),
  sourceModality: text("source_modality"), // lab | radiology hint from HOPE
  careTestId: integer("care_test_id").references(() => testsTable.id),
  carePackageId: integer("care_package_id").references(() => packagesTable.id),
  careDisplayName: text("care_display_name"),
  department: text("department"),
  modality: text("modality"),
  specimenType: text("specimen_type"),
  // one_to_one | one_to_package | panel_member | unmapped
  mappingType: text("mapping_type").notNull().default("one_to_one"),
  // active | pending_review | retired
  mappingStatus: text("mapping_status").notNull().default("pending_review"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Synonyms / abbreviations for a mapping's source test (e.g. "CBC", "Haemogram",
// "Complete Blood Count"). Normalized at write time; matched during resolution.
export const serviceCatalogueMappingSynonymsTable = pgTable("service_catalogue_mapping_synonyms", {
  id: serial("id").primaryKey(),
  mappingId: integer("mapping_id").notNull().references(() => serviceCatalogueMappingsTable.id),
  synonym: text("synonym").notNull(),
  synonymNormalized: text("synonym_normalized").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceCatalogueMapping = typeof serviceCatalogueMappingsTable.$inferSelect;
export type InsertServiceCatalogueMapping = typeof serviceCatalogueMappingsTable.$inferInsert;
export type ServiceCatalogueMappingSynonym = typeof serviceCatalogueMappingSynonymsTable.$inferSelect;
