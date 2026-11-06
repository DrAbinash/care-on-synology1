// Regression for PR #548: Tests + migration smoke sat >10 min on
// `sudo apt-get update && apt-get install poppler-utils` because jobs inherited
// GitHub's 6-hour default timeout. A sibling e2e job hung 2h on
// `playwright install --with-deps`. These assertions keep the caps in the
// workflow so a hung apt/playwright step fails in minutes, not hours.
//
// Counter-regression for 2026-10-01: those caps then killed 3 of 4 runs because
// a *slow* mirror, not a hung one, cannot fit 33.4 MB in 240 s. So the caps are
// asserted to exist AND to leave the script's own budgets room to finish.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const yml = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const aptHelper = readFileSync(path.join(root, "scripts/ci-apt-install.sh"), "utf8");

describe("CI hang guards (PR #548 — apt-get sat past 10 min with no timeout)", () => {
  it("every job caps wall time so a hung step cannot sit for the 6h default", () => {
    // `identity` is in this list because PR #1015 added it: a job that runs a
    // real `docker build` is precisely the kind of step that hangs on a registry,
    // and a cap guard that hardcodes the two older jobs silently exempts whatever
    // comes after them.
    for (const job of ["static", "identity", "test"]) {
      const block = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.startsWith(`${job}:`));
      expect(block, `job ${job} missing`).toBeTruthy();
      expect(block).toMatch(/timeout-minutes:\s*[1-9][0-9]*/);
    }
  });

  it("CI apt and Chromium installs have bounded step timeouts", () => {
    expect(yml).toMatch(/Install CI apt packages[\s\S]*?timeout-minutes:\s*[1-9]/);
    expect(yml).toMatch(/Install Chromium browser[\s\S]*?timeout-minutes:\s*[1-9]/);
    expect(yml).toMatch(/Browser smoke \(login shell\)[\s\S]*?timeout-minutes:\s*[1-9]/);
    expect(yml).not.toContain("playwright install --with-deps chromium");
    expect(yml).toContain("playwright install chromium");
  });

  it("apt-get is not invoked unbounded from the workflow", () => {
    expect(yml).not.toMatch(/sudo apt-get update && sudo apt-get install/);
    expect(yml).toContain("scripts/ci-apt-install.sh");
    // Both apt-get calls go through one bounded helper. Asserting the helper takes the
    // budget from its arguments is stronger than asserting two literal `timeout` lines:
    // an apt-get added anywhere else in the file has no budget to be found by a literal
    // match, and `timeout` is only reachable through run_bounded.
    expect(aptHelper).toMatch(/run_bounded UPDATE "\$APT_UPDATE_TIMEOUT_SECONDS" apt-get update/);
    expect(aptHelper).toMatch(/run_bounded INSTALL "\$APT_INSTALL_TIMEOUT_SECONDS" \\?\s*apt-get install/);
    expect(aptHelper).toMatch(/timeout "\$budget" "\$@"/);
    // Counting the apt-get calls keeps a third, unbounded one from appearing.
    // Comments are stripped first — this file documents apt behaviour in prose, and a
    // guard that counts prose would fail on documentation rather than on a real call.
    const codeOnly = aptHelper.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
    expect((codeOnly.match(/\bapt-get (?:update|install)\b/g) ?? []).length).toBe(2);
    expect(aptHelper).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(aptHelper).toContain("fuser /var/lib/dpkg/lock-frontend");
    // CI never reads apt's translated output, so the Translation-* index files are
    // bytes fetched for nothing — and they were still being fetched on the incident
    // run (run 40519420161 logged `noble-updates/main Translation-en [310 kB]`).
    expect(aptHelper).toContain("Acquire::Languages=none");
  });

  it("the install budget fits a slow mirror and the step outlives it", () => {
    const num = (re) => Number(aptHelper.match(re)?.[1] ?? 0);
    const lock = num(/CI_APT_LOCK_WAIT_SECONDS:-(\d+)/);
    const update = num(/CI_APT_UPDATE_TIMEOUT_SECONDS:-(\d+)/);
    const install = num(/CI_APT_INSTALL_TIMEOUT_SECONDS:-(\d+)/);
    // Measured 2026-10-01: `apt-get update` pulled its 12.6 MB index at ~8 MB/s
    // while the 33.4 MB of packages arrived at ~130 kB/s, so a 240s install cap
    // killed the step at mesa-libgallium on 3 of 4 runs (exit 124, before any
    // test ran). The cap has to be sized for throughput, not for a hang.
    //
    // Re-measured 2026-10-27: 480 s was not enough either. Run 40519420161 (PR #1203)
    // died at 8m 5s of step time and run 40504875958 killed the merge commit `243eca8`
    // on `main` at 8m 16s, both with `Process completed with exit code 124` — the
    // install budget spent, not a package failing. A healthy run of the same step takes
    // 12 s (main at ec7620c9, run 40524985497), because the packages are already in the
    // runner image; so a budget this generous costs nothing on the normal path and is
    // only ever spent on a degraded-mirror day. The floor is that measured incident
    // (~496 s) nearly doubled, not a round number chosen for looks.
    expect(lock, "no lock-wait budget recorded").toBeGreaterThan(0);
    expect(update).toBeGreaterThan(0);
    expect(install, "install cap at or below the measured slow-mirror kill").toBeGreaterThanOrEqual(900);

    const step = Number(yml.match(/Install CI apt packages[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1] ?? 0);
    // The step cap is the outer clock on the whole script, so it has to outlive every
    // budget the script can spend — lock wait included, which the earlier assertion
    // left out and which is exactly the 60 s that made the old 12-minute step tight.
    expect(step * 60, "workflow step preempts the script's own retry budgets")
      .toBeGreaterThan(lock + update + install);

    const jobBlock = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.startsWith("test:"));
    const jobCap = Number(/timeout-minutes:\s*(\d+)/.exec(jobBlock)?.[1] ?? 0);
    expect(step, "the apt step cap is larger than the job that runs it").toBeLessThanOrEqual(jobCap);
  });
});

describe("the build-identity job fits the build it actually runs (measured 2026-10-15)", () => {
  // Run 38743698974, job 116451658251, on head 5e54b561 — the first time this
  // repository built anything in CI. Whole job 39 s (13:33:26 → 13:34:05); the
  // context tier step 24 s; the dispatched real tier skipped. Docker server 28.0.4.
  const MEASURED_CONTEXT_SECONDS = 24;
  const block = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.includes("docker-build-identity.mjs")) || "";

  it("caps the context tier at more than double the measured build", () => {
    const step = Number(yml.match(/Prove the build context carries the identity[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1] ?? 0);
    expect(step, "the context tier step has no cap").toBeGreaterThan(0);
    expect(step * 60, "cap below 2x the measured duration of a passing build")
      .toBeGreaterThanOrEqual(2 * MEASURED_CONTEXT_SECONDS);
  });

  it("leaves the dispatched production tier a budget, because nobody has measured it", () => {
    const step = Number(yml.match(/Prove the production Dockerfile[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1] ?? 0);
    expect(step, "the real tier step has no cap").toBeGreaterThanOrEqual(15);
  });

  it("runs the cheap proof before the expensive one", () => {
    // If the expensive tier went first, a registry stall would consume the whole
    // job budget and the `.dockerignore` claim would end the run untested.
    expect(yml.indexOf("Prove the build context carries the identity")).toBeLessThan(
      yml.indexOf("Prove the production Dockerfile"),
    );
    expect(block).toContain("docker-build-identity.mjs --tier context");
  });
});

describe("the Vitest step cap fits the suite that actually runs (measured 2026-10-15)", () => {
  // main at 1841668b, run 38698375279: the step started 07:24:21, printed
  // `Test Files  1037 passed | 5 skipped` / `Tests  13507 passed | 17 skipped` at
  // 07:34:29 — 10 min 8 s — and was then killed by the 10-minute cap. Eight seconds
  // of headroom on a fully passing suite. That is not a gate: a red run that really
  // means "green but long" teaches everyone to ignore red, and it hides every genuine
  // failure behind a clock. Sized at 2x the measured duration, not at a round number.
  const MEASURED_SECONDS = 608;
  const vitestStep = Number(yml.match(/Vitest suite[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1] ?? 0);

  it("exists and leaves double the measured passing duration", () => {
    expect(vitestStep, "the Vitest step has no timeout cap at all").toBeGreaterThan(0);
    expect(vitestStep * 60, "cap below 2x the measured duration of a passing suite")
      .toBeGreaterThanOrEqual(2 * MEASURED_SECONDS);
  });

  it("is not preempted by the job cap, which would reintroduce the same clock", () => {
    const block = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.startsWith("test:"));
    expect(block, "job test missing").toBeTruthy();
    const jobCap = Number(/timeout-minutes:\s*(\d+)/.exec(block)?.[1] ?? 0);
    const stepCaps = [...block.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
    const stepsTotal = stepCaps.reduce((a, b) => a + b, 0) - jobCap;
    expect(jobCap, "job test has no timeout cap").toBeGreaterThan(0);
    expect(jobCap, "the job backstop is smaller than the sum of its own step caps, so it is the real cap")
      .toBeGreaterThanOrEqual(stepsTotal);
  });
});

describe("the Postgres job's runner carries the Postgres client it restores with (measured 2026-10-29)", () => {
  // Nothing in this repository moved. GitHub moved `ubuntu-latest` from 24.04 to
  // 26.04 between 11:22 and 13:24 UTC today, the service tag stayed
  // `postgres:16-alpine` (server 16.15 in both runs), and the suite went from
  // `Test Files 1317 passed` to 6 failures in
  // restoreVerify.integration.test.ts — all of them downstream of one step.
  //
  // `restoreVerification` shells out to whatever pg_dump and psql are on PATH. The
  // 26.04 image's client is 18, and a 18 dump preamble opens with
  // `SET statement_timeout / lock_timeout / idle_in_transaction_session_timeout /
  // transaction_timeout`; server 16 has no `transaction_timeout` GUC, so
  // `psql_restore` aborts. Measured on this box with the same 18.3 client: the
  // directive is line 13 of the preamble, which is the exact position CI's error
  // names — `psql:/tmp/restore_verify_*.sql:13: ERROR: unrecognized configuration
  // parameter "transaction_timeout"`. Run 40864922489 (24.04) logged
  // `"name": "psql_restore", "ok": true` at 11:29:21; run 40883963570 (26.04)
  // logged ok:false at 13:52 with every other step of the job unchanged.
  //
  // So the pairing is the fact under test: the client major has to equal the
  // service major. Production is PostgreSQL 16, where the backup job dumps and the
  // verifier restores inside the same container, so CI's client stays 16 too.
  const PG_SERVICE_MAJOR = "16";
  const RUNNER_WHOSE_CLIENT_IS_PG16 = "ubuntu-24.04";

  const block = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.startsWith("test:"));
  const runsOn = /runs-on:\s*(\S+)/.exec(block)?.[1] ?? "";
  const serviceMajor = /image:\s*postgres:(\d+)-/.exec(block)?.[1] ?? "";

  it("does not float the runner under the database job", () => {
    expect(block, "job test missing").toBeTruthy();
    expect(runsOn, "the Postgres job floats ubuntu-latest, so a runner-image roll silently changes its pg_dump")
      .not.toBe("ubuntu-latest");
    expect(runsOn).toMatch(/^ubuntu-\d+\.\d+$/);
  });

  it("pins the runner whose Postgres client major equals the service major", () => {
    expect(serviceMajor, "the Postgres service image major is unreadable").toBe(PG_SERVICE_MAJOR);
    expect(
      runsOn,
      `the service is Postgres ${PG_SERVICE_MAJOR}, so the runner has to be the image measured to ship the ${PG_SERVICE_MAJOR} client`,
    ).toBe(RUNNER_WHOSE_CLIENT_IS_PG16);
  });
});
