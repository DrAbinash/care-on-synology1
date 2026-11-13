// ============================================================================
// Task 6 — `deploy.sh` executed for real, in isolation, with a mutation battery.
//
// This is the routine deployment path for a live clinic, and until now the only
// assertions around it read its *text*. A shell script can read perfectly and
// still `docker compose down` the database, or print "SCHEMA VERIFICATION
// FAILED" and exit 0. So every scenario here runs the actual `bash deploy.sh`
// against stub executables for `git`, `docker` and `curl` (committed next door in
// `scripts/deployScriptStubs/`), which log every argv they are handed and answer
// from a canned state directory. Each scenario then asserts on the SEQUENCE the
// script chose — which gate fired, in what order, and what was therefore never
// run. Nothing here touches Docker, Git, the NAS or a patient row.
//
// A green scenario only proves the script satisfies the words written here. So
// this file also runs a mutation battery: each mutant is one deliberate break to
// one named protection, applied byte-for-byte to an in-memory copy of the script
// (the original is never written to), and must be CAUGHT by at least one named
// scenario. A survivor means that protection's assertion is decorative.
//
// Two properties the harness owns outright:
//   * The script's lock is a machine-global path (`/tmp/care-deploy.lock`), and
//     scenario F4 deliberately leaves it behind to prove the gate works. Bash,
//     not Node, clears it before each scenario, because on Windows MSYS `/tmp`
//     is not `os.tmpdir()` and the two would be clearing different directories.
//     Run this file serially (`--no-file-parallelism`, which is what CI does);
//     two concurrent copies would decide each other's F4.
//   * Every scenario asserts `docker compose version` appears in the call log.
//     Without that, a PATH that silently fell through to the real binaries would
//     keep most assertions green while testing nothing at all — which is exactly
//     why `deploy.sh` appends its PATH instead of prepending it.
//
// Measured (2026-11-13, this box, `--no-file-parallelism`, committed run): 273 s for
// the whole file — 43 scenarios at 0.47–4.1 s each, and the 42-mutant battery in
// 191 s. Run it with:
//   pnpm vitest run scripts/deployScript.test.mjs --no-file-parallelism
// On Windows that command dies inside pnpm's own dependency check (EPERM while
// renaming esbuild) without running a single test, so measure with the binary:
//   node node_modules/vitest/vitest.mjs run scripts/deployScript.test.mjs --no-file-parallelism
// Two runs of this file must not overlap: the script's lock path is machine-global.
// ============================================================================
import { execFileSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const DEPLOY = join(REPO, "deploy.sh");
const STUB_SRC = join(HERE, "deployScriptStubs");
const STUB_NAMES = ["git", "docker", "curl"];
const SEP = process.platform === "win32" ? ";" : ":";

// A scenario is 0.5–4.1 s and the whole file 218 s measured here on 2026-11-13
// (134–168 s before the readiness gate existed; the difference is one deliberate
// 60 s kill window on the deadline mutant, which cannot terminate any other way).
// Both caps sit far above that so a loaded CI box cannot turn a green script into a
// timeout.
const SCENARIO_TIMEOUT_MS = 90_000;
const BATTERY_TIMEOUT_MS = 600_000;
// Every wait inside deploy.sh is pinned to ~zero below, and this ceiling is what
// makes that pin enforceable rather than a convention. execFileSync is synchronous,
// so a wait someone forgets to pin does not fail its test — it blocks the worker
// thread, the per-test timeout cannot fire, the CI log goes silent, and only the
// 22-minute step cap notices. That is precisely how this file cost a deploy: the
// readiness gate was added with a 300 s window and this harness knew only the
// older knob, so 31 scenarios finished and the 32nd never did. Killing the child
// turns that outage into a named, one-line failure.
const SCENARIO_KILL_MS = 60_000;

const PRE_SHA = "1111111111111111111111111111111111111111";
const POST_SHA = "2222222222222222222222222222222222222222";

// The live .env's shape, with synthetic values only: HOST_PORT is what the
// health probes read, GIT_COMMIT is the build argument deploy.sh stamps, and the
// password/secret lines stand in for the clinic's real ones. They are here for
// exactly one reason — to be proved byte-for-byte unchanged by the stamp.
const DEFAULT_DOTENV = [
  "HOST_PORT=8888",
  "TZ=Asia/Kolkata",
  "DB_USER=clinic",
  "DB_PASSWORD=synthetic-not-a-real-secret",
  "JWT_SECRET=synthetic-not-a-real-secret",
  `GIT_COMMIT=${PRE_SHA}`,
  "GIT_BRANCH=main",
  "BUILD_DATE=2026-01-01T00:00:00Z",
  "",
].join("\n");

let ROOT;
let BIN;

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), "care-deploy-harness-"));
  BIN = join(ROOT, "bin");
  mkdirSync(BIN, { recursive: true });
  // The stubs are bash, so they must be LF on disk even if this checkout is
  // Windows-CRLF; `readFileSync` + normalize is why they can be committed as
  // plain data files instead of embedded in JS template literals.
  for (const name of STUB_NAMES) {
    const src = join(STUB_SRC, name);
    const body = readFileSync(src, "utf8").replace(/\r\n/g, "\n");
    const file = join(BIN, name);
    writeFileSync(file, body);
    // chmod is a no-op on Windows; the stubs are invoked as `bash <path>` by
    // deploy.sh's own callers only through PATH, so on Linux this bit matters.
    chmodSync(file, 0o755);
  }
});

afterAll(() => {
  if (ROOT) rmSync(ROOT, { recursive: true, force: true });
  execFileSync("bash", ["-c", "rm -rf /tmp/care-deploy.lock"]);
});

/** The exact shape `care-db-patch-v2 --check` prints (CHECK_ lines in docker/db-patch-entrypoint.sh). */
function checkOut({ pending = 0, changed = 0, applied = 246, ledger = "present",
  schema = "no", destructive = "no", names = [] }) {
  return [
    "CHECK_DATABASE diagnostic_erp@db:5432",
    "CHECK_TARGET diagnostic_erp",
    "CHECK_IDENTITY care-erp (production) — matches",
    `CHECK_LEDGER ${ledger}`,
    `CHECK_VERDICT current=${applied} applied-unledgered=0 pending=${pending} changed=${changed}`,
    ...names.map((n) => `CHECK_PENDING ${n}`),
    `CHECK_SCHEMA_CHANGING ${schema}`,
    `CHECK_DESTRUCTIVE ${destructive}`,
    ...(destructive === "yes"
      ? ["CHECK_DESTRUCTIVE_EVIDENCE 0012_x.sql:14 DROP TABLE public.old_reports",
         "CHECK_DESTRUCTIVE_EVIDENCE 0012_x.sql:15 DELETE FROM patient_reports"]
      : []),
  ].join("\n") + "\n";
}

// Fragments of what the script actually passes to the docker stub, as logged
// verbatim (`docker compose -p care-erp-github run …`).
const MIG = "run --rm --no-deps db-patch-v2";
const VERIFY = "run --rm --no-deps schema-verify";
const UP = "up -d --no-deps api web";
const BUILD = "build api web schema-verify";
const CHECK = "run --rm -T --no-deps db-patch-v2 --check";
const PIN = "tag care-erp-github-api:latest care-erp-github-api:rollback-";

/**
 * Run one scenario against `script` and return what happened. `state` files seed
 * the stubs' world, `args` are the script's argv, `env` extra environment,
 * `lock` pre-holds the deploy lock, and `expect` describes what must and must
 * not have happened.
 */
function evaluate(script, name, opts, subdir) {
  const { state = {}, args = [], env = {}, expect = {} } = opts;
  const dir = join(ROOT, subdir || "", name);
  rmSync(dir, { recursive: true, force: true });
  const checkout = join(dir, "checkout");
  const logs = join(dir, "logs");
  const st = join(dir, "state");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(logs, { recursive: true });
  mkdirSync(st, { recursive: true });
  // `.env` is the clinic's secrets plus a handful of plain settings. Scenarios
  // that care about its content pass `dotenv`; the default is the shape the box
  // actually has (port first, the identity keys at the end).
  const seededEnv = opts.dotenv === undefined ? DEFAULT_DOTENV : opts.dotenv;
  const envPath = join(checkout, ".env");
  writeFileSync(envPath, seededEnv);

  const files = {
    head: PRE_SHA,
    "head-after": POST_SHA,
    subject: "feat: something the clinic asked for",
    "post-sh": POST_SHA.slice(0, 12),
    "check.rc": "0",
    "check.out": checkOut({}),
    ...state,
  };
  for (const [k, v] of Object.entries(files)) writeFileSync(join(st, k), v);

  const calls = join(dir, "calls.log");
  writeFileSync(calls, "");
  // `selfCopy` puts a writable COPY of the script in this scenario's own sandbox
  // and lets the git stub's `merge` rewrite it, which is the only way to
  // simulate the fast-forward replacing deploy.sh under a running bash. The
  // repository's own file is never written by anything in this harness.
  let scriptPath = script;
  const scenarioEnv = { ...env };
  if (opts.selfCopy) {
    scriptPath = join(dir, "deploy.sh");
    writeFileSync(scriptPath, readFileSync(script, "utf8"));
    chmodSync(scriptPath, 0o755);
    scenarioEnv.STUB_SELF_MODIFY = scriptPath;
    if (opts.selfModifyLimit !== undefined) scenarioEnv.STUB_SELF_MODIFY_LIMIT = String(opts.selfModifyLimit);
  }
  // A stale lock from a killed run must not decide the next scenario. Bash owns
  // that path, so bash creates and removes it — MSYS /tmp is not Node's /tmp.
  execFileSync("bash", ["-c", "rm -rf /tmp/care-deploy.lock"]);
  if (opts.lock) execFileSync("bash", ["-c", "mkdir -p /tmp/care-deploy.lock"]);

  const out = (() => {
    try {
      return { rc: 0, text: execFileSync("bash", [scriptPath, ...args], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        timeout: SCENARIO_KILL_MS,
        env: { ...process.env, PATH: `${BIN}${SEP}${BIN}${SEP}${process.env.PATH}`,
          DEPLOY_DIR: checkout, LOG_DIR: logs, STATE: st, CALLS: calls,
          DEPLOY_HEALTH_TIMEOUT_SECONDS: "0",
          DEPLOY_READINESS_TIMEOUT_SECONDS: "2", DEPLOY_READINESS_POLL_SECONDS: "1",
          ...scenarioEnv },
      }) };
    } catch (e) {
      // A child killed by `timeout` has no exit status at all — that is the signal
      // this harness ran out of patience, not that deploy.sh refused.
      return { rc: e.status ?? -1, killed: e.status === null || e.status === undefined,
        text: `${e.stdout || ""}${e.stderr || ""}` };
    }
  })();
  const text = out.text.replace(/\u001b\[[0-9;]*m/g, "");
  const callLog = readFileSync(calls, "utf8");
  const envAfter = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;

  const problems = [];
  const has = (hay, needle) => hay.includes(needle);
  if (out.killed) problems.push(`still running after ${SCENARIO_KILL_MS / 1000}s — a wait inside deploy.sh that this harness does not pin`);
  if (expect.rc !== undefined && out.rc !== expect.rc) problems.push(`exit ${out.rc}, expected ${expect.rc}`);
  for (const s of expect.out || []) if (!has(text, s)) problems.push(`output missing: ${JSON.stringify(s)}`);
  for (const s of expect.notOut || []) if (has(text, s)) problems.push(`output must not contain: ${JSON.stringify(s)}`);
  for (const s of expect.calls || []) if (!has(callLog, s)) problems.push(`never ran: ${JSON.stringify(s)}`);
  for (const s of expect.notCalls || []) if (has(callLog, s)) problems.push(`ran, but must not have: ${JSON.stringify(s)}`);
  // HOW MANY times, not merely whether. A re-executed deploy logs its steps twice,
  // and "the merge leg ran twice" is the whole claim — a bare `calls:` assertion
  // would stay green with one run and with four.
  for (const [s, n] of Object.entries(expect.callCounts || {})) {
    const got = callLog.split(s).length - 1;
    if (got !== n) problems.push(`call ${JSON.stringify(s)} ran ${got}×, expected ${n}×`);
  }
  for (const [s, n] of Object.entries(expect.outCounts || {})) {
    const got = text.split(s).length - 1;
    if (got !== n) problems.push(`output ${JSON.stringify(s)} appeared ${got}×, expected ${n}×`);
  }
  // What `.env` looks like when the deploy is done. Asserting the WHOLE file is
  // the point: an exact match proves the secrets came through byte-for-byte,
  // which "the GIT_COMMIT line is right" on its own cannot.
  if (expect.dotenv !== undefined) {
    if (envAfter !== expect.dotenv) {
      problems.push(`.env is not the expected file\n        got: ${JSON.stringify(envAfter)}\n   expected: ${JSON.stringify(expect.dotenv)}`);
    }
  }
  if (expect.dotenvUnchanged && envAfter !== seededEnv) {
    problems.push(`.env was rewritten when this scenario says it must not be\n        before: ${JSON.stringify(seededEnv)}\n         after: ${JSON.stringify(envAfter)}`);
  }
  for (const s of expect.envHas || []) if (!has(envAfter ?? "", s)) problems.push(`.env missing: ${JSON.stringify(s)}`);
  // The stamp writes a scratch file beside .env and renames it over the top. A
  // leftover is an untracked file in the checkout, and the NEXT deploy's own
  // dirty-tree gate would stop on it — the same trap that broke the last one.
  const scratch = readdirSync(checkout).filter((f) => f.startsWith(".env.stamp-"));
  if (scratch.length) problems.push(`left a scratch .env behind: ${scratch.join(", ")}`);
  // Gate ORDER is the actual product: a check that happens after the build, or a
  // pin after the recreate, is a different (worse) script.
  if (expect.order) {
    let at = -1;
    for (const s of expect.order) {
      const i = callLog.indexOf(s, at + 1);
      if (i === -1) { problems.push(`order broken: no ${JSON.stringify(s)} after the previous step`); break; }
      at = i;
    }
  }
  // The invariant every scenario shares: this script may not touch the database
  // service, may not take the stack down, and may not move Git history.
  for (const s of ["compose up -d --no-deps api web db", " down ", "reset --hard", "-v "]) {
    if (callLog.includes(s)) problems.push(`forbidden call fragment: ${JSON.stringify(s)}`);
  }
  // Proof that the scenario ran against the STUBS and not the real binaries: if
  // PATH resolution ever silently fell through, a probe against 127.0.0.1:8888
  // fails for the same reason the stub makes it fail, and the assertions would
  // stay green while testing nothing. Every run reaches `docker compose version`.
  if (!callLog.includes("docker compose version")) problems.push("stub docker never called (PATH fell through to the real binary?)");
  // A run that reports success must have probed over HTTP. (A run that died in
  // the container-health wait legitimately never got there.)
  if (out.rc === 0 && callLog.includes(UP) && !callLog.includes("curl ")) problems.push("claimed a completed deploy without ever calling curl");
  if (!readdirSync(logs).some((f) => f.startsWith("deploy-"))) problems.push("no deploy log written");

  return { name, rc: out.rc, problems, text, callLog };
}

/** Fail with the assertions that broke AND the evidence a reader needs to see why. */
function assertClean(r) {
  if (r.problems.length === 0) return;
  const tail = r.text.split("\n").slice(-30).map((l) => `    | ${l}`).join("\n");
  const calls = r.callLog.split("\n").filter(Boolean).slice(-40).map((l) => `    > ${l}`).join("\n");
  throw new Error(`${r.name}\n${r.problems.map((p) => `  ✗ ${p}`).join("\n")}\n  output tail:\n${tail}\n  calls:\n${calls}`);
}

const SCENARIOS = [
  ["A1-code-only-nothing-pending", {
    expect: { rc: 0,
      out: ["Nothing pending — the migration container will not be run",
            "Migrations skipped", "DEPLOYMENT COMPLETE",
            "Verified: the running code is the commit this script deployed",
            "care-db untouched"],
      notOut: ["✗ DEPLOYMENT STOPPED"],
      calls: [CHECK, BUILD, VERIFY, UP],
      // Skipping the migration is the point; skipping the verification is not.
      notCalls: [MIG] },
  }],

  ["A2-with-a-pending-migration", {
    state: { "check.out": checkOut({ pending: 2, applied: 245,
      names: ["drizzle|0012_ab.sql", "feature|0003_mri_protocols.sql"] }) },
    expect: { rc: 0,
      out: ["2 migration(s) would be applied", "drizzle|0012_ab.sql", "Migrations applied"],
      calls: [CHECK, MIG, VERIFY, UP],
      // check → pin → build → migrate → verify → cutover. Every one of those has
      // to precede the recreate, because the recreate is the downtime.
      order: [CHECK, PIN, BUILD, MIG, VERIFY, UP] },
  }],

  ["B1-applied-file-changed-12", {
    state: { "check.out": checkOut({ pending: 0, changed: 1, applied: 245 }), "check.rc": "12" },
    expect: { rc: 1,
      out: ["no longer matches what this database ran", "Revert the edit"],
      notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["B2-no-migration-files-13", {
    state: { "check.out": "", "check.rc": "13" },
    expect: { rc: 1, out: ["No migration files were found at all", "broken bind mount"],
      notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["B3-check-could-not-complete", {
    state: { "check.out": "psql: error: connection to server failed", "check.rc": "1" },
    expect: { rc: 1, out: ["The migration pre-flight could not complete (exit 1)",
                           "An unchecked database is never a green light"],
      notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["B4-check-says-nothing-at-all", {
    state: { "check.out": "some unrelated output\n", "check.rc": "0" },
    // No CHECK_VERDICT means the script has no fact to gate on. It must stop,
    // not read silence as "up to date" and deploy over an unchecked database.
    expect: { rc: 1, out: ["printed no verdict", "CHECK_VERDICT"],
      notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["C1-schema-changing-stale-backup", {
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes" }), "backup-age": "40.5",
      "backup-when": "2026-11-09 20:30" },
    expect: { rc: 1, out: ["older than 26h", "does not cover today's patients"],
      notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["C2-schema-changing-fresh-backup", {
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes" }), "backup-age": "5.0",
      "backup-when": "2026-11-10 20:32" },
    expect: { rc: 0, out: ["covered by a verified backup"], calls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["C3-schema-changing-no-backup-at-all", {
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes" }), "backup-age": "" },
    expect: { rc: 1, out: ["no VERIFIED database backup could be read"], notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["C4-fresh-install-needs-no-backup", {
    state: { "check.out": checkOut({ pending: 1, applied: 0, ledger: "absent", schema: "yes" })
      .replace("pending=1", "pending=all"), "backup-age": "" },
    expect: { rc: 0, out: ["treated as a fresh install"], calls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["D1-destructive-needs-approval", {
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes", destructive: "yes" }),
      "backup-age": "0.2", "backup-when": "2026-11-10 20:32" },
    expect: { rc: 1,
      out: ["needs the operator's approval in words", "--approve-destructive",
            "DROP TABLE public.old_reports"],
      notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["D2-destructive-approved", {
    args: ["--approve-destructive", "removes the table the audit named"],
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes", destructive: "yes" }),
      "backup-age": "0.2", "backup-when": "2026-11-10 20:32" },
    expect: { rc: 0, out: ["DESTRUCTIVE MIGRATION APPROVED"], calls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["D3-destructive-without-a-fresh-backup", {
    args: ["--approve-destructive", "approved but the backup is hours old"],
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes", destructive: "yes" }),
      "backup-age": "5", "backup-when": "2026-11-10 15:00" },
    expect: { rc: 1, out: ["limit: 60 minutes"], notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["E1-rehearse-builds-and-restarts-nothing", {
    args: ["--check"],
    state: { "check.out": checkOut({ pending: 2, applied: 245 }) },
    expect: { rc: 0,
      out: ["REHEARSAL COMPLETE", "migrate : 2 file(s)", "restart : care-api and care-web only"],
      notCalls: [BUILD, MIG, VERIFY, UP, "tag care-erp-github-api:latest"],
      notOut: ["DEPLOYMENT COMPLETE"] },
  }],

  ["E2-rehearse-reports-an-old-backup-it-would-stop-on", {
    args: ["--check"],
    state: { "check.out": checkOut({ pending: 1, applied: 246, schema: "yes" }), "backup-age": "40.5" },
    expect: { rc: 1, out: ["older than 26h"], notCalls: [BUILD, MIG, VERIFY, UP] },
  }],

  ["F1-dirty-tree-stops-before-fetch", {
    state: { dirty: " M artifacts/api-server/src/app.ts\n" },
    expect: { rc: 1, out: ["holds changes that are not this script's own output",
                           "Do not reach for 'git clean -fd'"],
      notCalls: ["git fetch", CHECK, BUILD, UP] },
  }],

  ["F2-generated-schema-report-is-exempt", {
    state: { dirty: " M STARTUP_SCHEMA_VERIFICATION.md\n" },
    expect: { rc: 0, calls: ["git fetch", CHECK, UP] },
  }],

  ["F3-cannot-fast-forward", {
    state: { "merge.rc": "1" },
    expect: { rc: 1, out: ["Cannot fast-forward to origin/main", "Nothing was built or restarted"],
      notCalls: [CHECK, BUILD, MIG, VERIFY, UP] },
  }],

  ["F4-another-deploy-holds-the-lock", {
    state: {},
    lock: true,
    expect: { rc: 1, out: ["Another deploy is already running", "rmdir /tmp/care-deploy.lock"],
      notCalls: ["git fetch", CHECK, BUILD, UP] },
  }],

  ["F5-a-migration-container-is-running", {
    state: { "ps.out": "abc123def456\n" },
    expect: { rc: 1, out: ["A migration container is running right now"], notCalls: [CHECK, BUILD, UP] },
  }],

  ["G1-build-fails", {
    state: { "build.rc": "1", "check.out": checkOut({ pending: 1, applied: 246 }) },
    expect: { rc: 1, out: ["The build failed, so NOTHING was deployed", "still serving"],
      notCalls: [MIG, VERIFY, UP] },
  }],

  ["G2-migration-fails", {
    state: { "migrate.rc": "1", "check.out": checkOut({ pending: 1, applied: 246 }),
      "migrate.out": "✗ FAILED 0013_x.sql — column already exists" },
    expect: { rc: 1,
      out: ["The migration failed. No container was restarted", "Never reverse an applied migration",
            "Do NOT 'git reset --hard'"],
      // Mentioning reset --hard to forbid it is fine; telling the operator to run
      // it (the old script's advice) is the defect this replaces.
      notOut: ["Roll the code back", "reset --hard $", "reset --hard 1111"],
      notCalls: [VERIFY, UP] },
  }],

  ["G3-schema-verify-fails", {
    state: { "verify.rc": "1", "verify.out": "✗ SCHEMA VERIFICATION FAILED — 2 columns missing" },
    expect: { rc: 1, out: ["Schema verification reported drift", "clinic is untouched"],
      notCalls: [UP] },
  }],

  ["H1-api-never-becomes-healthy", {
    state: { health: "starting no-healthcheck\nrunning healthy\n" },
    expect: { rc: 1, out: ["did not become healthy within 0s", "To go back to the previous images",
                           "docker tag care-erp-github-api:rollback-"],
      calls: [UP] },
  }],

  ["H2-web-never-becomes-healthy", {
    state: { health: "running healthy\nexited exited\n" },
    expect: { rc: 1, out: ["did not become healthy", "docker logs --tail 60 care-web"] },
  }],

  ["H3-nginx-not-serving", {
    env: { STUB_NO_NGINX: "1" },
    expect: { rc: 1, out: ["did not answer, so the web container is not serving",
                           "docker compose -p care-erp-github up -d --no-deps api web"] },
  }],

  ["H4-healthz-unhealthy", {
    env: { STUB_NO_HEALTHZ: "1" },
    expect: { rc: 1, out: ["/api/healthz is still 000 after 2s",
                           "the API or its database is unhealthy even though the containers report healthy",
                           "No usable answer (http 000)",
                           // The retry itself: this line only exists if the gate
                           // asked twice and waited between the asks.
                           "… 1s  healthz=000"] },
  }],

  // Tonight's failure, named. A boot that never settles answers 503 forever, and
  // the operator has to be told that is a hung start rather than a dead database —
  // the two look identical from outside and only one of them needs the recovery.
  ["H4b-startup-never-settles", {
    state: { "healthz.code": "503",
             "healthz-body": '{"status":"starting","since":"2026-01-01T00:00:00.000Z"}' },
    expect: { rc: 1, out: ["is still 503 after 2s", 'never left "starting"',
                           "docker logs --tail 200"] },
  }],

  ["H4c-database-unreachable-names-the-recovery", {
    state: { "healthz.code": "503",
             "healthz-body": '{"status":"degraded","db":"unreachable"}' },
    expect: { rc: 1, out: ["cannot reach", "recover-after-daemon-restart.sh"] },
  }],

  // The reason the gate exists: a boot that is merely slow must not be reported as
  // a failed deploy. 503 starting, then 200 — the deploy has to ride it out.
  ["H4d-healthz-settles-after-retries", {
    env: { STUB_HEALTHZ_SETTLE_AFTER: "2", DEPLOY_READINESS_TIMEOUT_SECONDS: "6" },
    expect: { rc: 0, out: ["api + database healthy (/api/healthz) after 2s of readiness"] },
  }],

  ["H5-erp-ui-not-served", {
    env: { STUB_NO_ERP: "1" },
    expect: { rc: 1, out: ["/erp/ did not answer although the API is healthy"] },
  }],

  ["H6-wrong-commit-running", {
    state: { "health-body": '{"status":"ok","build":{"commit":"999999999999","staleStampDetected":false}}' },
    expect: { rc: 1, out: ["the containers are not the images that were just built",
                           "To go back to the previous images"] },
  }],

  ["H7-health-reports-no-commit", {
    state: { "health-body": '{"status":"ok"}' },
    expect: { rc: 1, out: ["did not report a commit"] },
  }],

  ["H8-stale-identity-flagged-not-hidden", {
    state: { "health-body": `{"status":"ok","build":{"commit":"${POST_SHA.slice(0, 12)}","staleStampDetected":true}}` },
    expect: { rc: 0, out: ["build identity as stale", "DEPLOYMENT COMPLETE"] },
  }],

  ["H9-rollback-pin-happens-before-build", {
    state: { "check.out": checkOut({ pending: 1, applied: 246 }) },
    expect: { rc: 0, calls: [PIN, BUILD, MIG, VERIFY, UP] },
  }],

  ["H10-first-deploy-has-nothing-to-pin", {
    state: { "api-image": "-" },
    expect: { rc: 0, out: ["first deploy, so there is nothing to roll back to", "DEPLOYMENT COMPLETE"],
      notCalls: ["tag care-erp-github-api:latest"] },
  }],

  ["H11-db-recreated-underneath-us", {
    state: { "db-identity-2": "dbcontainerid9999 some_other_volume" },
    expect: { rc: 0, out: ["is NOT the container this deploy started with", "before: ", "after : "] },
  }],

  // ── S: stamping GIT_COMMIT into .env, so the build bakes the real commit ───
  // What /api/health calls staleStampDetected is this file's fault: GIT_COMMIT is
  // a build ARG read from .env, and nothing in the deploy path ever refreshed it.
  // The assertions are on the WHOLE resulting file, because the only thing that
  // matters besides the new sha is that every secret came through unchanged.
  //
  // The witness is `build-sees GIT_COMMIT=…`, which the docker stub writes from
  // .env at the instant the build is invoked. Without it, a stamp moved to AFTER
  // the build would leave the same correct file on disk and the same green
  // assertions — the ordering is the entire product, so it is asserted as one.
  ["S1-stamps-the-commit-being-deployed", {
    expect: { rc: 0,
      out: ["Stamping the build identity into .env", "GIT_COMMIT is now 222222222222"],
      // `build-sees` is the ordering proof: the build must never be invoked while
      // .env still holds the commit it replaced.
      calls: [PIN, `build-sees GIT_COMMIT=${POST_SHA}`, BUILD, UP],
      notCalls: [`build-sees GIT_COMMIT=${PRE_SHA}`],
      dotenv: DEFAULT_DOTENV.replace(PRE_SHA, POST_SHA) },
  }],

  ["S2-no-git-commit-key-yet-appends-one", {
    dotenv: DEFAULT_DOTENV.split("\n").filter((l) => !l.startsWith("GIT_COMMIT=")).join("\n"),
    expect: { rc: 0,
      calls: [`build-sees GIT_COMMIT=${POST_SHA}`],
      // Appended at the end, and BUILD_DATE — the key that follows GIT_COMMIT on
      // the real box — is still exactly where it was.
      dotenv: `${DEFAULT_DOTENV.replace(`GIT_COMMIT=${PRE_SHA}\n`, "")}GIT_COMMIT=${POST_SHA}\n` },
  }],

  ["S3-duplicated-key-collapses-to-one-stamped-line", {
    dotenv: DEFAULT_DOTENV.replace("GIT_BRANCH=main", "GIT_BRANCH=main\nGIT_COMMIT=0000000000000000000000000000000000000000"),
    expect: { rc: 0,
      calls: [`build-sees GIT_COMMIT=${POST_SHA}`],
      notCalls: ["GIT_COMMIT=0000000000000000000000000000000000000000"],
      dotenv: DEFAULT_DOTENV.replace(PRE_SHA, POST_SHA) },
  }],

  // The dangerous shape: a file whose last line has no newline. Appending would
  // fuse `BUILD_DATE=…` and `GIT_COMMIT=…` into ONE setting with a corrupt value,
  // so the byte comparison must catch it and the file must not move at all.
  ["S4-no-final-newline-is-left-exactly-alone", {
    dotenv: DEFAULT_DOTENV.replace(`GIT_COMMIT=${PRE_SHA}\n`, "").replace(/\n$/, ""),
    // This seed has no GIT_COMMIT key at all, so an untouched file means the
    // build sees ABSENT — the stamp refusing is what "left exactly alone" looks
    // like here, not the old sha reappearing.
    expect: { rc: 0,
      out: ["changed more than that one line", "stays as it is", "Continuing the deploy"],
      calls: ["build-sees GIT_COMMIT=ABSENT"],
      notCalls: [`build-sees GIT_COMMIT=${POST_SHA}`],
      dotenvUnchanged: true },
  }],

  // A short/odd target is not a commit: it would bake an identity no image can
  // resolve, and the honest stale flag is worth more than a invented one.
  ["S5-sha-of-the-wrong-shape-writes-nothing", {
    state: { "head-after": "2".repeat(39) },
    expect: { rc: 0,
      out: ["is not a 40-character hex commit sha (got 39 characters)", "Continuing the deploy"],
      calls: [`build-sees GIT_COMMIT=${PRE_SHA}`],
      dotenvUnchanged: true },
  }],

  ["S6-rehearsal-stamps-nothing", {
    args: ["--check"],
    expect: { rc: 0,
      out: ["stamp   : GIT_COMMIT=222222222222 in .env first", "REHEARSAL COMPLETE"],
      notOut: ["Stamping the build identity"],
      notCalls: [BUILD],
      dotenvUnchanged: true },
  }],

  // ── R: the deploy that moves its own script ────────────────────────────────
  // bash executes the text it was handed, out of the file it was handed, and step
  // 3 replaces that file. Twice on the clinic's box (2026-11-13 00:01 and 08:38
  // IST) the images carried the new readiness gate while the still-running process
  // carried the one-shot curl gate #1347 had deleted, and both runs died with
  // "✗ DEPLOYMENT STOPPED … /api/healthz is not OK" about 25 s after a recreate
  // that settled on its own. These scenarios are the only way to see that: they
  // need the checkout to move UNDER a running bash, which is what `selfCopy` +
  // the git stub's STUB_SELF_MODIFY append does. The repository's own deploy.sh is
  // never written — every one of these runs against a copy inside its own sandbox.
  ["R1-moved-script-hands-the-run-to-the-new-text", {
    selfCopy: true,
    expect: { rc: 0,
      out: ["The fast-forward rewrote deploy.sh", "Re-running from the checkout's current script",
            "run 2 of 2",
            // Run 2 reaching the recreate at all is the proof it got the lock: the
            // handover releases it, because `exec` cannot carry it into the new
            // pipeline subshell (measured — a run that kept it stopped itself with
            // "Another deploy is already running").
            // The second run finds itself already at the target, which is the proof
            // that handing the run over costs a repeat of steps 1–3 and nothing more.
            "no new code", "DEPLOYMENT COMPLETE"],
      notOut: ["changed AGAIN", "Another deploy is already running", "✗ DEPLOYMENT STOPPED"],
      // Twice: once per script image. One would mean the re-exec never happened.
      callCounts: { "git merge --ff-only": 2 },
      // And the work still happens exactly once — BUILD/UP counts are asserted by
      // their own mutants; here it is enough that the second run reached them.
      calls: [CHECK, PIN, BUILD, UP] },
  }],

  ["R2-a-second-move-in-the-same-run-warns-instead-of-looping", {
    selfCopy: true, selfModifyLimit: 2,
    expect: { rc: 0,
      // The checkout moved AGAIN while run 2 was executing. Looping would be the
      // worse failure — an unbounded exec on the clinic's box, with the deploy
      // never reaching the recreate — so the script says it and carries on with
      // what it loaded. One re-exec, then a warning, then a real deploy.
      out: ["run 2 of 2", "deploy.sh changed AGAIN after re-executing",
            "continuing with the text already loaded", "DEPLOYMENT COMPLETE"],
      notOut: ["✗ DEPLOYMENT STOPPED", "Another deploy is already running"],
      // Exactly two runs, never three: run 2 warned instead of exec'ing again.
      callCounts: { "git merge --ff-only": 2 } },
  }],

  ["R3-an-unmoved-checkout-never-reexecs", {
    selfCopy: true, selfModifyLimit: 0,
    // The containment case: a copy-on-write checkout, a NAS whose git returned the
    // same tree, a developer box. The fingerprint must compare, find no change,
    // and say nothing — an unconditional re-exec would be an infinite loop, and
    // "nothing moved, so nothing changed" is what 39 of these 42 scenarios run as.
    expect: { rc: 0,
      out: ["DEPLOYMENT COMPLETE"],
      notOut: ["The fast-forward rewrote deploy.sh", "run 2 of 2", "changed AGAIN"],
      callCounts: { "git merge --ff-only": 1 } },
  }],
];

// ── Mutants ──────────────────────────────────────────────────────────────────
// Each is one protection removed. `count` is how many places in the script the
// target text appears — an unexpected count means the mutant silently did not
// apply, which would otherwise read as "the tests caught nothing" (a false clean
// bill of health for a defect that was never installed).
const MUTANTS = [
  { id: "A1", note: "nothing-pending no longer skips the migration container",
    from: '  if [ "$pending" = "0" ]; then\n    ok "Migrations skipped',
    to:   '  if [ "$pending" = "NEVER" ]; then\n    ok "Migrations skipped',
    count: 1, killedBy: ["A1-code-only-nothing-pending"] },

  { id: "A2", note: "a real pending migration is silently skipped",
    from: '  if [ "$pending" = "0" ]; then\n    ok "Migrations skipped',
    to:   '  if [ "$pending" != "0" ]; then\n    ok "Migrations skipped',
    count: 1, killedBy: ["A2-with-a-pending-migration", "C2-schema-changing-fresh-backup",
                         "D2-destructive-approved", "H9-rollback-pin-happens-before-build"] },

  { id: "B1", note: "the check's exit status is thrown away",
    from: "|| check_rc=$?", to: "|| check_rc=0", count: 1,
    killedBy: ["B1-applied-file-changed-12", "B2-no-migration-files-13", "B3-check-could-not-complete"] },

  { id: "B2", note: "the missing-verdict gate is disabled",
    from: '  if [ -n "$missing" ]; then', to: '  if [ -n "" ]; then', count: 1,
    killedBy: ["B4-check-says-nothing-at-all"] },

  { id: "B3", note: "'pending=all' (unreadable count) defaults to skip instead of run",
    from: '  [ -n "$pending" ] || pending=1', to: '  [ -n "$pending" ] || pending=0', count: 1,
    killedBy: ["C4-fresh-install-needs-no-backup"] },

  { id: "B4", note: "fresh-install detection never fires",
    from: "then fresh_install=1; fi", to: "then fresh_install=0; fi", count: 1,
    killedBy: ["C4-fresh-install-needs-no-backup"] },

  { id: "C1", note: "the backup-age comparison is inverted",
    from: "'BEGIN { exit !(a+0 > b+0) }'", to: "'BEGIN { exit !(b+0 > a+0) }'", count: 1,
    killedBy: ["C1-schema-changing-stale-backup", "C2-schema-changing-fresh-backup"] },

  { id: "C2", note: "the destructive backup window is inverted",
    from: "'BEGIN { exit !((a+0) * 60 > b+0) }'", to: "'BEGIN { exit !((b+0) > (a+0) * 60) }'", count: 1,
    killedBy: ["D2-destructive-approved", "D3-destructive-without-a-fresh-backup"] },

  { id: "D1", note: "destructive migrations never ask for approval",
    from: 'if [ -z "$APPROVE_DESTRUCTIVE" ]; then', to: 'if [ -n "$APPROVE_DESTRUCTIVE" ] && false; then',
    count: 1, killedBy: ["D1-destructive-needs-approval"] },

  { id: "D2", note: "destructive approval is refused even when given",
    from: 'if [ -z "$APPROVE_DESTRUCTIVE" ]; then', to: 'if [ -n "$APPROVE_DESTRUCTIVE" ]; then',
    count: 1, killedBy: ["D2-destructive-approved"] },

  { id: "D3", note: "the destructive branch is never taken",
    from: 'if [ "$destructive" = "yes" ]; then', to: 'if [ "$destructive" = "no" ]; then', count: 1,
    killedBy: ["D1-destructive-needs-approval"] },

  { id: "D4", note: "the schema-changing backup gate is never taken",
    from: 'elif [ "$schema_changing" = "yes" ]; then', to: 'elif [ "$schema_changing" = "no" ]; then',
    count: 1, killedBy: ["C1-schema-changing-stale-backup", "C2-schema-changing-fresh-backup",
                         "E2-rehearse-reports-an-old-backup-it-would-stop-on"] },

  { id: "E1", note: "--check falls through into a real deploy",
    from: '    return 0\n  fi\n\n  # ── 6/6 Pin the rollback', to: '    :\n  fi\n\n  # ── 6/6 Pin the rollback',
    count: 1, killedBy: ["E1-rehearse-builds-and-restarts-nothing"] },

  { id: "F1", note: "the dirty-tree gate is open",
    from: '  if [ -n "$dirty" ]; then', to: '  if [ -n "" ]; then', count: 1,
    killedBy: ["F1-dirty-tree-stops-before-fetch"] },

  { id: "F2", note: "the deploy lock is inverted",
    from: "  if ! mkdir /tmp/care-deploy.lock 2>/dev/null; then",
    to:   "  if mkdir /tmp/care-deploy.lock 2>/dev/null; then", count: 1,
    killedBy: ["F4-another-deploy-holds-the-lock"] },

  { id: "G1", note: "a failed build is ignored and the deploy continues",
    from: "  if ! dc build api web schema-verify; then",
    to: "  if ! (dc build api web schema-verify || true); then", count: 1,
    killedBy: ["G1-build-fails"] },

  { id: "G2", note: "a failed migration is ignored and the cutover happens",
    from: "    if ! dc run --rm --no-deps db-patch-v2; then",
    to: "    if ! (dc run --rm --no-deps db-patch-v2 || true); then", count: 1,
    killedBy: ["G2-migration-fails"] },

  { id: "G3", note: "schema-verify's verdict is thrown away",
    from: "  if ! dc run --rm --no-deps schema-verify; then",
    to: "  if ! (dc run --rm --no-deps schema-verify || true); then", count: 1,
    killedBy: ["G3-schema-verify-fails"] },

  { id: "G4", note: "schema verification is skipped when no migration is pending (the checks are not optional)",
    from: "  if ! dc run --rm --no-deps schema-verify; then",
    to: '  if [ "$pending" != "0" ] && ! dc run --rm --no-deps schema-verify; then', count: 1,
    killedBy: ["A1-code-only-nothing-pending", "G3-schema-verify-fails"] },

  { id: "H1", note: "the rollback tag is never pinned",
    from: '    docker tag "${PROJECT_NAME}-api:latest" "${PROJECT_NAME}-api:${ROLLBACK_TAG}" \\',
    to:   '    : "${PROJECT_NAME}-api:latest" "${PROJECT_NAME}-api:${ROLLBACK_TAG}" \\',
    count: 1, killedBy: ["H9-rollback-pin-happens-before-build", "A2-with-a-pending-migration"] },

  { id: "H2", note: "no rollback point is recorded, so failures cannot name one",
    from: '  ROLLBACK_TAG="rollback-${RUN_ID}"', to: '  ROLLBACK_TAG=""', count: 1,
    killedBy: ["H1-api-never-becomes-healthy", "H3-nginx-not-serving", "H6-wrong-commit-running"] },

  { id: "H3", note: "one healthy container is enough (web can stay dead)",
    from: "-lt 2 ]", to: "-lt 1 ]", count: 2,
    killedBy: ["H1-api-never-becomes-healthy", "H2-web-never-becomes-healthy"] },

  { id: "H4", note: "the /api/healthz gate is dropped",
    from: '  if [ "$hz_code" != "200" ]; then', to: "  if false; then", count: 1,
    killedBy: ["H4-healthz-unhealthy", "H4b-startup-never-settles",
               "H4c-database-unreachable-names-the-recovery"] },

  // The other half of the gate: without the deadline the probe waits forever, and
  // `SCENARIO_KILL_MS` above is what makes that visible as a failure instead of as
  // a silent 20-minute CI outage. One scenario, not three, on purpose: this mutant
  // removes the only bound on the loop, so each run costs the full 60 s kill window
  // rather than a second, and the proof does not need to be paid for three times.
  { id: "HZ", note: "the readiness deadline is removed (a hung boot never ends the loop)",
    from: '    [ "$hz_waited" -ge "$READINESS_TIMEOUT" ] && break', to: "    :",
    count: 1, killedBy: ["H4b-startup-never-settles"] },

  { id: "H5", note: "the /erp/ probe is dropped",
    from: '  if ! curl -fsS --max-time 10 -o /dev/null "${base}/erp/"; then',
    to: "  if false; then", count: 1, killedBy: ["H5-erp-ui-not-served"] },

  { id: "H6", note: "the commit check compares the reported commit with itself",
    from: '  case "${POST_SHA}" in', to: '  case "${commit}" in', count: 1,
    killedBy: ["H6-wrong-commit-running"] },

  { id: "H7", note: "the API's own stale-identity flag is suppressed",
    from: '  if [ "$stale" = "true" ]; then', to: '  if [ "$stale" = "false" ]; then', count: 1,
    killedBy: ["H8-stale-identity-flagged-not-hidden"] },

  { id: "H8", note: "the before/after database identity comparison is degenerate",
    from: '  if [ "$db_now" != "$PRE_DB_STATE" ]; then', to: '  if [ "$db_now" != "$db_now" ]; then',
    count: 1, killedBy: ["H11-db-recreated-underneath-us"] },

  { id: "I1", note: "the cutover names the db service",
    from: "  dc up -d --no-deps api web", to: "  dc up -d api web db", count: 1,
    killedBy: ["A1-code-only-nothing-pending", "A2-with-a-pending-migration"] },

  { id: "I2", note: "the cutover drops --no-deps (recreate may cascade into db)",
    from: "  dc up -d --no-deps api web", to: "  dc up -d api web", count: 1,
    killedBy: ["A1-code-only-nothing-pending", "H1-api-never-becomes-healthy"] },

  // ── S: the GIT_COMMIT stamp ────────────────────────────────────────────────
  // Three refusals inside stamp_env_commit have NO mutant, on purpose, and the
  // reason is measured rather than assumed: the symlink guard, the "readable
  // regular file owned by me" guard, and the mode restore. This box cannot make
  // a symlink at all (Node's symlinkSync throws EPERM, and bash `ln -s` silently
  // writes a COPY instead, rc 0), chmod is a no-op on Windows, and every file
  // here is owned by the uid running the test — so a scenario for any of the
  // three would be green without ever exercising the branch it names. On the NAS
  // all three describe a state the clinic's box does not have: its .env is one
  // plain, readable, mode 600 file owned by the deploying uid (measured
  // 2026-11-12). The passing side of each runs in every scenario above.
  { id: "J1", note: "the stamp is never applied, so every image keeps baking the old sha",
    from: '  if stamp_env_commit "$POST_SHA"; then', to: "  if false; then", count: 1,
    killedBy: ["S1-stamps-the-commit-being-deployed", "S2-no-git-commit-key-yet-appends-one",
               "S3-duplicated-key-collapses-to-one-stamped-line"] },

  { id: "J2", note: "the stamp writes the commit that WAS deployed, not the one being deployed",
    from: '  if stamp_env_commit "$POST_SHA"; then',
    to: '  if stamp_env_commit "$PRE_SHA"; then', count: 1,
    killedBy: ["S1-stamps-the-commit-being-deployed", "S2-no-git-commit-key-yet-appends-one"] },

  { id: "J3", note: "the byte-for-byte proof that only GIT_COMMIT moved is disabled",
    from: "  if ! grep -v '^GIT_COMMIT=' \"$f\" | cmp -s - <(grep -v '^GIT_COMMIT=' \"$tmp\"); then",
    to: "  if false; then", count: 1,
    killedBy: ["S4-no-final-newline-is-left-exactly-alone"] },

  { id: "J4", note: "a duplicated GIT_COMMIT key is left for compose to guess at",
    from: '      awk \'/^GIT_COMMIT=/ { if (kept) next; kept = 1 } { print }\' "$tmp" > "$tmp2"',
    to: '      cat "$tmp" > "$tmp2"', count: 1,
    killedBy: ["S3-duplicated-key-collapses-to-one-stamped-line"] },

  { id: "J5", note: "the replace branch rewrites .env without touching the sha",
    from: '    sed "s|^GIT_COMMIT=.*|GIT_COMMIT=$sha|" "$f" > "$tmp"',
    to: '    cat "$f" > "$tmp"', count: 1,
    killedBy: ["S1-stamps-the-commit-being-deployed", "S3-duplicated-key-collapses-to-one-stamped-line"] },

  { id: "J6", note: "the append branch writes an empty file instead of the new key",
    from: "    { cat \"$f\"; printf 'GIT_COMMIT=%s\\n' \"$sha\"; } > \"$tmp\"",
    to: '    : > "$tmp"', count: 1,
    killedBy: ["S2-no-git-commit-key-yet-appends-one"] },

  { id: "J7", note: "any string is accepted as a commit sha",
    from: '  if [ "${#sha}" -ne 40 ] || [ -n "${sha//[0-9a-f]/}" ]; then',
    to: "  if false; then", count: 1,
    killedBy: ["S5-sha-of-the-wrong-shape-writes-nothing"] },

  // ── RW: the re-exec of a script its own run replaced ───────────────────────
  // RW0 costs the full 60 s kill window on purpose, exactly like HZ: an unbounded
  // `exec` has no other observable end, and a scenario that merely asserted "no
  // third run" would pass by accident if the loop ever started.
  { id: "RW0", note: "re-execs even when the checkout did not move (an exec loop)",
    from: '  if [ "$SELF_LOADED" != "$(self_fingerprint)" ]; then',
    to: "  if true; then", count: 1,
    killedBy: ["R3-an-unmoved-checkout-never-reexecs"] },

  { id: "RW1", note: "the script that was replaced keeps running the old text",
    from: '  if [ "$SELF_LOADED" != "$(self_fingerprint)" ]; then',
    to: "  if false; then", count: 1,
    killedBy: ["R1-moved-script-hands-the-run-to-the-new-text"] },

  { id: "RW2", note: "the once-only guard is gone, so a second move execs again",
    from: '    if [ "${CARE_DEPLOY_REEXEC:-}" = 1 ]; then',
    to: "    if false; then", count: 1,
    killedBy: ["R2-a-second-move-in-the-same-run-warns-instead-of-looping"] },

  // The handover's own bookkeeping: `exec` cannot carry the lock into the new
  // bash's pipeline subshell, so a run that does not release it stops its own
  // deploy on a lock nobody else is holding. Half-breaking the release is enough
  // — an rmdir on a directory that still contains `pid` leaves it in place, which
  // is exactly the mistake this mutant models.
  { id: "RW3", note: "the handover keeps the lock it is about to hand over",
    from: "      rm -f /tmp/care-deploy.lock/pid",
    to: "      :", count: 1,
    killedBy: ["R1-moved-script-hands-the-run-to-the-new-text"] },

  // Both sides of the fingerprint. A deploy that re-checks nothing (RW1) is the
  // old bug; one that checks and always acts (RW0) is an exec loop; and a run
  // that cannot tell ITS OWN earlier self from a second operator (RW2) loops.
  { id: "RW4", note: "the fingerprint is a constant, so a moved checkout is invisible",
    from: "self_fingerprint() { cksum \"$SELF_SRC\" 2>/dev/null || printf 'unreadable'; }",
    to: "self_fingerprint() { printf 'constant'; }", count: 1,
    killedBy: ["R1-moved-script-hands-the-run-to-the-new-text"] },
];

// ── Static validation (Task 6: "perform static validation") ──────────────────
describe("deploy.sh static validation", () => {
  it("parses as bash, ships LF-only, and says what it is", () => {
    execFileSync("bash", ["-n", DEPLOY], { stdio: ["ignore", "pipe", "pipe"] });
    const raw = readFileSync(DEPLOY);
    // CRLF makes a `#!/usr/bin/env bash` script unrunnable on the NAS; the repo
    // governs `*.sh` to LF, and this is the copy that gets symlinked into place.
    expect(raw.includes(0x0d)).toBe(false);
    const first = raw.toString("utf8").split("\n")[0];
    expect(first.startsWith("#!"), "deploy.sh has no shebang").toBe(true);
    expect(/bash/.test(first), `deploy.sh is not run by bash: ${first}`).toBe(true);
  });

  it("has its stubs, LF-normalized and non-empty", () => {
    // If one of these is deleted or renamed, every scenario below would fail
    // with a confusing ENOENT from bash. Say which one, and why it matters.
    for (const name of STUB_NAMES) {
      const body = readFileSync(join(STUB_SRC, name), "utf8").replace(/\r\n/g, "\n");
      expect(body.startsWith("#!/bin/bash"), `${name} stub is not a bash script`).toBe(true);
      expect(body.includes("$CALLS"), `${name} stub does not log its argv; assertions on the call sequence would be vacuous`).toBe(true);
    }
  });
});

// ── Scenarios ────────────────────────────────────────────────────────────────
describe("deploy.sh behaviour against stubbed git/docker/curl", () => {
  for (const [name, opts] of SCENARIOS) {
    it(name, () => assertClean(evaluate(DEPLOY, name, opts, "")), SCENARIO_TIMEOUT_MS);
  }
});

// ── Mutation battery ─────────────────────────────────────────────────────────
describe("deploy.sh protections are load-bearing (mutation battery)", () => {
  it("names a real scenario for every mutant", () => {
    const known = new Set(SCENARIOS.map(([n]) => n));
    const unknown = [];
    const duplicateIds = [];
    const seen = new Set();
    for (const m of MUTANTS) {
      if (seen.has(m.id)) duplicateIds.push(m.id);
      seen.add(m.id);
      for (const n of m.killedBy) if (!known.has(n)) unknown.push(`${m.id} → ${n}`);
    }
    expect(unknown).toEqual([]);
    expect(duplicateIds).toEqual([]);
  });

  it("kills every mutant: no protection is decorative", () => {
    const src = readFileSync(DEPLOY, "utf8");
    const dir = join(ROOT, "mutants");
    mkdirSync(dir, { recursive: true });
    const lines = [];
    const survivors = [];
    const inapplicable = [];

    for (const m of MUTANTS) {
      const hits = src.split(m.from).length - 1;
      if (hits !== m.count) {
        inapplicable.push(`${m.id}: found ${hits} occurrence(s) of the target text, expected ${m.count}`);
        continue;
      }
      const mutated = src.split(m.from).join(m.to);
      if (mutated === src) { inapplicable.push(`${m.id}: replacement produced no change`); continue; }
      const file = join(dir, `${m.id}.sh`);
      writeFileSync(file, mutated);
      const killed = [];
      const missed = [];
      for (const name of m.killedBy) {
        const entry = SCENARIOS.find((n) => n[0] === name);
        const r = evaluate(file, name, entry[1], m.id);
        (r.problems.length ? killed : missed).push(name);
      }
      lines.push(`✓ ${m.id} ${m.note} — killed by ${killed.join(", ")}`);
      if (!killed.length) {
        survivors.push(`✗ ${m.id} SURVIVED: ${m.note}\n      no listed scenario changed behaviour: ${missed.join(", ")}`);
      }
    }

    // Print the ledger, not just the verdict: "36 mutants killed" proves nothing
    // to a reader who cannot see WHICH scenario caught WHICH break.
    console.log(lines.join("\n"));
    // An inapplicable mutant is not a pass: the protection was never broken, so
    // nothing was proven about it.
    expect(inapplicable, "mutants that did not apply:\n" + inapplicable.join("\n")).toEqual([]);
    expect(survivors, "surviving mutants:\n" + survivors.join("\n")).toEqual([]);
    expect(MUTANTS.length).toBe(42);
  }, BATTERY_TIMEOUT_MS);
});
