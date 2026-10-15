/**
 * Structural contract for the v4 clinical catalogue (Stage B).
 *
 * Two failure classes matter here, and neither is "the DDL has a typo":
 *
 *  1. A column declared in lib/db/src/schema but created by no migration. That is the
 *     defect class `migrationColumnParity.test.ts` exists for: the clinic's database is
 *     built by care-db-patch-v2 applying migrations/*.sql, which never pushes the
 *     Drizzle schema, so a declared-only column turns an ordinary request into a 500.
 *     The parity test proves it against a live database (and skips when there is none);
 *     this file proves the same thing statically, so it fires in CI even on a job that
 *     did not provision Postgres.
 *  2. A constraint that quietly disappears. Every guard in this catalogue is a database
 *     constraint on purpose — the enums, the live-row uniqueness, the RESTRICT that
 *     stops a clinical concept being orphaned under a tile. So each one is asserted as
 *     text here and as behaviour in clinicalCatalogue.db.test.ts.
 *
 * Nothing here opens a database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import {
  clinicalExaminationsTable, clinicalAnatomicalSectionsTable, clinicalNormalSlotsTable,
  clinicalTilesTable, clinicalTileExaminationsTable, clinicalTileVersionsTable,
  clinicalTileParametersTable, clinicalTileNormalReplacementsTable,
  clinicalTileRelationshipsTable, clinicalCombinationRulesTable,
  clinicalCombinationRuleMembersTable, clinicalRecommendationRulesTable,
  clinicalPublicationsTable,
} from "./clinicalCatalogue";
import * as catalogue from "./clinicalCatalogue";

const HERE = __dirname;
// lib/db/src/schema → repo root is four levels, not the five a file under
// artifacts/*/src/lib/… needs; getting this wrong yields an ENOENT at import time.
const REPO = join(HERE, "..", "..", "..", "..");
// Read EOL-normalised: several assertions below compare multi-line SQL fragments against
// a "\n"-joined expectation. The repository stores LF, but a Windows checkout with
// core.autocrlf=true turns them into "\r\n" and the guard then fails on the checker,
// not on the schema.
const readSql = (file: string) => readFileSync(join(REPO, "migrations", file), "utf8").replace(/\r\n/g, "\n");
const SCHEMA_SQL = readSql("zzzz_add_clinical_catalogue_v4.sql");
const SEED_SQL = readSql("zzzzz_seed_clinical_catalogue_v4_examinations.sql");

const TABLES: Array<[string, PgTable]> = [
  ["clinical_examinations", clinicalExaminationsTable],
  ["clinical_anatomical_sections", clinicalAnatomicalSectionsTable],
  ["clinical_normal_slots", clinicalNormalSlotsTable],
  ["clinical_tiles", clinicalTilesTable],
  ["clinical_tile_examinations", clinicalTileExaminationsTable],
  ["clinical_tile_versions", clinicalTileVersionsTable],
  ["clinical_tile_parameters", clinicalTileParametersTable],
  ["clinical_tile_normal_replacements", clinicalTileNormalReplacementsTable],
  ["clinical_tile_relationships", clinicalTileRelationshipsTable],
  ["clinical_combination_rules", clinicalCombinationRulesTable],
  ["clinical_combination_rule_members", clinicalCombinationRuleMembersTable],
  ["clinical_recommendation_rules", clinicalRecommendationRulesTable],
  ["clinical_publications", clinicalPublicationsTable],
];

/**
 * The eighteen examination scopes §21 of the brief asks for, keyed the way the seed
 * keys them. Spelling is taken from the vocabulary the product already ships, so a
 * mismatch here means the catalogue drifted from the product, not the other way round.
 */
const EXPECTED_EXAMINATION_KEYS = [
  "mr.brain", "mr.cervical_spine", "mr.dorsal_spine", "mr.ls_spine",
  "mr.whole_spine_screen", "mr.mrcp",
  "ct.brain", "ct.neck", "ct.chest", "ct.abdomen",
  "us.whole_abdomen", "us.kub", "us.pelvis", "us.ob",
  "us.arterial_doppler", "us.venous_doppler",
  "mg.breast", "xr.chest",
] as const;

/**
 * SQL comments stripped out.
 *
 * This exists because the header of this very migration explains what it does NOT do
 * ("No DROP TABLE, no TRUNCATE, no DELETE"), so a raw regex over the file text matches
 * its own safety documentation and reports destructive DDL that is not there. Any
 * absence-assertion must run on the statement text, never the prose.
 */
function stripSqlComments(sqlText: string): string {
  return sqlText.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The body of one CREATE TABLE, found by counting parentheses.
 * Deliberately not `indexOf(");")`: these blocks contain CHECK (modality IN ('XR',…))
 * and a naive scan stops at the first closing paren of the first enum, returning a
 * truncated body that silently passes every "column X is declared" assertion below.
 */
function createTableBody(sqlText: string, table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = sqlText.indexOf(marker);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start + marker.length - 1; i < sqlText.length; i += 1) {
    const ch = sqlText[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return sqlText.slice(start + marker.length - 1, i + 1);
    }
  }
  return "";
}

describe("v4 catalogue — every declared table is created by the migration", () => {
  it("declares exactly the thirteen Stage B tables, no more", () => {
    const declared = Object.values(catalogue).filter((v) => v instanceof PgTable).length;
    expect(declared, "PgTable exports in clinicalCatalogue.ts").toBe(13);
    expect(TABLES).toHaveLength(13);
  });

  it("creates all thirteen tables idempotently, with bigserial PKs", () => {
    for (const [name] of TABLES) {
      expect(SCHEMA_SQL, `${name} CREATE TABLE`).toContain(`CREATE TABLE IF NOT EXISTS ${name} (`);
    }
    // 13 tables, one bigserial primary key each — the count is the guard against a
    // table being added to drizzle and quietly omitted from the SQL.
    expect(SCHEMA_SQL.match(/BIGSERIAL PRIMARY KEY/g)?.length).toBe(13);
  });

  it("creates every column drizzle declares, in the table that declares it", () => {
    for (const [name, table] of TABLES) {
      expect(getTableConfig(table).name, "drizzle table name must match the SQL").toBe(name);
      const body = createTableBody(SCHEMA_SQL, name);
      expect(body.length, `${name} body found`).toBeGreaterThan(0);
      const missing = Object.values(getTableColumns(table) as Record<string, { name: string }>)
        .map((c) => c.name)
        .filter((col) => !new RegExp(`(^|\\s)${col}\\s`, "m").test(body));
      expect(missing, `${name}: declared by drizzle, created by no migration`).toEqual([]);
    }
  });

  it("gives every mutable table the shared soft-delete + audit convention", () => {
    const audited = TABLES.filter(([n]) => !n.endsWith("_versions") && n !== "clinical_publications");
    for (const [name, table] of audited) {
      const cols = getTableColumns(table) as Record<string, { name: string }>;
      for (const col of ["created_at", "updated_at", "deleted_at"]) {
        expect(Object.values(cols).map((c) => c.name), `${name}.${col}`).toContain(col);
      }
    }
    // Append-only tables must NOT gain a deleted_at: a history row that can be
    // soft-deleted is not a history row.
    for (const [name, table] of TABLES.filter(([n]) => n === "clinical_tile_versions" || n === "clinical_publications")) {
      const names = Object.values(getTableColumns(table) as Record<string, { name: string }>).map((c) => c.name);
      expect(names, `${name} must be append-only`).not.toContain("deleted_at");
    }
  });
});

describe("v4 catalogue — constraints that make the model deterministic", () => {
  it("keys are unique among LIVE rows only, so a retired row frees its key", () => {
    for (const idx of [
      "clinical_examinations_key_uq ON clinical_examinations (key) WHERE deleted_at IS NULL",
      "clinical_tiles_key_uq ON clinical_tiles (key) WHERE deleted_at IS NULL",
      "clinical_normal_slots_key_uq ON clinical_normal_slots (examination_id, key) WHERE deleted_at IS NULL",
      "clin_combo_rules_key_uq ON clinical_combination_rules (examination_id, key) WHERE deleted_at IS NULL",
      "clin_rec_rules_key_uq ON clinical_recommendation_rules (examination_id, key) WHERE deleted_at IS NULL",
    ]) {
      expect(SCHEMA_SQL, idx).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx}`);
    }
  });

  it("orders sections and tile placement by an explicit unique ordinal", () => {
    // §16: order is metadata, and it must be total. A duplicate ordinal would make the
    // composed report depend on which row the database happened to read first.
    expect(SCHEMA_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS clinical_sections_ordinal_uq ON clinical_anatomical_sections (examination_id, ordinal) WHERE deleted_at IS NULL");
    expect(SCHEMA_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS clin_tile_exam_ordinal_uq ON clinical_tile_examinations (examination_id, COALESCE(section_id, 0), ordinal) WHERE deleted_at IS NULL");
  });

  it("allows at most one live normal per anatomical slot", () => {
    expect(SCHEMA_SQL).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS clinical_normal_slots_slot_uq\n"
      + "  ON clinical_normal_slots (examination_id, slot_field, COALESCE(section_id, 0), COALESCE(LOWER(TRIM(level)), ''), COALESCE(LOWER(TRIM(laterality)), ''))\n"
      + "  WHERE deleted_at IS NULL;",
    );
  });

  it("binds a tile to a canonical concept with a RESTRICT, never a cascade", () => {
    expect(SCHEMA_SQL).toContain("REFERENCES finding_definitions (id) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).toContain("REFERENCES parameter_groups (id) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).toContain("REFERENCES parameter_options (id) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).toContain("REFERENCES clinical_tiles (id) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).toContain("REFERENCES clinical_normal_slots (id) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).not.toContain("ON DELETE CASCADE");
    expect(SCHEMA_SQL).not.toContain("ON DELETE SET NULL");
  });

  it("requires exactly one target on a relationship and a combination member", () => {
    // Two targets would let one edge mean two things; none would let a rule match nothing.
    const rel = createTableBody(SCHEMA_SQL, "clinical_tile_relationships");
    expect(rel).toContain("CHECK (num_nonnulls(related_tile_id, related_concept_id) = 1)");
    const members = createTableBody(SCHEMA_SQL, "clinical_combination_rule_members");
    expect(members).toContain("CHECK (num_nonnulls(tile_id, concept_id) = 1)");
  });

  it("makes tile parameters required unless explicitly optional", () => {
    const body = createTableBody(SCHEMA_SQL, "clinical_tile_parameters");
    expect(body).toContain("is_required        BOOLEAN NOT NULL DEFAULT TRUE");
  });

  it("can express that a combination only applies when nothing else is abnormal", () => {
    const body = createTableBody(SCHEMA_SQL, "clinical_combination_rules");
    expect(body).toContain("suppress_members      BOOLEAN NOT NULL DEFAULT FALSE");
    expect(body).toContain("requires_only_members BOOLEAN NOT NULL DEFAULT FALSE");
  });

  it("carries a recommendation emit policy so an empty section is a rule, not a hardcoded string", () => {
    expect(SCHEMA_SQL).toContain("CHECK (emit_policy IN ('always','when_no_other','when_only'))");
  });

  it("holds a publication hash, because cache invalidation needs a durable change marker", () => {
    const body = createTableBody(SCHEMA_SQL, "clinical_publications");
    expect(body).toContain("content_hash    TEXT NOT NULL");
    expect(SCHEMA_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS clin_publications_key_uq ON clinical_publications (publication_key)");
  });
});

describe("v4 catalogue — the enums are real", () => {
  it("accepts exactly the modality values the product declares, and nothing else", () => {
    const body = createTableBody(SCHEMA_SQL, "clinical_examinations");
    const inSql = [...body.matchAll(/modality\s+TEXT\s+NOT NULL\s+CHECK \(modality IN \(([^)]*)\)\)/gi)].map((m) => m![1]!);
    expect(inSql).toHaveLength(1);
    const dbModalities = inSql[0]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort();

    // Cross-package contract: artifacts/diagnostic-erp owns the Modality union. If a
    // modality is added there, the catalogue CHECK must grow with it or examinations
    // of that modality cannot be seeded. Read, do not remember.
    const typesSrc = readFileSync(
      join(REPO, "artifacts", "diagnostic-erp", "src", "lib", "zai-workspace", "types.ts"), "utf8",
    );
    const line = typesSrc.split(/\r?\n/).find((l) => l.startsWith("export type Modality ="));
    expect(line, "the ERP Modality union must still be a single line").toBeTruthy();
    const erpModalities = [...line!.matchAll(/"([A-Z_]+)"/g)].map((m) => m![1]!).sort();

    expect(dbModalities, "DB CHECK vs the ERP Modality union").toEqual(erpModalities);
  });

  it("pins the laterality vocabulary to the four values the slot key understands", () => {
    expect(SCHEMA_SQL).toContain("CHECK (laterality IS NULL OR laterality IN ('left','right','bilateral','midline'))");
    // 'Lt' / 'R' / empty-string laterality must not become a second spelling of right.
    expect(SCHEMA_SQL).not.toContain("'l'");
  });

  it("pins lifecycle and review vocabulary on every table that has them", () => {
    const statusCount = SCHEMA_SQL.match(/CHECK \(status IN \('draft','active','deprecated'\)\)/g)?.length ?? 0;
    expect(statusCount, "tables carrying a lifecycle").toBe(6);
    const reviewCount = SCHEMA_SQL.match(/CHECK \(review_state IN \('unreviewed','approved','uncertain'\)\)/g)?.length ?? 0;
    // examinations, sections, normal slots, tiles, relationships, combination rules,
    // recommendation rules: seven. Tile placement, versions, replacements, members and
    // publications are composition or history, not clinical assertions, so they carry none.
    expect(reviewCount, "tables carrying a review_state").toBe(7);
  });
});

describe("v4 catalogue — forward-only and production-safe", () => {
  it("creates nothing destructive", () => {
    for (const [label, raw] of [["schema", SCHEMA_SQL], ["seed", SEED_SQL]]) {
      const sqlText = stripSqlComments(raw);
      expect(sqlText, label).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
      expect(sqlText, label).not.toMatch(/\bALTER TABLE\b/i);
    }
  });

  it("touches no production table", () => {
    // The catalogue is self-contained plus references to the equally dormant B1/B2
    // catalog. A FK into a production table would make dormant schema a live risk.
    const refs = [...SCHEMA_SQL.matchAll(/REFERENCES\s+([a-z_]+)\s*\(/g)].map((m) => m![1]!);
    const foreign = [...new Set(refs)].filter((t) => !t.startsWith("clinical_"));
    expect(foreign.sort()).toEqual(["finding_definitions", "parameter_groups", "parameter_options"]);
  });

  it("keeps every identifier within Postgres' 63-byte limit", () => {
    const names = [
      ...[...SCHEMA_SQL.matchAll(/(?:TABLE|INDEX) IF NOT EXISTS ([a-z0-9_]+)/g)].map((m) => m![1]!),
      ...TABLES.map(([n]) => n),
    ];
    const tooLong = names.filter((n) => Buffer.byteLength(n, "utf8") > 63);
    // A longer name is silently truncated, and scripts/audit-migration-ledger.mjs then
    // reports a migration that applied cleanly as RECORDED_BUT_ABSENT.
    expect(tooLong).toEqual([]);
    expect(names.length).toBeGreaterThan(50);
  });

  it("seeds the eighteen §21 examinations as drafts, never as published content", () => {
    const sqlText = stripSqlComments(SEED_SQL);
    const keys = [...sqlText.matchAll(/^\s*\(\s*'([a-z0-9_.]+)',/gm)].map((m) => m![1]!);
    // The list is §21's requirement, so a dropped scope fails here rather than quietly
    // leaving an examination with no catalogue rows in Stage H.
    expect(keys.slice().sort()).toEqual([...EXPECTED_EXAMINATION_KEYS].sort());
    expect(sqlText).toContain("ON CONFLICT (key) WHERE deleted_at IS NULL DO NOTHING");
    expect(sqlText).not.toMatch(/DO UPDATE/i);
    // Nothing is published: a read path that appears before Stage G must find drafts.
    expect(sqlText).not.toMatch(/'active'/);
    expect((sqlText.match(/'draft'/g) ?? []).length).toBe(EXPECTED_EXAMINATION_KEYS.length);
    // Every row is attributed to the migration, so its provenance is queryable later.
    const attributed = (sqlText.match(/'migration:zzzzz_seed_clinical_catalogue_v4_examinations'/g) ?? []).length;
    expect(attributed).toBe(EXPECTED_EXAMINATION_KEYS.length);
  });

  it("records clinical uncertainty instead of inventing a scope", () => {
    const sqlText = stripSqlComments(SEED_SQL);
    const uncertain = [...sqlText.matchAll(/^\s*\(\s*'([a-z0-9_.]+)',.*'uncertain',/gm)].map((m) => m![1]!);
    // MRCP-as-a-body-part, US versus USG_OB, and whether "X-ray" is one examination or a
    // family of fourteen billed scopes are unresolved owner decisions. They are stored as
    // 'uncertain' rows so the decision is visible in the data instead of smoothed over.
    expect(uncertain.sort()).toEqual(["mr.mrcp", "us.ob", "xr.chest"]);
    // No seeded scope has been signed off by a radiologist yet.
    expect(sqlText).not.toMatch(/'approved'/);
  });
});

describe("v4 catalogue — dormant", () => {
  it("has no runtime reader yet, so no report can change behaviour", () => {
    // Not a style preference: this is the claim that makes the PR safe to merge without
    // a deploy. Stage G is where a reader appears, and this test must change with it.
    const grepTargets = [
      "artifacts/api-server/src",
      "artifacts/diagnostic-erp/src",
      "lib/baseline-manifest/src",
      "lib/report-quality/src",
    ];
    // Cheap and deliberate: scan the schema barrel's own consumers instead of the whole
    // repo, and fail on the first file that names a v4 table outside these files.
    const names = TABLES.map(([n]) => n);
    const offenders: string[] = [];
    for (const dir of grepTargets) {
      walk(join(REPO, dir), (file) => {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return;
        const text = readFileSync(file, "utf8");
        if (names.some((n) => text.includes(`"${n}"`) || text.includes(`'${n}'`) || text.includes(`${n}Table`))) {
          offenders.push(file.replace(REPO, ""));
        }
      });
    }
    expect(offenders, "these files read the v4 catalogue; it is meant to be dormant").toEqual([]);
  });
});

function walk(dir: string, fn: (file: string) => void): void {
  const entries = require("node:fs").readdirSync(dir, { withFileTypes: true }) as Array<{
    name: string; isDirectory(): boolean;
  }>;
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, fn);
    else if (/\.(ts|tsx)$/.test(e.name)) fn(full);
  }
}
