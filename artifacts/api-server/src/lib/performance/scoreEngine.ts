/**
 * Performance score engine — pure, deterministic, explainable.
 * ============================================================================
 * CARE Staff, Attendance, Performance & Recognition module.
 *
 * This module is INTENTIONALLY pure: no database, no clock, no randomness, no
 * I/O. Given a policy + a list of (already-approved) events it returns a fully
 * itemised, reproducible score breakdown. The official score is computed HERE,
 * server-side — never in React, never by trusting a client-supplied total
 * (see docs/CARE_STAFF_HR_ARCHITECTURE.md §"Score integrity").
 *
 * Model (see docs/CARE_PERFORMANCE_POLICY_CONFIGURATION.md):
 *   - The score is out of a configurable total (default 100), split across
 *     configurable categories each with a maximum.
 *   - Each category has a strategy:
 *       "deduction" — starts at its maximum; verified violations subtract.
 *       "earned"    — starts at a baseline (default 0); positive contributions
 *                     add. This is why 100/100 is NOT automatic for merely
 *                     completing routine duty.
 *   - Every category is clamped to [0, max], so positive entries can never
 *     exceed a category maximum and deductions can never drive it below zero.
 *   - A "disqualifying" event does not zero the numeric score, but flags the
 *     result as disqualified (used by award/allowance eligibility, never to
 *     silently alter payroll).
 *
 * Nothing here reads or writes payroll/salary/ledger data. Scores are advisory
 * inputs to recognition/allowance workflows that always require human approval.
 */

export type CategoryStrategy = "deduction" | "earned";

export interface CategoryConfig {
  /** Stable machine key, e.g. "attendance". */
  key: string;
  /** Human label, e.g. "Attendance and Punctuality". */
  label: string;
  /** Maximum marks for this category, e.g. 20. */
  maxMarks: number;
  /** How the category accrues marks. */
  strategy: CategoryStrategy;
  /**
   * Starting marks before events are applied. Defaults to `maxMarks` for
   * "deduction" categories and `0` for "earned" categories. Always clamped
   * into [0, maxMarks].
   */
  baseline?: number;
}

export interface ScoringPolicy {
  /** Optional label for the cycle/policy version this represents. */
  label?: string;
  categories: CategoryConfig[];
  /** Expected grand total, used only by validatePolicy(). Default 100. */
  expectedTotal?: number;
  /** Decimal places to round category and total scores to. Default 0. */
  roundTo?: number;
}

export interface ScoreEvent {
  /** Optional stable id (used for deterministic ordering + traceability). */
  id?: string | number;
  /** Category key this event applies to. */
  category: string;
  /**
   * Signed point delta. Negative = deduction, positive = earned. The engine
   * does not infer sign from anything else — the caller (the rules engine)
   * resolves a rule to a concrete signed value.
   */
  points: number;
  /**
   * When false, the event is NOT applied (unverified/unapproved complaints
   * must never reduce a score). Defaults to true; callers should pass only
   * approved events, but this is a defensive second gate.
   */
  approved?: boolean;
  /** When true, flags the whole result as disqualified for awards/allowances. */
  disqualifying?: boolean;
  /** Display metadata (carried verbatim into the breakdown). */
  date?: string;
  label?: string;
  ruleCode?: string;
}

export interface AppliedEvent {
  id?: string | number;
  category: string;
  points: number;
  disqualifying: boolean;
  date?: string;
  label?: string;
  ruleCode?: string;
}

export interface UnappliedEvent {
  event: ScoreEvent;
  reason: "not_approved" | "unknown_category";
}

export interface CategoryBreakdown {
  key: string;
  label: string;
  strategy: CategoryStrategy;
  maxMarks: number;
  baseline: number;
  /** Sum of applied event points before clamping. */
  eventDelta: number;
  /** baseline + eventDelta before clamping. */
  rawScore: number;
  /** Final category score after clamping into [0, maxMarks] and rounding. */
  score: number;
  appliedEvents: AppliedEvent[];
}

export interface ScoreResult {
  policyLabel?: string;
  total: number;
  maxTotal: number;
  categories: CategoryBreakdown[];
  disqualified: boolean;
  disqualifyingEvents: AppliedEvent[];
  unapplied: UnappliedEvent[];
}

function round(value: number, places: number): number {
  const f = Math.pow(10, places);
  // +Number.EPSILON avoids 1.005-style float truncation artefacts.
  return Math.round((value + Number.EPSILON) * f) / f;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Validate a policy. Throws on structural problems so a misconfigured policy
 * can never silently produce a wrong official score.
 */
export function validatePolicy(policy: ScoringPolicy): void {
  if (!policy.categories || policy.categories.length === 0) {
    throw new Error("Scoring policy must define at least one category");
  }
  const seen = new Set<string>();
  for (const c of policy.categories) {
    if (!c.key) throw new Error("Category is missing a key");
    if (seen.has(c.key)) throw new Error(`Duplicate category key: ${c.key}`);
    seen.add(c.key);
    if (!(c.maxMarks >= 0)) {
      throw new Error(`Category ${c.key} has invalid maxMarks: ${c.maxMarks}`);
    }
    if (c.strategy !== "deduction" && c.strategy !== "earned") {
      throw new Error(`Category ${c.key} has invalid strategy: ${c.strategy}`);
    }
    if (c.baseline !== undefined && (c.baseline < 0 || c.baseline > c.maxMarks)) {
      throw new Error(
        `Category ${c.key} baseline ${c.baseline} is outside [0, ${c.maxMarks}]`,
      );
    }
  }
  const expected = policy.expectedTotal ?? 100;
  const sum = policy.categories.reduce((a, c) => a + c.maxMarks, 0);
  if (sum !== expected) {
    throw new Error(
      `Category maxima sum to ${sum}, expected ${expected}. ` +
        `Set policy.expectedTotal to override.`,
    );
  }
}

function defaultBaseline(c: CategoryConfig): number {
  const b = c.baseline ?? (c.strategy === "deduction" ? c.maxMarks : 0);
  return clamp(b, 0, c.maxMarks);
}

/**
 * Deterministically order events so a breakdown is byte-for-byte reproducible
 * regardless of input ordering: by date, then id, then a stable original-index
 * tiebreaker. Pure string/number compares only.
 */
function orderEvents(events: ScoreEvent[]): ScoreEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const da = a.e.date ?? "";
      const db = b.e.date ?? "";
      if (da !== db) return da < db ? -1 : 1;
      const ia = a.e.id === undefined ? "" : String(a.e.id);
      const ib = b.e.id === undefined ? "" : String(b.e.id);
      if (ia !== ib) return ia < ib ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/**
 * Compute an explainable performance score.
 *
 * Deterministic: identical (policy, events) always yields an identical result.
 */
export function computeScore(policy: ScoringPolicy, events: ScoreEvent[]): ScoreResult {
  validatePolicy(policy);
  const places = policy.roundTo ?? 0;

  const byKey = new Map<string, CategoryConfig>();
  for (const c of policy.categories) byKey.set(c.key, c);

  const applied = new Map<string, AppliedEvent[]>();
  for (const c of policy.categories) applied.set(c.key, []);

  const unapplied: UnappliedEvent[] = [];
  const disqualifyingEvents: AppliedEvent[] = [];

  for (const ev of orderEvents(events)) {
    if (ev.approved === false) {
      unapplied.push({ event: ev, reason: "not_approved" });
      continue;
    }
    if (!byKey.has(ev.category)) {
      unapplied.push({ event: ev, reason: "unknown_category" });
      continue;
    }
    const a: AppliedEvent = {
      id: ev.id,
      category: ev.category,
      points: ev.points,
      disqualifying: ev.disqualifying === true,
      date: ev.date,
      label: ev.label,
      ruleCode: ev.ruleCode,
    };
    applied.get(ev.category)!.push(a);
    if (a.disqualifying) disqualifyingEvents.push(a);
  }

  const categories: CategoryBreakdown[] = policy.categories.map((c) => {
    const evs = applied.get(c.key)!;
    const baseline = defaultBaseline(c);
    const eventDelta = evs.reduce((sum, e) => sum + e.points, 0);
    const rawScore = baseline + eventDelta;
    const score = round(clamp(rawScore, 0, c.maxMarks), places);
    return {
      key: c.key,
      label: c.label,
      strategy: c.strategy,
      maxMarks: c.maxMarks,
      baseline,
      eventDelta,
      rawScore,
      score,
      appliedEvents: evs,
    };
  });

  const total = round(
    categories.reduce((a, c) => a + c.score, 0),
    places,
  );
  const maxTotal = policy.categories.reduce((a, c) => a + c.maxMarks, 0);

  return {
    policyLabel: policy.label,
    total,
    maxTotal,
    categories,
    disqualified: disqualifyingEvents.length > 0,
    disqualifyingEvents,
    unapplied,
  };
}

export interface GradeBand {
  /** Inclusive lower bound of the band. */
  min: number;
  label: string;
  /** Optional downstream recommendation, e.g. increment guidance. */
  recommendation?: string;
}

/**
 * Map a total score to a grade band. Bands are policy — not hard-coded — and
 * are evaluated highest-min-first so the first satisfied band wins. Returns
 * null if no band matches (caller decides the fallback).
 */
export function gradeFor(total: number, bands: GradeBand[]): GradeBand | null {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) {
    if (total >= b.min) return b;
  }
  return null;
}

/**
 * The default CARE 100-point category framework. This is a SEED/default only;
 * the production policy is admin-configurable and effective-dated (stored in
 * performance_categories / performance_rules, landed in a later phase). Kept
 * here so the engine has a self-describing reference policy and tests have a
 * realistic fixture.
 */
export const DEFAULT_CARE_POLICY: ScoringPolicy = {
  label: "CARE default v1",
  expectedTotal: 100,
  roundTo: 0,
  categories: [
    { key: "attendance", label: "Attendance and Punctuality", maxMarks: 20, strategy: "deduction" },
    { key: "discipline", label: "Professional Behaviour and Discipline", maxMarks: 20, strategy: "deduction" },
    { key: "quality", label: "Quality and Accuracy of Work", maxMarks: 20, strategy: "deduction" },
    { key: "patient_service", label: "Patient Service and Feedback", maxMarks: 15, strategy: "earned" },
    { key: "teamwork", label: "Teamwork and Communication", maxMarks: 15, strategy: "deduction" },
    { key: "initiative", label: "Initiative and Responsibility", maxMarks: 10, strategy: "earned" },
  ],
};
