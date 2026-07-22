import { describe, it, expect } from "vitest";
const { loadCoreDrizzleTables, checkFeatureMigrations, extractStatements } = require("./check-migration-order.cjs");

// Regression coverage for the incident where care-db-patch-v2 deployment
// failed with `relation "companion_runs" does not exist` while applying
// migrations/add_companion_autopopulation_columns.sql. Root cause: feature
// migrations apply in plain alphabetical filename order
// (docker/db-patch-entrypoint.sh: `ls migrations/*.sql | sort`), and that
// file's name sorted before migrations/add_usg_companion_runs.sql — the
// migration that actually creates the table it alters. Fixed by renaming to
// migrations/add_usg_companion_runs_autopopulation_columns.sql, which is
// alphabetically guaranteed to sort after its prerequisite (a filename that
// is an exact prefix of another always sorts first).
//
// This test re-runs the same static analysis on every real migration file
// in the repo, so it fails the build the moment *any* future migration
// (companion-related or not) reintroduces this class of bug — not just the
// one historical case.
describe("feature migration execution order", () => {
  it("every ALTER TABLE / CREATE INDEX / CREATE TRIGGER / REFERENCES target already exists earlier in alphabetical execution order", () => {
    const known = loadCoreDrizzleTables();
    const { violations } = checkFeatureMigrations(known);

    if (violations.length > 0) {
      const detail = violations
        .map(
          (v) =>
            `  ${v.file}: ${v.type} references "${v.table}"` +
            (v.createdLaterBy
              ? ` (created later by ${v.createdLaterBy} — rename this file to sort after it)`
              : ` (no migration creates this table at all)`)
        )
        .join("\n");
      throw new Error(
        `${violations.length} migration ordering violation(s) found — deployment would fail:\n${detail}`
      );
    }

    expect(violations).toEqual([]);
  });

  it("companion_runs is created before it is altered (the original incident)", () => {
    const known = loadCoreDrizzleTables();
    const { violations } = checkFeatureMigrations(known);
    const companionViolations = violations.filter((v) => v.table === "companion_runs");
    expect(companionViolations).toEqual([]);
  });

  // Regression coverage for the second incident (CARE ERP final stabilization):
  // add_ai_clinical_config.sql did `INSERT INTO feature_flags (...)` but
  // feature_flags was CREATEd by add_radiology_feature_flags.sql, which sorts
  // alphabetically AFTER it. On an existing production DB feature_flags already
  // existed so the bug was invisible; on a COMPLETELY EMPTY database the INSERT
  // hit `relation "feature_flags" does not exist` and hard-stopped the whole
  // feature-migration step (ON_ERROR_STOP=1), so a clean bootstrap could never
  // complete. The original checker only inspected DDL (ALTER/INDEX/FK/TRIGGER)
  // and missed DML entirely. Fixed by (a) an early aaaa_bootstrap_feature_flags.sql
  // that CREATEs the table first, and (b) teaching the checker about
  // INSERT/UPDATE/DELETE targets so the class of bug fails preflight.
  it("feature_flags exists before any INSERT/UPDATE/DELETE into it (clean-boot regression)", () => {
    const known = loadCoreDrizzleTables();
    const { violations } = checkFeatureMigrations(known);
    const flagViolations = violations.filter((v) => v.table === "feature_flags");
    expect(flagViolations).toEqual([]);
  });

  it("extractStatements detects DML targets (INSERT INTO / UPDATE / DELETE FROM)", () => {
    const sql = `
      INSERT INTO feature_flags (key) VALUES ('x');
      UPDATE email_settings SET a = 1;
      DELETE FROM stale_rows WHERE id = 2;
      SELECT id FROM orders FOR UPDATE OF orders;  -- must NOT be read as an UPDATE
    `;
    const stmts = extractStatements(sql);
    const byType = (t) => stmts.filter((s) => s.type === t).map((s) => s.table);
    expect(byType("INSERT_INTO")).toContain("feature_flags");
    expect(byType("UPDATE_TABLE")).toContain("email_settings");
    expect(byType("DELETE_FROM")).toContain("stale_rows");
    // "SELECT ... FOR UPDATE OF orders" must not be mistaken for an UPDATE stmt.
    expect(byType("UPDATE_TABLE")).not.toContain("of");
    expect(byType("UPDATE_TABLE")).not.toContain("orders");
  });
});
