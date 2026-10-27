/**
 * The migration container must not report success for a migration that failed.
 *
 * WHY THIS FILE EXISTS
 * `docker/db-patch-entrypoint.sh` applies Drizzle migrations with
 * `ON_ERROR_STOP=0` — deliberately, because two historical statements are
 * self-inconsistent on an empty database — and `ON_ERROR_STOP=0` also makes
 * `psql` exit 0 whatever happened. Before this test existed, that meant a
 * Drizzle migration could raise a real error, be printed and ignored, be
 * recorded in `drizzle.__drizzle_migrations` and `schema_migrations_log` as
 * applied, set `db_patch_ok=true`, print "✓ All migrations complete — API may
 * start", and then be SKIPPED FOREVER on every later deploy. Measured, not
 * theorised: a journal entry whose second statement fails produced exactly that
 * on a fresh database, and the container that runs next — `care-schema-verify`,
 * which only checks the columns the migration files declare — reported
 * `SCHEMA VERIFICATION PASSED` on the resulting half-migrated schema.
 *
 * The feature-migration step never had this hole (it runs `ON_ERROR_STOP=1 -f`
 * and `|| fail`), which is why the asymmetry is the thing being pinned here.
 *
 * These are source-contract assertions rather than a shell run because the
 * runner has no `psql` and no Docker; the end-to-end proof against a real
 * Postgres is recorded in the PR and reproduced by the commands in
 * docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md. The checks are written as a predicate
 * over the script text so each one can be shown to FAIL on a mutated copy —
 * an assertion that cannot fail is not a gate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Checked out as CRLF on Windows; the blob is LF. Normalise before matching so
// multi-line anchors cannot silently miss.
const script = readFileSync(
  fileURLToPath(new URL("../docker/db-patch-entrypoint.sh", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

/** Comment lines carry the rationale, not the behaviour: exclude them. */
const code = script
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

const rules = {
  /** The Drizzle step's output goes somewhere it can be read, not into a pipe
   *  whose exit status belongs to `grep`. */
  drizzleOutputCaptured: (t) => /ON_ERROR_STOP=0 -q >"\$\{mig_out\}" 2>&1/.test(t),
  /** A scan of that output for real errors, using the same exact benign set the
   *  log filter uses — nothing broader. */
  drizzleErrorsScanned: (t) =>
    /mig_err=\$\(grep "ERROR:" "\$\{mig_out\}" \\\n\s*\| grep -v "already exists"/.test(t)
    && /head -3\)/.test(t),
  /** The scan decides control flow: `fail` inside the guard, not printed near it. */
  drizzleScanGatesFailure: (t) =>
    /if \[ -n "\$\{mig_err\}" \]; then[\s\S]{0,200}?fail "Drizzle migration \$\{tag\}/.test(t),
  /** And it decides it BEFORE anything is recorded as applied. */
  drizzleFailsBeforeRecording(t) {
    const guard = t.indexOf('if [ -n "${mig_err}" ]');
    const record = t.indexOf("INSERT INTO drizzle.__drizzle_migrations");
    return guard !== -1 && record !== -1 && guard < record;
  },
  /** Feature migrations keep their hard stop. */
  featureHardStop: (t) =>
    /-v ON_ERROR_STOP=1 -q -f "\$\{file\}" \|\| fail "Feature migration FAILED/.test(t),
  /** The success banner is still the last thing, after the fingerprint. */
  bannerAfterFingerprint(t) {
    const banner = t.indexOf("All migrations complete — API may start");
    const fingerprint = t.indexOf("db_patch_ok', 'true'");
    return banner !== -1 && fingerprint !== -1 && fingerprint < banner;
  },
};

describe("care-db-patch-v2: a failed migration cannot report success", () => {
  it("the script runs under set -e", () => {
    expect(/^set -e$/m.test(code)).toBe(true);
  });

  it("the Drizzle step captures psql's output instead of discarding its status", () => {
    expect(rules.drizzleOutputCaptured(code)).toBe(true);
  });

  it("the captured output is scanned for ERROR lines, with the exact benign set only", () => {
    expect(rules.drizzleErrorsScanned(code)).toBe(true);
    // Both filters must carry the SAME two exact benign patterns: a scan that
    // allowed more than the log filter would hide a real failure.
    expect((code.match(/column "\(pull_interval_minutes\|pull_query_days\)" of relation "dicom_nodes" does not exist/g) || []).length).toBe(2);
    expect((code.match(/grep -v 'column "daily_summary_last_sent_date" does not exist'/g) || []).length).toBe(2);
  });

  it("an unexpected error stops the run through fail, before anything is recorded", () => {
    expect(rules.drizzleScanGatesFailure(code)).toBe(true);
    expect(rules.drizzleFailsBeforeRecording(code)).toBe(true);
  });

  it("the feature-migration step still hard-stops on the first error", () => {
    expect(rules.featureHardStop(code)).toBe(true);
  });

  it("the success banner is printed only after the fingerprint is written", () => {
    expect(rules.bannerAfterFingerprint(code)).toBe(true);
  });

  it("the migration lock is released on the failure path too", () => {
    expect(code).toMatch(/trap release_lock EXIT INT TERM/);
    // `fail` exits, so the trap is the only release on that path — it must be
    // installed before the first mutation, not after.
    expect(code.indexOf("trap release_lock")).toBeLessThan(code.indexOf("CREATE TABLE IF NOT EXISTS \"public\".\"schema_migrations_log\""));
  });
});

describe("the gate can fail (positive controls)", () => {
  const mutates = [
    ["status-only check (the original defect)", (t) =>
      t.replace(/mig_err=\$\(grep "ERROR:"[\s\S]*?\| head -3\)/, "mig_err="),
      "drizzleErrorsScanned"],
    ["records the migration before looking", (t) => {
      const guard = t.indexOf('if [ -n "${mig_err}" ]');
      const end = t.indexOf("fi", guard);
      return t.slice(0, guard) + t.slice(end + 2);
    }, "drizzleFailsBeforeRecording"],
    ["warns instead of failing", (t) =>
      t.replace('fail "Drizzle migration ${tag}', 'warn "Drizzle migration ${tag}'),
      "drizzleScanGatesFailure"],
    ["lets any ERROR through the benign filter", (t) =>
      t.replace(/mig_err=\$\(grep "ERROR:" "\$\{mig_out\}"[\s\S]*?\| head -3\)/,
        'mig_err=$(grep "ERROR:" "${mig_out}" | grep -v "" | head -3)'),
      "drizzleErrorsScanned"],
    ["drops the feature step's hard stop", (t) =>
      t.replace('|| fail "Feature migration FAILED: ${name}"', '|| true'),
      "featureHardStop"],
    ["prints the banner before the fingerprint", (t) => {
      const fp = t.indexOf("db_patch_ok', 'true'");
      return t.slice(0, fp) + "db_patch_ok', 'never')\n" + t.slice(t.indexOf(";", fp) + 1);
    }, "bannerAfterFingerprint"],
  ];

  for (const [name, mutate, rule] of mutates) {
    it(`mutant "${name}" is caught by ${rule}`, () => {
      const broken = mutate(code);
      expect(broken).not.toBe(code);
      expect(rules[rule](broken)).toBe(false);
      // and the unmutated text still satisfies it, so the mutant is the difference
      expect(rules[rule](code)).toBe(true);
    });
  }
});
