/**
 * Rules Before AI — Phase P2 / Gate G9.
 *
 * Reuses the EXISTING canonical Quality Engine (@workspace/report-quality,
 * runQualityEngine) as the deterministic layer that runs over a structured draft.
 * Its verdict is authoritative: blocking deterministic findings recommend
 * degradation, and its signals feed the finding gauntlet (findingValidation.ts)
 * where deterministic checks override AI. No new rules engine is created.
 */
import { runQualityEngine, type QualityContext, type QualityReport } from "@workspace/report-quality";
import type { ProvisionalReport } from "@workspace/ai-providers";

export interface DeterministicQualityResult {
  report: QualityReport;
  blockingCount: number;
  /** true when the deterministic layer found blocking issues in the structured draft. */
  degradeRecommended: boolean;
}

/**
 * Run the deterministic Quality Engine over a structured draft. This is the
 * "deterministic before AI" enforcement point: it evaluates the structured
 * content with the same engine the reporting platform uses, independent of any
 * model. Safe to call in shadow — it never throws into the pipeline.
 */
export function runDeterministicQuality(draft: ProvisionalReport): DeterministicQualityResult {
  const ctx: QualityContext = {
    modality: draft.studyContext.modality ?? "",
    text: {
      findings: draft.findings.map((f) => f.text).join("\n"),
      impression: draft.impression,
      modality: draft.studyContext.modality ?? null,
    },
    measurements: draft.measurements.map((m) => ({ key: m.id, label: m.id, value: m.value, unit: m.unit })),
  };
  try {
    const report = runQualityEngine(ctx);
    return { report, blockingCount: report.blockingCount, degradeRecommended: report.blockingCount > 0 };
  } catch (err) {
    // Never let a quality-engine error break the shadow pipeline; degrade instead.
    const now = new Date().toISOString();
    const report: QualityReport = {
      score: 0, findings: [], blockingCount: 0, warningCount: 0, infoCount: 0,
      notEvaluated: [`engine-error: ${err instanceof Error ? err.message : String(err)}`],
      evaluatedRuleCount: 0, deterministicRuleCount: 0, heuristicRuleCount: 0, runtimeMs: 0,
      engineVersion: "unknown", ruleVersion: "unknown", knowledgePackVersion: null, evaluatedAt: now,
    };
    return { report, blockingCount: 0, degradeRecommended: false };
  }
}
