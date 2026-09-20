import { describe, expect, it } from "vitest";
import { deriveRateMeta } from "./modalityBillingSummary";

describe("deriveRateMeta", () => {
  it("returns single rate when all line prices match", () => {
    expect(deriveRateMeta(14, 35000, [2500, 2500, 2500])).toEqual({
      rateKind: "single",
      unitRate: 2500,
      avgRate: 2500,
      distinctRateCount: 1,
    });
  });

  it("returns multiple + avg when prices differ (does not invent a tariff)", () => {
    const meta = deriveRateMeta(3, 9000, [2000, 3000, 4000]);
    expect(meta.rateKind).toBe("multiple");
    expect(meta.unitRate).toBeNull();
    expect(meta.avgRate).toBe(3000);
    expect(meta.distinctRateCount).toBe(3);
  });

  it("returns none for empty modality", () => {
    expect(deriveRateMeta(0, 0, [])).toEqual({
      rateKind: "none",
      unitRate: null,
      avgRate: null,
      distinctRateCount: 0,
    });
  });

  it("normalizes float noise so 2500 and 2500.00 collapse", () => {
    expect(deriveRateMeta(2, 5000, [2500, 2500.001]).rateKind).toBe("single");
  });
});
