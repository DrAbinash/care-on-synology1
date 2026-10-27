/**
 * A 5xx from this API is an ANSWER, and the answer has to survive.
 *
 * Two sentences the server wrote for the radiologist are currently lost on the way to
 * the screen, and what replaces them is a claim about the server being down:
 *
 *   • `POST /api/patient-reports` refuses with **503**
 *     `{error:"ai_review_state_unavailable", message:"…the report was NOT finalized and
 *     nothing was changed…", retryable:true}` (reportComposer/unreviewedAiGuard.ts:188-198).
 *   • `POST /api/radiology/pacs-worklist/:id/resolve-study-uid` answers **502** with
 *     Orthanc's own error (routes/radiology.ts:1025). Measured in the browser against a
 *     rig whose archive is not configured: the toast that came up was
 *     "The reporting server could not be reached." — the reporting server had just
 *     answered, twice, and the archive was the thing that had failed.
 *
 * `fetchApi` retries gateway statuses and then, at fetchApi.ts:437-440, throws away the
 * body it had already read and sanitised and raises a bare `NetworkError`. Everything
 * downstream — the finalize toast, the viewer's lookup notice — then reads "unreachable".
 * These tests run the REAL transport (a stubbed `fetch`, the real retry loop, the real
 * classifier) rather than hand-built error objects, because the hand-built ones are what
 * hid this: studyUidLookupNotice.test.ts asserts its 502 branch against
 * `new HttpError(..., 502)`, a shape fetchApi never produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError, fetchApi } from "@/lib/fetchApi";
import { describeStudyUidLookupFailure } from "@/lib/studyUidLookupNotice";

// This suite runs under vitest's node environment (vitest.config.ts:22), where the
// browser globals fetchApi consults between retries do not exist. `onLine: true` is the
// one it needs: a network-level failure only waits for connectivity when the browser
// claims there is none (fetchApi.ts:360), and nothing here is about connectivity.
beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
});

const AI_GUARD_503 = {
  error: "ai_review_state_unavailable",
  message:
    "CARE could not check whether this study still has unreviewed AI suggestions, so the report was " +
    "NOT finalized and nothing was changed. Please try again in a moment. If it keeps failing, " +
    "finalize after the AI suggestions have been reviewed, or ask the admin to check the database.",
  retryable: true,
};
const ORTHANC_502 = { error: "ORTHANC_URL not configured", studyInstanceUID: null };

function answerWith(status: number, body: unknown) {
  let n = 0;
  return () => {
    n++;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("an answered 5xx keeps what it said", () => {
  it("does not report the reporting server as unreachable when it answered 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answerWith(503, AI_GUARD_503)()),
    );
    const err = await fetchApi("/api/patient-reports").catch((e) => e);

    // The class stays NetworkError on purpose: callers classify on it — the offline
    // billing queue, and `isUnansweredWrite` in the finalize lifecycle, which must keep
    // treating a gateway status as an outcome it cannot prove.
    expect(err).toBeInstanceOf(NetworkError);
    // What was missing: the fact that a server answered, and which status it answered with.
    expect((err as NetworkError & { answeredStatus?: number | null }).answeredStatus).toBe(503);
    // And the sentence the server wrote for this person, which is the only part that
    // tells him his report was not touched.
    expect(err.message).toContain("NOT finalized and nothing was changed");
  });

  it("names the archive for a 502 the reporting server itself returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answerWith(502, ORTHANC_502)()),
    );
    const err = await fetchApi("/api/radiology/pacs-worklist/5/resolve-study-uid").catch((e) => e);
    const notice = describeStudyUidLookupFailure(err);

    // Before this test existed, the transport gave the notice a NetworkError with no
    // status on it, so its 502 branch could never fire and the radiologist was sent to
    // look for the NAS instead of for Orthanc.
    expect(notice.kind).toBe("orthanc-unreachable");
    expect(notice.headline).toContain("Orthanc lookup failed.");
    expect(notice.headline).not.toMatch(/could not be reached/i);
    expect(notice.detail).toContain("Search Orthanc archive");
  });

  it("still says unreachable when nothing answered at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await fetchApi("/api/anything").catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError & { answeredStatus?: number | null }).answeredStatus).toBeNull();
    const notice = describeStudyUidLookupFailure(err);
    expect(notice.headline).toContain("reporting server could not be reached");
    expect(notice.headline).not.toMatch(/Orthanc/);
  });

  it("keeps the gateway phrase that the retry classifier reads", async () => {
    // reliability.ts:isTransientError and fetchApi's own retry decision both match on
    // "server temporarily unavailable" / the 5xx digits. Prefixing the server's sentence
    // must not break that — a 503 is still worth retrying, it just must not be a lie.
    vi.stubGlobal("fetch", vi.fn(async () => answerWith(502, ORTHANC_502)()));
    const err = await fetchApi("/api/anything").catch((e) => e);
    expect(String(err.message).toLowerCase()).toContain("server temporarily unavailable (502)");
  });
});
