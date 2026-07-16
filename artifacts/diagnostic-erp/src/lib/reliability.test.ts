import { describe, it, expect } from "vitest";
import { backoffDelays, isTransientError, retryWithBackoff, offlineBlockMessage } from "./reliability";

const noSleep = () => Promise.resolve();

describe("backoffDelays", () => {
  it("produces an exponential sequence capped at maxMs", () => {
    expect(backoffDelays(3, 300, 2, 4000)).toEqual([300, 600, 1200]);
    expect(backoffDelays(4, 1000, 3, 4000)).toEqual([1000, 3000, 4000, 4000]);
    expect(backoffDelays(0)).toEqual([]);
  });
});

describe("isTransientError (default-deny)", () => {
  it("retries clearly-transient transport failures", () => {
    for (const m of ["Failed to fetch", "NetworkError when attempting", "request timeout", "ECONNRESET", "502 Bad Gateway", "503 Service Unavailable", "load failed"]) {
      expect(isTransientError(new Error(m)), m).toBe(true);
    }
  });
  it("does NOT retry validation / auth / conflict / unknown errors", () => {
    for (const m of ["400 Bad Request", "401 Unauthorized", "409 conflict: lock held", "Validation failed: findings empty", "boom"]) {
      expect(isTransientError(new Error(m)), m).toBe(false);
    }
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("returns immediately on first success (no retries)", async () => {
    let calls = 0;
    const r = await retryWithBackoff(async () => { calls++; return "ok"; }, { sleep: noSleep });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let calls = 0;
    const r = await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) throw new Error("Failed to fetch");
      return "recovered";
    }, { retries: 3, sleep: noSleep });
    expect(r).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("gives up after exhausting retries and re-throws the last error", async () => {
    let calls = 0;
    await expect(retryWithBackoff(async () => { calls++; throw new Error("network error"); }, { retries: 2, sleep: noSleep }))
      .rejects.toThrow("network error");
    expect(calls).toBe(3); // 1 + 2 retries
  });

  it("does NOT retry a non-transient error — fails fast on the first attempt", async () => {
    let calls = 0;
    await expect(retryWithBackoff(async () => { calls++; throw new Error("401 Unauthorized"); }, { retries: 3, sleep: noSleep }))
      .rejects.toThrow("401");
    expect(calls).toBe(1);
  });

  it("waits for the computed backoff delays between attempts", async () => {
    const waited: number[] = [];
    let calls = 0;
    await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) throw new Error("timeout");
      return 1;
    }, { retries: 3, baseDelayMs: 100, factor: 2, sleep: async (ms) => { waited.push(ms); } });
    expect(waited).toEqual([100, 200]);
  });
});

describe("offlineBlockMessage", () => {
  it("returns null when online (proceed)", () => {
    expect(offlineBlockMessage(true, "save")).toBeNull();
    expect(offlineBlockMessage(true, "finalize")).toBeNull();
  });
  it("returns a reassuring, action-specific message when offline", () => {
    expect(offlineBlockMessage(false, "save")).toMatch(/offline/i);
    expect(offlineBlockMessage(false, "save")).toMatch(/preserved locally/i);
    expect(offlineBlockMessage(false, "finalize")).toMatch(/before finalizing/i);
  });
});
