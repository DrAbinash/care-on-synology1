// score.ts — the default engine score.
//
// The canonical report score is computeQualityScore() (reportValidator.ts),
// REUSED and extended — never replaced by a second score (architecture §6.1).
// Phase 1 injects a computeQualityScore-parity scorer via RunOptions.scorer so
// the live workspace badge number is unchanged.
//
// This default is the fallback used only when no scorer is injected (e.g. a
// bare server call in Phase 0/2 before parity wiring): a transparent
// severity-weighted deduction from 100, so a caller always gets a sane number.

import type { QualityContext, QualityFinding } from "./contract";

const DEDUCTION: Record<QualityFinding["severity"], number> = {
  blocker: 20,
  warning: 5,
  info: 0,
};

/** Fallback score: 100 minus severity-weighted deductions, clamped to [0,100]. */
export function defaultScorer(_ctx: QualityContext, findings: QualityFinding[]): number {
  let score = 100;
  for (const f of findings) score -= DEDUCTION[f.severity] ?? 0;
  return Math.max(0, Math.min(100, score));
}
