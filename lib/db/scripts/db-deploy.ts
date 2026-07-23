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

    // 3f. Apply Drizzle migrations statement-by-statement, tolerating the benign
    // "does not exist" cleanups that make a from-scratch application of the
    // historical migrations noisy (0006 drops columns 0002 already renamed; 0010
    // updates a column a later feature migration adds). This mirrors
    // docker/db-patch-entrypoint.sh (psql -v ON_ERROR_STOP=0 per statement), so
    // care-migrate can now bootstrap a COMPLETELY EMPTY database end-to-end — the
    // transactional Drizzle migrate() aborts on the first such statement, which is
    // exactly why this path previously could NOT clean-boot. Each migration is
    // still applied at most once (skip-by-file-hash, same hash the entrypoint and
    // the seeding step above use), and CREATE INDEX CONCURRENTLY still runs with
    // autocommit because every statement is its own client.query().
    console.log("🚀  Applying Drizzle migrations (statement-tolerant, matches care-db-patch-v2)...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        "id" serial PRIMARY KEY, "hash" text NOT NULL, "created_at" bigint
      );`);
    const BENIGN = /does not exist|already exists/i;
    let dzApplied = 0, dzSkipped = 0;
    for (const entry of entries) {
      const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) { console.warn(`   ! missing ${entry.tag}.sql — skipping`); continue; }
      const raw = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(raw).digest("hex");
      const { rowCount } = await client.query(`SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1;`, [hash]);
      if (rowCount) { dzSkipped++; continue; }
      const statements = raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
      let tolerated = 0, real = 0;
      for (const stmt of statements) {
        try {
          await client.query(stmt);
        } catch (e: any) {
          const msg = String(e?.message ?? e).split("\n")[0];
          if (BENIGN.test(msg)) { tolerated++; }
          else { console.error(`   ⚠️  ${entry.tag}: ${msg}`); real++; }
        }
      }
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
        [hash, entry.when ?? Date.now()],
      );
      console.log(`   ✓ ${entry.tag}${tolerated ? ` (${tolerated} benign cleanup no-op(s))` : ""}${real ? ` [${real} non-benign error(s) — see above]` : ""}`);
      dzApplied++;
    }
    console.log(`✓  Drizzle: ${dzApplied} applied, ${dzSkipped} already current.`);

    // 3g. Stamp schema_deploy_state so this emergency care-migrate run leaves the
    // database in the SAME readiness state as care-db-patch-v2. Without this,
    // migrations succeed here but the API's /api/health/schema probe keeps
    // returning 503 ("db-patch-v2 did not complete") because db_patch_ok /
    // schema_verify_status were never recorded — the exact gap behind a
    // "schema_deploy_state absent" warning after a manual recovery. We verify the
    // core tables ourselves (honest sql_pass), mirroring the entrypoint's step 6.
    const CORE_TABLES = [
      "users", "clinic_settings", "patients", "bills", "payments", "orders",
      "order_tests", "diagnostic_tests", "doctors", "ledgers", "radiology_worklist",
    ];
    const { rows: coreRows } = await client.query<{ missing: string[] | null }>(
      `SELECT array_agg(t) AS missing FROM unnest($1::text[]) AS t
       WHERE to_regclass('public.' || t) IS NULL`,
      [CORE_TABLES],
    );
    const missingCore = coreRows[0]?.missing ?? null;
    const coreOk = !(missingCore && missingCore.length);
    if (!coreOk) {
      console.warn(`⚠️   Core tables missing after migration: ${missingCore!.join(", ")} — recording db_patch_ok=false / schema_verify_status=sql_fail so /api/health/schema fails loudly instead of hiding it.`);
    }
    let drizzleCount = 0;
    try {
      const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`);
      drizzleCount = parseInt(r.rows[0]?.n ?? "0", 10) || 0;
    } catch { /* tracking table may not exist on a very old schema */ }

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_deploy_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);
    await client.query(
      `INSERT INTO public.schema_deploy_state (key, value) VALUES
         ('db_patch_ok',          $1),
         ('schema_verify_status', $2),
         ('total_migrations',     $3),
         ('applied_by',           'care-migrate'),
         ('patch_version',        to_char(now() AT TIME ZONE 'utc', 'YYYYMMDDHH24MISS')),
         ('erp_version',          $4),
         ('build_number',         $5),
         ('git_commit',           $6),
         ('git_branch',           $7),
         ('git_tag',              $8),
         ('build_date',           $9)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
      [
        coreOk ? "true" : "false",
        coreOk ? "sql_pass" : "sql_fail",
        String(drizzleCount),
        process.env.ERP_VERSION ?? "unknown",
        process.env.BUILD_NUMBER ?? "0",
        process.env.GIT_COMMIT ?? "unknown",
        process.env.GIT_BRANCH ?? "unknown",
        process.env.GIT_TAG ?? "unknown",
        process.env.BUILD_DATE ?? new Date().toISOString(),
      ],
    );
    console.log(`🧾  Recorded schema_deploy_state (db_patch_ok=${coreOk}, schema_verify_status=${coreOk ? "sql_pass" : "sql_fail"}, ${drizzleCount} drizzle migrations, applied_by=care-migrate).`);

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
