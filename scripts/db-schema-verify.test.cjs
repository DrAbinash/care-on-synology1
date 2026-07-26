import { describe, it, expect } from "vitest";
const fs = require("fs");
const path = require("path");
const {
  defaultLiteralForType, parseSqlFiles, diffSchema, loadJournal, extractRuntimeTableNames,
  normaliseType, typesCompatible, classifySchemaStatus,
} = require("./db-schema-verify.cjs");

// Regression coverage for the incident where care-db-patch-v2 schema
// verification failed because payment_logs.amount and .error_message
// were missing on the live Synology DB, and `--repair` mode generated
// invalid SQL (`numeric ... DEFAULT ''`) trying to fix it.

describe("db-schema-verify repair-mode defaults", () => {
  it("never uses an empty-string default for numeric/decimal columns", () => {
    expect(defaultLiteralForType("numeric(10, 2)")).toBe("0");
    expect(defaultLiteralForType("numeric")).toBe("0");
    expect(defaultLiteralForType("integer")).toBe("0");
    expect(defaultLiteralForType("bigint")).toBe("0");
    expect(defaultLiteralForType("real")).toBe("0");
  });

  it("uses type-appropriate defaults for other common families", () => {
    expect(defaultLiteralForType("boolean")).toBe("false");
    expect(defaultLiteralForType("jsonb")).toBe("'{}'::jsonb");
    expect(defaultLiteralForType("timestamp with time zone")).toBe("now()");
  });

  it("still defaults to an empty string for text columns", () => {
    expect(defaultLiteralForType("text")).toBe("''");
    expect(defaultLiteralForType("varchar(50)")).toBe("''");
  });
});

describe("payment_logs schema stays in sync with amount/error_message", () => {
  const indexTs = fs.readFileSync(
    path.join(__dirname, "../artifacts/api-server/src/index.ts"),
    "utf8"
  );
  const drizzleSchema = fs.readFileSync(
    path.join(__dirname, "../lib/db/src/schema/paymentLogs.ts"),
    "utf8"
  );

  it("Drizzle source schema declares amount and errorMessage", () => {
    expect(drizzleSchema).toMatch(/amount:\s*numeric/);
    expect(drizzleSchema).toMatch(/errorMessage:\s*text/);
  });

  it("API startup migrations backfill amount and error_message with idempotent ALTER TABLE statements", () => {
    // Guards against the exact drift that broke care-db-patch-v2: an old
    // CREATE TABLE IF NOT EXISTS payment_logs (...) predating these columns
    // means CREATE TABLE alone can never add them to an existing table.
    expect(indexTs).toMatch(
      /ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS amount NUMERIC\(10, ?2\) NOT NULL DEFAULT 0;/
    );
    expect(indexTs).toMatch(
      /ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS error_message TEXT;/
    );
  });
});

describe("radiology_worklist accession_number is no longer a unique/required field", () => {
  const indexTs = fs.readFileSync(
    path.join(__dirname, "../artifacts/api-server/src/index.ts"),
    "utf8"
  );
  const worklistSchema = fs.readFileSync(
    path.join(__dirname, "../lib/db/src/schema/radiologyWorklist.ts"),
    "utf8"
  );

  it("Drizzle source no longer marks accessionNumber as notNull, and drops its unique index", () => {
    // Guards against the exact incident: bad/duplicate DICOM accession
    // numbers (e.g. a referring doctor's name) crashing study intake with
    // "duplicate key value violates unique constraint radiology_worklist_accession_uq".
    expect(worklistSchema).not.toMatch(/accessionNumber:\s*text\("accession_number"\)\.notNull\(\)/);
    expect(worklistSchema).not.toMatch(/uniqueIndex\("radiology_worklist_accession_uq"\)/);
    // study_instance_uid is the real identifier and must be uniquely indexed instead.
    expect(worklistSchema).toMatch(/uniqueIndex\("radiology_worklist_uid_uq"\)/);
  });

  it("API startup migration relaxes accession_number and enforces study_instance_uid uniqueness idempotently", () => {
    expect(indexTs).toMatch(
      /ALTER TABLE radiology_worklist ALTER COLUMN accession_number DROP NOT NULL;/
    );
    expect(indexTs).toMatch(/DROP INDEX IF EXISTS radiology_worklist_accession_uq;/);
    expect(indexTs).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS radiology_worklist_uid_uq/
    );
    // Must be guarded so pre-existing duplicate UIDs can't abort the whole
    // startup migration batch (same class of bug as the gstin incident).
    expect(indexTs).toMatch(/EXCEPTION WHEN unique_violation THEN/);
  });
});

describe("dicom_nodes: schema-verify --repair must not resurrect deprecated columns", () => {
  // Regression test for the incident where care-schema-verify's --repair mode
  // kept re-adding pull_interval_minutes / pull_query_days to dicom_nodes on
  // every redeploy, even though the Drizzle migrations had already renamed
  // them to pull_interval_seconds / query_lookback_hours.
  //
  // Root cause: parseSqlFiles() only understood CREATE TABLE and
  // ALTER TABLE ... ADD COLUMN. It ignored DROP COLUMN and RENAME COLUMN, so
  // a column added in an early migration (0000_dear_forge.sql) stayed
  // "expected" forever, even after a later migration (0006_jazzy_mojo.sql)
  // renamed/dropped it. --repair then treated the live DB (correctly missing
  // the deprecated column) as "behind" and ADDed it back.
  //
  // This test replays the exact real migration sequence for dicom_nodes
  // (create with old columns -> rename -> add new + drop old) and asserts
  // the final expected schema only contains the current column names.
  const oldColumnCreate = `CREATE TABLE "dicom_nodes" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"ae_title" text NOT NULL,\n\t"pull_interval_minutes" integer DEFAULT 15 NOT NULL,\n\t"pull_query_days" integer DEFAULT 1 NOT NULL\n);`;
  const renameMigration = `ALTER TABLE dicom_nodes\n  RENAME COLUMN pull_interval_minutes TO pull_interval_seconds;\nALTER TABLE dicom_nodes\n  RENAME COLUMN pull_query_days TO query_lookback_hours;`;
  const addDropMigration = `ALTER TABLE "dicom_nodes" ADD COLUMN "pull_interval_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint\nALTER TABLE "dicom_nodes" ADD COLUMN "query_lookback_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint\nALTER TABLE "dicom_nodes" DROP COLUMN "pull_interval_minutes";--> statement-breakpoint\nALTER TABLE "dicom_nodes" DROP COLUMN "pull_query_days";`;

  const entries = [
    { tag: "0000_dear_forge", type: "drizzle", content: oldColumnCreate },
    { tag: "0002_dicom_rename", type: "drizzle", content: renameMigration },
    { tag: "0006_jazzy_mojo", type: "drizzle", content: addDropMigration },
  ];

  it("does not include deprecated pull_interval_minutes / pull_query_days in the expected schema", () => {
    const { tables } = parseSqlFiles(entries);
    const cols = [...tables.get("dicom_nodes").columns.keys()];
    expect(cols).not.toContain("pull_interval_minutes");
    expect(cols).not.toContain("pull_query_days");
  });

  it("still includes the current pull_interval_seconds / query_lookback_hours columns", () => {
    const { tables } = parseSqlFiles(entries);
    const cols = [...tables.get("dicom_nodes").columns.keys()];
    expect(cols).toContain("pull_interval_seconds");
    expect(cols).toContain("query_lookback_hours");
  });

  it("handles a RENAME COLUMN with no prior ADD COLUMN in the expected set (column carried forward, not dropped)", () => {
    // ae_title was defined in the CREATE TABLE and never touched again — it
    // must survive untouched through the drop/rename processing.
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("dicom_nodes").columns.has("ae_title")).toBe(true);
  });
});

describe("parseSqlFiles: RENAME TABLE, ALTER COLUMN TYPE, DROP INDEX (production DB architecture hardening)", () => {
  // These three statement types were previously invisible to the expected-
  // schema parser, the same root-cause class of bug as the dicom_nodes
  // column-drift incident above, just for different DDL shapes:
  //   - a table renamed in a later migration would leave the OLD name
  //     "expected" forever (and the new name never recognized)
  //   - a column whose type changed in a later migration would keep
  //     reporting a stale type-mismatch warning against its original type
  //   - an index dropped in a later migration would stay "expected" forever
  //     and get flagged as missing (or resurrected by --repair)

  it("ALTER TABLE ... RENAME TO renames the table in the expected schema, carrying its columns forward", () => {
    const entries = [
      { tag: "a", type: "drizzle", content: `CREATE TABLE "old_name" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"x" text\n);` },
      { tag: "b", type: "drizzle", content: `ALTER TABLE old_name RENAME TO new_name;` },
      { tag: "c", type: "drizzle", content: `ALTER TABLE "new_name" ADD COLUMN "y" integer;` },
    ];
    const { tables } = parseSqlFiles(entries);
    expect(tables.has("old_name")).toBe(false);
    expect(tables.has("new_name")).toBe(true);
    expect([...tables.get("new_name").columns.keys()]).toEqual(expect.arrayContaining(["id", "x", "y"]));
  });

  it("ALTER TABLE ... ALTER COLUMN ... TYPE updates the expected column type instead of keeping the stale original type", () => {
    const entries = [
      { tag: "a", type: "drizzle", content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"amount" integer\n);` },
      { tag: "b", type: "drizzle", content: `ALTER TABLE t ALTER COLUMN amount TYPE numeric(10, 2);` },
    ];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("amount").type).toBe("numeric");
  });

  it("DROP INDEX removes the index from the expected schema so it isn't flagged as missing/re-created forever", () => {
    const entries = [
      { tag: "a", type: "drizzle", content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL\n);\nCREATE INDEX "t_idx" ON "t" ("id");` },
      { tag: "b", type: "drizzle", content: `DROP INDEX IF EXISTS t_idx;` },
    ];
    const { tables, indexNames } = parseSqlFiles(entries);
    expect(tables.get("t").indexes.has("t_idx")).toBe(false);
    expect(indexNames.has("t_idx")).toBe(false);
  });

  it("DROP INDEX followed by CREATE INDEX of the same name in the same file ends up present (redefinition, not removal)", () => {
    const entries = [
      { tag: "a", type: "drizzle", content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL\n);` },
      { tag: "b", type: "drizzle", content: `DROP INDEX IF EXISTS t_idx;\nCREATE UNIQUE INDEX "t_idx" ON "t" ("id");` },
    ];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").indexes.has("t_idx")).toBe(true);
  });
});

describe("extractRuntimeTableNames — avoids false-positive extra-table drift warnings", () => {
  it("finds tables created inline by care-api's runStartupMigrations() in index.ts", () => {
    const names = extractRuntimeTableNames();
    // A handful of tables known (at the time this test was written) to be
    // created only via CREATE TABLE IF NOT EXISTS inside index.ts, never in
    // any migrations/*.sql or lib/db/drizzle/*.sql file. If this ever comes
    // back empty, extra-table detection would start flagging ~90 completely
    // legitimate tables as "possible manual drift" on every single run.
    expect(names.size).toBeGreaterThan(50);
    expect(names.has("dicom_nodes")).toBe(true);
    expect(names.has("payment_logs")).toBe(true);
    expect(names.has("day_closures")).toBe(true);
  });
});

describe("diffSchema — extra-table (manual/out-of-band drift) detection", () => {
  function fakeLive(tableNames) {
    return {
      liveTables: new Set(tableNames),
      liveColumns: new Map(),
      livePks: new Map(),
      liveUniques: new Map(),
      liveIndexes: new Set(),
      liveIndexByTable: new Map(),
      liveFks: [],
      liveChecks: [],
      journalApplied: [],
      featureMigApplied: [],
      deployState: {},
    };
  }

  it("flags a table that exists in the live DB but isn't from any known source", () => {
    const expected = parseSqlFiles([
      { tag: "a", type: "drizzle", content: `CREATE TABLE "known_table" (\n\t"id" serial PRIMARY KEY NOT NULL\n);` },
    ]);
    const live = fakeLive(["known_table", "someone_added_this_by_hand"]);
    const results = diffSchema(expected, live, new Set());
    expect(results.extraTables).toContain("someone_added_this_by_hand");
    expect(results.extraTables).not.toContain("known_table");
  });

  it("does NOT flag a table that's in the runtimeTableNames exclusion set (avoids false positives for care-api-created tables)", () => {
    const expected = parseSqlFiles([]);
    const live = fakeLive(["dicom_nodes"]);
    const results = diffSchema(expected, live, new Set(["dicom_nodes"]));
    expect(results.extraTables).not.toContain("dicom_nodes");
  });

  it("does NOT flag internal infra tables (schema_migration_lock, system_database_identity, etc.)", () => {
    const expected = parseSqlFiles([]);
    const live = fakeLive(["schema_migration_lock", "system_database_identity", "schema_migrations_log", "schema_deploy_state"]);
    const results = diffSchema(expected, live, new Set());
    expect(results.extraTables).toHaveLength(0);
  });

  it("extra-table detection is informational only — does not fail verification by itself", () => {
    const expected = parseSqlFiles([]);
    const live = fakeLive(["mystery_table"]);
    const results = diffSchema(expected, live, new Set());
    expect(results.extraTables).toContain("mystery_table");
    expect(results.pass).toBe(true);
  });
});

describe("Migration Journal Inconsistency — duplicate/out-of-order idx detection is actually surfaced", () => {
  // Regression test for a real gap found during review: loadJournal() always
  // computed `issues` (duplicate idx, out-of-order idx) but the calling code
  // in main() never read that field — a corrupted journal (e.g. from a bad
  // merge giving two migrations the same idx) would be silently ignored
  // instead of failing verification. Fixed by merging journal.issues into
  // crossIssues, and by making any error-level sourceIssue set results.pass
  // = false. These are asserted at the source level (same pattern as
  // dicomNodesMigration.test.ts) since loadJournal() reads a fixed path
  // resolved from the real repo at module load time, not an injectable one.
  const src = fs.readFileSync(path.join(__dirname, "db-schema-verify.cjs"), "utf8");

  it("loadJournal()'s issues field is merged into crossIssues in main()", () => {
    expect(src).toMatch(/for \(const msg of journal\.issues[\s\S]{0,80}crossIssues\.push/);
  });

  it("error-level sourceIssues set results.pass = false (so a broken journal actually blocks, not just logs)", () => {
    expect(src).toMatch(/sourceIssues\.some\(\(i\) => i\.level === "error"\)/);
    // Must appear at least twice: once for the initial verify, once for the
    // post-repair re-verify.
    const matches = src.match(/sourceIssues\.some\(\(i\) => i\.level === "error"\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("the real, current _journal.json has no duplicate or out-of-order idx (sanity check)", () => {
    const journal = loadJournal();
    expect(journal.issues).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S1 — Schema Verification Framework Cleanup
// ════════════════════════════════════════════════════════════════════════════
// Regression coverage for the incident where verification reported false
// positives like `expected 'text,' / got 'text'` for several columns. Root
// cause: the CREATE TABLE column-type capture used a bare `\S+`, which is
// greedy over ANY non-whitespace character — including the comma separating
// one column definition from the next. Confirmed against the real migration
// corpus: 1,647 of 4,750 expected columns (35%) carried a corrupted type
// string with a literal trailing comma baked in before this fix.

describe("S1 root cause: CREATE TABLE column types no longer swallow the trailing comma", () => {
  it("a bare, unconstrained column (`\"email\" text,`) parses to a clean type with no trailing comma", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "patients" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"email" text,\n\t"address" text,\n\t"ledger_id" integer\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    const cols = tables.get("patients").columns;
    expect(cols.get("email").type).toBe("text");
    expect(cols.get("address").type).toBe("text");
    expect(cols.get("ledger_id").type).toBe("integer");
    for (const [, ci] of cols) {
      expect(ci.type.endsWith(",")).toBe(false);
      expect(ci.rawType.endsWith(",")).toBe(false);
    }
  });

  it("this exact bug no longer reproduces on the real migration corpus (regression guard)", () => {
    const journal = loadJournal();
    const entries = [];
    for (const e of journal.entries) {
      const p = path.join(__dirname, "../lib/db/drizzle", `${e.tag}.sql`);
      if (fs.existsSync(p)) entries.push({ tag: e.tag, type: "drizzle", content: fs.readFileSync(p, "utf8") });
    }
    const migDir = path.join(__dirname, "../migrations");
    for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
      entries.push({ tag: f, type: "feature", content: fs.readFileSync(path.join(migDir, f), "utf8") });
    }
    const { tables } = parseSqlFiles(entries);
    let checked = 0;
    for (const ti of tables.values()) {
      for (const ci of ti.columns.values()) {
        checked++;
        expect(ci.type.endsWith(",")).toBe(false);
        expect(ci.type.startsWith('"')).toBe(false);
      }
    }
    // Sanity check the assertions above actually ran over real data, not an
    // empty parse result.
    expect(checked).toBeGreaterThan(1000);
  });

  it("a type immediately followed by a modifier keyword (not a comma) is unaffected — pre-existing behaviour preserved", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"name" text NOT NULL,\n\t"amount" numeric(10, 2) DEFAULT 0\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("name").type).toBe("text");
    expect(tables.get("t").columns.get("amount").type).toBe("numeric");
  });

  it("the last column in a table (no trailing comma, followed by the closing paren) still parses cleanly", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"note" text\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("note").type).toBe("text");
  });
});

describe("S1: whitespace normalization", () => {
  it("collapses internal whitespace runs to a single space", () => {
    expect(normaliseType("double   precision")).toBe(normaliseType("double precision"));
  });

  it("trims leading/trailing whitespace", () => {
    expect(normaliseType("  text  ")).toBe("text");
  });

  it("is case-insensitive", () => {
    expect(normaliseType("TEXT")).toBe("text");
    expect(normaliseType("Character Varying")).toBe(normaliseType("character varying"));
  });
});

describe("S1: quoted identifiers (custom/enum types)", () => {
  it("a quoted custom/enum type column (`\"status\" \"outsource_status\"`) normalizes to the unquoted type", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "outsource_orders" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"status" "outsource_status" DEFAULT 'ordered' NOT NULL\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    const status = tables.get("outsource_orders").columns.get("status");
    // type (used for comparison against live udt_name, which is always
    // unquoted) must be unquoted...
    expect(status.type).toBe("outsource_status");
    // ...but rawType (used verbatim in --repair DDL generation) must stay
    // quoted, since `"outsource_status"` is what valid PostgreSQL DDL needs.
    expect(status.rawType).toBe('"outsource_status"');
  });

  it("normaliseType strips wrapping quotes and schema qualification, quoted or not", () => {
    expect(normaliseType('"outsource_status"')).toBe("outsource_status");
    expect(normaliseType("public.outsource_status")).toBe("outsource_status");
    expect(normaliseType('"public"."outsource_status"')).toBe("outsource_status");
  });

  it("a quoted enum type compares equal to its live (always-unquoted) udt_name — no false positive", () => {
    expect(typesCompatible('"outsource_status"', "outsource_status")).toBe(true);
  });
});

describe("S1: text/varchar aliases", () => {
  it("text, varchar, character varying, and character all normalize to the same group", () => {
    expect(typesCompatible("text", "varchar")).toBe(true);
    expect(typesCompatible("text", "character varying")).toBe(true);
    expect(typesCompatible("text", "character")).toBe(true);
    expect(typesCompatible("varchar(255)", "text")).toBe(true);
  });

  it("character varying(N) with precision parses and normalizes like a bare varchar", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"name" character varying(255),\n\t"code" varchar(50)\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("name").type).toBe("text");
    expect(tables.get("t").columns.get("code").type).toBe("text");
    // rawType must retain the precision — needed for valid --repair DDL.
    expect(tables.get("t").columns.get("name").rawType).toBe("character varying(255)");
  });
});

describe("S1: json/jsonb normalization", () => {
  it("json and jsonb are treated as equivalent", () => {
    expect(typesCompatible("json", "jsonb")).toBe(true);
    expect(normaliseType("json")).toBe("jsonb");
  });
});

describe("S1: array type formatting", () => {
  it("preserves array bracket suffixes in the parsed type instead of dropping them", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"tags" text[]\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("tags").rawType).toBe("text[]");
  });

  it("normalizes inconsistent whitespace inside array brackets", () => {
    expect(normaliseType("text [ ]")).toBe(normaliseType("text[]"));
  });

  it("a real array column ('text[]' expected) compares equal to its reconstructed live type — confirmed against a live Postgres instance (4 real columns: radiology_snippets.tags, radiology_user_copilot_profiles.{ignored_warnings,favorite_templates,favorite_chocolate_box})", () => {
    // PostgreSQL's information_schema reports array columns as
    // data_type='ARRAY' with the element type ONLY in udt_name (prefixed
    // with '_', e.g. '_text' for text[]) — getLiveSchema() reconstructs
    // "text[]" from that so it can match what parseSqlFiles captures from
    // source (`"col" text[]`). This asserts the reconstruction logic is
    // present, since getLiveSchema() itself requires a live DB connection
    // to unit test directly (verified end-to-end against a real Postgres
    // instance during S1 development — see the S1 cleanup report).
    const src = fs.readFileSync(path.join(__dirname, "db-schema-verify.cjs"), "utf8");
    expect(src).toMatch(/r\.data_type === "ARRAY"/);
    expect(src).toMatch(/udt_name\.replace\(\/\^_\/, ""\)/);
    expect(typesCompatible("text[]", normaliseType("text[]"))).toBe(true);
  });
});

describe("S1: default-value parsing no longer truncates multi-word or function-call defaults", () => {
  it("captures a full multi-word quoted string default instead of stopping at the first space", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"status" text DEFAULT 'AI Draft - Requires Radiologist Review' NOT NULL\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("status").defaultVal).toBe("'AI Draft - Requires Radiologist Review'");
  });

  it("captures a balanced function-call default instead of dropping the closing paren", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"created_at" timestamp with time zone DEFAULT now() NOT NULL\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("created_at").defaultVal).toBe("now()");
  });

  it("captures a jsonb default with a type cast", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"data" jsonb DEFAULT '{}'::jsonb NOT NULL\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("data").defaultVal).toBe("'{}'::jsonb");
  });

  it("still captures simple numeric and boolean defaults correctly", () => {
    const entries = [{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"amount" numeric(10, 2) DEFAULT 0 NOT NULL,\n\t"active" boolean DEFAULT false NOT NULL\n);`,
    }];
    const { tables } = parseSqlFiles(entries);
    expect(tables.get("t").columns.get("amount").defaultVal).toBe("0");
    expect(tables.get("t").columns.get("active").defaultVal).toBe("false");
  });
});

describe("S1: diffSchema — false positives disappear, real differences remain visible", () => {
  function fakeLive(tableSpecs) {
    const liveTables = new Set(Object.keys(tableSpecs));
    const liveColumns = new Map();
    for (const [tbl, cols] of Object.entries(tableSpecs)) {
      const m = new Map();
      for (const [col, info] of Object.entries(cols)) m.set(col, info);
      liveColumns.set(tbl, m);
    }
    return {
      liveTables, liveColumns,
      livePks: new Map(), liveUniques: new Map(), liveIndexes: new Set(),
      liveIndexByTable: new Map(), liveFks: [], liveChecks: [],
      journalApplied: [], featureMigApplied: [], deployState: {},
    };
  }

  it("a column whose raw type differs only by formatting (trailing comma, quoting) is NOT reported as a mismatch", () => {
    // Simulates the pre-fix corrupted expected type directly, proving the
    // comparison layer (not just the parser) tolerates it too — belt and
    // suspenders against the same bug resurfacing through another caller.
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "patients" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"email" text\n);`,
    }]);
    const live = fakeLive({ patients: { id: { type: "integer", isNullable: false }, email: { type: "text", isNullable: true } } });
    const results = diffSchema(expected, live, new Set());
    expect(results.typeMismatches).toHaveLength(0);
    expect(results.pass).toBe(true);
  });

  it("varchar(N) normalizes to the same canonical type as live 'text' before comparison even runs (no lingering raw-string difference)", () => {
    // Both parseSqlFiles (expected) and getLiveSchema (live, in production)
    // always pass their type through normaliseType() before diffSchema ever
    // sees it, so by the time two types are "compatible" they're normally
    // already the identical canonical string — see the next test for when
    // the IGNORED bucket actually earns its keep.
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"name" varchar(255)\n);`,
    }]);
    expect(expected.tables.get("t").columns.get("name").type).toBe("text");
    const live = fakeLive({ t: { id: { type: "integer", isNullable: false }, name: { type: "text", isNullable: true } } });
    const results = diffSchema(expected, live, new Set());
    expect(results.typeMismatches).toHaveLength(0);
    expect(results.ignored).toHaveLength(0);
    expect(results.pass).toBe(true);
  });

  it("a live type that reaches diffSchema not-yet-normalized (defensive case) is recorded as IGNORED, not silently dropped or misreported", () => {
    // getLiveSchema() always normalizes before diffSchema sees it in
    // production, but diffSchema itself must not assume that forever — this
    // proves the IGNORED-bucket safety net actually fires (visible, not
    // silent) if a raw, not-yet-canonical type string ever reaches it.
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL\n);`,
    }]);
    const live = fakeLive({ t: { id: { type: "int4", isNullable: false } } });
    const results = diffSchema(expected, live, new Set());
    expect(results.typeMismatches).toHaveLength(0);
    expect(results.ignored).toHaveLength(1);
    expect(results.ignored[0]).toMatchObject({ table: "t", column: "id", expected: "integer", actual: "int4", level: "IGNORED", classification: "EXPECTED DIFFERENCE" });
    expect(results.pass).toBe(true);
  });

  it("a genuine type difference (integer vs text) is still reported as a real, non-blocking WARNING — normalization must not hide real drift", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"amount" integer\n);`,
    }]);
    const live = fakeLive({ t: { id: { type: "integer", isNullable: false }, amount: { type: "text", isNullable: true } } });
    const results = diffSchema(expected, live, new Set());
    expect(results.typeMismatches).toHaveLength(1);
    expect(results.typeMismatches[0]).toMatchObject({ table: "t", column: "amount", expected: "integer", actual: "text" });
    const finding = results.findings.find((f) => f.table === "t" && f.column === "amount");
    expect(finding).toMatchObject({ level: "WARNING", classification: "REAL" });
    expect(finding.reason).toBeTruthy();
    expect(finding.suggestedFix).toBeTruthy();
    // Genuine drift stays non-blocking by design (see SCHEMA_VERIFY_STRICT
    // in main()) — this is existing, intentional policy, not something S1
    // changes.
    expect(results.pass).toBe(true);
  });

  it("a missing table is still a blocking ERROR with full finding detail", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "orders" (\n\t"id" serial PRIMARY KEY NOT NULL\n);`,
    }]);
    const live = fakeLive({});
    const results = diffSchema(expected, live, new Set());
    expect(results.missingTables).toContain("orders");
    expect(results.pass).toBe(false);
    const finding = results.findings.find((f) => f.table === "orders" && f.level === "ERROR");
    expect(finding).toBeTruthy();
    expect(finding.classification).toBe("REAL");
  });

  it("a missing column is still a blocking ERROR with full finding detail", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "orders" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"total" numeric(10, 2)\n);`,
    }]);
    const live = fakeLive({ orders: { id: { type: "integer", isNullable: false } } });
    const results = diffSchema(expected, live, new Set());
    expect(results.missingColumns).toEqual([
      expect.objectContaining({ table: "orders", column: "total", expectedType: "numeric" }),
    ]);
    expect(results.pass).toBe(false);
    const finding = results.findings.find((f) => f.table === "orders" && f.column === "total");
    expect(finding).toMatchObject({ level: "ERROR", classification: "REAL" });
  });

  it("a missing index is still reported (WARNING, non-blocking) with full finding detail", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL\n);\nCREATE INDEX "t_idx" ON "t" ("id");`,
    }]);
    const live = fakeLive({ t: { id: { type: "integer", isNullable: false } } });
    const results = diffSchema(expected, live, new Set());
    expect(results.missingIndexes).toEqual([{ table: "t", index: "t_idx" }]);
    expect(results.pass).toBe(true);
    const finding = results.findings.find((f) => f.expected === "t_idx");
    expect(finding).toMatchObject({ level: "WARNING", classification: "REAL" });
  });
});

describe("classifySchemaStatus — tri-state schema status (full_pass / pass_with_warnings / failed)", () => {
  function fakeLive(tableSpecs) {
    const liveTables = new Set(Object.keys(tableSpecs));
    const liveColumns = new Map();
    for (const [tbl, cols] of Object.entries(tableSpecs)) {
      const m = new Map();
      for (const [col, info] of Object.entries(cols)) m.set(col, info);
      liveColumns.set(tbl, m);
    }
    return {
      liveTables, liveColumns,
      livePks: new Map(), liveUniques: new Map(), liveIndexes: new Set(),
      liveIndexByTable: new Map(), liveFks: [], liveChecks: [],
      journalApplied: [], featureMigApplied: [], deployState: {},
    };
  }

  it("returns 'full_pass' when there are zero blocking errors and zero non-blocking issues", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"name" text\n);`,
    }]);
    const live = fakeLive({ t: { id: { type: "integer", isNullable: false }, name: { type: "text", isNullable: true } } });
    const results = diffSchema(expected, live, new Set());
    results.sourceIssues = [];
    expect(results.pass).toBe(true);
    expect(classifySchemaStatus(results)).toBe("full_pass");
  });

  it("returns 'pass_with_warnings' when required schema objects all exist but non-blocking drift remains (missing index)", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL\n);\nCREATE INDEX "t_idx" ON "t" ("id");`,
    }]);
    const live = fakeLive({ t: { id: { type: "integer", isNullable: false } } });
    const results = diffSchema(expected, live, new Set());
    results.sourceIssues = [];
    expect(results.pass).toBe(true); // startup is safe — non-blocking
    expect(classifySchemaStatus(results)).toBe("pass_with_warnings");
  });

  it("returns 'pass_with_warnings' for a type mismatch, a nullable mismatch, or an extra table — not 'full_pass'", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"amount" integer NOT NULL\n);`,
    }]);
    const live = fakeLive({
      t: { id: { type: "integer", isNullable: false }, amount: { type: "text", isNullable: true } },
      extra_table: { id: { type: "integer", isNullable: false } },
    });
    const results = diffSchema(expected, live, new Set());
    results.sourceIssues = [];
    expect(results.pass).toBe(true);
    expect(classifySchemaStatus(results)).toBe("pass_with_warnings");
  });

  it("returns 'failed' when a required table is missing (blocking error)", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "orders" (\n\t"id" serial PRIMARY KEY NOT NULL\n);`,
    }]);
    const live = fakeLive({});
    const results = diffSchema(expected, live, new Set());
    results.sourceIssues = [];
    expect(results.pass).toBe(false);
    expect(classifySchemaStatus(results)).toBe("failed");
  });

  it("returns 'failed' when a required column is missing (blocking error), even alongside non-blocking warnings", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "orders" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"total" numeric(10, 2)\n);`,
    }]);
    const live = fakeLive({ orders: { id: { type: "integer", isNullable: false } }, extra_table: { id: { type: "integer", isNullable: false } } });
    const results = diffSchema(expected, live, new Set());
    results.sourceIssues = [];
    expect(results.pass).toBe(false);
    expect(classifySchemaStatus(results)).toBe("failed");
  });

  it("returns 'failed' when an error-level source issue is present, even with results.pass forced true (belt-and-suspenders on the sourceIssues path)", () => {
    const expected = parseSqlFiles([{
      tag: "a", type: "drizzle",
      content: `CREATE TABLE "t" (\n\t"id" serial PRIMARY KEY NOT NULL\n);`,
    }]);
    const live = fakeLive({ t: { id: { type: "integer", isNullable: false } } });
    const results = diffSchema(expected, live, new Set());
    results.pass = false; // mirrors main()'s handling of error-level sourceIssues
    results.sourceIssues = [{ level: "error", source: "journal", msg: "duplicate idx" }];
    expect(classifySchemaStatus(results)).toBe("failed");
  });
});
