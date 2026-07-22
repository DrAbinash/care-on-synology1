/**
 * usgGrowthAssistant — DETERMINISTIC advisory growth notes over the P4 pregnancy
 * timeline (ff_radiology_usg_ai_growth).
 *
 * This is intentionally NOT a model call: it summarises the interval trends the
 * canonical timeline already computed (EFW, AFI, biometry) into short, factual
 * advisory notes. It needs no AI gateway, so it works the moment the flag is on.
 *
 * Non-negotiable guardrails (the flag's own purpose forbids more):
 *   - NEVER classifies IUGR / growth restriction / macrosomia / SGA / LGA, and
 *     emits no percentiles (no reference chart exists here to justify one).
 *   - NEVER states fetal sex/gender.
 *   - Reports only measured values and their interval change — advisory,
 *     accept-only, verified by the radiologist like any other suggestion.
 *
 * Output is RawAiSuggestion[] (kind "growth_note"), funnelled through the same
 * buildUsgAiSuggestion safety filter as model suggestions.
 */

import type { RawAiSuggestion } from "./usgAiService";
import type { PregnancyTimeline, TimelinePoint } from "./usgPregnancyTimeline";

function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

/** The two most recent points that both carry a value for `pick`. */
function lastPair(points: TimelinePoint[], pick: (p: TimelinePoint) => number | null): [TimelinePoint, TimelinePoint] | null {
  const withVal = points.filter((p) => pick(p) != null && p.date);
  if (withVal.length < 2) return null;
  const sorted = [...withVal].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return [sorted[sorted.length - 2], sorted[sorted.length - 1]];
}

/**
 * Build deterministic growth notes. Returns [] when there aren't at least two
 * dated scans with the relevant measurement (nothing to trend → no note).
 */
export function buildGrowthNotes(timeline: PregnancyTimeline): RawAiSuggestion[] {
  const notes: RawAiSuggestion[] = [];
  const points = timeline?.points ?? [];
  if (points.length < 2) return notes;

  // ── Interval EFW growth ─────────────────────────────────────────────────────
  const efwPair = lastPair(points, (p) => p.efwGrams);
  if (efwPair) {
    const [prev, curr] = efwPair;
    const days = daysBetween(prev.date, curr.date);
    const from = prev.efwGrams!, to = curr.efwGrams!;
    const delta = to - from;
    const perDay = days && days > 0 ? Math.round(delta / days) : null;
    const dir = delta > 0 ? "increased" : delta < 0 ? "decreased" : "was unchanged";
    const parts = [
      `Estimated fetal weight ${dir} from ${from} g to ${to} g`,
      days != null ? `over ${days} day${Math.abs(days) === 1 ? "" : "s"}` : null,
      perDay != null ? `(≈${perDay} g/day)` : null,
      curr.gaDisplay ? `at ${curr.gaDisplay}` : null,
    ].filter(Boolean).join(" ");
    notes.push({
      kind: "growth_note",
      section: "Growth",
      text: `${parts}. Interval trend only — please interpret against your reference chart.`,
      rationale: "Interval EFW change computed from the pregnancy timeline (measured values, no percentile).",
      confidence: 0.6,
      evidence: { from_g: from, to_g: to, interval_days: days, per_day_g: perDay },
    });
  }

  // ── Interval AFI trend (values only; never oligo/poly classification) ────────
  const afiPair = lastPair(points, (p) => p.afiCm);
  if (afiPair) {
    const [prev, curr] = afiPair;
    const days = daysBetween(prev.date, curr.date);
    const dir = curr.afiCm! > prev.afiCm! ? "increased" : curr.afiCm! < prev.afiCm! ? "decreased" : "was unchanged";
    notes.push({
      kind: "growth_note",
      section: "Liquor",
      text: `Amniotic fluid index ${dir} from ${prev.afiCm} cm to ${curr.afiCm} cm${days != null ? ` over ${days} day${Math.abs(days) === 1 ? "" : "s"}` : ""}. Interval trend only.`,
      rationale: "Interval AFI change from the timeline (measured values, no interpretation).",
      confidence: 0.55,
      evidence: { from_cm: prev.afiCm, to_cm: curr.afiCm, interval_days: days },
    });
  }

  // ── Scan-count context note ─────────────────────────────────────────────────
  const efwCount = points.filter((p) => p.efwGrams != null).length;
  if (efwCount >= 3) {
    notes.push({
      kind: "growth_note",
      section: "Growth",
      text: `${efwCount} EFW data points are available for this pregnancy — consider plotting the serial trend before finalizing.`,
      rationale: "Multiple serial EFW measurements exist in the timeline.",
      confidence: 0.4,
      evidence: { efw_points: efwCount },
    });
  }

  return notes;
}
