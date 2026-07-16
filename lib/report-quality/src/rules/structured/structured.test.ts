import { describe, it, expect } from "vitest";
import { createStructuredEngine, STRUCTURED_RULE_DEFINITIONS } from "./index";
import { ALL_FIXTURES, ctBrainFixture } from "./fixtures";
import { runQualityEngine } from "../../runner";

const engine = createStructuredEngine();
const ids = (report: { findings: { ruleId: string }[] }) => report.findings.map((f) => f.ruleId);
const has = (report: { findings: { ruleId: string }[] }, suffix: string) => ids(report).some((id) => id.endsWith(suffix));

describe("structured tier — shadow safety", () => {
  it("every Phase-3 rule is deterministic, versioned, and NOT blocking-eligible", () => {
    for (const d of STRUCTURED_RULE_DEFINITIONS) {
      expect(d.tier).toBe("structured");
      expect(d.blockingEligibility).toBe(false);
      expect(d.owner).toBe("care-core");
      expect(d.version).toBe("3.0.0");
      expect(d.canonicalId).toMatch(/^care\.structured\./);
      expect(d.provenance?.source).toBeTruthy();
    }
  });

  it("structured rules are NOT on the global default engine (badge path is untouched)", () => {
    // runQualityEngine uses the default engine (text tier only). Even given a
    // context full of structured data, it must emit no structured findings.
    const report = runQualityEngine(ctBrainFixture);
    expect(report.findings.every((f) => !f.ruleId.startsWith("care.structured."))).toBe(true);
  });

  it("all structured findings are tier=structured", () => {
    for (const ctx of Object.values(ALL_FIXTURES)) {
      const r = engine.evaluate(ctx);
      expect(r.findings.every((f) => f.tier === "structured")).toBe(true);
      expect(r.deterministicRuleCount).toBe(r.evaluatedRuleCount);
      expect(r.heuristicRuleCount).toBe(0);
    }
  });
});

describe("structured executors — per-modality fixtures", () => {
  it("USG fetal fires range/unit/exclusive/laterality/required and skips gated rules", () => {
    const r = engine.evaluate(ALL_FIXTURES["USG fetal"]);
    expect(has(r, "fetal.fhr")).toBe(true); // numeric-range blocker (178 > 160)
    expect(r.findings.find((f) => f.ruleId.endsWith("fetal.fhr"))?.severity).toBe("blocker");
    expect(has(r, "fetal.afi")).toBe(true);
    expect(has(r, "fetal.cervical-length")).toBe(true);
    expect(has(r, "fetal.dv-awave")).toBe(true); // mutually-exclusive enumField
    expect(has(r, "usg.fetal")).toBe(true); // unit-validation mm/cm hazard
    expect(has(r, "usg.kidneys")).toBe(true); // required-laterality pair
    // required-measurement: 5 missing biometry
    expect(r.findings.filter((f) => f.ruleId.endsWith("usg.growth"))).toHaveLength(5);
    // finding-instance rules honestly not evaluated (slot absent)
    expect(r.notEvaluated.some((id) => id.endsWith("conflict-group"))).toBe(true);
    expect(r.notEvaluated.some((id) => id.endsWith("quickselect.side"))).toBe(true);
    expect(r.notEvaluated.some((id) => id.endsWith("section.coverage"))).toBe(true);
  });

  it("CT brain fires study-modality mismatch (blocker, shadow) + midline range", () => {
    const r = engine.evaluate(ALL_FIXTURES["CT brain"]);
    const mismatch = r.findings.find((f) => f.ruleId.endsWith("study-modality.mr"));
    expect(mismatch).toBeTruthy();
    expect(mismatch?.severity).toBe("blocker");
    expect(r.blockingCount).toBe(1); // recorded, but shadow — not gating
    expect(has(r, "brain.midline-shift")).toBe(true);
  });

  it("X-Ray chest fires unit mismatch, no modality mismatch, no missing required", () => {
    const r = engine.evaluate(ALL_FIXTURES["X-Ray chest"]);
    expect(has(r, "unit.xr")).toBe(true);
    expect(has(r, "study-modality.xr")).toBe(false); // XR authoritative == declared
    expect(has(r, "chest-pa")).toBe(false); // Cardiothoracic ratio is present
  });

  it("MRI brain fires conflict-group exclusivity + section coverage from findingInstances", () => {
    const r = engine.evaluate(ALL_FIXTURES["MRI brain"]);
    expect(has(r, "conflict-group")).toBe(true); // Fazekas 1 + Fazekas 2 together
    expect(has(r, "section.coverage")).toBe(true); // VENTRICULAR uncovered (POSTERIOR FOSSA excluded)
    // measurement rules honestly not evaluated (no measurements slot)
    expect(r.notEvaluated.some((id) => id.endsWith("midline-shift"))).toBe(true);
  });
});

describe("study-modality-consistency edge cases", () => {
  it("does not fire on the sentinel 'OT' authoritative modality", () => {
    const r = engine.evaluate({
      modality: "MRI", text: { findings: "", impression: [] },
      study: { authoritativeSource: "dicom", authoritativeModality: "OTHER", authoritativeModalityRaw: "OT", authoritativeIsSentinel: true, declaredModality: "MR", declaredModalityRaw: "MRI", studyName: null, studyDescription: null },
    });
    expect(r.findings.some((f) => f.ruleId.includes("study-modality"))).toBe(false);
  });

  it("does not fire on a manual draft with no declared modality", () => {
    const r = engine.evaluate({
      modality: "MRI", text: { findings: "", impression: [] },
      study: { authoritativeSource: "study", authoritativeModality: "CT", authoritativeModalityRaw: "CT", authoritativeIsSentinel: false, declaredModality: "MR", declaredModalityRaw: null, studyName: null, studyDescription: null },
    });
    expect(r.findings.some((f) => f.ruleId.includes("study-modality"))).toBe(false);
  });
});
