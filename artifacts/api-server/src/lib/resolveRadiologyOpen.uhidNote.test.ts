import { describe, expect, it } from "vitest";
import { canonicalizeModalityFilter } from "./resolveRadiologyOpenShared";

describe("canonicalizeModalityFilter", () => {
  it("maps MRI/CT aliases", () => {
    expect(canonicalizeModalityFilter("MRI")).toBe("MR");
    expect(canonicalizeModalityFilter("CT")).toBe("CT");
    expect(canonicalizeModalityFilter("computed tomography")).toBe("CT");
  });
});
