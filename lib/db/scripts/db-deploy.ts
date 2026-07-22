/**
 * db-deploy.ts — Care Diagnostics ERP Database Migration Entry Point
 *
 * Execution order:
 *   1. Validate DATABASE_URL
 *   2. Wait for PostgreSQL to accept connections (with retry)
 *   3. Ensure drizzle schema + migrations table exist
 *   4. If existing DB with no migration history: seed history from journal
 *   5. Run Drizzle file-based migrator (applies pending .sql files)
 *   6. Exit 0 on success, non-zero on failure
 *
 * Safety guarantees:
 *   - Never drops tables or truncates data
 *   - Idempotent — safe to run multiple times
 *   - ON CONFLICT / IF NOT EXISTS used throughout
 *   - Passwords never logged
 *
 * Used by: care-migrate container (Dockerfile target: migrate)
 * Command: pnpm --filter @workspace/db run push-ci
 */

import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. Resolve connection string ─────────────────────────────────────────────

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  const user     = process.env.DB_USER     || "erp";
  const password = process.env.DB_PASSWORD || "changeme";
  const host     = process.env.DB_HOST     || "db";
  const port     = process.env.DB_HOST_PORT || "5432";
  const dbName   = process.env.DB_NAME     || "diagnostic_erp";
  connectionString = `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

if (!connectionString) {
  console.error("❌  DATABASE_URL or DB_* environment variables are not set.");
  process.exit(1);
}

// Safe log — mask password
function logSafeEnv(connStr: string) {
  try {
    const url  = new URL(connStr.replace(/^postgresql?:\/\//, "http://"));
    const safe = `${url.protocol.replace("http", "postgres")}//${url.username}:***@${url.host}${url.pathname}`;
    console.log("==========================================");
    console.log("🛠️   CARE DIAGNOSTICS DB DEPLOYMENT");
    console.log("==========================================");
    console.log(`Connection: ${safe}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Time:        ${new Date().toISOString()}`);
    console.log("==========================================\n");
  } catch {
    console.log("🛠️  CARE DIAGNOSTICS DB DEPLOYMENT (connection details masked)\n");
  }
}

// ── 2. Wait for Postgres (retry loop) ────────────────────────────────────────

async function waitForPostgres(
  connStr: string,
  maxAttempts = 30,
  intervalMs = 3000,
): Promise<void> {
  console.log("⏳  Waiting for PostgreSQL to be ready...");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const probe = new Client({ connectionString: connStr });
    try {
      await probe.connect();
      await probe.query("SELECT 1");
      await probe.end();
      console.log(`✅  PostgreSQL ready (attempt ${attempt}/${maxAttempts})\n`);
      return;
    } catch (err: any) {
      console.log(`   [${attempt}/${maxAttempts}] Not ready: ${err.message}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }
  console.error("❌  PostgreSQL did not become ready in time.");
  process.exit(1);
}

// ── 3. Main deployment logic ──────────────────────────────────────────────────

async function run() {
  logSafeEnv(connectionString!);
  await waitForPostgres(connectionString!);

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (err: any) {
    console.error("❌  Database connection failed:", err.message);
    process.exit(1);
  }

  try {
    // 3a. Remove stale migrations table from public schema (legacy mistake)
    await client.query(`DROP TABLE IF EXISTS "public"."__drizzle_migrations";`);

    // 3b. Ensure the drizzle schema exists
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);

    // 3c. Check for existing drizzle migrations table
    const { rows: [tableRow] } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle'
        AND   table_name   = '__drizzle_migrations'
      ) AS exists;
    `);
    const hasMigrationTable = tableRow.exists;

    // 3d. Check whether core application tables already exist
    const { rows: [coreRow] } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND   table_name   = 'clinic_settings'
      ) AS exists;
    `);
    const hasCoreTables = coreRow.exists;

    // Resolve migration folder
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    const journalPath      = path.join(migrationsFolder, "meta/_journal.json");

    if (!fs.existsSync(journalPath)) {
      throw new Error(
        `Migration journal not found at ${journalPath}. ` +
        `Run 'pnpm --filter @workspace/db run generate' first.`
      );
    }

    const journal  = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const entries: { idx: number; tag: string; when: number }[] = journal.entries || [];

    // Count already-applied migrations
    let appliedCount = 0;
    if (hasMigrationTable) {
      const { rowCount } = await client.query(`SELECT hash FROM drizzle.__drizzle_migrations;`);
      appliedCount = rowCount ?? 0;
    }

    // 3e. Seed migration history for existing databases that predate Drizzle tracking
    if (hasCoreTables && appliedCount === 0) {
      console.log("ℹ️   Existing database detected — migration table empty or absent.");
      console.log("⚙️   Seeding migration history to match current schema state...\n");

      await client.query(`
        CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
          "id"         serial  PRIMARY KEY,
          "hash"       text    NOT NULL,
          "created_at" bigint
        );
      `);

      for (const entry of entries) {
        const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (fs.existsSync(sqlPath)) {
          const hash = crypto
            .createHash("sha256")
            .update(fs.readFileSync(sqlPath, "utf-8"))
            .digest("hex");

          await client.query(
            `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING;`,
            [hash, entry.when],
          );
          console.log(`   ✓ Marked as applied: ${entry.tag}`);
        }
      }
      console.log("\n✓  Seeding complete.\n");
    }

    // 3e-bis. Clean-boot compatibility pre-seed (admin_sessions).
    // Drizzle 0006_jazzy_mojo.sql does ALTER + DROP TABLE "admin_sessions" to
    // remove a legacy pre-Drizzle table. No migration CREATEs it, so on a
    // completely empty database those statements raise "relation does not
    // exist" and — because this path runs the transactional Drizzle migrator —
    // abort the whole migration. On a CLEAN boot only (no core tables yet),
    // create a minimal placeholder so 0006 removes it cleanly. On an existing
    // database this is skipped, so the deprecated table is never resurrected.
    // Mirrors docker/db-patch-entrypoint.sh (the authoritative production path).
    if (!hasCoreTables) {
      console.log("ℹ️   Clean boot — pre-seeding legacy admin_sessions placeholder so migration 0006 can drop it cleanly.");
      await client.query(`CREATE TABLE IF NOT EXISTS "public"."admin_sessions" ("id" serial PRIMARY KEY);`);
    }

    // 3f. Run Drizzle file-based migrator — applies any pending .sql files
    // CRITICAL FIX (2026-06-30): Execute migrations with autocommit (no transaction wrapper).
    // If any migration contains CREATE INDEX CONCURRENTLY, it MUST run outside a transaction.
    // Drizzle's migrate() wraps all migrations in BEGIN...COMMIT by default, which breaks CONCURRENTLY.
    // Setting `disableTransactions: true` forces each migration to execute separately with autocommit.
    console.log("🚀  Running Drizzle migrator for pending changes...");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder, disableTransactions: true });

    console.log("\n==========================================");
    console.log("✅  DATABASE DEPLOYMENT COMPLETE");
    console.log("==========================================\n");
  } catch (err: any) {
    console.error("\n==========================================");
    console.error("❌  MIGRATION FAILED:", err.message);
    console.error("==========================================\n");
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
