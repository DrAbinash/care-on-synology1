import { describe, expect, it } from "vitest";
import {
  calcTestCommission,
  findMatchingRule,
  normalizeCommissionLabel,
  parseTestIdList,
  type CalcRule,
} from "./commissionCalc";

const baseRule = (over: Partial<CalcRule> & Pick<CalcRule, "name" | "scope">): CalcRule => ({
  type: "fixed",
  value: 500,
  categories: null,
  testIds: null,
  appliesTo: "all",
  isExclusive: false,
  isActive: true,
  ...over,
});

describe("parseTestIdList", () => {
  it("coerces string ids from JSON", () => {
    expect(parseTestIdList('[12,"34"]')).toEqual([12, 34]);
  });
});

describe("normalizeCommissionLabel", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeCommissionLabel("MRI-BRAIN")).toBe("MRI BRAIN");
    expect(normalizeCommissionLabel("  mri   brain ")).toBe("MRI BRAIN");
  });
});

describe("findMatchingRule", () => {
  it("matches by numeric test id", () => {
    const rules = [baseRule({ name: "CT 800", scope: "test", testIds: "[101]", value: 800 })];
    expect(findMatchingRule(101, "CT", rules)?.name).toBe("CT 800");
    expect(findMatchingRule(999, "CT", rules)).toBeUndefined();
  });

  it("matches string-encoded test ids", () => {
    const rules = [baseRule({ name: "CT 800", scope: "test", testIds: '["101"]', value: 800 })];
    expect(findMatchingRule(101, "CT", rules)?.name).toBe("CT 800");
  });

  it("matches category case-insensitively", () => {
    const rules = [baseRule({
      name: "Radiology 10%",
      scope: "category",
      type: "percentage",
      value: 10,
      categories: '["Radiology"]',
    })];
    expect(findMatchingRule(1, "radiology", rules)?.name).toBe("Radiology 10%");
  });

  it("falls back to exact rule name ↔ test name when testIds empty", () => {
    const rules = [baseRule({ name: "MRI BRAIN", scope: "test", testIds: "[]", value: 1750 })];
    expect(findMatchingRule(55, "MRI", rules, false, "MRI BRAIN")?.name).toBe("MRI BRAIN");
    // Amount-labelled names must NOT match unrelated tests
    const amountRules = [baseRule({ name: "CT 800", scope: "test", testIds: "[]", value: 800 })];
    expect(findMatchingRule(55, "CT", amountRules, false, "CT CHEST")).toBeUndefined();
  });

  it("uses catch-all when no specific slab matches", () => {
    const rules = [
      baseRule({ name: "CT 800", scope: "test", testIds: "[1]", value: 800 }),
      baseRule({ name: "Default 5%", scope: "all", type: "percentage", value: 5 }),
    ];
    expect(findMatchingRule(99, "Other", rules)?.name).toBe("Default 5%");
  });
});

describe("calcTestCommission wiring", () => {
  it("shows None / 0% when nothing matches and default is 0", () => {
    const result = calcTestCommission(
      { testId: 1, price: 1000 },
      { category: "MRI", name: "MRI BRAIN" },
      [],
      { defaultCommission: 0, defaultCommissionType: "percentage" },
    );
    expect(result.ruleName).toBe("None");
    expect(result.ruleValue).toBe(0);
    expect(result.commission).toBe(0);
    expect(result.ruleScope).toBe("none");
  });

  it("pays via name fallback when slab is named after the test", () => {
    const rules = [baseRule({ name: "MRI BRAIN", scope: "test", testIds: null, type: "fixed", value: 1750 })];
    const result = calcTestCommission(
      { testId: 9, price: 8500 },
      { category: "MRI", name: "MRI BRAIN" },
      rules,
      { defaultCommission: 0 },
    );
    expect(result.ruleName).toBe("MRI BRAIN");
    expect(result.commission).toBe(1750);
    expect(result.ruleScope).toBe("test");
  });
});
