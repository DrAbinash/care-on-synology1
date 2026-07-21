/**
 * Evaluation metrics + version lifecycle — Phase P2 / Gate G8 (pure).
 *
 * No DB. The DB-backed runner (artifacts/api-server/.../evaluationRunner.ts)
 * calls these to score a version against the golden set and to decide whether a
 * version may be promoted shadow → candidate → live.
 */

export interface RefFinding { key: string; critical?: boolean }
export interface ProducedFinding { key: string }

/** Recall of the reference CRITICAL findings (0-100). No criticals ⇒ 100. */
export function criticalFindingRecall(reference: RefFinding[], produced: ProducedFinding[]): number {
  const criticals = reference.filter((f) => f.critical);
  if (criticals.length === 0) return 100;
  const producedKeys = new Set(produced.map((f) => f.key));
  const hit = criticals.filter((c) => producedKeys.has(c.key)).length;
  return Math.round((hit / criticals.length) * 100);
}

export interface CaseOutcome { validationOk: boolean; criticalRecall: number }

/** Fraction of cases whose produced draft passed contract validation (0-100). */
export function structuredValidationRate(cases: CaseOutcome[]): number {
  if (cases.length === 0) return 0;
  return Math.round((cases.filter((c) => c.validationOk).length / cases.length) * 100);
}

/** Simple finding-set F1 between reference and produced keys (0-100). */
export function findingF1(reference: ProducedFinding[], produced: ProducedFinding[]): number {
  const ref = new Set(reference.map((f) => f.key));
  const prod = new Set(produced.map((f) => f.key));
  if (ref.size === 0 && prod.size === 0) return 100;
  let tp = 0;
  for (const k of prod) if (ref.has(k)) tp++;
  const precision = prod.size ? tp / prod.size : 0;
  const recall = ref.size ? tp / ref.size : 0;
  if (precision + recall === 0) return 0;
  return Math.round((2 * precision * recall) / (precision + recall) * 100);
}

export interface AggregateMetrics {
  caseCount: number;
  criticalRecall: number; // mean across cases (0-100)
  validationRate: number; // 0-100
}

export function aggregateMetrics(cases: CaseOutcome[]): AggregateMetrics {
  const caseCount = cases.length;
  const criticalRecall = caseCount ? Math.round(cases.reduce((s, c) => s + c.criticalRecall, 0) / caseCount) : 0;
  return { caseCount, criticalRecall, validationRate: structuredValidationRate(cases) };
}

export interface PromotionThresholds {
  minCriticalRecall: number; // e.g. 99
  minValidationRate: number; // e.g. 95
  minCases: number; // e.g. 1
}

export const DEFAULT_THRESHOLDS: PromotionThresholds = {
  minCriticalRecall: 99,
  minValidationRate: 95,
  minCases: 1,
};

export type VersionState = "shadow" | "candidate" | "live" | "retired";

export interface PromotionDecision {
  eligibleState: VersionState;
  metricsPass: boolean;
  reasons: string[];
}

/**
 * Decide the highest state a version may occupy. Meeting thresholds makes it a
 * CANDIDATE; only an explicit human approval can take a candidate to LIVE. This
 * is the hard human-approval gate — metrics alone never reach `live`.
 */
export function decideVersionPromotion(
  metrics: AggregateMetrics,
  thresholds: PromotionThresholds,
  humanApproved: boolean,
): PromotionDecision {
  const reasons: string[] = [];
  if (metrics.caseCount < thresholds.minCases) reasons.push(`too few cases (${metrics.caseCount} < ${thresholds.minCases})`);
  if (metrics.criticalRecall < thresholds.minCriticalRecall) reasons.push(`critical recall ${metrics.criticalRecall} < ${thresholds.minCriticalRecall}`);
  if (metrics.validationRate < thresholds.minValidationRate) reasons.push(`validation rate ${metrics.validationRate} < ${thresholds.minValidationRate}`);
  const metricsPass = reasons.length === 0;
  if (!metricsPass) return { eligibleState: "shadow", metricsPass, reasons };
  if (!humanApproved) return { eligibleState: "candidate", metricsPass, reasons: ["metrics pass; awaiting human approval"] };
  return { eligibleState: "live", metricsPass, reasons: ["metrics pass; human-approved"] };
}
