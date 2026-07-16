// runner.ts — runQualityEngine(): the ONE entry point.
//
// Selects registered rules by canonical modality, runs only those whose
// required structured data is present (recording the rest as notEvaluated for
// honest coverage reporting), aggregates their findings, and scores the report.
// A rule that throws is isolated — it can never break finalize.

import type { QualityContext, QualityReport, QualityRule, RunOptions } from "./contract";
import { getRegisteredRules } from "./registry";
import { normalizeModality, modalityMatches } from "./modality";
import { defaultScorer } from "./score";
import { REPORT_QUALITY_ENGINE_VERSION } from "./version";

function selectRules(ctx: QualityContext, opts: RunOptions | undefined): {
  runnable: QualityRule[];
  notEvaluated: string[];
} {
  const canonical = normalizeModality(ctx.modality);
  const only = opts?.onlyRuleIds ? new Set(opts.onlyRuleIds) : null;
  const runnable: QualityRule[] = [];
  const notEvaluated: string[] = [];

  for (const rule of getRegisteredRules()) {
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
 * Run the universal quality engine over one report context.
 * Deterministic: same context + same registered rules → same report.
 */
export function runQualityEngine(ctx: QualityContext, opts?: RunOptions): QualityReport {
  const { runnable, notEvaluated } = selectRules(ctx, opts);
  const findings: QualityReport["findings"] = [];
  let evaluatedRuleCount = 0;

  for (const rule of runnable) {
    try {
      const out = rule.evaluate(ctx);
      if (out && out.length) findings.push(...out);
      evaluatedRuleCount++;
    } catch {
      // A misbehaving rule must never break the report or finalize — isolate it.
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
    engineVersion: REPORT_QUALITY_ENGINE_VERSION,
  };
}
