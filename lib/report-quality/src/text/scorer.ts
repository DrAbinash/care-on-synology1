// text/scorer.ts — the computeQualityScore-parity scorer.
//
// Injected via RunOptions.scorer so the engine's score is byte-for-byte the
// legacy computeQualityScore number. This is what lets Phase 1 route the live
// badge through the engine with ZERO change to the user-visible value — the
// engine never invents a second score (architecture §6.1).

import type { QualityContext, QualityFinding } from "../contract";
import { computeTextQualityScore } from "./legacy";

export function textParityScorer(ctx: QualityContext, _findings: QualityFinding[]): number {
  return computeTextQualityScore(ctx.text).score;
}
