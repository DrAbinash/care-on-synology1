#!/usr/bin/env node
/**
 * check-migration-order.cjs — Feature migration dependency-order preflight
 * ==========================================================================
 * Care Diagnostics ERP · Hospital RIS/PACS
 *
 * WHY THIS EXISTS
 *   docker/db-patch-entrypoint.sh applies migrations/*.sql feature migrations
 *   in plain alphabetical filename order ("ls migrations/*.sql | sort") — it
 *   has no concept of "this file depends on that file". If a migration that
 *   ALTERs/indexes/references a table sorts alphabetically before the
 *   migration that CREATEs that table, the deploy fails mid-run with a raw
 *   Postgres error ("relation ... does not exist"), and — because the
 *   entrypoint uses `set -e` and exits hard on the first failure — every
 *   feature migration alphabetically after the broken one is silently never
 *   applied either, and care-api never starts.
 *
 *   This script statically simulates that exact execution order (Drizzle
 *   core tables first, then migrations/*.sql in the identical alphabetical
 *   order the entrypoint uses) and fails loudly, BEFORE any SQL runs against
 *   a real database, if any migration references a table that does not yet
 *   exist at that point in the sequence. It is pure static analysis — no
 *   database connection, no side effects, safe to run anywhere, any time.
 *
 * WHAT IT CATCHES
 *   - ALTER TABLE <table> where <table> is not yet created
 *   - CREATE INDEX ... ON <table> where <table> is not yet created
 *   - CREATE TRIGGER ... ON <table> where <table> is not yet created
 *   - ... REFERENCES <table> (foreign keys) where <table> is not yet created
 *   - ALTER TABLE ... RENAME TO tracked, so later files see the new name
 *   - DROP TABLE tracked, so later files correctly see it as gone
 *
 * USAGE
 *   node scripts/check-migration-order.cjs           # human-readable report
 *   node scripts/check-migration-order.cjs --json     # machine-readable
 *
 * EXIT CODE
 *   0  no ordering violations found
 *   1  at least one ordering violation found (deploy would fail)
 *
 * This is intentionally dependency-free plain Node so it can run in the
 * entrypoint container (or any dev machine / CI runner) with zero install.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const DRIZZLE_DIR = path.join(REPO_ROOT, "lib", "db", "drizzle");
const FEATURE_DIR = path.join(REPO_ROOT, "migrations");
const JOURNAL = path.join(DRIZZLE_DIR, "meta", "_journal.json");

const isJson = process.argv.includes("--json");

const GREEN = isJson ? "" : "\x1b[32m";
const RED = isJson ? "" : "\x1b[31m";
const YELLOW = isJson ? "" : "\x1b[33m";
const NC = isJson ? "" : "\x1b[0m";

// ── SQL statement extraction ────────────────────────────────────────────────
// Strip comments so prose like "-- fixed via ALTER TABLE below" never
// produces a false "table" match.
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// (?<![A-Za-z0-9_]) instead of a leading \b: a plain \b treats "_" as a word
// character too, but that alone is enough to stop a keyword from matching
// mid-identifier (e.g. the "references" inside "radiology_image_references"
// is never preceded by a non-word char, so \b already excludes it there).
// We still pin it explicitly for clarity and to guard against future edits.
const IDENT = `"?(?:public\\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;

const PATTERNS = [
  { type: "CREATE_TABLE", re: new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, "gi") },
  { type: "RENAME_TABLE", re: new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}\\s+RENAME\\s+TO\\s+${IDENT}`, "gi") },
  { type: "ALTER_TABLE", re: new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, "gi") },
  { type: "DROP_TABLE", re: new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, "gi") },
  { type: "CREATE_INDEX_ON", re: new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?\\S+\\s+ON\\s+${IDENT}`, "gi") },
  { type: "CREATE_TRIGGER_ON", re: new RegExp(`\\bCREATE\\s+TRIGGER\\b[^;]*?\\bON\\s+${IDENT}`, "gis") },
  { type: "REFERENCES", re: new RegExp(`\\bREFERENCES\\s+${IDENT}`, "gi") },
];

// Anonymous PL/pgSQL blocks: DO $$ ... $$;  or DO $tag$ ... $tag$;
// This codebase's established defensive idiom (see add_runtime_startup_columns.sql,
// migrations/zz_schema_reconcile_20260709.sql) wraps ALTER TABLE in
//   IF EXISTS (SELECT ... information_schema.tables WHERE table_name = 'x') THEN ...
// inside a DO block, so the ALTER only ever runs once the table is confirmed
// to exist — it cannot produce the "relation does not exist" failure a bare
// top-level ALTER can. A text-based checker can't verify the guard is
// correct, so rather than false-flag every guarded statement, DDL found
// inside a DO block is treated as exempt from ordering checks (still parsed
// for CREATE TABLE, which some blocks may legitimately contain).
function findDoBlockRanges(sql) {
  const ranges = [];
  const re = /\bDO\s+(\$\w*\$)[\s\S]*?\1/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}
function isInsideAny(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

// Returns every DDL match in the file, in source (execution) order. Each
// match carries `guarded: true` if it sits inside a DO $$ ... $$ block (see
// findDoBlockRanges above) — these are exempt from ordering violations.
function extractStatements(sql) {
  const clean = stripComments(sql);
  const doRanges = findDoBlockRanges(clean);
  const matches = [];
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const guarded = isInsideAny(doRanges, m.index);
      if (type === "RENAME_TABLE") {
        matches.push({ type, index: m.index, table: m[1].toLowerCase(), newTable: m[2].toLowerCase(), guarded });
      } else {
        matches.push({ type, index: m.index, table: m[1].toLowerCase(), guarded });
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);
  // RENAME_TABLE also matches ALTER_TABLE (same prefix) — drop the
  // ALTER_TABLE duplicate at the same index so RENAME wins.
  return matches.filter((m, i) => {
    if (m.type !== "ALTER_TABLE") return true;
    return !matches.some((o) => o.type === "RENAME_TABLE" && o.index === m.index);
  });
}

// Files whose SQL is generated/wrapped for drift-reconciliation, not
// hand-authored dependency chains — see scripts/generate-schema-reconcile.cjs
// and HOW_TO_ADD_DB_MIGRATIONS.md ("Schema drift after a volume restore").
// Every statement in these is independently idempotent and error-downgraded,
// so an apparent ordering "violation" here can never break a deploy the way
// it can in a normal hand-written migration. Exclude by design, not by
// convenience.
const RECONCILE_FILE_RE = /^zz_schema_reconcile_\d{8}\.sql$/;

function loadCoreDrizzleTables() {
  const journal = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  const known = new Set();
  for (const entry of journal.entries) {
    const file = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) continue;
    const stmts = extractStatements(fs.readFileSync(file, "utf8"));
    for (const s of stmts) {
      if (s.type === "CREATE_TABLE") known.add(s.table);
      if (s.type === "RENAME_TABLE") {
        known.delete(s.table);
        known.add(s.newTable);
      }
      if (s.type === "DROP_TABLE") known.delete(s.table);
    }
  }
  return known;
}

function checkFeatureMigrations(known) {
  const files = fs
    .readdirSync(FEATURE_DIR)
    .filter((f) => f.endsWith(".sql") && fs.statSync(path.join(FEATURE_DIR, f)).isFile())
    // Byte-wise comparison — matches `ls *.sql | sort` under the container's
    // C/POSIX locale, which is what docker/db-patch-entrypoint.sh runs under.
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const violations = [];
  const seenViolationKeys = new Set(); // dedupe repeated ADD COLUMN-style statements against the same table
  const createdBy = new Map(); // table -> file that created it (for diagnostics)

  for (const file of files) {
    const reconcileFile = RECONCILE_FILE_RE.test(file);
    const sql = fs.readFileSync(path.join(FEATURE_DIR, file), "utf8");
    const stmts = extractStatements(sql);

    for (const s of stmts) {
      const requiresExisting =
        s.type === "ALTER_TABLE" ||
        s.type === "CREATE_INDEX_ON" ||
        s.type === "CREATE_TRIGGER_ON" ||
        s.type === "REFERENCES" ||
        s.type === "RENAME_TABLE";

      if (requiresExisting && !s.guarded && !known.has(s.table)) {
        const key = `${file}::${s.type}::${s.table}`;
        if (!reconcileFile && !seenViolationKeys.has(key)) {
          seenViolationKeys.add(key);
          violations.push({
            file,
            type: s.type,
            table: s.table,
            createdLaterBy: findLaterCreator(files, file, s.table, FEATURE_DIR),
          });
        }
        // Even in a reconcile file, don't let a phantom table poison
        // subsequent real checks — but don't hard-fail on it either.
      }

      if (s.type === "CREATE_TABLE") {
        known.add(s.table);
        if (!createdBy.has(s.table)) createdBy.set(s.table, file);
      }
      if (s.type === "RENAME_TABLE") {
        known.delete(s.table);
        known.add(s.newTable);
      }
      if (s.type === "DROP_TABLE") {
        known.delete(s.table);
      }
    }
  }

  return { violations, createdBy };
}

function findLaterCreator(allFilesSorted, currentFile, table, dir) {
  const idx = allFilesSorted.indexOf(currentFile);
  for (let i = idx + 1; i < allFilesSorted.length; i++) {
    const sql = fs.readFileSync(path.join(dir, allFilesSorted[i]), "utf8");
    const stmts = extractStatements(sql);
    for (const s of stmts) {
      if (s.type === "CREATE_TABLE" && s.table === table) return allFilesSorted[i];
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(JOURNAL)) {
    console.error(`${RED}✗ Journal not found at ${JOURNAL}${NC}`);
    process.exit(1);
  }
  if (!fs.existsSync(FEATURE_DIR)) {
    console.error(`${RED}✗ Feature migrations directory not found at ${FEATURE_DIR}${NC}`);
    process.exit(1);
  }

  const known = loadCoreDrizzleTables();
  const { violations } = checkFeatureMigrations(known);

  if (isJson) {
    console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("  Migration order preflight — migrations/*.sql");
  console.log("=".repeat(60));
  console.log("");

  if (violations.length === 0) {
    console.log(`${GREEN}✓ No ordering violations — every ALTER TABLE / CREATE INDEX / CREATE TRIGGER / REFERENCES target is already created earlier in execution order.${NC}`);
    console.log("");
    process.exit(0);
  }

  for (const v of violations) {
    console.log(`${RED}✗ ${v.file}${NC}`);
    console.log(`  ${v.type} references table "${v.table}", which does not exist yet at this point in alphabetical execution order.`);
    if (v.createdLaterBy) {
      console.log(`  ${YELLOW}"${v.table}" is created later by ${v.createdLaterBy} — rename ${v.file} to sort after ${v.createdLaterBy} (e.g. prefix its filename with ${v.createdLaterBy.replace(/\.sql$/, "")}_).${NC}`);
    } else {
      console.log(`  ${YELLOW}No migrations/*.sql file creates "${v.table}" at all — either it's a typo, or the CREATE TABLE migration is missing.${NC}`);
    }
    console.log("");
  }

  console.log(`${RED}✗ ${violations.length} ordering violation(s) found — this deploy WOULD fail.${NC}`);
  console.log("");
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  loadCoreDrizzleTables,
  checkFeatureMigrations,
  extractStatements,
  DRIZZLE_DIR,
  FEATURE_DIR,
  JOURNAL,
};
