#!/usr/bin/env tsx
/**
 * ERP Database Manager CLI
 * ========================
 * Interactive tool to run DB operations against the Synology PostgreSQL.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/db db:manage
 *   -- OR --
 *   cd lib/db && npx tsx scripts/db-manage.ts
 *
 * Commands presented interactively:
 *   1  drizzle push          — apply schema changes (safe, additive)
 *   2  drizzle push --force  — force push (destructive ok)
 *   3  apply optimizations   — run erp_db_optimizations.sql (indexes + views)
 *   4  apply custom SQL      — run any .sql file you specify
 *   5  check tables          — list all tables + row counts
 *   6  check indexes         — show custom ERP indexes
 *   7  check views           — show ERP views (v_unified_worklist, etc.)
 *   8  session cleanup       — delete expired sessions
 *   9  connection test       — verify DB connectivity
 *   0  exit
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import pg from "pg";
import dotenv from "dotenv";

// ── Setup ────────────────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

// Load .env from repo root
const rootEnv = path.resolve(repoRoot, ".env");
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
  console.log(`\x1b[90mLoaded .env from ${rootEnv}\x1b[0m`);
}

// Build DATABASE_URL from individual env vars if not set directly
if (!process.env.DATABASE_URL) {
  const host = process.env.DB_HOST ?? "172.16.1.139";
  const port = process.env.DB_HOST_PORT ?? "5400";
  const user = process.env.DB_USER ?? "erp";
  const pass = process.env.DB_PASSWORD ?? "changeme";
  const db   = process.env.DB_NAME ?? "diagnostic_erp";
  process.env.DATABASE_URL = `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

const { Pool } = pg;

const OPTIMIZATION_SQL = path.resolve(
  here,
  "../../api-server/migrations/erp_db_optimizations.sql"
);

const DRIZZLE_CONFIG = path.resolve(here, "../drizzle.config.ts");

// ── Helpers ──────────────────────────────────────────────────────────────────

function green(s: string)  { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string)    { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function cyan(s: string)   { return `\x1b[36m${s}\x1b[0m`; }
function bold(s: string)   { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string)    { return `\x1b[90m${s}\x1b[0m`; }

function banner() {
  console.clear();
  console.log(bold(cyan("╔═══════════════════════════════════════════════════════╗")));
  console.log(bold(cyan("║       Care Diagnostics ERP — Database Manager         ║")));
  console.log(bold(cyan("╚═══════════════════════════════════════════════════════╝")));
  const url = process.env.DATABASE_URL!;
  // Mask password in display
  const safeUrl = url.replace(/:([^:@]+)@/, ":****@");
  console.log(dim(`  DB: ${safeUrl}`));
  console.log();
}

async function confirm(rl: readline.Interface, msg: string): Promise<boolean> {
  const ans = await rl.question(`${yellow("⚠")}  ${msg} ${dim("[y/N]")} `);
  return ans.trim().toLowerCase() === "y";
}

async function testConnection(): Promise<pg.Pool | null> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query("SELECT version(), current_database(), pg_size_pretty(pg_database_size(current_database())) AS db_size");
    const r = rows[0];
    console.log(green("✓  Connected successfully"));
    console.log(dim(`   DB: ${r.current_database} | Size: ${r.db_size}`));
    console.log(dim(`   ${r.version.split(" ").slice(0, 3).join(" ")}`));
    return pool;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(red("✗  Connection FAILED"));
    console.log(red(`   ${msg}`));
    await pool.end();
    return null;
  }
}

async function runSql(pool: pg.Pool, sql: string, description: string) {
  console.log(dim(`\n  Running: ${description}`));
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  let ok = 0;
  let fail = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      ok++;
      // Show first line of statement as progress
      const firstLine = stmt.split("\n")[0].substring(0, 70);
      process.stdout.write(green("  ✓ ") + dim(firstLine) + "\n");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Skip "already exists" errors — they are safe
      if (msg.includes("already exists") || msg.includes("duplicate key")) {
        ok++;
        process.stdout.write(yellow("  ~ ") + dim("(already exists, skipped)") + "\n");
      } else {
        fail++;
        console.log(red(`  ✗ ${msg}`));
        console.log(dim(`    Statement: ${stmt.substring(0, 100)}`));
      }
    }
  }
  console.log();
  console.log(`  ${green(`${ok} succeeded`)}  ${fail > 0 ? red(`${fail} failed`) : dim("0 failed")}`);
}

async function showTables(pool: pg.Pool) {
  const { rows } = await pool.query(`
    SELECT
      t.table_name,
      pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS size,
      COALESCE(s.n_live_tup, 0) AS row_count
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY s.n_live_tup DESC NULLS LAST
  `);
  console.log();
  console.log(bold(`  ${"Table".padEnd(50)} ${"Rows".padStart(10)}  ${"Size".padStart(10)}`));
  console.log(dim("  " + "─".repeat(73)));
  for (const r of rows) {
    const rows_n = Number(r.row_count);
    const color = rows_n > 100_000 ? red : rows_n > 10_000 ? yellow : green;
    console.log(
      `  ${r.table_name.padEnd(50)} ${color(String(rows_n).padStart(10))}  ${dim(r.size.padStart(10))}`
    );
  }
  console.log(dim(`\n  ${rows.length} tables total`));
}

async function showIndexes(pool: pg.Pool) {
  const { rows } = await pool.query(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
      AND indexname NOT LIKE '%_uq'
    ORDER BY tablename, indexname
  `);
  console.log();
  for (const r of rows) {
    console.log(`  ${cyan(r.indexname)}`);
    console.log(dim(`    on ${r.tablename}: ${r.indexdef.replace(/CREATE(?: UNIQUE)? INDEX \S+ ON \S+/, "").trim().substring(0, 80)}`));
  }
  console.log(dim(`\n  ${rows.length} custom indexes`));
}

async function showViews(pool: pg.Pool) {
  const { rows } = await pool.query(`
    SELECT viewname, pg_size_pretty(0) AS note
    FROM pg_views
    WHERE schemaname = 'public'
    ORDER BY viewname
  `);
  if (rows.length === 0) {
    console.log(yellow("\n  No views found. Run optimizations to create them."));
    return;
  }
  console.log();
  for (const r of rows) {
    const isErp = r.viewname.startsWith("v_");
    console.log(`  ${isErp ? green("●") : dim("○")}  ${r.viewname}`);
  }
  console.log(dim(`\n  ${rows.length} views (● = ERP views)`));
}

async function sessionCleanup(pool: pg.Pool) {
  const { rowCount: ps } = await pool.query(
    "DELETE FROM portal_sessions WHERE expires_at < NOW() - INTERVAL '7 days'"
  );
  const { rowCount: ss } = await pool.query(
    "DELETE FROM scan_sessions WHERE expires_at < NOW() - INTERVAL '1 day'"
  );
  let sa = 0;
  try {
    const r = await pool.query(
      "DELETE FROM super_admin_sessions WHERE expires_at < NOW() - INTERVAL '7 days'"
    );
    sa = r.rowCount ?? 0;
  } catch { /* table may not exist */ }

  let dj = 0;
  try {
    const r = await pool.query(
      "DELETE FROM dicom_pull_jobs WHERE status IN ('completed','failed') AND created_at < NOW() - INTERVAL '30 days'"
    );
    dj = r.rowCount ?? 0;
  } catch { /* ignore */ }

  console.log(green(`\n  ✓ Cleaned up:`));
  console.log(`    portal_sessions     : ${green(String(ps ?? 0))} rows deleted`);
  console.log(`    scan_sessions       : ${green(String(ss ?? 0))} rows deleted`);
  console.log(`    super_admin_sessions: ${green(String(sa))} rows deleted`);
  console.log(`    dicom_pull_jobs     : ${green(String(dj))} rows deleted`);
}

function runDrizzleKit(args: string[]) {
  console.log(dim(`\n  Running: drizzle-kit ${args.join(" ")}`));
  console.log(dim("  ─".repeat(40)));
  const result = spawnSync(
    "npx",
    ["drizzle-kit", ...args, `--config=${DRIZZLE_CONFIG}`],
    {
      cwd: path.dirname(DRIZZLE_CONFIG),
      stdio: "inherit",
      env: process.env,
      shell: true,
    }
  );
  if (result.status === 0) {
    console.log(green("\n  ✓ drizzle-kit completed successfully"));
  } else {
    console.log(red(`\n  ✗ drizzle-kit exited with code ${result.status}`));
  }
}

// ── Main Menu ────────────────────────────────────────────────────────────────

async function menu(rl: readline.Interface, pool: pg.Pool) {
  console.log();
  console.log(bold("  ┌─ Main Menu ─────────────────────────────────────────┐"));
  console.log("  │                                                     │");
  console.log(`  │  ${cyan("1")}  Drizzle push            ${dim("(apply schema changes)")}    │`);
  console.log(`  │  ${cyan("2")}  Drizzle push --force     ${dim("(dangerous, asks confirm)")} │`);
  console.log(`  │  ${cyan("3")}  Apply optimizations       ${dim("(indexes + views SQL)")}    │`);
  console.log(`  │  ${cyan("4")}  Apply custom SQL file     ${dim("(enter path)")}             │`);
  console.log("  │                                                     │");
  console.log(`  │  ${cyan("5")}  List tables + row counts                         │`);
  console.log(`  │  ${cyan("6")}  List custom indexes                               │`);
  console.log(`  │  ${cyan("7")}  List views                                        │`);
  console.log(`  │  ${cyan("8")}  Session + job cleanup     ${dim("(expired rows)")}           │`);
  console.log(`  │  ${cyan("9")}  Re-test connection                                 │`);
  console.log("  │                                                     │");
  console.log(`  │  ${yellow("0")}  Exit                                              │`);
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log();

  const choice = (await rl.question("  Enter choice: ")).trim();

  switch (choice) {
    case "1": {
      console.log(yellow("\n  This will apply all pending Drizzle schema changes (additive only)."));
      if (await confirm(rl, "Proceed with drizzle-kit push?")) {
        runDrizzleKit(["push"]);
      } else {
        console.log(dim("  Cancelled."));
      }
      break;
    }
    case "2": {
      console.log(red("\n  WARNING: --force push can DROP columns/tables that are not in schema."));
      if (await confirm(rl, "Are you SURE you want to force push?")) {
        if (await confirm(rl, "Double confirm — this may be DESTRUCTIVE. Continue?")) {
          runDrizzleKit(["push", "--force"]);
        }
      } else {
        console.log(dim("  Cancelled."));
      }
      break;
    }
    case "3": {
      if (!existsSync(OPTIMIZATION_SQL)) {
        console.log(red(`\n  File not found: ${OPTIMIZATION_SQL}`));
        break;
      }
      console.log(yellow(`\n  Will apply: ${path.basename(OPTIMIZATION_SQL)}`));
      console.log(dim("  Contains: 15 indexes, v_unified_worklist, v_today_worklist, v_active_sessions, session columns"));
      if (await confirm(rl, "Apply optimizations SQL to the database?")) {
        const sql = readFileSync(OPTIMIZATION_SQL, "utf-8");
        await runSql(pool, sql, path.basename(OPTIMIZATION_SQL));
      } else {
        console.log(dim("  Cancelled."));
      }
      break;
    }
    case "4": {
      const filePath = (await rl.question("  SQL file path: ")).trim().replace(/^['"]|['"]$/g, "");
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      if (!existsSync(resolved)) {
        console.log(red(`\n  File not found: ${resolved}`));
        break;
      }
      if (await confirm(rl, `Apply ${path.basename(resolved)} to the database?`)) {
        const sql = readFileSync(resolved, "utf-8");
        await runSql(pool, sql, path.basename(resolved));
      } else {
        console.log(dim("  Cancelled."));
      }
      break;
    }
    case "5": {
      await showTables(pool);
      break;
    }
    case "6": {
      await showIndexes(pool);
      break;
    }
    case "7": {
      await showViews(pool);
      break;
    }
    case "8": {
      console.log(yellow("\n  Will delete:"));
      console.log(dim("    portal_sessions older than 7 days (expired)"));
      console.log(dim("    scan_sessions older than 1 day (expired)"));
      console.log(dim("    super_admin_sessions older than 7 days"));
      console.log(dim("    dicom_pull_jobs completed/failed older than 30 days"));
      if (await confirm(rl, "Run cleanup?")) {
        await sessionCleanup(pool);
      } else {
        console.log(dim("  Cancelled."));
      }
      break;
    }
    case "9": {
      await testConnection();
      break;
    }
    case "0": {
      console.log(green("\n  Goodbye!\n"));
      await pool.end();
      rl.close();
      process.exit(0);
    }
    default: {
      console.log(yellow("\n  Unknown choice. Please enter 0-9."));
    }
  }
}

// ── Entry ────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  console.log(dim("  Testing database connection...\n"));
  const pool = await testConnection();
  if (!pool) {
    console.log(red("\n  Cannot connect to the database. Check .env / DATABASE_URL.\n"));
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output, terminal: true });

  // Graceful exit on Ctrl+C
  rl.on("close", async () => {
    console.log(green("\n  Goodbye!\n"));
    await pool.end().catch(() => {});
    process.exit(0);
  });

  // Main loop
  while (true) {
    banner();
    await menu(rl, pool);
    console.log();
    await rl.question(dim("  Press Enter to continue..."));
  }
}

main().catch((err) => {
  console.error(red(`\n  Fatal error: ${err instanceof Error ? err.message : err}\n`));
  process.exit(1);
});
