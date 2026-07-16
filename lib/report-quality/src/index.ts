// @workspace/report-quality — the ONE canonical report quality layer.
//
// Framework-agnostic pure TypeScript (no React, no Express, no DB) so the same
// engine runs identically on the client (live quality badge, Copilot nudges)
// and the server (finalize gate, persistence). See
// docs/report-quality-engine/ARCHITECTURE.md for the full design.
//
// Importing this package wires the full registered rule set (via ./rules) and
// exposes the single entry point runQualityEngine().

import "./rules";

export { REPORT_QUALITY_ENGINE_VERSION } from "./version";
export { runQualityEngine } from "./runner";
export {
  registerRule,
  registerRules,
  getRegisteredRules,
  getRule,
  clearRules,
} from "./registry";
export { normalizeModality, modalityMatches } from "./modality";
export type { CanonicalModality } from "./modality";
export { defaultScorer } from "./score";
export { textParityScorer } from "./text/scorer";
// Ported legacy checks (shadow copies). Exported so callers can migrate onto
// the canonical engine incrementally and the parity harness can compare paths.
export { validateReportText, computeTextQualityScore } from "./text/legacy";
export type { TextQualityScore } from "./text/legacy";
export { evaluateTextTier } from "./text/evaluate";
export type { TextTierFinding, TextTierResult } from "./text/evaluate";
// Rule catalog — the single source of rule identity (stable ids + metadata).
export { RULE_CATALOG, RULE_CATALOG_VERSION, getRuleEntry } from "./ruleCatalog";
export type { RuleId, RuleCatalogEntry } from "./ruleCatalog";
// Canonical DTO — the one shape the API exposes and the DB persists.
export { toQualityReportDTO } from "./dto";
export type {
  QualityFindingDTO,
  QualityReportDTO,
  QualityEvaluationRequest,
  DTOIdentity,
} from "./dto";
export type {
  Severity,
  DataTier,
  QualityCategory,
  QualityFinding,
  TextReportInput,
  NormalizedMeasurement,
  PriorMeasurementSeries,
  TemplateContext,
  ContextDataKey,
  QualityContext,
  QualityRule,
  QualityReport,
  RunOptions,
} from "./contract";
