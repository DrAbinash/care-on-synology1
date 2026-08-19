import { describe, it, expect } from "vitest";
import {
  computeBackoffMs, decideFailure, isStaleRunning, decideDeadLetterRetry,
  CLAIMABLE_STATUSES, DEAD_LETTER_STATUS,
} from "./radiologyJobRules";

// Ticket BEND-1 Phase 3 — durable job transition rules, pure.

const NOW = new Date("2026-07-11T10:00:00Z");

describe("bounded retries with backoff", () => {
  it("backoff grows exponentially and is hard-capped (no tight loops, no runaway waits)", () => {
    expect(computeBackoffMs(1)).toBe(2 * 60_000);
    expect(computeBackoffMs(2)).toBe(4 * 60_000);
    expect(computeBackoffMs(6)).toBe(64 * 60_000);
    expect(computeBackoffMs(50)).toBe(64 * 60_000); // capped
  });

  it("failures retry until maxRetries, then dead-letter — NEVER infinite", () => {
    const first = decideFailure({ retryCount: 0, maxRetries: 3, now: NOW });
    expect(first).toEqual({ status: "retrying", retryCount: 1, nextRetryAt: new Date(NOW.getTime() + computeBackoffMs(1)) });
    const second = decideFailure({ retryCount: 1, maxRetries: 3, now: NOW });
    expect(second.status).toBe("retrying");
    const final = decideFailure({ retryCount: 2, maxRetries: 3, now: NOW });
    expect(final).toEqual({ status: "abandoned", retryCount: 3, nextRetryAt: null });
    expect(final.status).toBe(DEAD_LETTER_STATUS);
  });

  it("no-DICOM retries longer while images may still be transferring to Orthanc", () => {
    const err = "no DICOM instances found for study (not yet arrived / not stable)";
    let retryCount = 0;
    let status = "retrying";
    while (status === "retrying" && retryCount < 10) {
      const next = decideFailure({ retryCount, maxRetries: 5, now: NOW, error: err });
      status = next.status;
      retryCount = next.retryCount;
    }
    expect(retryCount).toBe(5);
    expect(status).toBe("abandoned");
    const badPayload = decideFailure({
      retryCount: 0, maxRetries: 5, now: NOW,
      error: "invalid payload: studyInstanceUid required",
    });
    expect(badPayload.status).toBe("abandoned");
  });
});

describe("worker-restart safety", () => {
  it("running jobs with stale (or missing) locks are requeued; fresh locks are not", () => {
    expect(isStaleRunning({ status: "running", lockedAt: new Date(NOW.getTime() - 11 * 60_000), now: NOW })).toBe(true);
    expect(isStaleRunning({ status: "running", lockedAt: new Date(NOW.getTime() - 60_000), now: NOW })).toBe(false);
    expect(isStaleRunning({ status: "running", lockedAt: null, now: NOW })).toBe(true); // corrupt claim
    expect(isStaleRunning({ status: "pending", lockedAt: null, now: NOW })).toBe(false);
    expect(isStaleRunning({ status: "success", lockedAt: new Date(0), now: NOW })).toBe(false);
  });
});

describe("claim + dead-letter rules", () => {
  it("only pending/retrying are claimable — success/abandoned/running never re-run", () => {
    expect([...CLAIMABLE_STATUSES].sort()).toEqual(["pending", "retrying"]);
  });

  it("manual dead-letter retry: abandoned/failed → retrying due now; others refused", () => {
    expect(decideDeadLetterRetry("abandoned", NOW)).toEqual({ status: "retrying", nextRetryAt: NOW });
    expect(decideDeadLetterRetry("failed", NOW)).toEqual({ status: "retrying", nextRetryAt: NOW });
    expect(decideDeadLetterRetry("running", NOW)).toBeNull();
    expect(decideDeadLetterRetry("success", NOW)).toBeNull();
    expect(decideDeadLetterRetry("pending", NOW)).toBeNull();
  });
});
