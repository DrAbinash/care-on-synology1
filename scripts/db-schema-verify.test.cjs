import { describe, it, expect } from "vitest";
const fs = require("fs");
const path = require("path");
const { defaultLiteralForType, parseSqlFiles, diffSchema, loadJournal, extractRuntimeTableNames } = require("./db-schema-verify.cjs");

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
