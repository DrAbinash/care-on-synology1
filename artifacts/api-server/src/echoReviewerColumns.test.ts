import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Echo / Fetal Echo report sign-off — reviewer column type contract.
//
// Production defect: echo_reports.reviewed_by/.finalized_by and
// fetal_echo_studies.reviewed_by/.finalized_by were INTEGER in the live DB
// because the api-server runtime bootstrap DDL declared them INTEGER and won
// the race against the Drizzle migration (which declares text()). The routes
// write a reviewer NAME (staffSession.subjectName), so EVERY Review and
// Finalize aborted with `22P02 invalid input syntax for type integer` —
// reports stuck at status='draft', unable to be signed or delivered.
//
// This pins all three sides of the contract so the mismatch cannot silently
// reappear: the Drizzle declaration, the bootstrap DDL, and the repair
// migration. fetal_usg_reports is asserted to stay integer, since its schema
// declares integer() and its route writes subjectId.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");

const indexSrc = readFileSync(join(__dirname, "index.ts"), "utf8");
const echoSchema = readFileSync(join(REPO, "lib", "db", "src", "schema", "echoCardiology.ts"), "utf8");
const echoRoutes = readFileSync(join(__dirname, "routes", "echoCardiology.ts"), "utf8");
const migration = readFileSync(
  join(REPO, "migrations", "zzzzzz_fix_echo_reviewer_columns_to_text.sql"),
  "utf8",
);

/** The CREATE TABLE body for a table in the runtime bootstrap DDL. */
function ddlBody(table: string): string {
  const start = indexSrc.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  expect(start, `bootstrap DDL for ${table} must exist`).toBeGreaterThan(-1);
  const end = indexSrc.indexOf(");", start);
  expect(end).toBeGreaterThan(start);
  return indexSrc.slice(start, end);
}

describe("echo reviewer columns — text, end to end", () => {
  test("Drizzle declares reviewed_by/finalized_by as text for both echo tables", () => {
    expect(echoSchema).toContain('reviewedBy: text("reviewed_by")');
    expect(echoSchema).toContain('finalizedBy: text("finalized_by")');
    // Both tables (echo_reports and fetal_echo_studies) declare them.
    expect((echoSchema.match(/reviewedBy: text\("reviewed_by"\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("the routes write a NAME, which is what forces text", () => {
    expect(echoRoutes).toContain("reviewedBy: s.subjectName");
    expect(echoRoutes).toContain("finalizedBy: s.subjectName");
  });

  test("bootstrap DDL declares TEXT (not INTEGER) for both echo tables", () => {
    for (const table of ["echo_reports", "fetal_echo_studies"]) {
      const body = ddlBody(table);
      expect(body, `${table} reviewed_by must be TEXT`).toContain("reviewed_by TEXT");
      expect(body, `${table} finalized_by must be TEXT`).toContain("finalized_by TEXT");
      expect(body, `${table} must not reintroduce INTEGER`).not.toContain("reviewed_by INTEGER");
      expect(body, `${table} must not reintroduce INTEGER`).not.toContain("finalized_by INTEGER");
    }
  });

  test("fetal_usg_reports deliberately stays INTEGER (writes subjectId)", () => {
    const body = ddlBody("fetal_usg_reports");
    expect(body).toContain("reviewed_by INTEGER");
    expect(body).toContain("finalized_by INTEGER");
  });

  test("repair migration is guarded on the column actually being integer", () => {
    // Only converts when live type is integer → safe/no-op on correct DBs.
    expect(migration).toContain("data_type    = 'integer'");
    expect(migration).toContain("TYPE text USING");
    // Covers all four affected columns.
    for (const pair of [
      "('echo_reports',       'reviewed_by')",
      "('echo_reports',       'finalized_by')",
      "('fetal_echo_studies', 'reviewed_by')",
      "('fetal_echo_studies', 'finalized_by')",
    ]) {
      expect(migration).toContain(pair);
    }
    // Must NOT touch the intentionally-integer tables. Check the EXECUTABLE
    // SQL only — both are named in the migration's scope-note comment, which
    // is documentation, not an operation.
    const executable = migration
      .split("\n")
      .filter(line => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toContain("fetal_usg_reports");
    expect(executable).not.toContain("radiology_ai_enhancements");
  });
});
