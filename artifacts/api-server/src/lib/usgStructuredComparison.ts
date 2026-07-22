/**
 * usgStructuredComparison — deterministic current-vs-prior measurement deltas (P4.2).
 *
 * Compares structured measurements by CANONICAL key, computing absolute and
 * percentage change and interval. It never auto-classifies clinical
 * progression — it only reports increased / decreased / unchanged (within a
 * configurable tolerance) / new / resolved / not-comparable, and always exposes
 * the underlying values. Radiologist approval is required before any comparison
 * text enters a report (that gate lives in the UI/text layer). Pure + testable.
 */

import { convertUnitValue } from "@workspace/measurements";

export interface MeasurementPoint {
  key: string;           // canonical measurement id
  label: string;
  value: string;         // may include a unit
  unit?: string | null;
  sourceType?: string | null;
}

export type ComparisonDirection =
  | "increased" | "decreased" | "unchanged" | "new" | "resolved" | "not_comparable";

export interface ComparisonRow {
  key: string;
  label: string;
  current: { value: string; num: number | null; unit: string | null } | null;
  prior: { value: string; num: number | null; unit: string | null } | null;
  absoluteChange: number | null;    // in the current unit
  percentChange: number | null;
  direction: ComparisonDirection;
  intervalDays: number | null;
  note: string | null;              // honest caveat, e.g. unit/plane mismatch
}

export interface CompareOptions {
  intervalDays?: number | null;
  /** |Δ| within this % counts as "unchanged". Default 5%. */
  unchangedTolerancePct?: number;
}

function parseNum(v: string | null | undefined): number | null {
  if (v == null) return null;
  const m = String(v).match(/-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : null;
}
function parseUnit(p: MeasurementPoint): string | null {
  if (p.unit) return p.unit.trim().toLowerCase();
  const m = String(p.value).match(/[a-z%]+\s*$/i);
  return m ? m[0].trim().toLowerCase() : null;
}

export function compareMeasurements(
  current: MeasurementPoint[],
  prior: MeasurementPoint[],
  opts: CompareOptions = {},
): ComparisonRow[] {
  const tol = opts.unchangedTolerancePct ?? 5;
  const priorByKey = new Map(prior.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const rows: ComparisonRow[] = [];

  const build = (cur: MeasurementPoint | null, pri: MeasurementPoint | null): ComparisonRow => {
    const key = (cur ?? pri)!.key;
    const label = (cur ?? pri)!.label;
    const curUnit = cur ? parseUnit(cur) : null;
    const priUnit = pri ? parseUnit(pri) : null;
    const curNum = cur ? parseNum(cur.value) : null;
    let priNum = pri ? parseNum(pri.value) : null;
    let note: string | null = null;

    // Align prior to the current unit where interconvertible.
    if (curNum != null && priNum != null && curUnit && priUnit && curUnit !== priUnit) {
      const converted = convertUnitValue(priNum, priUnit, curUnit);
      if (converted != null) priNum = converted;
      else note = `Units differ (${priUnit} vs ${curUnit}) — compared as reported.`;
    }

    let direction: ComparisonDirection;
    let abs: number | null = null;
    let pct: number | null = null;

    if (!cur) direction = "resolved";
    else if (!pri) direction = "new";
    else if (curNum == null || priNum == null) { direction = "not_comparable"; note = note ?? "Non-numeric value — not directly comparable."; }
    else {
      abs = Math.round((curNum - priNum) * 100) / 100;
      pct = priNum !== 0 ? Math.round((abs / Math.abs(priNum)) * 1000) / 10 : null;
      if (pct != null && Math.abs(pct) <= tol) direction = "unchanged";
      else direction = abs > 0 ? "increased" : abs < 0 ? "decreased" : "unchanged";
    }

    return {
      key, label,
      current: cur ? { value: cur.value, num: curNum, unit: curUnit } : null,
      prior: pri ? { value: pri.value, num: priNum, unit: curUnit ?? priUnit } : null,
      absoluteChange: abs,
      percentChange: pct,
      direction,
      intervalDays: opts.intervalDays ?? null,
      note,
    };
  };

  for (const cur of current) {
    seen.add(cur.key);
    rows.push(build(cur, priorByKey.get(cur.key) ?? null));
  }
  // Priors with no current value → resolved.
  for (const pri of prior) {
    if (!seen.has(pri.key)) rows.push(build(null, pri));
  }
  return rows;
}

/** Honest, non-classifying phrase for a row (values shown by the caller). */
export function comparisonPhrase(row: ComparisonRow): string {
  switch (row.direction) {
    case "increased": return `increased${row.percentChange != null ? ` by ${Math.abs(row.percentChange)}%` : ""}`;
    case "decreased": return `decreased${row.percentChange != null ? ` by ${Math.abs(row.percentChange)}%` : ""}`;
    case "unchanged": return "unchanged within tolerance";
    case "new": return "newly reported (no prior value)";
    case "resolved": return "not reported on the current study";
    case "not_comparable": return "comparison limited (different measurement plane/source)";
  }
}
