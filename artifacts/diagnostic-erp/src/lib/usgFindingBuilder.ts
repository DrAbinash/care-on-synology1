/**
 * usgFindingBuilder — the Dynamic Finding Builder's pure core (Phase P1).
 *
 * This is NOT a second reporting engine. It EXTENDS the existing structured
 * finding model (structuredFindings.ts): a finding is still parameters →
 * deterministic template text + impression, and the final grammar assembly is
 * delegated to `fillStructuredTemplate` from that engine. What P1 adds on top:
 *
 *   - richer parameter types (number + unit, yes/no, multi-select) beyond the
 *     base select/text,
 *   - numeric parsing / unit normalisation (mm ⇄ cm) that preserves the entered
 *     value, the display unit and a normalised value,
 *   - derived/calculated values (ellipsoid volume) via ONE frontend formula
 *     source that mirrors the canonical server engine,
 *   - a structured Finding Object that is stored alongside the generated prose
 *     (never instead of it), so a finding round-trips as data, not only text.
 *
 * Everything here is pure and deterministic — no AI, no network, no React — so
 * it is fully unit-testable under the repo's node test environment.
 */

import { fillStructuredTemplate } from "./structuredFindings";

// ─────────────────────────────────────────────────────────────────────────────
// Parameter model
// ─────────────────────────────────────────────────────────────────────────────

export type UsgParamType = "select" | "multiselect" | "yesno" | "number" | "text";

export interface UsgFindingParam {
  key: string;
  label: string;
  type: UsgParamType;
  /** select / multiselect options. */
  options?: string[];
  /** number: the default display unit (e.g. "mm", "cm", "cc", "ml"). */
  unit?: string;
  /** number: units the field accepts (drives the unit toggle in the UI). */
  units?: string[];
  /** number: canonical unit the value is normalised to (e.g. "mm"). */
  normalizeTo?: string;
  /** yes/no: phrase substituted when the answer is affirmative. Absent answers
   *  render empty so their optional clause is dropped by the template engine. */
  presentText?: string;
  default?: string;
  required?: boolean;
  sortOrder?: number;
}

/** Answers treated as affirmative for a yes/no parameter (case-insensitive). */
const YES_VALUES = new Set(["yes", "present", "positive", "true", "y"]);
/** Length-unit conversion factors to millimetres. Volume units pass through. */
const LENGTH_TO_MM: Record<string, number> = { mm: 1, cm: 10 };

export function isAffirmative(value: string | undefined): boolean {
  return YES_VALUES.has((value ?? "").trim().toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric parsing + unit normalisation
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedMeasurement {
  raw: string;                 // exactly what the user entered
  value: number | null;        // numeric part, in the entered/display unit
  unit: string;                // display unit
  normalized: number | null;   // value converted to `normalizeTo` (or same unit)
  normalizedUnit: string;
  display: string;             // human string, e.g. "5.5 mm"
}

/** Trim trailing zeros from a formatted number ("3.0" → "3", "3.50" → "3.5"). */
function tidyNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Parse a numeric measurement string. Accepts an embedded unit ("5.5 mm",
 * "3cm") which overrides `defaultUnit`. Normalises length units to
 * `normalizeTo` when both are lengths (mm/cm); other units pass through.
 */
export function parseMeasurement(
  raw: string | null | undefined,
  opts: { defaultUnit?: string; normalizeTo?: string } = {},
): ParsedMeasurement {
  const defaultUnit = (opts.defaultUnit ?? "mm").toLowerCase();
  const normalizeTo = (opts.normalizeTo ?? defaultUnit).toLowerCase();
  const text = (raw ?? "").trim();
  const empty: ParsedMeasurement = {
    raw: text, value: null, unit: defaultUnit, normalized: null, normalizedUnit: normalizeTo, display: "",
  };
  if (!text) return empty;

  const m = text.match(/^([+-]?\d*\.?\d+)\s*(mm|cm|cc|ml)?$/i);
  if (!m) return empty;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return empty;
  const unit = (m[2] || defaultUnit).toLowerCase();

  let normalized = value;
  let normalizedUnit = unit;
  if (unit in LENGTH_TO_MM && normalizeTo in LENGTH_TO_MM) {
    const mm = value * LENGTH_TO_MM[unit];
    normalized = mm / LENGTH_TO_MM[normalizeTo];
    normalizedUnit = normalizeTo;
    // guard floating dust (e.g. 3 cm → 30 mm exactly)
    normalized = Math.round(normalized * 1000) / 1000;
  }
  return { raw: text, value, unit, normalized, normalizedUnit, display: `${tidyNumber(value)} ${unit}` };
}

/** Convert a parsed measurement to millimetres, or null. */
export function toMm(p: ParsedMeasurement): number | null {
  if (p.value == null) return null;
  if (p.unit in LENGTH_TO_MM) return p.value * LENGTH_TO_MM[p.unit];
  return p.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ellipsoid volume — SINGLE frontend source of the formula
// ─────────────────────────────────────────────────────────────────────────────
//
// V = 0.523 · L · W · H  (0.523 ≈ π/6, the prolate-ellipsoid factor). Inputs in
// millimetres, result in millilitres (=cc); mirrors the canonical server engine
// artifacts/api-server/src/lib/usgMeasurementEngine.ts (volEllipsoid/volProstate)
// which is not importable across packages. Kept here as the ONE frontend copy so
// the Dynamic Finding Builder never scatters the constant across components.

export const ELLIPSOID_FACTOR = 0.523;

export function ellipsoidVolumeMl(
  lMm: number | null | undefined,
  wMm: number | null | undefined,
  hMm: number | null | undefined,
): number | null {
  if (lMm == null || wMm == null || hMm == null) return null;
  if (!(lMm > 0) || !(wMm > 0) || !(hMm > 0)) return null;
  return Math.round((lMm * wMm * hMm * ELLIPSOID_FACTOR / 1000) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding definition + generated Finding Object
// ─────────────────────────────────────────────────────────────────────────────

export interface DerivedValue {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  source: "calculated" | "manual";
  provenance?: string;         // e.g. "AP × TR × CC ellipsoid (0.523)"
}

export interface DeriveResult {
  /** extra render keys consumed by the finding/impression templates. */
  render?: Record<string, string>;
  derived?: DerivedValue[];
  warnings?: string[];
}

export interface UsgFindingDef {
  id: string;
  organ: string;               // organ key (matches the organ library)
  organLabel: string;
  findingType: string;         // "Renal calculus"
  /** key of the laterality parameter, if the finding has one. */
  lateralityParam?: string;
  params: UsgFindingParam[];
  findingText: string;         // template ({key} + [optional clauses])
  impressionText: string;      // template
  /** finding-specific deterministic derivation (plurals, sentences, volume). */
  derive?: (values: Record<string, string>) => DeriveResult;
}

export type UsgFindingSourceType = "manual" | "measurement" | "sr" | "ocr";

/** The structured Finding Object persisted alongside the generated prose. */
export interface UsgFindingObject {
  findingDefId: string;
  organ: string;
  laterality: string | null;
  findingType: string;
  parameters: Record<string, string>;   // raw entered values
  units: Record<string, string>;        // display unit per numeric parameter
  derived: DerivedValue[];
  sourceType: UsgFindingSourceType;
  sourceMeasurementRef: string | null;
  findingText: string;                   // generated prose
  impressionText: string;                // generated impression contribution
  editedText: string | null;            // radiologist override of findingText
  warnings: string[];
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GenerateOptions {
  sourceType?: UsgFindingSourceType;
  sourceMeasurementRef?: string | null;
  author?: string | null;
  timestamp?: string | null;
  editedText?: string | null;
}

export interface GenerateResult {
  object: UsgFindingObject;
  render: Record<string, string>;
}

/** Human join: ["a","b","c"] → "a, b and c". */
function naturalJoin(items: string[]): string {
  const xs = items.map((s) => s.trim()).filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Build the base render map (before finding-specific derivation). */
export function renderParams(
  params: UsgFindingParam[],
  values: Record<string, string>,
): { render: Record<string, string>; units: Record<string, string> } {
  const render: Record<string, string> = {};
  const units: Record<string, string> = {};
  for (const p of params) {
    const v = (values[p.key] ?? "").trim();
    switch (p.type) {
      case "number": {
        const parsed = parseMeasurement(v, { defaultUnit: p.unit, normalizeTo: p.normalizeTo ?? p.unit });
        render[p.key] = parsed.display;      // "" when empty → drops optional clause
        units[p.key] = parsed.unit;
        break;
      }
      case "yesno":
        render[p.key] = isAffirmative(v) ? (p.presentText ?? p.label) : "";
        break;
      case "multiselect":
        render[p.key] = naturalJoin(v ? v.split(",") : []);
        break;
      default:                                // select / text
        render[p.key] = v;
    }
  }
  return { render, units };
}

/**
 * Generate a finding: deterministic prose + impression contribution + the
 * structured Finding Object. Grammar assembly is delegated to the existing
 * engine (`fillStructuredTemplate`), so this shares the platform's ONE
 * template mechanism rather than introducing a parallel one.
 */
export function generateUsgFinding(
  def: UsgFindingDef,
  values: Record<string, string>,
  opts: GenerateOptions = {},
): GenerateResult {
  const { render: base, units } = renderParams(def.params, values);
  const d = def.derive ? def.derive(values) : {};
  const render = { ...base, ...(d.render ?? {}) };
  const derived = d.derived ?? [];
  const warnings = d.warnings ?? [];

  const findingText = fillStructuredTemplate(def.findingText, render);
  const impressionText = fillStructuredTemplate(def.impressionText, render);

  const laterality = def.lateralityParam ? (values[def.lateralityParam] ?? "").trim() || null : null;

  const object: UsgFindingObject = {
    findingDefId: def.id,
    organ: def.organ,
    laterality,
    findingType: def.findingType,
    parameters: { ...values },
    units,
    derived,
    sourceType: opts.sourceType ?? "manual",
    sourceMeasurementRef: opts.sourceMeasurementRef ?? null,
    findingText,
    impressionText,
    editedText: opts.editedText ?? null,
    warnings,
    author: opts.author ?? null,
    createdAt: opts.timestamp ?? null,
    updatedAt: opts.timestamp ?? null,
  };
  return { object, render };
}

/** The prose that goes into the report for a finding: the radiologist's edit
 *  wins over the generated text (never silently overwritten). */
export function effectiveFindingText(o: UsgFindingObject): string {
  return (o.editedText ?? "").trim() || o.findingText;
}

/** Initial values for a finding's parameters (default → first option → ""). */
export function initialFindingValues(def: UsgFindingDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.params) {
    out[p.key] = p.default ?? (p.type === "select" ? (p.options?.[0] ?? "") : "");
  }
  return out;
}
