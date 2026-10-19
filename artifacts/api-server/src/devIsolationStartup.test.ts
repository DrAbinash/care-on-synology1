import { afterEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BLOCKED_STARTUP_STEPS } from "./lib/devIsolation";
import { bootStep, initializeDevIsolation, mayRunStep, shutdownDevIsolation } from "./devIsolationBoot";

const SRC = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(SRC, "index.ts"), "utf8");
const workerSrc = readFileSync(join(SRC, "worker.ts"), "utf8");

const GATE_PATTERN = /(?:bootStep|mayRunStep)\(\s*"([a-zA-Z]+)"/g;

function gatedSteps(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(GATE_PATTERN)) {
    const name = match[1];
    if (name) found.push(name);
  }
  return found;
}

describe("the entrypoints gate every registered side effect", () => {
  /**
   * Two-way completeness. A one-way check ("every gate is registered") would still
   * pass after somebody deleted a gate, which is precisely the regression this mode
   * cannot afford: the census of boot side effects is the deliverable.
   */
  test("no gate names an unregistered step", () => {
    const registered = new Set(Object.keys(BLOCKED_STARTUP_STEPS));
    for (const name of [...gatedSteps(indexSrc), ...gatedSteps(workerSrc)]) {
      expect(registered.has(name), `"${name}" is gated but not in BLOCKED_STARTUP_STEPS`).toBe(true);
    }
  });

  test("every registered step is actually gated in index.ts or worker.ts", () => {
    const callSites = new Set([...gatedSteps(indexSrc), ...gatedSteps(workerSrc)]);
    for (const name of Object.keys(BLOCKED_STARTUP_STEPS)) {
      expect(callSites.has(name), `"${name}" is registered but no entrypoint gates it`).toBe(true);
    }
  });

  test("the consumers the brief names are gated in the HTTP server's own boot path", () => {
    // Not merely "somewhere": these are the always-on ones that ENABLE_SCHEDULERS
    // was never a way to stop.
    for (const name of [
      "radiologyJobConsumer",
      "aiReportComposeJobConsumer",
      "orthancChangesPoller",
      "mriStudyWarmer",
      "missingStudyReconciliation",
      "startupMigrations",
      "pluginLoaderUsbScan",
    ]) {
      expect(gatedSteps(indexSrc)).toContain(name);
    }
  });

  test("the worker's unconditional schedulers are gated, because worker.ts ignores ENABLE_SCHEDULERS", () => {
    expect(gatedSteps(workerSrc)).toEqual(expect.arrayContaining(["cronScheduler", "integrationScheduler"]));
    // The gate must be the call site, not a comment about it.
    expect(workerSrc).toMatch(/bootStep\(\s*"cronScheduler",\s*\(\)\s*=>\s*startCronScheduler\(\)\)/);
  });

  test("isolation is initialised before anything can query or listen", () => {
    const initAt = indexSrc.indexOf("initializeDevIsolation()");
    expect(initAt).toBeGreaterThan(-1);
    expect(initAt).toBeLessThan(indexSrc.indexOf("app.listen("));
    expect(initAt).toBeLessThan(indexSrc.indexOf("runStartupMigrations().then"));
    // The hoisting trap: every `import` in these files is evaluated before any
    // statement, so a check that lived inside an imported module's body would run
    // BEFORE dotenv and would not see a .env-supplied DATABASE_URL.
    expect(indexSrc.indexOf('dotenv.config({ path: rootEnv })')).toBeLessThan(initAt);

    const workerInit = workerSrc.indexOf("initializeDevIsolation()");
    expect(workerInit).toBeGreaterThan(-1);
    expect(workerInit).toBeLessThan(workerSrc.indexOf('pool.query("SELECT 1")'));
  });
});

describe("bootStep and mayRunStep at runtime", () => {
  const savedFlag = process.env.CARE_DEV_ISOLATED;

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.CARE_DEV_ISOLATED;
    else process.env.CARE_DEV_ISOLATED = savedFlag;
  });

  test("without the flag the side effect runs", () => {
    delete process.env.CARE_DEV_ISOLATED;
    let ran = 0;
    bootStep("cronScheduler", () => {
      ran += 1;
    });
    expect(ran).toBe(1);
    expect(mayRunStep("mriStudyWarmer")).toBe(true);
  });

  test("with the flag the side effect does not run", () => {
    process.env.CARE_DEV_ISOLATED = "1";
    let ran = 0;
    bootStep("orthancChangesPoller", () => {
      ran += 1;
    });
    expect(ran).toBe(0);
    expect(mayRunStep("missingStudyReconciliation")).toBe(false);
  });

  test("an unregistered step is refused loudly rather than assumed safe", () => {
    delete process.env.CARE_DEV_ISOLATED;
    expect(() => mayRunStep("brandNewPoller" as never)).toThrow(/BLOCKED_STARTUP_STEPS/);
    process.env.CARE_DEV_ISOLATED = "1";
    let ran = 0;
    expect(() => bootStep("brandNewPoller" as never, () => { ran += 1; })).toThrow(/brandNewPoller/);
    expect(ran).toBe(0);
  });
});

describe("initializeDevIsolation fails closed on the database", () => {
  const saved = { ...process.env };

  afterEach(() => {
    shutdownDevIsolation();
    for (const key of ["CARE_DEV_ISOLATED", "DATABASE_URL", "CARE_DEV_DATABASE_URL"]) delete process.env[key];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  });

  test("a production-shaped DATABASE_URL stops the process before it listens", () => {
    process.env.CARE_DEV_ISOLATED = "1";
    process.env.DATABASE_URL = "postgresql://care:secret@172.16.1.139:5432/care_erp";
    expect(() => initializeDevIsolation()).toThrow(/CARE_DEV_ISOLATED refuses to start/);
    expect(() => initializeDevIsolation()).toThrow(/172\.16\.1\.139/);
  });

  test("the approved development database starts, and installs the guards", () => {
    process.env.CARE_DEV_ISOLATED = "1";
    process.env.DATABASE_URL = "postgresql://erp@127.0.0.1:5411/care_dev";
    const fetchBefore = globalThis.fetch;
    try {
      initializeDevIsolation();
    } catch (err) {
      expect(err).toBeUndefined();
      return;
    }
    expect(globalThis.fetch).not.toBe(fetchBefore);
    shutdownDevIsolation();
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  test("with no flag nothing is initialised and nothing is wrapped", () => {
    delete process.env.CARE_DEV_ISOLATED;
    process.env.DATABASE_URL = "postgresql://care@172.16.1.139:5432/care_erp";
    const fetchBefore = globalThis.fetch;
    expect(() => initializeDevIsolation()).not.toThrow();
    expect(globalThis.fetch).toBe(fetchBefore);
  });
});
