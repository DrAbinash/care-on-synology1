import { describe, expect, it } from "vitest";
import { isSessionDeadMessage, sanitizeApiErrorMessage } from "./fetchApi";

describe("sanitizeApiErrorMessage", () => {
  it("keeps short JSON API errors", () => {
    expect(sanitizeApiErrorMessage(JSON.stringify({ error: "Draft locked" }), 409, "Conflict")).toBe("Draft locked");
  });

  it("prefers message when error is the opaque Internal server error wrapper", () => {
    const body = JSON.stringify({
      error: "Internal server error",
      message: 'relation "usg_measurements" does not exist',
    });
    expect(sanitizeApiErrorMessage(body, 500, "Internal Server Error")).toBe(
      'relation "usg_measurements" does not exist',
    );
  });

  it("never dumps Cloudflare tunnel HTML into the UI", () => {
    const html = `<!DOCTYPE html><html><body>Tunnel error host is configured as a backend</body></html>`;
    const msg = sanitizeApiErrorMessage(html, 522, "Error");
    expect(msg).not.toMatch(/<!DOCTYPE|Tunnel error host/i);
    expect(msg).toMatch(/522|unreachable|tunnel/i);
  });

  it("truncates long plain-text bodies", () => {
    const long = "x".repeat(400);
    expect(sanitizeApiErrorMessage(long, 500, "Error").endsWith("…")).toBe(true);
  });

  // ── A machine token is not a sentence ─────────────────────────────────────
  //
  // 31 route responses in api-server put an identifier in `error` and the
  // sentence a person should read in a sibling `message` or `detail`. The token
  // is not one of the three generic wrappers, so `error` used to win and the
  // sentence was thrown away. Each case below is a real response body, quoted
  // from the route named in its comment.

  it("returns the sentence, not the token, when a route sends both", () => {
    // POST /api/patient-reports/:id/withdraw-signature — patient-reports.ts:2893
    const body = JSON.stringify({
      error: "not_the_signer",
      message: "Only the signer or an administrator can withdraw this signature.",
    });
    expect(sanitizeApiErrorMessage(body, 403, "Forbidden")).toBe(
      "Only the signer or an administrator can withdraw this signature.",
    );
  });

  it("reads `detail`, which the transaction-internal refusals use instead of `message`", () => {
    // POST /api/patient-reports/:id/amend — patient-reports.ts:1929. The old
    // function never looked at this field at all, so the sentence was
    // unreachable from every caller that did not re-parse the body itself.
    const body = JSON.stringify({ error: "already_amended", detail: "concurrent amendment detected" });
    expect(sanitizeApiErrorMessage(body, 409, "Conflict")).toBe("concurrent amendment detected");
  });

  it("survives an interpolated name — the concurrent-edit refusal", () => {
    // POST /api/radiology/report-generator/save-draft —
    // radiology-report-generator.ts:1682-1687. The one refusal that tells a
    // radiologist their own typing was discarded, and who holds the study.
    const body = JSON.stringify({
      success: false,
      error: "LOCKED_BY_OTHER",
      lockedBy: "Dr Sugandha",
      message:
        "This study is currently being reported by Dr Sugandha. Your text was not saved to the shared draft.",
    });
    const msg = sanitizeApiErrorMessage(body, 409, "Conflict");
    expect(msg).toBe(
      "This study is currently being reported by Dr Sugandha. Your text was not saved to the shared draft.",
    );
    expect(msg).not.toContain("LOCKED_BY_OTHER");
  });

  it("keeps the token when there is nothing readable beside it", () => {
    // 47 token responses have no sibling at all. Falling back to a bare status
    // text there would lose the only string an administrator can grep the
    // server logs for, so the token still wins over `statusText`.
    expect(sanitizeApiErrorMessage(JSON.stringify({ error: "not_found" }), 404, "Not Found")).toBe("not_found");
  });

  it("still lets a sentence in `error` win over a sentence in `message`", () => {
    // Two routes put the sentence in `error` *because* this function returns it
    // verbatim (signedReportContentGuard.ts:302-306, radiology.ts:873-876), and
    // 19 more send a short label in `error` with the detail in `message`. Which
    // of two readable strings should win is a different question, and nine of
    // those 19 are billing routes — so this PR does not reopen it.
    const body = JSON.stringify({ error: "Draft locked", message: "Something more specific" });
    expect(sanitizeApiErrorMessage(body, 409, "Conflict")).toBe("Draft locked");
  });

  it("still passes the session-dead sentences through, because a 401 branches on them", () => {
    // requireStaffAuth.ts:154 answers in `error` with no sibling, and
    // fetchWithRetry feeds this function's return value to isSessionDeadMessage
    // to decide whether to end a stale tab's session. This is the one place
    // where the returned text drives control flow, not just wording.
    const body = JSON.stringify({ error: "Invalid or expired staff session. Please log in again." });
    const msg = sanitizeApiErrorMessage(body, 401, "Unauthorized");
    expect(msg).toBe("Invalid or expired staff session. Please log in again.");
    expect(isSessionDeadMessage(msg)).toBe(true);
  });

  it("does not demote a sentence that merely contains an underscore", () => {
    // The whitespace half of the classifier. No route sends this exact shape,
    // but the existing "prefers message when error is the opaque Internal
    // server error wrapper" case above is the real one: its sentence names
    // `usg_measurements`, and without this guard that sentence is itself
    // mistaken for a token.
    const body = JSON.stringify({
      error: 'column "raw_findings" does not exist',
      message: "Save failed",
    });
    expect(sanitizeApiErrorMessage(body, 500, "Internal Server Error")).toBe(
      'column "raw_findings" does not exist',
    );
  });

  it("does not dump raw JSON when a field is not a string", () => {
    // `(parsed.error || "").trim()` threw a TypeError on a non-string, and the
    // catch returns the raw body — the exact thing this function exists to
    // prevent. `detail` is read now too, so all three go through one guard.
    const body = JSON.stringify({ error: { code: "weird" }, message: "The readable one." });
    expect(sanitizeApiErrorMessage(body, 500, "Internal Server Error")).toBe("The readable one.");
    expect(sanitizeApiErrorMessage(JSON.stringify({ error: 42 }), 500, "Server Error")).toBe("Server Error");
  });
});
