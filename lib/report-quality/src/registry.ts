// registry.ts — compatibility façade over the default global engine.
//
// Phase 2.5 moved rule storage into engine instances (engine.ts). These
// functions delegate to the single `defaultEngine`, so all existing callers —
// rules that self-register via registerRule() on import, tests that call
// clearRules() — keep working unchanged. New code should prefer
// createQualityEngine({ providers }).

import type { QualityRule } from "./contract";
import { defaultEngine } from "./engine";

/** Register (or replace, by id) a rule on the default global engine. */
export function registerRule(rule: QualityRule): void {
  defaultEngine.register(rule);
}

/** Register many rules on the default global engine. */
export function registerRules(rules: QualityRule[]): void {
  defaultEngine.registerMany(rules);
}

/** All rules registered on the default global engine. */
export function getRegisteredRules(): QualityRule[] {
  return defaultEngine.getRules();
}

/** Look up a rule on the default global engine by id. */
export function getRule(id: string): QualityRule | undefined {
  return defaultEngine.getRule(id);
}

/** Test/reset helper — clears the default global engine. Not used in production paths. */
export function clearRules(): void {
  defaultEngine.clear();
}
