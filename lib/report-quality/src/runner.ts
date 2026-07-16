// runner.ts — runQualityEngine(): the ONE entry point.
//
// Selects registered rules by canonical modality, runs only those whose
// required structured data is present (recording the rest as notEvaluated for
// honest coverage reporting), stamps each finding with modality/study type,
// aggregates findings, measures runtime + rule-tier counts, and stamps
// versioning for reproducibility. A rule that throws is isolated — it can never
// break finalize.

import type { QualityContext, QualityFinding, QualityReport, QualityRule, RunOptions } from "./contract";
import { getRegisteredRules } from "./registry";
import { normalizeModality, modalityMatches } from "./modality";
import { defaultScorer } from "./score";
import { REPORT_QUALITY_ENGINE_VERSION } from "./version";
import { RULE_CATALOG_VERSION } from "./ruleCatalog";
import { nowMs } from "./clock";

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
 * Deterministic (except runtimeMs/evaluatedAt): same context + rules → same findings + score.
 */
export function runQualityEngine(ctx: QualityContext, opts?: RunOptions): QualityReport {
  const clock = opts?.now ?? nowMs;
  const startedAt = clock();

  const canonicalModality = normalizeModality(ctx.modality);
  const { runnable, notEvaluated } = selectRules(ctx, opts);
  const findings: QualityFinding[] = [];
  let evaluatedRuleCount = 0;
  let deterministicRuleCount = 0;
  let heuristicRuleCount = 0;

  for (const rule of runnable) {
    try {
      const out = rule.evaluate(ctx);
      if (out && out.length) {
        for (const f of out) {
          // Stamp modality/study type so each finding is self-describing for
          // analytics without depending on the enclosing report.
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
    deterministicRuleCount,
    heuristicRuleCount,
    runtimeMs: Math.max(0, clock() - startedAt),
    engineVersion: REPORT_QUALITY_ENGINE_VERSION,
    ruleVersion: RULE_CATALOG_VERSION,
    knowledgePackVersion: opts?.knowledgePackVersion ?? null,
    evaluatedAt: opts?.evaluatedAtIso ?? new Date().toISOString(),
  };
}
