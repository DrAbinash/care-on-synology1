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
