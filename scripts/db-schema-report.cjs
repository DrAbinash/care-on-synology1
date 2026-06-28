#!/usr/bin/env node
/**
 * db-schema-report.cjs
 * ====================
 * Generates DB_SCHEMA_VERIFICATION_REPORT.md from the live database.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/db-schema-report.cjs
 *
 * Output:
 *   DB_SCHEMA_VERIFICATION_REPORT.md  (in current working directory)
 */

"use strict";

const { Client } = require("pg");
const fs   = require("fs");
const path = require("path");

// Re-use the verifier logic by requiring it inline
// (We share the parsing functions via a common require pattern)
// Since we can't easily import from the other CJS file without duplicating,
// we call the verifier in --json mode and parse its output.

const { execFileSync } = require("child_process");

const VERIFIER = path.join(__dirname, "db-schema-verify.cjs");

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error("DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("Generating schema verification report...");

  // Run verifier in JSON mode to get structured results
  let verifyOutput;
  try {
    verifyOutput = execFileSync(
      process.execPath,
      [VERIFIER, "--json", "--quiet"],
      {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      }
    );
  } catch (err) {
    // execFileSync throws if exit code != 0, but we still get stdout
    verifyOutput = err.stdout || "{}";
  }

  let results;
  try {
    results = JSON.parse(verifyOutput);
  } catch {
    results = { pass: false, error: "Failed to parse verifier output" };
  }

  // Also get live table list for completeness
  const client = new Client({ connectionString: connStr });
  let liveTablesAll = [];
  let liveColumnCount = 0;
  let migrationLog = [];
  let deployState = {};
  let drizzleLog = [];

  try {
    await client.connect();

    const tr = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    liveTablesAll = tr.rows.map(r => r.table_name);

    const cr = await client.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = 'public'
    `);
    liveColumnCount = parseInt(cr.rows[0].cnt);

    try {
      const ml = await client.query(`
        SELECT name, kind, applied_at, sha256 FROM public.schema_migrations_log ORDER BY applied_at
      `);
      migrationLog = ml.rows;
    } catch { /* table may not exist yet */ }

    try {
      const ds = await client.query(`SELECT key, value, updated_at FROM public.schema_deploy_state ORDER BY key`);
      for (const row of ds.rows) deployState[row.key] = { value: row.value, updated_at: row.updated_at };
    } catch { /* table may not exist yet */ }

    try {
      const dr = await client.query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
      drizzleLog = dr.rows;
    } catch { /* table may not exist yet */ }

  } finally {
    await client.end().catch(() => {});
  }

  const now = new Date().toISOString();
  const statusEmoji = results.pass ? "✅" : "❌";
  const statusText  = results.pass ? "PASS" : "FAIL";

  const lines = [];

  lines.push(`# DB Schema Verification Report`);
  lines.push(``);
  lines.push(`**Generated:** ${now}  `);
  lines.push(`**Status:** ${statusEmoji} **${statusText}**  `);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ── Summary ──
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Overall Status | ${statusEmoji} ${statusText} |`);
  lines.push(`| Tables in Live DB | ${liveTablesAll.length} |`);
  lines.push(`| Columns in Live DB | ${liveColumnCount} |`);
  lines.push(`| Tables Verified | ${results.stats?.tablesChecked ?? "?"} |`);
  lines.push(`| Tables Passed | ${results.stats?.tablesPassed ?? "?"} |`);
  lines.push(`| Columns Verified | ${results.stats?.columnsChecked ?? "?"} |`);
  lines.push(`| Columns Passed | ${results.stats?.columnsPassed ?? "?"} |`);
  lines.push(`| Missing Tables | ${results.missingTables?.length ?? 0} |`);
  lines.push(`| Missing Columns | ${results.missingColumns?.length ?? 0} |`);
  lines.push(`| Type Mismatches | ${results.typeMismatches?.length ?? 0} |`);
  lines.push(`| Missing Indexes | ${results.missingIndexes?.length ?? 0} |`);
  lines.push(`| Warnings | ${results.warnings?.length ?? 0} |`);
  lines.push(``);

  // ── Deploy State ──
  lines.push(`## Deploy State`);
  lines.push(``);
  if (Object.keys(deployState).length > 0) {
    lines.push(`| Key | Value | Updated |`);
    lines.push(`|---|---|---|`);
    for (const [k, v] of Object.entries(deployState)) {
      lines.push(`| \`${k}\` | ${v.value} | ${v.updated_at?.toString().slice(0,19) || "?"} |`);
    }
  } else {
    lines.push(`_No deploy state found — db-patch-v2 may not have run yet._`);
  }
  lines.push(``);

  // ── Missing Tables ──
  if (results.missingTables?.length > 0) {
    lines.push(`## ❌ Missing Tables`);
    lines.push(``);
    lines.push(`These tables are expected by the Drizzle schema but do not exist in the live DB:`);
    lines.push(``);
    for (const t of results.missingTables) {
      lines.push(`- \`${t}\``);
    }
    lines.push(``);
  }

  // ── Missing Columns ──
  if (results.missingColumns?.length > 0) {
    lines.push(`## ❌ Missing Columns`);
    lines.push(``);
    lines.push(`| Table | Column | Expected Type |`);
    lines.push(`|---|---|---|`);
    for (const mc of results.missingColumns) {
      lines.push(`| \`${mc.table}\` | \`${mc.column}\` | \`${mc.expectedType}\` |`);
    }
    lines.push(``);
  }

  // ── Type Mismatches ──
  if (results.typeMismatches?.length > 0) {
    lines.push(`## ⚠️ Type Mismatches`);
    lines.push(``);
    lines.push(`_Note: Many of these are schema-compatible (e.g. varchar vs text, json vs jsonb). Review before acting._`);
    lines.push(``);
    lines.push(`| Table | Column | Expected | Actual |`);
    lines.push(`|---|---|---|---|`);
    for (const tm of results.typeMismatches) {
      lines.push(`| \`${tm.table}\` | \`${tm.column}\` | \`${tm.expected}\` | \`${tm.actual}\` |`);
    }
    lines.push(``);
  }

  // ── Missing Indexes ──
  if (results.missingIndexes?.length > 0) {
    lines.push(`## ⚠️ Missing Indexes`);
    lines.push(``);
    lines.push(`_Indexes do not affect correctness but may affect query performance._`);
    lines.push(``);
    lines.push(`| Table | Index Name |`);
    lines.push(`|---|---|`);
    for (const mi of results.missingIndexes) {
      lines.push(`| \`${mi.table}\` | \`${mi.index}\` |`);
    }
    lines.push(``);
  }

  // ── Drizzle Migration Journal ──
  lines.push(`## Drizzle Migration Journal`);
  lines.push(``);
  if (drizzleLog.length > 0) {
    lines.push(`${drizzleLog.length} Drizzle migrations applied:`);
    lines.push(``);
    lines.push(`| # | Hash (first 12) | Applied At |`);
    lines.push(`|---|---|---|`);
    for (let i = 0; i < drizzleLog.length; i++) {
      const row = drizzleLog[i];
      const ts  = row.created_at ? new Date(Number(row.created_at)).toISOString() : "?";
      lines.push(`| ${i + 1} | \`${row.hash?.slice(0, 12) ?? "?"}\` | ${ts} |`);
    }
  } else {
    lines.push(`_No Drizzle migrations found in tracking table._`);
  }
  lines.push(``);

  // ── Feature Migration Log ──
  lines.push(`## Feature Migration Log`);
  lines.push(``);
  if (migrationLog.length > 0) {
    lines.push(`${migrationLog.length} feature migrations applied:`);
    lines.push(``);
    lines.push(`| Name | Kind | Applied At |`);
    lines.push(`|---|---|---|`);
    for (const row of migrationLog) {
      lines.push(`| \`${row.name}\` | ${row.kind} | ${row.applied_at?.toString().slice(0,19) || "?"} |`);
    }
  } else {
    lines.push(`_No feature migrations found in schema_migrations_log table._`);
  }
  lines.push(``);

  // ── All Live Tables ──
  lines.push(`## All Tables in Live Database`);
  lines.push(``);
  lines.push(`${liveTablesAll.length} tables found in \`public\` schema:`);
  lines.push(``);

  // Group into columns of 3 for readability
  const cols = 3;
  for (let i = 0; i < liveTablesAll.length; i += cols) {
    const row = liveTablesAll.slice(i, i + cols).map(t => `\`${t}\``).join(" · ");
    lines.push(`${row}`);
  }
  lines.push(``);

  // ── Warnings ──
  if (results.warnings?.length > 0) {
    lines.push(`## Warnings`);
    lines.push(``);
    for (const w of results.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push(``);
  }

  // ── Remediation ──
  if (!results.pass) {
    lines.push(`## Remediation`);
    lines.push(``);
    lines.push(`Schema verification failed. Steps to fix:`);
    lines.push(``);
    lines.push(`### Option 1: Re-run migrations (recommended)`);
    lines.push(``);
    lines.push(`\`\`\`bash`);
    lines.push(`# On Synology NAS:`);
    lines.push(`cd /volume1/docker/care-erp-github/care-on-synology1`);
    lines.push(`git pull`);
    lines.push(`docker compose up -d --build`);
    lines.push(``);
    lines.push(`# Watch migration logs:`);
    lines.push(`docker compose logs -f care-db-patch-v2`);
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`### Option 2: Run migration container directly`);
    lines.push(``);
    lines.push(`\`\`\`bash`);
    lines.push(`docker compose run --rm care-migrate`);
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`### Option 3: Schema reset (TRIAL ONLY — destroys all data)`);
    lines.push(``);
    lines.push(`> ⚠️ Only use this on the trial deployment with no production data.`);
    lines.push(`> This will DROP and recreate the entire database. ALL DATA WILL BE LOST.`);
    lines.push(``);
    lines.push(`\`\`\`bash`);
    lines.push(`# 1. Stop all containers`);
    lines.push(`docker compose down`);
    lines.push(``);
    lines.push(`# 2. Delete the database volume`);
    lines.push(`docker volume rm care-erp_db_data  # adjust volume name if different`);
    lines.push(``);
    lines.push(`# 3. Rebuild and start — migrations will run from scratch`);
    lines.push(`docker compose up -d --build`);
    lines.push(``);
    lines.push(`# Data lost: EVERYTHING (patients, bills, settings, reports)`);
    lines.push(`# Use only if: this is a trial, no real patient data, and migrations are stuck`);
    lines.push(`\`\`\``);
    lines.push(``);
  }

  // ── Footer ──
  lines.push(`---`);
  lines.push(``);
  lines.push(`_Generated by scripts/db-schema-report.cjs — Care Diagnostics ERP_`);

  // Write the report
  const reportPath = path.join(process.cwd(), "DB_SCHEMA_VERIFICATION_REPORT.md");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`Report written to: ${reportPath}`);
  console.log(`Status: ${statusEmoji} ${statusText}`);

  process.exit(results.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(`Report generation failed: ${err.message}`);
  process.exit(1);
});
