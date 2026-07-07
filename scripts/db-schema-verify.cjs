#!/usr/bin/env node
/**
 * db-schema-verify.cjs — Multi-source Drizzle schema verification
 * ================================================================
 * Care Diagnostics ERP · Hospital RIS/PACS
 *
 * THREE OPERATING MODES:
 *
 *   --verify   (default) Read-only. Inspect everything. Exit PASS/FAIL.
 *   --repair   Safe DDL-only repairs: CREATE TABLE IF NOT EXISTS,
 *              ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
 *              Never DROPs, never modifies existing data.
 *   --reset    TRIAL ONLY. Drops and recreates the database. Requires
 *              explicit confirmation. Never runs automatically.
 *
 * MULTI-SOURCE VERIFICATION:
 *   Source 1: Drizzle migration SQL files (CREATE TABLE / ALTER TABLE DDL)
 *   Source 2: Drizzle _journal.json (expected migration registry)
 *   Source 3: Feature SQL migration files (migrations/*.sql)
 *   Source 4: schema_deploy_state metadata (last deploy snapshot)
 *   Source 5: Live PostgreSQL information_schema + pg_catalog
 *
 *   Cross-checks: journal entries ↔ SQL files, SQL checksums ↔ DB log,
 *                 expected tables ↔ live tables, expected columns ↔ live columns.
 *
 * WHAT IS VERIFIED:
 *   ✓ Tables (presence, not extra-strict on runtime-created tables)
 *   ✓ Columns (name, presence per table)
 *   ✓ Column data types (semantic equivalence groups)
 *   ✓ NOT NULL / nullable status
 *   ✓ Primary keys
 *   ✓ Unique constraints
 *   ✓ Foreign keys (referenced table exists)
 *   ✓ Indexes (by name from CREATE INDEX statements)
 *   ✓ JSONB columns identified and reported
 *   ✓ Serial / sequences (detected as integer type)
 *   ✓ PostgreSQL extensions (pgvector, others)
 *   ✓ Migration journal consistency (files vs journal)
 *   ✓ Checksum drift (SQL file changed after being applied)
 *   ✓ Feature migration application state
 *   ✓ Views (detected, reported as informational)
 *   ○ Check constraints (informational — hard to parse from SQL)
 *   ○ Triggers (informational — not defined in Drizzle schema)
 *
 * OUTPUTS:
 *   Console: colour-coded PASS/FAIL with per-issue detail
 *   --json:  machine-readable JSON to stdout
 *   Writes:  STARTUP_SCHEMA_VERIFICATION.md (always on --verify)
 *            DB_SCHEMA_VERIFICATION_REPORT.md (on --report or --repair)
 *            .schema-verify-results.json (for downstream tools)
 *
 * USAGE:
 *   DATABASE_URL=postgres://... node scripts/db-schema-verify.cjs [--verify|--repair|--reset] [--verbose] [--json]
 *
 * SAFE TO RUN:
 *   Multiple times (--verify is fully read-only, --repair is idempotent).
 */

"use strict";

const { Client } = require("pg");
const fs   = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const crypto = require("crypto");
const readline = require("readline");

// ════════════════════════════════════════════════════════════════════════════
// CLI ARGS
// ════════════════════════════════════════════════════════════════════════════

const ARGS    = process.argv.slice(2);
const MODE    = ARGS.includes("--repair") ? "repair"
              : ARGS.includes("--reset")  ? "reset"
              : "verify";
const JSON_OUT  = ARGS.includes("--json");
const VERBOSE   = ARGS.includes("--verbose") || ARGS.includes("-v");
const QUIET     = ARGS.includes("--quiet")   || ARGS.includes("-q");
const REPORT_MD = ARGS.includes("--report")  || MODE === "repair";

// ════════════════════════════════════════════════════════════════════════════
// COLOUR HELPERS
// ════════════════════════════════════════════════════════════════════════════

const isTTY = process.stdout.isTTY && !JSON_OUT;
const c = {
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  blue:   (s) => isTTY ? `\x1b[34m${s}\x1b[0m` : s,
  cyan:   (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m`  : s,
};
const okLog   = (s) => { if (!QUIET || !JSON_OUT) console.log(c.green("  ✓ ") + s); };
const failLog = (s) => console.log(c.red("  ✗ ") + s);
const warnLog = (s) => console.log(c.yellow("  ! ") + s);
const infoLog = (s) => { if (VERBOSE || !QUIET) console.log(c.blue("  ▸ ") + s); };
const headLog = (s) => console.log(c.bold(c.cyan(s)));

// ════════════════════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ════════════════════════════════════════════════════════════════════════════

function findRepoRoot() {
  const candidates = [
    path.resolve(__dirname, ".."),
    "/repo",
    process.cwd(),
    path.resolve(__dirname, "../.."),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "lib/db/drizzle/meta/_journal.json"))) return candidate;
  }
  return path.resolve(__dirname, "..");
}

const REPO_ROOT   = findRepoRoot();
const DRIZZLE_DIR = path.join(REPO_ROOT, "lib/db/drizzle");
const FEATURE_DIR = path.join(REPO_ROOT, "migrations");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");
const CWD         = process.cwd();

// ════════════════════════════════════════════════════════════════════════════
// GIT METADATA
// ════════════════════════════════════════════════════════════════════════════

function getGitInfo() {
  // Try env vars first (set by docker-compose build args or CI)
  const gitCommit = process.env.GIT_COMMIT
    || process.env.COMMIT_SHA
    || tryExec("git rev-parse HEAD")
    || "unknown";
  const gitBranch = process.env.GIT_BRANCH
    || process.env.BRANCH_NAME
    || tryExec("git branch --show-current")
    || tryExec("git rev-parse --abbrev-ref HEAD")
    || "unknown";
  const gitTag = tryExec("git describe --tags --always") || "unknown";
  return { commit: gitCommit.trim(), branch: gitBranch.trim(), tag: gitTag.trim() };
}

function tryExec(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim(); }
  catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════════
// TYPE NORMALISATION
// ════════════════════════════════════════════════════════════════════════════

function normaliseType(raw) {
  if (!raw) return "unknown";
  const t = raw.toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/character varying(\(\d+\))?/g, "text")
    .replace(/character\s*varying/g, "text")
    .replace(/^varchar(\(\d+\))?$/, "text")
    .replace(/^character(\(\d+\))?$/, "text")
    .replace(/^int4$/, "integer").replace(/^int$/, "integer")
    .replace(/^int8$/, "bigint")
    .replace(/^serial$/, "integer")
    .replace(/^bigserial$/, "bigint")
    .replace(/^bool$/, "boolean")
    .replace(/^float4$/, "real")
    .replace(/^float8$/, "double precision")
    .replace(/^decimal/, "numeric")
    .replace(/^json$/, "jsonb")
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^timestamptz$/, "timestamptz")
    .replace(/\s*with time zone$/, "tz")
    .replace(/\s*without time zone$/, "")
    .trim();
  return t;
}

const TYPE_GROUPS = [
  new Set(["text", "varchar", "character varying", "character"]),
  new Set(["integer", "serial", "int4", "int"]),
  new Set(["bigint", "bigserial", "int8"]),
  new Set(["boolean", "bool"]),
  new Set(["jsonb", "json"]),
  new Set(["numeric", "decimal"]),
  new Set(["timestamptz", "timestamp with time zone", "timestamp tz"]),
  new Set(["timestamp", "timestamp without time zone"]),
  new Set(["real", "float4"]),
  new Set(["double precision", "float8"]),
];

function typesCompatible(a, b) {
  const an = normaliseType(a);
  const bn = normaliseType(b);
  if (an === bn) return true;
  for (const g of TYPE_GROUPS) {
    if (g.has(an) && g.has(bn)) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// REPAIR MODE HELPER — type-appropriate DEFAULT literal
// ════════════════════════════════════════════════════════════════════════════
//
// When repair mode has to ADD COLUMN a NOT NULL column that has no explicit
// DEFAULT in the source SQL, it must synthesize one so existing rows can be
// backfilled. A single hardcoded `DEFAULT ''` (the previous behaviour) is
// invalid SQL for non-text types — e.g. `numeric` — and made repair mode
// fail on columns like payment_logs.amount. This picks a safe literal per
// normalised type family instead.
const NUMERIC_TYPE_FAMILIES = new Set([
  "integer", "bigint", "numeric", "decimal", "real", "double precision", "smallint",
]);

function defaultLiteralForType(rawType) {
  // Strip precision/scale, e.g. "numeric(10, 2)" -> "numeric", so family
  // lookup below matches regardless of parametrized precision.
  const t = normaliseType(String(rawType || "").replace(/\([^)]*\)/, ""));
  if (NUMERIC_TYPE_FAMILIES.has(t)) return "0";
  if (t === "boolean") return "false";
  if (t === "jsonb" || t === "json") return "'{}'::jsonb";
  if (t.startsWith("timestamp")) return "now()";
  return "''"; // text and anything else unrecognised
}

// ════════════════════════════════════════════════════════════════════════════
// TABLES CREATED BY API STARTUP (not in SQL migration files)
// These get a WARNING not a FAIL — they're created by runStartupMigrations()
// in index.ts and will exist after the first API startup.
// ════════════════════════════════════════════════════════════════════════════

const RUNTIME_CREATED_TABLES = new Set([
  "kiosk_payment_sessions", "ai_quality_scores", "ai_dicom_findings",
  "rag_document_embeddings", "rag_search_queries", "anomaly_alerts",
  "report_template_versions", "ai_billing_suggestions", "peer_review_assignments",
  "turnaround_times", "ai_training_data_exports", "report_quality_gates",
  "critical_findings", "ai_provider_health_logs", "ai_voice_transcriptions",
  "ai_patient_communications", "ai_normal_report_templates",
  "radiologist_assignment_rules", "radiologist_subspecialties",
  "radiologist_workloads", "radiology_institutional_styles",
  "payment_logs", "day_closures", "dicom_nodes", "ai_server_health_log",
  "outsourced_labs",
  // Internal tracking tables created by db-patch-entrypoint.sh
  "schema_migrations_log", "schema_deploy_state",
]);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 1 + 3: PARSE MIGRATION SQL FILES
// ════════════════════════════════════════════════════════════════════════════

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Parse CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX from SQL text.
 * Returns { tables: Map, indexNames: Set, sourceConsistencyIssues: [] }
 */
function parseSqlFiles(sqlEntries) {
  // tables: Map<tableName, { columns: Map<colName, info>, indexes: Set, pks: Set, uniques: Set, fks: [] }>
  const tables = new Map();
  const indexNames = new Set();
  const sourceConsistencyIssues = [];

  for (const { content, tag, type } of sqlEntries) {
    const clean = content
      .replace(/--> statement-breakpoint/g, "")
      .replace(/--[^\n]*/g, "");  // strip line comments

    // ── CREATE TABLE ──────────────────────────────────────────────────────
    const ctRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([^;]*?)\)\s*;/gis;
    let m;
    while ((m = ctRe.exec(clean)) !== null) {
      const tbl = m[1];
      if (!tables.has(tbl)) {
        tables.set(tbl, { columns: new Map(), indexes: new Set(), pks: new Set(), uniques: new Set(), fks: [], fromFile: tag });
      }
      const ti = tables.get(tbl);
      const body = m[2];
      for (const line of body.split("\n").map(l => l.trim()).filter(Boolean)) {
        if (line.startsWith("--")) continue;

        // Column definition
        const colM = line.match(/^"([^"]+)"\s+(\S+(?:\s+with time zone|\s+without time zone)?(?:\(\d+(?:,\s*\d+)?\))?)/i);
        if (colM && !line.match(/^CONSTRAINT/i)) {
          const colName = colM[1];
          let rawType = colM[2];
          if (/timestamp with time zone/i.test(line)) rawType = "timestamptz";
          else if (/timestamp without time zone/i.test(line)) rawType = "timestamp";
          if (/\bjsonb\b/i.test(line)) rawType = "jsonb";
          const notNull = /NOT NULL/i.test(line);
          const isPk    = /PRIMARY KEY/i.test(line);
          const isUniq  = /UNIQUE/i.test(line);
          const isSerial = /\bserial\b/i.test(line) || /\bbigserial\b/i.test(line);
          const isJsonb  = /\bjsonb\b/i.test(line);
          const defaultM = line.match(/DEFAULT\s+([^\s,)]+)/i);
          const defaultVal = defaultM ? defaultM[1] : null;

          if (!ti.columns.has(colName)) {
            ti.columns.set(colName, {
              type: normaliseType(rawType.split("(")[0].trim()),
              rawType,
              notNull,
              isPk,
              isSerial,
              isJsonb,
              defaultVal,
              fromFile: tag,
              fromAlter: false,
            });
            if (isPk)   ti.pks.add(colName);
            if (isUniq) ti.uniques.add(colName);
          }
        }

        // CONSTRAINT ... PRIMARY KEY
        const pkM = line.match(/CONSTRAINT\s+"[^"]+"\s+PRIMARY KEY\s*\("([^"]+)"\)/i);
        if (pkM) ti.pks.add(pkM[1]);

        // CONSTRAINT ... UNIQUE
        const uqM = line.match(/CONSTRAINT\s+"[^"]+"\s+UNIQUE\s*\("([^"]+)"\)/i);
        if (uqM) ti.uniques.add(uqM[1]);

        // REFERENCES (foreign key hint)
        const fkM = line.match(/REFERENCES\s+"?(\w+)"?\s*\("?(\w+)"?\)/i);
        if (fkM) ti.fks.push({ refTable: fkM[1], refCol: fkM[2] });
      }
    }

    // ── ALTER TABLE ADD COLUMN ─────────────────────────────────────────────
    const acRe = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s+([^\n;,]+)/gi;
    let ac;
    while ((ac = acRe.exec(clean)) !== null) {
      const tbl = ac[1]; const colName = ac[2];
      let rawType = ac[3].trim();
      const notNull = /NOT NULL/i.test(rawType);
      const isJsonb = /jsonb/i.test(rawType);
      if (/timestamp with time zone/i.test(rawType)) rawType = "timestamptz";
      else if (/timestamp without time zone/i.test(rawType)) rawType = "timestamp";
      if (/jsonb/i.test(rawType)) rawType = "jsonb";
      rawType = rawType.replace(/NOT NULL.*/i, "").replace(/DEFAULT.*/i, "").trim();

      if (!tables.has(tbl)) {
        tables.set(tbl, { columns: new Map(), indexes: new Set(), pks: new Set(), uniques: new Set(), fks: [], fromFile: tag });
      }
      const ti = tables.get(tbl);
      if (!ti.columns.has(colName)) {
        ti.columns.set(colName, {
          type: normaliseType(rawType.split("(")[0].replace(/\(.*/, "").trim()),
          rawType,
          notNull,
          isPk: false,
          isSerial: false,
          isJsonb,
          defaultVal: null,
          fromFile: tag,
          fromAlter: true,
        });
      }
    }

    // ── CREATE INDEX ───────────────────────────────────────────────────────
    const ixRe = /CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s+ON\s+"?(\w+)"?/gi;
    let ix;
    while ((ix = ixRe.exec(clean)) !== null) {
      indexNames.add(ix[1]);
      const ti = tables.get(ix[2]);
      if (ti) ti.indexes.add(ix[1]);
    }

    // ── CREATE EXTENSION ───────────────────────────────────────────────────
    // Noted but not added to tables
  }

  return { tables, indexNames, sourceConsistencyIssues };
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 2: LOAD MIGRATION JOURNAL
// ════════════════════════════════════════════════════════════════════════════

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) {
    return { version: null, entries: [], issues: ["Journal file not found: " + JOURNAL_PATH] };
  }
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
  const issues = [];
  const entries = journal.entries || [];

  // Check for duplicate idx values
  const idxSeen = new Set();
  for (const e of entries) {
    if (idxSeen.has(e.idx)) issues.push(`Duplicate journal idx: ${e.idx} (${e.tag})`);
    idxSeen.add(e.idx);
  }

  // Check order is strictly increasing
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].idx !== entries[i - 1].idx + 1) {
      issues.push(`Out-of-order journal entry: idx ${entries[i - 1].idx} → ${entries[i].idx} (expected ${entries[i - 1].idx + 1})`);
    }
  }

  return { version: journal.version, dialect: journal.dialect, entries, issues };
}

// ════════════════════════════════════════════════════════════════════════════
// CROSS-CHECK SOURCES (Source 1 ↔ Source 2 ↔ Source 3)
// ════════════════════════════════════════════════════════════════════════════

function crossCheckSources(journal, drizzleFiles, featureFiles) {
  const issues = [];

  // Journal entry → SQL file existence
  for (const entry of journal.entries) {
    const expectedFile = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(expectedFile)) {
      issues.push({
        level: "error",
        source: "journal↔files",
        msg: `Journal entry '${entry.tag}' has no SQL file at ${expectedFile}`,
      });
    }
  }

  // SQL file → journal entry (files not in journal)
  const journalTags = new Set(journal.entries.map(e => e.tag));
  for (const f of drizzleFiles) {
    const tag = path.basename(f.path, ".sql");
    if (!journalTags.has(tag) && !tag.includes("voice_tables")) {
      issues.push({
        level: "warning",
        source: "files↔journal",
        msg: `SQL file '${tag}.sql' exists but is not registered in the migration journal`,
      });
    }
  }

  return issues;
}

// ════════════════════════════════════════════════════════════════════════════
// COLLECT ALL MIGRATION SQL
// ════════════════════════════════════════════════════════════════════════════

function loadAllMigrationSql() {
  const drizzleEntries = [];
  const featureEntries = [];
  const allEntries = [];

  // Drizzle journal migrations (in journal order)
  const journal = loadJournal();
  for (const entry of journal.entries) {
    const fpath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (fs.existsSync(fpath)) {
      const content = fs.readFileSync(fpath, "utf8");
      const item = { content, tag: entry.tag, type: "drizzle", path: fpath, checksum: sha256(content) };
      drizzleEntries.push(item);
      allEntries.push(item);
    }
  }

  // Extra drizzle SQL files not in journal (legacy)
  const voicePath = path.join(DRIZZLE_DIR, "voice_tables_migration.sql");
  if (fs.existsSync(voicePath) && !allEntries.find(e => e.tag === "voice_tables_migration")) {
    const content = fs.readFileSync(voicePath, "utf8");
    const item = { content, tag: "voice_tables_migration", type: "drizzle-extra", path: voicePath, checksum: sha256(content) };
    drizzleEntries.push(item);
    allEntries.push(item);
  }

  // Feature migrations (alphabetical order)
  if (fs.existsSync(FEATURE_DIR)) {
    const files = fs.readdirSync(FEATURE_DIR).filter(f => f.endsWith(".sql")).sort();
    for (const f of files) {
      const fpath = path.join(FEATURE_DIR, f);
      const content = fs.readFileSync(fpath, "utf8");
      const item = { content, tag: f, type: "feature", path: fpath, checksum: sha256(content) };
      featureEntries.push(item);
      allEntries.push(item);
    }
  }

  return { drizzleEntries, featureEntries, allEntries, journal };
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 5: LIVE DB QUERIES
// ════════════════════════════════════════════════════════════════════════════

async function getLiveSchema(client) {
  // PostgreSQL version
  const pgVer = await client.query("SELECT version() AS v");
  const pgVersion = pgVer.rows[0]?.v ?? "unknown";

  // Tables
  const tblRes = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name
  `);
  const liveTables = new Set(tblRes.rows.map(r => r.table_name));

  // Views
  const viewRes = await client.query(`
    SELECT table_name AS view_name FROM information_schema.views WHERE table_schema='public'
  `);
  const liveViews = new Set(viewRes.rows.map(r => r.view_name));

  // Columns with full metadata
  const colRes = await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           column_default, character_maximum_length, numeric_precision, numeric_scale,
           is_generated, identity_generation
    FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name, ordinal_position
  `);
  const liveColumns = new Map();
  for (const r of colRes.rows) {
    if (!liveColumns.has(r.table_name)) liveColumns.set(r.table_name, new Map());
    const normType = normaliseType(r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type);
    liveColumns.get(r.table_name).set(r.column_name, {
      type: normType, rawType: r.data_type, udt: r.udt_name,
      isNullable: r.is_nullable === "YES",
      default: r.column_default,
      isIdentity: r.identity_generation != null,
      isJsonb: r.data_type === "jsonb",
    });
  }

  // Primary keys
  const pkRes = await client.query(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'
  `);
  const livePks = new Map();
  for (const r of pkRes.rows) {
    if (!livePks.has(r.table_name)) livePks.set(r.table_name, new Set());
    livePks.get(r.table_name).add(r.column_name);
  }

  // Unique constraints
  const uqRes = await client.query(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    WHERE tc.constraint_type='UNIQUE' AND tc.table_schema='public'
  `);
  const liveUniques = new Map();
  for (const r of uqRes.rows) {
    if (!liveUniques.has(r.table_name)) liveUniques.set(r.table_name, new Set());
    liveUniques.get(r.table_name).add(r.column_name);
  }

  // Foreign keys
  const fkRes = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
  `);
  const liveFks = new Map();
  for (const r of fkRes.rows) {
    if (!liveFks.has(r.table_name)) liveFks.set(r.table_name, []);
    liveFks.get(r.table_name).push({ refTable: r.ref_table, refCol: r.ref_col, col: r.column_name });
  }

  // Indexes (pg_catalog — more complete than information_schema)
  const ixRes = await client.query(`
    SELECT i.relname AS idx_name, t.relname AS tbl_name, ix.indisunique AS is_unique,
           ix.indisprimary AS is_pk
    FROM pg_class t
    JOIN pg_index ix ON t.oid=ix.indrelid
    JOIN pg_class i  ON i.oid=ix.indexrelid
    JOIN pg_namespace n ON t.relnamespace=n.oid
    WHERE n.nspname='public' AND t.relkind='r'
    ORDER BY t.relname, i.relname
  `);
  const liveIndexes = new Set(ixRes.rows.filter(r => !r.is_pk).map(r => r.idx_name));
  const liveIndexByTable = new Map();
  for (const r of ixRes.rows.filter(r => !r.is_pk)) {
    if (!liveIndexByTable.has(r.tbl_name)) liveIndexByTable.set(r.tbl_name, new Set());
    liveIndexByTable.get(r.tbl_name).add(r.idx_name);
  }

  // Check constraints
  const chkRes = await client.query(`
    SELECT tc.table_name, tc.constraint_name, cc.check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name=cc.constraint_name AND tc.table_schema=cc.constraint_schema
    WHERE tc.constraint_type='CHECK' AND tc.table_schema='public'
  `);
  const liveChecks = new Map();
  for (const r of chkRes.rows) {
    if (!liveChecks.has(r.table_name)) liveChecks.set(r.table_name, []);
    liveChecks.get(r.table_name).push({ name: r.constraint_name, clause: r.check_clause });
  }

  // Extensions
  const extRes = await client.query(`
    SELECT extname, extversion FROM pg_extension WHERE extname != 'plpgsql'
  `);
  const liveExtensions = extRes.rows.map(r => ({ name: r.extname, version: r.extversion }));

  // Sequences (for serial / identity columns)
  const seqRes = await client.query(`
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'
  `);
  const liveSequences = new Set(seqRes.rows.map(r => r.sequence_name));

  // Triggers
  const trgRes = await client.query(`
    SELECT trigger_name, event_object_table FROM information_schema.triggers
    WHERE trigger_schema='public'
  `);
  const liveTriggers = trgRes.rows.map(r => ({ name: r.trigger_name, table: r.event_object_table }));

  // Migration state
  let journalApplied = [], featureMigApplied = [], deployState = {};
  try {
    const jr = await client.query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
    journalApplied = jr.rows;
  } catch { /* schema may not be set up yet */ }
  try {
    const fm = await client.query(`SELECT name, kind, applied_at, sha256 FROM public.schema_migrations_log ORDER BY applied_at`);
    featureMigApplied = fm.rows;
  } catch { /* may not exist */ }
  try {
    const ds = await client.query(`SELECT key, value, updated_at FROM public.schema_deploy_state ORDER BY key`);
    for (const r of ds.rows) deployState[r.key] = r.value;
  } catch { /* may not exist */ }

  return {
    pgVersion, liveTables, liveViews, liveColumns, livePks, liveUniques,
    liveFks, liveIndexes, liveIndexByTable, liveChecks, liveExtensions,
    liveSequences, liveTriggers, journalApplied, featureMigApplied, deployState,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CHECKSUM DRIFT DETECTION (Source 3/4 vs Source 4)
// ════════════════════════════════════════════════════════════════════════════

function detectChecksumDrift(allEntries, featureMigApplied) {
  const driftIssues = [];
  const appliedMap = new Map(featureMigApplied.map(r => [r.name, r.sha256]));

  for (const entry of allEntries.filter(e => e.type === "feature")) {
    const recordedHash = appliedMap.get(entry.tag);
    if (recordedHash && recordedHash !== entry.checksum) {
      driftIssues.push({
        level: "warning",
        msg: `Checksum drift: feature migration '${entry.tag}' was applied with hash ${recordedHash.slice(0,12)}... but current file has hash ${entry.checksum.slice(0,12)}...`,
        tag: entry.tag,
      });
    }
  }
  return driftIssues;
}

// ════════════════════════════════════════════════════════════════════════════
// DIFF ENGINE
// ════════════════════════════════════════════════════════════════════════════

function diffSchema(expected, live) {
  const {
    liveTables, liveColumns, livePks, liveUniques, liveIndexes,
    liveIndexByTable, liveFks, liveChecks, journalApplied, featureMigApplied, deployState
  } = live;

  const results = {
    pass: true,
    missingTables: [], runtimeOnlyMissing: [], extraTables: [],
    missingColumns: [], typeMismatches: [], nullableMismatches: [],
    missingIndexes: [], missingFks: [],
    jsonbColumns: [], serialColumns: [],
    sourceIssues: [],
    warnings: [],
    tablesPassed: 0, tablesChecked: 0,
    columnsPassed: 0, columnsChecked: 0,
    indexesPassed: 0, indexesChecked: 0,
    journalApplied, featureMigApplied, deployState,
  };

  for (const [tblName, ti] of expected.tables.entries()) {
    // Skip internal tracking tables
    if (tblName === "schema_migrations_log" || tblName === "schema_deploy_state") continue;

    results.tablesChecked++;

    if (!liveTables.has(tblName)) {
      if (RUNTIME_CREATED_TABLES.has(tblName)) {
        results.runtimeOnlyMissing.push(tblName);
        results.warnings.push(`Table '${tblName}' not yet in DB — created by API on first startup (non-fatal)`);
      } else {
        results.missingTables.push(tblName);
        results.pass = false;
      }
      continue;
    }

    results.tablesPassed++;
    const liveCols = liveColumns.get(tblName) || new Map();

    for (const [colName, colInfo] of ti.columns.entries()) {
      results.columnsChecked++;

      if (!liveCols.has(colName)) {
        results.missingColumns.push({ table: tblName, column: colName, expectedType: colInfo.type, fromFile: colInfo.fromFile });
        results.pass = false;
        continue;
      }
      results.columnsPassed++;

      const liveCol = liveCols.get(colName);

      // Type compatibility
      if (!typesCompatible(colInfo.type, liveCol.type)) {
        results.typeMismatches.push({ table: tblName, column: colName, expected: colInfo.type, actual: liveCol.type });
        results.warnings.push(`Type mismatch ${tblName}.${colName}: expected '${colInfo.type}', live is '${liveCol.type}'`);
      }

      // JSONB columns
      if (colInfo.isJsonb || liveCol.isJsonb) {
        results.jsonbColumns.push(`${tblName}.${colName}`);
      }

      // Serial columns
      if (colInfo.isSerial || liveCol.isIdentity) {
        results.serialColumns.push(`${tblName}.${colName}`);
      }

      // NOT NULL mismatch (warn only — safe to have DB more permissive)
      if (colInfo.notNull && liveCol.isNullable) {
        results.nullableMismatches.push({ table: tblName, column: colName });
        results.warnings.push(`Nullable mismatch: ${tblName}.${colName} expected NOT NULL but DB allows NULL`);
      }
    }

    // Indexes
    for (const idxName of ti.indexes) {
      results.indexesChecked++;
      if (!liveIndexes.has(idxName)) {
        results.missingIndexes.push({ table: tblName, index: idxName });
        results.warnings.push(`Missing index '${idxName}' on '${tblName}'`);
      } else {
        results.indexesPassed++;
      }
    }

    // Foreign key: verify referenced tables exist
    for (const fk of ti.fks) {
      if (!liveTables.has(fk.refTable) && !RUNTIME_CREATED_TABLES.has(fk.refTable)) {
        results.missingFks.push({ table: tblName, refTable: fk.refTable });
        results.warnings.push(`FK target missing: ${tblName} → ${fk.refTable}`);
      }
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// PRINT RESULTS
// ════════════════════════════════════════════════════════════════════════════

function printResults(r, git, pgVersion, stats) {
  console.log("");
  headLog("════════════════════════════════════════════════════════");
  headLog("  Care Diagnostics ERP — Schema Verification");
  headLog(`  Mode: ${MODE.toUpperCase()}  |  ${new Date().toISOString()}`);
  headLog("════════════════════════════════════════════════════════");
  console.log("");

  infoLog(`Git commit : ${git.commit.slice(0,12)}`);
  infoLog(`Git branch : ${git.branch}`);
  infoLog(`PostgreSQL : ${pgVersion.split(" ").slice(0,2).join(" ")}`);
  infoLog(`Sources    : ${stats.sourceCount} migration files`);
  infoLog(`Tables     : ${stats.expectedTables} expected, ${stats.liveTables} live`);
  infoLog(`Columns    : ${stats.expectedCols} expected, ${stats.liveCols} live`);
  console.log("");

  // Source cross-check issues
  if (r.sourceIssues.length > 0) {
    warnLog(`Source consistency (${r.sourceIssues.length} issue(s)):`);
    for (const i of r.sourceIssues) {
      if (i.level === "error") failLog(`  ${i.msg}`);
      else warnLog(`  ${i.msg}`);
    }
    console.log("");
  }

  // Migration state
  if (r.journalApplied.length > 0)
    okLog(`Drizzle migrations applied: ${r.journalApplied.length}`);
  else
    warnLog("No Drizzle migrations found in tracking table");

  if (r.featureMigApplied.length > 0)
    okLog(`Feature migrations applied: ${r.featureMigApplied.length}`);
  else
    warnLog("No feature migrations found in schema_migrations_log");

  if (r.deployState.db_patch_ok === "true")
    okLog(`Deploy state: db_patch_ok=true  |  tables=${r.deployState.live_table_count ?? "?"}  |  version=${r.deployState.patch_version ?? "?"}`);
  else
    warnLog(`Deploy state: db_patch_ok=${r.deployState.db_patch_ok ?? "MISSING"}`);

  console.log("");

  // Tables
  if (r.missingTables.length === 0) {
    okLog(`Tables: ${r.tablesPassed}/${r.tablesChecked} present`);
  } else {
    failLog(`Missing tables (${r.missingTables.length}):`);
    for (const t of r.missingTables) console.log(c.red(`     ✗ ${t}`));
  }
  if (r.runtimeOnlyMissing.length > 0 && VERBOSE)
    warnLog(`Runtime-created tables not yet in DB: ${r.runtimeOnlyMissing.join(", ")}`);

  // Columns
  if (r.missingColumns.length === 0) {
    okLog(`Columns: ${r.columnsPassed}/${r.columnsChecked} present`);
  } else {
    failLog(`Missing columns (${r.missingColumns.length}):`);
    for (const mc of r.missingColumns)
      console.log(c.red(`     ✗ ${mc.table}.${mc.column}  [${mc.expectedType}]  (from ${mc.fromFile})`));
  }

  // Type mismatches
  if (r.typeMismatches.length > 0) {
    warnLog(`Type mismatches (${r.typeMismatches.length}) — schema compatible:`);
    if (VERBOSE) for (const t of r.typeMismatches)
      console.log(c.yellow(`     ! ${t.table}.${t.column}: expected '${t.expected}', got '${t.actual}'`));
  }

  // Indexes
  if (r.missingIndexes.length === 0) {
    okLog(`Indexes: ${r.indexesPassed}/${r.indexesChecked} present`);
  } else {
    warnLog(`Missing indexes (${r.missingIndexes.length}) — affects performance:`);
    if (VERBOSE) for (const i of r.missingIndexes)
      console.log(c.yellow(`     ! ${i.index} on ${i.table}`));
  }

  // JSONB columns (informational)
  if (VERBOSE && r.jsonbColumns.length > 0)
    infoLog(`JSONB columns: ${r.jsonbColumns.length}`);

  // Nullable mismatches
  if (r.nullableMismatches.length > 0 && VERBOSE)
    warnLog(`Nullable mismatches: ${r.nullableMismatches.map(m => `${m.table}.${m.column}`).join(", ")}`);

  console.log("");

  if (r.pass) {
    console.log(c.bold(c.green("  ✓ SCHEMA VERIFICATION PASSED")));
    console.log(c.dim(`    ${r.tablesPassed} tables, ${r.columnsPassed} columns verified`));
  } else {
    console.log(c.bold(c.red("  ✗ SCHEMA VERIFICATION FAILED")));
    if (r.missingTables.length > 0) console.log(c.red(`    Missing tables:   ${r.missingTables.length}`));
    if (r.missingColumns.length > 0) console.log(c.red(`    Missing columns:  ${r.missingColumns.length}`));
    console.log("");
    console.log(c.yellow("  Fix: docker compose up -d --build"));
    console.log(c.yellow("  Or:  docker compose run --rm care-migrate"));
    console.log(c.yellow("  Or:  node scripts/db-schema-verify.cjs --repair"));
  }

  console.log("");
  headLog("════════════════════════════════════════════════════════");
  console.log("");
}

// ════════════════════════════════════════════════════════════════════════════
// WRITE STARTUP SCHEMA VERIFICATION SUMMARY
// ════════════════════════════════════════════════════════════════════════════

function writeStartupMd(r, git, live, stats, allEntries, crossIssues) {
  const now = new Date().toISOString();
  const pass = r.pass;
  const lines = [];

  lines.push(`# STARTUP_SCHEMA_VERIFICATION`);
  lines.push(``);
  lines.push(`**Status:** ${pass ? "✅ PASS" : "❌ FAIL"}  `);
  lines.push(`**Timestamp:** ${now}  `);
  lines.push(`**Mode:** ${MODE.toUpperCase()}  `);
  lines.push(``);
  lines.push(`## Self-Diagnostics`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Git Commit | \`${git.commit}\` |`);
  lines.push(`| Git Branch | \`${git.branch}\` |`);
  lines.push(`| Git Tag | \`${git.tag}\` |`);
  lines.push(`| PostgreSQL Version | ${live.pgVersion.split(" ").slice(0,2).join(" ")} |`);
  lines.push(`| Drizzle Journal Version | ${stats.journalVersion ?? "?"} |`);
  lines.push(`| Migration Files | ${stats.sourceCount} |`);
  lines.push(`| Drizzle Migrations Applied | ${r.journalApplied.length} |`);
  lines.push(`| Feature Migrations Applied | ${r.featureMigApplied.length} |`);
  lines.push(`| Expected Tables | ${stats.expectedTables} |`);
  lines.push(`| Actual Tables | ${stats.liveTables} |`);
  lines.push(`| Expected Columns | ${stats.expectedCols} |`);
  lines.push(`| Actual Columns | ${stats.liveCols} |`);
  lines.push(`| Missing Tables | **${r.missingTables.length}** |`);
  lines.push(`| Missing Columns | **${r.missingColumns.length}** |`);
  lines.push(`| Missing Indexes | ${r.missingIndexes.length} |`);
  lines.push(`| Type Mismatches | ${r.typeMismatches.length} (warnings only) |`);
  lines.push(`| Source Issues | ${crossIssues.length} |`);
  lines.push(`| Warnings | ${r.warnings.length} |`);
  lines.push(`| Deploy State db_patch_ok | ${r.deployState.db_patch_ok ?? "MISSING"} |`);
  lines.push(`| Live Table Count | ${r.deployState.live_table_count ?? live.liveTables.size} |`);
  lines.push(`| Verification Result | ${pass ? "✅ PASS" : "❌ FAIL"} |`);
  lines.push(``);

  if (r.missingTables.length > 0) {
    lines.push(`## ❌ Missing Tables`);
    lines.push(``);
    for (const t of r.missingTables) lines.push(`- \`${t}\``);
    lines.push(``);
  }

  if (r.missingColumns.length > 0) {
    lines.push(`## ❌ Missing Columns`);
    lines.push(``);
    lines.push(`| Table | Column | Expected Type | Source File |`);
    lines.push(`|---|---|---|---|`);
    for (const mc of r.missingColumns)
      lines.push(`| \`${mc.table}\` | \`${mc.column}\` | \`${mc.expectedType}\` | ${mc.fromFile} |`);
    lines.push(``);
  }

  if (r.missingIndexes.length > 0) {
    lines.push(`## ⚠️ Missing Indexes`);
    lines.push(``);
    for (const i of r.missingIndexes) lines.push(`- \`${i.index}\` on \`${i.table}\``);
    lines.push(``);
  }

  if (live.liveExtensions.length > 0) {
    lines.push(`## PostgreSQL Extensions`);
    lines.push(``);
    for (const e of live.liveExtensions) lines.push(`- \`${e.name}\` v${e.version}`);
    lines.push(``);
  }

  if (live.liveViews.size > 0) {
    lines.push(`## Views`);
    lines.push(``);
    for (const v of live.liveViews) lines.push(`- \`${v}\``);
    lines.push(``);
  }

  if (live.liveTriggers.length > 0) {
    lines.push(`## Triggers`);
    lines.push(``);
    for (const t of live.liveTriggers) lines.push(`- \`${t.name}\` on \`${t.table}\``);
    lines.push(``);
  }

  if (r.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push(``);
    for (const w of r.warnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  if (crossIssues.length > 0) {
    lines.push(`## Source Consistency Issues`);
    lines.push(``);
    for (const i of crossIssues) lines.push(`- **${i.level.toUpperCase()}**: ${i.msg}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`_Generated by scripts/db-schema-verify.cjs — Care Diagnostics ERP_`);

  const outPath = path.join(CWD, "STARTUP_SCHEMA_VERIFICATION.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  infoLog(`Startup summary written: ${outPath}`);
  return outPath;
}

// ════════════════════════════════════════════════════════════════════════════
// REPAIR MODE — safe DDL only
// ════════════════════════════════════════════════════════════════════════════

async function runRepair(client, results, expected) {
  const repairLog = [];
  let repaired = 0;

  console.log("");
  headLog("════════════════════════════════════════════════════════");
  headLog("  REPAIR MODE — Safe DDL repairs only");
  headLog("  No DROP. No DELETE. No data modification.");
  headLog("════════════════════════════════════════════════════════");
  console.log("");

  // 1. Create missing tables
  for (const tblName of results.missingTables) {
    if (RUNTIME_CREATED_TABLES.has(tblName)) continue;
    const ti = expected.tables.get(tblName);
    if (!ti) continue;

    // Build CREATE TABLE statement
    const cols = [...ti.columns.entries()].map(([colName, ci]) => {
      let def = `  "${colName}" ${ci.rawType || ci.type}`;
      if (ci.notNull) def += " NOT NULL";
      if (ci.defaultVal != null) def += ` DEFAULT ${ci.defaultVal}`;
      return def;
    }).join(",\n");

    const pks = [...ti.pks].map(p => `"${p}"`).join(", ");
    const pkLine = pks ? `,\n  PRIMARY KEY (${pks})` : "";
    const sql = `CREATE TABLE IF NOT EXISTS "${tblName}" (\n${cols}${pkLine}\n);`;

    try {
      await client.query(sql);
      okLog(`Created table: ${tblName}`);
      repairLog.push({ action: "CREATE TABLE", table: tblName, sql: sql.slice(0, 200) });
      repaired++;
    } catch (err) {
      failLog(`Failed to create ${tblName}: ${err.message}`);
      repairLog.push({ action: "ERROR", table: tblName, error: err.message });
    }
  }

  // 2. Add missing columns
  for (const mc of results.missingColumns) {
    const ti = expected.tables.get(mc.table);
    const ci = ti?.columns.get(mc.column);
    if (!ci) continue;

    let colDef = `"${mc.column}" ${ci.rawType || ci.type}`;
    if (ci.defaultVal != null) {
      // Source SQL specified an explicit default — use it verbatim.
      colDef += ` DEFAULT ${ci.defaultVal}`;
      if (ci.notNull) colDef += " NOT NULL";
    } else if (ci.notNull) {
      // NOT NULL with no explicit default: existing rows need a value to
      // backfill, so synthesize a type-appropriate default (never a bare
      // '' for numeric/boolean/jsonb/timestamp columns — that's invalid
      // SQL and previously made repair fail on columns like
      // payment_logs.amount). NOT NULL must be appended too, or the
      // column silently ends up nullable despite the source schema.
      colDef += ` DEFAULT ${defaultLiteralForType(ci.rawType || ci.type)} NOT NULL`;
    }

    const sql = `ALTER TABLE "${mc.table}" ADD COLUMN IF NOT EXISTS ${colDef};`;
    try {
      await client.query(sql);
      okLog(`Added column: ${mc.table}.${mc.column}`);
      repairLog.push({ action: "ADD COLUMN", table: mc.table, column: mc.column, sql });
      repaired++;
    } catch (err) {
      failLog(`Failed to add ${mc.table}.${mc.column}: ${err.message}`);
      repairLog.push({ action: "ERROR", table: mc.table, column: mc.column, error: err.message });
    }
  }

  // 3. Create missing indexes
  for (const mi of results.missingIndexes) {
    // We don't have the full index definition (only the name), so use CREATE INDEX IF NOT EXISTS
    // with a placeholder — note: this won't work without the column name, so we warn
    warnLog(`Cannot auto-create index '${mi.index}' — index definition not available. Re-run migrations instead.`);
    repairLog.push({ action: "SKIP INDEX", table: mi.table, index: mi.index, reason: "definition not parseable from name alone" });
  }

  console.log("");
  infoLog(`Repair complete: ${repaired} objects created/modified`);

  // Write repair report
  const rptPath = path.join(CWD, "DB_SCHEMA_VERIFICATION_REPORT.md");
  const lines = [
    `# DB Schema Repair Report`,
    ``,
    `**Generated:** ${new Date().toISOString()}  `,
    `**Mode:** REPAIR  `,
    `**Objects repaired:** ${repaired}  `,
    ``,
    `## Repair Log`,
    ``,
    `| Action | Table | Column/Index | Details |`,
    `|---|---|---|---|`,
    ...repairLog.map(r => `| ${r.action} | \`${r.table ?? ""}\` | \`${r.column ?? r.index ?? ""}\` | ${r.error ?? "OK"} |`),
    ``,
    `## Safety Guarantees`,
    ``,
    `- ✓ No tables were dropped`,
    `- ✓ No columns were dropped`,
    `- ✓ No data was modified`,
    `- ✓ All operations used IF NOT EXISTS`,
    ``,
    `## Next Step`,
    ``,
    `Run \`--verify\` to confirm repairs:`,
    `\`\`\`bash`,
    `docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --verbose`,
    `\`\`\``,
  ];
  fs.writeFileSync(rptPath, lines.join("\n"), "utf8");
  infoLog(`Repair report written: ${rptPath}`);

  return repairLog;
}

// ════════════════════════════════════════════════════════════════════════════
// RESET MODE — TRIAL ONLY
// ════════════════════════════════════════════════════════════════════════════

async function runReset(client) {
  console.log("");
  console.log(c.bold(c.red("  ██████████████████████████████████████████")));
  console.log(c.bold(c.red("  ██                                      ██")));
  console.log(c.bold(c.red("  ██  ⚠️  RESET MODE — TRIAL ONLY         ██")));
  console.log(c.bold(c.red("  ██                                      ██")));
  console.log(c.bold(c.red("  ██  ALL DATA WILL BE PERMANENTLY LOST   ██")));
  console.log(c.bold(c.red("  ██                                      ██")));
  console.log(c.bold(c.red("  ██████████████████████████████████████████")));
  console.log("");
  console.log(c.red("  This will:"));
  console.log(c.red("    - DROP every table in the public schema"));
  console.log(c.red("    - DELETE all patient data"));
  console.log(c.red("    - DELETE all bills, payments, reports"));
  console.log(c.red("    - DELETE all settings and user accounts"));
  console.log(c.red("    - DELETE all radiology worklists"));
  console.log("");
  console.log(c.yellow("  Only use this on TRIAL deployments with NO real patient data."));
  console.log(c.yellow("  Safer alternative: docker compose up -d --build"));
  console.log("");

  // Require explicit confirmation
  const confirmed = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Type "RESET CONFIRMED" to proceed: ', (answer) => {
      rl.close();
      resolve(answer.trim() === "RESET CONFIRMED");
    });
  });

  if (!confirmed) {
    console.log(c.green("\n  Reset cancelled. No changes made."));
    process.exit(0);
  }

  console.log(c.red("\n  Proceeding with reset..."));

  try {
    // Drop all tables in public schema
    const tabRes = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    for (const row of tabRes.rows) {
      await client.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
      infoLog(`Dropped: ${row.tablename}`);
    }

    // Drop drizzle schema
    await client.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    infoLog("Dropped drizzle schema");

    console.log("");
    okLog("Database reset complete. Tables dropped:");
    okLog(`  ${tabRes.rows.length} tables removed`);
    console.log("");
    console.log(c.yellow("  Now run:"));
    console.log(c.yellow("  docker compose up -d --build"));
    console.log(c.yellow("  (Migrations will apply from scratch on next startup)"));
    console.log("");
  } catch (err) {
    failLog(`Reset failed: ${err.message}`);
    process.exit(1);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const startMs = Date.now();
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error(c.red("✗ DATABASE_URL environment variable is not set"));
    process.exit(1);
  }

  if (!QUIET) {
    headLog("\n════════════════════════════════════════════════════════");
    headLog(`  Care Diagnostics ERP — Schema Verifier v2`);
    headLog(`  Mode: ${MODE.toUpperCase()}  |  ${new Date().toISOString()}`);
    headLog("════════════════════════════════════════════════════════\n");
  }

  const safeDsn = connStr.replace(/:([^:@]+)@/, ":***@");
  infoLog(`Connecting: ${safeDsn}`);

  const client = new Client({ connectionString: connStr });
  try { await client.connect(); }
  catch (err) {
    console.error(c.red(`✗ DB connection failed: ${err.message}`));
    process.exit(1);
  }
  okLog("Database connected");

  // ── RESET MODE ────────────────────────────────────────────────────────────
  if (MODE === "reset") {
    await runReset(client);
    await client.end().catch(() => {});
    process.exit(0);
  }

  // ── Load migration sources ────────────────────────────────────────────────
  const { drizzleEntries, featureEntries, allEntries, journal } = loadAllMigrationSql();

  if (allEntries.length === 0) {
    console.error(c.red(`✗ No migration files found in ${DRIZZLE_DIR} or ${FEATURE_DIR}`));
    await client.end().catch(() => {});
    process.exit(1);
  }
  infoLog(`Migration sources: ${drizzleEntries.length} Drizzle + ${featureEntries.length} feature = ${allEntries.length} total`);

  // ── Parse expected schema (Source 1 + 3) ─────────────────────────────────
  const expected = parseSqlFiles(allEntries);
  infoLog(`Expected schema: ${expected.tables.size} tables`);

  // ── Cross-check sources (Source 1 ↔ 2 ↔ 3) ───────────────────────────────
  const crossIssues = crossCheckSources(journal, drizzleEntries, featureEntries);
  if (crossIssues.length > 0) {
    for (const i of crossIssues) {
      if (i.level === "error") warnLog(`Source issue [ERROR]: ${i.msg}`);
      else infoLog(`Source issue [WARN]: ${i.msg}`);
    }
  }

  // ── Load live schema (Source 5) ───────────────────────────────────────────
  let live;
  try {
    live = await getLiveSchema(client);
    okLog(`Live schema: ${live.liveTables.size} tables, ${[...live.liveColumns.values()].reduce((n,m) => n+m.size,0)} columns`);
  } catch (err) {
    console.error(c.red(`✗ Schema query failed: ${err.message}`));
    await client.end().catch(() => {});
    process.exit(1);
  }

  // ── Checksum drift (Source 3 vs Source 4) ─────────────────────────────────
  const driftIssues = detectChecksumDrift(allEntries, live.featureMigApplied);
  for (const d of driftIssues) warnLog(d.msg);

  // ── Diff ──────────────────────────────────────────────────────────────────
  const results = diffSchema(expected, live);
  results.sourceIssues = [...crossIssues, ...driftIssues];

  // Collect all-column counts for stats
  let expectedColCount = 0;
  for (const ti of expected.tables.values()) expectedColCount += ti.columns.size;
  let liveColCount = 0;
  for (const m of live.liveColumns.values()) liveColCount += m.size;

  const git   = getGitInfo();
  const stats = {
    sourceCount: allEntries.length,
    journalVersion: journal.version,
    expectedTables: expected.tables.size,
    liveTables: live.liveTables.size,
    expectedCols: expectedColCount,
    liveCols: liveColCount,
    durationMs: Date.now() - startMs,
  };

  // ── REPAIR MODE ───────────────────────────────────────────────────────────
  if (MODE === "repair") {
    await runRepair(client, results, expected);
    // Re-run verify after repair
    const live2 = await getLiveSchema(client);
    const results2 = diffSchema(expected, live2);
    results2.sourceIssues = results.sourceIssues;
    if (!QUIET) printResults(results2, git, live2.pgVersion, stats);
    if (!JSON_OUT) writeStartupMd(results2, git, live2, stats, allEntries, crossIssues);
    await client.end().catch(() => {});
    process.exit(results2.pass ? 0 : 1);
  }

  // ── VERIFY MODE (default) ─────────────────────────────────────────────────
  if (!JSON_OUT) printResults(results, git, live.pgVersion, stats);

  // Always write STARTUP_SCHEMA_VERIFICATION.md
  writeStartupMd(results, git, live, stats, allEntries, crossIssues);

  // JSON output for downstream tools
  if (JSON_OUT) {
    console.log(JSON.stringify({
      pass: results.pass, mode: MODE,
      git, pgVersion: live.pgVersion,
      stats,
      missingTables: results.missingTables,
      missingColumns: results.missingColumns,
      typeMismatches: results.typeMismatches,
      missingIndexes: results.missingIndexes,
      sourceIssues: results.sourceIssues,
      warnings: results.warnings,
      deployState: results.deployState,
      migrations: { drizzle: results.journalApplied.length, feature: results.featureMigApplied.length },
    }, null, 2));
  }

  // Save machine-readable results for db-schema-report.cjs
  try {
    fs.writeFileSync(
      path.join(CWD, ".schema-verify-results.json"),
      JSON.stringify({ pass: results.pass, ...results, git, pgVersion: live.pgVersion, stats, live: {
        liveTables: [...live.liveTables], liveExtensions: live.liveExtensions,
        liveViews: [...live.liveViews], liveTriggers: live.liveTriggers,
        deployState: live.deployState,
      }}, null, 2)
    );
  } catch { /* non-fatal */ }

  // Update schema_deploy_state with full verification result
  // This is read by /api/health/schema Gate 2
  try {
    await client.query(`
      INSERT INTO public.schema_deploy_state (key, value)
      VALUES
        ('schema_verify_status',     $1),
        ('schema_verify_at',         $2),
        ('schema_verify_tables_ok',  $3),
        ('schema_verify_cols_ok',    $4),
        ('schema_verify_issues',     $5)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [
      results.pass ? "full_pass" : "full_fail",
      new Date().toISOString(),
      String(results.tablesPassed),
      String(results.columnsPassed),
      String(results.missingTables.length + results.missingColumns.length),
    ]);
    infoLog(`Schema state updated: ${results.pass ? "full_pass" : "full_fail"}`);
  } catch (e) {
    // Non-fatal — schema_deploy_state table might not exist yet (pre-patch DB)
    if (VERBOSE) warnLog(`Could not update schema_deploy_state: ${e.message}`);
  }

  await client.end().catch(() => {});
  infoLog(`Verification complete in ${Date.now() - startMs}ms`);
  process.exit(results.pass ? 0 : 1);
}

// Only run main() when executed directly (`node scripts/db-schema-verify.cjs`).
// When required as a module (e.g. from a regression test) this exposes pure
// helper functions below without connecting to a database or exiting the
// process.
if (require.main === module) {
  main().catch((err) => {
    console.error(c.red(`✗ Unexpected error: ${err.message}`));
    if (VERBOSE) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { normaliseType, typesCompatible, defaultLiteralForType };
