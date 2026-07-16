// engine.ts — provider-based quality engine (Phase 2.5).
//
// createQualityEngine({ providers }) returns an INSTANCE with its own rule
// registry, so callers compose only the rule sets they need (a per-modality
// bundle, a knowledge pack, the text tier). This unlocks scoping, lazy loading,
// tree-shaking and testability without the global-singleton pitfalls.
//
// A single `defaultEngine` instance backs the global façade (registry.ts +
// runner.ts), so all existing imports — registerRule(), runQualityEngine() —
// keep working unchanged. Nothing about runtime behaviour changes.

import type { QualityContext, QualityFinding, QualityReport, QualityRule, RunOptions } from "./contract";
import { normalizeModality, modalityMatches } from "./modality";
import { defaultScorer } from "./score";
import { REPORT_QUALITY_ENGINE_VERSION } from "./version";
import { RULE_CATALOG_VERSION } from "./ruleCatalog";
import { nowMs } from "./clock";

/** A composable bundle of rules (a tier, a modality set, a pack). */
export interface RuleProvider {
  name: string;
  rules: QualityRule[];
}

/** An engine instance with its own registry. */
export interface QualityEngine {
  register(rule: QualityRule): void;
  registerMany(rules: QualityRule[]): void;
  getRules(): QualityRule[];
  getRule(id: string): QualityRule | undefined;
  clear(): void;
  evaluate(ctx: QualityContext, opts?: RunOptions): QualityReport;
}

/** Create an isolated engine, optionally seeded from providers. */
export function createQualityEngine(config?: { providers?: RuleProvider[] }): QualityEngine {
  const registry = new Map<string, QualityRule>();
  const register = (rule: QualityRule): void => {
    registry.set(rule.id, rule);
  };
  for (const provider of config?.providers ?? []) {
    for (const rule of provider.rules) register(rule);
  }
  return {
    register,
    registerMany: (rules) => {
      for (const rule of rules) register(rule);
    },
    getRules: () => [...registry.values()],
    getRule: (id) => registry.get(id),
    clear: () => registry.clear(),
    evaluate: (ctx, opts) => runRules([...registry.values()], ctx, opts),
  };
}

function selectRules(rules: QualityRule[], ctx: QualityContext, opts: RunOptions | undefined): {
  runnable: QualityRule[];
  notEvaluated: string[];
} {
  const canonical = normalizeModality(ctx.modality);
  const only = opts?.onlyRuleIds ? new Set(opts.onlyRuleIds) : null;
  const runnable: QualityRule[] = [];
  const notEvaluated: string[] = [];
  for (const rule of rules) {
    if (only && !only.has(rule.id)) continue;
    if (!modalityMatches(rule.modalities, canonical)) continue;
    const missing = (rule.requires ?? []).filter((key) => ctx[key] === undefined);
    if (missing.length > 0) {
      notEvaluated.push(rule.id);
      continue;
    }
    runnable.push(rule);
  }
  return { runnable, notEvaluated };
}

/**
 * The core run logic — pure over an explicit rule list. Same behaviour as the
 * pre-2.5 runner: selects by modality, gates on required data, isolates
 * throwing rules, stamps findings, measures runtime + tier counts + versioning.
 */
export function runRules(rules: QualityRule[], ctx: QualityContext, opts?: RunOptions): QualityReport {
  const clock = opts?.now ?? nowMs;
  const startedAt = clock();

  const canonicalModality = normalizeModality(ctx.modality);
  const { runnable, notEvaluated } = selectRules(rules, ctx, opts);
  const findings: QualityFinding[] = [];
  let evaluatedRuleCount = 0;
  let deterministicRuleCount = 0;
  let heuristicRuleCount = 0;

  for (const rule of runnable) {
    try {
      const out = rule.evaluate(ctx);
      if (out && out.length) {
        for (const f of out) {
          findings.push({
            ...f,
            modality: f.modality ?? canonicalModality,
            studyType: f.studyType ?? ctx.studyDescription,
          });
        }
      }
      evaluatedRuleCount++;
      if (rule.tier === "structured") deterministicRuleCount++;
      else heuristicRuleCount++;
    } catch {
      notEvaluated.push(rule.id);
    }
  }

  const blockingCount = findings.filter((f) => f.severity === "blocker").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;
  const scorer = opts?.scorer ?? defaultScorer;

  return {
    score: scorer(ctx, findings),
    findings,
    blockingCount,
    warningCount,
    infoCount,
    notEvaluated,
    evaluatedRuleCount,
    deterministicRuleCount,
    heuristicRuleCount,
    runtimeMs: Math.max(0, clock() - startedAt),
    engineVersion: REPORT_QUALITY_ENGINE_VERSION,
    ruleVersion: RULE_CATALOG_VERSION,
    knowledgePackVersion: opts?.knowledgePackVersion ?? null,
    evaluatedAt: opts?.evaluatedAtIso ?? new Date().toISOString(),
  };
}

/** The single global engine instance backing the compatibility façade. */
export const defaultEngine: QualityEngine = createQualityEngine();
