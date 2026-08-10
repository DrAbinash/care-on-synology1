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
});
