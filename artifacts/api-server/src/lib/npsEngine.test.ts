import { describe, expect, test } from "vitest";
import { npsCategory, isValidNps, calcNps, npsBreakdown } from "./npsEngine";

describe("npsCategory", () => {
  test("buckets scores correctly", () => {
    expect(npsCategory(10)).toBe("promoter");
    expect(npsCategory(9)).toBe("promoter");
    expect(npsCategory(8)).toBe("passive");
    expect(npsCategory(7)).toBe("passive");
    expect(npsCategory(6)).toBe("detractor");
    expect(npsCategory(0)).toBe("detractor");
  });
});

describe("isValidNps", () => {
  test("accepts integers 0–10 only", () => {
    expect(isValidNps(0)).toBe(true);
    expect(isValidNps(10)).toBe(true);
    expect(isValidNps(11)).toBe(false);
    expect(isValidNps(-1)).toBe(false);
    expect(isValidNps(5.5)).toBe(false);
    expect(isValidNps("5")).toBe(false);
    expect(isValidNps(null)).toBe(false);
  });
});

describe("calcNps", () => {
  test("empty → 0", () => { expect(calcNps([])).toBe(0); });
  test("all promoters → 100", () => { expect(calcNps([9, 10, 9])).toBe(100); });
  test("all detractors → -100", () => { expect(calcNps([0, 3, 6])).toBe(-100); });
  test("mixed: 2 promoters, 1 passive, 1 detractor of 4 → 25", () => {
    // (2 - 1)/4 * 100 = 25
    expect(calcNps([9, 10, 8, 4])).toBe(25);
  });
});

describe("npsBreakdown", () => {
  test("counts each bucket + total", () => {
    const b = npsBreakdown([10, 9, 8, 6, 6]);
    expect(b).toEqual({ nps: calcNps([10, 9, 8, 6, 6]), promoters: 2, passives: 1, detractors: 2, total: 5 });
    expect(b.nps).toBe(0); // (2-2)/5
  });
});
