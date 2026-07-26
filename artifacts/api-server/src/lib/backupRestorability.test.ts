import { describe, expect, test } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// A backup that completes is not the same as a backup that restores.
//
// Production ran for weeks producing hourly ~191 MB artifacts that the job
// recorded as "success", that had a valid SHA-256 over the bytes on disk, and
// that kept the backup dead-man alert green — none of which was restorable.
// Three independent things had to be true at once for that to happen, and each
// one is pinned here:
//
//   1. pg_dump was not installed in the api image, so exportDatabaseSql() threw
//      and every run fell through to exportDatabaseSqlFallback(), whose own
//      header reads "-- WARNING: DATA ONLY ... does NOT contain CREATE
//      TABLE/INDEX statements".
//   2. Nothing recorded WHICH exporter ran. The success row, the notes and the
//      checksum were byte-identical in shape either way, and the snapshot
//      metadata hardcoded `pgDumpUsed: true` even in the catch branch — the
//      one field an operator would check was the field that lied.
//   3. scripts/synology-restore.sh — named in the job's own success notes as
//      the way to restore — piped unconditionally through `gunzip -c`, but the
//      in-app scheduler writes an UNCOMPRESSED .sql.enc. The documented restore
//      command died at "gzip: stdin: not in gzip format" on the application's
//      own artifacts.
//
// The verification job could not catch any of this: lib/restoreVerification.ts
// takes a fresh pg_dump of its own into a throwaway database, so it never
// touches the artifact the scheduler actually wrote.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..");

const dockerfile = readFileSync(join(REPO, "Dockerfile"), "utf8");
const compose = readFileSync(join(REPO, "docker-compose.yml"), "utf8");
const cronSrc = readFileSync(join(__dirname, "..", "cron.ts"), "utf8");
const backupReplSrc = readFileSync(join(__dirname, "..", "routes", "backupReplication.ts"), "utf8");
const restoreShPath = join(REPO, "scripts", "synology-restore.sh");
const restoreSh = readFileSync(restoreShPath, "utf8");

/** The api runtime stage of the multi-stage Dockerfile. */
function apiStage(): string {
  const start = dockerfile.indexOf("FROM node:22-bookworm-slim AS api");
  expect(start, "api stage must exist").toBeGreaterThan(-1);
  const next = dockerfile.indexOf("\nFROM ", start + 1);
  return dockerfile.slice(start, next === -1 ? undefined : next);
}

/**
 * Strip comments before asserting a string is ABSENT. Every file here explains
 * the bug it fixes by quoting the broken code, so a naive `not.toContain`
 * matches the explanation and fails on a correct file.
 */
function stripComments(src: string, marker: "//" | "#"): string {
  return src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(marker) && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .join("\n");
}

describe("the api image ships the postgres client the backup path shells out to", () => {
  test("postgresql-client-16 is installed in the api runtime stage", () => {
    // Without it exportDatabaseSql() throws ENOENT on every single run and the
    // scheduler silently degrades to the DATA-ONLY fallback.
    expect(apiStage()).toMatch(/apt-get install[^\n]*postgresql-client-16/);
  });

  test("it comes from PGDG, not bookworm's default", () => {
    // Debian bookworm ships client 15. pg_dump refuses outright against a
    // newer server ("aborting because of server version mismatch") and the
    // production server is 16.x — so the bookworm package would leave the
    // exact same silent-fallback behaviour in place while looking installed.
    const stage = apiStage();
    expect(stage).toContain("apt.postgresql.org");
    expect(stage).toMatch(/bookworm-pgdg/);
  });

  test("the build asserts the major version instead of trusting the package name", () => {
    // Fail the build rather than ship an image that falls back again.
    expect(apiStage()).toMatch(/pg_dump --version \| grep -q/);
  });

  test("psql is available too — both restore paths pipe into it", () => {
    // scripts/synology-restore.sh and the in-app restore both need psql.
    // postgresql-client-16 provides it; assert the build proves it.
    expect(apiStage()).toMatch(/psql --version/);
  });

  test("the previously-installed runtime binaries are still there", () => {
    const stage = apiStage();
    for (const pkg of ["tini", "curl", "dcmtk", "openssl"]) {
      expect(stage, `${pkg} must remain installed`).toMatch(
        new RegExp(`apt-get install[^\\n]*\\b${pkg}\\b`),
      );
    }
  });
});

describe("which exporter produced an artifact is recorded, not assumed", () => {
  test("the scheduler tracks whether pg_dump or the fallback ran", () => {
    expect(cronSrc).toContain("let usedPgDump = true;");
    expect(cronSrc).toMatch(/usedPgDump = false;/);
  });

  test("the success notes name the exporter", () => {
    // So a fallback run is distinguishable from a real one in backup_job_logs
    // without re-reading the artifact.
    expect(cronSrc).toMatch(/exporter=\$\{usedPgDump \? "pg_dump" : "fallback"\}/);
  });

  test("a fallback artifact carries an explicit DATA ONLY warning in its notes", () => {
    expect(cronSrc).toMatch(/if \(!usedPgDump\)/);
    expect(cronSrc).toMatch(/DATA ONLY/);
  });

  test("snapshot metadata no longer hardcodes pgDumpUsed: true", () => {
    const code = stripComments(backupReplSrc, "//");
    expect(code, "pgDumpUsed must be a variable, not a literal").not.toMatch(/pgDumpUsed:\s*true/);
    expect(code).toContain("let pgDumpUsed = true;");
    expect(code).toMatch(/pgDumpUsed = false;/);
  });

  test("snapshot metadata explains the consequence, not just the flag", () => {
    expect(backupReplSrc).toContain("databaseSqlWarning");
  });
});

describe("BACKUP_PASSPHRASE actually reaches the container", () => {
  test("docker-compose passes it into the api service", () => {
    // It was documented and set in .env but never listed in compose, so it was
    // inert — production confirmed every artifact was keyed on SESSION_SECRET.
    expect(compose).toMatch(/BACKUP_PASSPHRASE:\s*\$\{BACKUP_PASSPHRASE:-\}/);
  });
});

describe("scripts/synology-restore.sh restores what the app actually writes", () => {
  test("it is valid bash", () => {
    const r = spawnSync("bash", ["-n", restoreShPath], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  test("it no longer pipes unconditionally through gunzip", () => {
    const code = stripComments(restoreSh, "#");
    expect(code).not.toMatch(/\|\s*gunzip -c\s*\|/);
  });

  test("it sniffs the gzip magic bytes instead of trusting the filename", () => {
    // Both artifact shapes end in .enc; only one is compressed.
    expect(restoreSh).toContain("1f8b");
  });

  test("it stops on the first SQL error rather than reporting success", () => {
    // Previously a restore that errored on every statement still printed
    // "Restore complete." because psql exits 0 without ON_ERROR_STOP.
    expect(restoreSh).toContain("ON_ERROR_STOP=1");
  });

  test("it refuses to silently restore a DATA-ONLY dump into an empty database", () => {
    expect(restoreSh).toMatch(/CREATE TABLE/);
    expect(restoreSh).toMatch(/DATA ONLY/);
  });

  test("the decrypted plaintext is cleaned up on every exit path", () => {
    // A full plaintext copy of the clinic database must not be left on the NAS
    // when a restore fails halfway.
    expect(restoreSh).toMatch(/trap cleanup EXIT/);
  });

  test("the SOP copy has not drifted from the scripts copy", () => {
    const sop = readFileSync(join(REPO, "SOP", "RECOVERY", "13_RESTORE", "synology-restore.sh"), "utf8");
    expect(sop).toBe(restoreSh);
  });
});

describe("the gzip-sniffing technique works on both real artifact shapes", () => {
  // Behavioural, not textual: build both artifacts with the same openssl flags
  // the two producers use, and prove the sniff routes each one correctly.
  // Skips (rather than fails) if the test host has no openssl — the Dockerfile
  // assertions above are what guard production.
  function haveOpenssl(): boolean {
    try {
      execFileSync("openssl", ["version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  test("an uncompressed .sql.enc (in-app scheduler) and a .sql.gz.enc (synology-backup.sh) both decode to the same SQL", () => {
    if (!haveOpenssl()) return;

    const dir = mkdtempSync(join(tmpdir(), "restore-shapes-"));
    try {
      const sql = "-- pg_dump output\nCREATE TABLE patients (id int);\nINSERT INTO patients VALUES (1);\n";
      writeFileSync(join(dir, "plain.sql"), sql);

      const enc = (input: string, output: string) =>
        execFileSync("openssl", [
          "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
          "-pass", "pass:secret", "-in", input, "-out", output,
        ]);

      // Shape 2 — what cron.ts writes: encrypt only, no gzip.
      enc(join(dir, "plain.sql"), join(dir, "b.sql.enc"));
      // Shape 1 — what synology-backup.sh writes: gzip, then encrypt.
      execFileSync("bash", ["-c", `gzip -c ${JSON.stringify(join(dir, "plain.sql"))} > ${JSON.stringify(join(dir, "a.sql.gz"))}`]);
      enc(join(dir, "a.sql.gz"), join(dir, "a.sql.gz.enc"));

      // The exact sniff the script performs.
      const decodeWithSniff = (artifact: string): string =>
        execFileSync("bash", ["-c", `
          set -euo pipefail
          openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:secret -in ${JSON.stringify(artifact)} -out ${JSON.stringify(join(dir, "payload"))}
          MAGIC="$(head -c 2 ${JSON.stringify(join(dir, "payload"))} | od -An -tx1 | tr -d ' \\n')"
          if [[ "$MAGIC" == "1f8b" ]]; then gunzip -c ${JSON.stringify(join(dir, "payload"))}; else cat ${JSON.stringify(join(dir, "payload"))}; fi
        `], { encoding: "utf8" });

      expect(decodeWithSniff(join(dir, "b.sql.enc"))).toBe(sql);
      expect(decodeWithSniff(join(dir, "a.sql.gz.enc"))).toBe(sql);

      // And confirm the OLD unconditional-gunzip pipeline really did fail on
      // the scheduler's artifact — this is the regression being fixed.
      const old = spawnSync("bash", ["-c",
        `openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:secret -in ${JSON.stringify(join(dir, "b.sql.enc"))} | gunzip -c`,
      ], { encoding: "utf8" });
      expect(old.status).not.toBe(0);
      expect(old.stderr).toMatch(/not in gzip format/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fallback (DATA ONLY) dump is detected as having no CREATE TABLE", () => {
    const dir = mkdtempSync(join(tmpdir(), "restore-dataonly-"));
    try {
      // Mirrors the header exportDatabaseSqlFallback() emits.
      writeFileSync(join(dir, "d.sql"),
        "-- Care Diagnostics Database Export\n-- WARNING: DATA ONLY\nBEGIN;\n" +
        'TRUNCATE TABLE "patients" CASCADE;\nINSERT INTO "patients" VALUES (1);\nCOMMIT;\n');
      const r = spawnSync("bash", ["-c",
        `grep -qim1 "^CREATE TABLE" ${JSON.stringify(join(dir, "d.sql"))}`,
      ]);
      expect(r.status, "fallback dump must NOT look schema-complete").not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
