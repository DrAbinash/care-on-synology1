import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STARTUP_DEADLINE_MS,
  markStartupMigrationsSettled,
  startupHealth,
  withStartupDeadline,
} from "./startupState";

// Why this file exists: on 2026-11-12 18:31Z the clinic's care-api booted, served
// /erp/, /api/health and /api/health/schema with 200, and stayed "starting" on
// /api/healthz for the rest of its life — runStartupMigrations() had lost a Postgres
// response and never settled, so the readiness marker was never reached. The deploy
// script judged that single endpoint, stopped itself, and left a healthy build
// reported as a failed deploy. A hung boot must cost a DEGRADED verdict, never a
// permanent "wait".

const realSetTimeout = globalThis.setTimeout;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withStartupDeadline", () => {
  it("passes the work's own value through when the work settles in time", async () => {
    await expect(withStartupDeadline(Promise.resolve(42), 5_000)).resolves.toBe(42);
  });

  it("rejects, naming the budget, when the work never settles", async () => {
    const hung = new Promise<string>(() => undefined);
    await expect(withStartupDeadline(hung, 10)).rejects.toThrow(/did not settle within 10 ms/);
  });

  it("lets a real failure through unmodified — the deadline must not mask errors", async () => {
    await expect(
      withStartupDeadline(Promise.reject(new Error("relation does not exist")), 5_000),
    ).rejects.toThrow("relation does not exist");
  });

  it("unrefs the timer so a serving process is never held open by the deadline", async () => {
    const unref = vi.fn();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      const timer = realSetTimeout(fn, ms) as unknown as { unref?: () => void };
      timer.unref = unref;
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    await expect(withStartupDeadline(Promise.resolve("ok"), 20)).resolves.toBe("ok");
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("clears the timer once the work wins, so the losing branch cannot fire later", async () => {
    const cleared = vi.fn();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms)) as unknown as typeof setTimeout);
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(((timer: unknown) => {
      cleared(timer);
    }) as unknown as typeof clearTimeout);

    await expect(withStartupDeadline(Promise.resolve("ok"), 20)).resolves.toBe("ok");
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});

describe("the readiness budget the two files agree on", () => {
  it("deploy.sh waits longer than STARTUP_DEADLINE_MS, so a slow boot is not a failed deploy", () => {
    const deploySh = readFileSync(
      fileURLToPath(new URL("../../../../deploy.sh", import.meta.url)),
      "utf8",
    );
    const declared = /DEPLOY_READINESS_TIMEOUT_SECONDS:-(\d+)/.exec(deploySh);
    expect(declared, "deploy.sh must keep a DEPLOY_READINESS_TIMEOUT_SECONDS default").not.toBeNull();
    const seconds = Number(declared![1]);
    expect(seconds * 1000).toBeGreaterThan(STARTUP_DEADLINE_MS);
    // And not absurdly longer: past twice the budget the deploy is just slow to fail.
    expect(seconds * 1000).toBeLessThanOrEqual(STARTUP_DEADLINE_MS * 2);
  });
});

// Last in this file: it writes the module singleton, which the cases above share.
describe("a forced deadline as health sees it", () => {
  it("reports DEGRADED with the reason instead of withholding a verdict", () => {
    markStartupMigrationsSettled(
      false,
      "startup work did not settle within 180000 ms — forced readiness",
    );
    const health = startupHealth();
    expect(health.phase).toBe("ready");
    expect(health.status).toBe("DEGRADED");
    expect(health.detail).toContain("did not settle within 180000 ms");
  });
});
