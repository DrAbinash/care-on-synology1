import { describe, expect, test } from "vitest";
import { computeFinalizeSafety, criticalFindingBlocksFinalize } from "./finalizeSafety";

describe("criticalFindingBlocksFinalize", () => {
  test("blocks when critical text is unflagged", () => {
    expect(
      criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: [{ label: "ICH" }],
        criticalMarked: false,
        criticalCommunicated: false,
      }),
    ).toBe(true);
  });

  test("blocks when marked but not telephoned", () => {
    expect(
      criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: [{ label: "ICH" }],
        criticalMarked: true,
        criticalCommunicated: false,
      }),
    ).toBe(true);
  });

  test("allows when marked and communicated", () => {
    expect(
      criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: [{ label: "ICH" }],
        criticalMarked: true,
        criticalCommunicated: true,
      }),
    ).toBe(false);
  });

  test("computeFinalizeSafety still returns critical issues", () => {
    const issues = computeFinalizeSafety({
      checklistActive: false,
      checklistPercent: 100,
      criticalHits: [{ label: "PE" }],
      criticalMarked: false,
      criticalCommunicated: false,
    });
    expect(issues.some((i) => i.id === "critical-unflagged")).toBe(true);
  });
});
