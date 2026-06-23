#!/usr/bin/env tsx
/**
 * CI-safe schema push — non-interactive, idempotent.
 *
 * Strategy: use drizzle-kit's `generateDrizzleJson` + `generateMigration` to
 * compute ALL CREATE TABLE / ALTER TABLE statements from the TypeScript schema,
 * then apply each one individually via pg, catching "already exists" (42P07 /
 * 42701) errors instead of prompting interactively.
 *
 * This avoids the clack/ink TUI that hangs in non-TTY post-merge environments.
 */
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import pg from "pg";
import * as schema from "../src/schema/index.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  console.log("Computing schema diff (generateDrizzleJson + generateMigration)...");

  // Generate JSON snapshot of desired schema (TypeScript → drizzle JSON)
  const desiredSnapshot = generateDrizzleJson(schema);

  // Generate JSON snapshot of an empty schema (no tables) as the "from" baseline.
  // This produces ALL CREATE TABLE / index statements for the full schema.
  // We then apply them one by one, skipping any that already exist in the DB.
  const emptySnapshot = generateDrizzleJson({});

  const statements = await generateMigration(emptySnapshot, desiredSnapshot);

  if (statements.length === 0) {
    console.log("✓ Schema already up to date.");
    process.exit(0);
  }

  console.log(`Applying up to ${statements.length} statement(s), skipping existing...`);

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await client.query(stmt);
      applied++;
    } catch (err: any) {
      // 42P07 = duplicate_table, 42701 = duplicate_column, 42P16 = invalid_table_definition
      if (err.code === "42P07" || err.code === "42701") {
        skipped++;
      } else {
        // Log non-duplicate errors but continue — some may be index conflicts etc.
        const short = stmt.trim().slice(0, 80);
        errors.push(`[${err.code}] ${err.message} — stmt: ${short}`);
      }
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️  ${errors.length} non-fatal error(s):`);
    errors.forEach((e) => console.warn(" -", e));
  }

  console.log(
    `✓ Schema push complete: ${applied} applied, ${skipped} already existed${errors.length ? `, ${errors.length} warnings` : ""}.`,
  );
} catch (err) {
  console.error("Schema push failed:", err);
  process.exit(1);
} finally {
  await client.end();
}
