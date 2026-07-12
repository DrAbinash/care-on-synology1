/**
 * impressionRuleModel.ts — Unified Impression Rule Engine: canonical rule model (Ticket C1).
 *
 * This is the shared vocabulary the rest of the engine (impressionRuleEngine.ts,
 * impressionRuleValidation.ts) and its repository (impressionRuleRepository.ts)
 * are built on. It intentionally generalizes the existing `radiology_impression_rules`
 * table (lib/db/src/schema/radiologySmartFindings.ts), whose `conditions` column
 * stores a flat, implicitly-ANDed `{ field, operator, value }[]` array: that flat
 * shape is one valid (degenerate) instance of the `RuleCondition` tree defined
 * here — a single top-level AND group of leaves. See impressionRuleRepository.ts
 * for the mapping between the two.
 *
 * Pure types + pure helpers only. No I/O, no React, no Express. Not wired into
 * any production code path — see ff_radiology_impression_engine.
 */

// ── Conditions ────────────────────────────────────────────────────────────────

/** Every operator the condition evaluator understands. Deliberately closed —
 *  extend here first, then impressionRuleEngine.ts's evaluateLeaf switch. */
export const COMPARISON_OPERATORS = [
  "equals",
  "not_equals",
  "exists",
  "missing",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "contains",
  "any_of",
  "all_of",
  "regex",
] as const;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export function isComparisonOperator(value: unknown): value is ComparisonOperator {
  return typeof value === "string" && (COMPARISON_OPERATORS as readonly string[]).includes(value);
}

/** Operators that compare against a value. All operators except these two
 *  require `value` to be present on the leaf. */
const VALUE_FREE_OPERATORS: ReadonlySet<ComparisonOperator> = new Set(["exists", "missing"]);

export function operatorRequiresValue(operator: ComparisonOperator): boolean {
  return !VALUE_FREE_OPERATORS.has(operator);
}

export type ConditionValue = string | number | boolean | (string | number)[];

/** A single field/operator/value comparison against the evaluation context's facts. */
export interface ConditionLeaf {
  kind: "leaf";
  /** Dot-path into the fact context, e.g. "measurements.evansIndex" or "whiteMatter". */
  field: string;
  operator: ComparisonOperator;
  /** Omitted for "exists" / "missing"; required for every other operator. */
  value?: ConditionValue;
}

/** An AND/OR group of child conditions. Children may themselves be groups —
 *  arbitrary nesting is supported. */
export interface ConditionGroup {
  kind: "group";
  logic: "AND" | "OR";
  children: RuleCondition[];
}

export type RuleCondition = ConditionLeaf | ConditionGroup;

export function isConditionLeaf(condition: RuleCondition): condition is ConditionLeaf {
  return condition.kind === "leaf";
}

export function isConditionGroup(condition: RuleCondition): condition is ConditionGroup {
  return condition.kind === "group";
}

// ── Outputs ──────────────────────────────────────────────────────────────────

/** `{field}` placeholders in `text` are resolved against the evaluation
 *  context's facts by the same dot-path lookup the condition evaluator uses
 *  (see resolveTemplateText in impressionRuleEngine.ts). */
export interface ImpressionFragmentTemplate {
  /** Stable id for this fragment within its rule — carried into the trace/output for traceability. */
  id: string;
  text: string;
}

export interface RecommendationTemplate {
  id: string;
  text: string;
  /** Optional coded recommendation id, e.g. "rec.spec_neuro" — matches the
   *  `rec.*` coding convention used by the radiology content-pack recommendation library. */
  code?: string;
}

export type WarningSeverity = "info" | "warn" | "block";

export interface WarningTemplate {
  id: string;
  message: string;
  severity: WarningSeverity;
}

// ── Rule ─────────────────────────────────────────────────────────────────────

/** Matches the existing `radiology_impression_rules.priority` column's values
 *  exactly — no engine-level 4th tier invented. */
export const RULE_PRIORITIES = ["critical", "urgent", "normal"] as const;
export type RulePriority = (typeof RULE_PRIORITIES)[number];

export function isRulePriority(value: unknown): value is RulePriority {
  return typeof value === "string" && (RULE_PRIORITIES as readonly string[]).includes(value);
}

/** Rank used for deterministic ordering — lower sorts first (evaluated/output first). */
const PRIORITY_RANK: Record<RulePriority, number> = { critical: 0, urgent: 1, normal: 2 };

export function priorityRank(priority: RulePriority): number {
  return PRIORITY_RANK[priority];
}

export interface ImpressionRule {
  /** Stable identity, string so both legacy numeric-as-string DB ids and future
   *  semantic ids ("mri_brain.svid.fazekas3") are representable. */
  id: string;
  /** Free-text revision tag, mirrors the existing `radiology_impression_rules.version` column (e.g. "v1.0"). */
  version: string;
  /** e.g. "mri_brain", "mri_cervical_spine" — matches the existing `builderType` column. */
  builderType: string;
  isActive: boolean;
  priority: RulePriority;
  /** Deterministic tie-break key when two rules share the same priority; ascending. */
  order: number;
  condition: RuleCondition;
  fragments: ImpressionFragmentTemplate[];
  recommendations: RecommendationTemplate[];
  warnings: WarningTemplate[];
  /**
   * Ids of OTHER rules whose output should be dropped from the final result
   * if THIS rule matches (e.g. a "severe stenosis" rule suppressing a milder
   * "mild stenosis" rule for the same field so the impression isn't
   * self-contradictory). Every id here must resolve to another rule in the
   * same evaluated set (see impressionRuleValidation.ts's orphan_reference
   * check) and must not form a cycle (recursive_reference check).
   */
  suppresses?: string[];
}

/** Deterministic total order for evaluation and output: priority band first
 *  (critical > urgent > normal), then explicit `order` ascending, then `id`
 *  ascending as a final tiebreak so ordering never depends on input array
 *  order or object insertion order. */
export function compareRules(a: ImpressionRule, b: ImpressionRule): number {
  const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDelta !== 0) return priorityDelta;
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ── Evaluation context (facts) ──────────────────────────────────────────────

export type FactValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FactValue[]
  | { [key: string]: FactValue };

export interface EvaluationContext {
  facts: Record<string, FactValue>;
}

/** Path segments that must never be traversed — guards resolveField() against
 *  prototype-pollution-style lookups on attacker- or data-error-supplied field paths. */
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Safe dot-path lookup into a fact bag, e.g. resolveField(facts, "measurements.evansIndex").
 * Returns undefined for any missing/unsafe segment rather than throwing, so a
 * single malformed field path degrades to "field absent" instead of crashing
 * evaluation of an otherwise-valid rule set.
 */
export function resolveField(facts: Record<string, FactValue>, path: string): FactValue {
  const segments = path.split(".").filter((s) => s.length > 0);
  let current: FactValue = facts;
  for (const segment of segments) {
    if (UNSAFE_PATH_SEGMENTS.has(segment)) return undefined;
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, FactValue>)[segment];
  }
  return current;
}
