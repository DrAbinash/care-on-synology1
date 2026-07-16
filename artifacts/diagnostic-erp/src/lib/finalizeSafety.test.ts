import { describe, it, expect } from "vitest";
import { computeFinalizeSafety, formatFinalizeSafety, type FinalizeSafetyInput } from "./finalizeSafety";

const base: FinalizeSafetyInput = {
  checklistActive: false,
  checklistPercent: 100,
  checklistRemaining: [],
  missingRequiredMeasurements: [],
  criticalHits: [],
  criticalMarked: false,
  criticalCommunicated: false,
};

describe("computeFinalizeSafety (MRI PR 3 — Finalization Safety)", () => {
  it("returns nothing for a clean, complete report", () => {
    expect(computeFinalizeSafety(base)).toEqual([]);
  });

  it("flags a detected critical finding that was not marked", () => {
    const issues = computeFinalizeSafety({ ...base, criticalHits: [{ label: "acute infarct" }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("critical-unflagged");
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].message).toMatch(/acute infarct/);
  });

  it("flags a marked-but-uncommunicated critical finding", () => {
    const issues = computeFinalizeSafety({
      ...base, criticalHits: [{ label: "cord compression" }], criticalMarked: true, criticalCommunicated: false,
    });
    expect(issues.map((i) => i.id)).toEqual(["critical-uncommunicated"]);
    expect(issues[0].severity).toBe("critical");
  });

  it("stays quiet once a critical finding is marked and communicated", () => {
    const issues = computeFinalizeSafety({
      ...base, criticalHits: [{ label: "cord compression" }], criticalMarked: true, criticalCommunicated: true,
    });
    expect(issues).toEqual([]);
  });

  it("warns on an incomplete protocol checklist with the remaining items", () => {
    const issues = computeFinalizeSafety({
      ...base, checklistActive: true, checklistPercent: 60, checklistRemaining: ["Ventricles", "Sinuses"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("protocol-checklist");
    expect(issues[0].message).toMatch(/60%/);
    expect(issues[0].message).toMatch(/Ventricles/);
  });

  it("does not warn about the checklist when no protocol is active", () => {
    const issues = computeFinalizeSafety({ ...base, checklistActive: false, checklistPercent: 40 });
    expect(issues).toEqual([]);
  });

  it("warns on missing required measurements", () => {
    const issues = computeFinalizeSafety({ ...base, missingRequiredMeasurements: ["Canal diameter"] });
    expect(issues.map((i) => i.id)).toEqual(["missing-measurements"]);
  });

  it("orders critical issues before warnings", () => {
    const issues = computeFinalizeSafety({
      ...base,
      checklistActive: true, checklistPercent: 50, checklistRemaining: ["X"],
      criticalHits: [{ label: "acute infarct" }], criticalMarked: false,
    });
    expect(issues[0].severity).toBe("critical");
    expect(issues[issues.length - 1].severity).toBe("warn");
  });
});

describe("formatFinalizeSafety", () => {
  it("returns an empty string when there are no issues", () => {
    expect(formatFinalizeSafety([])).toBe("");
  });

  it("renders a numbered Safety checks block", () => {
    const text = formatFinalizeSafety(computeFinalizeSafety({ ...base, criticalHits: [{ label: "acute infarct" }] }));
    expect(text).toMatch(/Safety checks:/);
    expect(text).toMatch(/1\. ⚠ /);
  });
});
