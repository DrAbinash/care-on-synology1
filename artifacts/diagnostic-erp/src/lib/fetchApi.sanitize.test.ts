import { describe, expect, it } from "vitest";
import { sanitizeApiErrorMessage } from "./fetchApi";

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

  it("shows the instruction, not the code, when the server says the failure is retryable", () => {
    const body = JSON.stringify({
      error: "ai_review_state_unavailable",
      message:
        "CARE could not check whether this study still has unreviewed AI suggestions, so the report was NOT finalized and nothing was changed. Please try again in a moment.",
      retryable: true,
    });
    const msg = sanitizeApiErrorMessage(body, 503, "Service Unavailable");
    expect(msg).toMatch(/NOT finalized/i);
    expect(msg).toMatch(/try again/i);
    expect(msg).not.toMatch(/ai_review_state_unavailable/);
  });

  it("is opt-in: a coded 4xx still surfaces its code, unchanged", () => {
    const body = JSON.stringify({
      error: "unreviewed_ai_compose_changes",
      message: "2 AI suggestion(s) for this study are still unreviewed.",
    });
    expect(sanitizeApiErrorMessage(body, 409, "Conflict")).toBe("unreviewed_ai_compose_changes");
  });
});
