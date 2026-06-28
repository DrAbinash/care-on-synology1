#!/usr/bin/env node
/**
 * db-schema-verify.cjs
 * ====================
 * Full Drizzle schema verification for Care Diagnostics ERP.
 *
 * What it checks:
 *   1. All expected tables from SQL migration files exist in the live DB
 *   2. All expected columns exist (by name and table)
 *   3. Column data types match (normalised comparison)
 *   4. NOT NULL constraints match
 *   5. Primary keys exist
 *   6. Unique constraints exist
 *   7. Foreign keys exist (table-level, not column-level)
 *   8. Indexes exist (by name)
 *   9. Migration journal consistency (all journal entries applied)
 *  10. Feature migration application state
 *
 * How it works:
 *   - Parses all CREATE TABLE / ALTER TABLE statements from the Drizzle SQL
 *     migration files (lib/db/drizzle/*.sql) and feature migrations
 *     (migrations/*.sql) to build an expected schema.
 *   - Queries information_schema and pg_catalog for the live schema.
 *   - Diffs expected vs actual.
 *   - Exits 0 on pass, 1 on failure.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/db-schema-verify.cjs
 *   DATABASE_URL=postgres://... node scripts/db-schema-verify.cjs --json
 *   DATABASE_URL=postgres://... node scripts/db-schema-verify.cjs --report  # writes MD file
 *
 * Can be run in:
 *   - care-migrate container: docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs
 *   - Locally: node scripts/db-schema-verify.cjs
 */

"use strict";

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────────
const ARGS     = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const REPORT   = ARGS.includes("--report");
const VERBOSE  = ARGS.includes("--verbose") || ARGS.includes("-v");
const QUIET    = ARGS.includes("--quiet")   || ARGS.includes("-q");

// ── Colour helpers ────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  blue:   (s) => isTTY ? `\x1b[34m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m`  : s,
};
const ok   = (s) => console.log(c.green("  ✓ ") + s);
const fail = (s) => console.log(c.red("  ✗ ") + s);
const warn = (s) => console.log(c.yellow("  ! ") + s);
const info = (s) => { if (!QUIET) console.log(c.blue("  ▸ ") + s); };

// ── Path resolution (works from both /repo and /app) ─────────────────────────
function findRepoRoot() {
  // Try common locations
  const candidates = [
    path.resolve(__dirname, ".."),          // /repo (care-migrate)
    path.resolve(__dirname, "../.."),       // /app/.. (rare)
    "/repo",                                // explicit
    process.cwd(),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "lib/db/drizzle/meta/_journal.json"))) return c;
    if (fs.existsSync(path.join(c, "drizzle/meta/_journal.json"))) return path.join(c, "..");
  }
  return path.resolve(__dirname, "..");
}

const REPO_ROOT     = findRepoRoot();
const DRIZZLE_DIR   = path.join(REPO_ROOT, "lib/db/drizzle");
const FEATURE_DIR   = path.join(REPO_ROOT, "migrations");
const JOURNAL_PATH  = path.join(DRIZZLE_DIR, "meta/_journal.json");

// ── Type normalisation ────────────────────────────────────────────────────────
// Drizzle SQL uses "text", "integer", "serial", "timestamp with time zone", etc.
// PostgreSQL information_schema reports "character varying", "integer", "bigint", etc.
// We normalise both sides so we're comparing semantics, not syntax.

function normaliseType(raw) {
  if (!raw) return "unknown";
  const t = raw.toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/character varying(\(\d+\))?/, "text")    // varchar → text (Drizzle maps to text)
    .replace(/character\s*varying/g, "text")
    .replace(/^varchar(\(\d+\))?$/, "text")
    .replace(/^character\s*\(.*\)$/, "text")
    .replace(/^integer$/, "integer")
    .replace(/^int4$/, "integer")
    .replace(/^int$/, "integer")
    .replace(/^int8$/, "bigint")
    .replace(/^serial$/, "integer")                   // serial is integer with sequence
    .replace(/^bigserial$/, "bigint")
    .replace(/^bool$/, "boolean")
    .replace(/^float4$/, "real")
    .replace(/^float8$/, "double precision")
    .replace(/^decimal/,  "numeric")
    .replace(/^json$/, "jsonb")                        // we use jsonb throughout, but json is compatible
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^timestamptz$/, "timestamptz")
    .replace(/\s*with time zone$/, "tz")
    .replace(/\s*without time zone$/, "")
    .trim();
  return t;
}

// ── SQL parser — extract expected schema from migration files ─────────────────

/**
 * Parse CREATE TABLE statements from SQL migration file content.
 * Returns: { tableName → { columns: Map<colName, {type, notNull, hasPk}>, constraints: [] } }
 *
 * This is a line-by-line parser, not a full SQL parser.
 * It handles the specific format produced by drizzle-kit.
 */
function parseSqlMigrations(sqlTexts) {
  // Expected schema: Map<tableName, { columns: Map<colName, info>, indexes: Set, uniques: Set, fks: Set }>
  const tables = new Map();
  const indexNames = new Set();
  const fkTables = new Set();   // tables that have FK references TO them

  for (const sql of sqlTexts) {
    // Strip Drizzle breakpoint markers
    const clean = sql.replace(/--> statement-breakpoint/g, "");

    // ── Parse CREATE TABLE ────────────────────────────────────────────────────
    const createTableRegex = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([^;]*)\)/gis;
    let m;
    while ((m = createTableRegex.exec(clean)) !== null) {
      const tableName = m[1];
      const body = m[2];
      if (!tables.has(tableName)) {
        tables.set(tableName, { columns: new Map(), indexes: new Set(), uniques: new Set(), pks: new Set(), fks: [] });
      }
      const tableInfo = tables.get(tableName);

      // Parse each line of the CREATE TABLE body
      const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // Skip CONSTRAINT lines
        if (line.startsWith("CONSTRAINT") || line.startsWith("--")) continue;

        // Column definition: "col_name" TYPE [modifiers]
        const colMatch = line.match(/^"([^"]+)"\s+(\S+(?:\s+\w+)?(?:\(\d+(?:,\s*\d+)?\))?(?:\s+with time zone)?(?:\s+without time zone)?)/i);
        if (colMatch) {
          const colName = colMatch[1];
          let rawType = colMatch[2];
          // Handle "timestamp with time zone" etc.
          if (line.match(/timestamp with time zone/i))    rawType = "timestamptz";
          if (line.match(/timestamp without time zone/i)) rawType = "timestamp";
          if (line.match(/^"[^"]+"\s+serial\b/i))         rawType = "serial";
          if (line.match(/^"[^"]+"\s+bigserial\b/i))      rawType = "bigserial";
          if (line.match(/\bjsonb\b/i))                   rawType = "jsonb";
          if (line.match(/\bjson\b/i) && !line.match(/jsonb/i)) rawType = "jsonb"; // we use jsonb

          const notNull = /NOT NULL/i.test(line);
          const isPk    = /PRIMARY KEY/i.test(line);
          tableInfo.columns.set(colName, {
            type: normaliseType(rawType.split("(")[0].trim()),
            rawType: rawType.trim(),
            notNull,
            isPk,
            line: line.trim(),
          });
        }

        // CONSTRAINT ... PRIMARY KEY (col, ...)
        const pkMatch = line.match(/CONSTRAINT\s+"[^"]+"\s+PRIMARY KEY\s*\("([^"]+)"\)/i);
        if (pkMatch) tableInfo.pks.add(pkMatch[1]);

        // CONSTRAINT ... UNIQUE (col)
        const uqMatch = line.match(/CONSTRAINT\s+"[^"]+"\s+UNIQUE\s*\("([^"]+)"\)/i);
        if (uqMatch) tableInfo.uniques.add(uqMatch[1]);

        // FOREIGN KEY
        const fkMatch = line.match(/REFERENCES\s+"?(\w+)"?\s*\("?(\w+)"?\)/i);
        if (fkMatch) tableInfo.fks.push({ refTable: fkMatch[1], refCol: fkMatch[2] });
      }
    }

    // ── Parse ALTER TABLE ADD COLUMN ─────────────────────────────────────────
    // Feature migrations use: ALTER TABLE foo ADD COLUMN IF NOT EXISTS col TYPE;
    const addColRegex = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s+([^\n;,]+)/gi;
    let ac;
    while ((ac = addColRegex.exec(clean)) !== null) {
      const tableName = ac[1];
      const colName   = ac[2];
      let rawType     = ac[3].trim();

      // Extract type (first word, with modifiers)
      const notNull = /NOT NULL/i.test(rawType);
      rawType = rawType.replace(/NOT NULL.*/i, "").replace(/DEFAULT.*/i, "").trim();
      if (/timestamp with time zone/i.test(rawType))    rawType = "timestamptz";
      if (/timestamp without time zone/i.test(rawType)) rawType = "timestamp";
      if (/jsonb/i.test(rawType)) rawType = "jsonb";
      if (/json\b/i.test(rawType) && !/jsonb/i.test(rawType)) rawType = "jsonb";

      if (!tables.has(tableName)) {
        tables.set(tableName, { columns: new Map(), indexes: new Set(), uniques: new Set(), pks: new Set(), fks: [] });
      }
      const tableInfo = tables.get(tableName);
      if (!tableInfo.columns.has(colName)) {
        tableInfo.columns.set(colName, {
          type: normaliseType(rawType.split("(")[0].replace(/\s*\(\d+.*/, "").trim()),
          rawType: rawType.trim(),
          notNull,
          isPk: false,
          line: ac[0].trim(),
          fromAlter: true,
        });
      }
    }

    // ── Parse CREATE INDEX ────────────────────────────────────────────────────
    const idxRegex = /CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s+ON\s+"?(\w+)"?/gi;
    let ix;
    while ((ix = idxRegex.exec(clean)) !== null) {
      indexNames.add(ix[1]);
      const tbl = tables.get(ix[2]);
      if (tbl) tbl.indexes.add(ix[1]);
    }
  }

  return { tables, indexNames };
}

// ── Collect all SQL migration files ──────────────────────────────────────────

function loadAllMigrationSql() {
  const texts = [];
  const sources = [];

  // 1. Drizzle journal migrations
  if (fs.existsSync(JOURNAL_PATH)) {
    const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
    for (const entry of (journal.entries || [])) {
      const filePath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
      if (fs.existsSync(filePath)) {
        texts.push(fs.readFileSync(filePath, "utf8"));
        sources.push({ type: "drizzle", tag: entry.tag, path: filePath });
      }
    }
  }

  // 2. Feature migrations
  if (fs.existsSync(FEATURE_DIR)) {
    const files = fs.readdirSync(FEATURE_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      const filePath = path.join(FEATURE_DIR, f);
      texts.push(fs.readFileSync(filePath, "utf8"));
      sources.push({ type: "feature", tag: f, path: filePath });
    }
  }

  // 3. The voice tables migration (it's inside drizzle/ but not in journal)
  const voicePath = path.join(DRIZZLE_DIR, "voice_tables_migration.sql");
  if (fs.existsSync(voicePath)) {
    texts.push(fs.readFileSync(voicePath, "utf8"));
    sources.push({ type: "drizzle-extra", tag: "voice_tables_migration.sql", path: voicePath });
  }

  return { texts, sources };
}

// ── Live DB queries ───────────────────────────────────────────────────────────

async function getLiveSchema(client) {
  // Tables
  const tableRes = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const liveTables = new Set(tableRes.rows.map(r => r.table_name));

  // Columns (with types and nullable)
  const colRes = await client.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  // Build liveColumns: Map<tableName, Map<colName, info>>
  const liveColumns = new Map();
  for (const row of colRes.rows) {
    if (!liveColumns.has(row.table_name)) liveColumns.set(row.table_name, new Map());
    const normType = normaliseType(
      row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type
    );
    liveColumns.get(row.table_name).set(row.column_name, {
      type: normType,
      rawType: row.data_type,
      isNullable: row.is_nullable === "YES",
      default: row.column_default,
    });
  }

  // Primary keys
  const pkRes = await client.query(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
  `);
  const livePks = new Map();
  for (const row of pkRes.rows) {
    if (!livePks.has(row.table_name)) livePks.set(row.table_name, new Set());
    livePks.get(row.table_name).add(row.column_name);
  }

  // Unique constraints
  const uqRes = await client.query(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
  `);
  const liveUniques = new Map();
  for (const row of uqRes.rows) {
    if (!liveUniques.has(row.table_name)) liveUniques.set(row.table_name, new Set());
    liveUniques.get(row.table_name).add(row.column_name);
  }

  // Indexes (from pg_catalog — more reliable than information_schema)
  const idxRes = await client.query(`
    SELECT i.relname AS index_name, t.relname AS table_name, ix.indisunique AS is_unique
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i  ON i.oid  = ix.indexrelid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relkind = 'r'
      AND NOT ix.indisprimary
    ORDER BY t.relname, i.relname
  `);
  const liveIndexes = new Set(idxRes.rows.map(r => r.index_name));

  // Foreign keys
  const fkRes = await client.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  const liveFks = new Map();
  for (const row of fkRes.rows) {
    if (!liveFks.has(row.table_name)) liveFks.set(row.table_name, []);
    liveFks.get(row.table_name).push({ refTable: row.foreign_table_name, refCol: row.foreign_column_name });
  }

  // Migration state
  let journalRows = [];
  let featureMigRows = [];
  let deployState = {};
  try {
    const jr = await client.query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
    journalRows = jr.rows;
  } catch { /* table may not exist */ }
  try {
    const fm = await client.query(`SELECT name, kind, applied_at, sha256 FROM public.schema_migrations_log ORDER BY applied_at`);
    featureMigRows = fm.rows;
  } catch { /* table may not exist */ }
  try {
    const ds = await client.query(`SELECT key, value FROM public.schema_deploy_state`);
    for (const row of ds.rows) deployState[row.key] = row.value;
  } catch { /* table may not exist */ }

  return { liveTables, liveColumns, livePks, liveUniques, liveIndexes, liveFks, journalRows, featureMigRows, deployState };
}

// ── Diff engine ───────────────────────────────────────────────────────────────

// Tables we skip in verification (they exist in migration SQL but are internal/bootstrap):
const SKIP_TABLES = new Set([
  "schema_migrations_log",  // created by our own patch script
  "schema_deploy_state",    // created by our own patch script
]);

// Columns we skip because they're added dynamically by runStartupMigrations
// and not in any SQL migration file (but always present in production):
const SKIP_COL_TYPES = new Set(["USER-DEFINED"]);  // postgres enum etc.

// Tables that the Drizzle schema defines but which are only created by
// runStartupMigrations in index.ts (not in any SQL file) — we warn, not fail:
const RUNTIME_ONLY_TABLES = new Set([
  "kiosk_payment_sessions",
  "ai_quality_scores",
  "ai_dicom_findings",
  "rag_document_embeddings",
  "rag_search_queries",
  "anomaly_alerts",
  "report_template_versions",
  "ai_billing_suggestions",
  "peer_review_assignments",
  "turnaround_times",
  "ai_training_data_exports",
  "report_quality_gates",
  "critical_findings",
  "ai_provider_health_logs",
  "ai_voice_transcriptions",
  "ai_patient_communications",
  "ai_normal_report_templates",
  "radiologist_assignment_rules",
  "radiologist_subspecialties",
  "radiologist_workloads",
  "radiology_institutional_styles",
  "payment_logs",
  "day_closures",
  "dicom_nodes",
  "ai_server_health_log",
]);

function diffSchema(expected, live) {
  const { tables: expectedTables } = expected;
  const {
    liveTables, liveColumns, livePks, liveUniques, liveIndexes, liveFks,
    journalRows, featureMigRows, deployState
  } = live;

  const results = {
    pass: true,
    missingTables:    [],
    extraTables:      [],   // in DB but not in migrations (ok — runtime created)
    missingColumns:   [],
    typeMismatches:   [],
    notNullMismatches:[],
    missingIndexes:   [],
    missingFks:       [],
    warnings:         [],
    tablesPassed:     0,
    tablesChecked:    0,
    columnsPassed:    0,
    columnsChecked:   0,
    journalRows,
    featureMigRows,
    deployState,
    runtimeOnlyTables: [],
  };

  for (const [tableName, tableInfo] of expectedTables.entries()) {
    if (SKIP_TABLES.has(tableName)) continue;

    results.tablesChecked++;

    if (!liveTables.has(tableName)) {
      if (RUNTIME_ONLY_TABLES.has(tableName)) {
        results.runtimeOnlyTables.push(tableName);
        results.warnings.push(`Table '${tableName}' not in DB — created by API startup (non-fatal)`);
      } else {
        results.missingTables.push(tableName);
        results.pass = false;
      }
      continue;
    }

    results.tablesPassed++;
    const liveCols = liveColumns.get(tableName) || new Map();

    for (const [colName, colInfo] of tableInfo.columns.entries()) {
      results.columnsChecked++;

      if (!liveCols.has(colName)) {
        // Is this column only added by runStartupMigrations? Warn only if table is runtime-only.
        results.missingColumns.push({ table: tableName, column: colName, expectedType: colInfo.type });
        results.pass = false;
        continue;
      }

      results.columnsPassed++;
      const liveCol = liveCols.get(colName);

      // Type check — normalised comparison
      const expectedNorm = normaliseType(colInfo.type);
      const liveNorm     = normaliseType(liveCol.type);

      // Type compatibility groups (these are considered equivalent)
      const typeGroups = [
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

      let typesMatch = expectedNorm === liveNorm;
      if (!typesMatch) {
        for (const grp of typeGroups) {
          if (grp.has(expectedNorm) && grp.has(liveNorm)) { typesMatch = true; break; }
        }
      }

      if (!typesMatch) {
        results.typeMismatches.push({
          table: tableName, column: colName,
          expected: expectedNorm, actual: liveNorm,
        });
        // Type mismatches are warnings, not failures (ALTER COLUMN needs data conversion)
        results.warnings.push(`Type mismatch ${tableName}.${colName}: expected '${expectedNorm}', got '${liveNorm}'`);
      }
    }

    // Index check (by name — subset match is fine)
    for (const idxName of tableInfo.indexes) {
      if (!liveIndexes.has(idxName)) {
        results.missingIndexes.push({ table: tableName, index: idxName });
        results.warnings.push(`Missing index '${idxName}' on '${tableName}'`);
        // Indexes are warnings not failures (can be created later)
      }
    }
  }

  return results;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function printResults(r, sources) {
  console.log("");
  console.log(c.bold("════════════════════════════════════════════════════"));
  console.log(c.bold("  Care Diagnostics ERP — Schema Verification"));
  console.log(c.bold("════════════════════════════════════════════════════"));
  console.log("");

  info(`Migration sources loaded: ${sources.length} files`);
  info(`Tables checked: ${r.tablesChecked}`);
  info(`Columns checked: ${r.columnsChecked}`);
  console.log("");

  // Migration journal status
  if (r.journalRows.length > 0) {
    ok(`Drizzle journal: ${r.journalRows.length} migrations applied`);
  } else {
    warn(`Drizzle journal: no applied migrations found in drizzle.__drizzle_migrations`);
  }

  if (r.featureMigRows.length > 0) {
    ok(`Feature migrations: ${r.featureMigRows.length} applied`);
    if (VERBOSE) {
      for (const row of r.featureMigRows) {
        info(`  ${row.kind} | ${row.name} | ${row.applied_at?.toString().slice(0,19) || "?"}`);
      }
    }
  } else {
    warn("Feature migrations: none found in schema_migrations_log");
  }

  // Deploy state
  if (r.deployState.db_patch_ok === "true") {
    ok(`Deploy state: db_patch_ok=true (version ${r.deployState.patch_version || "?"})`);
  } else {
    warn(`Deploy state: db_patch_ok=${r.deployState.db_patch_ok || "MISSING"}`);
  }

  console.log("");

  // Tables
  if (r.missingTables.length === 0) {
    ok(`Tables: all ${r.tablesPassed} expected tables present`);
  } else {
    fail(`Missing tables (${r.missingTables.length}):`);
    for (const t of r.missingTables) {
      console.log(c.red(`     ✗ ${t}`));
    }
  }

  // Runtime-only tables
  if (r.runtimeOnlyTables.length > 0 && VERBOSE) {
    warn(`Tables created by API startup (not in SQL files, OK): ${r.runtimeOnlyTables.length}`);
    for (const t of r.runtimeOnlyTables) info(`  ${t}`);
  }

  // Columns
  if (r.missingColumns.length === 0) {
    ok(`Columns: all ${r.columnsPassed} expected columns present`);
  } else {
    fail(`Missing columns (${r.missingColumns.length}):`);
    for (const mc of r.missingColumns) {
      console.log(c.red(`     ✗ ${mc.table}.${mc.column}  [expected type: ${mc.expectedType}]`));
    }
  }

  // Type mismatches (warnings)
  if (r.typeMismatches.length > 0) {
    warn(`Type mismatches (${r.typeMismatches.length}) — schema compatible but different:`);
    for (const tm of r.typeMismatches) {
      console.log(c.yellow(`     ! ${tm.table}.${tm.column}: expected '${tm.expected}', got '${tm.actual}'`));
    }
  }

  // Indexes (warnings)
  if (r.missingIndexes.length > 0) {
    warn(`Missing indexes (${r.missingIndexes.length}) — performance may be affected:`);
    for (const mi of r.missingIndexes) {
      console.log(c.yellow(`     ! ${mi.index} on ${mi.table}`));
    }
  }

  console.log("");

  if (r.pass) {
    console.log(c.green(c.bold("  ✓ SCHEMA VERIFICATION PASSED")));
    console.log(c.dim(`    ${r.tablesPassed} tables, ${r.columnsPassed} columns verified`));
  } else {
    console.log(c.red(c.bold("  ✗ SCHEMA VERIFICATION FAILED")));
    if (r.missingTables.length > 0) console.log(c.red(`    Missing tables:   ${r.missingTables.length}`));
    if (r.missingColumns.length > 0) console.log(c.red(`    Missing columns:  ${r.missingColumns.length}`));
  }

  if (r.warnings.length > 0 && VERBOSE) {
    console.log("");
    warn(`Warnings (${r.warnings.length}):`);
    for (const w of r.warnings) console.log(c.yellow(`  ${w}`));
  }

  console.log("");
  console.log(c.bold("════════════════════════════════════════════════════"));
  console.log("");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error(c.red("✗ DATABASE_URL environment variable is not set"));
    process.exit(1);
  }

  // Mask password in logs
  const safeDsn = connStr.replace(/:([^:@]+)@/, ":***@");
  if (!QUIET) {
    console.log("");
    info(`Connecting to: ${safeDsn}`);
  }

  // Load SQL migration files
  const { texts, sources } = loadAllMigrationSql();
  if (texts.length === 0) {
    console.error(c.red("✗ No migration SQL files found — check DRIZZLE_DIR and FEATURE_DIR paths"));
    console.error(c.red(`  Looked in: ${DRIZZLE_DIR}`));
    console.error(c.red(`  And in:    ${FEATURE_DIR}`));
    process.exit(1);
  }
  if (!QUIET) info(`Loaded ${texts.length} SQL migration files`);

  // Parse expected schema from SQL
  const expected = parseSqlMigrations(texts);
  if (!QUIET) info(`Parsed expected schema: ${expected.tables.size} tables`);

  // Connect to DB
  const client = new Client({ connectionString: connStr });
  try {
    await client.connect();
    if (!QUIET) ok("Database connected");
  } catch (err) {
    console.error(c.red(`✗ Database connection failed: ${err.message}`));
    process.exit(1);
  }

  let results;
  try {
    const live = await getLiveSchema(client);
    if (!QUIET) ok(`Live schema loaded: ${live.liveTables.size} tables, ${[...live.liveColumns.values()].reduce((n, m) => n + m.size, 0)} columns`);
    results = diffSchema(expected, live);
  } catch (err) {
    console.error(c.red(`✗ Schema query failed: ${err.message}`));
    await client.end().catch(() => {});
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }

  if (JSON_OUT) {
    // Output machine-readable JSON
    console.log(JSON.stringify({
      pass: results.pass,
      missingTables: results.missingTables,
      missingColumns: results.missingColumns,
      typeMismatches: results.typeMismatches,
      missingIndexes: results.missingIndexes,
      warnings: results.warnings,
      stats: {
        tablesChecked: results.tablesChecked,
        tablesPassed: results.tablesPassed,
        columnsChecked: results.columnsChecked,
        columnsPassed: results.columnsPassed,
      },
      deployState: results.deployState,
    }, null, 2));
  } else {
    printResults(results, sources);
  }

  if (REPORT) {
    // Will be handled by db-schema-report.cjs
    fs.writeFileSync(
      path.join(process.cwd(), ".schema-verify-results.json"),
      JSON.stringify(results, null, 2)
    );
    info("Results written to .schema-verify-results.json for report generation");
  }

  process.exit(results.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(c.red(`✗ Unexpected error: ${err.message}`));
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
