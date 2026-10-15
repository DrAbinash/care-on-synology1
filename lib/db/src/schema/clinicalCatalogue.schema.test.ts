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
  clinicalPublicationsTable, clinicalPublicationTilesTable,
} from "./clinicalCatalogue";
import * as catalogue from "./clinicalCatalogue";
import { MEMBER_FIELD, SNAPSHOT_DOMAINS } from "../cataloguePublicationSnapshot";

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

/**
 * Statement text with no comments and no line breaks.
 *
 * The SQL in this migration is wrapped for readability — the normal-slot identity index
 * alone runs to seven lines — so a multi-line `toContain(...)` expectation pins the
 * wrapping rather than the rule, and re-flowing a paragraph turns a correct schema test
 * red. Assertions that care about what a statement says use this; assertions that care
 * about where it sits in the file use the raw text.
 */
const stmtText = (raw: string) => stripSqlComments(raw).replace(/\s+/g, " ");

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
  ["clinical_publication_tiles", clinicalPublicationTilesTable],
];

/** Tables that are history rather than editable content: append-only, no soft delete. */
const APPEND_ONLY = new Set([
  "clinical_tile_versions", "clinical_publications", "clinical_publication_tiles",
]);

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

/** The migration with its prose removed, so a comment can never satisfy an assertion. */
const SCHEMA_STMTS = stripSqlComments(SCHEMA_SQL);

/**
 * `[full statement, key columns, WHERE predicate]` for one named unique index.
 * Returns null when the index does not exist, which every caller asserts.
 */
function uniqueIdx(indexName: string, table: string): [string, string, string] | null {
  const m = stmtText(SCHEMA_SQL).match(
    new RegExp(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} \\((.+?)\\) WHERE ([^;]+);`,
    ),
  );
  return m ? [m[0], m[1]!, m[2]!] : null;
}

/**
 * The top-level items of one CREATE TABLE body: column definitions and table-level
 * constraints, split on the commas that are not inside a parenthesis.
 *
 * A line-based heuristic cannot tell them apart. `modality TEXT NOT NULL` followed by a
 * wrapped `CHECK (modality IN (…))` is a COLUMN constraint that Postgres names
 * `clinical_examinations_modality_check`, while a bare `CHECK (num_nonnulls(…) = 1)` on
 * its own is a TABLE constraint named `<table>_check`. Reading lines flagged all sixteen
 * enums as unnamed table constraints and reported a defect that was not there.
 */
function createTableItems(sqlText: string, table: string): string[] {
  const body = createTableBody(sqlText, table);
  if (!body) return [];
  const inner = body.slice(1, -1);
  const items: string[] = [];
  let depth = 0;
  let current = "";
  let quote = false;
  for (const ch of inner) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        items.push(current.replace(/\s+/g, " ").trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  items.push(current.replace(/\s+/g, " ").trim());
  return items.filter(Boolean);
}

describe("v4 catalogue — every declared table is created by the migration", () => {
  it("declares exactly the fourteen Stage B tables, no more", () => {
    const declared = Object.values(catalogue).filter((v) => v instanceof PgTable).length;
    expect(declared, "PgTable exports in clinicalCatalogue.ts").toBe(14);
    expect(TABLES).toHaveLength(14);
  });

  it("creates all fourteen tables idempotently, with bigserial PKs", () => {
    for (const [name] of TABLES) {
      expect(SCHEMA_SQL, `${name} CREATE TABLE`).toContain(`CREATE TABLE IF NOT EXISTS ${name} (`);
    }
    // 14 tables, one bigserial primary key each — the count is the guard against a
    // table being added to drizzle and quietly omitted from the SQL.
    expect(SCHEMA_SQL.match(/BIGSERIAL PRIMARY KEY/g)?.length).toBe(14);
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
    const audited = TABLES.filter(([n]) => !APPEND_ONLY.has(n));
    for (const [name, table] of audited) {
      const cols = getTableColumns(table) as Record<string, { name: string }>;
      for (const col of ["created_at", "updated_at", "deleted_at"]) {
        expect(Object.values(cols).map((c) => c.name), `${name}.${col}`).toContain(col);
      }
    }
    // Append-only tables must NOT gain a deleted_at: a history row that can be
    // soft-deleted is not a history row.
    for (const [name, table] of TABLES.filter(([n]) => APPEND_ONLY.has(n))) {
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

  it("orders sections and tile placement by an explicit, sparse, 1-based ordinal", () => {
    // §16: order is metadata, and it must be total over what has been placed. The first
    // revision got two things wrong, both reproduced against a database it built:
    //   • `ordinal INTEGER NOT NULL DEFAULT 0` plus a unique index meant the SECOND tile
    //     added to an examination failed, and swapping two neighbours failed.
    //   • nothing said a position had to be a position.
    // A placement now carries no position until an author gives it one, and completeness
    // is enforced at publication instead of at insert.
    for (const [table, idx] of [
      ["clinical_anatomical_sections", "clinical_sections_ordinal_uq"],
      ["clinical_tile_examinations", "clin_tile_exam_ordinal_uq"],
    ] as const) {
      const stmt = uniqueIdx(idx, table);
      expect(stmt![1]!, `${idx} keys on the ordinal`).toContain("ordinal");
      expect(stmt![2]!.toLowerCase(), `${idx} must ignore unplaced rows`).toContain("ordinal is not null");
      expect(stmt![2]!.toLowerCase(), `${idx} is a live-row rule`).toContain("deleted_at is null");
      const body = createTableBody(SCHEMA_STMTS, table);
      expect(body, `${table}.ordinal must be nullable so a draft can exist unordered`)
        .toMatch(/ordinal\s+INTEGER,/);
      expect(body, `${table}.ordinal must never gain a default again`)
        .not.toMatch(/ordinal\s+INTEGER[^,\n]*DEFAULT/i);
      expect(body, `${table} must refuse a zero or negative position`)
        .toContain("ordinal IS NULL OR ordinal > 0");
    }
    // The publication gate is the completeness half: drafts may be unordered, a
    // publication may not.
    expect(stmtText(SCHEMA_SQL)).toContain("AND p.deleted_at IS NULL AND p.ordinal IS NULL");
  });

  it("keys a normal slot on the identity the reporting runtime already uses", () => {
    const stmt = uniqueIdx("clinical_normal_slots_slot_uq", "clinical_normal_slots");
    const key = stmt![1]!.replace(/\s+/g, "").toLowerCase();
    // region | concept | level | laterality, scoped to the examination and the field.
    expect(key).toContain("coalesce(lower(trim(region)),'*')");
    expect(key).toContain("concept_id");
    expect(key).toContain("coalesce(lower(trim(level)),'')");
    expect(key).toContain("coalesce(lower(trim(laterality)),'')");
    // section_id is placement metadata, not identity: a lumbar spine holds a disc, a
    // facet, a ligamentum flavum, a foramina and a canal normal at one level inside ONE
    // section, and the same basal-ganglia claim must not be storable twice under two
    // different sections. Both were measured against the previous key.
    expect(key, "section must not be part of slot identity").not.toContain("section_id");

    // Cross-package contract, read not remembered: the catalogue may not invent its own
    // slot identity while the engine keys ownership another way, or suppression and
    // restoration stop agreeing with the row the author clicked.
    const slotSrc = readFileSync(
      join(REPO, "artifacts", "diagnostic-erp", "src", "lib", "observationSlot.ts"), "utf8",
    );
    const builder = slotSrc.slice(slotSrc.indexOf("export function buildSlotKey"));
    for (const part of ["region", "concept", "level", "laterality"]) {
      expect(builder, `buildSlotKey still keys ${part}`).toContain(`${part}:`);
    }
  });

  it("binds a tile to a canonical concept with a RESTRICT, never a cascade", () => {
    expect(SCHEMA_SQL).toContain("REFERENCES finding_definitions (id) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).toContain("REFERENCES parameter_groups (id) ON DELETE RESTRICT");
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
    // Both are named, because an unnamed table-level CHECK is Postgres-keyed as
    // `<table>_check` and a second one renames the first out from under the ledger audit.
    expect(rel).toContain("CONSTRAINT clin_tile_rel_single_target_chk");
    expect(members).toContain("CONSTRAINT clin_combo_member_single_target_chk");
  });

  it("makes tile parameters required unless explicitly optional", () => {
    const body = createTableBody(SCHEMA_SQL, "clinical_tile_parameters");
    expect(body).toContain("is_required        BOOLEAN NOT NULL DEFAULT TRUE");
  });

  it("makes a combination rule state whether it replaces its members", () => {
    const body = createTableBody(SCHEMA_STMTS, "clinical_combination_rules");
    // NOT NULL with NO default. The owner's Fazekas case wants ONE consolidated
    // Impression and no duplicate; `DEFAULT FALSE` would print the two member sentences
    // *and* the summary whenever an author or a seed omitted the column, which is the
    // exact defect this table exists to fix. A silent clinical decision is the thing
    // under review here, not the flag itself.
    for (const col of ["suppress_members", "requires_only_members"]) {
      expect(body, `${col} must be required`).toMatch(new RegExp(`${col}\\s+BOOLEAN NOT NULL,`));
      expect(body, `${col} must not carry a default`).not.toMatch(new RegExp(`${col}\\s+BOOLEAN NOT NULL DEFAULT`));
    }
    // A rule whose members are all optional fires against a selection nobody made, so
    // it is refused at publication. That is a fact about a SET of rows, which is why it
    // is a gate rather than a CHECK.
    expect(stmtText(SCHEMA_SQL)).toContain("has no required member");
    expect(stmtText(SCHEMA_SQL)).toContain("WHERE NOT is_optional AND deleted_at IS NULL");
  });

  it("carries a recommendation emit policy so an empty section is a rule, not a hardcoded string", () => {
    expect(SCHEMA_SQL).toContain("CHECK (emit_policy IN ('always','when_no_other','when_only'))");
  });

  it("holds a publication hash shaped like a hash", () => {
    const body = createTableBody(SCHEMA_STMTS, "clinical_publications");
    // Matched on whitespace, because the column block is aligned for reading and re-aligning it
    // is not a model change: an earlier revision of this guard pinned the spaces and went red on
    // a comment.
    expect(stmtText(body)).toContain("content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$')");
    expect(SCHEMA_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS clin_publications_key_uq ON clinical_publications (publication_key)");
  });

  it("makes a publication a restorable state, not a list of versions", () => {
    const body = stmtText(createTableBody(SCHEMA_STMTS, "clinical_publications"));
    // examination_id NOT NULL closes the bypass the first review found: every arm of the gate is
    // a statement about one examination, so a row naming none skipped all of them.
    expect(body).toContain("examination_id BIGINT NOT NULL REFERENCES clinical_examinations (id) ON DELETE RESTRICT");
    expect(body).toContain("catalogue_snapshot JSONB NOT NULL CHECK (catalogue_snapshot <> '{}'::jsonb)");
    expect(body).toContain("snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version >= 1)");
    // The document is the payload; the hash is derived from it. Nothing may be stored in the
    // column that is not an object with the domains the reader knows.
    expect(SCHEMA_STMTS).not.toMatch(/catalogue_snapshot\s+JSONB\s*,/);
  });

  it("refuses a publication that names no examination instead of returning early", () => {
    // A regression guard on a guard: the previous revision carried
    // `IF exam IS NULL THEN RETURN NEW`, and a committed test asserted the bypass was intended.
    const body = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE OR REPLACE FUNCTION clinical_publication_gate()"));
    expect(body).not.toMatch(/IF\s+exam\s+IS\s+NULL\s+THEN\s+RETURN/);
    expect(body).toContain("RAISE EXCEPTION 'clinical catalogue cannot be published");
  });

  it("requires the same ten domains in the gate that the publisher writes", () => {
    // The two halves of the snapshot contract live in different languages: check 14 lists the
    // domains in SQL, cataloguePublicationSnapshot.ts lists them in TypeScript. If they drift, a
    // real publication is refused (or accepted with a partial document), and neither file looks
    // wrong on its own. So the list is read out of the migration and compared to the module.
    const gate = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE OR REPLACE FUNCTION clinical_publication_gate()"));
    const needList = gate.slice(gate.indexOf("FROM (VALUES"), gate.indexOf("AS need(field, shape)"));
    expect(needList.length, "the gate declares its domain list").toBeGreaterThan(0);
    const listed = [...needList.matchAll(/\('([a-zA-Z]+)',\s*'(object|array)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
    const fromModule = SNAPSHOT_DOMAINS.map((d) => `${d.field}:${d.shape}`);
    expect(listed.sort()).toEqual([...fromModule].sort());
    // Combination members are a nested domain in the module and a flattened arm in the gate.
    expect(gate).toContain(MEMBER_FIELD);
  });

  it("orders combination rules by a stated precedence and refuses an implied one", () => {
    const body = stmtText(createTableBody(SCHEMA_STMTS, "clinical_combination_rules"));
    // DEFAULT 0 gave every rule the same position, which is precedence decided by read order.
    expect(body).toContain("ordinal INTEGER,");
    expect(body).toContain("CONSTRAINT clin_combo_rules_ordinal_positive_chk CHECK (ordinal IS NULL OR ordinal > 0)");
    expect(body).not.toContain("ordinal INTEGER NOT NULL DEFAULT 0");
    expect(stmtText(SCHEMA_SQL)).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS clin_combo_rules_field_ordinal_uq ON clinical_combination_rules (examination_id, target_field, ordinal) WHERE deleted_at IS NULL AND ordinal IS NOT NULL AND status <> 'deprecated'",
    );
  });

  it("states the symmetric vocabulary and refuses the half-declared pair", () => {
    const body = stmtText(createTableBody(SCHEMA_STMTS, "clinical_tile_relationships"));
    expect(body).toContain("CHECK (relation_kind IN ('parent_child','requires','excludes','supersedes','combines_with','coexists'))");
    const gate = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE OR REPLACE FUNCTION clinical_publication_gate()"));
    // 'coexists' only means something because the gate refuses an undeclared conflict group;
    // a vocabulary word nothing checks is a word authors will misuse.
    expect(gate).toContain("r.relation_kind IN ('excludes','coexists')");
    expect(gate).toContain("r.relation_kind IN ('excludes','supersedes','coexists')");
    // The cycle walk must not include the symmetric kinds: a pair that excludes each other is a
    // two-node loop by definition and would refuse every legitimate catalogue.
    expect(gate).toContain("r.relation_kind IN ('requires','parent_child','supersedes')");
  });

  it("does not claim a digest the server cannot compute", () => {
    // The hash↔document check lives in TypeScript because pgcrypto is not installed for this
    // repository. If that ever changes, this guard is the place that has to be told — and a
    // migration that silently called digest() would fail to apply on a box without the extension.
    // Comment-stripped: this file's own safety prose mentions digest() and CREATE EXTENSION, and
    // an absence assertion run over raw text matches the words that describe the rule instead of
    // the rule.
    expect(SCHEMA_STMTS).not.toMatch(/\bdigest\s*\(/);
    expect(SCHEMA_STMTS).not.toMatch(/CREATE\s+EXTENSION/i);
  });

  it("records which tile at which stored version a publication released", () => {
    // Without the manifest a publication is a hash: rollback has nothing to restore and a
    // signed report cannot name the wording it was composed from.
    const body = createTableBody(SCHEMA_STMTS, "clinical_publication_tiles");
    expect(body.length, "clinical_publication_tiles is created").toBeGreaterThan(0);
    expect(body).toContain("REFERENCES clinical_publications (id) ON DELETE RESTRICT");
    // The version is a real foreign key onto the version table, not a bare integer, so a
    // publication cannot cite a wording that was never snapshotted.
    expect(body).toContain("CONSTRAINT clin_pub_tile_version_fkey");
    expect(stmtText(SCHEMA_SQL))
      .toContain("FOREIGN KEY (tile_id, tile_version) REFERENCES clinical_tile_versions (tile_id, version) ON DELETE RESTRICT");
    expect(SCHEMA_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS clin_pub_tile_uq ON clinical_publication_tiles (publication_id, tile_id)");
  });
});

describe("v4 catalogue — the relational integrity the first review found missing", () => {
  /**
   * A foreign key on section_id alone only proves the section EXISTS. Every one of these
   * composite keys is what makes "a section of THIS examination" a database fact rather
   * than an application convention — measured on the previous revision, an MRI Brain tile
   * could be filed into an MRI Cervical Spine section, take a parent from another
   * examination, and be combined by a rule pointing at another examination's anatomy.
   */
  it("makes every section and option reference mean the same examination or group", () => {
    const expected = [
      // child table, child columns, parent table, parent columns
      ["clinical_anatomical_sections", "examination_id, parent_section_id", "clinical_anatomical_sections", "examination_id, id"],
      ["clinical_normal_slots", "examination_id, section_id", "clinical_anatomical_sections", "examination_id, id"],
      ["clinical_tile_examinations", "examination_id, section_id", "clinical_anatomical_sections", "examination_id, id"],
      ["clinical_combination_rules", "examination_id, section_id", "clinical_anatomical_sections", "examination_id, id"],
      ["clinical_tile_parameters", "parameter_group_id, default_option_id", "parameter_options", "group_id, id"],
      ["clinical_publication_tiles", "tile_id, tile_version", "clinical_tile_versions", "tile_id, version"],
    ] as const;
    for (const [child, childCols, parent, parentCols] of expected) {
      const stmt = `FOREIGN KEY (${childCols}) REFERENCES ${parent} (${parentCols})`;
      // Asserted INSIDE the child table's own definition. A file-wide `contains` proved the
      // string existed somewhere, so mutant T6 — the placement table's composite key losing
      // its examination half — left the suite green while three identical clauses in other
      // tables kept the phrase present.
      const body = stmtText(createTableBody(SCHEMA_STMTS, child));
      expect(body.length, `${child} body found`).toBeGreaterThan(0);
      expect(body, `${child}: ${stmt}`).toContain(`${stmt} ON DELETE RESTRICT`);
    }
    // MATCH SIMPLE skips a composite key with any NULL column, so a nullable pair with
    // only one half filled is accepted by the foreign key and must be refused by a CHECK.
    expect(stmtText(createTableBody(SCHEMA_STMTS, "clinical_tile_parameters")))
      .toContain("CHECK (default_option_id IS NULL OR parameter_group_id IS NOT NULL)");
  });

  /**
   * The guard that would have caught this PR's own bug: a composite foreign key is
   * refused at deploy time (`there is no unique constraint matching given keys`) unless
   * the referenced column pair is already a key, so the key must be created EARLIER in
   * the file, not merely somewhere in it. `scripts/check-migration-order.cjs` proves a
   * REFERENCES target table exists; it does not prove the column list is keyed.
   */
  it("creates a unique key for every composite foreign key before the key needs it", () => {
    const flat = stmtText(SCHEMA_SQL);
    const keys = [...flat.matchAll(
      /FOREIGN KEY \(([a-z_, ]+)\) REFERENCES ([a-z_]+) \(([a-z_, ]+)\)/g,
    )];
    expect(keys.length, "composite foreign keys are declared").toBeGreaterThanOrEqual(6);
    for (const m of keys) {
      const [, , parent, colsRaw] = m;
      const pattern = colsRaw!.replace(/,\s*/g, ",\\s*");
      const at = m.index ?? 0;
      const keyPositions = [
        new RegExp(`CREATE TABLE IF NOT EXISTS ${parent} \\([\\s\\S]*?CONSTRAINT [a-z0-9_]+ UNIQUE \\(${pattern}\\)`),
        new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS [a-z0-9_]+ ON ${parent} \\(${pattern}\\)`),
      ].map((re) => flat.search(re)).filter((p) => p >= 0);
      const isPrimaryKey = colsRaw === "id"
        && flat.includes(`CREATE TABLE IF NOT EXISTS ${parent} ( id BIGSERIAL PRIMARY KEY`);
      const keyedBefore = keyPositions.length > 0 && Math.min(...keyPositions) < at;
      expect(isPrimaryKey || keyedBefore,
        `${parent} (${colsRaw}) is referenced by a foreign key, but no unique key on that `
        + `column pair is created before it — the deploy fails on "there is no unique `
        + `constraint matching given keys"`).toBe(true);
    }
  });

  it("names every table-level CHECK, so adding one cannot rename another", () => {
    // An unnamed table-level CHECK becomes `<table>_check`, and Postgres numbers further
    // ones `_check1`, `_check2` in writing order. scripts/audit-migration-ledger.mjs then
    // reports a migration that applied cleanly as RECORDED_BUT_ABSENT.
    const unnamed: string[] = [];
    let named = 0;
    for (const [table] of TABLES) {
      for (const item of createTableItems(SCHEMA_STMTS, table)) {
        if (/^CHECK\s*\(/.test(item)) unnamed.push(`${table}: ${item}`);
        else if (/^CONSTRAINT [a-z0-9_]+ (CHECK|UNIQUE|FOREIGN KEY)/.test(item)) named += 1;
      }
    }
    expect(unnamed, "table-level CHECKs written without CONSTRAINT").toEqual([]);
    // Column-level CHECKs are not in this count: Postgres names those after the column,
    // which is stable while a column carries one CHECK, and every enum here is one.
    expect(named, "named table-level constraints").toBeGreaterThanOrEqual(20);
  });

  it("makes the history that a signed report cites impossible to rewrite", () => {
    const flat = stmtText(SCHEMA_SQL);
    for (const table of ["clinical_tile_versions", "clinical_publications", "clinical_publication_tiles"]) {
      expect(flat, `${table} must refuse UPDATE`).toContain(
        `CREATE TRIGGER ${table === "clinical_publication_tiles" ? "clin_pub_tiles_append_only" : table === "clinical_publications" ? "clin_publications_append_only" : "clin_tile_versions_append_only"} BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION clinical_append_only_guard()`,
      );
    }
    expect(flat).toContain("CREATE OR REPLACE FUNCTION clinical_append_only_guard()");
    // A history row that can be soft-deleted is not a history row.
    for (const table of ["clinical_tile_versions", "clinical_publications", "clinical_publication_tiles"]) {
      expect(createTableBody(SCHEMA_STMTS, table), `${table} must not carry deleted_at`)
        .not.toMatch(/deleted_at\s+TIMESTAMPTZ/);
    }
  });

  it("runs the publication gate at statement time, so a rolled back test can see it", () => {
    const flat = stmtText(SCHEMA_SQL);
    expect(flat).toContain(
      "CREATE CONSTRAINT TRIGGER clin_publication_gate AFTER INSERT ON clinical_publications DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION clinical_publication_gate()",
    );
    // INITIALLY DEFERRED is the trap: every database test in this family runs inside a
    // transaction that rolls back, and a deferred check never fires on a rollback — the
    // suite would report the gate as passing while it has never once run.
    expect(flat).not.toContain("INITIALLY DEFERRED");
    // The gate is the only place a set-valued rule can live; four refusals, all named.
    for (const phrase of [
      "is placed in this examination with no ordinal",
      "has no required member",
      "retires a normal of an examination it is not placed in",
      "names a tile that is not placed in this examination",
    ]) {
      expect(flat, `gate refuses: ${phrase}`).toContain(phrase);
    }
  });

  it("replaces its own triggers instead of leaving a stale body behind", () => {
    // CREATE TRIGGER has no IF NOT EXISTS, and an earlier revision of this file is live on
    // someone's database, so each trigger is dropped first by name.
    const flat = stmtText(SCHEMA_SQL);
    for (const name of ["clin_tile_versions_append_only", "clin_publications_append_only", "clin_pub_tiles_append_only", "clin_publication_gate"]) {
      expect(flat, `${name} is dropped before it is created`).toContain(`DROP TRIGGER IF EXISTS ${name}`);
    }
    // …and the drop can only ever reach a table this migration creates. A DROP TRIGGER on
    // a production table would remove a guard this file knows nothing about.
    const targets = [...flat.matchAll(/DROP TRIGGER IF EXISTS [a-z0-9_]+ ON ([a-z_]+)/g)].map((m) => m![1]!);
    expect(targets.length).toBeGreaterThanOrEqual(4);
    const notOurs = targets.filter((t) => !TABLES.some(([name]) => name === t));
    expect(notOurs, `DROP TRIGGER reaches tables this migration does not create`).toEqual([]);
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
    const named = (re: RegExp) => [...SCHEMA_STMTS.matchAll(re)].map((m) => m![1]!);
    const constraintNames = TABLES
      .flatMap(([table]) => createTableItems(SCHEMA_STMTS, table))
      .map((item) => item.match(/^CONSTRAINT ([a-z0-9_]+)/)?.[1])
      .filter((n): n is string => Boolean(n));
    const names = [
      ...named(/(?:TABLE|INDEX) IF NOT EXISTS ([a-z0-9_]+)/g),
      ...constraintNames,
      ...named(/CREATE (?:CONSTRAINT )?TRIGGER ([a-z0-9_]+)/g),
      ...named(/DROP TRIGGER IF EXISTS ([a-z0-9_]+)/g),
      ...named(/CREATE OR REPLACE FUNCTION ([a-z_]+)/g),
      ...TABLES.map(([n]) => n),
    ];
    const tooLong = names.filter((n) => Buffer.byteLength(n, "utf8") > 63);
    // A longer name is silently truncated, and scripts/audit-migration-ledger.mjs then
    // reports a migration that applied cleanly as RECORDED_BUT_ABSENT.
    expect(tooLong).toEqual([]);
    // Constraints, triggers and functions are in scope too: the first revision of this
    // file scanned only tables and indexes, which is exactly the set a reviewer adding a
    // named CHECK would extend.
    expect(names.length).toBeGreaterThan(90);
    expect(constraintNames.filter((n) => n.endsWith("_chk")).length).toBeGreaterThanOrEqual(12);
    expect(constraintNames.filter((n) => n.endsWith("_fkey")).length).toBeGreaterThanOrEqual(6);
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
