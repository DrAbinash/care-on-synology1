// @workspace/measurements — the Universal Measurement Registry.
//
// One canonical identity per measurement; every legacy label/key/column
// resolves here. Consumed by the Reporting Workspace, Viewer bridge, Previous
// Comparison, Companion, Copilot, Knowledge Packs, and the Quality Engine
// (Phase 4). Pure TS, no runtime dependencies — usable on client and server.

export type {
  MeasurementDefinition,
  MeasurementModality,
  MeasurementRange,
  MeasurementRefs,
  MeasurementResolution,
  ComparisonStrategy,
  ViewerTool,
  ViewerMapping,
  RegistryValidationIssue,
} from "./contract";

export { MEASUREMENT_CATALOG, MEASUREMENT_CATALOG_VERSION } from "./catalog";
export { normalizeMeasurementLabel, stripParenthetical } from "./normalize";
export { canonicalUnit, isKnownUnit, convertUnitValue } from "./units";
export { ellipsoidVolumeMl, ellipsoidVolumeMlFromMm, ELLIPSOID_FACTOR } from "./volume";
export {
  createMeasurementRegistry,
  DEFAULT_MEASUREMENT_REGISTRY,
  resolveMeasurement,
  getMeasurement,
  type MeasurementRegistry,
} from "./registry";
export {
  compareMeasurementValues,
  classifyMeasurementValue,
  formatMeasurementValue,
  type MeasurementComparison,
} from "./compare";
