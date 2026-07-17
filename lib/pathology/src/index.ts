// @workspace/pathology — the Universal Pathology Analyte & Panel Registry.
//
// One canonical identity per laboratory analyte (HEMOGLOBIN, CREATININE…) and
// per panel (CBC, LFT…); every legacy result-parameter label resolves here.
// Carries age/sex-aware reference intervals, critical/panic values, LOINC
// codes and units, plus the engines that turn a raw value into an HL7-style
// flag and enrich legacy stored results in place. Pure TS, no runtime
// dependencies — usable on client and server, exactly like
// @workspace/measurements.

export type {
  LabDepartment,
  Sex,
  ResultType,
  AbnormalFlag,
  FlagStatus,
  ReferenceInterval,
  CategoricalValue,
  AnalyteRefs,
  AnalyteDefinition,
  PanelDefinition,
  AnalyteResolution,
  PanelResolution,
  ResolvedInterval,
  FlagResult,
  PatientContext,
  RegistryValidationIssue,
} from "./contract";

export {
  PATHOLOGY_ANALYTE_CATALOG,
  PATHOLOGY_PANEL_CATALOG,
  PATHOLOGY_CATALOG_VERSION,
} from "./catalog";

export { normalizeAnalyteLabel, stripParenthetical } from "./normalize";
export { canonicalUnit, isKnownUnit, convertUnitValue } from "./units";

export {
  normalizeSex,
  ageYearsFromDob,
  resolveReferenceInterval,
  formatReferenceRange,
} from "./referenceRanges";

export {
  parseNumericResult,
  flagToStatus,
  isAbnormalFlag,
  isCriticalFlag,
  flagValue,
  referenceRangeFor,
} from "./flagging";

export {
  createPathologyRegistry,
  DEFAULT_PATHOLOGY_REGISTRY,
  resolveAnalyte,
  getAnalyte,
  resolvePanel,
  getPanel,
  type PathologyRegistry,
} from "./registry";

export {
  parseLegacyParameters,
  enrichLegacyParameter,
  enrichLegacyParameters,
  enrichmentStats,
  type LegacyParameterRow,
  type EnrichedParameter,
  type EnrichmentStats,
} from "./bridge";
