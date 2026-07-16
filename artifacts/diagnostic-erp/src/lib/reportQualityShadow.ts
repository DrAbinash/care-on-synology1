// reportQualityShadow.ts — Phase 1 shadow-first parity harness (PR #101).
//
// Runs the LEGACY validator/score (./reportValidator — the live, user-visible
// source) and the CANONICAL engine (@workspace/report-quality) in parallel and
// reports differences. This module NEVER changes what the radiologist sees; the
// legacy path stays authoritative until golden parity is demonstrated. Parity
// mismatches are logged in development only.
//
// Strangler façade: the engine coexists with the legacy validator; once parity
// is proven and callers are migrated, the legacy validator is retired. Nothing
// is deleted in this phase.

import { computeQualityScore, validateReport, type QualityInput } from "./reportValidator";
import { runQualityEngine, textParityScorer, type QualityContext } from "@workspace/report-quality";

export interface ParityResult {
  legacyScore: number;
  engineScore: number;
  scoreMatches: boolean;
  legacyIssues: string[];
  engineIssues: string[];
  issuesMatch: boolean;
  legacyWarnings: string[];
  engineWarnings: string[];
  warningsMatch: boolean;
}

/** Map the workspace's legacy quality input to a canonical QualityContext. */
export function buildQualityContext(input: QualityInput): QualityContext {
  return {
    modality: input.modality ?? "",
    studyDescription: input.studyDescription ?? undefined,
    text: {
      findings: input.findings,
      impression: input.impression,
      recommendation: input.recommendation,
      technique: input.technique,
      clinicalHistory: input.clinicalHistory,
      sex: input.sex,
      age: input.age,
      modality: input.modality,
      studyDescription: input.studyDescription,
      checklistPercent: input.checklistPercent,
      missingRequiredMeasurements: input.missingRequiredMeasurements,
    },
  };
}

const orderedEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Run legacy and engine paths and diff them. Pure — safe to call anywhere. */
export function computeParity(input: QualityInput): ParityResult {
  const legacy = computeQualityScore(input);
  const legacyWarnings = validateReport(input);

  const report = runQualityEngine(buildQualityContext(input), { scorer: textParityScorer });
  const engineIssues = report.findings.map((f) => f.message);

  // The engine's "warnings" subset = issues that are also legacy validateReport
  // warnings (i.e. excluding the completeness/checklist/measurement deductions
  // that only the score adds). Used to parity-check the finalize-dialog path.
  const legacyWarnSet = new Set(legacyWarnings);
  const engineWarnings = engineIssues.filter((m) => legacyWarnSet.has(m));

  return {
    legacyScore: legacy.score,
    engineScore: report.score,
    scoreMatches: legacy.score === report.score,
    legacyIssues: legacy.issues,
    engineIssues,
    issuesMatch: orderedEqual(legacy.issues, engineIssues),
    legacyWarnings,
    engineWarnings,
    warningsMatch: orderedEqual([...legacyWarnings].sort(), [...engineWarnings].sort()),
  };
}

/**
 * Development-only shadow: compute parity and log mismatches. No-op in
 * production and can never throw into the caller — the shadow must not affect
 * the reporting workspace in any way.
 */
export function logParityInDev(input: QualityInput): void {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    if (!env?.DEV) return;
    const p = computeParity(input);
    if (p.scoreMatches && p.issuesMatch) return;
    // eslint-disable-next-line no-console
    console.debug("[report-quality parity] mismatch vs legacy", {
      legacyScore: p.legacyScore,
      engineScore: p.engineScore,
      onlyInLegacy: p.legacyIssues.filter((m) => !p.engineIssues.includes(m)),
      onlyInEngine: p.engineIssues.filter((m) => !p.legacyIssues.includes(m)),
    });
  } catch {
    /* shadow must never affect the workspace */
  }
}
