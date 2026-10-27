// ============================================================================
// PR-I8 — a recovered wa_outbox row must be VISIBLE, not just repaired.
//
// The reclaim is silent work: it changes rows in the database, and the only
// signal the clinic has is the cron tick's own log line. That line used to be
// gated on `claimed > 0`, which is precisely the state a reclaimed row is in —
// it goes back to `queued` with a backoff, so the tick that unblocked it
// claims nothing. A patient's reminder could sit unsent for days while the log
// stayed clean. Same contract PR-I2 proved for the HOPE outbox
// (integration/outboxRecoveryTick.test.ts), applied to the WhatsApp one.
//
// The dispatcher is stubbed: this test is about what the tick reports, not
// about Postgres.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Skipped without DATABASE_URL for the repo's usual reason: this test never
// queries Postgres, but `cron.ts` imports `@workspace/db`, which reads
// DATABASE_URL at module evaluation and throws before any test body runs.
const hasDb = !!process.env.DATABASE_URL;
const suite = hasDb ? describe : describe.skip;

const { dispatchPendingWaOutbox } = vi.hoisted(() => ({ dispatchPendingWaOutbox: vi.fn() }));

vi.mock("./WhatsAppOutbox", () => ({ dispatchPendingWaOutbox }));

async function tickAndCapture(summary: Record<string, number>): Promise<string[]> {
  dispatchPendingWaOutbox.mockResolvedValue(summary as never);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const { runWhatsAppOutboxDispatchTick } = await import("../../cron");
    await runWhatsAppOutboxDispatchTick();
    return log.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  } finally {
    log.mockRestore();
  }
}

const PREFIX = "[cron] WhatsApp outbox dispatch:";

beforeEach(() => {
  dispatchPendingWaOutbox.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

suite("runWhatsAppOutboxDispatchTick reports what it did", () => {
  it("logs the tick when the only work was a reclaim (nothing was claimed)", async () => {
    const lines = await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, recovered: 2, conflicts: 0 });
    const line = lines.find((l) => l.includes(PREFIX));
    expect(line, `a reclaim of 2 rows produced no log line (${JSON.stringify(lines)})`).toBeDefined();
    expect(line).toContain("recovered=2");
  });

  it("logs when a delivery was refused because another worker owns the row", async () => {
    const lines = await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, recovered: 0, conflicts: 1 });
    const line = lines.find((l) => l.includes(PREFIX));
    expect(line, `a refused write-back produced no log line (${JSON.stringify(lines)})`).toBeDefined();
    expect(line).toContain("conflicts=1");
  });

  it("logs ordinary claimed work with every counter named", async () => {
    const lines = await tickAndCapture({ claimed: 3, sent: 3, failed: 0, dead: 0, suppressed: 0, recovered: 0, conflicts: 0 });
    const line = lines.find((l) => l.includes(PREFIX));
    expect(line).toBeDefined();
    expect(line).toContain("claimed=3");
    expect(line).toContain("sent=3");
  });

  it("stays quiet on an idle tick", async () => {
    const lines = await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, recovered: 0, conflicts: 0 });
    expect(lines.some((l) => l.includes(PREFIX))).toBe(false);
  });

  it("still drains slowly during clinic peak hours and identifies itself as the in-process worker", async () => {
    const peak = await import("../../lib/clinicPeakHours");
    vi.spyOn(peak, "isClinicPeakHours").mockReturnValue(true);
    await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, recovered: 0, conflicts: 0 });
    expect(dispatchPendingWaOutbox).toHaveBeenCalledWith({ limit: 5, workerId: "in-process-cron" });
  });

  it("keeps the full batch budget outside peak hours", async () => {
    const peak = await import("../../lib/clinicPeakHours");
    vi.spyOn(peak, "isClinicPeakHours").mockReturnValue(false);
    await tickAndCapture({ claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, recovered: 0, conflicts: 0 });
    expect(dispatchPendingWaOutbox).toHaveBeenCalledWith({ limit: 20, workerId: "in-process-cron" });
  });
});
