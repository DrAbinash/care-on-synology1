/**
 * audit-migration-ledger.test.mjs — the gate under the gate
 * ======================================================================
 *
 * `audit-migration-ledger.mjs` exists to tell a clinician whether the database
 * in front of them matches what its ledger claims. If its SQL parser is wrong the
 * damage is asymmetric in the worst possible direction: a false accusation is
 * ignored after the third one, and a missed detection is invisible forever.
 *
 * So this file does not test the happy path. It tests the four ways the parser
 * lied during development, each found by running the audit against a real
 * database and reading a finding that could not be true:
 *   1. it reported a column called `radiology_snippets.radiology_snippets`
 *      (nested capture groups shifted, so it read the table name twice);
 *   2. it reported a table called `public`
 *      (the identifier pattern stopped at the quote in `"public"."tbl"`);
 *   3. it reported indexes as "dropped, and still there"
 *      (effects folded in PATTERN order instead of the order the file ran them);
 *   4. it reported six foreign keys as never applied
 *      (Postgres truncates identifiers over 63 bytes and the audit compared the
 *      declared name verbatim).
 *
 * Every case is pure: the "database" is a set of catalog keys. The detection
 * proof therefore runs in CI with no Postgres, which is the only version of it
 * that can be run on every push. tmp/mig/ holds the real-database counterpart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EFFECT_PATTERNS,
  emptyLive,
  effectFindings,
  extractEffects,
  foldRecordedEffects,
  has,
  normCols,
  pgTrunc,
  plainSql,
  present,
  recordedEffectInputs,
} from "./audit-migration-ledger.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const effectsOf = (sql) => extractEffects(sql).effects;

/** live catalog from plain strings, in the shape liveSchema() returns. */
function liveOf({ tables = [], columns = [], indexes = [], constraints = [], fk = [] } = {}) {
  const live = emptyLive();
  for (const t of tables) live.tables.add(t);
  for (const c of columns) live.columns.add(c);
  for (const i of indexes) live.indexes.add(i);
  for (const k of constraints) {
    live.constraints.add(k);
    const [, name] = k.split(".");
    live.constraints.add(`public.${name}`);
  }
  // fk: [table, clause, cols, name] — the equivalence index Postgres gives us.
  for (const [table, clause, cols, name] of fk) {
    const key = `public.${table}:${clause}:${cols}`;
    if (!live.constraintEq.has(key)) live.constraintEq.set(key, []);
    live.constraintEq.get(key).push(name);
  }
  return live;
}

describe("extractEffects — reading a statement as written", () => {
  it("resolves ADD COLUMN to the column, not to the table it was added to", () => {
    // Mutant 1's regression: m[2] was the nested duplicate of the table capture,
    // so every column in the repository was reported as `table.table`.
    const [e] = effectsOf(
      'ALTER TABLE radiology_snippets ADD COLUMN IF NOT EXISTS clinical_history_text TEXT;',
    );
    expect(e).toMatchObject({ kind: "column", table: "radiology_snippets", object: "clinical_history_text" });
    expect(e.object).not.toBe(e.table);
  });

  it("resolves a quoted, schema-qualified CREATE TABLE to the table", () => {
    // Mutant 2's regression: `"?…"?` matched `public` and stopped, so the injected
    // probe table was reported as a missing table called `public`.
    const [e] = effectsOf('CREATE TABLE "public"."ledger_probe_second" ("id" serial PRIMARY KEY);');
    expect(e).toMatchObject({ kind: "table", object: "public.ledger_probe_second" });
    expect(e.object).not.toBe("public");
  });

  it("accepts every spelling of the same relation as the same object", () => {
    for (const form of ['"tbl"', "tbl", "public.tbl", '"public"."tbl"', 'public."tbl"']) {
      const [e] = effectsOf(`CREATE TABLE ${form} ("id" integer);`);
      expect(present(liveOf({ tables: ["public.tbl"] }), e)).toBe(true);
    }
  });

  it("never reads a keyword as a column name", () => {
    const sql = [
      'ALTER TABLE "bills" ADD CONSTRAINT "bills_client_ref_uidx" UNIQUE ("client_ref");',
      "ALTER TABLE bills DROP DEFAULT;",
      "ALTER TABLE bills ALTER COLUMN note DROP NOT NULL;",
      'ALTER TABLE "bills" ADD PRIMARY KEY ("id");',
    ].join("\n");
    const cols = effectsOf(sql).filter((e) => e.kind === "column");
    expect(cols.map((c) => c.object)).toEqual([]);
  });

  it("counts a guarded DO block but never asserts what is inside it", () => {
    // Conditional DDL cannot be blamed on a migration: whether it ran depends on
    // a runtime check the audit does not evaluate. Silence, not accusation.
    const sql = `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='tats') THEN
        EXECUTE 'CREATE TABLE tats (id serial)';
      END IF;
    END $$;`;
    const { effects, guardedBlocks } = extractEffects(sql);
    expect(guardedBlocks).toBe(1);
    expect(effects).toEqual([]);
  });

  it("keeps line comments out of the effect list", () => {
    expect(effectsOf('-- CREATE TABLE deleted_in_comment (id int);\n-- x').length).toBe(0);
  });

  it("parses a schema-qualified DROP INDEX as the index it names", () => {
    const [e] = effectsOf('DROP INDEX IF EXISTS "public"."bills_client_ref_uidx";');
    expect(e).toMatchObject({ kind: "index", object: "public.bills_client_ref_uidx", removes: true });
  });

  it("folds a column rename into old-gone, new-present", () => {
    const effects = effectsOf('ALTER TABLE dicom_nodes RENAME COLUMN "query_lookback_hours" TO "pull_query_days";');
    expect(effects).toEqual([
      { kind: "column", table: "dicom_nodes", object: "query_lookback_hours", removes: true },
      { kind: "column", table: "dicom_nodes", object: "pull_query_days", removes: false },
    ]);
  });
});

describe("the fold — file order is execution order", () => {
  const DROP_THEN_CREATE = [
    'DROP INDEX "tat_modality_idx";',
    'CREATE INDEX IF NOT EXISTS "tat_modality_idx" ON "turnaround_times" USING btree ("modality","date_bucket");',
  ].join("\n");

  const CREATE_THEN_DROP = [
    'CREATE INDEX IF NOT EXISTS "tat_modality_idx" ON "turnaround_times" USING btree ("modality");',
    'DROP INDEX "tat_modality_idx";',
  ].join("\n");

  it("resolves drop-then-recreate as present (0006_jazzy_mojo's real shape)", () => {
    // Folded in pattern order the DROP was pushed last, and the audit accused a
    // migration of leaving an index behind that the very next statement created.
    const folded = foldRecordedEffects([{ name: "0006_jazzy_mojo", text: DROP_THEN_CREATE }]);
    expect([...folded.lastWriter.values()].map((e) => e.removes)).toEqual([false]);
    expect(effectFindings(folded, liveOf({ indexes: ["public.tat_modality_idx"] }))).toEqual([]);
  });

  it("resolves create-then-drop as absent, so the direction is real", () => {
    const folded = foldRecordedEffects([{ name: "0006_jazzy_mojo", text: CREATE_THEN_DROP }]);
    const out = effectFindings(folded, liveOf({ indexes: ["public.tat_modality_idx"] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", code: "RECORDED_BUT_ABSENT" });
    expect(out[0].detail).toMatch(/still there/);
  });

  it("lets a later migration be the last writer of a shared object", () => {
    const folded = foldRecordedEffects([
      { name: "0001_a", text: 'ALTER TABLE bills ADD COLUMN IF NOT EXISTS client_ref TEXT;' },
      { name: "0002_b", text: 'ALTER TABLE bills DROP COLUMN client_ref;' },
    ]);
    expect(effectFindings(folded, liveOf({}))).toEqual([]);
    const stillThere = effectFindings(folded, liveOf({ columns: ["public.bills.client_ref"] }));
    expect(stillThere).toHaveLength(1);
  });
});

describe("identifier truncation", () => {
  it("truncates every part of a name to the 63 bytes Postgres stores", () => {
    expect(pgTrunc("a".repeat(70))).toBe("a".repeat(63));
    expect(pgTrunc("public." + "b".repeat(70))).toBe(`public.${"b".repeat(63)}`);
    expect(pgTrunc("short")).toBe("short");
  });

  it("matches a declared foreign key against the truncated name on disk", () => {
    // outsource_orders_dispatch_batch_id_outsource_dispatch_batches_id_fk is 66
    // characters; Postgres stored the first 63 and said nothing. The audit called
    // the migration a failure until this was measured.
    const declared = "outsource_orders_dispatch_batch_id_outsource_dispatch_batches_id_fk";
    expect(declared.length).toBeGreaterThan(63);
    const [e] = effectsOf(`ALTER TABLE "outsource_orders" ADD CONSTRAINT "${declared}" FOREIGN KEY ("dispatch_batch_id") REFERENCES "public"."outsource_dispatch_batches"("id");`);
    const live = liveOf({ constraints: [`public.${declared.slice(0, 63)}`] });
    expect(present(live, e)).toBe(true);
    expect(effectFindings(foldRecordedEffects([{ name: "0006_jazzy_mojo", text: "" }]), live)).toEqual([]);
  });

  it("does not let truncation match a genuinely different object", () => {
    // Truncation is a 63-byte rule, not fuzzy matching. The two form_f_records
    // foreign keys differ by more than that and must stay distinguishable — this
    // is the pair that equivalence (below), not name lookup, has to resolve.
    const live = liveOf({ constraints: ["public.form_f_records_bill_id_fk"] });
    expect(has(live.constraints, "form_f_records_bill_id_bills_id_fk")).toBe(false);
  });
});

describe("constraint equivalence — the effect, not the spelling", () => {
  // migrations/zzzzzzz_bill_dependent_referential_integrity.sql conditionally
  // drops Drizzle's form_f_records_bill_id_bills_id_fk and reinstalls the same
  // key as form_f_records_bill_id_fk with ON DELETE SET NULL. The drop happens
  // inside a DO block, so the audit cannot see it — and accused 0000_dear_forge
  // of never having run. Its effect did run; only its name changed.
  const DECLARED = 'ALTER TABLE "form_f_records" ADD CONSTRAINT "form_f_records_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action;';

  it("reads the clause and columns the statement declares", () => {
    const [e] = effectsOf(DECLARED);
    expect(e).toMatchObject({ kind: "constraint", clause: "foreign key", cols: "bill_id" });
  });

  it("reports the effect as applied, and says so informationally", () => {
    const live = liveOf({ fk: [["form_f_records", "foreign key", "bill_id", "form_f_records_bill_id_fk"]] });
    const out = effectFindings(foldRecordedEffects([{ name: "0000_dear_forge", text: DECLARED }]), live);
    expect(out.filter((f) => f.severity === "critical")).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "info", code: "CONSTRAINT_UNDER_OTHER_NAME" });
    expect(out[0].detail).toContain("form_f_records_bill_id_fk");
  });

  it("still calls a missing key critical when nothing equivalent exists", () => {
    const out = effectFindings(
      foldRecordedEffects([{ name: "0000_dear_forge", text: DECLARED }]),
      liveOf({ fk: [["form_f_records", "foreign key", "patient_id", "form_f_records_patient_id_patients_id_fk"]] }),
    );
    expect(out.map((f) => f.code)).toEqual(["RECORDED_BUT_ABSENT"]);
  });
});

describe("detection of a falsely completed migration", () => {
  /**
   * The exact historical condition PR #955 makes possible no more: a Drizzle file
   * whose first statement succeeded and whose second failed, recorded as applied
   * and therefore skipped on every later deploy.
   */
  const PROBE = [
    'CREATE TABLE "public"."ledger_probe_first" ("id" serial PRIMARY KEY);',
    '--> statement-breakpoint',
    'CREATE TABLE "public"."ledger_probe_second" ("id" serial PRIMARY KEY, "ref" integer);',
  ].join("\n");

  it("names the migration and the object, not just that something is wrong", () => {
    const partial = liveOf({ tables: ["public.ledger_probe_first"] });
    const out = effectFindings(foldRecordedEffects([{ name: "0099_ledger_probe", text: PROBE }]), partial);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", migration: "0099_ledger_probe" });
    expect(out[0].detail).toContain("public.ledger_probe_second");
    expect(out[0].detail).toMatch(/records 0099_ledger_probe as applied/);
  });

  it("says nothing when both statements really did run", () => {
    // Without this the test above could pass by always complaining.
    const both = liveOf({
      tables: ["public.ledger_probe_first", "public.ledger_probe_second"],
      columns: ["public.ledger_probe_first.id", "public.ledger_probe_second.id", "public.ledger_probe_second.ref"],
    });
    expect(effectFindings(foldRecordedEffects([{ name: "0099_ledger_probe", text: PROBE }]), both)).toEqual([]);
  });

  it("judges only migrations the ledger claims, never ones still to come", () => {
    // The filter is the difference between one useful line and 190 false ones on
    // a half-migrated database, so it is driven directly rather than asserted on
    // the arrays the test itself built.
    const onDisk = [
      { name: "0001_a", order: 0, text: 'CREATE TABLE "public"."a" ("id" integer);' },
      { name: "0099_ledger_probe", order: 1, text: PROBE },
    ];
    expect(recordedEffectInputs(onDisk, new Set(["0001_a"]))).toEqual([
      { name: "0001_a", text: onDisk[0].text },
    ]);
    expect(recordedEffectInputs(onDisk, new Set(["0099_ledger_probe"]))).toEqual([
      { name: "0099_ledger_probe", text: PROBE },
    ]);
    // out-of-order disk input still folds in execution order
    const shuffled = [{ ...onDisk[1], order: 7 }, { ...onDisk[0], order: 2 }];
    expect(recordedEffectInputs(shuffled, new Set(["0001_a", "0099_ledger_probe"])).map((f) => f.name))
      .toEqual(["0001_a", "0099_ledger_probe"]);
    // The filter is what protects a migration that has not run yet. The live
    // catalog below is the historical shape: 0001 applied, the probe's FIRST
    // statement applied, its second never run. Recording only 0001 accuses
    // nothing; recording the probe as applied too produces exactly one line.
    const partial = liveOf({ tables: ["public.a", "public.ledger_probe_first"] });
    expect(effectFindings(foldRecordedEffects(recordedEffectInputs(onDisk, new Set(["0001_a"]))), partial))
      .toEqual([]);
    const both = effectFindings(
      foldRecordedEffects(recordedEffectInputs(onDisk, new Set(["0001_a", "0099_ledger_probe"]))),
      partial,
    );
    expect(both).toHaveLength(1);
    expect(both[0].detail).toContain("ledger_probe_second");
  });
});

describe("the parser against the files that actually ship", () => {
  const files = [];
  const journal = path.join(REPO, "lib", "db", "drizzle", "meta", "_journal.json");
  for (const entry of JSON.parse(fs.readFileSync(journal, "utf8")).entries ?? []) {
    const f = path.join(REPO, "lib", "db", "drizzle", `${entry.tag}.sql`);
    if (fs.existsSync(f)) files.push({ name: entry.tag, text: fs.readFileSync(f, "utf8") });
  }
  const featureDir = path.join(REPO, "migrations");
  for (const f of fs.existsSync(featureDir) ? fs.readdirSync(featureDir).filter((x) => x.endsWith(".sql")).sort() : []) {
    files.push({ name: f, text: fs.readFileSync(path.join(featureDir, f), "utf8") });
  }

  const all = files.flatMap((f) => extractEffects(f.text).effects.map((e) => ({ ...e, file: f.name })));
  const RESERVED = new Set([
    "public", "if", "exists", "not", "null", "column", "constraint", "index", "key", "primary",
    "unique", "foreign", "references", "default", "check", "table", "view", "set", "add", "drop",
    "rename", "to", "cascade", "using", "concurrently", "only", "and", "or", "on",
  ]);

  it("parses the whole repository, so the controls below cannot be vacuous", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(all.length).toBeGreaterThan(1000);
  });

  it("never produces an object that is a SQL keyword or a schema", () => {
    const bad = all.filter((e) => RESERVED.has(e.object) || (e.table && RESERVED.has(e.table)));
    expect(bad.map((e) => `${e.kind} ${e.file}`).slice(0, 10)).toEqual([]);
  });

  it("never reads a column as having its own table's name", () => {
    const bad = all.filter((e) => e.kind === "column" && e.object === e.table);
    expect(bad.map((e) => `${e.file}:${e.object}`).slice(0, 10)).toEqual([]);
  });

  it("never leaves a quoted dot inside a name", () => {
    const bad = all.filter((e) => /"/.test(e.object) || /"/.test(e.table || ""));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("normalises key lists the way the catalog spells them", () => {
    expect(normCols('("modality","date_bucket")')).toBe("modality,date_bucket");
    expect(normCols(undefined)).toBe("");
    // A key list that kept quotes or spaces would never match pg_constraint, so
    // every FK/PK/UQ the repository declares must normalise to bare identifiers.
    // CHECK constraints hold an expression, not a column list, and are excluded.
    const keyed = all.filter((e) => e.kind === "constraint" && e.cols && e.clause !== "check");
    expect(keyed.length).toBeGreaterThan(0);
    for (const e of keyed) expect(e.cols).not.toMatch(/["\s()]/);
  });

  it("parses every ADD CONSTRAINT in the repository, not just the easy ones", () => {
    // The expectation is measured from the same tree rather than remembered: a
    // fixed number rots the day a migration is added, and a low number passes
    // silently when the parser stops recognising a statement. This is the
    // assertion that would have failed while `ADD CONSTRAINT x FOREIGN KEY` was
    // being read as a column called `x`.
    const declared = files.reduce(
      (n, f) => n + (plainSql(f.text).match(/ALTER\s+TABLE\s+\S+\s+ADD\s+CONSTRAINT\s+["\w]/gi) || []).length,
      0,
    );
    const parsed = all.filter((e) => e.kind === "constraint" && !e.removes).length;
    expect(declared).toBeGreaterThan(50);
    expect(parsed).toBe(declared);
  });

  it("uses only named groups, so adding a pattern cannot shift a read", () => {
    // The whole class of bug that produced `column radiology_snippets.radiology_snippets`:
    // an unnamed inner group renumbers every capture after it, and `m[2]` quietly
    // becomes something else. Positional reads are forbidden here.
    const shifted = EFFECT_PATTERNS.filter(({ re }) => /(?<!\\)\((?!\?)/.test(re.source));
    expect(shifted.map((s) => s.kind)).toEqual([]);
  });
});
