// runner.ts — compatibility façade for the one entry point.
//
// runQualityEngine() delegates to the default global engine (engine.ts), so all
// existing callers keep working unchanged. The core run logic now lives in
// engine.ts (runRules), shared by every engine instance. New code may use
// createQualityEngine({ providers }).evaluate(ctx) directly.

import type { QualityContext, QualityReport, RunOptions } from "./contract";
import { defaultEngine } from "./engine";

/** Run the default global engine over one report context. */
export function runQualityEngine(ctx: QualityContext, opts?: RunOptions): QualityReport {
  return defaultEngine.evaluate(ctx, opts);
}
