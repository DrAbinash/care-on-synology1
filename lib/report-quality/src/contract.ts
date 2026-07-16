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

/**
 * A single quality observation about a report. Carries STRUCTURED metadata so
 * persistence/analytics never depend on the (changeable) message text —
 * everything keys off `ruleId`. (PR #101 Phase 2 requirements 2 & 3.)
 */
export interface QualityFinding {
  /** Stable catalog rule id (e.g. "Q104"); analytics/override/suppression key off this, never the message. */
  ruleId: string;
  /**
   * Optional hierarchical, namespaced id for this rule (e.g.
   * "care.text.laterality.impression-vs-findings"). Additive metadata for
   * ownership + prefix-scoped analytics; `ruleId` remains the stable primary key.
   */
  canonicalId?: string;
  category: QualityCategory;
  severity: Severity;
  /** "structured" = deterministic on typed data; "heuristic" = free-text keyword/regex. */
  tier: DataTier;
  /**
   * Points this finding deducts from the 100-point quality score. Carried on the
   * finding so a scorer can sum from findings WITHOUT re-evaluating (Phase 2.5
   * single-evaluation fix). Absent → contributes 0.
   */
  weight?: number;
  /** Canonical modality the finding was produced for (stamped by the runner). */
  modality?: string;
  /** Study type / description the finding was produced for (stamped by the runner). */
  studyType?: string;
  /** Knowledge-pack id/version that sourced this rule, if any (Phase 7). */
  knowledgePackSource?: string;
  /** Human-readable, radiologist-facing statement of the problem. */
  message: string;
  /** The "why" — knowledge-pack rule / clinical rationale behind the flag. */
  rationale?: string;
  /** Concrete evidence (the offending phrase, value, measurement). */
  evidence?: string;
  /** Suggested human-readable fix. */
  suggestedFix?: string;
  /** Points at the finding / measurement id / section this concerns, for "where" UX. */
  targetRef?: string;
  /** Optional one-click machine fix, reusing the Copilot Apply pattern. */
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

// ── Phase 3 structured-tier slots ──
// Built ONLY from confirmed existing data sources. Any slot left `undefined`
// (source flag-gated-off or unreachable) makes its rules honestly notEvaluated;
// a slot is `[]` only after a real query returned zero rows.

/**
 * A structured quick/smart finding instance (report_finding_instances JOIN
 * radiology_quick_findings). Every row is an asserted abnormality — there is no
 * `presence` flag and no organ code; `side` is the only laterality signal.
 */
export interface FindingInstance {
  instanceId: number;
  findingId: number;
  label: string;
  studyType: string;
  anatomicalSection: string;
  conflictGroup: string;
  /** Parsed radiology_quick_findings.properties (subset of side/severity/chronicity/level/measurement). */
  properties: string[];
  side: string;       // '' | left | right | bilateral  ('' = unset)
  severity: string;   // '' | mild | moderate | severe
  chronicity: string; // '' | acute | chronic
  level: string;      // free string e.g. 'L4-L5'
  value: string;      // string measurement (parseFloat if numeric)
  source: string;     // 'manual' | 'quickselect'
  targetRef: string;  // `report_finding_instances:${id}`
}

/** Protocol-declared required measurements + expected units (radiology_protocols + radiology_quick_measurements). */
export interface ProtocolRequirements {
  studyType: string;
  modality: string;
  requiredMeasurements: string[];
  expectedUnits: Record<string, string>;
}

/** Knowledge-pack manifest context (knowledge_packs.manifest_json, fail-safe parsed). */
export interface KnowledgePackContext {
  packId: string;
  modality: string;
  studyType: string;
  version: string;
  status: string; // enabled | disabled | placeholder | planned
  comparisonMeasurements: string[];
  notApplicableSections: string[];
  criticalFindings: string[];
  /** Free-text normal values ("< 0.5", "29 mm") — display-only, NOT parseable ranges. */
  normalValues: { label: string; value: string }[];
}

/** Authoritative modality/study identity (worklist → study → dicom precedence). */
export interface StudyContext {
  authoritativeSource: "worklist" | "study" | "dicom" | "draft";
  authoritativeModality: string;    // canonical
  authoritativeModalityRaw: string; // raw ('MR','CT','US','CR','OT'…)
  authoritativeIsSentinel: boolean; // raw === 'OT' → unknown, never a mismatch
  declaredModality: string;         // canonical modality declared on the draft (under test)
  declaredModalityRaw: string | null;
  studyName: string | null;
  studyDescription: string | null;
}

/**
 * Optional structured-context slot names a rule may depend on. `text` is always
 * present and therefore is not a gate. The runner skips (records as
 * notEvaluated) any rule whose required slots are absent — this is what makes
 * one engine degrade gracefully across modalities and data tiers.
 */
export type ContextDataKey =
  | "measurements"
  | "priors"
  | "template"
  | "findingInstances"
  | "protocolRequiredMeasurements"
  | "knowledgePack"
  | "study"
  | "coveredSections";

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
  // Phase 3 structured slots:
  findingInstances?: FindingInstance[];
  protocolRequiredMeasurements?: ProtocolRequirements;
  knowledgePack?: KnowledgePackContext;
  study?: StudyContext;
  /**
   * Sections the report actually DOCUMENTED (positive presence signal). Distinct
   * from findingInstances, which carry only abnormalities — a normal section
   * produces no finding but IS documented. required-section reads this so a
   * documented-normal section is never flagged as omitted. Absent → the rule is
   * notEvaluated (we cannot distinguish normal-documented from omitted).
   */
  coveredSections?: string[];
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
  /** Of the evaluated rules, how many were deterministic (structured tier). */
  deterministicRuleCount: number;
  /** Of the evaluated rules, how many were heuristic (free-text tier). */
  heuristicRuleCount: number;
  /** Wall-clock/monotonic engine runtime in milliseconds (requirement 9). */
  runtimeMs: number;
  /** Versioning for reproducibility of historical evaluations (requirement 6). */
  engineVersion: string;
  ruleVersion: string;
  knowledgePackVersion: string | null;
  /** ISO-8601 timestamp of the evaluation. */
  evaluatedAt: string;
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
  /** Knowledge-pack version to stamp on the report (Phase 7); null until packs are wired. */
  knowledgePackVersion?: string | null;
  /** Injectable monotonic clock (ms) for deterministic runtime measurement in tests. */
  now?: () => number;
  /** Injectable ISO timestamp for deterministic `evaluatedAt` in tests. */
  evaluatedAtIso?: string;
}
