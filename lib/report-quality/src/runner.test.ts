import { describe, it, expect, afterEach } from "vitest";
import { runQualityEngine } from "./runner";
import { registerRule, clearRules } from "./registry";
import { normalizeModality, modalityMatches } from "./modality";
import { REPORT_QUALITY_ENGINE_VERSION } from "./version";
import type { QualityContext, QualityRule } from "./contract";

function ctx(over: Partial<QualityContext> = {}): QualityContext {
  return {
    modality: "MR",
    text: { findings: "", impression: [] },
    ...over,
  };
}

const passthroughRule = (id: string, over: Partial<QualityRule> = {}): QualityRule => ({
  id,
  category: "consistency",
  modalities: "*",
  tier: "heuristic",
  evaluate: () => [{ ruleId: id, category: "consistency", severity: "warning", tier: "heuristic", message: id }],
  ...over,
});

afterEach(() => clearRules());

describe("normalizeModality", () => {
  it("maps the three platform vocabularies to one canonical code", () => {
    expect(normalizeModality("MR")).toBe("MR");
    expect(normalizeModality("MRI")).toBe("MR");
    expect(normalizeModality("MRI_SPINE")).toBe("MR");
    expect(normalizeModality("USG")).toBe("US");
    expect(normalizeModality("US")).toBe("US");
    expect(normalizeModality("Doppler")).toBe("US");
    expect(normalizeModality("NCCT")).toBe("CT");
    expect(normalizeModality("X-RAY")).toBe("XR");
    expect(normalizeModality("CR")).toBe("XR");
    expect(normalizeModality("mammography")).toBe("MG");
    expect(normalizeModality("")).toBe("OTHER");
    expect(normalizeModality(null)).toBe("OTHER");
  });

  it("matches rule scope via canonicalization", () => {
    expect(modalityMatches("*", "CT")).toBe(true);
    expect(modalityMatches(["MRI"], "MR")).toBe(true);
    expect(modalityMatches(["US"], "MR")).toBe(false);
  });
});

describe("runQualityEngine", () => {
  it("returns an empty, honest report when no rules are registered", () => {
    const report = runQualityEngine(ctx());
    expect(report.findings).toHaveLength(0);
    expect(report.evaluatedRuleCount).toBe(0);
    expect(report.score).toBe(100);
    expect(report.engineVersion).toBe(REPORT_QUALITY_ENGINE_VERSION);
  });

  it("runs a matching rule and aggregates severity counts", () => {
    registerRule(passthroughRule("a"));
    registerRule(passthroughRule("b", {
      evaluate: () => [{ ruleId: "b", category: "measurement", severity: "blocker", tier: "structured", message: "b" }],
    }));
    const report = runQualityEngine(ctx());
    expect(report.evaluatedRuleCount).toBe(2);
    expect(report.warningCount).toBe(1);
    expect(report.blockingCount).toBe(1);
    // defaultScorer: 100 - 5 (warning) - 20 (blocker) = 75
    expect(report.score).toBe(75);
  });

  it("skips rules whose modality does not match and records nothing for them", () => {
    registerRule(passthroughRule("mr-only", { modalities: ["MR"] }));
    registerRule(passthroughRule("ct-only", { modalities: ["CT"] }));
    const report = runQualityEngine(ctx({ modality: "CT" }));
    expect(report.findings.map((f) => f.ruleId)).toEqual(["ct-only"]);
    // A non-matching modality is out of scope, NOT "not evaluated for missing data".
    expect(report.notEvaluated).not.toContain("mr-only");
  });

  it("records rules whose required structured data is absent as notEvaluated", () => {
    registerRule(passthroughRule("needs-measurements", { requires: ["measurements"] }));
    const withoutData = runQualityEngine(ctx());
    expect(withoutData.notEvaluated).toContain("needs-measurements");
    expect(withoutData.evaluatedRuleCount).toBe(0);

    const withData = runQualityEngine(ctx({ measurements: [] }));
    expect(withData.notEvaluated).not.toContain("needs-measurements");
    expect(withData.evaluatedRuleCount).toBe(1);
  });

  it("isolates a throwing rule instead of breaking the run", () => {
    registerRule(passthroughRule("boom", { evaluate: () => { throw new Error("bad rule"); } }));
    registerRule(passthroughRule("ok"));
    const report = runQualityEngine(ctx());
    expect(report.notEvaluated).toContain("boom");
    expect(report.findings.map((f) => f.ruleId)).toEqual(["ok"]);
  });

  it("honors onlyRuleIds and an injected scorer", () => {
    registerRule(passthroughRule("x"));
    registerRule(passthroughRule("y"));
    const report = runQualityEngine(ctx(), { onlyRuleIds: ["y"], scorer: () => 42 });
    expect(report.findings.map((f) => f.ruleId)).toEqual(["y"]);
    expect(report.score).toBe(42);
  });
});
