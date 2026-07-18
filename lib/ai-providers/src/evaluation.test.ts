import { describe, it, expect } from "vitest";
import {
  criticalFindingRecall, structuredValidationRate, aggregateMetrics, decideVersionPromotion,
  DEFAULT_THRESHOLDS,
} from "./evaluation";

describe("evaluation metrics (G8)", () => {
  it("critical recall is 100 when there are no criticals", () => {
    expect(criticalFindingRecall([{ key: "a" }], [])).toBe(100);
  });

  it("critical recall reflects how many criticals were produced", () => {
    const ref = [{ key: "bleed", critical: true }, { key: "mass", critical: true }];
    expect(criticalFindingRecall(ref, [{ key: "bleed" }])).toBe(50);
    expect(criticalFindingRecall(ref, [{ key: "bleed" }, { key: "mass" }])).toBe(100);
    expect(criticalFindingRecall(ref, [])).toBe(0);
  });

  it("structured validation rate is the fraction of valid cases", () => {
    expect(structuredValidationRate([{ validationOk: true, criticalRecall: 100 }, { validationOk: false, criticalRecall: 0 }])).toBe(50);
  });

  it("aggregates mean critical recall + validation rate", () => {
    const m = aggregateMetrics([{ validationOk: true, criticalRecall: 100 }, { validationOk: true, criticalRecall: 80 }]);
    expect(m.caseCount).toBe(2);
    expect(m.criticalRecall).toBe(90);
    expect(m.validationRate).toBe(100);
  });
});

describe("version promotion state machine + human gate (G8)", () => {
  const passing = { caseCount: 5, criticalRecall: 100, validationRate: 100 };
  const failing = { caseCount: 5, criticalRecall: 80, validationRate: 100 };

  it("stays shadow when metrics fail", () => {
    expect(decideVersionPromotion(failing, DEFAULT_THRESHOLDS, false).eligibleState).toBe("shadow");
    expect(decideVersionPromotion(failing, DEFAULT_THRESHOLDS, true).eligibleState).toBe("shadow");
  });

  it("reaches candidate when metrics pass but no human approval", () => {
    expect(decideVersionPromotion(passing, DEFAULT_THRESHOLDS, false).eligibleState).toBe("candidate");
  });

  it("reaches live ONLY with metrics pass AND human approval", () => {
    expect(decideVersionPromotion(passing, DEFAULT_THRESHOLDS, true).eligibleState).toBe("live");
  });

  it("never reaches live on human approval alone (metrics gate first)", () => {
    expect(decideVersionPromotion(failing, DEFAULT_THRESHOLDS, true).eligibleState).not.toBe("live");
  });
});
