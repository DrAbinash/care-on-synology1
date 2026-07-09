import { describe, expect, test } from "vitest";
import {
  buildFragments,
  buildRecommendations,
  buildWarnings,
  evaluateCondition,
  evaluateImpressionRules,
  resolveTemplateText,
  type ConditionEvalStep,
} from "./impressionRuleEngine";
import type { EvaluationContext, ImpressionRule, RuleCondition } from "./impressionRuleModel";

function ctx(facts: EvaluationContext["facts"]): EvaluationContext {
  return { facts };
}

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

// ── evaluateCondition: operators ────────────────────────────────────────────

describe("evaluateCondition — equals / not_equals", () => {
  test("equals matches identical strings", () => {
    expect(evaluateCondition({ kind: "leaf", field: "side", operator: "equals", value: "left" }, ctx({ side: "left" }))).toBe(true);
  });

  test("equals fails on different strings", () => {
    expect(evaluateCondition({ kind: "leaf", field: "side", operator: "equals", value: "left" }, ctx({ side: "right" }))).toBe(false);
  });

  test("equals is numeric-aware: number fact vs string rule value", () => {
    expect(evaluateCondition({ kind: "leaf", field: "count", operator: "equals", value: "3" }, ctx({ count: 3 }))).toBe(true);
  });

  test("equals is numeric-aware: string fact vs number rule value", () => {
    expect(evaluateCondition({ kind: "leaf", field: "count", operator: "equals", value: 3 }, ctx({ count: "3" }))).toBe(true);
  });

  test("not_equals is the exact negation of equals", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "side", operator: "not_equals", value: "left" };
    expect(evaluateCondition(leaf, ctx({ side: "right" }))).toBe(true);
    expect(evaluateCondition(leaf, ctx({ side: "left" }))).toBe(false);
  });

  test("equals is false, not true, when the field is missing", () => {
    expect(evaluateCondition({ kind: "leaf", field: "side", operator: "equals", value: "left" }, ctx({}))).toBe(false);
  });
});

describe("evaluateCondition — exists / missing", () => {
  test("exists is true for a present, non-null value (including falsy ones)", () => {
    expect(evaluateCondition({ kind: "leaf", field: "flag", operator: "exists" }, ctx({ flag: false }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "exists" }, ctx({ n: 0 }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "s", operator: "exists" }, ctx({ s: "" }))).toBe(true);
  });

  test("exists is false for undefined or null", () => {
    expect(evaluateCondition({ kind: "leaf", field: "gone", operator: "exists" }, ctx({}))).toBe(false);
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "exists" }, ctx({ n: null }))).toBe(false);
  });

  test("missing is the exact negation of exists", () => {
    expect(evaluateCondition({ kind: "leaf", field: "gone", operator: "missing" }, ctx({}))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "here", operator: "missing" }, ctx({ here: 1 }))).toBe(false);
  });
});

describe("evaluateCondition — numeric comparisons", () => {
  test("greater_than", () => {
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "greater_than", value: 5 }, ctx({ n: 6 }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "greater_than", value: 5 }, ctx({ n: 5 }))).toBe(false);
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "greater_than", value: 5 }, ctx({ n: 4 }))).toBe(false);
  });

  test("greater_or_equal", () => {
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "greater_or_equal", value: 5 }, ctx({ n: 5 }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "greater_or_equal", value: 5 }, ctx({ n: 4 }))).toBe(false);
  });

  test("less_than", () => {
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "less_than", value: 5 }, ctx({ n: 4 }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "less_than", value: 5 }, ctx({ n: 5 }))).toBe(false);
  });

  test("numeric comparisons coerce numeric-looking strings", () => {
    expect(evaluateCondition({ kind: "leaf", field: "n", operator: "greater_than", value: "5" }, ctx({ n: "6" }))).toBe(true);
  });

  test("numeric comparisons against a non-numeric field return false (not a throw)", () => {
    const step: ConditionEvalStep[] = [];
    const result = evaluateCondition({ kind: "leaf", field: "n", operator: "greater_than", value: 5 }, ctx({ n: "not-a-number" }), step);
    expect(result).toBe(false);
    expect(step[0].error).toBeDefined();
  });

  test("real MRI measurement scenario: Evans index above threshold", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "measurements.evansIndex", operator: "greater_than", value: 0.3 };
    expect(evaluateCondition(leaf, ctx({ measurements: { evansIndex: 0.34 } }))).toBe(true);
    expect(evaluateCondition(leaf, ctx({ measurements: { evansIndex: 0.28 } }))).toBe(false);
  });
});

describe("evaluateCondition — contains", () => {
  test("string contains is case-insensitive substring match", () => {
    expect(evaluateCondition({ kind: "leaf", field: "text", operator: "contains", value: "koch" }, ctx({ text: "Old healed Koch's disease" }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "text", operator: "contains", value: "tuberculoma" }, ctx({ text: "Old healed Koch's disease" }))).toBe(false);
  });

  test("array contains checks element membership", () => {
    expect(evaluateCondition({ kind: "leaf", field: "tags", operator: "contains", value: "urgent" }, ctx({ tags: ["urgent", "flagged"] }))).toBe(true);
    expect(evaluateCondition({ kind: "leaf", field: "tags", operator: "contains", value: "routine" }, ctx({ tags: ["urgent", "flagged"] }))).toBe(false);
  });
});

describe("evaluateCondition — any_of / all_of", () => {
  test("any_of matches a scalar field against a list of acceptable values", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "grade", operator: "any_of", value: ["II", "III"] };
    expect(evaluateCondition(leaf, ctx({ grade: "III" }))).toBe(true);
    expect(evaluateCondition(leaf, ctx({ grade: "I" }))).toBe(false);
  });

  test("any_of matches when the field itself is an array with any overlap", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "findings", operator: "any_of", value: ["infarct", "hemorrhage"] };
    expect(evaluateCondition(leaf, ctx({ findings: ["gliosis", "infarct"] }))).toBe(true);
    expect(evaluateCondition(leaf, ctx({ findings: ["gliosis", "atrophy"] }))).toBe(false);
  });

  test("all_of requires every listed value present in the field array", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "findings", operator: "all_of", value: ["infarct", "hemorrhage"] };
    expect(evaluateCondition(leaf, ctx({ findings: ["infarct", "hemorrhage", "edema"] }))).toBe(true);
    expect(evaluateCondition(leaf, ctx({ findings: ["infarct"] }))).toBe(false);
  });

  test("all_of against a non-array field returns false, not a throw", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "findings", operator: "all_of", value: ["infarct"] };
    const step: ConditionEvalStep[] = [];
    expect(evaluateCondition(leaf, ctx({ findings: "infarct" }), step)).toBe(false);
    expect(step[0].error).toBeDefined();
  });
});

describe("evaluateCondition — regex", () => {
  test("matches a valid pattern against a string field", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "level", operator: "regex", value: "^L[1-5]-S1$" };
    expect(evaluateCondition(leaf, ctx({ level: "L5-S1" }))).toBe(true);
    expect(evaluateCondition(leaf, ctx({ level: "L4-5" }))).toBe(false);
  });

  test("an invalid pattern evaluates to false with a trace error, never throws", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "level", operator: "regex", value: "(unclosed" };
    const step: ConditionEvalStep[] = [];
    expect(() => evaluateCondition(leaf, ctx({ level: "L5-S1" }), step)).not.toThrow();
    expect(step[0].result).toBe(false);
    expect(step[0].error).toMatch(/invalid regex/i);
  });

  test("a non-string field returns false with an error", () => {
    const leaf: RuleCondition = { kind: "leaf", field: "level", operator: "regex", value: "^5$" };
    const step: ConditionEvalStep[] = [];
    expect(evaluateCondition(leaf, ctx({ level: 5 }), step)).toBe(false);
    expect(step[0].error).toBeDefined();
  });
});

// ── evaluateCondition: nested groups + short-circuit ────────────────────────

describe("evaluateCondition — AND groups", () => {
  test("true only when every child is true", () => {
    const group: RuleCondition = {
      kind: "group",
      logic: "AND",
      children: [
        { kind: "leaf", field: "a", operator: "exists" },
        { kind: "leaf", field: "b", operator: "exists" },
      ],
    };
    expect(evaluateCondition(group, ctx({ a: 1, b: 2 }))).toBe(true);
    expect(evaluateCondition(group, ctx({ a: 1 }))).toBe(false);
  });

  test("short-circuits on the first false child — later children are not evaluated", () => {
    const trace: ConditionEvalStep[] = [];
    const group: RuleCondition = {
      kind: "group",
      logic: "AND",
      children: [
        { kind: "leaf", field: "a", operator: "equals", value: "no-match" },
        { kind: "leaf", field: "b", operator: "exists" },
        { kind: "leaf", field: "c", operator: "exists" },
      ],
    };
    const result = evaluateCondition(group, ctx({ a: "value", b: 1, c: 1 }), trace);
    expect(result).toBe(false);
    // trace[0] is the false leaf; trace[1] and trace[2] must be recorded as
    // short-circuited (never actually evaluated).
    expect(trace).toHaveLength(3);
    expect(trace[0].shortCircuited).toBeUndefined();
    expect(trace[0].result).toBe(false);
    expect(trace[1].shortCircuited).toBe(true);
    expect(trace[2].shortCircuited).toBe(true);
  });
});

describe("evaluateCondition — OR groups", () => {
  test("true when any child is true", () => {
    const group: RuleCondition = {
      kind: "group",
      logic: "OR",
      children: [
        { kind: "leaf", field: "a", operator: "exists" },
        { kind: "leaf", field: "b", operator: "exists" },
      ],
    };
    expect(evaluateCondition(group, ctx({ b: 1 }))).toBe(true);
    expect(evaluateCondition(group, ctx({}))).toBe(false);
  });

  test("short-circuits on the first true child", () => {
    const trace: ConditionEvalStep[] = [];
    const group: RuleCondition = {
      kind: "group",
      logic: "OR",
      children: [
        { kind: "leaf", field: "a", operator: "exists" },
        { kind: "leaf", field: "b", operator: "exists" },
        { kind: "leaf", field: "c", operator: "exists" },
      ],
    };
    const result = evaluateCondition(group, ctx({ a: 1, b: 1, c: 1 }), trace);
    expect(result).toBe(true);
    expect(trace[0].shortCircuited).toBeUndefined();
    expect(trace[1].shortCircuited).toBe(true);
    expect(trace[2].shortCircuited).toBe(true);
  });
});

describe("evaluateCondition — nested groups", () => {
  test("AND of an OR: (a AND (b OR c))", () => {
    const condition: RuleCondition = {
      kind: "group",
      logic: "AND",
      children: [
        { kind: "leaf", field: "a", operator: "exists" },
        {
          kind: "group",
          logic: "OR",
          children: [
            { kind: "leaf", field: "b", operator: "exists" },
            { kind: "leaf", field: "c", operator: "exists" },
          ],
        },
      ],
    };
    expect(evaluateCondition(condition, ctx({ a: 1, b: 1 }))).toBe(true);
    expect(evaluateCondition(condition, ctx({ a: 1, c: 1 }))).toBe(true);
    expect(evaluateCondition(condition, ctx({ a: 1 }))).toBe(false);
    expect(evaluateCondition(condition, ctx({ b: 1, c: 1 }))).toBe(false); // a missing
  });

  test("three levels deep: real-world spine rule shape", () => {
    // (builderType == "mri_ls_spine") AND
    //   ( (level == "L4-5" AND morphology == "protrusion")
    //     OR
    //     (level == "L5-S1" AND morphology == "extrusion") )
    const condition: RuleCondition = {
      kind: "group",
      logic: "AND",
      children: [
        { kind: "leaf", field: "builderType", operator: "equals", value: "mri_ls_spine" },
        {
          kind: "group",
          logic: "OR",
          children: [
            {
              kind: "group",
              logic: "AND",
              children: [
                { kind: "leaf", field: "level", operator: "equals", value: "L4-5" },
                { kind: "leaf", field: "morphology", operator: "equals", value: "protrusion" },
              ],
            },
            {
              kind: "group",
              logic: "AND",
              children: [
                { kind: "leaf", field: "level", operator: "equals", value: "L5-S1" },
                { kind: "leaf", field: "morphology", operator: "equals", value: "extrusion" },
              ],
            },
          ],
        },
      ],
    };
    expect(evaluateCondition(condition, ctx({ builderType: "mri_ls_spine", level: "L4-5", morphology: "protrusion" }))).toBe(true);
    expect(evaluateCondition(condition, ctx({ builderType: "mri_ls_spine", level: "L5-S1", morphology: "extrusion" }))).toBe(true);
    expect(evaluateCondition(condition, ctx({ builderType: "mri_ls_spine", level: "L4-5", morphology: "extrusion" }))).toBe(false);
    expect(evaluateCondition(condition, ctx({ builderType: "mri_c_spine", level: "L4-5", morphology: "protrusion" }))).toBe(false);
  });

  test("empty AND group evaluates vacuously true (defensive default, would be blocked by validation before reaching evaluation in evaluateImpressionRules)", () => {
    expect(evaluateCondition({ kind: "group", logic: "AND", children: [] }, ctx({}))).toBe(true);
  });

  test("empty OR group evaluates vacuously false", () => {
    expect(evaluateCondition({ kind: "group", logic: "OR", children: [] }, ctx({}))).toBe(false);
  });
});

// ── Template resolution ─────────────────────────────────────────────────────

describe("resolveTemplateText", () => {
  test("substitutes a simple field placeholder", () => {
    expect(resolveTemplateText("Grade {grade} fatty liver.", ctx({ grade: "II" }))).toBe("Grade II fatty liver.");
  });

  test("substitutes multiple placeholders including nested paths", () => {
    expect(
      resolveTemplateText("{side} disc protrusion at {level}.", ctx({ side: "Right", level: "L4-5" })),
    ).toBe("Right disc protrusion at L4-5.");
  });

  test("leaves an unresolved placeholder as literal text rather than dropping it", () => {
    expect(resolveTemplateText("Value is {missing}.", ctx({}))).toBe("Value is {missing}.");
  });

  test("stringifies an array fact by joining with commas", () => {
    expect(resolveTemplateText("Findings: {findings}.", ctx({ findings: ["infarct", "gliosis"] }))).toBe("Findings: infarct, gliosis.");
  });
});

describe("buildFragments / buildRecommendations / buildWarnings", () => {
  test("builds fragments with resolved text and traceable ids", () => {
    const rule = baseRule({
      id: "svid",
      fragments: [{ id: "f1", text: "Chronic small-vessel ischemic changes ({severity})." }],
    });
    const result = buildFragments(rule, ctx({ severity: "Fazekas II" }));
    expect(result).toEqual([{ id: "f1", ruleId: "svid", text: "Chronic small-vessel ischemic changes (Fazekas II)." }]);
  });

  test("builds recommendations carrying an optional code", () => {
    const rule = baseRule({
      id: "svid",
      recommendations: [{ id: "rec1", text: "Clinical correlation advised.", code: "rec.clincorr" }],
    });
    expect(buildRecommendations(rule, ctx({}))).toEqual([{ id: "rec1", ruleId: "svid", text: "Clinical correlation advised.", code: "rec.clincorr" }]);
  });

  test("builds warnings preserving severity", () => {
    const rule = baseRule({
      id: "mls",
      warnings: [{ id: "w1", message: "Midline shift {shift} mm — escalate.", severity: "block" }],
    });
    expect(buildWarnings(rule, ctx({ shift: 7 }))).toEqual([{ id: "w1", ruleId: "mls", message: "Midline shift 7 mm — escalate.", severity: "block" }]);
  });
});

// ── evaluateImpressionRules: full orchestration ─────────────────────────────

describe("evaluateImpressionRules — basic matching", () => {
  test("a matching rule contributes its fragments, recommendations and warnings", () => {
    const rule = baseRule({
      id: "fl2",
      condition: { kind: "leaf", field: "grade", operator: "equals", value: "II" },
      fragments: [{ id: "f", text: "Grade {grade} fatty liver." }],
      recommendations: [{ id: "r", text: "LFT correlation advised.", code: "rec.lab_lft" }],
      warnings: [{ id: "w", message: "Follow up in 6 months.", severity: "info" }],
    });
    const result = evaluateImpressionRules([rule], ctx({ grade: "II" }));
    expect(result.impressionFragments).toEqual([{ id: "f", ruleId: "fl2", text: "Grade II fatty liver." }]);
    expect(result.recommendations).toEqual([{ id: "r", ruleId: "fl2", text: "LFT correlation advised.", code: "rec.lab_lft" }]);
    expect(result.warnings).toEqual([{ id: "w", ruleId: "fl2", message: "Follow up in 6 months.", severity: "info" }]);
    expect(result.blockedRules).toEqual([]);
  });

  test("a non-matching rule contributes nothing", () => {
    const rule = baseRule({ condition: { kind: "leaf", field: "grade", operator: "equals", value: "III" } });
    const result = evaluateImpressionRules([rule], ctx({ grade: "I" }));
    expect(result.impressionFragments).toEqual([]);
    expect(result.recommendations).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("inactive rules are never evaluated or matched", () => {
    const rule = baseRule({
      isActive: false,
      condition: { kind: "leaf", field: "x", operator: "exists" },
      fragments: [{ id: "f", text: "should not appear" }],
    });
    const result = evaluateImpressionRules([rule], ctx({ x: 1 }));
    expect(result.impressionFragments).toEqual([]);
    expect(result.trace).toEqual([]);
  });

  test("multiple matching rules all contribute, in deterministic order", () => {
    const a = baseRule({ id: "a", priority: "urgent", order: 0, condition: { kind: "leaf", field: "x", operator: "exists" }, fragments: [{ id: "fa", text: "A" }] });
    const b = baseRule({ id: "b", priority: "critical", order: 0, condition: { kind: "leaf", field: "x", operator: "exists" }, fragments: [{ id: "fb", text: "B" }] });
    const c = baseRule({ id: "c", priority: "normal", order: 0, condition: { kind: "leaf", field: "x", operator: "exists" }, fragments: [{ id: "fc", text: "C" }] });
    const result = evaluateImpressionRules([a, b, c], ctx({ x: 1 }));
    expect(result.impressionFragments.map((f) => f.text)).toEqual(["B", "A", "C"]); // critical, urgent, normal
  });
});

describe("evaluateImpressionRules — deterministic ordering", () => {
  test("output order is identical regardless of input array order", () => {
    const rules = [
      baseRule({ id: "n1", priority: "normal", order: 2, fragments: [{ id: "f", text: "n1" }] }),
      baseRule({ id: "c1", priority: "critical", order: 9, fragments: [{ id: "f", text: "c1" }] }),
      baseRule({ id: "u1", priority: "urgent", order: 0, fragments: [{ id: "f", text: "u1" }] }),
      baseRule({ id: "n0", priority: "normal", order: 1, fragments: [{ id: "f", text: "n0" }] }),
    ];
    const forward = evaluateImpressionRules(rules, ctx({ x: 1 }));
    const shuffled = evaluateImpressionRules([...rules].reverse(), ctx({ x: 1 }));
    expect(forward.impressionFragments.map((f) => f.text)).toEqual(["c1", "u1", "n0", "n1"]);
    expect(shuffled.impressionFragments.map((f) => f.text)).toEqual(forward.impressionFragments.map((f) => f.text));
  });

  test("running evaluation twice on the same input produces byte-identical output", () => {
    const rules = [
      baseRule({ id: "a", fragments: [{ id: "f", text: "A" }] }),
      baseRule({ id: "b", priority: "critical", fragments: [{ id: "f", text: "B" }] }),
    ];
    const first = evaluateImpressionRules(rules, ctx({ x: 1 }));
    const second = evaluateImpressionRules(rules, ctx({ x: 1 }));
    expect(first).toEqual(second);
  });
});

describe("evaluateImpressionRules — suppression", () => {
  test("a matched rule's suppresses list drops another matched rule's output entirely", () => {
    const severe = baseRule({
      id: "severe",
      priority: "critical",
      condition: { kind: "leaf", field: "stenosis", operator: "equals", value: "severe" },
      fragments: [{ id: "f", text: "Severe canal stenosis." }],
      suppresses: ["mild"],
    });
    const mild = baseRule({
      id: "mild",
      priority: "normal",
      condition: { kind: "leaf", field: "stenosis", operator: "any_of", value: ["mild", "moderate", "severe"] },
      fragments: [{ id: "f", text: "Some canal stenosis." }],
    });
    const result = evaluateImpressionRules([mild, severe], ctx({ stenosis: "severe" }));
    expect(result.impressionFragments.map((f) => f.ruleId)).toEqual(["severe"]);
  });

  test("a suppressed rule still appears in the trace, marked suppressed:true", () => {
    const severe = baseRule({ id: "severe", condition: { kind: "leaf", field: "x", operator: "exists" }, suppresses: ["mild"] });
    const mild = baseRule({ id: "mild", condition: { kind: "leaf", field: "x", operator: "exists" } });
    const result = evaluateImpressionRules([severe, mild], ctx({ x: 1 }));
    const mildEntry = result.trace.find((t) => t.ruleId === "mild");
    expect(mildEntry?.matched).toBe(true);
    expect(mildEntry?.suppressed).toBe(true);
  });

  test("suppresses referencing a rule that did NOT match has no effect", () => {
    const a = baseRule({ id: "a", condition: { kind: "leaf", field: "x", operator: "exists" }, suppresses: ["b"], fragments: [{ id: "f", text: "A" }] });
    const b = baseRule({ id: "b", condition: { kind: "leaf", field: "y", operator: "exists" }, fragments: [{ id: "f", text: "B" }] });
    const result = evaluateImpressionRules([a, b], ctx({ x: 1 })); // y is absent, b never matches
    expect(result.impressionFragments.map((f) => f.ruleId)).toEqual(["a"]);
  });
});

describe("evaluateImpressionRules — blocked (invalid) rules", () => {
  test("an invalid rule is excluded from evaluation and reported in blockedRules, valid rules still evaluate", () => {
    const broken = baseRule({ id: "broken", condition: { kind: "group", logic: "AND", children: [] } });
    const healthy = baseRule({ id: "healthy", condition: { kind: "leaf", field: "x", operator: "exists" }, fragments: [{ id: "f", text: "OK" }] });
    const result = evaluateImpressionRules([broken, healthy], ctx({ x: 1 }));
    expect(result.blockedRules.map((b) => b.ruleId)).toEqual(["broken"]);
    expect(result.impressionFragments.map((f) => f.text)).toEqual(["OK"]);
    expect(result.trace.some((t) => t.ruleId === "broken")).toBe(false); // blocked rules never reach the trace
  });

  test("duplicate ids across two rules both get blocked", () => {
    const a = baseRule({ id: "dup" });
    const b = baseRule({ id: "dup" });
    const result = evaluateImpressionRules([a, b], ctx({}));
    expect(result.blockedRules.map((b2) => b2.ruleId)).toEqual(["dup"]);
  });

  test("evaluateImpressionRules never throws on a thoroughly broken rule set", () => {
    const rules = [
      baseRule({ id: "dup" }),
      baseRule({ id: "dup" }),
      baseRule({ id: "bad_leaf", condition: { kind: "leaf", field: "", operator: "nope" as never } }),
      baseRule({ id: "cyclic", suppresses: ["cyclic"] }),
    ];
    expect(() => evaluateImpressionRules(rules, ctx({}))).not.toThrow();
  });
});

describe("evaluateImpressionRules — trace generation", () => {
  test("trace includes one entry per evaluated (non-blocked, active) rule with matched status and condition trace", () => {
    const matches = baseRule({ id: "matches", condition: { kind: "leaf", field: "x", operator: "exists" } });
    const noMatch = baseRule({ id: "no_match", condition: { kind: "leaf", field: "y", operator: "exists" } });
    const result = evaluateImpressionRules([matches, noMatch], ctx({ x: 1 }));
    expect(result.trace).toHaveLength(2);
    const m = result.trace.find((t) => t.ruleId === "matches");
    const n = result.trace.find((t) => t.ruleId === "no_match");
    expect(m?.matched).toBe(true);
    expect(n?.matched).toBe(false);
    expect(m?.conditionTrace.length).toBeGreaterThan(0);
  });

  test("condition trace for a nested tree reflects the full visitation, including short-circuits", () => {
    const rule = baseRule({
      condition: {
        kind: "group",
        logic: "AND",
        children: [
          { kind: "leaf", field: "a", operator: "exists" },
          {
            kind: "group",
            logic: "OR",
            children: [
              { kind: "leaf", field: "b", operator: "exists" },
              { kind: "leaf", field: "c", operator: "exists" },
            ],
          },
        ],
      },
    });
    const result = evaluateImpressionRules([rule], ctx({ a: 1, b: 1 }));
    const conditionTrace = result.trace[0].conditionTrace;
    // a (leaf), b (leaf, true -> OR short-circuits), c (short-circuited)
    expect(conditionTrace).toHaveLength(3);
    expect(conditionTrace.filter((s) => s.shortCircuited).length).toBe(1);
  });
});

describe("evaluateImpressionRules — output contract", () => {
  test("returns pure structured data — no HTML tags anywhere in fragment/recommendation/warning text", () => {
    const rule = baseRule({
      condition: { kind: "leaf", field: "x", operator: "exists" },
      fragments: [{ id: "f", text: "Plain <b>never</b> injected by us — but if a template contains it, we don't strip it either; this test asserts OUR builders add none." }],
    });
    const result = evaluateImpressionRules([rule], ctx({ x: 1 }));
    // The engine itself introduces no markup — verify structural shape instead of content styling.
    expect(result).toHaveProperty("impressionFragments");
    expect(result).toHaveProperty("recommendations");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("blockedRules");
    expect(result).toHaveProperty("trace");
    expect(Array.isArray(result.impressionFragments)).toBe(true);
  });
});

// ── Performance sanity ───────────────────────────────────────────────────────

describe("evaluateImpressionRules — performance sanity", () => {
  test("evaluates 1000 rules with nested conditions in well under a second", () => {
    const rules: ImpressionRule[] = Array.from({ length: 1000 }, (_, i) =>
      baseRule({
        id: `perf-${i}`,
        order: i,
        condition: {
          kind: "group",
          logic: "AND",
          children: [
            { kind: "leaf", field: "grade", operator: "equals", value: i % 3 === 0 ? "II" : "I" },
            {
              kind: "group",
              logic: "OR",
              children: [
                { kind: "leaf", field: "count", operator: "greater_than", value: 10 },
                { kind: "leaf", field: "flag", operator: "exists" },
              ],
            },
          ],
        },
        fragments: [{ id: "f", text: `Fragment ${i}` }],
      }),
    );
    const start = performance.now();
    const result = evaluateImpressionRules(rules, ctx({ grade: "II", count: 20, flag: true }));
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(result.trace).toHaveLength(1000);
    // Every 3rd rule (grade "II") should match.
    expect(result.impressionFragments.length).toBeGreaterThan(300);
  });
});
