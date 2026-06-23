import { describe, it, expect, vi, beforeEach } from "vitest";
import { AbortError } from "p-retry";
import {
  isRateLimitError,
  batchProcess,
  batchProcessWithSSE,
} from "./utils.js";

// ---------------------------------------------------------------------------
// isRateLimitError
// ---------------------------------------------------------------------------
describe("isRateLimitError", () => {
  it("returns true for errors containing '429'", () => {
    expect(isRateLimitError(new Error("HTTP 429 Too Many Requests"))).toBe(
      true
    );
  });

  it("returns true for errors containing 'RATELIMIT_EXCEEDED'", () => {
    expect(isRateLimitError(new Error("RATELIMIT_EXCEEDED"))).toBe(true);
  });

  it("returns true for errors containing 'quota' (case-insensitive)", () => {
    expect(isRateLimitError(new Error("Quota exceeded for this API"))).toBe(
      true
    );
    expect(isRateLimitError(new Error("QUOTA_EXCEEDED"))).toBe(true);
  });

  it("returns true for errors containing 'rate limit' (case-insensitive)", () => {
    expect(isRateLimitError(new Error("rate limit reached"))).toBe(true);
    expect(isRateLimitError(new Error("Rate Limit Exceeded"))).toBe(true);
  });

  it("returns false for generic non-rate-limit errors", () => {
    expect(isRateLimitError(new Error("Internal Server Error"))).toBe(false);
    expect(isRateLimitError(new Error("Network timeout"))).toBe(false);
  });

  it("handles non-Error values by coercing to string", () => {
    expect(isRateLimitError("429 error")).toBe(true);
    expect(isRateLimitError("something went wrong")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// batchProcess
// ---------------------------------------------------------------------------
describe("batchProcess", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves all items successfully", async () => {
    const items = [1, 2, 3];
    const processor = vi.fn(async (n: number) => n * 2);

    const results = await batchProcess(items, processor, {
      concurrency: 3,
      retries: 0,
    });

    expect(results).toEqual([2, 4, 6]);
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it("retries on rate-limit errors and eventually resolves", async () => {
    const calls: number[] = [];
    const processor = vi.fn(async () => {
      calls.push(1);
      if (calls.length < 3) {
        throw new Error("429 Too Many Requests");
      }
      return "ok";
    });

    const results = await batchProcess(["item"], processor, {
      retries: 5,
      minTimeout: 0,
      maxTimeout: 1,
    });

    expect(results).toEqual(["ok"]);
    expect(calls.length).toBe(3);
  });

  it("aborts immediately on non-retriable (non-rate-limit) errors", async () => {
    const processor = vi.fn(async () => {
      throw new Error("Internal Server Error");
    });

    await expect(
      batchProcess(["item"], processor, { retries: 5, minTimeout: 0 })
    ).rejects.toThrow("Internal Server Error");

    // Should have been called exactly once — no retries for non-rate-limit errors
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it("respects the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const concurrency = 2;
    const items = [1, 2, 3, 4, 5];

    const processor = vi.fn(async (n: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return n;
    });

    await batchProcess(items, processor, { concurrency, retries: 0 });

    expect(maxInFlight).toBeLessThanOrEqual(concurrency);
  });

  it("calls onProgress with correct completed/total counts", async () => {
    const progress: Array<{ completed: number; total: number }> = [];
    const items = ["a", "b", "c"];

    await batchProcess(
      items,
      async (item) => item.toUpperCase(),
      {
        concurrency: 1,
        retries: 0,
        onProgress: (completed, total) => progress.push({ completed, total }),
      }
    );

    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({ completed: 1, total: 3 });
    expect(progress[2]).toEqual({ completed: 3, total: 3 });
  });

  it("throws after exhausting retries on repeated rate-limit errors", async () => {
    const processor = vi.fn(async () => {
      throw new Error("429 rate limit");
    });

    await expect(
      batchProcess(["item"], processor, {
        retries: 2,
        minTimeout: 0,
        maxTimeout: 1,
      })
    ).rejects.toThrow();

    // Called once for the initial attempt + 2 retries = 3 total
    expect(processor).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// batchProcessWithSSE
// ---------------------------------------------------------------------------
describe("batchProcessWithSSE", () => {
  it("emits started, processing, progress, and complete events for successful items", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const sendEvent = vi.fn((e) => events.push(e));
    const items = ["x", "y"];

    const results = await batchProcessWithSSE(
      items,
      async (item) => item.toUpperCase(),
      sendEvent,
      { retries: 0 }
    );

    expect(results).toEqual(["X", "Y"]);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("started");
    expect(types).toContain("processing");
    expect(types).toContain("progress");
    expect(types[types.length - 1]).toBe("complete");

    const startedEvent = events.find((e) => e.type === "started");
    expect(startedEvent?.total).toBe(2);

    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent?.processed).toBe(2);
    expect(completeEvent?.errors).toBe(0);
  });

  it("reads context.error in onFailedAttempt (p-retry v7 contract)", async () => {
    // This test verifies the fix for the silent bug: in p-retry v7 the
    // onFailedAttempt callback receives a RetryContext object, not the raw
    // Error.  If we accidentally read `context.message` instead of
    // `context.error` then isRateLimitError would never match and every
    // error would be treated as non-retriable, aborting on the first failure.
    let calls = 0;
    const processor = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        // Rate-limit error — should be retried, not aborted
        throw new Error("429 Too Many Requests");
      }
      return "recovered";
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const results = await batchProcessWithSSE(
      ["item"],
      processor,
      (e) => events.push(e),
      { retries: 5, minTimeout: 0, maxTimeout: 1 }
    );

    // If context.error is read correctly, rate-limit errors are retried and
    // the processor eventually succeeds.
    expect(results).toEqual(["recovered"]);
    expect(calls).toBe(3);
  });

  it("aborts immediately on non-rate-limit errors (via AbortError in onFailedAttempt)", async () => {
    const processor = vi.fn(async () => {
      throw new Error("Unexpected server error");
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const results = await batchProcessWithSSE(
      ["item"],
      processor,
      (e) => events.push(e),
      { retries: 5, minTimeout: 0 }
    );

    // Non-retriable: processor must be called exactly once
    expect(processor).toHaveBeenCalledTimes(1);

    // The item slot in results is undefined (partial result)
    expect(results).toHaveLength(1);
    expect(results[0]).toBeUndefined();

    // A progress event with an error field must be emitted
    const progressEvent = events.find(
      (e) => e.type === "progress" && "error" in e
    );
    expect(progressEvent).toBeDefined();
    expect(typeof progressEvent?.error).toBe("string");

    // complete event must reflect the error count
    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent?.errors).toBe(1);
  });

  it("continues processing subsequent items after a partial failure", async () => {
    const processor = vi.fn(async (item: string) => {
      if (item === "bad") throw new Error("bad item");
      return item.toUpperCase();
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const results = await batchProcessWithSSE(
      ["good", "bad", "also-good"],
      processor,
      (e) => events.push(e),
      { retries: 0 }
    );

    expect(results[0]).toBe("GOOD");
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe("ALSO-GOOD");

    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent?.errors).toBe(1);
    expect(completeEvent?.processed).toBe(3);
  });
});
