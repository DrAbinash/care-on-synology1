import { describe, it, expect } from "vitest";
const { loadCoreDrizzleTables, checkFeatureMigrations } = require("./check-migration-order.cjs");

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
});
