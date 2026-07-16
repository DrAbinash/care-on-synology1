// registry.ts — the single place rules register themselves.
//
// Rule modules (added phase by phase under ./rules/) call registerRule() at
// import time; ./rules/index.ts imports them all so that importing the package
// wires the full rule set. Keyed by id so a re-imported module can't double-register.

import type { QualityRule } from "./contract";

const registry = new Map<string, QualityRule>();

/** Register (or replace, by id) a quality rule. */
export function registerRule(rule: QualityRule): void {
  registry.set(rule.id, rule);
}

/** Register many rules at once. */
export function registerRules(rules: QualityRule[]): void {
  for (const r of rules) registerRule(r);
}

/** All currently-registered rules, in registration order. */
export function getRegisteredRules(): QualityRule[] {
  return [...registry.values()];
}

/** Look up a single rule by id. */
export function getRule(id: string): QualityRule | undefined {
  return registry.get(id);
}

/** Test/reset helper — clears the registry. Not used in production paths. */
export function clearRules(): void {
  registry.clear();
}
