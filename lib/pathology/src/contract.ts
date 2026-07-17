// contract.ts — canonical types of the Universal Pathology Analyte Registry.
//
// This package is the ONE place a laboratory analyte's identity lives. Before
// it, a lab result was a free-text row inside `patient_reports.parameters`
// (`[{name,value,unit,refRange,flag}]`) with no canonical identity: the same
// analyte ("Haemoglobin" / "HGB" / "Hb" / "Hemoglobin (Hb)") was spelled a
// different way in every template, its reference range was hand-typed on every
// report, and its High/Low/critical flag was decided by whoever entered it.
// There was no age/sex-aware reference interval, no panic-value engine, no
// LOINC coding, and no notion of a panel (a "CBC" is ~20 analytes, not one row).
//
// The design contract is identical to @workspace/measurements and
// @workspace/report-quality: pure data + pure functions, no dependency on
// React, Express or the DB — the same registry runs on client and server.
//
// Identity rules (mirrors lib/measurements/src/contract.ts):
//   - `id` is STABLE and IMMUTABLE (e.g. "HEMOGLOBIN"). Display text may change
//     freely; ids never do. Persistence, flagging, comparison and analytics
//     key off the id. Rename => deprecate + `replacedBy`, never mutate.
//   - `canonicalKey` is the hierarchical namespaced key (e.g.
//     "analyte.hemoglobin" / "panel.cbc") — a permanent, grandfathered alias.
//   - `aliases` carry every legacy spelling found in the wild (template
//     parameter names, HL7 test codes, imported lab dictionaries) so all
//     historical label spaces resolve to one identity. Resolution is
//     DETERMINISTIC — no fuzzy matching.

/** Laboratory sections a test belongs to (matches testCategories seed names). */
export type LabDepartment =
  | "Hematology"
  | "Biochemistry"
  | "Serology"
  | "Immunology"
  | "Microbiology"
  | "Endocrinology"
  | "Clinical Pathology"
  | "Histopathology"
  | "Cytology"
  | "Molecular";

/** Patient sex an interval applies to. "any" = not sex-specific. */
export type Sex = "male" | "female" | "any";

/**
 * How a result value is interpreted.
 *  - "numeric"     — a quantity compared against low/high bounds (Hb, glucose).
 *  - "ratio"       — a dimensionless quantity/index (A:G ratio) — like numeric.
 *  - "categorical" — a value drawn from a fixed set (Reactive/Non-Reactive,
 *                    blood group) — flagged by membership, not by magnitude.
 *  - "titre"       — a serial dilution ("1:80") — preserved as text; a helper
 *                    parses the denominator for ordering, never auto-flagged.
 *  - "text"        — free narrative (microscopy, culture) — never auto-flagged.
 */
export type ResultType = "numeric" | "ratio" | "categorical" | "titre" | "text";

/**
 * Abnormal flag codes — a subset of HL7 Table 0078 ("Interpretation Codes")
 * so downstream HL7/LIS integration inherits a standard vocabulary:
 *   N  normal            L  below low          H  above high
 *   LL critical low (panic)                    HH critical high (panic)
 *   A  abnormal (categorical result out of the expected set)
 *   AA critical abnormal (categorical panic, e.g. a positive panic serology)
 *   ""  no interpretation possible (text/titre, unit mismatch, no range)
 */
export type AbnormalFlag = "N" | "L" | "H" | "LL" | "HH" | "A" | "AA" | "";

/** Human-readable status paired with each AbnormalFlag. */
export type FlagStatus =
  | "normal"
  | "low"
  | "high"
  | "critical-low"
  | "critical-high"
  | "abnormal"
  | "critical-abnormal"
  | "unknown";

/**
 * A reference interval — the normal range for an analyte, scoped to the
 * population it applies to. An analyte carries an ORDERED list of these; the
 * resolver picks the most specific one matching a patient's sex/age/condition.
 *
 * Bounds are in the analyte's `defaultUnit` unless `unit` overrides. Either
 * bound may be omitted for an open-ended interval (e.g. `high: 200` only, for
 * "desirable < 200"). Ages are in YEARS (fractional allowed — a neonatal band
 * is `ageMinYears: 0, ageMaxYears: 28/365.25`); `ageMinYears` is inclusive and
 * `ageMaxYears` is exclusive so contiguous bands never overlap.
 */
export interface ReferenceInterval {
  sex: Sex;
  /** Inclusive lower age bound in years (omit = from birth). */
  ageMinYears?: number;
  /** Exclusive upper age bound in years (omit = no upper limit). */
  ageMaxYears?: number;
  /**
   * Optional physiological context this interval requires, e.g.
   * "pregnancy-t1" | "fasting" | "postmenopausal". When set, the interval only
   * applies if the caller passes a matching `condition`. Intervals without a
   * condition are the general-population default.
   */
  condition?: string;
  /** Lower bound of normal (in unit/defaultUnit). Omit for one-sided ranges. */
  low?: number;
  /** Upper bound of normal (in unit/defaultUnit). Omit for one-sided ranges. */
  high?: number;
  /** Unit of the bounds; defaults to the analyte's defaultUnit. */
  unit?: string;
  /** Per-interval critical-low override (else the analyte-level value applies). */
  criticalLow?: number;
  /** Per-interval critical-high override (else the analyte-level value applies). */
  criticalHigh?: number;
  /** Display string when the range is not a simple pair (e.g. "Desirable < 200"). */
  text?: string;
  /** Clinical note / qualifier surfaced in the registry console. */
  note?: string;
  /** Source of the interval (guideline, textbook) for auditability. */
  source?: string;
}

/** One allowed value of a categorical analyte and how to interpret it. */
export interface CategoricalValue {
  /** Canonical result value (e.g. "Reactive", "Non-Reactive", "O Positive"). */
  value: string;
  /** Flag to apply when a result matches this value (default "N"). */
  flag?: AbnormalFlag;
  /** Legacy spellings that map to this value (e.g. "Positive" -> "Reactive"). */
  aliases?: readonly string[];
}

/** Cross-references to the systems that consume this analyte. */
export interface AnalyteRefs {
  /** diagnostic_tests.code values that report this analyte. */
  testCodes?: readonly string[];
  /** Panel ids (this registry) that include this analyte. */
  panels?: readonly string[];
  /** HL7 / LIS observation identifiers, if integrated. */
  hl7Codes?: readonly string[];
}

export interface AnalyteDefinition {
  /** Stable immutable canonical id, SCREAMING_SNAKE (e.g. "HEMOGLOBIN"). */
  id: string;
  /** Namespaced hierarchical key (e.g. "analyte.hemoglobin"). Permanent alias. */
  canonicalKey: string;
  /** Full display name shown on the report ("Hemoglobin"). */
  displayName: string;
  /** Compact label for dense grids ("Hb"); falls back to displayName. */
  shortName?: string;
  /** Every legacy spelling/code that must resolve to this identity. */
  aliases: readonly string[];
  /** LOINC code (the international lab observation standard), when known. */
  loinc?: string;
  description: string;
  department: LabDepartment;
  resultType: ResultType;
  /** Canonical unit for storage/flagging (e.g. "g/dL"). Empty for text results. */
  defaultUnit: string;
  /** Units accepted on input; all must be known to units.ts. */
  allowedUnits: readonly string[];
  /** Decimal places for display/rounding. */
  precision: number;
  /**
   * Ordered reference intervals. The resolver scores each by specificity and
   * returns the best match for a patient's sex/age/condition. Empty for
   * text/titre analytes.
   */
  referenceIntervals: readonly ReferenceInterval[];
  /** Panic low (in defaultUnit): value <= this is "critical-low" (LL). */
  criticalLow?: number;
  /** Panic high (in defaultUnit): value >= this is "critical-high" (HH). */
  criticalHigh?: number;
  /**
   * Implausible bounds for data-entry sanity (in defaultUnit). A value outside
   * [absurdLow, absurdHigh] is almost certainly a typo/unit error and is
   * surfaced as "unknown" rather than silently flagged.
   */
  absurdLow?: number;
  absurdHigh?: number;
  /**
   * Clinical direction: true when a HIGH value is the dangerous one (glucose,
   * creatinine), false when a LOW value is (hemoglobin, platelets). Used only
   * for phrasing/severity hints; flagging itself is symmetric.
   */
  higherIsWorse?: boolean;
  /** For resultType "categorical": the allowed values and their flags. */
  categories?: readonly CategoricalValue[];
  refs: AnalyteRefs;
  /** Per-definition version for reproducibility (bump on any semantic change). */
  version: string;
  deprecated?: boolean;
  /** When deprecated, the id that replaces this one. */
  replacedBy?: string;
  notes?: string;
}

/**
 * A panel/profile: an ordered set of analytes billed and reported together
 * (CBC, LFT, Lipid Profile). Panels declare *which* analytes; the analyte
 * definitions own *what each means*. This is the missing structural concept —
 * `diagnostic_tests` has a single price row per panel with no components.
 */
export interface PanelDefinition {
  /** Stable immutable canonical id, SCREAMING_SNAKE (e.g. "CBC"). */
  id: string;
  /** Namespaced key (e.g. "panel.cbc"). Permanent alias. */
  canonicalKey: string;
  displayName: string;
  /** Every legacy spelling/test-code that must resolve to this panel. */
  aliases: readonly string[];
  loinc?: string;
  description: string;
  department: LabDepartment;
  /** Ordered analyte ids that make up this panel (report order). */
  analytes: readonly string[];
  /** diagnostic_tests.code values that bill as this panel. */
  testCodes?: readonly string[];
  version: string;
  deprecated?: boolean;
  replacedBy?: string;
  notes?: string;
}

/** Result of resolving an arbitrary label/key/code to a canonical analyte. */
export interface AnalyteResolution {
  definition: AnalyteDefinition;
  matchedBy: "id" | "canonicalKey" | "alias" | "alias-stripped";
  input: string;
}

/** Result of resolving an arbitrary label/key/code to a canonical panel. */
export interface PanelResolution {
  definition: PanelDefinition;
  matchedBy: "id" | "canonicalKey" | "alias" | "alias-stripped";
  input: string;
}

/**
 * The effective reference interval chosen for a specific patient, flattened so
 * consumers never re-run the specificity scoring. `low`/`high`/criticals are in
 * `unit`. `matched` is false when only a generic fallback (or nothing) applied.
 */
export interface ResolvedInterval {
  analyteId: string;
  interval: ReferenceInterval | null;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
  unit: string;
  /** Human display of the range ("13.0 – 17.0 g/dL", "< 200", or a `text`). */
  display: string;
  /** True when a sex/age/condition-specific interval matched (not just a default). */
  matched: boolean;
}

/** Outcome of flagging one result value against the registry. */
export interface FlagResult {
  analyteId: string;
  flag: AbnormalFlag;
  status: FlagStatus;
  /** Numeric value parsed from the input (null for categorical/text/unparseable). */
  value: number | null;
  unit: string;
  /** The interval used (null when none applied). */
  interval: ReferenceInterval | null;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
  /** Human display of the range for the report line. */
  rangeDisplay: string;
  /** Why the status is what it is (surfaced in tooltips/audits). */
  detail?: string;
}

/** Context describing the patient a result belongs to. */
export interface PatientContext {
  sex?: string;
  ageYears?: number;
  /** Physiological condition matching ReferenceInterval.condition, if any. */
  condition?: string;
}

/** Structured problem found while validating a set of definitions. */
export interface RegistryValidationIssue {
  kind:
    | "duplicate-id"
    | "duplicate-alias"
    | "unit-not-allowed"
    | "unknown-unit"
    | "range-inverted"
    | "range-unit-not-allowed"
    | "critical-inverted"
    | "interval-age-inverted"
    | "categorical-without-values"
    | "numeric-without-range"
    | "panel-unknown-analyte"
    | "bad-loinc"
    | "bad-replaced-by";
  /** analyte or panel id the issue belongs to. */
  entityId: string;
  detail: string;
}
