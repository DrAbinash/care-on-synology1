import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { splitMigrationStatements } from "../scripts/split-migration-sql.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("postgres tuning migration splits into standalone ALTER SYSTEM statements", () => {
  const sql = readFileSync(path.join(repo, "migrations/zzzz_postgres_performance_tuning.sql"), "utf8");
  const stmts = splitMigrationStatements(sql);
  expect(stmts.length).toBeGreaterThanOrEqual(6);
  expect(stmts.some((s) => /^ALTER SYSTEM SET max_wal_size/i.test(s))).toBe(true);
  expect(stmts.some((s) => /^SELECT pg_reload_conf/i.test(s))).toBe(true);
});
