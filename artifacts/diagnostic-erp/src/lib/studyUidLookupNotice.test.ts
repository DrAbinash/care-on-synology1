import { describe, expect, it } from "vitest";
import { HttpError, NetworkError, RateLimitedError } from "./fetchApi";
import { describeStudyUidLookupFailure, selectLookupNotice } from "./studyUidLookupNotice";

/**
 * The failure this exists for: an HTTP 429 from the ERP was printed as
 * "Orthanc lookup failed", sending a radiologist to go and re-search an archive
 * that was never asked about. Every case below asserts both what must be said
 * and what must not.
 */
describe("describeStudyUidLookupFailure", () => {
  it("names a 429 as the server being busy, and says Orthanc was not asked", () => {
    const n = describeStudyUidLookupFailure(new RateLimitedError("Too many requests. Please slow down.", 60_000));
    expect(n.kind).toBe("rate-limited");
    expect(n.headline).toContain("server is busy");
    expect(n.headline).toContain("Orthanc was not asked");
    expect(n.headline).not.toMatch(/Orthanc lookup failed/i);
    expect(n.detail).toMatch(/untouched/i);
    expect(n.showRetry).toBe(true);
  });

  it("waits the number of seconds the server actually asked for", () => {
    expect(describeStudyUidLookupFailure(new RateLimitedError("busy", 12_000)).waitSeconds).toBe(12);
    expect(describeStudyUidLookupFailure(new RateLimitedError("busy", 300_000)).waitSeconds).toBe(300);
  });

  it("falls back to the published window when the server did not say, never to zero", () => {
    const n = describeStudyUidLookupFailure(new RateLimitedError("busy", null));
    expect(n.waitSeconds).toBe(60);
    // A sub-second Retry-After must not render as "in 0 s".
    expect(describeStudyUidLookupFailure(new RateLimitedError("busy", 200)).waitSeconds).toBe(1);
  });

  it("keeps the Orthanc wording for the one failure that genuinely is Orthanc", () => {
    const n = describeStudyUidLookupFailure(new HttpError("Orthanc connection refused", 502));
    expect(n.kind).toBe("orthanc-unreachable");
    expect(n.headline).toContain("Orthanc lookup failed.");
    // The remedy the old string already carried is still the right one here.
    expect(n.detail).toContain("Search Orthanc archive");
    expect(n.showRetry).toBe(true);
    expect(n.waitSeconds).toBe(null);
  });

  it("does not blame Orthanc for a server it could not reach at all", () => {
    const n = describeStudyUidLookupFailure(new NetworkError("Failed to fetch"));
    expect(n.kind).toBe("lookup-failed");
    expect(n.headline).toContain("reporting server could not be reached");
    expect(n.headline).not.toMatch(/Orthanc/);
  });

  it("treats any other HTTP status as a failed lookup, not an archive outage", () => {
    for (const status of [500, 503, 404, 400]) {
      const n = describeStudyUidLookupFailure(new HttpError("boom", status));
      expect(n.kind).toBe("lookup-failed");
      expect(n.headline).not.toMatch(/Orthanc/);
    }
  });

  it("offers no retry for an auth refusal, where asking again is the same refusal", () => {
    for (const status of [401, 403]) {
      const n = describeStudyUidLookupFailure(new HttpError("Session expired", status));
      expect(n.showRetry).toBe(false);
      expect(n.detail).toMatch(/sign in again/i);
    }
  });

  it("says nothing was deleted whenever images are merely unread", () => {
    for (const e of [new HttpError("boom", 500), new NetworkError("down")]) {
      expect(describeStudyUidLookupFailure(e).detail).toMatch(/Nothing was deleted/i);
    }
  });

  it("never returns a notice with an empty headline or detail", () => {
    const cases = [
      new RateLimitedError("busy", 60_000),
      new HttpError("bad gateway", 502),
      new HttpError("gone", 410),
      new NetworkError("no route"),
      new Error("plain"),
      "a string",
      null,
      undefined,
    ];
    for (const c of cases) {
      const n = describeStudyUidLookupFailure(c);
      expect(n.headline.trim().length, JSON.stringify(String(c))).toBeGreaterThan(0);
      expect(n.detail.trim().length).toBeGreaterThan(0);
      expect(typeof n.showRetry).toBe("boolean");
    }
  });
});

/**
 * `useQuery` does not publish `error` until the retries are spent. With the live
 * limiter's 60-second `Retry-After` and two retries that is about two minutes in
 * which the panel would say "Looking up study in Orthanc archive…" about a
 * request the reporting server refused before running the handler — measured in
 * tmp/p1-stubbed-fixed.log, where sixty seconds of sampling produced no notice
 * and no retry control. So the query hands its refusal over, and this decides
 * which of the two is shown.
 */
describe("selectLookupNotice", () => {
  const busy = describeStudyUidLookupFailure(new RateLimitedError("Too many requests", 60_000));

  it("shows the refusal as soon as the server sent it", () => {
    expect(selectLookupNotice({ canResolve: true, committedError: null, refusal: busy })).toEqual(busy);
  });

  it("prefers the committed error once the retries are spent", () => {
    const n = selectLookupNotice({
      canResolve: true,
      committedError: new HttpError("Bad gateway", 502),
      refusal: busy,
    });
    expect(n?.kind).toBe("orthanc-unreachable");
  });

  it("invents nothing while the first attempt is still in flight", () => {
    expect(selectLookupNotice({ canResolve: true, committedError: null, refusal: null })).toBeNull();
  });

  it("says nothing for a study that never asked", () => {
    expect(selectLookupNotice({ canResolve: false, committedError: null, refusal: busy })).toBeNull();
  });
});
