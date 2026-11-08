import { describe, expect, it } from "vitest";
import { failedComposeNotice } from "./jobStatusNotice";

/**
 * U15 regression pins: a FAILED compose job must produce a destructive,
 * retry-directing toast. Before U15 the terminal-status list included FAILED
 * but the toast block sat entirely inside the READY/STALE_READY branch, so a
 * failed compose was silent unless the AI tab happened to be open.
 */
describe("failedComposeNotice (U15: FAILED compose is announced, not silent)", () => {
  it("returns a destructive notice carrying the server's safeError", () => {
    const n = failedComposeNotice({ status: "FAILED", safeError: "model_timeout after 90s" });
    expect(n).not.toBeNull();
    expect(n!.variant).toBe("destructive");
    expect(n!.title).toBe("AI composition failed");
    expect(n!.description).toContain("model_timeout after 90s");
    expect(n!.description).toContain("unchanged");
    expect(n!.description.toLowerCase()).toContain("retry");
  });

  it("still explains the outcome when safeError is null/blank", () => {
    const n = failedComposeNotice({ status: "FAILED", safeError: null });
    expect(n).not.toBeNull();
    expect(n!.description).toContain("unchanged");
    expect(n!.description.toLowerCase()).toContain("retry");
    expect(failedComposeNotice({ status: "FAILED", safeError: "   " })).not.toBeNull();
  });

  it("stays silent for every non-FAILED terminal or active status", () => {
    for (const status of [
      "QUEUED", "COMPOSING", "READY", "STALE_READY", "APPLIED",
      "DISCARDED", "CANCELLED", "OBSOLETE", "NONE",
    ]) {
      expect(failedComposeNotice({ status, safeError: "boom" })).toBeNull();
    }
  });
});
