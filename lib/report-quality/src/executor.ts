// executor.ts — generic executor framework (Phase 2.5, framework ONLY).
//
// Most clinical rules share a shape and differ only in data ("measurement X
// out of [a,b]", "finding Y requires recommendation Z"). Rather than a bespoke
// code module per rule, such rules can be expressed as declarative
// RuleDefinitions (data) interpreted by a small set of generic Executors
// (code). This is what makes scaling to ~1000 rules tractable.
//
// Phase 2.5 ships the FRAMEWORK ONLY: no clinical executors are registered, no
// RuleDefinitions are shipped, and none of the existing hand-written rules are
// migrated. Runtime behaviour is unchanged. Later phases add executors and
// pack-owned definitions.

import type {
  ContextDataKey,
  DataTier,
  QualityCategory,
  QualityContext,
  QualityFinding,
  QualityRule,
  Severity,
} from "./contract";

/** A declarative, data-driven rule interpreted by a named executor. */
export interface RuleDefinition {
  /** Primary id (a hierarchical canonicalId for new rules). */
  id: string;
  canonicalId?: string;
  legacyAlias?: string;
  category: QualityCategory;
  tier: DataTier;
  severity: Severity;
  modalities: "*" | string[];
  owner: string;
  pack: string | null;
  version: string;
  /** Name of the registered executor that interprets `params`. */
  executor: string;
  /** Executor-specific configuration (thresholds, required lists, maps, …). */
  params: Record<string, unknown>;
  requires?: ContextDataKey[];
  dependsOn?: string[];
  /** Default score deduction for findings this rule emits. */
  weight?: number;
}

/** What an executor returns; identity/severity default from the definition. */
export interface ExecutorFinding {
  message: string;
  evidence?: string;
  suggestedFix?: string;
  targetRef?: string;
  rationale?: string;
  ruleId?: string;
  canonicalId?: string;
  category?: QualityCategory;
  severity?: Severity;
  tier?: DataTier;
  weight?: number;
  knowledgePackSource?: string;
}

/** A generic, reusable detection routine parameterized by a RuleDefinition. */
export type Executor = (def: RuleDefinition, ctx: QualityContext) => ExecutorFinding[];

/** A registry of named executors. */
export interface ExecutorRegistry {
  register(name: string, exec: Executor): void;
  get(name: string): Executor | undefined;
  has(name: string): boolean;
  names(): string[];
}

export function createExecutorRegistry(): ExecutorRegistry {
  const map = new Map<string, Executor>();
  return {
    register: (name, exec) => {
      map.set(name, exec);
    },
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    names: () => [...map.keys()],
  };
}

/**
 * Compile a declarative RuleDefinition into an executable QualityRule bound to a
 * named executor. If the executor is absent at evaluate time, the rule yields no
 * findings (fails safe). Identity/severity/tier/weight metadata default from the
 * definition so executors focus on detection.
 */
export function compileRule(def: RuleDefinition, executors: ExecutorRegistry): QualityRule {
  return {
    id: def.id,
    category: def.category,
    modalities: def.modalities,
    tier: def.tier,
    requires: def.requires,
    evaluate(ctx: QualityContext): QualityFinding[] {
      const exec = executors.get(def.executor);
      if (!exec) return [];
      return exec(def, ctx).map((f): QualityFinding => ({
        ruleId: f.ruleId ?? def.id,
        canonicalId: f.canonicalId ?? def.canonicalId,
        category: f.category ?? def.category,
        severity: f.severity ?? def.severity,
        tier: f.tier ?? def.tier,
        weight: f.weight ?? def.weight,
        message: f.message,
        rationale: f.rationale,
        evidence: f.evidence,
        suggestedFix: f.suggestedFix,
        targetRef: f.targetRef,
        knowledgePackSource: f.knowledgePackSource ?? def.pack ?? undefined,
      }));
    },
  };
}
