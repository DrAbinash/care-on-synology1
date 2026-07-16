// compare.ts — comparison semantics inherited from the registry.
//
// Previous Comparison compares canonical IDs, never display labels (Step 5).
// Units, precision and strategy come from the definition, so every consumer
// (ComparisonPanel, copilot comparison module, quality rules) computes the
// same delta for the same pair of values.

import type { MeasurementDefinition } from "./contract";
import { convertUnitValue, canonicalUnit } from "./units";

export interface MeasurementComparison {
  measurementId: string;
  /** Values normalized into the measurement's defaultUnit (null = not convertible). */
  priorValue: number | null;
  currentValue: number | null;
  unit: string;
  delta: number | null;
  percentChange: number | null;
  direction: "increased" | "decreased" | "unchanged" | "incomparable";
  /** Values formatted at the definition's precision, with unit. */
  formattedPrior: string | null;
  formattedCurrent: string | null;
}

function toDefaultUnit(def: MeasurementDefinition, value: number, unit?: string): number | null {
  if (!unit || canonicalUnit(unit) === canonicalUnit(def.defaultUnit)) return value;
  return convertUnitValue(value, unit, def.defaultUnit);
}

export function formatMeasurementValue(def: MeasurementDefinition, value: number): string {
  const v = value.toFixed(def.precision);
  return def.defaultUnit ? `${v} ${def.defaultUnit}` : v;
}

export function compareMeasurementValues(
  def: MeasurementDefinition,
  prior: { value: number; unit?: string },
  current: { value: number; unit?: string },
): MeasurementComparison {
  const priorValue = toDefaultUnit(def, prior.value, prior.unit);
  const currentValue = toDefaultUnit(def, current.value, current.unit);

  let delta: number | null = null;
  let percentChange: number | null = null;
  let direction: MeasurementComparison["direction"] = "incomparable";

  if (priorValue !== null && currentValue !== null) {
    delta = currentValue - priorValue;
    percentChange = priorValue !== 0 ? (delta / Math.abs(priorValue)) * 100 : null;
    // "Unchanged" at the definition's display precision — a 0.04 mm drift on a
    // 1-decimal measurement is noise, not a change.
    const epsilon = Math.pow(10, -def.precision) / 2;
    direction = Math.abs(delta) < epsilon ? "unchanged" : delta > 0 ? "increased" : "decreased";
  }

  return {
    measurementId: def.id,
    priorValue,
    currentValue,
    unit: def.defaultUnit,
    delta,
    percentChange,
    direction,
    formattedPrior: priorValue !== null ? formatMeasurementValue(def, priorValue) : null,
    formattedCurrent: currentValue !== null ? formatMeasurementValue(def, currentValue) : null,
  };
}

/** Range check against the definition's normal/critical ranges (defaultUnit). */
export function classifyMeasurementValue(
  def: MeasurementDefinition,
  value: number,
  unit?: string,
): { status: "normal" | "abnormal" | "critical" | "unclassified"; detail?: string } {
  const v = toDefaultUnit(def, value, unit);
  if (v === null) return { status: "unclassified", detail: `unit "${unit}" not convertible to ${def.defaultUnit}` };

  const crit = def.criticalRange;
  if (crit && ((crit.high !== undefined && v >= crit.high) || (crit.low !== undefined && v <= crit.low))) {
    return { status: "critical", detail: crit.note };
  }
  const normal = def.normalRange;
  if (!normal) return { status: "unclassified" };
  if ((normal.high !== undefined && v > normal.high) || (normal.low !== undefined && v < normal.low)) {
    return { status: "abnormal", detail: normal.note };
  }
  return { status: "normal" };
}
