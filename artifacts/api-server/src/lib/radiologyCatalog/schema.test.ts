import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import {
  parameterGroupsTable, parameterOptionsTable, findingCategoriesTable, findingDefinitionsTable,
  findingParameterBindingsTable, findingSynonymsTable, findingAliasesTable, findingLocationsTable,
  findingRecommendationsTable, findingSeverityBindingsTable, findingMeasurementBindingsTable,
} from "@workspace/db/schema";

// Locate the migration relative to the repo root (…/artifacts/api-server/src/lib/radiologyCatalog).
const MIGRATION = join(__dirname, "..", "..", "..", "..", "..", "migrations", "add_radiology_catalog.sql");
const sql = readFileSync(MIGRATION, "utf8");

describe("catalog schema — Drizzle table definitions", () => {
  const versioned = [
    ["parameter_groups", parameterGroupsTable],
    ["parameter_options", parameterOptionsTable],
    ["finding_categories", findingCategoriesTable],
    ["finding_definitions", findingDefinitionsTable],
  ] as const;

  it("every table carries id + audit + soft-delete columns", () => {
    const all = [
      parameterGroupsTable, parameterOptionsTable, findingCategoriesTable, findingDefinitionsTable,
      findingParameterBindingsTable, findingSynonymsTable, findingAliasesTable, findingLocationsTable,
      findingRecommendationsTable, findingSeverityBindingsTable, findingMeasurementBindingsTable,
    ];
    for (const t of all) {
      const cols = getTableColumns(t);
      expect(cols.id).toBeDefined();
      expect(cols.deletedAt, "soft-delete column").toBeDefined();
      expect(cols.createdAt).toBeDefined();
      expect(cols.updatedAt).toBeDefined();
    }
  });

  it("versioned tables carry (key, status, version)", () => {
    for (const [, t] of versioned) {
      const cols = getTableColumns(t);
      expect(cols.key).toBeDefined();
      expect(cols.status).toBeDefined();
      expect(cols.version).toBeDefined();
    }
  });

  it("edge tables carry the findingId FK column", () => {
    for (const t of [findingParameterBindingsTable, findingSynonymsTable, findingAliasesTable, findingLocationsTable, findingRecommendationsTable, findingSeverityBindingsTable, findingMeasurementBindingsTable]) {
      expect(getTableColumns(t).findingId).toBeDefined();
    }
  });
});

describe("catalog schema — migration is import-ready & idempotent", () => {
  const tables = [
    "parameter_groups", "parameter_options", "finding_categories", "finding_definitions",
    "finding_parameter_bindings", "finding_synonyms", "finding_aliases", "finding_locations",
    "finding_recommendations", "finding_severity_bindings", "finding_measurement_bindings",
  ];

  it("creates all 11 tables idempotently with bigserial PKs", () => {
    for (const t of tables) {
      expect(sql, t).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
    expect(sql.match(/BIGSERIAL PRIMARY KEY/g)?.length).toBe(11);
  });

  it("declares FK relationships with ON DELETE RESTRICT (never cascade)", () => {
    expect(sql).toContain("REFERENCES parameter_groups (id) ON DELETE RESTRICT");
    expect(sql).toContain("REFERENCES finding_categories (id) ON DELETE RESTRICT");
    expect(sql).toContain("REFERENCES finding_definitions (id) ON DELETE RESTRICT");
    expect(sql).toContain("REFERENCES parameter_options (id) ON DELETE RESTRICT");
    expect(sql).not.toContain("ON DELETE CASCADE");
  });

  it("enforces immutable-key uniqueness among live rows via partial unique indexes", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS parameter_groups_key_uq ON parameter_groups (key) WHERE deleted_at IS NULL");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS finding_definitions_key_uq ON finding_definitions (key) WHERE deleted_at IS NULL");
    // global alias uniqueness among live rows
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS finding_aliases_normalized_uq ON finding_aliases (normalized) WHERE deleted_at IS NULL");
    // no hard DROP/TRUNCATE/DELETE in a foundation migration
    expect(sql).not.toMatch(/\b(DROP TABLE|TRUNCATE|DELETE FROM)\b/);
  });
});
