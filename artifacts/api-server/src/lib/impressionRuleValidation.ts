/**
 * impressionRuleValidation.ts — Unified Impression Rule Engine: rule-set validation (Ticket C1).
 *
 * Pure, dependency-free (mirrors reportValidator.ts's "never throws, returns
 * a list of issues" style). validateRuleSet() is meant to run once before
 * evaluation; impressionRuleEngine.ts calls it internally and excludes any
 * rule with an issue from evaluation (added to `blockedRules` instead), so a
 * single malformed rule never crashes evaluation of the rest of the set.
 */

import {
  isComparisonOperator,
  isConditionGroup,
  isConditionLeaf,
  operatorRequiresValue,
  type ImpressionRule,
  type RuleCondition,
} from "./impressionRuleModel";

export type RuleValidationIssueCode =
  | "duplicate_id"
  | "invalid_operator"
  | "orphan_reference"
  | "recursive_reference"
  | "invalid_condition_tree"
  | "version_conflict";

export interface RuleValidationIssue {
  ruleId: string;
  code: RuleValidationIssueCode;
  message: string;
}

/**
 * Validates an entire rule set together (not one rule in isolation) because
 * several checks — duplicate_id, orphan_reference, recursive_reference,
 * version_conflict — are inherently cross-rule.
 */
export function validateRuleSet(rules: ImpressionRule[]): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];

  issues.push(...findDuplicateIds(rules));
  issues.push(...findVersionConflicts(rules));

  const knownIds = new Set(rules.map((r) => r.id));
  for (const rule of rules) {
    issues.push(...validateConditionTree(rule.id, rule.condition));
    issues.push(...findOrphanReferences(rule, knownIds));
  }
  issues.push(...findRecursiveReferences(rules));

  return issues;
}

/** Ids that appear on more than one rule, regardless of version. */
function findDuplicateIds(rules: ImpressionRule[]): RuleValidationIssue[] {
  const counts = new Map<string, number>();
  for (const rule of rules) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);

  const issues: RuleValidationIssue[] = [];
  for (const [id, count] of counts) {
    if (count > 1) {
      issues.push({
        ruleId: id,
        code: "duplicate_id",
        message: `Rule id "${id}" appears ${count} times in the rule set — ids must be unique.`,
      });
    }
  }
  return issues;
}

/**
 * More specific than duplicate_id: fires only when the colliding ids also
 * disagree on `version` and at least two of them are active — i.e. two
 * different revisions of "the same rule" are simultaneously live.
 */
function findVersionConflicts(rules: ImpressionRule[]): RuleValidationIssue[] {
  const byId = new Map<string, ImpressionRule[]>();
  for (const rule of rules) {
    const bucket = byId.get(rule.id);
    if (bucket) bucket.push(rule);
    else byId.set(rule.id, [rule]);
  }

  const issues: RuleValidationIssue[] = [];
  for (const [id, group] of byId) {
    const activeVersions = new Set(group.filter((r) => r.isActive).map((r) => r.version));
    if (activeVersions.size > 1) {
      issues.push({
        ruleId: id,
        code: "version_conflict",
        message: `Rule id "${id}" has multiple active versions simultaneously: ${[...activeVersions].sort().join(", ")}.`,
      });
    }
  }
  return issues;
}

function findOrphanReferences(rule: ImpressionRule, knownIds: ReadonlySet<string>): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];
  for (const targetId of rule.suppresses ?? []) {
    if (!knownIds.has(targetId)) {
      issues.push({
        ruleId: rule.id,
        code: "orphan_reference",
        message: `Rule "${rule.id}" suppresses unknown rule id "${targetId}".`,
      });
    }
  }
  return issues;
}

/** Detects cycles in the suppresses graph (A suppresses B, B suppresses A,
 *  or any longer chain that loops back). Reports each rule on a detected
 *  cycle once, with the full cycle path in the message for debuggability. */
function findRecursiveReferences(rules: ImpressionRule[]): RuleValidationIssue[] {
  const suppressesById = new Map(rules.map((r) => [r.id, r.suppresses ?? []]));
  const issues: RuleValidationIssue[] = [];
  const reportedCycleStarts = new Set<string>();

  for (const rule of rules) {
    const visiting = new Set<string>();
    const path: string[] = [];
    const cycle = findCycleFrom(rule.id, suppressesById, visiting, path);
    if (cycle && !reportedCycleStarts.has(cycle.join(">"))) {
      reportedCycleStarts.add(cycle.join(">"));
      for (const id of cycle) {
        issues.push({
          ruleId: id,
          code: "recursive_reference",
          message: `Recursive suppresses reference detected: ${cycle.join(" → ")}.`,
        });
      }
    }
  }
  return issues;
}

function findCycleFrom(
  id: string,
  suppressesById: ReadonlyMap<string, string[]>,
  visiting: Set<string>,
  path: string[],
): string[] | null {
  if (visiting.has(id)) {
    const cycleStart = path.indexOf(id);
    return path.slice(cycleStart).concat(id);
  }
  visiting.add(id);
  path.push(id);
  for (const nextId of suppressesById.get(id) ?? []) {
    // Unknown targets are reported separately as orphan_reference; skip here
    // rather than double-reporting as a cycle through a nonexistent node.
    if (!suppressesById.has(nextId)) continue;
    const found = findCycleFrom(nextId, suppressesById, visiting, path);
    if (found) return found;
  }
  path.pop();
  visiting.delete(id);
  return null;
}

/** Structural + operator validity of one rule's condition tree. Walks the
 *  tree with cycle protection against accidental shared-object-reference bugs
 *  (a condition node literally containing itself via a shared reference). */
function validateConditionTree(ruleId: string, condition: RuleCondition, seen: Set<RuleCondition> = new Set()): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];

  if (seen.has(condition)) {
    issues.push({
      ruleId,
      code: "invalid_condition_tree",
      message: `Rule "${ruleId}" has a condition node that references itself (cyclic object graph).`,
    });
    return issues;
  }
  seen.add(condition);

  if (isConditionGroup(condition)) {
    if (condition.children.length === 0) {
      issues.push({
        ruleId,
        code: "invalid_condition_tree",
        message: `Rule "${ruleId}" has an empty ${condition.logic} group — groups must have at least one child.`,
      });
    }
    for (const child of condition.children) {
      issues.push(...validateConditionTree(ruleId, child, seen));
    }
    return issues;
  }

  if (isConditionLeaf(condition)) {
    if (!condition.field || condition.field.trim().length === 0) {
      issues.push({
        ruleId,
        code: "invalid_condition_tree",
        message: `Rule "${ruleId}" has a condition leaf with an empty field path.`,
      });
    }
    if (!isComparisonOperator(condition.operator)) {
      issues.push({
        ruleId,
        code: "invalid_operator",
        message: `Rule "${ruleId}" uses unknown operator "${String(condition.operator)}".`,
      });
    } else if (operatorRequiresValue(condition.operator) && condition.value === undefined) {
      issues.push({
        ruleId,
        code: "invalid_condition_tree",
        message: `Rule "${ruleId}" uses operator "${condition.operator}" which requires a value, but none was given.`,
      });
    } else if (condition.operator === "regex" && typeof condition.value === "string") {
      try {
        // eslint-disable-next-line no-new -- validity check only, discard the instance
        new RegExp(condition.value);
      } catch {
        issues.push({
          ruleId,
          code: "invalid_condition_tree",
          message: `Rule "${ruleId}" has an invalid regular expression: ${condition.value}`,
        });
      }
    }
    return issues;
  }

  return issues;
}
