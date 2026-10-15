// ============================================================================
// PR-I11B/I11-C — the Synology backup and restore-verification scripts, run for
// real against injected faults.
//
// These are the paths that decide whether the clinic can recover patient data,
// and until now nothing executed them: the only tests around backups asserted
// on their *text*. A shell script's text can be perfect while its exit status,
// its published file and its log say something else, so this harness really runs
// `bash scripts/synology-nas-backup.sh`, `bash scripts/synology-backup.sh` and
// `bash scripts/verify-backup-restore.sh` (and its SOP/RECOVERY twin) and then
// inspects what landed on disk, what the process returned, and what its children
// were handed on the command line.
//
// `docker`, `curl` and `openssl` are stubbed by executables placed first on PATH
// — the product under test is the scripts' own decisions (what they verify, what
// they publish, what they purge, what they leak into argv, and whether a failed
// restore can still print success), not PostgreSQL or a remote HTTP server. Dump
// bytes are real gzip'd SQL composed here, so the checks performed are performed
// on genuine artifacts. The `psql` calls that carry the restore and the row
// counts are answered by the docker stub, which is why "the sandbox restored
// nothing" is a testable state rather than a hypothetical one.
//
// Nothing here touches a real database, a real NAS or a real patient row.
// ============================================================================
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync, chmodSync, openSync, closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const NAS_SCRIPT = join(REPO, "scripts", "synology-nas-backup.sh");
const PULL_SCRIPT = join(REPO, "scripts", "synology-backup.sh");
const VERIFY_SCRIPT = join(REPO, "scripts", "verify-backup-restore.sh");
const RESTORE_SCRIPT = join(REPO, "scripts", "synology-restore.sh");
const VERIFY_SOP_SCRIPT = join(REPO, "SOP", "RECOVERY", "13_RESTORE", "verify-backup-restore.sh");

const PASSPHRASE = "synthetic-passphrase-never-a-real-one";
const API_KEY = "synthetic-internal-key-never-a-real-one";

/** A deterministic, incompressible-looking token per row (no crypto involved). */
function hashish(i) {
  let h = 2166136261 >>> 0;
  const seed = `synthetic-${i}`;
  for (let k = 0; k < seed.length; k++) { h ^= seed.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
  let out = "";
  for (let block = 0; block < 4; block++) {
    h = (Math.imul(h ^ (block + 1), 2654435761) >>> 0);
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** A genuine pg_dump plain-format body: header, schema, data, completion trailer. */
const completeDump = (db = "diagnostic_erp") =>
  [
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    `-- Dumped from database version 16.14`,
    `-- Dumped by pg_dump version 16.14`,
    "",
    "SET statement_timeout = 0;",
    "",
    "CREATE TABLE public.patients (id integer, name text, token text);",
    "CREATE TABLE public.bills (id integer, patient_id integer, token text);",
    "COPY public.patients (id, name, token) FROM stdin;",
    // ~40 KB of incompressible rows, for an honest reason: the script under test
    // refuses a dump below its 10 KiB floor, and 600 rows of identical padding
    // gzip down to about 3 KB — so a "good" fixture that is really a size failure
    // would make every other scenario here pass for the wrong reason.
    ...Array.from({ length: 500 }, (_, i) => `${i}\tSynthetic Patient ${i}\t${hashish(i)}`),
    "\\.",
    "-- PostgreSQL database dump complete",
    "",
  ].join("\n") + "\n";

function makeStubs(work) {
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  const calls = join(work, "calls.log");
  writeFileSync(calls, "");

  // The stub records every argv it was handed, then behaves per STUB_DOCKER_MODE.
  // Matching is done on a lowercased copy of the arguments because the two
  // generations of the restore verifier spell the same query differently
  // (`COUNT(*) FROM patients` vs `count(*) FROM patients`), and the whole point
  // is that both of them get answered.
  writeFileSync(join(bin, "docker"), [
    "#!/usr/bin/env bash",
    `printf 'docker %s\\n' "$*" >> ${JSON.stringify(calls)}`,
    'MODE="${STUB_DOCKER_MODE:-ok}"',
    'LC="$(printf \'%s\' "$*" | tr \'A-Z\' \'a-z\')"',
    'rows_for() {',
    '  case "$1" in',
    '    patients)  echo "${STUB_ROWS_PATIENTS:-120}" ;;',
    '    bills)     echo "${STUB_ROWS_BILLS:-80}" ;;',
    '    payments)  echo "${STUB_ROWS_PAYMENTS:-60}" ;;',
    '    vouchers)  echo "${STUB_ROWS_VOUCHERS:-40}" ;;',
    '    patient_reports) echo "${STUB_ROWS_REPORTS:-30}" ;;',
    '    *) echo "${STUB_ROWS_OTHER:-5}" ;;',
    '  esac',
    '}',
    'case "$LC" in',
    '  *pg_dump*)',
    '    case "$MODE" in',
    '      ok)          printf "%s" "$STUB_DUMP_BODY_GZ" | base64 -d | gunzip ;;',
    '      fail-exit)   printf "%s" "$STUB_DUMP_BODY_GZ" | base64 -d | gunzip; exit 2 ;;',
    '      truncated)   printf "%s" "$STUB_DUMP_BODY_GZ" | base64 -d | gunzip | grep -v "^-- PostgreSQL database dump complete$" ;;',
    '      empty)       exit 0 ;;',
    '      garbage)     printf \'{"error":"backup endpoint exploded"}\\n\' ;;',
    '      *)           echo "stub: unknown mode $MODE" >&2; exit 9 ;;',
    '    esac ;;',
    '  *current_database*)',
    '    echo "${STUB_CURRENT_DB:-diagnostic_erp}" ;;',
    '  *"ps -a"*)',
    '    printf \'%s\\n\' ${STUB_PS_NAMES:-} ;;',
    '  *"rm -f"*)',
    '    exit 0 ;;',
    '  *"run --name"*)',
    '    exit "${STUB_RUN_FAIL:-0}" ;;',
    '  *pg_isready*|*"select 1"*)',
    '    if [ "${STUB_READY:-1}" = "1" ]; then echo 1; exit 0; fi',
    '    echo "no pgsql running" >&2; exit 2 ;;',
    '  *information_schema.tables*)',
    '    echo "${STUB_TABLE_COUNT:-439}" ;;',
    '  *"from patients"*)   rows_for patients ;;',
    '  *"from bills"*)      rows_for bills ;;',
    '  *"from payments"*)   rows_for payments ;;',
    '  *"from vouchers"*)   rows_for vouchers ;;',
    '  *"from patient_reports"*) rows_for patient_reports ;;',
    '  *"on_error_stop=1"*|*psql*)',
    '    # The restore itself: consume stdin (a real psql reads the dump; not',
    '    # reading it would SIGPIPE the gunzip pipe and change the verdict), then',
    '    # behave per mode. STUB_RESTORE_FAIL is a psql that stops on the first',
    '    # error. STUB_RESTORE_SILENT_FAIL is the subtle one and answers the way',
    '    # the real client does: every statement errors, but WITHOUT',
    '    # ON_ERROR_STOP psql still exits 0 — so this stub exits 0 unless the',
    '    # command it was handed actually carries the flag. That makes the flag',
    '    # load-bearing here rather than merely mentioned.',
    '    cat > /dev/null',
    '    if [ "${STUB_RESTORE_FAIL:-0}" = "1" ]; then echo \'psql:...: ERROR: syntax error\' >&2; exit 3; fi',
    '    if [ "${STUB_RESTORE_SILENT_FAIL:-0}" = "1" ]; then',
    '      echo \'psql: ERROR:  relation "patients" does not exist\' >&2',
    '      case "$LC" in *on_error_stop=1*) exit 3 ;; *) exit 0 ;; esac',
    '    fi',
    '    exit 0 ;;',
    '  *) exit 0 ;;',
    'esac',
    "",
  ].join("\n"), "utf8");

  // curl stub: honours `-o FILE` and `-w %{http_code}`, writes STUB_HTTP_BODY and
  // prints STUB_HTTP_CODE, so the pull script's real success test is exercised.
  writeFileSync(join(bin, "curl"), [
    "#!/usr/bin/env bash",
    `printf 'curl %s\\n' "$*" >> ${JSON.stringify(calls)}`,
    'OUT=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) OUT="$2"; shift 2 ;;',
    '    -w|--max-time|-H) shift 2 ;;',
    '    -s|-sS) shift ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    'if [ -n "$OUT" ]; then printf "%s" "${STUB_HTTP_BODY_GZ:-}" | base64 -d > "$OUT"; fi',
    'printf "%s" "${STUB_HTTP_CODE:-200}"',
    'exit "${STUB_CURL_EXIT:-0}"',
    "",
  ].join("\n"), "utf8");

  // openssl stub: real encryption is not what is under test, but *how the
  // passphrase is handed over* is, so this records argv exactly as received.
  const realOpenssl = "openssl";
  writeFileSync(join(bin, "openssl"), [
    "#!/usr/bin/env bash",
    `printf 'openssl %s\\n' "$*" >> ${JSON.stringify(calls)}`,
    // Emulate enc/dec well enough for the scripts' control flow: -in X -out Y.
    'IN=""; OUT=""; MODE="enc"',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -in) IN="$2"; shift 2 ;;',
    '    -out) OUT="$2"; shift 2 ;;',
    '    -d) MODE="dec"; shift ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    'if [ "${STUB_OPENSSL_FAIL:-0}" = "1" ]; then echo "encryption failed" >&2; exit 1; fi',
    'if [ -n "$OUT" ]; then cp "$IN" "$OUT"; fi',
    'exit 0',
    "",
  ].join("\n"), "utf8");

  // psql stub: synology-restore.sh runs psql on the HOST (the verifier runs it
  // inside a container through the docker stub above). It records argv, because
  // what this tests is that a connection string with a password in it never
  // reaches a command line.
  writeFileSync(join(bin, "psql"), [
    "#!/usr/bin/env bash",
    `printf 'psql %s\\n' "$*" >> ${JSON.stringify(calls)}`,
    'if [ "${STUB_PSQL_FAIL:-0}" = "1" ]; then echo \'psql: error: connection failed\' >&2; exit 1; fi',
    'echo "SELECT 1"',
    'exit 0',
    "",
  ].join("\n"), "utf8");

  for (const f of ["docker", "curl", "openssl", "psql"]) chmodSync(join(bin, f), 0o755);
  void realOpenssl;
  return { dir: work, bin, calls };
}

let work;
let stub;
let backupDir;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "i11b-"));
  backupDir = join(work, "backups");
  mkdirSync(backupDir, { recursive: true });
  stub = makeStubs(work);
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

function runScript(script, env = {}, args = []) {
  const bodyB64 = gzipSync(Buffer.from(completeDump())).toString("base64");
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    cwd: REPO,
    env: {
      ...process.env,
      PATH: `${stub.bin}${require_sep()}${process.env.PATH}`,
      BACKUP_DIR: backupDir,
      STUB_DUMP_BODY_GZ: bodyB64,
      STUB_HTTP_BODY_GZ: bodyB64,
      STUB_CURRENT_DB: "diagnostic_erp",
      ...env,
    },
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function require_sep() { return process.platform === "win32" ? ";" : ":"; }

// Resolved once, absolutely: V10 hands the child a PATH that deliberately lacks a tool,
// and Node resolves the program to spawn against the *child's* env — so `bash` itself would
// stop being findable and the test would fail for the wrong reason (empty output, ENOENT).
// On Windows the POSIX path bash reports (`/usr/bin/bash`) is not spawnable by Node, so it
// is converted to the native one; `cygpath` is asked through argv, never by interpolating a
// path that contains spaces into a shell string.
const BASH = (() => {
  const posix = (spawnSync("bash", ["-c", 'command -v bash'], { encoding: "utf8" }).stdout || "").trim();
  if (!posix) return "bash";
  if (process.platform === "win32") {
    const win = (spawnSync("bash", ["-c", 'cygpath -w "$0"', posix], { encoding: "utf8" }).stdout || "").trim();
    if (win) return win;
  }
  return posix;
})();

const artifacts = () =>
  readdirSync(backupDir).filter((f) => !f.endsWith(".log") && !f.startsWith(".")).sort();

const callsText = () => readFileSync(stub.calls, "utf8");

describe("synology-nas-backup.sh — the clinic's primary on-box dump", () => {
  test("N1 a good dump is published, with no partial file left behind", () => {
    const r = runScript(NAS_SCRIPT);
    expect(r.code, r.out).toBe(0);
    const files = artifacts();
    expect(files.filter((f) => f.endsWith(".sql.gz"))).toHaveLength(1);
    expect(files.filter((f) => f.includes("partial"))).toEqual([]);
  });

  test("N2 a pg_dump that exits non-zero produces no artifact at all", () => {
    const r = runScript(NAS_SCRIPT, { STUB_DOCKER_MODE: "fail-exit" });
    expect(r.code).not.toBe(0);
    expect(artifacts().filter((f) => f.endsWith(".sql.gz"))).toEqual([]);
    expect(artifacts().filter((f) => f.includes("partial"))).toEqual([]);
  });

  test("N3 a truncated dump is refused even though it gzips cleanly", () => {
    // The real incident shape: the pipe died mid-COPY, gzip still finished
    // happily, `gzip -t` passes, and the file is a backup of nothing.
    const r = runScript(NAS_SCRIPT, { STUB_DOCKER_MODE: "truncated" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/complete|truncat/i);
    expect(artifacts().filter((f) => f.endsWith(".sql.gz"))).toEqual([]);
  });

  test("N4 a dump that produced no SQL is refused", () => {
    const r = runScript(NAS_SCRIPT, { STUB_DOCKER_MODE: "empty" });
    expect(r.code).not.toBe(0);
    expect(artifacts().filter((f) => f.endsWith(".sql.gz"))).toEqual([]);
  });

  test("N5 a dump of the WRONG database is refused before it is published", () => {
    // `db_data` on the staging project is a real patient-shaped database; a
    // backup of it is indistinguishable by name and useless for this clinic.
    const r = runScript(NAS_SCRIPT, { STUB_CURRENT_DB: "db_data", DB_NAME: "diagnostic_erp" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/database|source/i);
    expect(artifacts().filter((f) => f.endsWith(".sql.gz"))).toEqual([]);
  });

  test("N6 garbage from the dump command is refused, not saved as a backup", () => {
    const r = runScript(NAS_SCRIPT, { STUB_DOCKER_MODE: "garbage" });
    expect(r.code).not.toBe(0);
    expect(artifacts().filter((f) => f.endsWith(".sql.gz"))).toEqual([]);
  });

  test("N7 the passphrase is never handed to a child process on the command line", () => {
    const r = runScript(NAS_SCRIPT, { BACKUP_PASSPHRASE: PASSPHRASE });
    expect(r.code, r.out).toBe(0);
    const calls = callsText();
    expect(calls).not.toContain(PASSPHRASE);
    expect(logText()).not.toContain(PASSPHRASE);
  });

  test("N8 retention can never remove the last known-good artifact", () => {
    // Three artifacts far past the window, then one run that fails: the purge
    // must not have taken the only good copies with it.
    const old = join(backupDir, "caredeoghar_20260101_030000.sql.gz");
    writeFileSync(old, gzipSync(Buffer.from(completeDump())));
    const r = runScript(NAS_SCRIPT, { RETENTION_DAYS: "1", STUB_DOCKER_MODE: "fail-exit" });
    expect(r.code).not.toBe(0);
    expect(existsSync(old)).toBe(true);
  });

  test("N9 retention prunes old copies after a good run but keeps a floor", () => {
    for (const name of ["caredeoghar_20260101_030000.sql.gz", "caredeoghar_20260102_030000.sql.gz", "caredeoghar_20260103_030000.sql.gz"]) {
      writeFileSync(join(backupDir, name), gzipSync(Buffer.from(completeDump())));
    }
    const r = runScript(NAS_SCRIPT, { RETENTION_DAYS: "1", KEEP_MIN_COPIES: "2" });
    expect(r.code, r.out).toBe(0);
    const left = artifacts().filter((f) => f.endsWith(".sql.gz"));
    expect(left.length).toBeGreaterThanOrEqual(2);
  });

  test("N10 an unusable destination fails honestly instead of reporting success", () => {
    // A plain file where the script wants a directory: mkdir must fail and the
    // script must not print "Backup complete" afterwards.
    const blocked = join(work, "blocked");
    writeFileSync(blocked, "not a directory");
    const r = runScript(NAS_SCRIPT, { BACKUP_DIR: blocked });
    expect(r.code).not.toBe(0);
    expect(r.out).not.toMatch(/Backup complete/);
  });
});

function logText() {
  const p = join(backupDir, "backup.log");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

describe("synology-backup.sh — the Replit pull, retired as the clinic's backup", () => {
  test("R1 HTTP 200 with a JSON error body is not a backup", () => {
    const body = Buffer.from('{"error":"internal backup endpoint failed"}').toString("base64");
    const r = runScript(PULL_SCRIPT, { STUB_HTTP_BODY_GZ: body, CAREDEOGHAR_API_KEY: API_KEY });
    expect(r.code, r.out).not.toBe(0);
    expect(artifacts()).toEqual([]);
  });

  test("R2 HTTP 200 with an empty body is not a backup", () => {
    const r = runScript(PULL_SCRIPT, { STUB_HTTP_BODY_GZ: Buffer.from("").toString("base64"), CAREDEOGHAR_API_KEY: API_KEY });
    expect(r.code, r.out).not.toBe(0);
    expect(artifacts()).toEqual([]);
  });

  test("R3 a non-200 leaves nothing behind", () => {
    const r = runScript(PULL_SCRIPT, { STUB_HTTP_CODE: "500", CAREDEOGHAR_API_KEY: API_KEY });
    expect(r.code).not.toBe(0);
    expect(artifacts()).toEqual([]);
  });

  test("R4 a genuine gzipped dump with a completion trailer is published", () => {
    const r = runScript(PULL_SCRIPT, { CAREDEOGHAR_API_KEY: API_KEY });
    expect(r.code, r.out).toBe(0);
    expect(artifacts().filter((f) => f.endsWith(".sql.gz"))).toHaveLength(1);
  });

  test("R5 the API key is never handed to curl on the command line", () => {
    const r = runScript(PULL_SCRIPT, { CAREDEOGHAR_API_KEY: API_KEY });
    expect(r.code, r.out).toBe(0);
    expect(callsText()).not.toContain(API_KEY);
  });

  test("R6 the script says what it backs up", () => {
    // Ownership, not decoration: this path pulls from a DIFFERENT database, and
    // four SOP documents still present it as the clinic's active daily backup.
    const head = readFileSync(PULL_SCRIPT, "utf8");
    expect(head).toMatch(/Replit|cloud instance/i);
    expect(head).not.toMatch(/the clinic.s (daily )?primary backup/i);
  });
});

describe("synology-restore.sh — the path an operator runs during an incident", () => {
  const DB_PASSWORD = "synthetic-db-password-never-a-real-one";
  const url = `postgresql://erp:${DB_PASSWORD}@127.0.0.1:5445/diagnostic_erp`;

  test("X1 a schema-complete artifact restores and says so", () => {
    const artifact = placeArtifact(join(work, "x1"), "caredeoghar_20261010_030000.sql.gz");
    const r = runScript(RESTORE_SCRIPT, {
      LOCAL_DB_URL: url,
    }, [artifact]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Restore complete/);
    expect(callsText()).toMatch(/psql .*ON_ERROR_STOP=1/);
  });

  test("X2 a psql that fails is not reported as a completed restore", () => {
    const artifact = placeArtifact(join(work, "x2"), "caredeoghar_20261010_030000.sql.gz");
    const r = runScript(RESTORE_SCRIPT, {
      LOCAL_DB_URL: url,
      STUB_PSQL_FAIL: "1",
    }, [artifact]);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/Restore complete/);
  });

  test("X3 no secret the restore needs is ever handed to a child on its command line", () => {
    // Both of them: the backup passphrase, and the password inside
    // LOCAL_DB_URL. A restore runs for minutes and `ps -ef` is readable by
    // everyone on the box — including whatever is collecting support logs.
    const artifact = placeArtifact(join(work, "x3"), "caredeoghar_20261010_030000.sql.gz.enc");
    const r = runScript(RESTORE_SCRIPT, {
      LOCAL_DB_URL: url,
      BACKUP_PASSPHRASE: PASSPHRASE,
    }, [artifact]);
    expect(r.code, r.out).toBe(0);
    const calls = callsText();
    expect(calls).not.toContain(PASSPHRASE);
    expect(calls).not.toContain(DB_PASSWORD);
    expect(r.out).not.toContain(DB_PASSWORD);
    expect(r.out).not.toContain(PASSPHRASE);
    // …and the credential-free form is what psql was actually pointed at.
    expect(calls).toMatch(/psql .*postgresql:\/\/erp@127\.0\.0\.1:5445\/diagnostic_erp/);
  });
});

describe("the scripts stay syntactically valid", () => {
  test.each([[NAS_SCRIPT], [PULL_SCRIPT], [RESTORE_SCRIPT], [VERIFY_SCRIPT], [VERIFY_SOP_SCRIPT]])("%s parses", (script) => {
    const r = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});

// ── I11-C — the restore verifier ─────────────────────────────────────────────
//
// `scripts/verify-backup-restore.sh` and `SOP/RECOVERY/13_RESTORE/verify-backup-restore.sh`
// were two different programs with the same name. The SOP copy — the one the
// recovery binder points an operator at during a disaster — was still the
// version that printed "🎉 BACKUP VERIFICATION SUCCESSFUL! Backup file integrity
// is 100% valid." after a restore that had loaded nothing: no ON_ERROR_STOP, an
// unconditional `gunzip -c`, no schema check, zero-row counts printed as a
// metric and then called valid, a permanently static sandbox password, and
// `-p 5499:5432` publishing that sandbox (full of real patient data) on every
// interface of the box.
//
// So these tests run BOTH paths and require the same verdict from both.
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** A DATA-ONLY export: TRUNCATE + INSERT, no CREATE TABLE — what the fallback
 *  exporter wrote in production for months while reporting success. */
const dataOnlyDump = () =>
  [
    "-- Care Diagnostics Database Export",
    "-- WARNING: DATA ONLY — does NOT contain CREATE TABLE/INDEX statements",
    "BEGIN;",
    'TRUNCATE TABLE "patients" CASCADE;',
    'INSERT INTO "patients" VALUES (1,\'Synthetic Patient\');',
    "COMMIT;",
    "",
  ].join("\n");

/** Drop a real gzipped pg_dump-shaped artifact into a fresh directory. */
function placeArtifact(dir, name = "caredeoghar_20261010_030000.sql.gz", bytes = gzipSync(Buffer.from(completeDump()))) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

/** The .meta sidecar as scripts/synology-nas-backup.sh writes it. */
function writeSidecar(artifactPath, fields) {
  writeFileSync(
    `${artifactPath}.meta`,
    Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    "utf8",
  );
}

function runVerifier(script, target, env = {}, { pathOnly = null } = {}) {
  // stdout/stderr go to FILES, not pipes. The verifier prints a heartbeat from a
  // background subshell (`sleep 30`), and a grandchild that inherits a Node pipe
  // would keep it open and stall the parent for that whole interval.
  const outPath = join(work, `verify-${Math.random().toString(36).slice(2)}.out`);
  const fd = openSync(outPath, "w+");
  const r = spawnSync(BASH, [script, ...(target ? [target] : [])], {
    cwd: REPO,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      PATH: pathOnly ?? `${stub.bin}${require_sep()}${process.env.PATH}`,
      STUB_READY: "1",
      VERIFY_READY_TIMEOUT: "2",
      ...env,
    },
    timeout: 120_000,
  });
  closeSync(fd);
  return { code: r.status, out: readFileSync(outPath, "utf8") };
}

describe("verify-backup-restore.sh — the restore proof", () => {
  test("V1 an artifact that genuinely restores is a PASS, with the counts shown", () => {
    const dir = join(work, "v1");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/PASS/);
    expect(r.out).toMatch(/patients/);
    // There is no such thing as a "100% valid" backup; that wording is exactly
    // what the SOP copy said over an empty restore.
    expect(r.out).not.toMatch(/100% valid/i);
  });

  test("V2 a restore that lands ZERO rows is not a success", () => {
    const dir = join(work, "v2");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, dir, {
      STUB_ROWS_PATIENTS: "0",
      STUB_ROWS_BILLS: "0",
    });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/PASS|SUCCESSFUL/i);
  });

  test("V3 a psql that aborts on the first error propagates a non-zero exit", () => {
    const dir = join(work, "v3");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, dir, { STUB_RESTORE_FAIL: "1" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/ON_ERROR_STOP/);
  });

  test("V3b a restore where every statement errors but psql exits 0 is still a FAIL", () => {
    // The production incident, end to end: psql without ON_ERROR_STOP returns
    // success after erroring on every single statement. The stub only behaves
    // that way when the flag is absent from what it was handed, so this test
    // goes red the moment the flag is removed from the script — it is not
    // checking that a string is present, it is checking that the string does
    // the job.
    const dir = join(work, "v3b");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, dir, { STUB_RESTORE_SILENT_FAIL: "1" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/does not restore cleanly|ON_ERROR_STOP/);
    expect(r.out).not.toMatch(/PASS/);
  });

  test("V4 a restore that produces no tables at all fails", () => {
    const dir = join(work, "v4");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, dir, { STUB_TABLE_COUNT: "0" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/PASS/);
  });

  test("V5 a DATA-ONLY artifact is refused before any database is started", () => {
    const dir = join(work, "v5");
    placeArtifact(dir, "caredeoghar_20261010_030000.sql.gz", gzipSync(Buffer.from(dataOnlyDump())));
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/DATA ONLY/i);
    expect(callsText()).not.toMatch(/run --name/);
  });

  test("V6 a corrupt gzip is refused, not reported as unverifiable-but-probably-fine", () => {
    const dir = join(work, "v6");
    const good = gzipSync(Buffer.from(completeDump()));
    placeArtifact(dir, "caredeoghar_20261010_030000.sql.gz", good.subarray(0, good.length - 64));
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/PASS/);
  });

  test("V7 a zero-byte artifact is refused", () => {
    const dir = join(work, "v7");
    placeArtifact(dir, "caredeoghar_20261010_030000.sql.gz", Buffer.alloc(0));
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/empty/i);
  });

  test("V8 a directory that holds no backup fails honestly", () => {
    const dir = join(work, "v8");
    mkdirSync(dir, { recursive: true });
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/PASS|SUCCESSFUL/i);
  });

  test("V9 a target that does not exist is refused", () => {
    const r = runVerifier(VERIFY_SCRIPT, join(work, "definitely-not-here"));
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/No such file or directory/);
  });

  test("V10 a missing dependency is named, not mistaken for a bad backup", () => {
    const dir = join(work, "v10");
    placeArtifact(dir);
    // The absence is built here rather than hoped for. This test used to run with the
    // machine's real PATH and expect `docker` not to be on it — true on a Windows station,
    // false on a CI runner that ships Docker. There the verifier walked past the preflight,
    // restored the synthetic two-table dump, and failed with "Core table 'payments' is
    // missing", so the assertion was measuring the runner, not the dependency check.
    // The PATH the script now sees contains the seven tools it preflights, plus the `date`
    // it evaluates before reaching that loop, and `docker` is deliberately not in it.
    const bin = join(work, "v10-bin");
    mkdirSync(bin, { recursive: true });
    // `#!/bin/sh`, not `#!/usr/bin/env bash`: the shebang is an absolute path the kernel can
    // honour, while `env` would have to search the very PATH this test restricts — and the
    // script evaluates `$(date +%s)` two lines before the preflight, so the `date` stub does
    // get executed, not merely found.
    for (const tool of ["openssl", "gzip", "gunzip", "grep", "find", "mktemp", "stat", "date"]) {
      writeFileSync(join(bin, tool), "#!/bin/sh\nexit 0\n");
      chmodSync(join(bin, tool), 0o755);
    }
    const r = runVerifier(VERIFY_SCRIPT, dir, {}, { pathOnly: bin });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out, r.out).toMatch(/'docker' is not installed or not on PATH/);
    // The message must also say which side of the failure the operator is on, or a missing
    // tool reads as "there are no backups" — the confusion this script exists to prevent.
    expect(r.out, r.out).toMatch(/not a problem with the\s+backup/);
    expect(r.out).not.toMatch(/No backup artifact found/);
  });

  test("V11 the passphrase is never handed to openssl on the command line", () => {
    // The scheduler's and the NAS script's whole point in encrypting is that the
    // artifact on the NAS is unreadable. `-pass "pass:$SECRET"` puts the key in
    // `ps -ef` for the length of the restore, which is minutes on this box.
    const dir = join(work, "v11");
    placeArtifact(dir, "caredeoghar_20261010_030000.sql.gz.enc", gzipSync(Buffer.from(completeDump())));
    const r = runVerifier(VERIFY_SCRIPT, dir, { BACKUP_PASSPHRASE: PASSPHRASE });
    expect(r.code, r.out).toBe(0);
    expect(callsText()).not.toContain(PASSPHRASE);
    expect(r.out).not.toContain(PASSPHRASE);
  });

  test("V12 the sidecar's recorded source database is asserted", () => {
    const dir = join(work, "v12");
    const a = placeArtifact(dir);
    writeSidecar(a, {
      artifact: "caredeoghar_20261010_030000.sql.gz",
      source_database: "db_data",
      exporter: "pg_dump",
      schema_complete: "true",
      sha256_artifact: sha256(readFileSync(a)),
    });
    const r = runVerifier(VERIFY_SCRIPT, dir, { EXPECTED_DB: "diagnostic_erp" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/db_data/);
    expect(r.out).not.toMatch(/PASS/);
  });

  test("V13 an artifact whose bytes are not what the backup job recorded is refused", () => {
    const dir = join(work, "v13");
    const a = placeArtifact(dir);
    writeSidecar(a, {
      artifact: "caredeoghar_20261010_030000.sql.gz",
      source_database: "diagnostic_erp",
      exporter: "pg_dump",
      schema_complete: "true",
      sha256_artifact: sha256(Buffer.from("some other artifact")),
    });
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/sha256|checksum/i);
    expect(r.out).not.toMatch(/PASS/);
  });

  test("V14 a matching sidecar is reported, so the operator knows which database restored", () => {
    const dir = join(work, "v14");
    const a = placeArtifact(dir);
    writeSidecar(a, {
      artifact: "caredeoghar_20261010_030000.sql.gz",
      created_utc: "2026-10-10T03:00:00Z",
      source_container: "care-db",
      source_database: "diagnostic_erp",
      server_version: "PostgreSQL 16.14",
      exporter: "pg_dump",
      schema_complete: "true",
      create_tables: "439",
      bytes: String(readFileSync(a).length),
      encrypted: "no",
      sha256_artifact: sha256(readFileSync(a)),
    });
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/diagnostic_erp/);
    expect(r.out).toMatch(/exporter=pg_dump/);
  });

  test("V15 BACKUP_DIR is where it looks when no path is given", () => {
    // synology-nas-backup.sh writes to $BACKUP_DIR. A verifier whose default is
    // a hard-coded older path reports "no backup found" on a healthy box, and an
    // operator under pressure reads that as "there are no backups".
    const dir = join(work, "v15");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, null, { BACKUP_DIR: dir });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/PASS/);
  });

  test("V16 the sandbox that holds real patient data is never published on the network", () => {
    const dir = join(work, "v16");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SCRIPT, dir);
    expect(r.code, r.out).toBe(0);
    const runLine = callsText().split("\n").find((l) => l.includes("run --name")) || "";
    expect(runLine).not.toMatch(/-p\s|5499/);
  });

  test("V17 a sandbox that never becomes queryable fails, and does not hang", () => {
    const dir = join(work, "v17");
    placeArtifact(dir);
    const started = Date.now();
    const r = runVerifier(VERIFY_SCRIPT, dir, { STUB_READY: "0", VERIFY_READY_TIMEOUT: "2" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/never became queryable|did not start/i);
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});

describe("every script in the recovery binder is the real one (I11-C divergence)", () => {
  // The SOP/RECOVERY binder is what an operator reads when the application is
  // down, so it carries copies of the backup and restore scripts rather than
  // links. That only works while the copies ARE the same program — and this scan
  // exists because it wasn't: SOP/RECOVERY/12_BACKUPS/synology-backup.sh was the
  // pre-hardening version that called an HTTP 200 a backup, and
  // SOP/RECOVERY/13_RESTORE/verify-backup-restore.sh was the version that
  // declared a zero-row restore "100% valid".
  //
  // The guard walks the folders instead of hand-listing pairs, so the next copy
  // an operator adds is covered the day it appears.
  const BINDER_FOLDERS = ["12_BACKUPS", "13_RESTORE"];

  const copies = BINDER_FOLDERS.flatMap((folder) => {
    const dir = join(REPO, "SOP", "RECOVERY", folder);
    return existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".sh")).map((f) => join(dir, f))
      : [];
  });

  test("the binder holds at least the three scripts it claims to", () => {
    expect(copies.length).toBeGreaterThanOrEqual(3);
  });

  test.each(copies.map((p) => [p]))("%s is byte-identical to its scripts/ twin", (copy) => {
    const twin = join(REPO, "scripts", basename(copy));
    expect(existsSync(twin), `${basename(copy)} has no scripts/ twin to mirror`).toBe(true);
    expect(readFileSync(copy, "utf8"), `${basename(copy)} has drifted from scripts/`).toBe(
      readFileSync(twin, "utf8"),
    );
  });
});

describe("the SOP twin is the same program (I11-C divergence)", () => {
  // Byte equality of the pair is asserted by the binder scan above; what is
  // pinned here is that the copy in the binder BEHAVES — it is run, not read.
  test("C2 the SOP copy also refuses a restore that landed zero rows", () => {
    // This is the defect itself, run rather than argued: the SOP version printed
    // "BACKUP VERIFICATION SUCCESSFUL! … 100% valid" and exited 0 here.
    const dir = join(work, "c2");
    placeArtifact(dir);
    const r = runVerifier(VERIFY_SOP_SCRIPT, dir, { STUB_ROWS_PATIENTS: "0", STUB_ROWS_BILLS: "0" });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/100% valid|SUCCESSFUL/i);
  });

  test("C3 the SOP copy no longer carries the false-success shape", () => {
    // Comments are stripped first: both copies explain the old defect by quoting
    // the exact string that used to print it, and an assertion over raw text
    // would fail on the fix.
    const code = readFileSync(VERIFY_SOP_SCRIPT, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/100% valid/i);
    expect(code).toMatch(/ON_ERROR_STOP=1/);
    expect(code).toMatch(/DATA ONLY/i);
    // Both artifact families end in .enc; only one is compressed. An
    // unconditional `gunzip -c` pipe dies on the scheduler's own backups.
    expect(code).not.toMatch(/\|\s*gunzip -c\s*\|/);
    expect(code).not.toMatch(/SANDBOX_PORT/);
  });
});
