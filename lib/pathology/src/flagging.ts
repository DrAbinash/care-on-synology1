// flagging.ts — classify a result value against the registry.
//
// Turns a raw result + a patient context into an HL7-style interpretation:
// N / L / H / LL / HH for quantities, A / AA for categorical results. Panic
// (critical) values are checked FIRST and independently of the reference
// interval, because a critically high potassium must escalate even if no
// age/sex range matched. Values in an accepted alternate unit are converted to
// the analyte's units before comparison; a non-convertible unit yields "unknown"
// rather than a wrong flag. Non-numeric quantities and text/titre results are
// never auto-flagged.

import type { AnalyteDefinition, AbnormalFlag, FlagResult, FlagStatus, PatientContext } from "./contract";
import { convertUnitValue } from "./units";
import { normalizeAnalyteLabel } from "./normalize";
import { resolveReferenceInterval, formatReferenceRange } from "./referenceRanges";

/** Parse the numeric part of a result ("13.4", "<0.01", "1,20,000"). */
export function parseNumericResult(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const m = cleaned.match(/^[<>]?\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}

export function flagToStatus(flag: AbnormalFlag): FlagStatus {
  switch (flag) {
    case "N": return "normal";
    case "L": return "low";
    case "H": return "high";
    case "LL": return "critical-low";
    case "HH": return "critical-high";
    case "A": return "abnormal";
    case "AA": return "critical-abnormal";
    default: return "unknown";
  }
}

/** True for any flag that should surface the report as clinically abnormal. */
export function isAbnormalFlag(flag: AbnormalFlag): boolean {
  return flag === "L" || flag === "H" || flag === "LL" || flag === "HH" || flag === "A" || flag === "AA";
}

/** True for panic/critical flags that warrant immediate escalation. */
export function isCriticalFlag(flag: AbnormalFlag): boolean {
  return flag === "LL" || flag === "HH" || flag === "AA";
}

function unknown(def: AnalyteDefinition, detail: string, value: number | null): FlagResult {
  return {
    analyteId: def.id,
    flag: "",
    status: "unknown",
    value,
    unit: def.defaultUnit,
    interval: null,
    rangeDisplay: "—",
    detail,
  };
}

function flagCategorical(def: AnalyteDefinition, raw: unknown): FlagResult {
  const value = String(raw ?? "").trim();
  const norm = normalizeAnalyteLabel(value);
  const cats = def.categories ?? [];
  const expected = cats.map((c) => c.value).join(" / ");
  if (!norm) return { ...unknown(def, "empty categorical result", null), rangeDisplay: expected || "—" };
  for (const c of cats) {
    const forms = [c.value, ...(c.aliases ?? [])].map(normalizeAnalyteLabel);
    if (forms.includes(norm)) {
      const flag = c.flag ?? "N";
      return {
        analyteId: def.id,
        flag,
        status: flagToStatus(flag),
        value: null,
        unit: "",
        interval: null,
        rangeDisplay: expected || "—",
        detail: `matched "${c.value}"`,
      };
    }
  }
  return {
    ...unknown(def, `"${value}" is not a recognized value`, null),
    unit: "",
    rangeDisplay: expected || "—",
  };
}

/**
 * Flag a single result value for an analyte against a patient context.
 * `inputUnit` defaults to the analyte's defaultUnit.
 */
export function flagValue(
  def: AnalyteDefinition,
  raw: unknown,
  ctx: PatientContext = {},
  inputUnit?: string,
): FlagResult {
  if (def.resultType === "categorical") return flagCategorical(def, raw);
  if (def.resultType === "text" || def.resultType === "titre") {
    return unknown(def, `${def.resultType} results are not auto-flagged`, parseNumericResult(raw));
  }

  const value = parseNumericResult(raw);
  if (value === null) return unknown(def, "result is not numeric", null);

  const fromUnit = inputUnit ?? def.defaultUnit;

  // Value in the analyte's defaultUnit (for critical + sanity checks).
  const vDefault = convertUnitValue(value, fromUnit, def.defaultUnit);
  if (vDefault === null) {
    return { ...unknown(def, `unit "${fromUnit}" is not comparable to ${def.defaultUnit}`, value), unit: fromUnit };
  }

  // Implausible values are almost certainly data-entry/unit errors.
  if (
    (def.absurdLow !== undefined && vDefault < def.absurdLow) ||
    (def.absurdHigh !== undefined && vDefault > def.absurdHigh)
  ) {
    return { ...unknown(def, "value is physiologically implausible — check units/entry", value), unit: def.defaultUnit };
  }

  const ri = resolveReferenceInterval(def, ctx);

  // Critical/panic checks use the analyte's defaultUnit, independent of the
  // reference interval (a panic value escalates even with no matched range).
  const critLow = ri.criticalLow;   // interval override already folded in
  const critHigh = ri.criticalHigh;
  const base = {
    analyteId: def.id,
    value,
    unit: def.defaultUnit,
    interval: ri.interval,
    low: ri.low,
    high: ri.high,
    criticalLow: critLow,
    criticalHigh: critHigh,
    rangeDisplay: ri.display,
  };
  if (critLow !== undefined && vDefault <= critLow) {
    return { ...base, flag: "LL", status: "critical-low", detail: "at/below critical low" };
  }
  if (critHigh !== undefined && vDefault >= critHigh) {
    return { ...base, flag: "HH", status: "critical-high", detail: "at/above critical high" };
  }

  // Reference-range checks use the interval's unit.
  if (!ri.matched || (ri.low === undefined && ri.high === undefined)) {
    return { ...base, flag: "", status: "unknown", detail: "no reference interval for this patient" };
  }
  const vRange = convertUnitValue(value, fromUnit, ri.unit);
  if (vRange === null) {
    return { ...base, flag: "", status: "unknown", detail: `unit "${fromUnit}" not comparable to ${ri.unit}` };
  }
  if (ri.low !== undefined && vRange < ri.low) {
    return { ...base, flag: "L", status: "low", detail: "below reference low" };
  }
  if (ri.high !== undefined && vRange > ri.high) {
    return { ...base, flag: "H", status: "high", detail: "above reference high" };
  }
  return { ...base, flag: "N", status: "normal" };
}

/** Convenience: the report-ready range string for a patient (no value needed). */
export function referenceRangeFor(def: AnalyteDefinition, ctx: PatientContext = {}): string {
  const ri = resolveReferenceInterval(def, ctx);
  return formatReferenceRange(ri.interval, def.precision, def.defaultUnit);
}
