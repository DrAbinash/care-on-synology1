/**
 * Guard for the generated factory Quick Select box seed.
 *
 * The migration under test is GENERATED from the shipped tile catalogue by
 * scripts/src/generate-quick-select-factory-boxes.ts. Nothing stops a doctor's
 * tile edit from landing without the SQL being regenerated — and because a
 * feature migration is applied exactly once (docker/db-patch-entrypoint.sh:
 * "IMPORTANT: we do NOT re-apply on hash change"), a stale seed file would not
 * merely be wrong, it would be silently skipped at the clinic forever. Test 1
 * is that guard.
 *
 * The remaining tests pin the properties the seed's own header promises, so a
 * regeneration cannot quietly drop one: stable keys, adopt-not-duplicate, the
 * customized_at shield, sort_order/is_active left alone, and every shipped box
 * satisfying the same validation rules a doctor's box must.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_QUICK_SELECT_TILES } from "../../artifacts/diagnostic-erp/src/lib/zai-workspace/quick-select-tiles.data";
import {
  catalogueDigest,
  existingSeedFiles,
  factoryKeyFor,
  factorySeedMigrationName,
  factorySeedRows,
  isUpToDate,
  nextRevision,
  renderFactorySeedSql,
} from "./generate-quick-select-factory-boxes";
// Pure module: no db, no Express, no React. Imported across the package
// boundary deliberately, so the shipped catalogue is held to the exact same
// contract as a box a doctor authors in the workspace.
import {
  QUICK_SELECT_BOX_FIELDS,
  BOX_TEXT_FIELDS,
  validateBoxDraft,
} from "../../artifacts/api-server/src/lib/quickSelectBoxRules";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");

/**
 * Blobs are LF, but a Windows checkout with core.autocrlf=true materialises
 * .ts/.sql as CRLF — .gitattributes pins only *.mjs, *.cjs and *.sh. Comparing
 * bytes, or anchoring a regex with `$`, against a CRLF working copy is the
 * documented Windows-only false-red class in this repo (5 renderer fixtures and
 * 10 dockerCompose assertions failed that way). CI and the NAS are LF, so this
 * is a no-op there. The render is produced in-process and is always LF; only the
 * file read needs it.
 */
const normalizeEol = (s: string): string => s.replace(/\r\n/g, "\n");

const rows = factorySeedRows();
const digest = catalogueDigest(rows);
const seedFiles = existingSeedFiles(MIGRATIONS_DIR);
const latest = seedFiles[seedFiles.length - 1];

describe("the generated seed migration matches the shipped catalogue", () => {
  it("a migration carrying the current catalogue digest exists", () => {
    // The failure this prevents: tiles edited, SQL not regenerated. The clinic
    // then deploys, the entrypoint finds no new file, and the new box never
    // appears — with nothing in any log to say why.
    expect(seedFiles.length, "no factory box seed migration found at all").toBeGreaterThan(0);
    expect(
      isUpToDate(seedFiles, digest),
      `the newest seed revision carries ${latest?.digest ?? "nothing"} but the catalogue now hashes to ${digest}. ` +
        `Run: pnpm --filter @workspace/scripts run generate:quick-select-factory-boxes`,
    ).toBe(true);
    expect(
      existsSync(join(MIGRATIONS_DIR, factorySeedMigrationName(latest.revision, digest))),
      `catalogue digest ${digest} has no migration; run pnpm --filter @workspace/scripts run generate:quick-select-factory-boxes`,
    ).toBe(true);
  });

  it("the committed SQL is byte-identical to a fresh render — no hand edits", () => {
    const committed = normalizeEol(readFileSync(join(MIGRATIONS_DIR, latest.name), "utf8"));
    const fresh = renderFactorySeedSql(rows, latest.revision, digest);
    expect(committed).toBe(fresh);
  });

  it("every revision has a distinct digest, and revisions are contiguous", () => {
    const digests = seedFiles.map((f) => f.digest);
    expect(new Set(digests).size, "two revisions carrying the same catalogue").toBe(digests.length);
    seedFiles.forEach((f, i) => expect(f.revision).toBe(i + 1));
  });

  it("sorts after the migration that adds the columns it writes", () => {
    // care-db-patch-v2 applies migrations/*.sql in plain alphabetical order and
    // has no concept of dependencies. The authoring migration owns factory_key,
    // factory_definition and customized_at; the seed writes all three.
    const authoring = readdirSync(MIGRATIONS_DIR).find((n) => n.includes("quick_select_authoring"));
    expect(authoring, "the authoring migration is missing").toBeTruthy();
    expect(latest.name > authoring!).toBe(true);
  });
});

describe("factory identity is stable across runs", () => {
  it("the key does not depend on the tile's random id", () => {
    // DEFAULT_QUICK_SELECT_TILES mints `id` with Math.random() at module load.
    // Keying off it would insert a second copy of all 127 boxes on every deploy.
    const tile = { field: "findings", label: "Hydrocephalus", scopeModality: "MR", scopeBodyPart: "Brain" };
    expect(factoryKeyFor({ ...tile, id: "a" } as never)).toBe(factoryKeyFor({ ...tile, id: "b" } as never));
    expect(factoryKeyFor(tile)).toBe("qsf.findings.hydrocephalus.mr.brain");
  });

  it("keys are unique, and stay unique when a label is renamed", () => {
    const keys = rows.map((r) => r.factoryKey);
    expect(new Set(keys).size, "duplicate factory key — two boxes would fight over one identity").toBe(keys.length);
    // The label is part of the key on purpose: a renamed box is a different box,
    // so renaming must not resurrect the shipped wording over the clinic's edit.
    expect(factoryKeyFor({ field: "findings", label: "Hydrocephalus" })).not.toBe(
      factoryKeyFor({ field: "findings", label: "Hydrocephalus (adult)" }),
    );
  });

  it("the digest ignores tile order-insensitive noise but sees wording", () => {
    expect(catalogueDigest(rows)).toBe(catalogueDigest([...rows]));
    const edited = rows.map((r, i) => (i === 0 ? { ...r, findingText: `${r.findingText} ` } : r));
    expect(catalogueDigest(edited)).not.toBe(digest);
  });
});

describe("the SQL keeps the promises in its own header", () => {
  const sql = renderFactorySeedSql(rows, 999, digest);

  it("refreshes only rows the clinic has never edited", () => {
    expect(sql).toContain("q.customized_at IS NULL");
  });

  it("adopts an existing clinic row instead of inserting a duplicate", () => {
    // (study_type, label) is a unique index; without the adopt rule the seed
    // would hard-fail the whole deploy on the three Brain boxes the clinic
    // already has.
    expect(sql).toContain("q.factory_key = ''");
    expect(sql).toContain("WHERE NOT EXISTS");
  });

  it("adoption shields clinic wording that already differs", () => {
    // Adoption stamps identity. If it left customized_at NULL, the very next
    // revision would overwrite the clinic's sentence with the shipped one —
    // the exact thing the owner forbade ("MY EDIT SHOULD NOT DIE").
    expect(sql).toContain("customized_at      = CASE");
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain("THEN NOW() ELSE NULL END");
  });

  it("never writes sort_order or is_active on an existing row", () => {
    const refresh = sql.slice(sql.indexOf("refreshed AS ("), sql.indexOf("-- 3. INSERT"));
    expect(refresh).not.toMatch(/\bsort_order\b/);
    expect(refresh).not.toMatch(/\bis_active\b/);
    // Retiring a box or moving it to the front is the clinic's decision. This is
    // the same reason POST /findings/:id/restore-defaults skips both columns.
    const adopt = sql.slice(sql.indexOf("adopted AS ("), sql.indexOf("refreshed AS ("));
    expect(adopt).not.toMatch(/\bsort_order\b/);
    expect(adopt).not.toMatch(/\bis_active\b/);
  });

  it("adopts identity only, never the shipped clinical meaning", () => {
    // Measured against a real bootstrap: the three boxes r001 adopts
    // (Hydrocephalus, Cerebral Atrophy, Midline shift) come out stamped
    // customized_at with concept '', conflict_group '', baseline_replaces '',
    // properties '' and category NULL. That is deliberate, not an omission to
    // be "fixed" by a later revision. Their stored sentence is not the shipped
    // one, so the seed cannot know whether the shipped concept, normal
    // suppression or critical-result category still describes what the doctor
    // actually wrote — and baseline_replaces/category would hang suppression
    // and a critical-result workflow off clinical meaning nobody verified.
    // The doctor's own one-click path to the full shipped metadata is
    // POST /findings/:id/restore-defaults, which reads factory_definition —
    // the very column this rule stamps.
    const adopt = sql.slice(sql.indexOf("adopted AS ("), sql.indexOf("refreshed AS ("));
    const setCols = [...adopt.matchAll(/^\s*(?:SET\s+)?(\w+)\s*=/gm)].map((m) => m[1]);
    expect(setCols).toEqual(["factory_key", "factory_definition", "customized_at", "updated_at"]);

    // Named individually as well, because an exact-list assertion does not say
    // which columns were the temptation. finding_text is the trap here: it does
    // appear in this slice, inside the wording-divergence CASE, so a loose
    // /\bfinding_text\b/ assertion would false-red on correct SQL.
    for (const col of [
      "concept", "anatomical_section", "conflict_group", "baseline_replaces",
      "properties", "category", "mnemonic", "scope_modality",
      "finding_text", "impression_text", "technique_text", "recommendation_text",
    ]) {
      expect(
        adopt.match(new RegExp(`^\\s*(?:SET\\s+)?${col}\\s*=`, "m")),
        `adoption wrote ${col}, attaching shipped clinical meaning to a sentence the clinic wrote`,
      ).toBeNull();
    }
  });

  it("refreshes exactly the columns its change-guard compares", () => {
    // A column in the SET but not the guard churns updated_at every deploy; a
    // column in the guard but not the SET silently never refreshes.
    const refresh = sql.slice(sql.indexOf("refreshed AS ("), sql.indexOf("-- 3. INSERT"));
    // The first column shares its line with the `SET` keyword, the rest are
    // indented under it — hence the optional prefix.
    const setCols = [...refresh.matchAll(/^\s*(?:SET\s+)?(\w+)\s*=\s*s\.\1,$/gm)].map((m) => m[1]);
    expect(setCols.length).toBeGreaterThan(10);

    const qGuard = refresh.match(/AND \((q\.[\s\S]*?)\)\s*\n\s*IS DISTINCT FROM/);
    const sGuard = refresh.match(/IS DISTINCT FROM \((s\.[\s\S]*?)\)\s*\n/);
    expect(qGuard, "could not find the table-side change guard").toBeTruthy();
    expect(sGuard, "could not find the seed-side change guard").toBeTruthy();
    const qCols = qGuard![1].split(",").map((c) => c.trim().replace(/^q\./, ""));
    const sCols = sGuard![1].split(",").map((c) => c.trim().replace(/^s\./, ""));

    expect(qCols).toEqual(setCols);
    expect(sCols).toEqual(setCols);
  });

  it("creates no table, no trigger, and drops nothing", () => {
    expect(sql).not.toMatch(/\bCREATE\s+(TABLE|INDEX|TRIGGER)\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    // A new trigger would break the repo-wide table census; a DELETE would
    // remove a box a signed report may have used.
  });

  it("escapes an apostrophe in clinical prose", () => {
    // No shipped sentence contains one today, so real data cannot exercise this.
    // An unescaped quote would not corrupt one row — it would end the string
    // literal and fail the entire migration mid-deploy.
    const row = { ...rows[0], factoryKey: "qsf.test", findingText: "The patient's disc bulges." };
    const out = renderFactorySeedSql([row], 1, catalogueDigest([row]));
    expect(out).toContain("The patient''s disc bulges.");
    expect(out).not.toContain("The patient's disc");
  });
});

describe("the shipped catalogue is a valid set of boxes", () => {
  it("every box passes the same rules a doctor's box must", () => {
    const failures: string[] = [];
    for (const row of rows) {
      const result = validateBoxDraft(
        {
          label: row.label,
          field: row.field,
          sonKind: row.sonKind,
          parentId: null,
          findingText: row.findingText,
          impressionText: row.impressionText,
          techniqueText: row.techniqueText,
          recommendationText: row.recommendationText,
          concept: row.concept,
          anatomicalSection: row.anatomicalSection,
          conflictGroup: row.conflictGroup,
          questionsJson: "[]",
        },
        {},
      );
      if (result.blocking.length > 0) {
        failures.push(`${row.label}: ${result.blocking.map((b) => b.code).join(",")}`);
      }
    }
    // A shipped box that the workspace's own editor would refuse is a box the
    // doctor can open but never save.
    expect(failures).toEqual([]);
  });

  it("every box writes somewhere", () => {
    for (const row of rows) {
      expect(QUICK_SELECT_BOX_FIELDS).toContain(row.field as never);
      const wrote = BOX_TEXT_FIELDS.some((f) => String(row[f]).trim().length > 0);
      expect(wrote, `${row.label} (${row.field}) fills no text column`).toBe(true);
    }
  });

  it("maps a tile's sentence into the column its field names", () => {
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    const impressionTile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.field === "impression");
    expect(impressionTile).toBeTruthy();
    expect(byLabel.get(impressionTile!.label)?.impressionText).toBe(impressionTile!.sentence);

    const findingsTile = DEFAULT_QUICK_SELECT_TILES.find(
      (t) => t.field === "findings" && (t.impressionSentence ?? "") !== "" && (t.recommendationSentence ?? "") !== "",
    );
    expect(findingsTile, "no findings tile carries both an impression and a recommendation").toBeTruthy();
    const box = byLabel.get(findingsTile!.label)!;
    expect(box.findingText).toBe(findingsTile!.sentence);
    expect(box.impressionText).toBe(findingsTile!.impressionSentence);
    expect(box.recommendationText).toBe(findingsTile!.recommendationSentence);
  });

  it("carries the ten cross-region boxes with the empty-region sentinel", () => {
    // These are the utilities that have no region: Standard H&P, Trauma, the
    // five per-modality technique defaults, Normal study, Clinical correlation,
    // Follow-up scan. Every row already in the clinic's table has a region, so
    // '' is a new class the client read path must include for any active region
    // — otherwise deleting the localStorage strip loses all ten.
    const regionless = rows.filter((r) => r.studyType === "");
    expect(regionless.length).toBe(DEFAULT_QUICK_SELECT_TILES.filter((t) => !(t.scopeBodyPart ?? "").trim()).length);
    expect(regionless.length).toBeGreaterThan(0);
    expect(regionless.map((r) => r.label).sort()).toContain("Standard H&P");
  });

  it("ships a flat catalogue — ownership is the owner's to author", () => {
    // Deriving fathers from conflict_group (Fazekas 1/2/3) would be a clinical
    // judgement made silently by a build script.
    expect(rows.every((r) => r.sonKind === "")).toBe(true);
    for (const row of rows) {
      const snapshot = JSON.parse(row.factoryDefinition) as Record<string, unknown>;
      expect(snapshot.parentId).toBeNull();
      expect(snapshot.label).toBe(row.label);
      expect(snapshot.findingText).toBe(row.findingText);
      expect(snapshot.impressionText).toBe(row.impressionText);
      expect(snapshot.techniqueText).toBe(row.techniqueText);
      expect(snapshot.recommendationText).toBe(row.recommendationText);
    }
  });

  it("the snapshot is what Restore defaults reads back", () => {
    // POST /findings/:id/restore-defaults JSON.parses factory_definition and
    // copies AUTHORED_BOX_COLUMNS out of it by camelCase name. A snake_case or
    // abbreviated snapshot would make that button a no-op that looks like it
    // worked.
    const snapshot = JSON.parse(rows[0].factoryDefinition) as Record<string, unknown>;
    for (const key of [
      "label", "field", "sonKind", "parentId", "mnemonic", "concept", "scopeModality",
      "category", "anatomicalSection", "conflictGroup", "baselineReplaces", "icdCode",
      "tags", "suggests", "properties", "questionsJson", "findingText", "impressionText",
      "techniqueText", "recommendationText", "sortOrder", "isActive",
    ]) {
      expect(key in snapshot, `factory_definition is missing ${key}`).toBe(true);
    }
  });
});

describe("revision selection", () => {
  it("starts at 1 and increments from the highest existing revision", () => {
    expect(nextRevision([])).toBe(1);
    expect(nextRevision([{ revision: 1, digest: "a", name: "x" }])).toBe(2);
    expect(
      nextRevision([
        { revision: 1, digest: "a", name: "x" },
        { revision: 4, digest: "b", name: "y" },
      ]),
    ).toBe(5);
  });

  it("is up to date only when the newest revision carries the current digest", () => {
    expect(isUpToDate([{ revision: 1, digest: "aaa", name: "x" }], "aaa")).toBe(true);
    expect(isUpToDate([{ revision: 1, digest: "aaa", name: "x" }], "bbb")).toBe(false);
    expect(
      isUpToDate(
        [
          { revision: 1, digest: "aaa", name: "x" },
          { revision: 2, digest: "bbb", name: "y" },
        ],
        "aaa",
      ),
    ).toBe(false);
    expect(isUpToDate([], "aaa")).toBe(false);
  });

  it("orders existing revisions numerically, not by directory order", () => {
    const dir = mkdtempSync(join(tmpdir(), "qs-seed-order-"));
    try {
      // Written newest-first: readdirSync order is not guaranteed, so the sort in
      // existingSeedFiles is the only thing making "latest" mean latest.
      writeFileSync(join(dir, factorySeedMigrationName(2, "bbbbbbbbbbbb")), "");
      writeFileSync(join(dir, factorySeedMigrationName(1, "aaaaaaaaaaaa")), "");
      writeFileSync(join(dir, factorySeedMigrationName(11, "cccccccccccc")), "");
      writeFileSync(join(dir, "20260101_unrelated.sql"), "");
      expect(existingSeedFiles(dir).map((f) => f.revision)).toEqual([1, 2, 11]);
      expect(isUpToDate(existingSeedFiles(dir), "cccccccccccc")).toBe(true);
      expect(nextRevision(existingSeedFiles(dir))).toBe(12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies in revision order under the entrypoint's plain alphabetical sort", () => {
    // care-db-patch-v2 runs `ls migrations/*.sql | sort`. The zero-padded
    // revision precedes the digest in the filename, so alphabetical order IS
    // revision order — which is what stops an older snapshot from applying last
    // and refreshing untouched rows back to stale wording. Three-digit padding
    // breaks at revision 1000 (r1000 sorts before r999), so this fails at 999,
    // one revision before the ordering would silently go wrong.
    const names = seedFiles.map((f) => f.name);
    expect([...names].sort()).toEqual(names);
    expect(Math.max(...seedFiles.map((f) => f.revision))).toBeLessThan(999);
  });

  it("names the file with a zero-padded revision and the digest", () => {
    expect(factorySeedMigrationName(7, "0123456789ab")).toBe(
      "zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r007_0123456789ab.sql",
    );
  });
});
