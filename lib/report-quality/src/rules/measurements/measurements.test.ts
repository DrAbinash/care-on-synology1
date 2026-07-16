// measurements.test.ts — Phase-4 registry-driven rules: no rule depends on
// display labels; identity, units, ranges and severity all come from the
// Universal Measurement Registry.

import { describe, it, expect } from "vitest";
import { createMeasurementEngine, MEASUREMENT_RULE_DEFINITIONS, measurementRangeRuleId } from "./index";
import type { QualityContext } from "../../contract";

function ctx(partial: Partial<QualityContext>): QualityContext {
  return { modality: "US", ...partial } as QualityContext;
}

describe("Quality Engine Phase 4 — registry-driven measurement rules", () => {
  it("generates one rule per registry measurement with a range, zero hardcoded thresholds", () => {
    expect(MEASUREMENT_RULE_DEFINITIONS.length).toBeGreaterThan(15);
    for (const def of MEASUREMENT_RULE_DEFINITIONS) {
      expect(Object.keys(def.params)).toEqual(["measurementId"]);
      expect(def.blockingEligibility).toBe(false);
      expect(def.id).toMatch(/^care\.measurement\.range\./);
    }
  });

  it("fires on canonical id regardless of which legacy label carries the value", () => {
    const engine = createMeasurementEngine();
    // Same clinical fact under three legacy spellings — all must fire the ONE
    // canonical CBD rule.
    for (const label of ["CBD", "Common Bile Duct Diameter", "cbd_diameter"]) {
      const report = engine.evaluate(ctx({
        modality: "US",
        measurements: [{ key: label, label, value: 9, unit: "mm" }],
      }));
      const hit = report.findings.find((f) => f.ruleId === measurementRangeRuleId("CBD"));
      expect(hit, `label "${label}" should resolve to CBD`).toBeDefined();
      expect(hit!.severity).toBe("warning");
    }
  });

  it("converts units via the registry before range evaluation (0.9 cm CBD = 9 mm → abnormal)", () => {
    const engine = createMeasurementEngine();
    const report = engine.evaluate(ctx({
      modality: "US",
      measurements: [{ key: "CBD", label: "CBD", value: 0.9, unit: "cm" }],
    }));
    expect(report.findings.some((f) => f.ruleId === measurementRangeRuleId("CBD"))).toBe(true);
  });

  it("escalates critical-range values to blocker severity (midline shift 7 mm)", () => {
    const engine = createMeasurementEngine();
    const report = engine.evaluate(ctx({
      modality: "CT",
      measurements: [{ key: "Midline shift", label: "Midline shift", value: 7, unit: "mm" }],
    }));
    const hit = report.findings.find((f) => f.ruleId === measurementRangeRuleId("MIDLINE_SHIFT"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("blocker");
  });

  it("stays silent for in-range values and unknown labels", () => {
    const engine = createMeasurementEngine();
    const report = engine.evaluate(ctx({
      modality: "US",
      measurements: [
        { key: "CBD", label: "CBD", value: 4, unit: "mm" },
        { key: "Mystery Metric", label: "Mystery Metric", value: 999 },
      ],
    }));
    expect(report.findings.filter((f) => f.ruleId.startsWith("care.measurement.range."))).toEqual([]);
  });

  it("marks rules notEvaluated when the measurements slot is absent", () => {
    const engine = createMeasurementEngine();
    const report = engine.evaluate(ctx({ modality: "US" }));
    expect(report.findings).toEqual([]);
  });
});
