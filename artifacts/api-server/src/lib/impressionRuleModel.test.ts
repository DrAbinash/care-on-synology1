import { describe, expect, test } from "vitest";
import {
  compareRules,
  isComparisonOperator,
  isConditionGroup,
  isConditionLeaf,
  isRulePriority,
  operatorRequiresValue,
  priorityRank,
  resolveField,
  type ImpressionRule,
} from "./impressionRuleModel";

function baseRule(overrides: Partial<ImpressionRule> = {}): ImpressionRule {
  return {
    id: "r1",
    version: "v1.0",
    builderType: "mri_brain",
    isActive: true,
    priority: "normal",
    order: 0,
    condition: { kind: "leaf", field: "x", operator: "exists" },
    fragments: [],
    recommendations: [],
    warnings: [],
    ...overrides,
  };
}

describe("isComparisonOperator", () => {
  test("accepts every documented operator", () => {
    for (const op of ["equals", "not_equals", "exists", "missing", "greater_than", "greater_or_equal", "less_than", "contains", "any_of", "all_of", "regex"]) {
      expect(isComparisonOperator(op)).toBe(true);
    }
  });

  test("rejects unknown strings and non-strings", () => {
    expect(isComparisonOperator("startswith")).toBe(false);
    expect(isComparisonOperator("")).toBe(false);
    expect(isComparisonOperator(42)).toBe(false);
    expect(isComparisonOperator(undefined)).toBe(false);
    expect(isComparisonOperator(null)).toBe(false);
  });
});

describe("operatorRequiresValue", () => {
  test("exists and missing do not require a value", () => {
    expect(operatorRequiresValue("exists")).toBe(false);
    expect(operatorRequiresValue("missing")).toBe(false);
  });

  test("every other operator requires a value", () => {
    for (const op of ["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "contains", "any_of", "all_of", "regex"] as const) {
      expect(operatorRequiresValue(op)).toBe(true);
    }
  });
});

describe("isConditionLeaf / isConditionGroup", () => {
  test("discriminates correctly", () => {
    const leaf = { kind: "leaf" as const, field: "a", operator: "exists" as const };
    const group = { kind: "group" as const, logic: "AND" as const, children: [leaf] };
    expect(isConditionLeaf(leaf)).toBe(true);
    expect(isConditionLeaf(group)).toBe(false);
    expect(isConditionGroup(group)).toBe(true);
    expect(isConditionGroup(leaf)).toBe(false);
  });
});

describe("isRulePriority / priorityRank", () => {
  test("accepts exactly critical/urgent/normal", () => {
    expect(isRulePriority("critical")).toBe(true);
    expect(isRulePriority("urgent")).toBe(true);
    expect(isRulePriority("normal")).toBe(true);
    expect(isRulePriority("low")).toBe(false);
    expect(isRulePriority("high")).toBe(false);
  });

  test("critical ranks before urgent ranks before normal", () => {
    expect(priorityRank("critical")).toBeLessThan(priorityRank("urgent"));
    expect(priorityRank("urgent")).toBeLessThan(priorityRank("normal"));
  });
});

describe("compareRules — deterministic ordering", () => {
  test("orders by priority band first: critical, then urgent, then normal", () => {
    const critical = baseRule({ id: "c", priority: "critical" });
    const urgent = baseRule({ id: "u", priority: "urgent" });
    const normal = baseRule({ id: "n", priority: "normal" });
    const sorted = [normal, critical, urgent].sort(compareRules);
    expect(sorted.map((r) => r.id)).toEqual(["c", "u", "n"]);
  });

  test("within the same priority, orders by explicit `order` ascending", () => {
    const a = baseRule({ id: "a", order: 5 });
    const b = baseRule({ id: "b", order: 1 });
    const c = baseRule({ id: "c", order: 3 });
    const sorted = [a, b, c].sort(compareRules);
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  test("when priority and order both tie, falls back to id ascending", () => {
    const z = baseRule({ id: "z", order: 1 });
    const a = baseRule({ id: "a", order: 1 });
    const m = baseRule({ id: "m", order: 1 });
    const sorted = [z, a, m].sort(compareRules);
    expect(sorted.map((r) => r.id)).toEqual(["a", "m", "z"]);
  });

  test("sort result is stable regardless of input array order (fully deterministic)", () => {
    const rules = [
      baseRule({ id: "n1", priority: "normal", order: 2 }),
      baseRule({ id: "c1", priority: "critical", order: 9 }),
      baseRule({ id: "u1", priority: "urgent", order: 0 }),
      baseRule({ id: "n0", priority: "normal", order: 1 }),
    ];
    const forward = [...rules].sort(compareRules).map((r) => r.id);
    const reversed = [...rules].reverse().sort(compareRules).map((r) => r.id);
    expect(forward).toEqual(["c1", "u1", "n0", "n1"]);
    expect(reversed).toEqual(forward);
  });
});

describe("resolveField — safe dot-path lookup", () => {
  test("resolves a top-level field", () => {
    expect(resolveField({ x: 42 }, "x")).toBe(42);
  });

  test("resolves a nested field", () => {
    expect(resolveField({ measurements: { evansIndex: 0.34 } }, "measurements.evansIndex")).toBe(0.34);
  });

  test("returns undefined for a missing top-level field", () => {
    expect(resolveField({ x: 1 }, "y")).toBeUndefined();
  });

  test("returns undefined for a missing nested field", () => {
    expect(resolveField({ measurements: {} }, "measurements.evansIndex")).toBeUndefined();
  });

  test("returns undefined when traversing through a non-object (e.g. a number)", () => {
    expect(resolveField({ x: 5 }, "x.y")).toBeUndefined();
  });

  test("returns undefined when traversing through an array (arrays are not dot-path traversable)", () => {
    expect(resolveField({ x: [1, 2, 3] }, "x.length")).toBeUndefined();
  });

  test("blocks __proto__ / prototype / constructor path segments", () => {
    expect(resolveField({}, "__proto__")).toBeUndefined();
    expect(resolveField({}, "__proto__.polluted")).toBeUndefined();
    expect(resolveField({ a: {} }, "a.constructor")).toBeUndefined();
    expect(resolveField({ a: {} }, "a.prototype")).toBeUndefined();
  });

  test("does not actually pollute Object.prototype even after many lookups", () => {
    for (let i = 0; i < 5; i++) resolveField({}, "__proto__.polluted");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- verifying no pollution occurred
    expect((({} as any).polluted)).toBeUndefined();
  });
});
