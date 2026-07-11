import { describe, expect, test, vi, beforeEach } from "vitest";

let flagRows: Array<{ key: string; enabled: boolean }>;
let ruleRows: Array<{
  id: number;
  ruleName: string;
  builderType: string;
  conditions: { field: string; operator: string; value: string | string[] }[];
  generatedText: string;
  priority: string | null;
  severity: string | null;
  version: string;
  isActive: boolean;
}>;

// This test exercises the repository's mapping/gating logic, not Drizzle's
// SQL predicate construction — so eq()/and() are stubbed to pass their
// arguments through untouched rather than mocking the real drizzle-orm
// Column machinery. `.where()` resolves to `ruleRows` unconditionally,
// mirroring the "mock the DB module directly" convention already used by
// featureFlags.test.ts.
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ __op: "eq", args }),
  and: (...args: unknown[]) => ({ __op: "and", args }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => ruleRows,
      }),
    }),
  },
  radiologyImpressionRulesTable: { isActive: "is_active", builderType: "builder_type" },
}));

vi.mock("./featureFlags", () => ({
  isFeatureEnabledServer: vi.fn(async (key: string) => flagRows.some((r) => r.key === key && r.enabled)),
}));

describe("mapDbRowToImpressionRule", () => {
  test("maps a well-formed legacy row into a valid canonical rule", async () => {
    const { mapDbRowToImpressionRule } = await import("./impressionRuleRepository");
    const rule = mapDbRowToImpressionRule({
      id: 42,
      builderType: "mri_brain",
      conditions: [{ field: "whiteMatter", operator: "equals", value: "fazekas3" }],
      generatedText: "Chronic small-vessel ischemic changes (Fazekas III).",
      priority: "urgent",
      version: "v1.0",
      isActive: true,
    });

    expect(rule.id).toBe("42");
    expect(rule.builderType).toBe("mri_brain");
    expect(rule.priority).toBe("urgent");
    expect(rule.isActive).toBe(true);
    expect(rule.order).toBe(42);
    expect(rule.condition).toEqual({
      kind: "group",
      logic: "AND",
      children: [{ kind: "leaf", field: "whiteMatter", operator: "equals", value: "fazekas3" }],
    });
    expect(rule.fragments).toEqual([{ id: "42.impression", text: "Chronic small-vessel ischemic changes (Fazekas III)." }]);
  });

  test("a flat multi-condition array maps to an implicit top-level AND group of leaves", async () => {
    const { mapDbRowToImpressionRule } = await import("./impressionRuleRepository");
    const rule = mapDbRowToImpressionRule({
      id: 1,
      builderType: "mri_ls_spine",
      conditions: [
        { field: "level", operator: "equals", value: "L4-5" },
        { field: "morphology", operator: "equals", value: "protrusion" },
      ],
      generatedText: "L4-5 disc protrusion.",
      priority: "normal",
      version: "v1.0",
      isActive: true,
    });
    expect(rule.condition.kind).toBe("group");
    expect((rule.condition as { children: unknown[] }).children).toHaveLength(2);
  });

  test("falls back to priority 'normal' when the DB value is null or unrecognized", async () => {
    const { mapDbRowToImpressionRule } = await import("./impressionRuleRepository");
    const withNull = mapDbRowToImpressionRule({
      id: 1, builderType: "mri_brain", conditions: [], generatedText: "x", priority: null, version: "v1.0", isActive: true,
    });
    const withGarbage = mapDbRowToImpressionRule({
      id: 2, builderType: "mri_brain", conditions: [], generatedText: "x", priority: "not-a-real-priority", version: "v1.0", isActive: true,
    });
    expect(withNull.priority).toBe("normal");
    expect(withGarbage.priority).toBe("normal");
  });

  test("an empty conditions array maps to an empty AND group (later flagged invalid by validation, not silently 'always true')", async () => {
    const { mapDbRowToImpressionRule } = await import("./impressionRuleRepository");
    const rule = mapDbRowToImpressionRule({
      id: 1, builderType: "mri_brain", conditions: [], generatedText: "x", priority: "normal", version: "v1.0", isActive: true,
    });
    expect(rule.condition).toEqual({ kind: "group", logic: "AND", children: [] });
  });
});

describe("loadActiveImpressionRules — feature-flag gating", () => {
  beforeEach(() => {
    ruleRows = [
      {
        id: 1,
        ruleName: "SVID Fazekas III",
        builderType: "mri_brain",
        conditions: [{ field: "whiteMatter", operator: "equals", value: "fazekas3" }],
        generatedText: "Chronic small-vessel ischemic changes (Fazekas III).",
        priority: "normal",
        severity: "moderate",
        version: "v1.0",
        isActive: true,
      },
    ];
    flagRows = [{ key: "ff_radiology_impression_engine", enabled: false }];
  });

  test("returns an empty array — never throws — when the flag is disabled", async () => {
    const { loadActiveImpressionRules } = await import("./impressionRuleRepository");
    await expect(loadActiveImpressionRules()).resolves.toEqual([]);
  });

  test("loads and maps rows when the flag is enabled", async () => {
    flagRows = [{ key: "ff_radiology_impression_engine", enabled: true }];
    const { loadActiveImpressionRules } = await import("./impressionRuleRepository");
    const rules = await loadActiveImpressionRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("1");
    expect(rules[0].builderType).toBe("mri_brain");
  });

  test("an unknown/unseeded flag key defaults to disabled (same as isFeatureEnabledServer's own contract)", async () => {
    flagRows = []; // key not seeded at all
    const { loadActiveImpressionRules } = await import("./impressionRuleRepository");
    await expect(loadActiveImpressionRules()).resolves.toEqual([]);
  });
});

describe("IMPRESSION_ENGINE_FLAG_KEY", () => {
  test("is the exact key referenced by this ticket and its migration", async () => {
    const { IMPRESSION_ENGINE_FLAG_KEY } = await import("./impressionRuleRepository");
    expect(IMPRESSION_ENGINE_FLAG_KEY).toBe("ff_radiology_impression_engine");
  });
});
