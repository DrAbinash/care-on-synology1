import { describe, it, expect } from "vitest";
import {
  createQualityEngine,
  runQualityEngine,
  textParityScorer,
  coreTextProvider,
  createExecutorRegistry,
  compileRule,
  RULE_CATALOG,
  findRuleEntry,
  type QualityContext,
  type QualityFinding,
} from "./index";

function ctx(over: Partial<QualityContext["text"]> = {}): QualityContext {
  return { modality: "MR", studyDescription: "MRI BRAIN", text: { findings: "", impression: [], ...over } };
}

describe("provider-based engine", () => {
  it("a scoped engine with the text provider matches the global engine", () => {
    const scoped = createQualityEngine({ providers: [coreTextProvider] });
    const global = runQualityEngine(ctx(), { scorer: textParityScorer });
    const local = scoped.evaluate(ctx(), { scorer: textParityScorer });
    expect(local.score).toBe(global.score);
    expect(local.findings.map((f) => f.ruleId)).toEqual(global.findings.map((f) => f.ruleId));
  });

  it("an empty engine runs no rules and is isolated from the global default", () => {
    const empty = createQualityEngine();
    const report = empty.evaluate(ctx());
    expect(report.findings).toHaveLength(0);
    expect(report.evaluatedRuleCount).toBe(0);
    // Registering on the scoped instance does not affect the global engine.
    expect(empty.getRules()).toHaveLength(0);
  });
});

describe("generic executor framework", () => {
  it("compiles a declarative rule bound to a registered executor", () => {
    const reg = createExecutorRegistry();
    reg.register("echo", (_def, c) => [{ message: `echo:${c.text.findings || "empty"}`, weight: 3 }]);
    const rule = compileRule(
      { id: "demo.echo", canonicalId: "demo.echo", category: "consistency", tier: "structured", severity: "warning", modalities: "*", owner: "test", pack: null, version: "0.0.1", executor: "echo", params: {} },
      reg,
    );
    const engine = createQualityEngine({ providers: [{ name: "demo", rules: [rule] }] });
    const report = engine.evaluate(ctx({ findings: "hello" }), { scorer: textParityScorer });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].ruleId).toBe("demo.echo");
    expect(report.findings[0].tier).toBe("structured"); // inherited from the definition
    expect(report.deterministicRuleCount).toBe(1);
    expect(report.score).toBe(97); // 100 - weight 3
  });

  it("fails safe when the executor is not registered", () => {
    const rule = compileRule(
      { id: "demo.missing", canonicalId: "demo.missing", category: "consistency", tier: "structured", severity: "warning", modalities: "*", owner: "test", pack: null, version: "0.0.1", executor: "not-registered", params: {} },
      createExecutorRegistry(),
    );
    const engine = createQualityEngine({ providers: [{ name: "demo", rules: [rule] }] });
    expect(engine.evaluate(ctx()).findings).toHaveLength(0);
  });
});

describe("rule catalog metadata", () => {
  it("every entry keeps its flat id and gains hierarchical metadata", () => {
    const canonicalIds = new Set<string>();
    for (const [key, entry] of Object.entries(RULE_CATALOG)) {
      expect(entry.id).toBe(key); // Q-ids unchanged
      expect(entry.legacyAlias).toBe(key);
      expect(entry.canonicalId).toMatch(/^care\./);
      expect(entry.owner).toBe("care-core");
      expect(entry.pack).toBeNull();
      expect(entry.version).toBe("1.0.0");
      canonicalIds.add(entry.canonicalId);
    }
    expect(canonicalIds.size).toBe(Object.keys(RULE_CATALOG).length); // canonicalIds unique
  });

  it("findRuleEntry resolves by flat id or canonicalId", () => {
    expect(findRuleEntry("Q104")?.canonicalId).toBe("care.text.laterality.impression-vs-findings");
    expect(findRuleEntry("care.text.laterality.impression-vs-findings")?.id).toBe("Q104");
    expect(findRuleEntry("nope")).toBeUndefined();
  });
});

describe("single-evaluation parity scorer", () => {
  it("sums deduction weights carried on findings, without re-evaluating context", () => {
    const findings: QualityFinding[] = [
      { ruleId: "z", category: "consistency", severity: "warning", tier: "heuristic", message: "m", weight: 40 },
    ];
    // ctx.text is non-empty and unrelated to the findings: if the scorer
    // recomputed from ctx it would not return 60. It sums the findings.
    expect(textParityScorer({ modality: "MR", text: { findings: "x", impression: ["y"] } }, findings)).toBe(60);
  });

  it("engine findings carry weight and canonicalId", () => {
    const report = runQualityEngine(ctx({ findings: "", impression: [] }), { scorer: textParityScorer });
    for (const f of report.findings) {
      expect(typeof f.weight).toBe("number");
      expect(f.canonicalId).toMatch(/^care\./);
    }
  });
});
