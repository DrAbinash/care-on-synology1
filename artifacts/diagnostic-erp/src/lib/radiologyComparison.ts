/**
 * radiologyComparison.ts — deterministic interval-change + measurement-comparison
 * helpers for previous-study comparison (MRI PR 1).
 *
 * This does NOT introduce a comparison engine of its own for prior fetching or
 * metric diffing — the workspace reuses the existing
 * `GET /radiology-copilot/prior-studies` endpoint and `comparePriorMetrics`
 * (radiologyCoPilotEngine). What was missing was a deterministic way to turn a
 * radiologist's interval-change *classification* into an editable comparison
 * sentence, and a safe measurement-diff formatter (units, missing data, %). That
 * is all this file provides — pure, alias-free, unit-testable.
 *
 * Nothing here diagnoses progression on its own (Part 5 safety): size deltas are
 * formatted, never auto-classified; the radiologist chooses the classification.
 */

import { resolveMeasurement, getMeasurement, convertUnitValue } from "@workspace/measurements";

export type IntervalChange =
  | "new"
  | "stable"
  | "improved"
  | "progressed"
  | "resolved"
  | "not-comparable"
  | "indeterminate";

export const INTERVAL_CHANGES: { value: IntervalChange; label: string }[] = [
  { value: "new", label: "New" },
  { value: "stable", label: "Stable" },
  { value: "improved", label: "Improved" },
  { value: "progressed", label: "Progressed" },
  { value: "resolved", label: "Resolved" },
  { value: "not-comparable", label: "Not comparable" },
  { value: "indeterminate", label: "Indeterminate" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2025-06-12" (or an ISO datetime) → "12 June 2025". Timezone-safe (parses the
 *  date parts directly). Returns the input unchanged if it isn't a date. */
export function formatStudyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** The report's "Comparison:" banner line. */
export function comparisonBanner(priorDateIso: string, priorStudyName?: string): string {
  const date = formatStudyDate(priorDateIso);
  const study = (priorStudyName ?? "").trim();
  return study
    ? `Compared with ${study} dated ${date}.`
    : `Compared with the previous study dated ${date}.`;
}

export interface ComparisonSentenceOpts {
  /** The finding being compared, e.g. "the L4-L5 disc protrusion". */
  finding?: string;
  priorDateIso?: string;
  priorStudyName?: string;
  /** Optional degree, e.g. "mild" / "significant". */
  qualifier?: string;
}

/** Turn a classification into an editable comparison sentence. */
export function buildComparisonSentence(change: IntervalChange, opts: ComparisonSentenceOpts = {}): string {
  const finding = (opts.finding ?? "").trim() || "the described finding";
  const qual = (opts.qualifier ?? "").trim();
  const withQual = (word: string) => (qual ? `${qual} interval ${word}` : `interval ${word}`);
  const date = opts.priorDateIso ? formatStudyDate(opts.priorDateIso) : "";
  const study = (opts.priorStudyName ?? "").trim() || "the previous study";
  const prefix = date ? `Compared with ${study} dated ${date}, ` : "";
  let body: string;
  switch (change) {
    case "new":
      body = `${prefix}${finding} is newly seen.`;
      break;
    case "stable":
      body = `No significant interval change is seen in ${finding}.`;
      break;
    case "improved":
      body = `${prefix}there is ${withQual("improvement")} of ${finding}.`;
      break;
    case "progressed":
      body = `${prefix}there is ${withQual("progression")} of ${finding}.`;
      break;
    case "resolved":
      body = `The previously seen ${finding} has resolved.`;
      break;
    case "not-comparable":
      body = `${finding} is not directly comparable with the prior study.`;
      break;
    default: // indeterminate
      body = `Interval change in ${finding} is indeterminate.`;
      break;
  }
  // Capitalise the first letter (the prefix already starts capitalised).
  return body ? body[0].toUpperCase() + body.slice(1) : body;
}

export interface MeasurementValue {
  label: string;
  value: number;
  unit: string;
}

/**
 * Best-effort extraction of "<label> … <number> <unit>" measurements from free
 * report text, so a report-only comparison still has something to diff before
 * the viewer-measurement bridge (PR 2) provides structured values. Conservative:
 * only mm/cm, a short preceding label, deduped by label (first wins).
 */
export function extractMeasurements(text: string): MeasurementValue[] {
  if (!text) return [];
  const out: MeasurementValue[] = [];
  const seen = new Set<string>();
  // <label> <connector> [approximately] <number> <unit>. A connector is required
  // so we don't mistake the connector word itself for the label. Digits are
  // allowed in the label so anatomical levels ("at L4-L5") stay attached.
  const re = /([A-Za-z][A-Za-z0-9 \-/()]{2,44}?)\s+(?:measures?|measuring|of|is|approximately|~|=|:)\s+(?:approximately\s+)?(\d+(?:\.\d+)?)\s*(mm|cm)\b/gi;
  const stop = new Set(["the", "a", "an", "measures", "measuring", "is", "of", "and", "at", "with"]);
  for (const m of text.matchAll(re)) {
    let label = m[1].trim().replace(/\s+/g, " ");
    // Drop a leading article so "The lesion" ≡ "lesion".
    label = label.replace(/^(the|a|an)\s+/i, "");
    const key = label.toLowerCase();
    if (label.length < 3 || stop.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: Number(m[2]), unit: m[3].toLowerCase() });
  }
  return out;
}

export interface ComparisonRow {
  label: string;
  previous: number | null;
  current: number | null;
  unit: string;
  /** Signed absolute change, or null when not computable. */
  delta: number | null;
  deltaText: string;
  percentText: string;
  /** Whether prior & current are directly comparable (both present, same unit). */
  comparable: boolean;
  note?: string;
  /**
   * Canonical id from the Universal Measurement Registry when the label
   * resolves (e.g. "CBD"). Rows matched by id, not label — two studies that
   * spell the same measurement differently still compare.
   */
  measurementId?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Format the change between a prior and current value. Returns null when either
 *  is absent — never infers change from missing data (Part 5 safety). */
export function formatMeasurementChange(prev: number, curr: number): { delta: number; deltaText: string; percentText: string } {
  const delta = round1(curr - prev);
  const sign = delta > 0 ? "+" : "";
  const pct = prev !== 0 ? Math.round(((curr - prev) / prev) * 100) : null;
  return {
    delta,
    deltaText: `${sign}${delta}`,
    percentText: pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`,
  };
}

/**
 * Join prior & current measurement lists into comparison rows.
 *
 * Matching is by CANONICAL ID via the Universal Measurement Registry (Step 5:
 * comparison compares ids, never display labels): a prior "Common Bile Duct
 * Diameter 0.6 cm" and a current "CBD 7 mm" land on the same row, with the
 * prior converted into the registry's default unit. Labels that do not
 * resolve fall back to the original lowercased-label match, so free-text
 * measurements outside the registry still compare exactly as before.
 * Incompatible units and one-sided measurements are surfaced as non-comparable
 * rather than diffed. Deterministic order: current list first, then prior-only.
 */
export function compareMeasurementRows(
  prior: readonly MeasurementValue[],
  current: readonly MeasurementValue[],
): ComparisonRow[] {
  // Registry id when resolvable, else lowercased label — ONE join key space.
  const joinKey = (m: MeasurementValue): string => {
    const resolved = resolveMeasurement(m.label);
    return resolved ? `id:${resolved.definition.id}` : `label:${m.label.toLowerCase()}`;
  };
  const byKey = (list: readonly MeasurementValue[]) => {
    const map = new Map<string, MeasurementValue>();
    for (const m of list) if (!map.has(joinKey(m))) map.set(joinKey(m), m);
    return map;
  };
  const priorMap = byKey(prior);
  const currentMap = byKey(current);
  const keys: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const m of current) { const k = joinKey(m); if (!seen.has(k)) { seen.add(k); keys.push({ key: k, label: m.label }); } }
  for (const m of prior) { const k = joinKey(m); if (!seen.has(k)) { seen.add(k); keys.push({ key: k, label: m.label }); } }

  return keys.map(({ key, label }) => {
    const p = priorMap.get(key);
    const c = currentMap.get(key);
    const def = key.startsWith("id:") ? getMeasurement(key.slice(3)) : undefined;
    // Registry measurements display under their canonical name at the
    // definition's default unit; unresolved ones keep their raw label/unit.
    const displayLabel = def?.displayName ?? label;
    const measurementId = def?.id;

    // Normalize both sides into the registry's default unit when resolvable.
    const norm = (m: MeasurementValue | undefined): number | null => {
      if (!m) return null;
      if (!def) return m.value;
      const converted = convertUnitValue(m.value, m.unit || def.defaultUnit, def.defaultUnit);
      return converted;
    };
    const pv = norm(p);
    const cv = norm(c);
    const unit = def ? def.defaultUnit : c?.unit ?? p?.unit ?? "";

    if (!p || !c) {
      return {
        label: displayLabel, measurementId, previous: pv, current: cv, unit,
        delta: null, deltaText: "—", percentText: "—", comparable: false,
        note: !p ? "No prior value" : "Not on current study",
      };
    }
    // Unit reconciliation: registry-resolved rows convert; unresolved rows
    // must match exactly (original behavior).
    if (def ? pv === null || cv === null : p.unit !== c.unit) {
      return {
        label: displayLabel, measurementId, previous: def ? pv : p.value, current: def ? cv : c.value, unit,
        delta: null, deltaText: "—", percentText: "—", comparable: false,
        note: `Unit mismatch (${p.unit} vs ${c.unit})`,
      };
    }
    const change = formatMeasurementChange(pv!, cv!);
    return {
      label: displayLabel, measurementId, previous: pv, current: cv, unit,
      delta: change.delta, deltaText: `${change.deltaText}${unit ? " " + unit : ""}`,
      percentText: change.percentText, comparable: true,
    };
  });
}
