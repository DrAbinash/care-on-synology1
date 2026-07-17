// referenceRanges.ts — resolve the reference interval that applies to a
// specific patient, and render it for the report.
//
// This is the capability the platform never had: a hemoglobin of 11 g/dL is
// LOW for an adult man, NORMAL for a pregnant woman, and the range printed on
// the report must depend on the patient's sex and age — not on whatever a
// technician typed into a template. Resolution is deterministic: every
// candidate interval is filtered (sex/age/condition must be compatible) then
// scored by specificity, so the most specific matching interval wins, with a
// stable tie-break. No fuzzy matching, no guessing an unknown sex.

import type {
  AnalyteDefinition,
  PatientContext,
  ReferenceInterval,
  ResolvedInterval,
  Sex,
} from "./contract";

/** Map a free-form sex string to the registry's canonical Sex (or undefined). */
export function normalizeSex(raw?: string | null): Sex | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  if (["m", "male", "man", "boy", "b"].includes(t)) return "male";
  if (["f", "female", "woman", "girl", "g"].includes(t)) return "female";
  if (t === "any") return "any";
  return undefined; // "other"/unknown — do not assume a sex-specific range
}

/** Whole/fractional years between a date of birth and a reference date. */
export function ageYearsFromDob(dob: Date | string, asOf: Date): number | undefined {
  const born = typeof dob === "string" ? new Date(dob) : dob;
  if (Number.isNaN(born.getTime()) || Number.isNaN(asOf.getTime())) return undefined;
  const ms = asOf.getTime() - born.getTime();
  if (ms < 0) return undefined;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

function hasAgeBound(iv: ReferenceInterval): boolean {
  return iv.ageMinYears !== undefined || iv.ageMaxYears !== undefined;
}

/** Whether an interval is compatible with a patient context at all. */
function intervalMatches(iv: ReferenceInterval, ctx: PatientContext): boolean {
  if (iv.sex !== "any") {
    const s = normalizeSex(ctx.sex);
    if (!s || s !== iv.sex) return false;
  }
  if (hasAgeBound(iv)) {
    const age = ctx.ageYears;
    if (age === undefined || age === null || !Number.isFinite(age)) return false;
    if (iv.ageMinYears !== undefined && age < iv.ageMinYears) return false;
    if (iv.ageMaxYears !== undefined && age >= iv.ageMaxYears) return false;
  }
  if (iv.condition) {
    if (!ctx.condition || ctx.condition !== iv.condition) return false;
  }
  return true;
}

/**
 * Specificity score for a MATCHING interval. Condition dominates (a pregnancy
 * TSH range must beat the general one), then an actively-satisfied age band
 * (so a child never inherits an adult range even if the adult range was left
 * un-age-bounded), then sex.
 */
function specificity(iv: ReferenceInterval, ctx: PatientContext): number {
  let s = 0;
  if (iv.condition && ctx.condition === iv.condition) s += 4;
  if (hasAgeBound(iv)) s += 3;
  if (iv.sex !== "any") s += 2;
  return s;
}

function ageSpan(iv: ReferenceInterval): number {
  const lo = iv.ageMinYears ?? 0;
  const hi = iv.ageMaxYears ?? 200;
  return hi - lo;
}

function fmt(value: number, precision: number): string {
  return value.toFixed(precision);
}

/** Render an interval's bounds as a report-ready string ("13.0 – 17.0 g/dL"). */
export function formatReferenceRange(
  iv: ReferenceInterval | null,
  precision: number,
  defaultUnit: string,
): string {
  if (!iv) return "—";
  if (iv.text) return iv.text;
  const unit = iv.unit ?? defaultUnit;
  const suffix = unit ? ` ${unit}` : "";
  const hasLow = iv.low !== undefined;
  const hasHigh = iv.high !== undefined;
  if (hasLow && hasHigh) return `${fmt(iv.low!, precision)} – ${fmt(iv.high!, precision)}${suffix}`;
  if (hasHigh) return `< ${fmt(iv.high!, precision)}${suffix}`;
  if (hasLow) return `> ${fmt(iv.low!, precision)}${suffix}`;
  return "—";
}

/**
 * Resolve the effective reference interval for `def` given a patient context.
 * Returns a flattened ResolvedInterval so consumers never re-run scoring.
 * `matched` is false when nothing sex/age/condition-appropriate applied.
 */
export function resolveReferenceInterval(
  def: AnalyteDefinition,
  ctx: PatientContext = {},
): ResolvedInterval {
  let best: ReferenceInterval | null = null;
  let bestScore = -1;
  for (const iv of def.referenceIntervals) {
    if (!intervalMatches(iv, ctx)) continue;
    const score = specificity(iv, ctx);
    if (
      best === null ||
      score > bestScore ||
      (score === bestScore && ageSpan(iv) < ageSpan(best))
    ) {
      best = iv;
      bestScore = score;
    }
  }

  const unit = best?.unit ?? def.defaultUnit;
  return {
    analyteId: def.id,
    interval: best,
    low: best?.low,
    high: best?.high,
    criticalLow: best?.criticalLow ?? def.criticalLow,
    criticalHigh: best?.criticalHigh ?? def.criticalHigh,
    unit,
    display: formatReferenceRange(best, def.precision, def.defaultUnit),
    matched: best !== null,
  };
}
