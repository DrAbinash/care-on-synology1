import { describe, it, expect } from "vitest";
import { diffSentences, diffSummary } from "./sentenceDiff";
import { upsertMeasurement, readMeasurement } from "./measurementVars";
import { computeQualityScore } from "./reportValidator";

// ── Follow-up diff ────────────────────────────────────────────────────────────

describe("diffSentences", () => {
  const prev = "Diffuse disc bulge at L4-L5. Canal narrowing is noted. Facet arthropathy is seen.";
  const curr = "Diffuse disc bulge at L4-L5. Facet arthropathy is seen. New compression fracture of L1 is noted.";

  it("classifies unchanged, added, and removed sentences", () => {
    const d = diffSentences(prev, curr);
    const byText = (t: string) => d.find((l) => l.text.includes(t));
    expect(byText("disc bulge")?.kind).toBe("unchanged");
    expect(byText("compression fracture")?.kind).toBe("added");
    expect(byText("Canal narrowing")?.kind).toBe("removed");
  });

  it("summarizes counts", () => {
    const s = diffSummary(diffSentences(prev, curr));
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.unchanged).toBe(2);
  });

  it("is whitespace/case tolerant for unchanged detection", () => {
    const d = diffSentences("The study is  NORMAL.", "the study is normal.");
    expect(d[0].kind).toBe("unchanged");
  });

  it("handles empty previous (everything added)", () => {
    const d = diffSentences("", "New finding here today.");
    expect(d).toEqual([{ kind: "added", text: "New finding here today." }]);
  });
});

// ── Smart measurements ───────────────────────────────────────────────────────

describe("upsertMeasurement", () => {
  const tpl = "Common bile duct measures {value} mm.";

  it("appends when not present", () => {
    const r = upsertMeasurement("Liver is normal in size.", tpl, "6");
    expect(r.updated).toBe(false);
    expect(r.text).toContain("Common bile duct measures 6 mm.");
  });

  it("updates the value in place when already present", () => {
    const first = upsertMeasurement("", tpl, "6").text;
    const r = upsertMeasurement(first, tpl, "9.5");
    expect(r.updated).toBe(true);
    expect(r.text).toBe("Common bile duct measures 9.5 mm.");
    expect(r.text).not.toContain("6 mm");
  });

  it("updates every occurrence together (linked variable)", () => {
    const text = "Common bile duct measures 6 mm. Repeat: Common bile duct measures 6 mm.";
    const r = upsertMeasurement(text, tpl, "8");
    expect(r.text.match(/8 mm/g)).toHaveLength(2);
    expect(r.text).not.toContain("6 mm");
  });

  it("supports dimensional values like 10 x 12", () => {
    const t2 = "Lesion measures {value} mm.";
    const first = upsertMeasurement("", t2, "10 x 12").text;
    const r = upsertMeasurement(first, t2, "11 x 13");
    expect(r.updated).toBe(true);
    expect(r.text).toBe("Lesion measures 11 x 13 mm.");
  });

  it("readMeasurement extracts current value", () => {
    expect(readMeasurement("Common bile duct measures 7.2 mm.", tpl)).toBe("7.2");
    expect(readMeasurement("No CBD mentioned.", tpl)).toBeNull();
  });

  it("never touches surrounding typed text on update", () => {
    const text = "My own sentence.\nCommon bile duct measures 6 mm.\nAnother typed line.";
    const r = upsertMeasurement(text, tpl, "9");
    expect(r.text).toContain("My own sentence.");
    expect(r.text).toContain("Another typed line.");
    expect(r.text).toContain("9 mm");
  });
});

// ── Quality score ────────────────────────────────────────────────────────────

describe("computeQualityScore", () => {
  it("scores a complete consistent report 100", () => {
    const q = computeQualityScore({
      technique: "T1, T2, FLAIR sequences obtained.",
      clinicalHistory: "Headache.",
      findings: "Diffuse disc bulge is noted at L4-L5 level indenting the thecal sac.",
      impression: ["L4-L5 disc bulge."],
      recommendation: "Clinical correlation advised.",
    });
    expect(q.score).toBe(100);
    expect(q.issues).toEqual([]);
  });

  it("deducts for missing sections with explainable issues", () => {
    const q = computeQualityScore({ findings: "", impression: [""], technique: "", clinicalHistory: "", recommendation: "" });
    expect(q.score).toBeLessThan(50);
    expect(q.issues.some((i) => i.includes("Findings"))).toBe(true);
    expect(q.issues.some((i) => i.includes("Impression"))).toBe(true);
  });

  it("deducts for validator warnings (contradiction)", () => {
    const clean = computeQualityScore({
      technique: "t", clinicalHistory: "h",
      findings: "No significant abnormality detected in this study of the region.",
      impression: ["Normal study."], recommendation: "None.",
    });
    const contradicted = computeQualityScore({
      technique: "t", clinicalHistory: "h",
      findings: "No significant abnormality. A large tumor is noted in the right frontal lobe.",
      impression: ["Normal study."], recommendation: "None.",
    });
    expect(contradicted.score).toBeLessThan(clean.score);
    expect(contradicted.issues.some((i) => i.includes("contradiction"))).toBe(true);
  });

  it("never goes below zero", () => {
    const q = computeQualityScore({
      findings: "{value} {value} tumor infarct hemorrhage fracture. No significant abnormality.",
      impression: ["dup.", "dup."],
    });
    expect(q.score).toBeGreaterThanOrEqual(0);
  });
});
