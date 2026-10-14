// ============================================================================
// PR-I11B — the Synology backup scripts, run for real against injected faults.
//
// These are the two paths that decide whether the clinic can recover patient
// data, and until now nothing executed them: the only tests around backups
// asserted on their *text*. A shell script's text can be perfect while its exit
// status, its published file and its log say something else, so this harness
// really runs `bash scripts/synology-nas-backup.sh` and
// `bash scripts/synology-backup.sh` and then inspects what landed on disk, what
// the process returned, and what its children were handed on the command line.
//
// `docker` and `curl` are stubbed by executables placed first on PATH — the
// product under test is the script's own decisions (what it verifies, what it
// publishes, what it purges, what it leaks into argv), not PostgreSQL or a
// remote HTTP server. Dump bytes are real gzip'd SQL composed here, so the
// checks the script performs are performed on genuine artifacts.
//
// Nothing here touches a real database, a real NAS or a real patient row.
// ============================================================================
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync, chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const NAS_SCRIPT = join(REPO, "scripts", "synology-nas-backup.sh");
const PULL_SCRIPT = join(REPO, "scripts", "synology-backup.sh");

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
  writeFileSync(join(bin, "docker"), [
    "#!/usr/bin/env bash",
    `printf 'docker %s\\n' "$*" >> ${JSON.stringify(calls)}`,
    'MODE="${STUB_DOCKER_MODE:-ok}"',
    'case "$*" in',
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

  for (const f of ["docker", "curl", "openssl"]) chmodSync(join(bin, f), 0o755);
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

function runScript(script, env = {}) {
  const bodyB64 = gzipSync(Buffer.from(completeDump())).toString("base64");
  const r = spawnSync("bash", [script], {
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

describe("the scripts stay syntactically valid", () => {
  test.each([[NAS_SCRIPT], [PULL_SCRIPT]])("%s parses", (script) => {
    const r = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});
