// contract.ts — the canonical types for the ONE universal report quality engine.
//
// Everything downstream (rules, runner, client badge, server gate, persistence)
// speaks these types. Framework-agnostic and dependency-free by design so the
// same engine runs on the client and the server. See
// docs/report-quality-engine/ARCHITECTURE.md §3.2.

/** How much a finding should weigh on the radiologist's workflow. */
export type Severity = "info" | "warning" | "blocker";

/**
 * Whether a rule reasons over genuinely structured/typed data ("structured" —
 * deterministic) or over free-text prose ("heuristic" — keyword/regex, expects
 * some false positives). Per the block policy of record, ONLY structured-tier
 * blockers may hard-block finalize; heuristic findings stay advisory.
 */
export type DataTier = "structured" | "heuristic";

/** Stable rule category, used for grouping/filtering and dashboard rollups. */
export type QualityCategory =
  | "completeness"
  | "consistency"
  | "laterality"
  | "measurement"
  | "recommendation"
  | "comparison"
  | "terminology"
  | "critical"
  | "knowledge-pack"
  | "protocol";

/** A single quality observation about a report. */
export interface QualityFinding {
  /** Stable, dotted id, e.g. "measurement.out-of-range". */
  ruleId: string;
  category: QualityCategory;
  severity: Severity;
  tier: DataTier;
  /** Human-readable, radiologist-facing statement of the problem. */
  message: string;
  /** The "why" — knowledge-pack rule / clinical rationale behind the flag. */
  rationale?: string;
  /** Concrete evidence (the offending phrase, value, measurement). */
  evidence?: string;
  /** Points at the finding / measurement id / section this concerns, for "where" UX. */
  targetRef?: string;
  /** Optional one-click fix, reusing the Copilot Apply pattern. */
  actionMacro?: string;
}

/**
 * Canonical free-text tier input. Deliberately a superset-compatible mirror of
 * reportValidator's `QualityInput` (findings/impression/…/checklistPercent/
 * missingRequiredMeasurements) so Phase 1 can wrap validateReport +
 * computeQualityScore verbatim without redefining their contract.
 */
export interface TextReportInput {
  findings: string;
  /** One line per impression point. */
  impression: string[];
  recommendation?: string;
  technique?: string;
  clinicalHistory?: string;
  sex?: string | null;
  age?: string | null;
  modality?: string | null;
  studyDescription?: string | null;
  /** Protocol checklist completeness (0-100), if a protocol is active. */
  checklistPercent?: number;
  /** Required measurement labels not yet present in the text. */
  missingRequiredMeasurements?: string[];
}

/**
 * A measurement normalized to a comparable numeric form. Populated from the
 * typed side-tables (fetal / doppler / radiology_measurements / spine) in later
 * phases; absent for the free-text-only path.
 */
export interface NormalizedMeasurement {
  key: string;
  label: string;
  value: number;
  unit?: string;
  low?: number;
  high?: number;
  /** Server-computed (never client-trusted) out-of-range flag, when ranges exist. */
  isAbnormal?: boolean;
  /** Grading/classification derived from the value (e.g. "Grade III"), when known. */
  classification?: string;
  targetRef?: string;
}

/** A prior/current series for a single measurement key, for comparison rules. */
export interface PriorMeasurementSeries {
  key: string;
  label: string;
  current: number;
  prior: number;
  unit?: string;
  changePct?: number;
}

/** Template/protocol context for completeness + mismatch checks. */
export interface TemplateContext {
  templateId?: string;
  modality?: string;
  sections: { name: string; required: boolean }[];
  /** Admin-configured protocol quality checklist items. */
  qualityChecklist?: string[];
}

/**
 * Optional structured-context slot names a rule may depend on. `text` is always
 * present and therefore is not a gate. The runner skips (records as
 * notEvaluated) any rule whose required slots are absent — this is what makes
 * one engine degrade gracefully across modalities and data tiers.
 */
export type ContextDataKey = "measurements" | "priors" | "template";

/** Everything a rule may read to evaluate one report. */
export interface QualityContext {
  /** Raw modality; the runner canonicalizes it before matching rules. */
  modality: string;
  studyDescription?: string;
  /** Always-present free-text tier. */
  text: TextReportInput;
  /** Structured tiers — present only where typed data exists for this report. */
  measurements?: NormalizedMeasurement[];
  priors?: PriorMeasurementSeries[];
  template?: TemplateContext;
}

/** A registered quality rule. Pure: same context in → same findings out. */
export interface QualityRule {
  /** Stable dotted id; also the key the runner dedupes on. */
  id: string;
  category: QualityCategory;
  /** Canonical modality scope: "*" = every modality, else a list of canonical codes. */
  modalities: "*" | string[];
  tier: DataTier;
  /** Structured slots this rule needs; omitted/[] means text-only (always runs). */
  requires?: ContextDataKey[];
  evaluate(ctx: QualityContext): QualityFinding[];
}

/** The result of one engine run over one report. */
export interface QualityReport {
  /** 0-100 completeness+consistency score (computeQualityScore-derived from Phase 1). */
  score: number;
  findings: QualityFinding[];
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  /** Rule ids skipped because their required structured data was absent — honesty about coverage. */
  notEvaluated: string[];
  /** How many rules actually ran (matched modality + had their data). */
  evaluatedRuleCount: number;
  engineVersion: string;
}

/** Optional overrides for a single engine run. */
export interface RunOptions {
  /**
   * Score provider. Defaults to a transparent severity-weighted score. Phase 1
   * injects a computeQualityScore-parity scorer so the live badge number is
   * unchanged — the engine never invents a second score.
   */
  scorer?: (ctx: QualityContext, findings: QualityFinding[]) => number;
  /** Restrict to a subset of rule ids (used by targeted callers/tests). */
  onlyRuleIds?: string[];
}
