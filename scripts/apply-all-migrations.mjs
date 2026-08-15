#!/usr/bin/env node
/**
 * apply-all-migrations.mjs — bootstrap the full CARE ERP schema into a target DB.
 * ==========================================================================
 * Applies the authentic production migration path (Drizzle journal order, then
 * migrations/*.sql alphabetical) into the database named by DATABASE_URL / DB_*,
 * WITHOUT dropping it — idempotent and non-destructive. Unlike
 * migration-bootstrap-smoke.mjs (which uses a throwaway scratch DB), this targets
 * an existing database, so CI can build a persistent test DB for the
 * DB-dependent Vitest suite, and developers can bootstrap a local dev DB.
 *
 * Semantics mirror docker/db-patch-entrypoint.sh:
 *   - clean-boot admin_sessions pre-seed (only when the DB is empty),
 *   - Drizzle migrations per-statement, continue-on-error for benign cleanups,
 *   - feature migrations whole-file (a genuine error is fatal, exit 1).
 *
 * Usage:  DATABASE_URL=postgres://u:p@host:5432/care_test node scripts/apply-all-migrations.mjs
 */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitMigrationStatements } from "./split-migration-sql.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DRIZZLE_DIR = path.join(REPO, "lib", "db", "drizzle");
const FEATURE_DIR = path.join(REPO, "migrations");
const JOURNAL = path.join(DRIZZLE_DIR, "meta", "_journal.json");
/** ALTER SYSTEM must run outside a multi-statement transaction (node-pg batches whole files). */
const FEATURE_MIGRATION_STATEMENT_SPLIT = new Set(["zzzz_postgres_performance_tuning.sql"]);

function connString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DB_HOST) {
    const u = process.env.DB_USER || "erp", p = process.env.DB_PASSWORD || "changeme";
    return `postgresql://${u}:${p}@${process.env.DB_HOST}:${process.env.DB_HOST_PORT || "5432"}/${process.env.DB_NAME || "diagnostic_erp"}`;
  }
  return null;
}

const BENIGN = /does not exist|already exists/i;

async function main() {
  const cs = connString();
  if (!cs) { console.error("apply-all-migrations: no DATABASE_URL / DB_* set"); process.exit(1); }
  const db = new pg.Client({ connectionString: cs });
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
    await db.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations"(id serial primary key, hash text not null, created_at bigint);`);
    await db.query(`CREATE TABLE IF NOT EXISTS "public"."schema_migrations_log"(id serial primary key, name text not null, kind text not null default 'drizzle', applied_at timestamptz not null default now(), sha256 text not null, UNIQUE(name,kind));`);

    const clean = (await db.query(`SELECT to_regclass('public.users') IS NULL AS c`)).rows[0].c;
    if (clean) await db.query(`CREATE TABLE IF NOT EXISTS "public"."admin_sessions"("id" serial PRIMARY KEY);`);

    // Drizzle migrations (journal order, per-statement, tolerant)
    const journal = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
    const crypto = await import("node:crypto");
    let dzApplied = 0;
    for (const entry of journal.entries || []) {
      const file = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      if ((await db.query(`SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash=$1`, [hash])).rowCount) continue;
      for (const stmt of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
        try { await db.query(stmt); }
        catch (e) { const m = String(e.message || e); if (!BENIGN.test(m)) console.error(`  ⚠️ ${entry.tag}: ${m.split("\n")[0]}`); }
      }
      await db.query(`INSERT INTO "drizzle"."__drizzle_migrations"(hash, created_at) VALUES($1,$2) ON CONFLICT DO NOTHING`, [hash, entry.when ?? 0]);
      dzApplied++;
    }

    // Feature migrations (alphabetical, whole-file, hard-stop on real error)
    const files = fs.readdirSync(FEATURE_DIR).filter((f) => f.endsWith(".sql")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let ftApplied = 0;
    for (const f of files) {
      const raw = fs.readFileSync(path.join(FEATURE_DIR, f), "utf8").replace(/^﻿/, "");
      const statements = FEATURE_MIGRATION_STATEMENT_SPLIT.has(f)
        ? splitMigrationStatements(raw)
        : [raw];
      for (const stmt of statements) {
        try { await db.query(stmt); }
        catch (e) { console.error(`  ✗ FEATURE FAILED ${f}: ${String(e.message).split("\n")[0]}`); process.exit(1); }
      }
      ftApplied++;
    }
    console.log(`apply-all-migrations: ${dzApplied} drizzle applied, ${ftApplied}/${files.length} feature migrations OK`);
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error("apply-all-migrations crashed:", e); process.exit(1); });
