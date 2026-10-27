/**
 * What the embedded viewer says when it could not resolve a StudyInstanceUID.
 *
 * A rate limit and an Orthanc outage look identical to a query — `isError` is
 * true for both — and mean opposite things to the radiologist holding the mouse.
 * Measured against the running API rather than assumed:
 *
 *   * a genuine Orthanc failure comes back from
 *     `POST /api/radiology/pacs-worklist/:id/resolve-study-uid` as **HTTP 502**
 *     carrying Orthanc's own error (artifacts/api-server/src/routes/radiology.ts:970).
 *     The handler ran, asked the archive, and the archive did not answer.
 *   * a rate limit is **HTTP 429** from `express-rate-limit`
 *     (artifacts/api-server/src/middleware/rateLimits.ts:124). The handler never
 *     runs, so Orthanc was never asked about.
 *
 * Before this existed the second was printed as the first — "Orthanc lookup
 * failed" — while the only PACS control on the screen had also disappeared, so a
 * busy server read as a missing study.
 */
import { HttpError, NetworkError, isRateLimited } from "./fetchApi";

/** The general limiter's published window, used only when the server did not say. */
const DEFAULT_WAIT_MS = 60_000;

export type StudyUidLookupNotice = {
  kind: "rate-limited" | "orthanc-unreachable" | "lookup-failed";
  headline: string;
  detail: string;
  /**
   * Whether a retry button is offered. Refused for an auth failure, where
   * asking again is the same refusal — the radiologist needs to sign in again,
   * not to press the button until the rate limit clears.
   */
  showRetry: boolean;
  /** Seconds the server asked us to wait, when it said. Null when it did not. */
  waitSeconds: number | null;
};

export function describeStudyUidLookupFailure(err: unknown): StudyUidLookupNotice {
  if (isRateLimited(err)) {
    const ms = err.retryAfterMs ?? DEFAULT_WAIT_MS;
    return {
      kind: "rate-limited",
      headline: "The reporting server is busy. Orthanc was not asked.",
      detail:
        "This report and its images are untouched — the server refused the lookup and asked to be asked again later.",
      showRetry: true,
      waitSeconds: Math.max(1, Math.round(ms / 1000)),
    };
  }

  if (err instanceof HttpError && err.status === 502) {
    return {
      kind: "orthanc-unreachable",
      headline: "Orthanc lookup failed.",
      detail: "Try Search Orthanc archive on the worklist with the scan date.",
      showRetry: true,
      waitSeconds: null,
    };
  }

  const status = err instanceof HttpError ? err.status : null;
  const refusedForAccess = status === 401 || status === 403;
  return {
    kind: "lookup-failed",
    headline:
      err instanceof NetworkError
        ? "The reporting server could not be reached."
        : "The study lookup failed.",
    detail: refusedForAccess
      ? "You are not signed in for this study. Sign in again rather than retrying."
      : "Nothing was deleted. Retry below, or reopen the study.",
    showRetry: !refusedForAccess,
    waitSeconds: null,
  };
}

/**
 * Which words to show for a lookup that has not produced an identifier.
 *
 * `useQuery` commits `error` only after the rate-aware retries are spent — with
 * the live limiter's 60-second `Retry-After`, two minutes after the first
 * refusal. The refusal is known the moment its response comes back, so the
 * query hands it over here; without that, the panel spends those two minutes on
 * "Looking up study in Orthanc archive…", naming the archive for a request the
 * reporting server never let through. Measured in
 * tmp/p1-stubbed-fixed.log: sixty seconds of that label, no notice, no retry
 * control, before the honest message appeared at all.
 */
export function selectLookupNotice(opts: {
  canResolve: boolean;
  committedError?: unknown;
  refusal: StudyUidLookupNotice | null;
}): StudyUidLookupNotice | null {
  if (!opts.canResolve) return null;
  if (opts.committedError) return describeStudyUidLookupFailure(opts.committedError);
  return opts.refusal;
}
