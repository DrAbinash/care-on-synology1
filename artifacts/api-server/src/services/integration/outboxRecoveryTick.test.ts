// ============================================================================
// PR-I2 — a recovered event must be VISIBLE, not just repaired.
//
// The reclaim is silent work: it changes rows in the database and the only signal
// an operator has is the dispatcher's own log line. `tickOutbox` used to log only
// when `claimed` was non-zero, which is exactly the state an abandoned event is in
// after being reclaimed — so the one tick that unblocked a stranded report could
// pass without a trace. This asserts the behaviour of the real `tickOutbox`, with
// the dispatcher stubbed so the test is about logging, not about Postgres.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Skipped without DATABASE_URL for the repo's usual reason: this test does not query
// Postgres, but `scheduler.ts` imports `@workspace/db`, which reads DATABASE_URL at
// module evaluation and throws before any test body runs.
const hasDb = !!process.env.DATABASE_URL;
const suite = hasDb ? describe : describe.skip;

const dispatch = vi.fn();

async function tickAndCapture(res: { claimed: number; sent: number; failed: number; dead: number; recovered: number }): Promise<string[]> {
  dispatch.mockResolvedValue(res);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  let lines: string[] = [];
  try {
    const scheduler = await import("./scheduler");
    await scheduler.tickOutbox();
    lines = log.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  } finally {
    log.mockRestore();
  }
  return lines;
}

beforeEach(() => {
  dispatch.mockReset();
  vi.stubEnv("HOPE_CARE_INTEGRATION_FORCE", "1");
  vi.doMock("./outbox", () => ({
    dispatchPendingOutbox: dispatch,
    enqueueOutboxEvent: vi.fn(),
    signBody: vi.fn(),
    retryOutboxEvent: vi.fn(),
  }));
  vi.doMock("./resultsEmitter", () => ({ reconcileResults: vi.fn(async () => ({ emitted: 0 })) }));
  vi.doMock("./statusReconciler", () => ({ reconcileStatuses: vi.fn(async () => ({ sampleEvents: 0, studyEvents: 0 })) }));
  vi.doMock("./criticalEscalation", () => ({ escalateCriticalResults: vi.fn(async () => ({ escalated: 0 })) }));
  vi.doMock("../electronicFilm/poller", () => ({ pollElectronicFilmJobs: vi.fn(async () => ({ discovered: 0, imported: 0, errors: 0 })) }));
  vi.doMock("../electronicFilm/settings", () => ({ getElectronicFilmSettings: vi.fn(async () => ({ integrationEnabled: false, autoImport: false })) }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./outbox");
  vi.doUnmock("./resultsEmitter");
  vi.doUnmock("./statusReconciler");
  vi.doUnmock("./criticalEscalation");
  vi.doUnmock("../electronicFilm/poller");
  vi.doUnmock("../electronicFilm/settings");
});

suite("PR-I2 recovery is reported by the dispatcher tick", () => {
  it("logs the tick when the only work was a reclaim (nothing was claimed)", async () => {
    const lines = await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, recovered: 2 });
    expect(lines.some((l) => l.includes("[integration] outbox dispatch") && l.includes('"recovered":2'))).toBe(true);
  });

  it("logs when there is ordinary claimed work", async () => {
    const lines = await tickAndCapture({ claimed: 3, sent: 3, failed: 0, dead: 0, recovered: 0 });
    expect(lines.some((l) => l.includes("[integration] outbox dispatch"))).toBe(true);
  });

  it("stays quiet on an idle tick", async () => {
    const lines = await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, recovered: 0 });
    expect(lines.some((l) => l.includes("[integration] outbox dispatch"))).toBe(false);
  });
});
