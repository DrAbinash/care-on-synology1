import { describe, expect, test } from "vitest";
import { validateRuleSet, type RuleValidationIssueCode } from "./impressionRuleValidation";
import type { ImpressionRule, RuleCondition } from "./impressionRuleModel";

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

function codesFor(issues: { ruleId: string; code: RuleValidationIssueCode }[], ruleId: string): RuleValidationIssueCode[] {
  return issues.filter((i) => i.ruleId === ruleId).map((i) => i.code);
}

describe("validateRuleSet — clean rule sets", () => {
  test("returns no issues for a single valid rule", () => {
    expect(validateRuleSet([baseRule()])).toEqual([]);
  });

  test("returns no issues for a valid nested AND/OR tree", () => {
    const condition: RuleCondition = {
      kind: "group",
      logic: "AND",
      children: [
        { kind: "leaf", field: "a", operator: "equals", value: "x" },
        {
          kind: "group",
          logic: "OR",
          children: [
            { kind: "leaf", field: "b", operator: "greater_than", value: 5 },
            { kind: "leaf", field: "c", operator: "contains", value: "foo" },
          ],
        },
      ],
    };
    expect(validateRuleSet([baseRule({ condition })])).toEqual([]);
  });

  test("a valid suppresses reference to another real rule produces no issues", () => {
    const a = baseRule({ id: "a", suppresses: ["b"] });
    const b = baseRule({ id: "b" });
    expect(validateRuleSet([a, b])).toEqual([]);
  });
});

describe("validateRuleSet — duplicate_id", () => {
  test("flags two rules sharing the same id", () => {
    const issues = validateRuleSet([baseRule({ id: "dup" }), baseRule({ id: "dup" })]);
    expect(codesFor(issues, "dup")).toContain("duplicate_id");
  });

  test("flags three-way duplicates once per occurrence context but identifies the shared id", () => {
    const issues = validateRuleSet([baseRule({ id: "x" }), baseRule({ id: "x" }), baseRule({ id: "x" })]);
    const dupIssues = issues.filter((i) => i.code === "duplicate_id");
    expect(dupIssues.length).toBeGreaterThanOrEqual(1);
    expect(dupIssues[0].message).toContain("3 times");
  });

  test("does not flag distinct ids", () => {
    const issues = validateRuleSet([baseRule({ id: "a" }), baseRule({ id: "b" })]);
    expect(issues.filter((i) => i.code === "duplicate_id")).toEqual([]);
  });
});

describe("validateRuleSet — version_conflict", () => {
  test("flags the same id active under two different versions", () => {
    const issues = validateRuleSet([
      baseRule({ id: "r", version: "v1.0", isActive: true }),
      baseRule({ id: "r", version: "v2.0", isActive: true }),
    ]);
    expect(codesFor(issues, "r")).toContain("version_conflict");
  });

  test("does not flag the same id/version repeated (that's duplicate_id, not version_conflict)", () => {
    const issues = validateRuleSet([
      baseRule({ id: "r", version: "v1.0" }),
      baseRule({ id: "r", version: "v1.0" }),
    ]);
    expect(codesFor(issues, "r")).not.toContain("version_conflict");
    expect(codesFor(issues, "r")).toContain("duplicate_id");
  });

  test("does not flag differing versions when only one is active (a superseded inactive version is fine)", () => {
    const issues = validateRuleSet([
      baseRule({ id: "r", version: "v1.0", isActive: false }),
      baseRule({ id: "r", version: "v2.0", isActive: true }),
    ]);
    expect(codesFor(issues, "r")).not.toContain("version_conflict");
  });
});

describe("validateRuleSet — invalid_operator", () => {
  test("flags a leaf with an unknown operator string", () => {
    const rule = baseRule({
      condition: { kind: "leaf", field: "x", operator: "starts_with" as never, value: "a" },
    });
    const issues = validateRuleSet([rule]);
    expect(codesFor(issues, "r1")).toContain("invalid_operator");
  });

  test("flags an unknown operator nested inside a group", () => {
    const rule = baseRule({
      condition: {
        kind: "group",
        logic: "AND",
        children: [{ kind: "leaf", field: "x", operator: "bogus" as never, value: "a" }],
      },
    });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_operator");
  });
});

describe("validateRuleSet — invalid_condition_tree", () => {
  test("flags an empty AND group", () => {
    const rule = baseRule({ condition: { kind: "group", logic: "AND", children: [] } });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_condition_tree");
  });

  test("flags an empty OR group", () => {
    const rule = baseRule({ condition: { kind: "group", logic: "OR", children: [] } });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_condition_tree");
  });

  test("flags a leaf with an empty field path", () => {
    const rule = baseRule({ condition: { kind: "leaf", field: "", operator: "exists" } });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_condition_tree");
  });

  test("flags a value-requiring operator with no value", () => {
    const rule = baseRule({ condition: { kind: "leaf", field: "x", operator: "equals" } });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_condition_tree");
  });

  test("does NOT flag exists/missing for lacking a value", () => {
    const existsRule = baseRule({ id: "e", condition: { kind: "leaf", field: "x", operator: "exists" } });
    const missingRule = baseRule({ id: "m", condition: { kind: "leaf", field: "x", operator: "missing" } });
    expect(validateRuleSet([existsRule, missingRule])).toEqual([]);
  });

  test("flags an invalid regex pattern", () => {
    const rule = baseRule({ condition: { kind: "leaf", field: "x", operator: "regex", value: "(unclosed" } });
    const issues = validateRuleSet([rule]);
    expect(codesFor(issues, "r1")).toContain("invalid_condition_tree");
    expect(issues.find((i) => i.code === "invalid_condition_tree")?.message).toMatch(/regular expression/i);
  });

  test("does not flag a valid regex pattern", () => {
    const rule = baseRule({ condition: { kind: "leaf", field: "x", operator: "regex", value: "^abc.*$" } });
    expect(validateRuleSet([rule])).toEqual([]);
  });

  test("flags a condition node that references itself (cyclic object graph)", () => {
    const group: RuleCondition = { kind: "group", logic: "AND", children: [] };
    (group as { kind: "group"; logic: "AND"; children: RuleCondition[] }).children.push(group);
    const rule = baseRule({ condition: group });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_condition_tree");
  });

  test("recurses into deeply nested groups to find a problem several levels down", () => {
    const rule = baseRule({
      condition: {
        kind: "group",
        logic: "AND",
        children: [
          {
            kind: "group",
            logic: "OR",
            children: [
              {
                kind: "group",
                logic: "AND",
                children: [{ kind: "leaf", field: "", operator: "exists" }],
              },
            ],
          },
        ],
      },
    });
    expect(codesFor(validateRuleSet([rule]), "r1")).toContain("invalid_condition_tree");
  });
});

describe("validateRuleSet — orphan_reference", () => {
  test("flags a suppresses id that doesn't exist in the rule set", () => {
    const rule = baseRule({ id: "a", suppresses: ["does_not_exist"] });
    const issues = validateRuleSet([rule]);
    expect(codesFor(issues, "a")).toContain("orphan_reference");
  });

  test("flags only the missing target, not a mix of valid + one missing", () => {
    const a = baseRule({ id: "a", suppresses: ["b", "ghost"] });
    const b = baseRule({ id: "b" });
    const issues = validateRuleSet([a, b]);
    const orphanIssues = issues.filter((i) => i.code === "orphan_reference");
    expect(orphanIssues).toHaveLength(1);
    expect(orphanIssues[0].message).toContain("ghost");
  });
});

describe("validateRuleSet — recursive_reference", () => {
  test("flags a direct two-rule cycle (A suppresses B, B suppresses A)", () => {
    const a = baseRule({ id: "a", suppresses: ["b"] });
    const b = baseRule({ id: "b", suppresses: ["a"] });
    const issues = validateRuleSet([a, b]);
    expect(codesFor(issues, "a")).toContain("recursive_reference");
    expect(codesFor(issues, "b")).toContain("recursive_reference");
  });

  test("flags a longer cycle (A -> B -> C -> A)", () => {
    const a = baseRule({ id: "a", suppresses: ["b"] });
    const b = baseRule({ id: "b", suppresses: ["c"] });
    const c = baseRule({ id: "c", suppresses: ["a"] });
    const issues = validateRuleSet([a, b, c]);
    expect(codesFor(issues, "a")).toContain("recursive_reference");
    expect(codesFor(issues, "b")).toContain("recursive_reference");
    expect(codesFor(issues, "c")).toContain("recursive_reference");
  });

  test("a rule suppressing itself is a (trivial) cycle", () => {
    const a = baseRule({ id: "a", suppresses: ["a"] });
    expect(codesFor(validateRuleSet([a]), "a")).toContain("recursive_reference");
  });

  test("does not flag a non-cyclic diamond (A suppresses B and C; B and C both suppress D)", () => {
    const a = baseRule({ id: "a", suppresses: ["b", "c"] });
    const b = baseRule({ id: "b", suppresses: ["d"] });
    const c = baseRule({ id: "c", suppresses: ["d"] });
    const d = baseRule({ id: "d" });
    const issues = validateRuleSet([a, b, c, d]);
    expect(issues.filter((i) => i.code === "recursive_reference")).toEqual([]);
  });

  test("a cycle that also references an orphan id reports both issues without crashing", () => {
    const a = baseRule({ id: "a", suppresses: ["b", "ghost"] });
    const b = baseRule({ id: "b", suppresses: ["a"] });
    const issues = validateRuleSet([a, b]);
    expect(codesFor(issues, "a")).toEqual(expect.arrayContaining(["orphan_reference", "recursive_reference"]));
  });
});

describe("validateRuleSet — a broken rule set never throws", () => {
  test("combines every issue type in one call without throwing", () => {
    const dup1 = baseRule({ id: "dup", version: "v1.0" });
    const dup2 = baseRule({ id: "dup", version: "v2.0" });
    const badOperator = baseRule({ id: "bad_op", condition: { kind: "leaf", field: "x", operator: "nope" as never, value: 1 } });
    const emptyGroup = baseRule({ id: "empty", condition: { kind: "group", logic: "AND", children: [] } });
    const orphan = baseRule({ id: "orphan_src", suppresses: ["ghost"] });
    const cycleA = baseRule({ id: "cycleA", suppresses: ["cycleB"] });
    const cycleB = baseRule({ id: "cycleB", suppresses: ["cycleA"] });

    let issues: ReturnType<typeof validateRuleSet> = [];
    expect(() => {
      issues = validateRuleSet([dup1, dup2, badOperator, emptyGroup, orphan, cycleA, cycleB]);
    }).not.toThrow();

    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toEqual(
      new Set<RuleValidationIssueCode>([
        "duplicate_id",
        "version_conflict",
        "invalid_operator",
        "invalid_condition_tree",
        "orphan_reference",
        "recursive_reference",
      ]),
    );
  });
});
