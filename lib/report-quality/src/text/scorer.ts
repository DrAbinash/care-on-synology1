// text/scorer.ts — the computeQualityScore-parity scorer.
//
// Phase 2.5 single-evaluation fix: sums the deduction WEIGHTS carried on the
// findings instead of re-running evaluateTextTier. The text rule now runs the
// evaluator exactly ONCE per engine run and stamps each finding's weight; the
// scorer just totals them. The result is byte-identical to the legacy
// computeQualityScore (the weights ARE the legacy deductions), so the
// user-visible badge is unchanged — the engine still never invents a second score.

import type { QualityContext, QualityFinding } from "../contract";

export function textParityScorer(_ctx: QualityContext, findings: QualityFinding[]): number {
  const totalDeduction = findings.reduce((sum, f) => sum + (f.weight ?? 0), 0);
  return Math.max(0, 100 - totalDeduction);
}
