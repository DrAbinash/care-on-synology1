/**
 * impressionRuleEngine.ts — Unified Impression Rule Engine: condition evaluator +
 * fragment/recommendation/warning builders + orchestration (Ticket C1).
 *
 * Pure, dependency-free, deterministic. Not wired into any production report
 * path — see ff_radiology_impression_engine (impressionRuleRepository.ts).
 *
 * Design choices worth knowing when reading/extending this file:
 *   - evaluateCondition() never throws. A malformed leaf (bad field path,
 *     non-numeric comparison, invalid regex) evaluates to `false` and is
 *     recorded in the trace with an `error`, so one broken leaf can't crash
 *     evaluation of an otherwise-valid rule set — mirrors reportValidator.ts's
 *     "warn, never blocks" posture.
 *   - AND/OR groups short-circuit: once the group's outcome is determined,
 *     remaining children are recorded in the trace as `shortCircuited: true`
 *     rather than evaluated.
 *   - evaluateImpressionRules() validates the whole set first (via
 *     impressionRuleValidation.ts); any rule with a validation issue is
 *     excluded from evaluation and reported in `blockedRules` instead.
 *   - Output ordering is fully deterministic: rules are sorted with
 *     compareRules() before evaluation, and fragments/recommendations/
 *     warnings are appended in that same order, then filtered by suppression
 *     as a pure post-pass — so the same rule set + context always produces
 *     byte-identical output.
 */

import {
  compareRules,
  isConditionGroup,
  isConditionLeaf,
  resolveField,
  type ComparisonOperator,
  type ConditionValue,
  type EvaluationContext,
  type FactValue,
  type ImpressionRule,
  type RuleCondition,
  type WarningSeverity,
} from "./impressionRuleModel";
import { validateRuleSet, type RuleValidationIssue } from "./impressionRuleValidation";

// ── Condition evaluation ────────────────────────────────────────────────────

export interface ConditionEvalStep {
  condition: RuleCondition;
  result: boolean;
  /** Only populated for leaves — the fact value the leaf compared against. */
  fieldValue?: FactValue;
  /** True if this node was a group child skipped because the group's
   *  outcome was already determined by an earlier child (AND found a false /
   *  OR found a true). Its `result` is left `false` and must be ignored. */
  shortCircuited?: boolean;
  /** Present when the leaf could not be evaluated safely (bad regex, non-numeric
   *  comparison, etc.) — the leaf still contributes `result: false`, it does not throw. */
  error?: string;
}

function toFiniteNumber(value: FactValue | ConditionValue | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** equals/not_equals compare numerically when both sides parse as finite
 *  numbers (so a JSON number fact vs. a string-typed rule value still
 *  matches), otherwise falls back to strict equality. */
function valuesEqual(fieldValue: FactValue, ruleValue: ConditionValue | undefined): boolean {
  const a = toFiniteNumber(fieldValue);
  const b = toFiniteNumber(ruleValue);
  if (a !== undefined && b !== undefined) return a === b;
  return fieldValue === ruleValue;
}

function evaluateLeaf(field: string, operator: ComparisonOperator, ruleValue: ConditionValue | undefined, ctx: EvaluationContext): { result: boolean; fieldValue: FactValue; error?: string } {
  const fieldValue = resolveField(ctx.facts, field);

  switch (operator) {
    case "exists":
      return { result: fieldValue !== undefined && fieldValue !== null, fieldValue };
    case "missing":
      return { result: fieldValue === undefined || fieldValue === null, fieldValue };
    case "equals":
      return { result: valuesEqual(fieldValue, ruleValue), fieldValue };
    case "not_equals":
      return { result: !valuesEqual(fieldValue, ruleValue), fieldValue };
    case "greater_than":
    case "greater_or_equal":
    case "less_than": {
      const a = toFiniteNumber(fieldValue);
      const b = toFiniteNumber(ruleValue);
      if (a === undefined || b === undefined) {
        return { result: false, fieldValue, error: `"${operator}" requires numeric operands; got field="${JSON.stringify(fieldValue)}" value="${JSON.stringify(ruleValue)}"` };
      }
      const result = operator === "greater_than" ? a > b : operator === "greater_or_equal" ? a >= b : a < b;
      return { result, fieldValue };
    }
    case "contains": {
      if (Array.isArray(fieldValue)) {
        return { result: fieldValue.some((v) => valuesEqual(v, ruleValue)), fieldValue };
      }
      if (typeof fieldValue === "string" && typeof ruleValue === "string") {
        return { result: fieldValue.toLowerCase().includes(ruleValue.toLowerCase()), fieldValue };
      }
      return { result: false, fieldValue, error: `"contains" requires an array/string field and a scalar value; got field="${JSON.stringify(fieldValue)}"` };
    }
    case "any_of": {
      if (!Array.isArray(ruleValue)) {
        return { result: false, fieldValue, error: `"any_of" requires an array value; got "${JSON.stringify(ruleValue)}"` };
      }
      if (Array.isArray(fieldValue)) {
        return { result: fieldValue.some((fv) => ruleValue.some((rv) => valuesEqual(fv, rv))), fieldValue };
      }
      return { result: ruleValue.some((rv) => valuesEqual(fieldValue, rv)), fieldValue };
    }
    case "all_of": {
      if (!Array.isArray(ruleValue)) {
        return { result: false, fieldValue, error: `"all_of" requires an array value; got "${JSON.stringify(ruleValue)}"` };
      }
      if (!Array.isArray(fieldValue)) {
        return { result: false, fieldValue, error: `"all_of" requires an array field; got "${JSON.stringify(fieldValue)}"` };
      }
      return { result: ruleValue.every((rv) => fieldValue.some((fv) => valuesEqual(fv, rv))), fieldValue };
    }
    case "regex": {
      if (typeof fieldValue !== "string" || typeof ruleValue !== "string") {
        return { result: false, fieldValue, error: `"regex" requires a string field and string pattern; got field="${JSON.stringify(fieldValue)}" value="${JSON.stringify(ruleValue)}"` };
      }
      try {
        return { result: new RegExp(ruleValue).test(fieldValue), fieldValue };
      } catch (err) {
        return { result: false, fieldValue, error: `invalid regex "${ruleValue}": ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    default: {
      // Exhaustiveness guard — impressionRuleValidation.ts's invalid_operator
      // check should catch this before we ever reach here, but a defensive
      // module must not throw on a truly unknown operator string either.
      const _exhaustive: never = operator;
      return { result: false, fieldValue, error: `unknown operator "${String(_exhaustive)}"` };
    }
  }
}

/**
 * Evaluates one condition (leaf or group, arbitrarily nested) against a fact
 * context, appending every visited/skipped node to `trace` in visitation
 * order. Never throws.
 */
export function evaluateCondition(condition: RuleCondition, ctx: EvaluationContext, trace: ConditionEvalStep[] = []): boolean {
  if (isConditionLeaf(condition)) {
    const { result, fieldValue, error } = evaluateLeaf(condition.field, condition.operator, condition.value, ctx);
    trace.push({ condition, result, fieldValue, error });
    return result;
  }

  // Group: AND/OR with short-circuit.
  const shortCircuitOn = condition.logic === "AND" ? false : true; // AND short-circuits on first false; OR on first true
  let outcome = condition.logic === "AND"; // AND starts true (vacuously, though validation forbids empty groups); OR starts false
  let decided = false;

  for (const child of condition.children) {
    if (decided) {
      trace.push({ condition: child, result: false, shortCircuited: true });
      continue;
    }
    const childResult = evaluateCondition(child, ctx, trace);
    if (childResult === shortCircuitOn) {
      outcome = shortCircuitOn;
      decided = true;
    }
  }

  return outcome;
}

// ── Fragment / recommendation / warning builders ────────────────────────────

const TEMPLATE_PLACEHOLDER = /\{([a-zA-Z0-9_.]+)\}/g;

function factValueToText(value: FactValue): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(factValueToText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Resolves `{field}` placeholders in a template string against the
 *  evaluation context's facts via the same dot-path lookup the condition
 *  evaluator uses. Unresolvable placeholders are left as literal text (never
 *  silently dropped) so a missing fact is visible in the output rather than
 *  producing a grammatically broken sentence. */
export function resolveTemplateText(template: string, ctx: EvaluationContext): string {
  return template.replace(TEMPLATE_PLACEHOLDER, (match, path: string) => {
    const value = resolveField(ctx.facts, path);
    if (value === undefined || value === null) return match;
    return factValueToText(value);
  });
}

export interface BuiltFragment {
  id: string;
  ruleId: string;
  text: string;
}

export interface BuiltRecommendation {
  id: string;
  ruleId: string;
  text: string;
  code?: string;
}

export interface BuiltWarning {
  id: string;
  ruleId: string;
  message: string;
  severity: WarningSeverity;
}

export function buildFragments(rule: ImpressionRule, ctx: EvaluationContext): BuiltFragment[] {
  return rule.fragments.map((f) => ({ id: f.id, ruleId: rule.id, text: resolveTemplateText(f.text, ctx) }));
}

export function buildRecommendations(rule: ImpressionRule, ctx: EvaluationContext): BuiltRecommendation[] {
  return rule.recommendations.map((r) => ({ id: r.id, ruleId: rule.id, text: resolveTemplateText(r.text, ctx), code: r.code }));
}

export function buildWarnings(rule: ImpressionRule, ctx: EvaluationContext): BuiltWarning[] {
  return rule.warnings.map((w) => ({ id: w.id, ruleId: rule.id, message: resolveTemplateText(w.message, ctx), severity: w.severity }));
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface RuleEvaluationTraceEntry {
  ruleId: string;
  matched: boolean;
  /** True if the rule matched but its output was later dropped because
   *  another matched rule's `suppresses` listed it. */
  suppressed: boolean;
  conditionTrace: ConditionEvalStep[];
}

export interface BlockedRule {
  ruleId: string;
  reason: string;
}

export interface RuleSetEvaluationResult {
  impressionFragments: BuiltFragment[];
  recommendations: BuiltRecommendation[];
  warnings: BuiltWarning[];
  blockedRules: BlockedRule[];
  trace: RuleEvaluationTraceEntry[];
}

/**
 * Evaluates an entire rule set against one evaluation context and returns
 * pure structured output (no HTML, no formatting). Validates first — any
 * rule with a validation issue is excluded from evaluation and reported in
 * `blockedRules` rather than throwing.
 */
export function evaluateImpressionRules(rules: ImpressionRule[], ctx: EvaluationContext): RuleSetEvaluationResult {
  const validationIssues = validateRuleSet(rules);
  const blockedRuleIds = new Set(validationIssues.map((i) => i.ruleId));
  const blockedRules: BlockedRule[] = summarizeBlockedRules(validationIssues);

  const evaluable = rules
    .filter((r) => r.isActive && !blockedRuleIds.has(r.id))
    .slice()
    .sort(compareRules);

  const trace: RuleEvaluationTraceEntry[] = [];
  const matchedRules: ImpressionRule[] = [];

  for (const rule of evaluable) {
    const conditionTrace: ConditionEvalStep[] = [];
    const matched = evaluateCondition(rule.condition, ctx, conditionTrace);
    trace.push({ ruleId: rule.id, matched, suppressed: false, conditionTrace });
    if (matched) matchedRules.push(rule);
  }

  // Suppression is a pure post-pass over matched rules, in the same
  // deterministic order, so output never depends on suppression-application order.
  const suppressedIds = new Set<string>();
  for (const rule of matchedRules) {
    for (const targetId of rule.suppresses ?? []) suppressedIds.add(targetId);
  }
  for (const entry of trace) {
    if (entry.matched && suppressedIds.has(entry.ruleId)) entry.suppressed = true;
  }

  const impressionFragments: BuiltFragment[] = [];
  const recommendations: BuiltRecommendation[] = [];
  const warnings: BuiltWarning[] = [];

  for (const rule of matchedRules) {
    if (suppressedIds.has(rule.id)) continue;
    impressionFragments.push(...buildFragments(rule, ctx));
    recommendations.push(...buildRecommendations(rule, ctx));
    warnings.push(...buildWarnings(rule, ctx));
  }

  return { impressionFragments, recommendations, warnings, blockedRules, trace };
}

function summarizeBlockedRules(issues: RuleValidationIssue[]): BlockedRule[] {
  const byRule = new Map<string, string[]>();
  for (const issue of issues) {
    const bucket = byRule.get(issue.ruleId);
    if (bucket) bucket.push(issue.message);
    else byRule.set(issue.ruleId, [issue.message]);
  }
  return [...byRule.entries()].map(([ruleId, messages]) => ({ ruleId, reason: messages.join(" ") }));
}
