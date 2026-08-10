import { describe, expect, test } from "vitest";
import { canonicalizeModalityFilter, radiologyOpenFallbackPath } from "./resolveRadiologyOpenShared";

describe("canonicalizeModalityFilter", () => {
  test("maps MRI aliases to MR", () => {
    expect(canonicalizeModalityFilter("MRI")).toBe("MR");
    expect(canonicalizeModalityFilter("mr")).toBe("MR");
    expect(canonicalizeModalityFilter("Magnetic Resonance")).toBe("MR");
  });

  test("maps ultrasound aliases to US", () => {
    expect(canonicalizeModalityFilter("USG")).toBe("US");
    expect(canonicalizeModalityFilter("Doppler")).toBe("US");
  });

  test("returns null for empty", () => {
    expect(canonicalizeModalityFilter("")).toBeNull();
    expect(canonicalizeModalityFilter(null)).toBeNull();
  });
});

describe("radiologyOpenFallbackPath", () => {
  test("builds modality + patient search query", () => {
    expect(radiologyOpenFallbackPath({ modality: "MRI", patientName: "Ravi Kumar" }))
      .toBe("/radiology/worklist?modality=MR&q=Ravi+Kumar");
  });

  test("bare worklist when nothing given", () => {
    expect(radiologyOpenFallbackPath({})).toBe("/radiology/worklist");
  });
});
