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
// Provider-based engine (Phase 2.5). createQualityEngine gives an isolated,
// composable engine instance; the global registry functions below are a
// compatibility façade over the default engine.
export { createQualityEngine, runRules, defaultEngine } from "./engine";
export type { QualityEngine, RuleProvider } from "./engine";
export {
  registerRule,
  registerRules,
  getRegisteredRules,
  getRule,
  clearRules,
} from "./registry";
// Generic executor framework (Phase 2.5, framework only — no clinical rules).
export { createExecutorRegistry, compileRule } from "./executor";
export type { RuleDefinition, ExecutorFinding, Executor, ExecutorRegistry } from "./executor";
// Composable rule providers.
export { coreTextProvider } from "./rules/text";
// Phase 3 structured tier (SHADOW) — a scoped engine, NOT on the global default.
export {
  createStructuredEngine,
  structuredProvider,
  structuredRules,
  STRUCTURED_RULE_DEFINITIONS,
  STRUCTURED_RULE_SET_VERSION,
} from "./rules/structured";
export {
  MEASUREMENT_RULE_SET_VERSION,
  MEASUREMENT_RULE_DEFINITIONS,
  measurementRules,
  measurementRegistryProvider,
  createMeasurementEngine,
  measurementRangeRuleId,
  resolveContextMeasurement,
} from "./rules/measurements";
export { normalizeModality, modalityMatches } from "./modality";
export type { CanonicalModality } from "./modality";
// The reporting-region vocabulary and the printed scope note. Both printed
// surfaces need the same answers — the report document is rendered server-side
// and the workspace PDF client-side — so this lives here, not in either app.
export {
  familyFromRegion,
  isDorsoLumbarRegionName,
  spineSegmentFromRegion,
  canonicalContentRegion,
  coverageOfRegion,
  coverageUnionOfRegions,
  coverageOfRegionLabel,
  formatDocumentedCoverage,
  coverageExceeds,
  declaresWholeSpineScreening,
  intersectCoverage,
} from "./reportingRegion";
export type {
  ReportingFamily,
  SpineSegment,
  SpineCoverageSegment,
  FormatCoverageDeclaration,
} from "./reportingRegion";
export { documentedReportingScope, reportedScopeNote } from "./reportingScope";
export type { DocumentedReportingScope, ReportedScopeRecord } from "./reportingScope";
export { defaultScorer } from "./score";
export { textParityScorer } from "./text/scorer";
// Ported legacy checks (shadow copies). Exported so callers can migrate onto
// the canonical engine incrementally and the parity harness can compare paths.
export { validateReportText, computeTextQualityScore } from "./text/legacy";
export type { TextQualityScore } from "./text/legacy";
export { evaluateTextTier } from "./text/evaluate";
export type { TextTierFinding, TextTierResult } from "./text/evaluate";
// The clinical vocabulary and negation reading the contradiction rules share. The
// live workspace validator imports these too, so "normal study" and
// "no acute haemorrhage" mean the same thing on both validation paths.
export {
  ABNORMAL_TERMS,
  SUSPICIOUS_TERMS,
  NAMED_LESION_TERMS,
  STUDY_NORMAL_PATTERNS,
  SCOPE_LIMITERS,
  assertedAbnormality,
  assertedContrastMention,
  assertedDiagnoses,
  assertsStudyNormal,
  assessmentCategories,
  clinicalOccurrences,
  clinicalOccurrenceDetails,
  clinicalContentSignature,
  outOfScopeSpineContent,
  spinalLevels,
  studyContrastState,
  ungroundedNamedDiagnoses,
  CONTRAST_MENTION_TERMS,
  NAMED_DIAGNOSIS_TERMS,
} from "./text/clinicalTerms";
export type {
  ClinicalTerm,
  ClinicalOccurrence,
  ClinicalOccurrenceDetail,
  NamedDiagnosis,
  SpinalLevel,
  StudyContrastState,
} from "./text/clinicalTerms";
// The Findings↔Impression contradiction contract. Called by ./text/evaluate AND by
// the live workspace validator, so the badge on the screen and the findings the
// server persists are one reading rather than two that happen to agree today.
export {
  findingsImpressionContradictions,
  lateralityContradictions,
  sectionsContradict,
} from "./text/findingsImpression";
export type { SectionContradiction } from "./text/findingsImpression";
// The stated-side ↔ written-side conflict. Called by the AI finding gauntlet
// (artifacts/api-server/src/lib/ai/findingValidation.ts, which re-exports it as
// `detectLateralityConflict`) AND by the workspace's observation ledger, so a
// structured LEFT whose sentence has been typed over to say RIGHT is one rule on
// both paths. Distinct from Q104 above, which compares two sections and never sees
// a selection.
export { statedLateralityConflict, sidesNamedInText, sideBlindText } from "./text/laterality";
export type { StatedLaterality } from "./text/laterality";

// The owner's fixed closing statement. One wording and one "already said it?"
// detector, read by the server's single renderer, by the client preview that Word
// export converts, and by the live print merge that can change the answer after
// the server has already rendered.
export {
  RADIOLOGY_CLOSING_STATEMENT,
  RADIOLOGY_CLOSING_STATEMENT_CLASS,
  containsRadiologyClosingStatement,
  radiologyClosingStatementHtml,
  radiologyClosingStatementHtmlIfAbsent,
  radiologyClosingStatementForSections,
  withoutRadiologyClosingStatement,
} from "./text/closingStatement";
// The Impression→Recommendation dependency behind Q005. Called by ./text/evaluate AND
// by the live workspace validator, so an empty advice section means the same thing on
// both paths: a gap only where the Impression states a plan that section should carry.
// `isFillerAdvice` is the anti-filler shape the dependency refuses to demand; the
// composer validator imports the same predicate for the advice it refuses to keep.
export { unmetRecommendationDependency, isFillerAdvice } from "./text/recommendation";
// The un-filled placeholder vocabulary behind Q106. Called by ./text/evaluate AND by
// the live workspace validator, so the badge and the finalize dialog name the same
// blank with the same sentence. Exported whole rather than as a bare predicate
// because the dialect list is the part that has to stay honest: each entry cites the
// shipped content that emits it, and a spelling no producer writes is only a way to
// mark up a correct report.
export {
  PLACEHOLDER_DIALECTS,
  unfilledPlaceholders,
  firstUnfilledPlaceholder,
  hasUnfilledPlaceholder,
  reportPlaceholderWarning,
} from "./text/placeholders";
export type { PlaceholderKind, PlaceholderDialect, PlaceholderHit, ReportProseFields } from "./text/placeholders";
// Rule catalog — the single source of rule identity (stable ids + metadata).
export { RULE_CATALOG, RULE_CATALOG_VERSION, getRuleEntry, findRuleEntry, significanceOfRule } from "./ruleCatalog";
export type { RuleId, RuleCatalogEntry, RuleSignificance } from "./ruleCatalog";
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
  FindingInstance,
  ProtocolRequirements,
  KnowledgePackContext,
  StudyContext,
} from "./contract";

// Is AI output fit to enter a report at all? The server's insert door and the client's
// proposal queue both read this, so the two sides cannot drift on what "the model answered
// as a chat" means. Shape only — it rewrites nothing and judges no clinical content.
export {
  findAiReportTextDefects,
  describeAiReportTextRefusal,
} from "./aiDraftShape";
export type { AiReportTextDefect, AiReportTextDefectKind } from "./aiDraftShape";
