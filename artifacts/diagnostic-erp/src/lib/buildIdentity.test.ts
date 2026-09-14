import { describe, expect, it } from "vitest";
import {
  buildsMismatch,
  getFrontendBuildCommit,
  normalizeBuildCommit,
} from "./buildIdentity";

describe("normalizeBuildCommit", () => {
  it("falls back to unknown for empty / placeholder values", () => {
    expect(normalizeBuildCommit(undefined)).toBe("unknown");
    expect(normalizeBuildCommit("")).toBe("unknown");
    expect(normalizeBuildCommit("unknown")).toBe("unknown");
    expect(normalizeBuildCommit("  UNKNOWN  ")).toBe("unknown");
  });

  it("shortens a full SHA to 12 characters", () => {
    expect(normalizeBuildCommit("0616667905b583dc6e4dca0c6ce7ffeef9d86615")).toBe(
      "0616667905b5",
    );
  });

  it("does not invent commits and strips quotes", () => {
    expect(normalizeBuildCommit('"abc123def456"')).toBe("abc123def456");
  });
});

describe("getFrontendBuildCommit", () => {
  it("returns a safe string (never throws; unknown when unset in test)", () => {
    const commit = getFrontendBuildCommit();
    expect(typeof commit).toBe("string");
    expect(commit.length).toBeGreaterThan(0);
    // Vitest may or may not inject VITE_GIT_COMMIT; either is fine.
    expect(commit === "unknown" || /^[0-9a-f]{7,12}$/i.test(commit)).toBe(true);
  });
});

describe("buildsMismatch", () => {
  it("is false when either side is unknown", () => {
    expect(buildsMismatch("unknown", "0616667905b5")).toBe(false);
    expect(buildsMismatch("0616667905b5", "unknown")).toBe(false);
    expect(buildsMismatch("unknown", "unknown")).toBe(false);
  });

  it("is true only when both known commits disagree", () => {
    expect(buildsMismatch("0616667905b5", "0616667905b5")).toBe(false);
    expect(buildsMismatch("0616667905b5", "f6b80302aaaa")).toBe(true);
  });
});
