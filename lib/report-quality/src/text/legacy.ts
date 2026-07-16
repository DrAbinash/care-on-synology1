// text/legacy.ts — legacy-shaped wrappers over the single-source evaluator
// (./evaluate). These reproduce the exact return shapes of the original
// reportValidator.ts (computeQualityScore → {score, issues}; validateReport →
// string[]) so callers can be migrated onto the canonical engine one at a time
// (strangler façade). There is ONE generator (evaluateTextTier); these derive
// from it, so score/issues/warnings can never drift from the structured
// findings.
//
// The original reportValidator.ts in diagnostic-erp remains the live,
// user-visible source and is NOT modified or deleted until parity is proven and
// its callers are migrated.

import type { TextReportInput } from "../contract";
import { evaluateTextTier } from "./evaluate";

export interface TextQualityScore {
  score: number; // 0-100
  issues: string[];
}

/** Legacy computeQualityScore shape — derived from the structured evaluator. */
export function computeTextQualityScore(input: TextReportInput): TextQualityScore {
  const { score, findings } = evaluateTextTier(input);
  return { score, issues: findings.map((f) => f.message) };
}

/**
 * Legacy validateReport shape — the warning subset (Q1xx rules), i.e. the
 * consistency/laterality/terminology checks, excluding the completeness/
 * checklist/measurement deductions that only the score adds.
 */
export function validateReportText(input: TextReportInput): string[] {
  return evaluateTextTier(input)
    .findings.filter((f) => f.ruleId.startsWith("Q1"))
    .map((f) => f.message);
}
