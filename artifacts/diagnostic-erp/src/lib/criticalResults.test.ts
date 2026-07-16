import { describe, it, expect } from "vitest";
import { detectCriticalFindings, CRITICAL_TERMS } from "./criticalResults";

describe("detectCriticalFindings (MRI PR 3 — Critical Results)", () => {
  it("detects a critical finding described in the Findings", () => {
    const hits = detectCriticalFindings("Restricted diffusion in the left MCA territory in keeping with an acute infarct.", []);
    expect(hits.map((h) => h.label)).toContain("acute infarct");
  });

  it("detects a critical finding described only in the Impression", () => {
    const hits = detectCriticalFindings("", ["Cord compression at C5-C6 with myelomalacia."]);
    expect(hits.map((h) => h.label)).toEqual(expect.arrayContaining(["cord compression", "myelomalacia"]));
  });

  it("ignores a clearly negated finding", () => {
    const hits = detectCriticalFindings("No acute infarct. No intracranial haemorrhage.", []);
    expect(hits).toEqual([]);
  });

  it("still flags a present finding alongside negated ones", () => {
    const hits = detectCriticalFindings("No acute infarct. There is cord compression at C4-C5.", []);
    const labels = hits.map((h) => h.label);
    expect(labels).toContain("cord compression");
    expect(labels).not.toContain("acute infarct");
  });

  it("de-duplicates British/American spellings to a single label", () => {
    const hits = detectCriticalFindings("Acute haemorrhage and further acute hemorrhage noted.", []);
    expect(hits.filter((h) => h.label === "acute haemorrhage")).toHaveLength(1);
  });

  it("uses the per-study watch list in addition to the built-in table", () => {
    const hits = detectCriticalFindings("Sella shows a pituitary adenoma with optic chiasma compression.", [], [
      "pituitary adenoma", "optic chiasma compression",
    ]);
    expect(hits.map((h) => h.label)).toEqual(expect.arrayContaining(["pituitary adenoma", "optic chiasma compression"]));
  });

  it("does not flag a specific term from a non-critical near-match", () => {
    // "disc herniation" must NOT match the critical "…herniation" entries,
    // which are all specific (tonsillar/uncal/transtentorial).
    const hits = detectCriticalFindings("Broad-based disc herniation at L4-L5 without canal stenosis.", []);
    expect(hits).toEqual([]);
  });

  it("returns nothing for an empty report", () => {
    expect(detectCriticalFindings("", [])).toEqual([]);
    expect(detectCriticalFindings("   ", [""])).toEqual([]);
  });

  it("every curated term carries a non-empty label", () => {
    for (const t of CRITICAL_TERMS) {
      expect(t.term.length).toBeGreaterThan(2);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});
