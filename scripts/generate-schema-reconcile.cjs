#!/usr/bin/env node
/**
 * generate-schema-reconcile.cjs — Emit an idempotent schema-reconciliation migration
 * ===================================================================================
 * Care Diagnostics ERP · Hospital RIS/PACS
 *
 * WHY THIS EXISTS
 * ---------------
 * care-db-patch-v2 applies each migration file exactly once, tracked by name
 * (feature files) or content hash (Drizzle files) in schema_migrations_log /
 * drizzle.__drizzle_migrations. When a production volume is restored from an
 * older backup, those tracking tables come back with it — so every file is
 * "already applied" and gets skipped, even though the restored schema predates
 * columns/indexes that were added later (or added by editing an
 * already-applied file, which the entrypoint deliberately never re-runs).
 * Result: db-patch passes, care-api runs, but care-schema-verify reports
 * full_fail with missing columns/indexes.
 *
 * WHAT IT DOES
 * ------------
 * Parses the SAME migration sources scripts/db-schema-verify.cjs parses
 * (lib/db/drizzle/*.sql in journal order + migrations/*.sql alphabetically,
 * replaying DROP/RENAME/RETYPE ops) and emits ONE new feature migration that
 * closes any gap between a live database and the expected schema:
 *
 *   1. CREATE TABLE IF NOT EXISTS  — minimal reconstruction (columns + PK)
 *                                    for every expected non-runtime table
 *   2. ALTER TABLE IF EXISTS ... ADD COLUMN IF NOT EXISTS — every expected column
 *   3. CREATE [UNIQUE] INDEX IF NOT EXISTS — every expected index, original
 *                                    definition copied verbatim
 *
 * Every statement is wrapped in its own DO block that downgrades any error to
 * a RAISE WARNING, so a single bad statement (e.g. a UNIQUE index over data
 * that drifted while the column was missing) can never abort care-db-patch-v2
 * and block care-api from starting. Where the database already matches, every
 * statement is a no-op. Nothing is ever dropped, truncated, deleted, or
 * updated — DDL-add only.
 *
 * USAGE
 * -----
 *   node scripts/generate-schema-reconcile.cjs [--date YYYYMMDD] [--stdout]
 *
 * Writes migrations/zz_schema_reconcile_<date>.sql (the zz_ prefix sorts it
 * after every other feature migration, so it always runs last, after any new
 * feature files have created their tables).
 *
 * REGENERATING LATER
 * ------------------
 * The entrypoint never re-applies a feature file whose content changed, so to
 * reconcile again after future drift: DELETE the old zz_schema_reconcile_*.sql
 * from migrations/ (removing a migration FILE never touches the database) and
 * re-run this script with a new --date. Old reconcile files must not linger
 * once columns they re-add have been dropped by newer migrations — the
 * built-in self-check below refuses to emit a file that would change the
 * verifier's expected schema, which catches that situation at generation time.
 *
 * SELF-CHECK
 * ----------
 * After generating, the script re-parses (sources + generated file) with the
 * verifier's own parser and asserts the expected tables/columns/indexes are
 * IDENTICAL to (sources) alone. If the generated file would add or lose a
 * single expectation, generation fails and nothing is written.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { parseSqlFiles, defaultLiteralForType } = require("./db-schema-verify.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const DRIZZLE_DIR = path.join(REPO_ROOT, "lib/db/drizzle");
const FEATURE_DIR = path.join(REPO_ROOT, "migrations");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");

const ARGS = process.argv.slice(2);
function argValue(flag) {
  const i = ARGS.indexOf(flag);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null;
}
const DATE_TAG = argValue("--date") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
const TO_STDOUT = ARGS.includes("--stdout");
const OUT_NAME = `zz_schema_reconcile_${DATE_TAG}.sql`;
const OUT_PATH = path.join(FEATURE_DIR, OUT_NAME);

// Tables created by care-api's runStartupMigrations() / other runtime code.
// Mirror of RUNTIME_CREATED_TABLES in db-schema-verify.cjs: the verifier only
// warns (never fails) when these are absent, and their DDL lives in
// TypeScript, not SQL — so the reconcile file must not attempt to build them
// from a lossy parse.
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
  "schema_migrations_log", "schema_deploy_state",
]);

// ════════════════════════════════════════════════════════════════════════════
// SOURCE LOADING — same order as db-schema-verify.cjs loadAllMigrationSql()
// ════════════════════════════════════════════════════════════════════════════

function loadSources({ excludeReconcile }) {
  const entries = [];

  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
  for (const entry of journal.entries || []) {
    const fpath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (fs.existsSync(fpath)) {
      entries.push({ content: fs.readFileSync(fpath, "utf8"), tag: entry.tag, type: "drizzle", path: fpath });
    }
  }
  const voicePath = path.join(DRIZZLE_DIR, "voice_tables_migration.sql");
  if (fs.existsSync(voicePath) && !entries.find((e) => e.tag === "voice_tables_migration")) {
    entries.push({ content: fs.readFileSync(voicePath, "utf8"), tag: "voice_tables_migration", type: "drizzle-extra", path: voicePath });
  }
  const files = fs.readdirSync(FEATURE_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (excludeReconcile && /^zz_schema_reconcile_/.test(f)) continue;
    const fpath = path.join(FEATURE_DIR, f);
    entries.push({ content: fs.readFileSync(fpath, "utf8"), tag: f, type: "feature", path: fpath });
  }
  return entries;
}

// ════════════════════════════════════════════════════════════════════════════
// PRECISE DDL EXTRACTION (paren/quote-aware, unlike the verifier's regexes)
// ════════════════════════════════════════════════════════════════════════════
// The verifier's parse is fine for DIFFING (it only needs names and rough
// types) but too lossy to EMIT SQL from: its type capture truncates
// "numeric(10, 2)" at the comma and its DEFAULT capture truncates "now()" at
// the paren. This section re-extracts full, valid column definitions.

function stripComments(sql) {
  return sql.replace(/--> statement-breakpoint/g, "").replace(/--[^\n]*/g, "");
}

/** Split a string on top-level commas (ignores commas inside (), '' and ""). */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0, inSq = false, inDq = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inSq) { cur += ch; if (ch === "'" && s[i + 1] === "'") { cur += "'"; i++; } else if (ch === "'") inSq = false; continue; }
    if (inDq) { cur += ch; if (ch === '"') inDq = false; continue; }
    if (ch === "'") { inSq = true; cur += ch; continue; }
    if (ch === '"') { inDq = true; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Find the index of the first top-level occurrence of any keyword in `s`. */
function findTopLevelKeyword(s, keywords) {
  let depth = 0, inSq = false, inDq = false;
  const upper = s.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inSq) { if (ch === "'" && s[i + 1] === "'") i++; else if (ch === "'") inSq = false; continue; }
    if (inDq) { if (ch === '"') inDq = false; continue; }
    if (ch === "'") { inSq = true; continue; }
    if (ch === '"') { inDq = true; continue; }
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth !== 0) continue;
    for (const kw of keywords) {
      if (upper.startsWith(kw, i)) {
        const before = i === 0 ? " " : s[i - 1];
        const after = i + kw.length >= s.length ? " " : s[i + kw.length];
        if (/[\s,)]/.test(before) && /[\s,(;]/.test(after)) return { index: i, kw };
      }
    }
  }
  return null;
}

const DEF_BOUNDARY_KEYWORDS = [
  "DEFAULT", "NOT NULL", "PRIMARY KEY", "UNIQUE", "REFERENCES",
  "GENERATED", "CONSTRAINT", "CHECK", "COLLATE",
];

/**
 * Parse one column definition fragment (`"name" type [DEFAULT ..] [NOT NULL] ...`)
 * into { name, typeSql, defaultSql, notNull } — or null if it isn't a column.
 */
function parseColumnDef(fragment) {
  const frag = fragment.trim().replace(/\s+/g, " ");
  if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|LIKE|INHERITS)\b/i.test(frag)) return null;
  // Drizzle emits quoted identifiers; hand-written feature migrations often
  // use unquoted ones. Accept both.
  const nameM = frag.match(/^"([^"]+)"\s+(.*)$/s) || frag.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/s);
  if (!nameM) return null;
  const name = nameM[1];
  const rest = nameM[2];

  const boundary = findTopLevelKeyword(rest, DEF_BOUNDARY_KEYWORDS);
  const typeSql = (boundary ? rest.slice(0, boundary.index) : rest).trim().replace(/[,;]+$/, "").trim();
  if (!typeSql) return null;

  const notNull = !!findTopLevelKeyword(rest, ["NOT NULL"]);
  const isPk = !!findTopLevelKeyword(rest, ["PRIMARY KEY"]);

  let defaultSql = null;
  const defM = findTopLevelKeyword(rest, ["DEFAULT"]);
  if (defM) {
    const afterDefault = rest.slice(defM.index + "DEFAULT".length);
    const end = findTopLevelKeyword(afterDefault, DEF_BOUNDARY_KEYWORDS.filter((k) => k !== "DEFAULT"));
    defaultSql = (end ? afterDefault.slice(0, end.index) : afterDefault).trim().replace(/[,;]+$/, "").trim();
  }

  return { name, typeSql, defaultSql, notNull, isPk };
}

/**
 * Walk every source file in order, replaying CREATE/ADD/DROP/RENAME/RETYPE the
 * same way the verifier does, and keep FULL definitions for emission.
 * Returns { defs: Map<table, Map<col, def>>, indexDefs: Map<name, stmt>,
 *           tableOrder: string[] }
 */
function extractDefinitions(entries) {
  const defs = new Map();       // table -> Map<col, {typeSql, defaultSql, notNull, isPk}>
  const indexDefs = new Map();  // index name -> full CREATE INDEX statement
  const rawCreates = new Map(); // table -> original CREATE TABLE statement (verbatim fallback)
  const tableOrder = [];        // first-seen order, for dependency-friendly emission

  const ensure = (tbl) => {
    if (!defs.has(tbl)) { defs.set(tbl, new Map()); tableOrder.push(tbl); }
    return defs.get(tbl);
  };

  for (const { content } of entries) {
    const clean = stripComments(content);

    // Ordered ops within this file (mirrors verifier's colOps replay)
    const ops = [];

    const ctRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([^;]*?)\)\s*;/gis;
    let m;
    while ((m = ctRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "create", table: m[1], body: m[2], stmt: m[0] });

    const acRe = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+((?:[^;']|'[^']*')+);/gi;
    while ((m = acRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "add", table: m[1], fragment: m[2] });

    const dcRe = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+DROP COLUMN(?:\s+IF EXISTS)?\s+"?(\w+)"?/gi;
    while ((m = dcRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "drop", table: m[1], column: m[2] });

    const rnRe = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi;
    while ((m = rnRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "rename", table: m[1], from: m[2], to: m[3] });

    const rtRe = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+RENAME TO\s+"?(\w+)"?/gi;
    while ((m = rtRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "renameTable", from: m[1], to: m[2] });

    const atRe = /ALTER TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?\s+ALTER COLUMN\s+"?(\w+)"?\s+(?:SET DATA\s+)?TYPE\s+([^\n;,]+)/gi;
    while ((m = atRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "retype", table: m[1], column: m[2], typeSql: m[3].replace(/USING.*/i, "").trim() });

    const diRe = /DROP INDEX(?:\s+IF EXISTS)?\s+"?(\w+)"?/gi;
    while ((m = diRe.exec(clean)) !== null) ops.push({ index: m.index, kind: "dropIndex", name: m[1] });

    const ixRe = /CREATE(\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?\s+ON\s+((?:[^;']|'[^']*')+);/gi;
    while ((m = ixRe.exec(clean)) !== null) {
      ops.push({ index: m.index, kind: "createIndex", unique: !!m[1], name: m[2], onClause: m[3].trim() });
    }

    ops.sort((a, b) => a.index - b.index);

    for (const op of ops) {
      if (op.kind === "create") {
        const t = ensure(op.table);
        if (!rawCreates.has(op.table)) rawCreates.set(op.table, op.stmt);
        for (const frag of splitTopLevel(op.body)) {
          const col = parseColumnDef(frag);
          if (col && !t.has(col.name)) t.set(col.name, col);
        }
      } else if (op.kind === "add") {
        // Feature files often use unquoted identifiers ("ADD COLUMN foo TEXT");
        // normalize to the quoted form parseColumnDef expects.
        let fragment = op.fragment.trim();
        if (!fragment.startsWith('"')) {
          const sp = fragment.indexOf(" ");
          if (sp > 0) fragment = `"${fragment.slice(0, sp)}" ${fragment.slice(sp + 1)}`;
        }
        const col = parseColumnDef(fragment);
        if (col) {
          const t = ensure(op.table);
          if (!t.has(col.name)) t.set(col.name, col);
        }
      } else if (op.kind === "drop") {
        defs.get(op.table)?.delete(op.column);
      } else if (op.kind === "rename") {
        const t = defs.get(op.table);
        if (t && t.has(op.from)) {
          const info = t.get(op.from);
          t.delete(op.from);
          if (!t.has(op.to)) t.set(op.to, { ...info, name: op.to });
        }
      } else if (op.kind === "renameTable") {
        if (defs.has(op.from) && !defs.has(op.to)) {
          defs.set(op.to, defs.get(op.from));
          defs.delete(op.from);
          rawCreates.delete(op.from); // stale name — reconstruction path covers renamed tables
          const i = tableOrder.indexOf(op.from);
          if (i >= 0) tableOrder[i] = op.to;
        }
      } else if (op.kind === "retype") {
        const t = defs.get(op.table);
        if (t && t.has(op.column)) t.get(op.column).typeSql = op.typeSql;
      } else if (op.kind === "dropIndex") {
        indexDefs.delete(op.name);
      } else if (op.kind === "createIndex") {
        indexDefs.set(op.name, `CREATE${op.unique ? " UNIQUE" : ""} INDEX IF NOT EXISTS "${op.name}" ON ${op.onClause};`);
      }
    }
  }

  return { defs, indexDefs, rawCreates, tableOrder };
}

// ════════════════════════════════════════════════════════════════════════════
// EMISSION
// ════════════════════════════════════════════════════════════════════════════

function guarded(statement, label) {
  return [
    "DO $recon$ BEGIN",
    `  ${statement}`,
    `EXCEPTION WHEN others THEN RAISE WARNING 'schema-reconcile skipped %: %', ${sqlLiteral(label)}, SQLERRM;`,
    "END $recon$;",
  ].join("\n");
}

function sqlLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function columnClause(def) {
  // serial/bigserial carry an implicit nextval() default and NOT NULL — adding
  // an explicit DEFAULT alongside would be "multiple default values" (error).
  const isSerial = /^(small|big)?serial$/i.test(def.typeSql.trim());
  let clause = `"${def.name}" ${def.typeSql}`;
  if (isSerial) return clause;
  if (def.defaultSql != null) {
    clause += ` DEFAULT ${def.defaultSql}`;
    if (def.notNull) clause += " NOT NULL";
  } else if (def.notNull) {
    clause += ` DEFAULT ${defaultLiteralForType(def.typeSql)} NOT NULL`;
  }
  return clause;
}

function generate() {
  const entries = loadSources({ excludeReconcile: true });
  const expected = parseSqlFiles(entries);           // authoritative diff set (verifier's own parser)
  const { defs, indexDefs, rawCreates, tableOrder } = extractDefinitions(entries);
  const emittedCols = new Set();                     // "table.column" we emit DDL for (self-check allowance)

  const lines = [];
  lines.push("-- =============================================================================");
  lines.push(`-- Migration: Schema reconciliation for restored production DB (${DATE_TAG})`);
  lines.push("-- GENERATED by scripts/generate-schema-reconcile.cjs — do not edit by hand;");
  lines.push("-- regenerate instead (delete this file, re-run the script with a new --date).");
  lines.push("-- =============================================================================");
  lines.push("-- The restored care_main_db_data volume carries schema_migrations_log /");
  lines.push("-- drizzle.__drizzle_migrations entries from backup time, so care-db-patch-v2");
  lines.push("-- skips every migration as \"already applied\" even though the restored schema");
  lines.push("-- predates later columns/indexes. This file closes that gap in one pass:");
  lines.push("--   1. CREATE TABLE IF NOT EXISTS  (minimal: columns + primary key)");
  lines.push("--   2. ALTER TABLE IF EXISTS ... ADD COLUMN IF NOT EXISTS  (every column)");
  lines.push("--   3. CREATE [UNIQUE] INDEX IF NOT EXISTS  (every index, verbatim source DDL)");
  lines.push("--");
  lines.push("-- Safety: DDL-add only. No DROP / DELETE / TRUNCATE / UPDATE. Fully idempotent");
  lines.push("-- (a second run is a complete no-op). Every statement is wrapped in a DO block");
  lines.push("-- that downgrades errors to warnings, so this file can never abort deployment.");
  lines.push("-- =============================================================================");
  lines.push("");

  let tableCount = 0, colCount = 0, idxCount = 0;

  // ── 1. Missing tables (skip runtime-created ones — verifier exempts them) ──
  lines.push("-- ── 1. Expected tables ──────────────────────────────────────────────────────");
  for (const tblName of tableOrder) {
    if (!expected.tables.has(tblName) || RUNTIME_CREATED_TABLES.has(tblName)) continue;
    const d = defs.get(tblName);
    const colDefs = d ? [...d.values()] : [];
    let stmt = null;
    if (colDefs.length > 0) {
      // Minimal reconstruction: full column definitions + primary key. FKs /
      // CHECKs are deliberately omitted — the verifier doesn't require them
      // and reconstructing them against a drifted DB could fail the CREATE.
      const ti = expected.tables.get(tblName);
      const pkCols = new Set(ti.pks);
      for (const def of colDefs) if (def.isPk) pkCols.add(def.name);
      const colLines = colDefs.map((def) => {
        let clause = columnClause(def);
        if (pkCols.has(def.name) && pkCols.size === 1) clause += " PRIMARY KEY";
        return `  ${clause}`;
      });
      if (pkCols.size > 1) colLines.push(`  PRIMARY KEY (${[...pkCols].map((p) => `"${p}"`).join(", ")})`);
      stmt = `CREATE TABLE IF NOT EXISTS "${tblName}" (\n${colLines.join(",\n")}\n  );`;
      for (const def of colDefs) emittedCols.add(`${tblName}.${def.name}`);
    } else if (rawCreates.has(tblName)) {
      // No parseable column definitions — fall back to the original CREATE
      // TABLE statement verbatim (normalized to IF NOT EXISTS).
      stmt = rawCreates.get(tblName).replace(
        /^CREATE TABLE(?!\s+IF NOT EXISTS)/i,
        "CREATE TABLE IF NOT EXISTS"
      );
    } else {
      continue;
    }
    lines.push(guarded(stmt, `table ${tblName}`));
    lines.push("");
    tableCount++;
  }

  // ── 2. Missing columns ──────────────────────────────────────────────────────
  // Iterates the precise extraction (a superset of the verifier's expected
  // columns — it also parses unquoted identifiers the verifier's regex skips),
  // so drifted tables become fully functional, not just verification-clean.
  const uncovered = [];
  lines.push("-- ── 2. Expected columns ─────────────────────────────────────────────────────");
  for (const tblName of tableOrder) {
    if (!expected.tables.has(tblName)) continue;
    const ti = expected.tables.get(tblName);
    const d = defs.get(tblName) || new Map();
    for (const colName of ti.columns.keys()) {
      if (!d.has(colName)) uncovered.push(`${tblName}.${colName}`);
    }
    for (const def of d.values()) {
      const stmt = `ALTER TABLE IF EXISTS "${tblName}" ADD COLUMN IF NOT EXISTS ${columnClause(def)};`;
      lines.push(guarded(stmt, `${tblName}.${def.name}`));
      emittedCols.add(`${tblName}.${def.name}`);
      colCount++;
    }
    lines.push("");
  }
  if (uncovered.length > 0) {
    console.error(`✗ ${uncovered.length} expected column(s) have no extractable definition — aborting:`);
    for (const u of uncovered) console.error(`  - ${u}`);
    process.exit(1);
  }

  // ── 3. Missing indexes ──────────────────────────────────────────────────────
  lines.push("-- ── 3. Expected indexes ─────────────────────────────────────────────────────");
  for (const [name, stmt] of indexDefs) {
    if (!expected.indexNames.has(name)) continue;
    lines.push(guarded(stmt, `index ${name}`));
    idxCount++;
  }
  lines.push("");

  const sqlOut = lines.join("\n");

  // ── SELF-CHECK: the generated file must not change the expected schema ─────
  const before = expected;
  const after = parseSqlFiles([...entries, { content: sqlOut, tag: OUT_NAME, type: "feature" }]);

  const problems = [];
  let widened = 0;
  const beforeTables = new Set(before.tables.keys());
  const afterTables = new Set(after.tables.keys());
  for (const t of afterTables) if (!beforeTables.has(t)) problems.push(`generated file introduces unexpected table '${t}'`);
  for (const t of beforeTables) if (!afterTables.has(t)) problems.push(`generated file loses expected table '${t}'`);
  for (const [t, ti] of before.tables) {
    const ta = after.tables.get(t);
    if (!ta) continue;
    for (const c of ti.columns.keys()) if (!ta.columns.has(c)) problems.push(`generated file loses expected column ${t}.${c}`);
    for (const c of ta.columns.keys()) {
      if (ti.columns.has(c)) continue;
      // New expectations are only acceptable when this same file also emits
      // the DDL that satisfies them (columns the verifier's quoted-identifier
      // regex missed in the sources but which we add for real). Anything else
      // (e.g. re-adding a column a later migration dropped) is a hard error —
      // it would put the verifier into a permanent-drift loop.
      if (emittedCols.has(`${t}.${c}`)) { widened++; continue; }
      problems.push(`generated file introduces unexpected column ${t}.${c} without emitting DDL for it`);
    }
  }
  for (const i of after.indexNames) if (!before.indexNames.has(i)) problems.push(`generated file introduces unexpected index '${i}'`);
  for (const i of before.indexNames) if (!after.indexNames.has(i)) problems.push(`generated file loses expected index '${i}'`);

  if (problems.length > 0) {
    console.error("✗ Self-check FAILED — not writing file:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (TO_STDOUT) {
    process.stdout.write(sqlOut);
  } else {
    fs.writeFileSync(OUT_PATH, sqlOut, "utf8");
    console.log(`✓ Wrote ${path.relative(REPO_ROOT, OUT_PATH)}`);
  }
  console.error(`✓ Self-check passed — no expectation lost; ${widened} column expectation(s) widened (all satisfied by emitted DDL)`);
  console.error(`  tables: ${tableCount} CREATE IF NOT EXISTS · columns: ${colCount} ADD IF NOT EXISTS · indexes: ${idxCount} CREATE IF NOT EXISTS`);
}

generate();
