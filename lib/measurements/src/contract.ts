// contract.ts — canonical types of the Universal Measurement Registry.
//
// This package is the ONE place a measurement's identity lives. Every other
// system — Viewer, Reporting Workspace, Quick Measurements, Previous
// Comparison, Companion, Copilot, Knowledge Packs, Quality Engine — resolves
// labels/keys/columns to a canonical MeasurementDefinition and speaks its
// immutable `id` from then on. Nothing here depends on React, Express, or the
// DB: pure data + pure functions, identical on client and server (the same
// design contract as @workspace/report-quality).
//
// Identity rules (mirrors lib/report-quality/src/ruleCatalog.ts):
//   - `id` is STABLE and IMMUTABLE (e.g. "STONE_SIZE"). Display text may
//     change freely; ids never do. Analytics, comparison, quality rules and
//     persistence key off the id.
//   - `canonicalKey` is the hierarchical namespaced key (e.g.
//     "meas.stone_size") bridging the pre-existing content-pack measurement
//     library (seeds/radiology/content-packs/v1/_shared_libraries*.yaml),
//     grandfathered as a permanent alias.
//   - `aliases` carry every legacy spelling found in the wild (panels,
//     templates, quick measurements, protocol CSVs, extractor regexes) so all
//     historical label spaces resolve to one identity.

/** Modality codes as used across the platform (normalizeModality-compatible). */
export type MeasurementModality = "US" | "CT" | "MR" | "XR" | "MG" | "BMD";

/** How Previous Comparison should compare two values of this measurement. */
export type ComparisonStrategy =
  /** Compare absolute delta in defaultUnit (sizes, diameters, lengths). */
  | "absolute-change"
  /** Compare percent change (volumes, counts where relative growth matters). */
  | "percent-change"
  /** Ratios/indices compared as trend on the raw value (CTR, RI, PI, Evans). */
  | "ratio-trend"
  /** Presence/absence matters more than magnitude (e.g. free fluid depth). */
  | "presence"
  /** Categorical scales (BI-RADS, TI-RADS grades) — equality, not arithmetic. */
  | "categorical";

/** Viewer tool kind a measurement maps to (viewer_measurements.measurementType). */
export type ViewerTool = "linear" | "area" | "volume" | "ellipse" | "angle" | "density" | "ratio" | "count" | "none";

export interface MeasurementRange {
  low?: number;
  high?: number;
  /** Unit of the bounds; defaults to the measurement's defaultUnit. */
  unit?: string;
  /** Clinical context of the range (age/sex/condition qualifiers, source). */
  note?: string;
}

export interface ViewerMapping {
  /** Which viewer caliper/tool produces this measurement. */
  tool: ViewerTool;
  /**
   * Case-insensitive regex source matched against DICOM SR concept names /
   * machine export names (the same job usgExtractor's per-column regexes do
   * today — centralized here so no modality-specific parsing is needed).
   */
  dicomSrPattern?: string;
}

/** Cross-references to the systems that consume this measurement. */
export interface MeasurementRefs {
  /** usg_measurements / usg_doppler_measurements / fetal_usg_measurements columns. */
  usgColumns?: readonly string[];
  /** Knowledge-pack studyTypes / pack ids whose manifests reference it. */
  knowledgePacks?: readonly string[];
  /** Quality-rule ids (RULE_CATALOG / measurement-rule canonical ids). */
  qualityRules?: readonly string[];
  /** Companion EXPECTED_MEASUREMENTS keys. */
  companionKeys?: readonly string[];
  /** Copilot metric keys (radiologyCoPilotEngine comparePriorMetrics). */
  copilotKeys?: readonly string[];
  /** Report template families that request it (radiologyMasterTemplates etc.). */
  reportTemplates?: readonly string[];
}

export interface MeasurementDefinition {
  /** Stable immutable canonical id, SCREAMING_SNAKE (e.g. "STONE_SIZE"). */
  id: string;
  /** Namespaced hierarchical key bridging the content-pack library (e.g. "meas.stone_size"). */
  canonicalKey: string;
  displayName: string;
  /** Every legacy spelling/key that must resolve to this identity. */
  aliases: readonly string[];
  description: string;
  modalities: readonly MeasurementModality[];
  /** Anatomical region (Title-Case, matching knowledge-pack conventions). */
  bodyRegion: string;
  /** Study types (Title-Case, as used by quick measurements / knowledge packs). */
  studyTypes: readonly string[];
  defaultUnit: string;
  allowedUnits: readonly string[];
  /** Decimal places for display/comparison formatting. */
  precision: number;
  viewerMapping: ViewerMapping;
  comparisonStrategy: ComparisonStrategy;
  normalRange?: MeasurementRange;
  criticalRange?: MeasurementRange;
  refs: MeasurementRefs;
  /** Per-definition version for reproducibility (bump on any semantic change). */
  version: string;
  deprecated?: boolean;
  /** When deprecated, the id that replaces this one. */
  replacedBy?: string;
  notes?: string;
}

/** Result of resolving an arbitrary label/key/column to a canonical identity. */
export interface MeasurementResolution {
  definition: MeasurementDefinition;
  /** What matched: exact id, canonical key, or which alias form. */
  matchedBy: "id" | "canonicalKey" | "alias" | "alias-stripped";
  /** The input as given. */
  input: string;
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
    | "bad-replaced-by";
  measurementId: string;
  detail: string;
}
