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
  /** And it decides it BEFORE anything is recorded as applied.
   *
   *  Scoped deliberately: from the point the loop has committed to applying this
   *  tag, to the first call that writes the ledger. Searching the whole file for
   *  `INSERT INTO drizzle.__drizzle_migrations` stopped meaning anything once the
   *  recording moved into the `record_ledger_only` / `apply_atomic` helpers — those
   *  text occurrences are function DEFINITIONS that sit earlier in the file than
   *  any loop, so an unscoped index compared the guard against a definition. The
   *  recording CALL inside the loop is the thing that must come second. */
  drizzleFailsBeforeRecording(t) {
    const apply = t.indexOf('info "  [apply] ${tag}…"');
    const guard = t.indexOf('if [ -n "${mig_err}" ]', apply);
    const record = t.indexOf('record_ledger_only "${tag}" "drizzle"', apply);
    return apply !== -1 && guard !== -1 && record !== -1 && guard < record;
  },
  /** The transactional path is the default: a Drizzle file the two known-benign
   *  clean-boot tags do not cover goes through apply_atomic, and a file using a
   *  statement Postgres forbids in a transaction block joins them. */
  drizzleUsesAtomicApply: (t) =>
    /apply_atomic "\$\{tag\}" "drizzle" "\$\{hash\}" "\$\{file\}"/.test(t)
    && /statement_wise=1/.test(t)
    && /non_transactional_sql "\$\{file\}"/.test(t),
  /** apply_atomic: one transaction, ON_ERROR_STOP=1, ledger rows written INSIDE it,
   *  and a failure that says nothing was applied. */
  applyAtomicIsAllOrNothing(t) {
    const fn = t.slice(t.indexOf("apply_atomic() {"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    const begin = body.indexOf('echo "BEGIN;"');
    const commit = body.indexOf('echo "COMMIT;"');
    const ledger = body.indexOf("INSERT INTO public.schema_migrations_log");
    return begin !== -1 && commit !== -1 && ledger !== -1
      && begin < ledger && ledger < commit
      && /-v ON_ERROR_STOP=1 -q -f "\$\{_sql\}"/.test(body)
      && /fail "Migration \$1 was NOT applied/.test(body);
  },
  /** A migration whose checksum moved is never accepted silently, for either kind,
   *  and the authorisation door can only re-record — it must not re-execute. */
  checksumChangeRefused(t) {
    return (t.match(/fail "CHECKSUM CHANGED:/g) || []).length === 2
      && /ACCEPTED_DRIZZLE_CHANGE/.test(t) && /ACCEPTED_FEATURE_CHANGE/.test(t);
  },
  authorisedDoorRecordsOnly(t) {
    const one = (flag, rec) => {
      const s = t.indexOf(flag);
      const e = t.indexOf('fail "CHECKSUM CHANGED:', s);
      if (s === -1 || e === -1) return false;
      const win = t.slice(s, e);
      return win.includes(rec) && !win.includes("apply_atomic");
    };
    return one("ACCEPTED_DRIZZLE_CHANGE", 'record_ledger_only "${tag}"')
      && one("ACCEPTED_FEATURE_CHANGE", 'record_ledger_only "${name}"');
  },
  /** The lock: taken, heartbeated, and only stealable after a full stale window of
   *  silence — never merely "older than N minutes" while the holder is alive. */
  lockHeartbeatsAndCannotBeStolenFromALiveHolder(t) {
    const acquire = t.slice(t.indexOf("acquired=$(psql_val"), t.indexOf("if [ \"${acquired}\""));
    return /INTERVAL '\$\{LOCK_STALE\} seconds'/.test(acquire)
      && /LOCK_HEARTBEAT_PID=\$!/.test(t)
      && /kill "\$\{LOCK_HEARTBEAT_PID\}"/.test(t.slice(t.indexOf("release_lock() {")))
      && /while :; do[\s\S]{0,400}?locked_by = '\$\{LOCK_HOLDER\}'/.test(t)
      && /"\$\{LOCK_STALE\}" -le "\$\{LOCK_HEARTBEAT\}"/.test(t);
  },
  /** A corrupt or hostile journal/name value cannot reach SQL — at both entry
   *  points, and with a character-class ALLOWLIST rather than a length check,
   *  because these names are interpolated into SQL text below. */
  migrationNamesValidated(t) {
    const d = t.indexOf("while IFS=");
    const f = t.indexOf('name=$(basename "${file}")');
    if (!(d !== -1 && f !== -1)) return false;
    if (!t.slice(d, d + 400).includes('assert_safe_name "${tag}"')) return false;
    if (!t.slice(f, f + 400).includes('assert_safe_name "${name}"')) return false;
    const fn = t.slice(t.indexOf("assert_safe_name() {"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    return /\[!A-Za-z0-9_.-]/.test(body) && /fail "Refusing to process an unsafe migration name/.test(body);
  },
  /** A journal entry with no SQL file is a broken mount, not a shrug. */
  missingFileFails(t) {
    return /fail "Journal entry '\$\{tag\}' has no SQL file/.test(t)
      // and the only non-fatal route is a ledger that already proves it ran
      && /no SQL file, but the ledger records it as applied/.test(t);
  },
  /** Legacy Drizzle history in the public schema is carried forward and kept.
   *  The unconditional DROP is gone (comment lines are stripped from `code`, so
   *  the one remaining textual mention — the rationale above the step — cannot
   *  make this assertion vacuous). */
  legacyJournalPreserved(t) {
    return !/DROP TABLE IF EXISTS "public"\."__drizzle_migrations"/.test(t)
      && /preserved="__drizzle_migrations_legacy_/.test(t)
      && /ALTER TABLE public\.__drizzle_migrations RENAME TO \$\{preserved\};/.test(t)
      && /INSERT INTO drizzle\.__drizzle_migrations \(hash, created_at\)\n\s*SELECT l\.hash, l\.created_at FROM public\.__drizzle_migrations/.test(t);
  },
  /** The run refuses to continue if it opened a different database than the one it
   *  is configured for, or a different environment than the stamp says. */
  targetAndEnvironmentAsserted(t) {
    return /fail "DB TARGET MISMATCH/.test(t)
      && /fail "ENVIRONMENT MISMATCH/.test(t)
      && /fail "DB IDENTITY MISMATCH/.test(t)
      && /if \[ "\$\{real_db\}" != "\$\{DB_NAME\}" \]/.test(t);
  },
  /** Every read of the ledger fails closed: an unreadable ledger must never be
   *  read as "not applied", because that would re-run an applied migration. */
  noUnguardedLedgerRead(t) {
    const lines = t.split("\n");
    const bare = [];
    lines.forEach((l, i) => {
      if (!/=\$\(psql_val\b/.test(l)) return;
      // The guard may sit on the assignment line or on the line that closes the
      // quoted SQL, so look ahead a short way and stop at any block keyword.
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (j > i && /^\s*(if|fi|done|do|else|elif|}\s*$)\b/.test(lines[j])) break;
        if (lines[j].includes("||")) return;
      }
      bare.push(`${i + 1}: ${l.trim().slice(0, 70)}`);
    });
    // An object-literal method has no binding for its own name inside its body,
    // so the offenders are parked on `rules` (in scope at call time) — a mutant's
    // failure then names the exact line instead of just reading "false".
    if (bare.length) rules.noUnguardedLedgerRead.last = bare;
    return bare.length === 0;
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

describe("care-db-patch-v2: the hardening the deployment spec asked for", () => {
  it("the default path is one transaction, not statement-by-statement autocommit", () => {
    expect(rules.drizzleUsesAtomicApply(code)).toBe(true);
    expect(rules.applyAtomicIsAllOrNothing(code)).toBe(true);
  });

  it("a changed checksum stops the run, for both kinds of migration", () => {
    expect(rules.checksumChangeRefused(code)).toBe(true);
    // Each kind gets its own authorisation variable, and each name must be
    // listed deliberately: accepting a re-recorded Drizzle tag must not also
    // accept a re-recorded feature file.
    expect(code).toMatch(/ACCEPTED_DRIZZLE_CHANGE:-/);
    expect(code).toMatch(/ACCEPTED_FEATURE_CHANGE:-/);
  });

  it("the authorisation door re-records and never re-executes", () => {
    expect(rules.authorisedDoorRecordsOnly(code)).toBe(true);
  });

  it("the lock cannot be taken from a run that is still heartbeating", () => {
    expect(rules.lockHeartbeatsAndCannotBeStolenFromALiveHolder(code)).toBe(true);
  });

  it("every migration name from the journal or the directory is validated before it reaches SQL", () => {
    expect(rules.migrationNamesValidated(code)).toBe(true);
  });

  it("a journal entry with no SQL file fails unless the ledger proves it already ran", () => {
    expect(rules.missingFileFails(code)).toBe(true);
  });

  it("a legacy Drizzle journal in the public schema is preserved, not dropped", () => {
    expect(rules.legacyJournalPreserved(code)).toBe(true);
  });

  it("the run refuses a database it did not mean to open", () => {
    expect(rules.targetAndEnvironmentAsserted(code)).toBe(true);
  });

  it("no ledger read can be answered with an empty string and read as 'not applied'", () => {
    delete rules.noUnguardedLedgerRead.last;
    expect(rules.noUnguardedLedgerRead(code)).toBe(true);
    expect(rules.noUnguardedLedgerRead.last).toBeUndefined();
  });

  it("the entrypoint reverses nothing of its own", () => {
    // Task 3: "Do not automatically reverse database migrations." Anything that
    // destroys schema in this container comes from a migration FILE the operator
    // reviewed; the script's own statements never do. Comment lines are already
    // stripped from `code`, so the rationale that quotes the old DROP cannot
    // satisfy this by accident.
    expect(code.match(/\b(DROP TABLE|DROP COLUMN|TRUNCATE)\b/g) || []).toEqual([]);
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

    // ── controls for the rules added with the deployment hardening ──────────
    ["apply_atomic autocommits instead of opening a transaction", (t) =>
      t.replace('    echo "BEGIN;"\n', ""),
      "applyAtomicIsAllOrNothing"],
    ["apply_atomic swallows the errors it is meant to roll back on", (t) =>
      t.replace('-v ON_ERROR_STOP=1 -q -f "${_sql}"', '-v ON_ERROR_STOP=0 -q -f "${_sql}"'),
      "applyAtomicIsAllOrNothing"],
    ["a changed feature checksum only warns", (t) =>
      t.replace('fail "CHECKSUM CHANGED: ${name}', 'warn "CHECKSUM CHANGED: ${name}'),
      "checksumChangeRefused"],
    ["the authorisation door re-executes the migration", (t) =>
      t.replace('record_ledger_only "${tag}" "drizzle" "${hash}" "${when_val}"\n          warn "  [authorised]',
        'apply_atomic "${tag}" "drizzle" "${hash}" "${file}" "${when_val}"\n          warn "  [authorised]'),
      "authorisedDoorRecordsOnly"],
    ["the lock goes stale instantly, so a live run can be interrupted", (t) =>
      t.replace("OR locked_at < NOW() - INTERVAL '${LOCK_STALE} seconds'", "OR locked_at < NOW() - INTERVAL '0 seconds'"),
      "lockHeartbeatsAndCannotBeStolenFromALiveHolder"],
    ["the heartbeat renews whichever row it finds, not the one it owns", (t) =>
      t.replace("WHERE id = 1 AND locked = TRUE AND locked_by = '${LOCK_HOLDER}';", "WHERE id = 1;"),
      "lockHeartbeatsAndCannotBeStolenFromALiveHolder"],
    ["a journal tag reaches SQL unvalidated", (t) =>
      t.replace('  assert_safe_name "${tag}"\n', "  : # validation removed\n"),
      "migrationNamesValidated"],
    ["the allowlist grows a `;` (someone widening it to 'fix' a name)", (t) =>
      t.replace('*[!A-Za-z0-9_.-]*|""', '*[!A-Za-z0-9_.;-]*|""'),
      "migrationNamesValidated"],
    ["a missing SQL file warns instead of failing", (t) =>
      t.replace(`fail "Journal entry '\${tag}' has no SQL file`, `warn "Journal entry '\${tag}' has no SQL file`),
      "missingFileFails"],
    ["drops the legacy Drizzle journal on every boot (the original behaviour)", (t) =>
      'DROP TABLE IF EXISTS "public"."__drizzle_migrations";\n' + t,
      "legacyJournalPreserved"],
    ["opens a database it was not configured for", (t) =>
      t.replace('fail "DB TARGET MISMATCH', 'warn "DB TARGET MISMATCH'),
      "targetAndEnvironmentAsserted"],
    ["reads the ledger without a guard, so failure looks like 'not applied'", (t) =>
      t.replace('") || fail "Cannot read drizzle.__drizzle_migrations — refusing to run migrations"', '")'),
      "noUnguardedLedgerRead"],
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
