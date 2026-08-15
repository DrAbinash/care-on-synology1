/**
 * Split a migration SQL file into individual statements for node-postgres.
 * psql -f auto-commits each statement; client.query(multi-stmt) wraps them in
 * one transaction and breaks ALTER SYSTEM ("cannot run inside a transaction").
 */
export function splitMigrationStatements(sql) {
  const stripped = sql
    .replace(/^﻿/, "")
    .replace(/--> statement-breakpoint/g, "")
    .replace(/--[^\n]*/g, "");

  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
