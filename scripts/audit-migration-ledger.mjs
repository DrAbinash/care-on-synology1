#!/usr/bin/env node
/**
 * audit-migration-ledger.mjs — READ-ONLY audit of the migration ledger
 * ======================================================================
 *
 * WHY THIS EXISTS
 * `docker/db-patch-entrypoint.sh` records a migration as applied in
 * `public.schema_migrations_log` (and Drizzle ones in
 * `drizzle.__drizzle_migrations`). Until PR #955 the Drizzle step ran with
 * `ON_ERROR_STOP=0` and threw its output away, so a migration whose statements
 * failed was still recorded, still hashed, and therefore SKIPPED ON EVERY LATER
 * DEPLOY. The fix stops that happening again; it cannot say whether it already
 * happened. A database deployed before the fix may hold ledger rows that assert
 * a schema the database does not have.
 *
 * This answers that question without changing anything. For every migration the
 * ledger claims was applied, it reads the SQL file that migration names,
 * extracts the schema effects that file declares, folds them in execution order
 * (so a DROP followed by a later re-ADD resolves correctly), and compares the
 * result with the live catalog. Anything the ledger says exists and does not is
 * reported by migration, object and kind.
 *
 * IT IS READ-ONLY BY CONSTRUCTION, not by convention:
 *   - the session is opened with `default_transaction_read_only=on`, so any
 *     accidental write aborts with a database error rather than running;
 *   - the script issues SELECTs against information_schema / pg_catalog and the
 *     two ledger tables, and nothing else;
 *   - it never UPDATEs, DELETEs or INSERTs a ledger row, never re-runs a
 *     migration, and never applies DDL. Remediation is a documented, human
 *     decision (see docs/MIGRATION_LEDGER_AUDIT.md).
 *
 * USAGE
 *   DATABASE_URL=postgresql://erp@127.0.0.1:5445/diagnostic_erp \
 *     node scripts/audit-migration-ledger.mjs [--json=out.json] [--strict]
 *
 *   --json=FILE   also write the machine-readable findings
 *   --strict      exit 1 when any finding is not informational
 *
 * Exit status: 0 when the audit ran (findings are printed regardless), 1 when
 * the audit could not run, and 1 under --strict if there is a finding that
 * needs a decision. An audit that finds problems must not look like a crash,
 * and a crash must not look like a clean audit.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const DRIZZLE_DIR = path.join(REPO, "lib", "db", "drizzle");
const FEATURE_DIR = path.join(REPO, "migrations");
const JOURNAL = path.join(DRIZZLE_DIR, "meta", "_journal.json");

const argv = process.argv.slice(2);
const jsonOut = (argv.find((a) => a.startsWith("--json=")) || "").split("=")[1] || null;
const strict = argv.includes("--strict");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const NC = "\x1b[0m";

// ── What the clinic cannot run without ───────────────────────────────────────
// A missing object here is not a cosmetic drift: these are the tables the
// migration container itself refuses to start the API without, plus the
// identifiers the reporting and billing paths write on every request.
const CRITICAL_TABLES = [
  "users", "clinic_settings", "patients", "bills", "payments", "orders",
  "order_tests", "diagnostic_tests", "doctors", "ledgers", "radiology_worklist",
  "radiology_studies", "patient_reports", "feature_flags",
  "schema_migrations_log", "schema_deploy_state", "system_database_identity",
];
const CRITICAL_COLUMNS = [
  ["patient_reports", "study_id"],
  ["patient_reports", "patient_id"],
  ["patient_reports", "structured_json"],
  ["radiology_worklist", "accession_number"],
  ["radiology_worklist", "study_instance_uid"],
  ["radiology_worklist", "study_uid_provenance"],
  ["radiology_studies", "accession_number"],
  ["radiology_studies", "patient_id"],
  ["patients", "patient_id"],
  ["bills", "bill_number"],
  ["purchase_invoices", "id"],
  ["radiology_image_references", "presentation_json"],
];

// ── Effect extraction ────────────────────────────────────────────────────────
// Deliberately conservative: an effect is asserted only when the statement is
// plain DDL at the top level. Anything inside a DO $$ … $$ block is conditional
// on a runtime check, so it is counted but never used to accuse a migration.
// Every group this parser reads is NAMED, and every group that is not read is
// NON-capturing. Numbered groups shift silently when an identifier sub-pattern
// grows a group of its own, and the parser then reads the wrong token out of its
// own match: that is how `ALTER TABLE x ADD COLUMN y` once produced a finding
// about a column called `x.x`, and how `CREATE TABLE "public"."t"` produced one
// about a table called `public`. scripts/audit-migration-ledger.test.mjs pins
// both shapes against the real shipped SQL.
const WORD = String.raw`[a-zA-Z_][a-zA-Z0-9_]*`;
/** one identifier, possibly double-quoted, capturing nothing */
const PART = String.raw`"?(?:${WORD})"?`;
/** a relation, possibly schema-qualified: tbl | "tbl" | public.tbl | "public"."tbl" */
const REL = String.raw`(?<rel>${PART}(?:\.${PART})*)`;
/** a single possibly-quoted object name (column, index, constraint) */
const OBJ = String.raw`(?<obj>${PART})`;
/** the same, for the second name in a RENAME */
const TO = String.raw`(?<to>${PART})`;
const IFX = String.raw`(?:IF\s+EXISTS\s+)?`;
const IFNX = String.raw`(?:IF\s+NOT\s+EXISTS\s+)?`;
// `ADD`/`DROP` are followed by either a column name or a keyword, and the
// keywords are themselves valid identifiers, so the column pattern has to refuse
// them. Unnamed `ADD PRIMARY KEY (x)` creates a constraint Postgres names for us,
// so it is not asserted at all — the audit stays silent rather than guessing.
const NOT_KEYWORD = String.raw`(?!CONSTRAINT\b|CHECK\b|PRIMARY\b|FOREIGN\b|UNIQUE\b|EXCLUDE\b|DEFAULT\b|NOT\b|NULL\b|GENERATED\b|IDENTITY\b|SET\b|OWNER\b)`;

const EFFECT_PATTERNS = [
  {
    kind: "table",
    re: new RegExp(String.raw`CREATE\s+(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+${IFNX}${REL}`, "gi"),
  },
  {
    kind: "table",
    re: new RegExp(String.raw`DROP\s+TABLE\s+${IFX}${REL}`, "gi"),
    removes: true,
  },
  {
    kind: "table",
    re: new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${REL}\s+RENAME\s+TO\s+${TO}`, "gi"),
    rename: "table",
  },
  {
    kind: "column",
    re: new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${REL}\s+ADD\s+(?:COLUMN\s+)?${IFNX}${NOT_KEYWORD}${OBJ}`, "gi"),
  },
  {
    kind: "column",
    re: new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${REL}\s+DROP\s+(?:COLUMN\s+)?${IFX}${NOT_KEYWORD}${OBJ}`, "gi"),
    removes: true,
  },
  {
    kind: "column",
    re: new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${REL}\s+RENAME\s+COLUMN\s+${OBJ}\s+TO\s+${TO}`, "gi"),
    rename: "column",
  },
  {
    kind: "index",
    re: new RegExp(String.raw`CREATE\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+(?:CONCURRENTLY\s+)?${IFNX}${REL}`, "gi"),
  },
  {
    kind: "index",
    re: new RegExp(String.raw`DROP\s+(?:INDEX|KEY)\s+(?:CONCURRENTLY\s+)?${IFX}${REL}`, "gi"),
    removes: true,
  },
  {
    kind: "constraint",
    // The clause and column list are captured because Postgres does not promise
    // the name survives: it truncates identifiers over 63 bytes, and a later
    // migration may reinstall the same key under a new name. Matching the effect
    // (table + kind + columns) is what the audit is really asserting.
    re: new RegExp(
      String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${REL}\s+ADD\s+CONSTRAINT\s+${OBJ}\s*`
        + String.raw`(?<clause>FOREIGN\s+KEY|PRIMARY\s+KEY|UNIQUE|CHECK|EXCLUDE)?`
        + String.raw`\s*(?<cols>\([^)]*\))?`,
      "gi",
    ),
  },
  {
    kind: "constraint",
    re: new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${REL}\s+DROP\s+CONSTRAINT\s+${IFX}${OBJ}`, "gi"),
    removes: true,
  },
  {
    kind: "view",
    re: new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+${IFNX}${REL}`, "gi"),
  },
  {
    kind: "view",
    re: new RegExp(String.raw`DROP\s+(?:MATERIALIZED\s+)?VIEW\s+${IFX}${REL}`, "gi"),
    removes: true,
  },
];

/** Strip comments and guarded bodies so a conditional statement is never asserted. */
function plainSql(text) {
  const withoutBodies = text
    .replace(/DO\s*\$\$[\s\S]*?\$\$\s*(?:;\s*)?/gi, " ")
    // Function/trigger bodies are executed at runtime, not at migrate time, and
    // their inner DDL is conditional. Remove the whole dollar-quoted region, not
    // just its markers, or an EXECUTE string inside one would be parsed as DDL.
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, " ");
  return withoutBodies
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ");
}

function extractEffects(text) {
  const sql = plainSql(text);
  const found = [];
  for (const { kind, re, removes, rename } of EFFECT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql))) {
      const rel = norm(m.groups.rel);
      const obj = norm(m.groups.obj);
      // `pos` is what makes the fold honest. Patterns are tried one DDL form at a
      // time, so pushing in pattern order would put every DROP before every CREATE.
      // 0006_jazzy_mojo drops `tat_modality_idx` at line 2143 and recreates it at
      // 2438; folded in pattern order that reads as "dropped, and it is still
      // there" about an index that exists.
      const pos = m.index;
      if (rename) {
        // A rename removes the old name and creates the new one, in that order.
        if (rename === "column") {
          found.push({ pos, kind, table: rel, object: obj, removes: true });
          found.push({ pos: pos + 0.5, kind, table: rel, object: norm(m.groups.to), removes: false });
        } else {
          found.push({ pos, kind, object: rel, removes: true });
          found.push({ pos: pos + 0.5, kind, object: norm(m.groups.to), removes: false });
        }
        continue;
      }
      if (kind === "column" || kind === "constraint") {
        found.push({
          pos, kind, table: rel, object: obj, removes: !!removes,
          clause: (m.groups.clause || "").replace(/\s+/g, " ").toLowerCase(),
          cols: normCols(m.groups.cols),
        });
      } else {
        // table / view / index are addressed by their own name, which the pattern
        // captures as `rel` (indexes may be written schema-qualified).
        found.push({ pos, kind, object: rel || obj, removes: !!removes });
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  // Sort by position in the file: that is the order Postgres executed them in,
  // and it is the only order in which a drop-then-recreate resolves correctly.
  const effects = found.sort((a, b) => a.pos - b.pos).map(({ pos, ...e }) => e);
  const guarded = (text.match(/DO\s*\$\$/gi) || []).length;
  return { effects, guardedBlocks: guarded };
}

const norm = (raw) => String(raw || "").replace(/"/g, "").toLowerCase();
/** `(a, "b")` → `a,b` — comparable with the column list Postgres reports. */
const normCols = (raw) =>
  String(raw || "").replace(/^[^(]*\(/, "").replace(/\)[\s\S]*$/, "").replace(/"/g, "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).join(",");
/**
 * Postgres truncates every identifier to 63 bytes and does not tell the author.
 * A migration that declares `…_outsource_dispatch_batches_id_fk` lands as the
 * first 63 characters, so comparing the declared name verbatim accuses a
 * perfectly applied migration of never having run.
 */
const pgTrunc = (name) =>
  String(name).split(".").map((p) => p.slice(0, 63)).join(".");
const splitName = (name) => {
  const parts = name.split(".");
  return parts.length > 1
    ? { schema: parts[0], object: parts.slice(1).join(".") }
    : { schema: "public", object: name };
};

// ── Disk side ────────────────────────────────────────────────────────────────
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function journalTags() {
  if (!fs.existsSync(JOURNAL)) return [];
  const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  return (j.entries || []).map((e) => e.tag);
}

function filesOnDisk() {
  const map = new Map();
  let order = 0;
  for (const tag of journalTags()) {
    const file = path.join(DRIZZLE_DIR, `${tag}.sql`);
    if (fs.existsSync(file)) map.set(tag, { kind: "drizzle", file, name: tag, order: order++ });
  }
  const feature = fs.existsSync(FEATURE_DIR)
    ? fs.readdirSync(FEATURE_DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];
  for (const f of feature) {
    map.set(f, { kind: "feature", file: path.join(FEATURE_DIR, f), name: f, order: order++ });
  }
  return map;
}

// ── Live database side ───────────────────────────────────────────────────────
async function liveSchema(client) {
  const tables = new Set();
  const views = new Set();
  const columns = new Set();
  const indexes = new Set();
  const constraints = new Set();
  /** `${schema}.${table}:${clause}:${cols}` → the names that satisfy it */
  const constraintEq = new Map();

  const t = await client.query(
    `SELECT table_schema, table_name, table_type FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')`,
  );
  for (const r of t.rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (r.table_type === "VIEW") views.add(key);
    else tables.add(key);
  }
  const c = await client.query(
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema')`,
  );
  for (const r of c.rows) columns.add(`${r.table_schema}.${r.table_name}.${r.column_name}`);
  const i = await client.query(
    `SELECT schemaname, indexname FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog')`,
  );
  for (const r of i.rows) indexes.add(`${r.schemaname}.${r.indexname}`);
  const k = await client.query(
    `SELECT n.nspname AS schema, c.conname AS name, c.contype AS type,
            rel.relname AS table_name,
            (SELECT string_agg(a.attname, ',' ORDER BY x.ord)
               FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS cols
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       JOIN pg_class rel ON rel.oid = c.conrelid
      WHERE n.nspname NOT IN ('pg_catalog')`,
  );
  for (const r of k.rows) {
    constraints.add(`${r.schema}.${r.name}`);
    // contype → the clause the DDL wrote. CHECK constraints keep their
    // expression in a separate catalog column, so they are matched by name only.
    const clause = { f: "foreign key", p: "primary key", u: "unique" }[r.type];
    if (clause && r.cols) {
      const key = `${r.schema}.${r.table_name}:${clause}:${r.cols}`;
      if (!constraintEq.has(key)) constraintEq.set(key, []);
      constraintEq.get(key).push(r.name);
    }
  }
  return { tables, views, columns, indexes, constraints, constraintEq };
}

/**
 * Is this object in the live catalog?
 *
 * Two facts about Postgres shape this, and getting either wrong turns a correctly
 * applied migration into a false accusation:
 *   - identifiers are truncated to 63 bytes silently, so the declared name is
 *     looked up as the name the server could actually have stored;
 *   - an effect written WITHOUT a schema is resolved through search_path, so an
 *     unqualified name is accepted wherever it lives rather than only in `public`.
 */
function has(set, name) {
  const n = splitName(pgTrunc(name));
  if (set.has(`${n.schema}.${n.object}`)) return true;
  if (n.schema === "public" && !String(name).includes(".")) {
    for (const key of set) if (key.endsWith(`.${n.object}`)) return true;
  }
  return false;
}

/**
 * The same key, held under a different name.
 *
 * A migration's constraint effect is its referential/integrity behaviour on named
 * columns. When the clinic later reinstalls that key under a new name — which is
 * exactly what `zzzzzzz_bill_dependent_referential_integrity.sql` does, replacing
 * Drizzle's `…_bills_id_fk` with an `ON DELETE SET NULL` version — the original
 * statement did run. Reporting it as missing would be a false alarm about a
 * migration that is not broken, so the audit reports the name change as
 * informational and keeps the critical list for objects that are genuinely absent.
 */
function equivalentConstraintName(live, effect) {
  if (!effect.clause || !effect.cols) return null;
  const t = splitName(pgTrunc(effect.table));
  const key = `${t.schema}.${t.object}:${effect.clause}:${effect.cols}`;
  if (live.constraintEq.has(key)) return live.constraintEq.get(key).join(", ");
  if (t.schema === "public" && !String(effect.table).includes(".")) {
    const suffix = `:${effect.clause}:${effect.cols}`;
    for (const [k, names] of live.constraintEq) {
      if (!k.endsWith(suffix)) continue;
      const rel = k.slice(0, -suffix.length);
      if (rel === t.object || rel.endsWith(`.${t.object}`)) return names.join(", ");
    }
  }
  return null;
}

function present(live, effect) {
  if (effect.kind === "table") return has(live.tables, effect.object);
  if (effect.kind === "view") return has(live.views, effect.object) || has(live.tables, effect.object);
  if (effect.kind === "index") return has(live.indexes, effect.object);
  if (effect.kind === "constraint") {
    return has(live.constraints, effect.object) || equivalentConstraintName(live, effect) !== null;
  }
  const tbl = splitName(pgTrunc(effect.table));
  const col = splitName(pgTrunc(effect.object));
  if (live.columns.has(`${tbl.schema}.${tbl.object}.${col.object}`)) return true;
  if (tbl.schema === "public" && !String(effect.table).includes(".")) {
    for (const key of live.columns) {
      if (key.endsWith(`.${tbl.object}.${col.object}`)) return true;
    }
  }
  return false;
}

function label(effect) {
  if (effect.kind === "column") return `column ${effect.table}.${effect.object}`;
  if (effect.kind === "constraint") return `constraint ${effect.object} on ${effect.table}`;
  return `${effect.kind} ${effect.object}`;
}

/**
 * Only migrations the ledger claims were applied are judged. A file that has not
 * run yet is EXPECTED to be missing objects — accusing it would bury the one line
 * that matters. Order is execution order: Drizzle journal order first, then the
 * feature files as the entrypoint's alphabetical loop reaches them.
 */
function recordedEffectInputs(files, recordedNames) {
  return files
    .filter((f) => recordedNames.has(f.name))
    .sort((a, b) => a.order - b.order)
    .map(({ name, text }) => ({ name, text }));
}

/**
 * Fold every recorded migration's declared effects in execution order.
 *
 * Exported separately from the database read so the folding can be tested with a
 * synthetic catalog: the question "would this audit notice a migration that was
 * recorded but never applied" must be answerable without a database, because that
 * is the only version of it that runs in CI.
 */
function foldRecordedEffects(entries) {
  const lastWriter = new Map();
  let asserted = 0;
  let guarded = 0;
  for (const { name, text } of entries) {
    const { effects, guardedBlocks } = extractEffects(text);
    guarded += guardedBlocks;
    for (const e of effects) {
      asserted++;
      // Later statements win: a column dropped in 0010 and re-added in 0040 is
      // expected to exist, and accusing 0010 of that is a false alarm.
      lastWriter.set(effectKey(e), { ...e, migration: name });
    }
  }
  return { lastWriter, asserted, guarded };
}

function effectFindings(folded, live) {
  const out = [];
  for (const e of folded.lastWriter.values()) {
    const there = present(live, e);
    // A recorded DROP whose target is still present means the statement never
    // ran — the same false-completion this audit exists to find. A recorded
    // CREATE whose object is absent means the same thing about that statement.
    if (e.removes ? there : !there) {
      out.push({
        severity: "critical",
        code: "RECORDED_BUT_ABSENT",
        migration: e.migration,
        detail: `${label(e)} is ${e.removes ? "still there, although" : "missing, although"} the ledger records ${e.migration} as applied`,
      });
      continue;
    }
    // Present, but not under the name the file declared. That is a fact worth
    // seeing and not a failure: it means the effect ran and something later
    // renamed or replaced it.
    if (!e.removes && e.kind === "constraint" && !has(live.constraints, e.object)) {
      out.push({
        severity: "info",
        code: "CONSTRAINT_UNDER_OTHER_NAME",
        migration: e.migration,
        detail: `${label(e)} is absent by that name, but ${equivalentConstraintName(live, e)} holds the same ${e.clause} on ${e.table}(${e.cols}) — the effect is applied, the identifier is not`,
      });
    }
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(`${RED}✗ DATABASE_URL is not set — the audit reads a database, it does not create one.${NC}`);
    process.exit(1);
  }
  const { Client } = (await import("pg")).default;
  const client = new Client({
    connectionString: url,
    options: "-c default_transaction_read_only=on",
  });
  await client.connect();

  const ro = await client.query("SHOW default_transaction_read_only");
  console.log("=".repeat(66));
  console.log("  CARE ERP — migration ledger audit (read-only)");
  console.log("=".repeat(66));
  console.log(`  database          : ${(await client.query("SELECT current_database() d")).rows[0].d}`);
  console.log(`  server            : ${(await client.query("SHOW server_version")).rows[0].server_version}`);
  console.log(`  session read-only : ${ro.rows[0].default_transaction_read_only}`);
  if (ro.rows[0].default_transaction_read_only !== "on") {
    console.log(`${RED}✗ the session is not read-only — aborting before it can write anything${NC}`);
    await client.end();
    process.exit(1);
  }

  const hasTable = async (rel) =>
    (await client.query("SELECT to_regclass($1) IS NOT NULL AS e", [rel])).rows[0].e;

  const ledgerExists = await hasTable("public.schema_migrations_log");
  const drizzleExists = await hasTable("drizzle.__drizzle_migrations");
  if (!ledgerExists) {
    console.log(`\n${YEL}! public.schema_migrations_log does not exist.${NC}`);
    console.log("  This database has never been migrated by care-db-patch-v2 (it was");
    console.log("  created by `drizzle-kit push`, a restore, or a manual path). There is");
    console.log("  no ledger to audit, which is itself the finding: nothing records what");
    console.log("  was applied, so nothing can be compared with what is present.");
  }

  const logRows = ledgerExists
    ? (await client.query("SELECT name, kind, sha256, applied_at FROM public.schema_migrations_log ORDER BY id")).rows
    : [];
  const drizzleRows = drizzleExists
    ? (await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows
    : [];
  const deployState = (await hasTable("schema_deploy_state"))
    ? Object.fromEntries((await client.query("SELECT key, value FROM public.schema_deploy_state")).rows.map((r) => [r.key, r.value]))
    : {};
  const identity = (await hasTable("system_database_identity"))
    ? (await client.query("SELECT app_name, environment, instance_id FROM public.system_database_identity WHERE id = 1")).rows[0] ?? null
    : null;

  console.log(`  ledger rows       : ${logRows.length} (${logRows.filter((r) => r.kind === "feature").length} feature, ${logRows.filter((r) => r.kind === "drizzle").length} drizzle)`);
  console.log(`  drizzle hashes    : ${drizzleRows.length}`);
  console.log(`  db_patch_ok       : ${deployState.db_patch_ok ?? "(absent)"}`);
  console.log(`  identity          : ${identity ? `${identity.app_name}/${identity.environment}` : "(unstamped)"}`);

  const disk = filesOnDisk();
  const live = await liveSchema(client);
  const findings = [];

  // 1. Ledger ↔ disk agreement.
  const recordedNames = new Set();
  for (const row of logRows) {
    recordedNames.add(row.name);
    const entry = disk.get(row.name);
    if (!entry) {
      findings.push({ severity: "info", code: "ORPHAN_RECORD", migration: row.name, detail: "the ledger records this migration but no file with that name exists in the repository, so its declared effects cannot be verified" });
      continue;
    }
    const now = sha256(entry.file);
    if (now !== row.sha256) {
      findings.push({
        severity: "warn",
        code: "CONTENT_DRIFT",
        migration: row.name,
        detail: `recorded sha256 ${String(row.sha256).slice(0, 12)} ≠ file ${now.slice(0, 12)} — care-db-patch-v2 updates the hash and does NOT re-apply, so the database holds the OLD content's effects`,
      });
    }
  }
  for (const [name, entry] of disk) {
    if (!recordedNames.has(name)) {
      findings.push({ severity: "info", code: "NOT_IN_LEDGER", migration: name, detail: `present on disk (${entry.kind}) but the ledger has no row for it — it will be applied on the next deploy` });
    }
  }

  // 2. Declared effects vs the live catalog, folded in execution order.
  const ordered = recordedEffectInputs(
    [...disk.entries()].map(([name, entry]) => ({ name, order: entry.order, text: fs.readFileSync(entry.file, "utf8") })),
    recordedNames,
  );

  const folded = foldRecordedEffects(ordered);
  findings.push(...effectFindings(folded, live));

  // 3. The objects the API refuses to start without, named explicitly.
  for (const t of CRITICAL_TABLES) {
    if (!live.tables.has(`public.${t}`) && !live.views.has(`public.${t}`)) {
      findings.push({ severity: "critical", code: "CRITICAL_TABLE_MISSING", migration: "(none)", detail: `required table public.${t} does not exist` });
    }
  }
  for (const [tbl, col] of CRITICAL_COLUMNS) {
    if (live.tables.has(`public.${tbl}`) && !live.columns.has(`public.${tbl}.${col}`)) {
      findings.push({ severity: "critical", code: "CRITICAL_COLUMN_MISSING", migration: "(none)", detail: `required column ${tbl}.${col} does not exist` });
    }
  }

  // 4. Drizzle hashes: the ledger and drizzle.__drizzle_migrations must agree.
  const ledgerDrizzle = new Set(logRows.filter((r) => r.kind === "drizzle").map((r) => r.sha256));
  for (const r of drizzleRows) if (!ledgerDrizzle.has(r.hash)) {
    findings.push({ severity: "warn", code: "DRIZZLE_HASH_UNMATCHED", migration: "(drizzle)", detail: `drizzle.__drizzle_migrations holds hash ${String(r.hash).slice(0, 12)} which no schema_migrations_log row explains` });
  }
  for (const row of logRows.filter((r) => r.kind === "drizzle")) {
    if (!drizzleRows.some((d) => d.hash === row.sha256)) {
      findings.push({ severity: "warn", code: "LEDGER_ROW_UNMATCHED", migration: row.name, detail: "schema_migrations_log records this Drizzle migration but drizzle.__drizzle_migrations has no hash for it — the two trackers disagree about what has run" });
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const bySeverity = { critical: [], warn: [], info: [] };
  for (const f of findings) bySeverity[f.severity].push(f);

  console.log(`\n  effects asserted  : ${folded.asserted} across ${ordered.length} recorded migrations (${folded.guarded} guarded DO-blocks skipped)`);
  console.log(`  live objects      : ${live.tables.size} tables, ${live.columns.size} columns, ${live.indexes.size} indexes, ${live.constraints.size} constraints\n`);

  const glyph = { critical: `${RED}✗${NC}`, warn: `${YEL}!${NC}`, info: `${GREEN}·${NC}` };
  for (const sev of ["critical", "warn", "info"]) {
    if (!bySeverity[sev].length) continue;
    console.log(`${sev.toUpperCase()} (${bySeverity[sev].length})`);
    for (const f of bySeverity[sev]) console.log(`  ${glyph[sev]} [${f.code}] ${f.detail}`);
    console.log("");
  }
  if (!findings.length) {
    console.log(`${GREEN}✓ No inconsistency: every effect the ledger's migrations declare is present in this database.${NC}`);
    console.log("  (This says the recorded migrations match the schema. It cannot say a");
    console.log("   migration ran that the ledger never recorded — see NOT_IN_LEDGER.)\n");
  }

  console.log("=".repeat(66));
  console.log(`  ${bySeverity.critical.length} critical, ${bySeverity.warn.length} warnings, ${bySeverity.info.length} informational`);
  if (bySeverity.critical.length) {
    console.log(`${RED}  DO NOT DEPLOY over this database until each critical line is explained.${NC}`);
    console.log("  Remediation procedure: docs/MIGRATION_LEDGER_AUDIT.md");
  }
  console.log("=".repeat(66));

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({
      database: (await client.query("SELECT current_database() d")).rows[0].d,
      deployState, identity, ledgerRows: logRows.length, assertedEffects: folded.asserted, findings,
    }, null, 2), "utf8");
    console.log(`  json: ${jsonOut}`);
  }

  await client.end();
  const decisionNeeded = bySeverity.critical.length + (strict ? bySeverity.warn.length : 0);
  process.exit(decisionNeeded ? 1 : 0);
}

function effectKey(e) {
  return e.kind === "column" || e.kind === "constraint"
    ? `${e.kind}:${norm(e.table)}:${norm(e.object)}`
    : `${e.kind}:${norm(e.object)}`;
}

/**
 * An empty catalog, for the seam the tests use: `reconcile` against a database in
 * which nothing was ever created reports every recorded effect as absent. Handing
 * the test a real `live` object built from strings keeps the detection proof off
 * Postgres, so it runs in CI on every push.
 */
const emptyLive = () => ({
  tables: new Set(), views: new Set(), columns: new Set(), indexes: new Set(),
  constraints: new Set(), constraintEq: new Map(),
});

export {
  plainSql, extractEffects, foldRecordedEffects, recordedEffectInputs, effectFindings, present,
  label, effectKey, splitName, norm, normCols, pgTrunc, has, equivalentConstraintName, emptyLive,
  CRITICAL_TABLES, CRITICAL_COLUMNS, EFFECT_PATTERNS,
};

// Imported by its test = pure functions only. Run from a shell = audit the
// database in DATABASE_URL. Without this guard, `vitest` would import the script
// and immediately try to connect, then exit(1) the whole worker.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((e) => {
    console.error(`${RED}audit could not run:${NC}`, e.message || e);
    process.exit(1);
  });
}
