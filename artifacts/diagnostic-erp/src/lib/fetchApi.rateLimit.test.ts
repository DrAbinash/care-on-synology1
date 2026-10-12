/**
 * A rate limit is a wait, not a failure.
 *
 * The reporting workspace shares a 300-requests-per-minute-per-IP budget
 * (artifacts/api-server/src/middleware/rateLimits.ts:124). Measured against this
 * API on a live socket, a refused request answers:
 *
 *   HTTP 429  retry-after: 60 · ratelimit-reset: 60 · ratelimit-remaining: 0
 *             ratelimit-policy: 300;w=60
 *             body {"error":"Too many requests. Please slow down."}
 *
 * so the server always says how long. Before this, fetchApi retried only network
 * faults and 502/503/504/521-523: a 429 became an HttpError on the spot, the one
 * React Query retry then burned a second request on the same closed window, and
 * the PACS key-image rail rendered "No frozen captures yet" for a study that has
 * images. These tests pin the recovery contract, including the part that must
 * NOT happen — a browser that sleeps for a whole minute inside a click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NetworkError,
  RateLimitedError,
  fetchApi,
  isRateLimited,
  rateAwareRetry,
  rateLimitWaitMs,
} from "@/lib/fetchApi";

type Call = { path: string; at: number };
const calls: Call[] = [];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function installFetch(handler: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      calls.push({ path: String(path), at: Date.now() });
      return handler();
    }),
  );
}

/** A fetch that 429s `times` times and then answers 200. */
function limitedThen(times: number, headers: Record<string, string>) {
  let n = 0;
  return () => {
    if (n++ < times) return json({ error: "Too many requests. Please slow down." }, 429, headers);
    return json({ ok: true, value: "the study" });
  };
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rateLimitWaitMs", () => {
  it("reads the wait the server actually sends, preferring Retry-After", () => {
    const both = new Headers({ "retry-after": "3", "ratelimit-reset": "60" });
    expect(rateLimitWaitMs(both)).toBe(3_000);
    expect(rateLimitWaitMs(new Headers({ "ratelimit-reset": "60" }))).toBe(60_000);
    expect(rateLimitWaitMs(new Headers())).toBeNull();
    // A malformed header must not become NaN and then a negative sleep.
    expect(rateLimitWaitMs(new Headers({ "retry-after": "not-a-number" }))).toBeNull();
  });
});

describe("fetchApi under a rate limit", () => {
  it("waits out a short window and returns the data, once per attempt", async () => {
    installFetch(limitedThen(1, { "retry-after": "0" }));
    const body = await fetchApi<{ ok: boolean; value: string }>("/api/radiology/report-generator/key-images?draftId=1");
    expect(body.value).toBe("the study");
    expect(calls).toHaveLength(2);
  });

  it("does not make the radiologist wait a whole minute inside a click", async () => {
    installFetch(limitedThen(9, { "retry-after": "60" }));
    const started = Date.now();
    const err = await fetchApi("/api/anything").catch((e) => e);
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterMs).toBe(60_000);
    // The point of the throw: it answered immediately and handed the wait over.
    expect(elapsed).toBeLessThan(1_000);
    expect(calls).toHaveLength(1);
  });

  it("stops waiting after two short windows instead of hammering the limiter", async () => {
    installFetch(limitedThen(9, { "retry-after": "0" }));
    const err = await fetchApi("/api/anything").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    // 1 first try + RATE_LIMIT_AUTO_WAITS(2) paced retries.
    expect(calls).toHaveLength(3);
  });

  it("keeps the message the server wrote for a person, and the status for the code", async () => {
    installFetch(limitedThen(9, { "retry-after": "60" }));
    const err = await fetchApi("/api/anything").catch((e) => e);
    expect(err.message).toBe("Too many requests. Please slow down.");
    expect(err.status).toBe(429);
    expect(isRateLimited(err)).toBe(true);
  });

  it("a rate limit is not a dead session and not an unreachable server", async () => {
    installFetch(limitedThen(9, { "retry-after": "60" }));
    const err = await fetchApi("/api/anything").catch((e) => e);
    // Either of these would log the radiologist out or start the offline queue.
    expect(err).not.toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(TypeError);
  });

  it("recovers completely when the window closes mid-request", async () => {
    installFetch(limitedThen(2, { "retry-after": "0" }));
    const body = await fetchApi<{ ok: boolean }>("/api/anything");
    expect(body.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("leaves every other 4xx exactly as it was: one request, no retry", async () => {
    installFetch(() => json({ error: "not_the_signer", message: "This report is signed by someone else." }, 409));
    const err = await fetchApi("/api/anything").catch((e) => e);
    expect(err.status).toBe(409);
    expect(isRateLimited(err)).toBe(false);
    expect(err.message).toBe("This report is signed by someone else.");
    expect(calls).toHaveLength(1);
  });
});

describe("rateAwareRetry (the React Query policy the rails use)", () => {
  const limited = new RateLimitedError("Too many requests. Please slow down.", 60_000);
  const other = Object.assign(new Error("nope"), { status: 500 });

  it("gives a rate-limited read three chances and waits the server's window", () => {
    expect(rateAwareRetry.retry(0, limited)).toBe(true);
    expect(rateAwareRetry.retry(1, limited)).toBe(true);
    expect(rateAwareRetry.retry(2, limited)).toBe(false);
    expect(rateAwareRetry.retryDelay(0, limited)).toBe(60_000);
  });

  it("caps a long window at the limiter's own minute, never an upload window", () => {
    expect(rateAwareRetry.retryDelay(0, new RateLimitedError("x", 600_000))).toBe(60_000);
    expect(rateAwareRetry.retryDelay(0, new RateLimitedError("x", null))).toBe(30_000);
  });

  it("keeps the app-wide single retry for anything that is not a rate limit", () => {
    expect(rateAwareRetry.retry(0, other)).toBe(true);
    expect(rateAwareRetry.retry(1, other)).toBe(false);
    expect(rateAwareRetry.retryDelay(0, other)).toBeUndefined();
  });
});
