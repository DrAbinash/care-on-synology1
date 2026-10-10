#!/usr/bin/env node
/**
 * migration-bootstrap-smoke.mjs — CARE ERP clean-boot + upgrade-safety smoke
 * ==========================================================================
 * Proves, against a REAL Postgres, that the authentic production migration
 * path (docker/db-patch-entrypoint.sh semantics) can:
 *
 *   §2  bootstrap a COMPLETELY EMPTY database end-to-end, and
 *   §3  re-run safely over a POPULATED database without losing, mutating, or
 *       duplicating data — signed reports stay byte-identical.
 *
 * It is docker-free and self-contained: it creates its own throwaway scratch
 * database, runs every migration into it, asserts, then drops it. It NEVER
 * touches an existing application database.
 *
 * SEMANTICS (mirrors docker/db-patch-entrypoint.sh exactly)
 *   1. bootstrap drizzle.__drizzle_migrations + public.schema_migrations_log
 *   2. clean-boot compat: pre-seed a placeholder admin_sessions so Drizzle
 *      0006's ALTER/DROP of that legacy table run cleanly (gated on clean boot)
 *   3. apply lib/db/drizzle/*.sql in journal order, per-statement,
 *      continue-on-error (entrypoint uses psql ON_ERROR_STOP=0 here)
 *   4. apply migrations/*.sql in alphabetical filename order, whole-file,
 *      HARD-STOP on first error (entrypoint uses psql -f ON_ERROR_STOP=1)
 *   Correctness is judged by post-boot ASSERTIONS on the final schema, not by
 *   the presence of the two known-benign Drizzle cleanup warnings (a DROP of
 *   already-renamed dicom_nodes columns and an UPDATE of a later-added
 *   email_settings column — both proven no-ops on a clean DB).
 *
 * CONNECTION
 *   Admin URL from MIGRATION_SMOKE_ADMIN_URL, else DATABASE_URL, else DB_*.
 *   The db name in that URL is only used to reach the server; a scratch db
 *   ("care_migration_smoke" by default, or --db=NAME) is created/dropped.
 *   If no server is reachable the script prints "SKIPPED — no database" and
 *   exits 0, so it is safe in CI without Postgres. With Postgres present it
 *   runs and fails the build (exit 1) on any real regression.
 *
 * USAGE
 *   node scripts/migration-bootstrap-smoke.mjs
 *   MIGRATION_SMOKE_ADMIN_URL=postgres://erp@/postgres?host=/tmp\&port=5433 \
 *     node scripts/migration-bootstrap-smoke.mjs
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitMigrationStatements } from "./split-migration-sql.mjs";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DRIZZLE_DIR = path.join(REPO, "lib", "db", "drizzle");
const FEATURE_DIR = path.join(REPO, "migrations");
const JOURNAL = path.join(DRIZZLE_DIR, "meta", "_journal.json");

const argDb = (process.argv.find((a) => a.startsWith("--db=")) || "").split("=")[1];
const SCRATCH_DB = argDb || "care_migration_smoke";
/** ALTER SYSTEM must run outside a multi-statement transaction (node-pg batches whole files). */
const FEATURE_MIGRATION_STATEMENT_SPLIT = new Set(["zzzz_postgres_performance_tuning.sql"]);

function adminConnString() {
  const url =
    process.env.MIGRATION_SMOKE_ADMIN_URL ||
    process.env.DATABASE_URL ||
    (process.env.DB_HOST
      ? `postgresql://${process.env.DB_USER || "erp"}:${process.env.DB_PASSWORD || "changeme"}@${process.env.DB_HOST}:${process.env.DB_HOST_PORT || "5432"}/postgres`
      : null);
  return url;
}
function swapDbName(connString, dbName) {
  // Works for both host= query-param and host-in-authority URL forms.
  const u = new URL(connString.replace(/^postgres(ql)?:\/\//, "http://"));
  u.pathname = "/" + dbName;
  return u.toString().replace(/^http:\/\//, "postgresql://");
}

const GREEN = "\x1b[32m", RED = "\x1b[31m", YEL = "\x1b[33m", NC = "\x1b[0m";
let PASS = 0, FAIL = 0;
function assert(name, expected, actual) {
  if (String(expected) === String(actual)) { console.log(`  ${GREEN}✅ ${name}${NC} (${actual})`); PASS++; }
  else { console.log(`  ${RED}❌ ${name}${NC} expected=${expected} actual=${actual}`); FAIL++; }
}

function journalTags() {
  const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
  return (j.entries || []).map((e) => e.tag);
}

async function applyDrizzle(client) {
  const warnings = [];
  for (const tag of journalTags()) {
    const file = path.join(DRIZZLE_DIR, `${tag}.sql`);
    if (!fs.existsSync(file)) { warnings.push(`${tag}: file missing`); continue; }
    const sql = fs.readFileSync(file, "utf8");
    // Split exactly where drizzle marks statement boundaries; run each with
    // continue-on-error, matching the entrypoint's ON_ERROR_STOP=0 drizzle step.
    const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try { await client.query(stmt); }
      catch (e) {
        const msg = String(e.message || e);
        if (!/already exists/i.test(msg)) warnings.push(`${tag}: ${msg.split("\n")[0]}`);
      }
    }
  }
  return warnings;
}

async function applyFeature(client) {
  const files = fs.readdirSync(FEATURE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let applied = 0;
  const errors = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(FEATURE_DIR, f), "utf8").replace(/^﻿/, "");
    const statements = FEATURE_MIGRATION_STATEMENT_SPLIT.has(f)
      ? splitMigrationStatements(raw)
      : [raw];
    for (const stmt of statements) {
      try { await client.query(stmt); }
      catch (e) { errors.push(`${f}: ${String(e.message).split("\n")[0]}`); }
    }
    applied++;
  }
  return { applied, errors, total: files.length };
}

async function main() {
  const adminUrl = adminConnString();
  if (!adminUrl) { console.log(`${YEL}SKIPPED — no database configured (set MIGRATION_SMOKE_ADMIN_URL / DATABASE_URL / DB_*).${NC}`); process.exit(0); }

  // 1. Reachability
  const admin = new Client({ connectionString: adminUrl });
  try { await admin.connect(); await admin.query("SELECT 1"); }
  catch { console.log(`${YEL}SKIPPED — Postgres not reachable at admin URL.${NC}`); process.exit(0); }

  console.log("=".repeat(64));
  console.log("  CARE ERP — migration bootstrap + upgrade-safety smoke");
  console.log("=".repeat(64));

  // 2. Fresh scratch DB
  await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`).catch(async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  });
  await admin.query(`CREATE DATABASE "${SCRATCH_DB}"`);
  await admin.end();

  const scratchUrl = swapDbName(adminUrl, SCRATCH_DB);
  const db = new Client({ connectionString: scratchUrl });
  await db.connect();

  try {
    // ── §2 CLEAN BOOTSTRAP ────────────────────────────────────────────────
    console.log(`\n${YEL}§2 CLEAN BOOTSTRAP (empty database)${NC}`);
    await db.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
    await db.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations"(id serial primary key, hash text not null, created_at bigint);`);
    await db.query(`CREATE TABLE IF NOT EXISTS "public"."schema_migrations_log"(id serial primary key, name text not null, kind text not null default 'drizzle', applied_at timestamptz not null default now(), sha256 text not null, UNIQUE(name,kind));`);

    // clean-boot compat: admin_sessions placeholder (gated on clean boot)
    const clean = (await db.query(`SELECT to_regclass('public.users') IS NULL AS c`)).rows[0].c;
    if (clean) await db.query(`CREATE TABLE IF NOT EXISTS "public"."admin_sessions"("id" serial PRIMARY KEY);`);

    const drizzleWarnings = await applyDrizzle(db);
    const feat = await applyFeature(db);

    console.log(`  drizzle applied (continue-on-error); ${drizzleWarnings.length} benign warning(s):`);
    for (const w of drizzleWarnings) console.log(`     ${YEL}· ${w}${NC}`);
    console.log(`  feature migrations: ${feat.applied}/${feat.total} applied, ${feat.errors.length} error(s)`);
    for (const e of feat.errors) console.log(`     ${RED}· ${e}${NC}`);

    assert("feature migrations apply with 0 hard errors", 0, feat.errors.length);
    for (const t of ["users","clinic_settings","patients","bills","payments","orders","order_tests","diagnostic_tests","doctors","ledgers","radiology_worklist","feature_flags"]) {
      const ex = (await db.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`)).rows[0].e;
      assert(`core table present: ${t}`, true, ex);
    }
    const adminGone = (await db.query(`SELECT to_regclass('public.admin_sessions') IS NULL AS e`)).rows[0].e;
    assert("legacy admin_sessions removed by 0006", true, adminGone);
    const renamed = (await db.query(`SELECT count(*)::int c FROM information_schema.columns WHERE table_name='dicom_nodes' AND column_name='pull_interval_seconds'`)).rows[0].c;
    assert("dicom_nodes rename final state (pull_interval_seconds present)", 1, renamed);
    const oldGone = (await db.query(`SELECT count(*)::int c FROM information_schema.columns WHERE table_name='dicom_nodes' AND column_name='pull_interval_minutes'`)).rows[0].c;
    assert("dicom_nodes old column removed (pull_interval_minutes absent)", 0, oldGone);

    // AI audit privacy default. The column records a privacy claim, so an insert
    // that omits it must not default to a positive one. Asserted against a real
    // Postgres because only the database knows which DEFAULT the migration chain
    // actually left behind — lib/db/src/schema/aiReporting.ts saying "false" is not
    // evidence unless a migrations/*.sql file carried it to the deploy.
    const anonDefault = async () =>
      (
        await db.query(`
          SELECT pg_get_expr(d.adbin, d.adrelid) AS def
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
           WHERE c.relnamespace = 'public'::regnamespace
             AND c.relname = 'ai_reporting_audit_logs'
             AND a.attname = 'anonymized'
             AND a.attnum > 0 AND NOT a.attisdropped
        `)
      ).rows[0]?.def;
    assert('AI audit "anonymized" DB default is false', "false", await anonDefault());
    const anonProbe = (
      await db.query(`
        INSERT INTO ai_reporting_audit_logs (user_name, provider, prompt_text)
        VALUES ('CARE-SMOKE', 'smoke', 'anonymized default probe')
        RETURNING anonymized
      `)
    ).rows[0];
    assert('AI audit insert omitting "anonymized" records false', false, anonProbe?.anonymized);

    // D2 completion: radiology_image_references.presentation_json is declared
    // NOT NULL DEFAULT '{}' in lib/db/src/schema/radiologyReportGenerator.ts:224
    // and POST /image-references writes it, but no migration ever created it — so
    // a database built the way the clinic builds it 500s on every image reference.
    // Asserted as schema AND as a working insert, because the symptom was the
    // route failing, not a column name missing from a listing.
    const D2_TABLE = "radiology_image_references";
    const d2Col = (
      await db.query(`
        SELECT is_nullable FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name='presentation_json'
      `, [D2_TABLE])
    ).rows[0];
    assert("image references presentation_json present after clean boot", true, d2Col !== undefined);
    assert("image references presentation_json is NOT NULL", "NO", d2Col?.is_nullable);
    const d2Default = (
      await db.query(`
        SELECT pg_get_expr(d.adbin, d.adrelid) AS def
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relname = $1
           AND a.attname = 'presentation_json'
           AND a.attnum > 0 AND NOT a.attisdropped
      `, [D2_TABLE])
    ).rows[0]?.def;
    assert("image references presentation_json DB default is '{}'::text", "'{}'::text", d2Default);
    const d2Named = (
      await db.query(`
        INSERT INTO radiology_image_references (draft_id, description, presentation_json)
        VALUES (0, 'CARE-SMOKE names framing', '{"zoom":1.5}')
        RETURNING presentation_json
      `)
    ).rows[0];
    assert("image-reference insert naming presentation_json works on a migrated DB", '{"zoom":1.5}', d2Named?.presentation_json);
    const d2Omitted = (
      await db.query(`
        INSERT INTO radiology_image_references (draft_id, description)
        VALUES (0, 'CARE-SMOKE omits framing')
        RETURNING presentation_json
      `)
    ).rows[0];
    assert("image-reference insert omitting presentation_json records {}", "{}", d2Omitted?.presentation_json);

    // PROMPT 4 durable Composer Apply: the three evidence columns on
    // ai_report_compose_jobs are declared in
    // lib/db/src/schema/aiReportComposer.ts and written by
    // lib/reportComposer/composePersistence.ts and jobService.ts, but only a
    // migrations/*.sql file carries them to the clinic. Asserted as schema AND as
    // a working write, because the failure mode that matters is the enqueue
    // transaction erroring on a migration-built database, not a name missing from
    // a listing. Nullability is the safety property: a job that predates them must
    // read as NULL ("no baseline was ever captured", refused at Apply), never as
    // an empty string that could be mistaken for a real baseline of an empty
    // report.
    const COMPOSE_TABLE = "ai_report_compose_jobs";
    for (const col of ["source_persisted_token", "source_draft_id", "applied_persisted_token"]) {
      const info = (
        await db.query(`
          SELECT is_nullable, column_default FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 AND column_name=$2
        `, [COMPOSE_TABLE, col])
      ).rows[0];
      assert(`composer ${col} present after clean boot`, true, info !== undefined);
      assert(`composer ${col} is nullable`, "YES", info?.is_nullable);
      assert(`composer ${col} has no default`, null, info?.column_default ?? null);
    }
    const composeWrite = (
      await db.query(`
        INSERT INTO ai_report_compose_jobs
                 (source_report_revision, source_findings_hash, source_impression_hash,
                  input_hash, input_snapshot_json, source_persisted_token, source_draft_id)
        VALUES ('smoke-rev', 'smoke-f', 'smoke-i', 'smoke-h', '{}', 'smoke-token', 424242)
        RETURNING source_persisted_token, source_draft_id, applied_persisted_token
      `)
    ).rows[0];
    assert("composer insert naming the baseline columns works", "smoke-token", composeWrite?.source_persisted_token);
    assert("composer baseline draft id round-trips", 424242, composeWrite?.source_draft_id);
    assert("composer receipt column defaults to NULL (missing is not unchanged)", null, composeWrite?.applied_persisted_token ?? null);
    await db.query(`DELETE FROM ai_report_compose_jobs WHERE source_report_revision = 'smoke-rev'`);

    // ── §3 UPGRADE SAFETY (populated re-run) ──────────────────────────────
    console.log(`\n${YEL}§3 UPGRADE SAFETY (populated re-run / restart)${NC}`);
    await db.query(`
      INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
      SELECT 'CARE-SMOKE-1','Smoke','Probe','1990-01-01','M','0000000000'
      WHERE NOT EXISTS (SELECT 1 FROM patients WHERE patient_id='CARE-SMOKE-1');`);
    await db.query(`
      INSERT INTO patient_reports (report_number, patient_id, test_id, title, body, status, signed_by_name, signed_at)
      SELECT 'RPT-SMOKE-1', (SELECT id FROM patients WHERE patient_id='CARE-SMOKE-1'), 1,
             'Signed report', 'IMPRESSION: immutable signed content.', 'final', 'Dr Smoke', now()
      WHERE NOT EXISTS (SELECT 1 FROM patient_reports WHERE report_number='RPT-SMOKE-1');`);
    await db.query(`INSERT INTO feature_flags (key, enabled, description) VALUES ('ff_smoke_probe', true, 'survive upgrade') ON CONFLICT (key) DO NOTHING;`);

    const snap = async () => ({
      ff: (await db.query(`SELECT count(*)::int c FROM feature_flags`)).rows[0].c,
      pt: (await db.query(`SELECT count(*)::int c FROM patients`)).rows[0].c,
      pr: (await db.query(`SELECT count(*)::int c FROM patient_reports`)).rows[0].c,
      tbl: (await db.query(`SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows[0].c,
      sig: (await db.query(`SELECT md5(coalesce(body,'')||'|'||coalesce(status,'')||'|'||coalesce(signed_by_name,'')||'|'||coalesce(signed_at::text,'')) h FROM patient_reports WHERE report_number='RPT-SMOKE-1'`)).rows[0].h,
      flag: (await db.query(`SELECT enabled FROM feature_flags WHERE key='ff_smoke_probe'`)).rows[0].enabled,
    });
    const before = await snap();
    const reRun = await applyFeature(db); // redeploy: re-apply all feature migrations
    const after = await snap();

    assert("feature migrations idempotent on re-run (0 errors)", 0, reRun.errors.length);
    for (const e of reRun.errors) console.log(`     ${RED}· ${e}${NC}`);
    assert("feature_flags count unchanged (no duplication)", before.ff, after.ff);
    assert("patients count unchanged (no loss/dup)", before.pt, after.pt);
    assert("patient_reports count unchanged", before.pr, after.pr);
    assert("total table count unchanged", before.tbl, after.tbl);
    assert("SIGNED report content immutable", before.sig, after.sig);
    assert("feature flag config preserved", before.flag, after.flag);
    assert('AI audit "anonymized" DB default survives a re-run', "false", await anonDefault());

    // ── §4 FORWARD UPGRADE from the immediately preceding schema ────────────
    // The clinic's database does not have this column: it was built by the chain as
    // it stood before this migration existed, and `drizzle-kit push` never reaches
    // production. So idempotency over a schema that already has the column (§3) is
    // not the case that matters. This reproduces the state that does: drop the
    // column on the scratch database only, leave every row alone, show the deployed
    // insert shape genuinely fails, apply ONLY the new file, then show the surviving
    // row is unchanged and defaulted, the insert works, and redeploying is a no-op.
    console.log(`\n${YEL}§4 FORWARD UPGRADE (pre-migration schema → new migration only)${NC}`);
    const NEW_MIGRATION = "zzzzzzzzzzzzzzzzz_radiology_image_reference_presentation_json.sql";
    // Dropping the column here is safe precisely because this is the throwaway
    // scratch database the script created and is about to drop (§2's own probe rows
    // lose nothing the production upgrade would not also lose).
    await db.query(`ALTER TABLE radiology_image_references DROP COLUMN IF EXISTS presentation_json`);
    const absentNow = (
      await db.query(`SELECT count(*)::int c FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='radiology_image_references'
                         AND column_name='presentation_json'`)
    ).rows[0].c;
    assert("§4 preceding state reproduced (column absent)", 0, absentNow);

    const legacy = (
      await db.query(`
        INSERT INTO radiology_image_references
          (draft_id, description, study_instance_uid, sop_instance_uid, frame_number)
        VALUES (0, 'CARE-SMOKE legacy reference', '1.2.840.smoke', '1.2.840.smoke.1', 4)
        RETURNING id,
                  md5(coalesce(description,'')||'|'||coalesce(sop_instance_uid,'')||'|'||coalesce(frame_number::text,'')) h
      `)
    ).rows[0];
    assert("§4 legacy row inserted on the preceding schema", true, legacy?.id != null);

    // The exact defect, proven rather than described: POST /image-references names
    // this column, so on this schema the INSERT cannot run at all.
    let routeFailed = "";
    try {
      await db.query(`INSERT INTO radiology_image_references (draft_id, description, presentation_json)
                      VALUES (0, 'CARE-SMOKE route shape', '{}')`);
    } catch (e) { routeFailed = String(e.message || e).split("\n")[0]; }
    assert("§4 route-shaped insert fails before the migration", true, /does not exist/i.test(routeFailed));

    await db.query(
      fs.readFileSync(path.join(FEATURE_DIR, NEW_MIGRATION), "utf8").replace(/^﻿/, "")
    );
    const upgradedCol = (
      await db.query(`SELECT is_nullable FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='radiology_image_references'
                         AND column_name='presentation_json'`)
    ).rows[0];
    assert("§4 forward migration adds the column NOT NULL", "NO", upgradedCol?.is_nullable);

    const survivor = (
      await db.query(`SELECT description, sop_instance_uid, frame_number, presentation_json,
                             md5(coalesce(description,'')||'|'||coalesce(sop_instance_uid,'')||'|'||coalesce(frame_number::text,'')) h
                        FROM radiology_image_references WHERE id=$1`, [legacy.id])
    ).rows[0];
    assert("§4 existing row survived the upgrade byte-identical", legacy.h, survivor?.h);
    assert("§4 existing row's clinical frame is untouched", 4, survivor?.frame_number);
    assert("§4 existing row receives the model's default framing", "{}", survivor?.presentation_json);

    const afterUpgrade = (
      await db.query(`INSERT INTO radiology_image_references
                        (draft_id, description, study_instance_uid, series_instance_uid,
                         sop_instance_uid, presentation_json)
                      VALUES (0, 'CARE-SMOKE after upgrade', '1.2.840.smoke', '1.2.840.smoke.s',
                              '1.2.840.smoke.1', '{"zoom":2}')
                      RETURNING presentation_json`)
    ).rows[0];
    assert("§4 route-shaped insert works after the migration", '{"zoom":2}', afterUpgrade?.presentation_json);

    const rerunNew = await db.query(
      fs.readFileSync(path.join(FEATURE_DIR, NEW_MIGRATION), "utf8").replace(/^﻿/, "")
    ).then(() => "ok").catch((e) => String(e.message));
    assert("§4 re-applying the new migration is a no-op", "ok", rerunNew);
  } finally {
    await db.end();
    const cleanup = new Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`).catch(() => {});
    await cleanup.end();
  }

  console.log("\n" + "=".repeat(64));
  console.log(`  RESULT: ${PASS} passed, ${FAIL} failed`);
  console.log("=".repeat(64));
  if (FAIL > 0) { console.log(`${RED}MIGRATION SMOKE: FAIL${NC}`); process.exit(1); }
  console.log(`${GREEN}MIGRATION SMOKE: PASS${NC}`);
  process.exit(0);
}

main().catch((e) => { console.error(`${RED}migration smoke crashed:${NC}`, e); process.exit(1); });
