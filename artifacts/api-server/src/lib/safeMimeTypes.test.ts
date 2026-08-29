import { describe, expect, it } from "vitest";
import { SAFE_MIME_TYPES } from "@workspace/db/schema";

describe("SAFE_MIME_TYPES", () => {
  it("rejects SVG (stored XSS vector when CSP is disabled)", () => {
    expect(SAFE_MIME_TYPES.has("image/svg+xml")).toBe(false);
  });

  it("still allows common clinical image and document types", () => {
    expect(SAFE_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(SAFE_MIME_TYPES.has("image/png")).toBe(true);
    expect(SAFE_MIME_TYPES.has("application/pdf")).toBe(true);
  });
});
