/**
 * Generate the factory Quick Select box seed migration from the tile catalogue.
 *
 * WHY THIS IS A GENERATOR AND NOT A HAND-WRITTEN MIGRATION
 *   artifacts/diagnostic-erp/src/lib/zai-workspace/quick-select-tiles.data.ts is
 *   the shipped Quick Select catalogue — 127 boxes of clinical prose. The
 *   reporting workspace now reads its boxes from radiology_quick_findings, so
 *   that prose has to reach the clinic's database. Hand-copying it into SQL
 *   would fork it: the first tile edit would make the two disagree, and the
 *   disagreement would be in clinical wording, which is the one thing this repo
 *   keeps having to repair. So the SQL is derived, and
 *   generateQuickSelectFactoryBoxes.test.ts fails the build when the derived
 *   file no longer matches the catalogue.
 *
 * WHY IT RIDES migrations/ AND NOT api-server STARTUP
 *   docker/db-patch-entrypoint.sh (care-db-patch-v2) is the single official
 *   schema container and auto-discovers migrations/*.sql in alphabetical order.
 *   api-server's startup block is a compatibility net whose own policy forbids
 *   growth ("write a migrations/*.sql file instead"). Seeding belongs here.
 *
 * WHY THE FILENAME CARRIES A REVISION *AND* A DIGEST
 *   A feature migration is applied EXACTLY ONCE. On a hash change the
 *   entrypoint logs "NOT re-applying" and only updates the recorded hash
 *   (docker/db-patch-entrypoint.sh, the `changed` branch). So one mutable seed
 *   file would reach the clinic once and every later catalogue change would be
 *   silently skipped — a box added next year would never appear. Instead each
 *   catalogue state gets its own file:
 *
 *     zzz…_quick_select_factory_boxes_r001_<digest12>.sql
 *
 *   The revision number, not the digest, decides the order. Digests are hashes
 *   and sort arbitrarily, so an older snapshot could otherwise apply AFTER a
 *   newer one and refresh untouched rows back to stale wording. Every file is a
 *   full, idempotent snapshot of the catalogue, so a fresh database converges
 *   to the latest state whichever order the older ones ran in.
 *
 *   Old revision files are never deleted: they are already recorded as applied
 *   in public.schema_migrations_log, and dropping an applied migration is what
 *   makes scripts/audit-migration-ledger.mjs false-fail a restore proof.
 *
 * WHY THE SQL ALSO HAS TO BE IDEMPOTENT
 *   The two appliers do not share a ledger. care-db-patch-v2 consults
 *   public.schema_migrations_log and runs a file once. scripts/apply-all-
 *   migrations.mjs (pnpm db:bootstrap) creates that table, never writes a
 *   feature row to it, and re-applies EVERY feature file on EVERY run — measured:
 *   a fresh database ends with 0 rows in schema_migrations_log after 195/195
 *   applied. So the seed is re-run constantly on dev machines and must converge
 *   rather than accumulate. Verified: applying it twice to a 363-row database
 *   leaves 487 rows and 127 stamped keys both times.
 *
 * USAGE
 *   pnpm --filter @workspace/scripts run generate:quick-select-factory-boxes
 *   (writes the next revision if the catalogue moved; prints "up to date" if not)
 */
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_QUICK_SELECT_TILES } from "../../artifacts/diagnostic-erp/src/lib/zai-workspace/quick-select-tiles.data";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");

/** 21 z's — one more than zzzzzzzzzzzzzzzzzzzz_quick_select_authoring.sql, the
 *  migration that adds the columns this file writes. Alphabetical order is the
 *  only ordering the entrypoint has, so the seed must sort strictly after it. */
const FILE_PREFIX = "zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes";
const FILE_RE = /^zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r(\d{3})_([0-9a-f]{12})\.sql$/;

/** One shipped box, as the ERP catalogue declares it. */
type QuickSelectTile = (typeof DEFAULT_QUICK_SELECT_TILES)[number];

export type FactorySeedRow = {
  factoryKey: string;
  studyType: string;
  label: string;
  field: string;
  sonKind: string;
  mnemonic: string;
  concept: string;
  scopeModality: string;
  category: string;
  anatomicalSection: string;
  conflictGroup: string;
  baselineReplaces: string;
  properties: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  sortOrder: number;
  factoryDefinition: string;
};

/**
 * Stable identity for a shipped box. Deliberately NOT tile.id: the catalogue
 * mints that with Math.random() at module load, so it differs on every run and
 * would make every deploy insert a second copy of all 127 boxes. It is also not
 * the label, because a label the doctor renames must not resurrect the old box.
 */
export function factoryKeyFor(tile: {
  field: string;
  label: string;
  scopeModality?: string;
  scopeBodyPart?: string;
}): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const parts = [tile.field, tile.label, tile.scopeModality ?? "", tile.scopeBodyPart ?? ""]
    .map(slug)
    .filter(Boolean);
  return `qsf.${parts.join(".")}`;
}

/** Which column a tile's main sentence writes into. The box table has no
 *  clinical-history column — `field` names the section, `finding_text` holds the
 *  box's primary prose — so a clinicalHistory box keeps its sentence there and
 *  the client routes it by `field`. */
function primaryTextField(field: string): keyof Pick<
  FactorySeedRow,
  "findingText" | "impressionText" | "techniqueText" | "recommendationText"
> {
  switch (field) {
    case "impression":
      return "impressionText";
    case "recommendation":
      return "recommendationText";
    case "technique":
      return "techniqueText";
    default:
      return "findingText";
  }
}

/**
 * Catalogue → box rows. Throws rather than silently dropping anything: this
 * runs at build time, and a box that cannot be represented must fail the build
 * instead of quietly never reaching the clinic.
 */
export function factorySeedRows(
  tiles: readonly QuickSelectTile[] = DEFAULT_QUICK_SELECT_TILES,
): FactorySeedRow[] {
  const seen = new Map<string, string>();
  return tiles.map((tile, index) => {
    const field = tile.field;
    const label = tile.label.trim();
    if (!label) throw new Error(`tile #${index} has an empty label`);
    if (!field) throw new Error(`tile "${label}" has no field`);

    const key = factoryKeyFor(tile);
    const prior = seen.get(key);
    if (prior) {
      throw new Error(`factory key ${key} is claimed by both "${prior}" and "${label}"`);
    }
    seen.set(key, label);

    const row: FactorySeedRow = {
      factoryKey: key,
      // '' is the sentinel for "every region": 10 of the 127 shipped boxes are
      // cross-region utilities (Standard H&P, Trauma, the five per-modality
      // technique defaults, Normal study, Clinical correlation, Follow-up scan).
      // Every one of the 363 rows already in the clinic's table has a region, so
      // this is a new class of row — the client read path has to include ''-rows
      // for any active region, and it is the only way these ten survive the
      // removal of the localStorage tile strip.
      studyType: (tile.scopeBodyPart ?? "").trim(),
      label,
      field,
      // The shipped catalogue is FLAT. Father → son ownership is the owner's to
      // author: inventing fathers out of conflictGroup (Fazekas 1/2/3) would be
      // a clinical judgement made silently by a build script.
      sonKind: "",
      mnemonic: tile.mnemonic ?? "",
      concept: tile.concept ?? "",
      scopeModality: tile.scopeModality ?? "",
      category: tile.category ?? "",
      anatomicalSection: tile.anatomicalSection ?? "",
      conflictGroup: tile.conflictGroup ?? "",
      baselineReplaces: tile.baselineReplaces ?? "",
      properties: tile.properties ?? "",
      findingText: "",
      impressionText: "",
      techniqueText: "",
      recommendationText: "",
      sortOrder: index * 10,
      factoryDefinition: "",
    };

    row[primaryTextField(field)] = tile.sentence;

    if (tile.impressionSentence) {
      if (primaryTextField(field) === "impressionText") {
        throw new Error(`tile "${label}" is an impression box and also sets impressionSentence`);
      }
      row.impressionText = tile.impressionSentence;
    }
    if (tile.recommendationSentence) {
      if (primaryTextField(field) === "recommendationText") {
        throw new Error(`tile "${label}" is a recommendation box and also sets recommendationSentence`);
      }
      row.recommendationText = tile.recommendationSentence;
    }

    // The exact object POST /findings/:id/restore-defaults reads back: camelCase
    // keys, one per AUTHORED_BOX_COLUMNS entry. sortOrder and isActive are in it
    // for fidelity even though that route skips them — retiring a box or moving
    // it to the front is the clinic's decision, not shipped wording.
    row.factoryDefinition = JSON.stringify({
      label: row.label,
      field: row.field,
      sonKind: row.sonKind,
      parentId: null,
      mnemonic: row.mnemonic,
      concept: row.concept,
      scopeModality: row.scopeModality,
      category: row.category,
      anatomicalSection: row.anatomicalSection,
      conflictGroup: row.conflictGroup,
      baselineReplaces: row.baselineReplaces,
      icdCode: null,
      tags: "",
      suggests: "",
      properties: row.properties,
      questionsJson: "[]",
      findingText: row.findingText,
      impressionText: row.impressionText,
      techniqueText: row.techniqueText,
      recommendationText: row.recommendationText,
      sortOrder: row.sortOrder,
      isActive: true,
    });

    return row;
  });
}

const SEED_COLUMNS = [
  "factory_key",
  "study_type",
  "label",
  "field",
  "son_kind",
  "mnemonic",
  "concept",
  "scope_modality",
  "category",
  "anatomical_section",
  "conflict_group",
  "baseline_replaces",
  "properties",
  "finding_text",
  "impression_text",
  "technique_text",
  "recommendation_text",
  "sort_order",
  "factory_definition",
] as const;

/** Every column the refresh writes, as (table alias, seed alias) pairs. Kept in
 *  one list because the SET and the "did anything actually change" guard must
 *  name exactly the same columns — a column in one and not the other would
 *  either bump updated_at on every deploy for nothing, or silently never
 *  refresh. sortOrder and isActive are absent from both on purpose. */
const REFRESH_COLUMNS: Array<[string, keyof FactorySeedRow]> = [
  ["finding_text", "findingText"],
  ["impression_text", "impressionText"],
  ["technique_text", "techniqueText"],
  ["recommendation_text", "recommendationText"],
  ["field", "field"],
  ["son_kind", "sonKind"],
  ["mnemonic", "mnemonic"],
  ["concept", "concept"],
  ["scope_modality", "scopeModality"],
  ["category", "category"],
  ["anatomical_section", "anatomicalSection"],
  ["conflict_group", "conflictGroup"],
  ["baseline_replaces", "baselineReplaces"],
  ["properties", "properties"],
  ["factory_definition", "factoryDefinition"],
];

/** The four prose columns, i.e. what "the clinic edited this box" means. */
const WORDING_COLUMNS: Array<[string, keyof FactorySeedRow]> = [
  ["finding_text", "findingText"],
  ["impression_text", "impressionText"],
  ["technique_text", "techniqueText"],
  ["recommendation_text", "recommendationText"],
];

function sqlText(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function sqlInt(v: number): string {
  return String(v);
}

function valuesTuple(row: FactorySeedRow): string {
  return `    (${SEED_COLUMNS.map((col) => {
    if (col === "sort_order") return sqlInt(row.sortOrder);
    const key = col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()) as keyof FactorySeedRow;
    return sqlText(String(row[key] ?? ""));
  }).join(", ")})`;
}

function rowComparison(alias: "q" | "s", cols: Array<[string, keyof FactorySeedRow]>): string {
  return cols.map(([col]) => `${alias}.${col}`).join(", ");
}

function seedComparison(cols: Array<[string, keyof FactorySeedRow]>): string {
  return cols.map(([col]) => `s.${col}`).join(", ");
}

/**
 * The digest that names the file. Over the rendered rows rather than the source
 * file, so a comment edit or a reorder of the type declarations does not mint a
 * new revision — only a change to what actually reaches the database does.
 */
export function catalogueDigest(rows: readonly FactorySeedRow[]): string {
  const canonical = rows.map((r) =>
    SEED_COLUMNS.map((col) => {
      if (col === "sort_order") return r.sortOrder;
      const key = col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()) as keyof FactorySeedRow;
      return String(r[key] ?? "");
    }),
  );
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}

export function factorySeedMigrationName(revision: number, digest: string): string {
  return `${FILE_PREFIX}_r${String(revision).padStart(3, "0")}_${digest}.sql`;
}

export function renderFactorySeedSql(rows: readonly FactorySeedRow[], revision: number, digest: string): string {
  return `-- =============================================================================
-- ${factorySeedMigrationName(revision, digest)}
-- GENERATED FILE — DO NOT EDIT BY HAND.
-- =============================================================================
-- Generated by scripts/src/generate-quick-select-factory-boxes.ts from
-- artifacts/diagnostic-erp/src/lib/zai-workspace/quick-select-tiles.data.ts.
-- Regenerate instead of editing; generateQuickSelectFactoryBoxes.test.ts fails
-- the build when this file no longer matches the catalogue.
--
-- WHAT THIS DOES
--   Puts the ${rows.length} shipped Quick Select boxes into radiology_quick_findings,
--   stamped with factory_key + factory_definition so the workspace can badge
--   them "Built-in" and offer a real "Restore defaults".
--
-- THE FOUR RULES IT OBEYS, IN ORDER
--   1. ADOPT, never duplicate. The clinic already has rows for some of these
--      boxes — (study_type, label) is a unique index, and a handful of shipped
--      boxes match rows a previous seed or a doctor already wrote. Those rows
--      are stamped with the factory identity rather than re-inserted.
--   2. THE RESTORE TARGET IS THE CURRENT SHIPPED WORDING. A clinic-customized
--      row keeps the clinic's wording, but its factory_definition snapshot
--      (what "Restore defaults" writes) is re-synced to the newest revision.
--      Without this rule, a doctor who customized a box before a catalogue
--      update would press "Restore defaults" and get the STALE shipped wording
--      back — the one-press adoption path this feature exists for would deliver
--      yesterday's correction instead of today's.
--   3. AN EDIT MADE IN THE CLINIC NEVER DIES. Adoption compares the four prose
--      columns: if the clinic's wording differs from the shipped wording it sets
--      customized_at, which is the flag rule 4 refuses to touch. So an adopted
--      box keeps the clinic's sentence and badges as "Your version", instead of
--      being silently reverted on the next deploy.
--   4. REFRESH ONLY UNTOUCHED ROWS. A row already stamped by an earlier revision
--      is rewritten only while customized_at IS NULL.
--
--   sort_order and is_active are never written by rules 1, 2 or 4. Retiring a box
--   or moving it to the front is the clinic's decision, not shipped wording —
--   the same reason POST /findings/:id/restore-defaults skips those two columns.
--
-- WHY THIS IS ONE STATEMENT
--   All four rules are data-modifying CTEs of a single INSERT, so they share
--   one snapshot: none of them can see another's writes. That is what makes the
--   INSERT's guards correct rather than racy — a row adopted by rule 1 already
--   exists in the snapshot the INSERT reads, so the label guard excludes it and
--   the two can never collide on radiology_quick_findings_legacy_study_label_uq.
--   Rules 1, 2 and 4 are pairwise disjoint by construction (factory_key = ''
--   versus customized_at IS NOT NULL versus customized_at IS NULL). One
--   statement also means one transaction: a failure halfway leaves the catalogue
--   unseeded, not half-seeded.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   - No father → son ownership. The shipped catalogue is flat; son_kind is ''
--     and parent_id is NULL throughout. Deriving fathers from conflict_group
--     (Fazekas 1/2/3) would be a clinical judgement made silently by a build
--     script, so the owner authors the tree himself in the workspace.
--   - No triggers, no new tables, no renames, no drops.
--   - No study tabs are invented. A box whose region is not an existing tab gets
--     study_tab_id NULL and keeps its region name in study_type; it links up if
--     the tab is ever created. Three shipped regions are not tabs today.
--   - Nothing is deleted. A shipped box removed from the catalogue stays in the
--     clinic's table — removing a box a doctor may have used in signed reports
--     is not a build script's call.
-- =============================================================================

WITH seed (${SEED_COLUMNS.join(", ")}) AS (
  VALUES
${rows.map(valuesTuple).join(",\n")}
),

-- 1. ADOPT — stamp factory identity onto the clinic's existing row.
adopted AS (
  UPDATE radiology_quick_findings q
  SET factory_key        = s.factory_key,
      factory_definition = s.factory_definition,
      customized_at      = CASE
        WHEN (${rowComparison("q", WORDING_COLUMNS)})
             IS DISTINCT FROM (${seedComparison(WORDING_COLUMNS)})
        THEN NOW() ELSE NULL END,
      updated_at         = NOW()
  FROM seed s
  WHERE q.factory_key = ''
    AND lower(trim(q.study_type)) = lower(trim(s.study_type))
    AND lower(trim(q.label))      = lower(trim(s.label))
  RETURNING q.id
),

-- 2. RESYNC — a clinic-customized row keeps the clinic's wording (rule 3),
--    but its factory_definition is the text "Restore defaults" writes back,
--    so the snapshot must converge to the current revision. The wording
--    columns, sort_order and is_active are never touched here: only the
--    restore target moves, and only when the shipped definition really did.
resynced AS (
  UPDATE radiology_quick_findings q
  SET factory_definition = s.factory_definition,
      updated_at         = NOW()
  FROM seed s
  WHERE q.factory_key = s.factory_key
    AND q.customized_at IS NOT NULL
    AND q.factory_definition IS DISTINCT FROM s.factory_definition
  RETURNING q.id
),

-- 3. REFRESH — rewrite a stamped row the clinic has never edited. The change
--    guard is the same column list as the SET, so a deploy that changes nothing
--    touches nothing and does not churn updated_at.
refreshed AS (
  UPDATE radiology_quick_findings q
  SET ${REFRESH_COLUMNS.map(([col], i) => `${i > 0 ? "      " : ""}${col}${" ".repeat(Math.max(1, 19 - col.length))}= s.${col}`).join(",\n")},
      updated_at         = NOW()
  FROM seed s
  WHERE q.factory_key = s.factory_key
    AND q.customized_at IS NULL
    AND (${rowComparison("q", REFRESH_COLUMNS)})
        IS DISTINCT FROM (${seedComparison(REFRESH_COLUMNS)})
  RETURNING q.id
)

-- 4. INSERT — a shipped box the clinic does not have yet.
INSERT INTO radiology_quick_findings (
  study_type, study_tab_id, label, field, son_kind, parent_id, mnemonic, concept,
  scope_modality, category, anatomical_section, conflict_group, baseline_replaces,
  properties, questions_json, finding_text, impression_text, technique_text,
  recommendation_text, sort_order, is_active, factory_key, factory_definition, customized_at
)
SELECT
  s.study_type,
  -- Same resolution the API uses (lib/resolveStudyTab.ts): match a tab by name,
  -- case- and space-insensitively, and leave the link NULL when there is none.
  (SELECT t.id FROM radiology_study_tabs t
    WHERE lower(trim(t.name)) = lower(trim(s.study_type)) LIMIT 1),
  s.label, s.field, s.son_kind, NULL, s.mnemonic, s.concept,
  s.scope_modality, s.category, s.anatomical_section, s.conflict_group, s.baseline_replaces,
  s.properties, '[]', s.finding_text, s.impression_text, s.technique_text,
  s.recommendation_text, s.sort_order, TRUE, s.factory_key, s.factory_definition, NULL
FROM seed s
WHERE NOT EXISTS (
        SELECT 1 FROM radiology_quick_findings q WHERE q.factory_key = s.factory_key
      )
  -- Belt and braces behind the adopt rule: never collide with an existing row on
  -- the (study_type, label) unique index, even if that row carries a different
  -- factory_key than the one this revision would have given it.
  AND NOT EXISTS (
        SELECT 1 FROM radiology_quick_findings q
         WHERE lower(trim(q.study_type)) = lower(trim(s.study_type))
           AND lower(trim(q.label))      = lower(trim(s.label))
      );
`;
}

export type ExistingSeedFile = { revision: number; digest: string; name: string };

export function existingSeedFiles(dir: string = MIGRATIONS_DIR): ExistingSeedFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, m: FILE_RE.exec(name) }))
    .filter((e): e is { name: string; m: RegExpExecArray } => e.m !== null)
    .map(({ name, m }) => ({ revision: Number(m[1]), digest: m[2], name }))
    .sort((a, b) => a.revision - b.revision);
}

export function nextRevision(existing: readonly ExistingSeedFile[]): number {
  return existing.length === 0 ? 1 : existing[existing.length - 1].revision + 1;
}

/** True when the newest revision already carries the current catalogue. */
export function isUpToDate(existing: readonly ExistingSeedFile[], digest: string): boolean {
  return existing.length > 0 && existing[existing.length - 1].digest === digest;
}

export function expectedSeedFileName(dir: string = MIGRATIONS_DIR): string {
  const rows = factorySeedRows();
  const digest = catalogueDigest(rows);
  const existing = existingSeedFiles(dir);
  if (isUpToDate(existing, digest)) return existing[existing.length - 1].name;
  return factorySeedMigrationName(nextRevision(existing), digest);
}

function main(): void {
  const rows = factorySeedRows();
  const digest = catalogueDigest(rows);
  const existing = existingSeedFiles();

  if (isUpToDate(existing, digest)) {
    console.log(`Factory box seed up to date: ${existing[existing.length - 1].name}`);
    console.log(`  ${rows.length} boxes, digest ${digest}`);
    return;
  }

  const revision = nextRevision(existing);
  const name = factorySeedMigrationName(revision, digest);
  const sql = renderFactorySeedSql(rows, revision, digest);
  writeFileSync(join(MIGRATIONS_DIR, name), sql, "utf8");

  console.log(`Wrote migrations/${name}`);
  console.log(`  ${rows.length} boxes, digest ${digest}, revision ${revision}`);
  if (existing.length > 0) {
    console.log(`  supersedes ${existing[existing.length - 1].name} (kept — already applied at the clinic)`);
  }
  console.log("  Now run: node scripts/check-migration-order.cjs");
}

const isMain = /generate-quick-select-factory-boxes\.(ts|mjs|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export { FILE_PREFIX, FILE_RE, MIGRATIONS_DIR, SEED_COLUMNS };
