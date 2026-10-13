import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Study, MeasurementRow, PriorStudy, CopilotItem, CriticalFinding, QuickSelectTile, QuickSelectField, ReportFormat, SnippetMacro, SignOffProfile, MergeResult, Modality, LintIssue } from "./types";
import { runLintRules, runCopilotAnalysis, computeQualityScore, mergeTwoFormats, expandMacro, detectMacroTrigger, shouldPreloadNext } from "./types";
// Single read point for ff_radiology_critical_result_comms. staffSession.ts has
// no imports of its own and criticalResultCommsFlag.ts imports only that, so
// this cannot introduce a cycle back into the store.
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import { normalizeWorkspaceStudies } from "./normalizeWorkspaceStudy";
import { announceSignedMutationRefusal } from "./signedMutationRefusalNotice";
import {
  announceQuickSelectParameterRefusal,
  isQuickSelectSource,
  resolvedQuickSelectSeverity,
  unresolvedQuickSelectParameters,
} from "./quickSelectParameterContract";
import { DEFAULT_QUICK_SELECT_TILES, lookupTiles, loadTiles, saveTiles, createTile, resetToDefaults } from "./quick-select-library";
import {
  DEFAULT_REPORT_FORMATS, lookupFormats, loadFormats, saveFormats, createFormat, resetFormatsToDefaults,
} from "./report-formats-library";
import { mergeStructuredNormalFormats, type StructuredNormalRow } from "./structuredNormalFormats";
import {
  bumpReportFormatUsage,
  createReportFormatOnServer,
  deleteReportFormatOnServer,
  hydrateReportFormatsLibrary,
} from "./reportFormatsApi";
import { hydrateChocolateMacrosFromServer } from "@/lib/chocolateMacrosApi";
import type { AppliedPatternMarker } from "@/lib/abnormalPatternDraft";
import {
  cloneBuiltinAbnormalPatterns,
  readPatternUsageCounts,
  resolveAbnormalPatternSettings,
  type AbnormalPattern,
} from "@/lib/reporting/abnormalPatterns";
import {
  analyzeFormatOverwrite,
  clinicalFieldsFromFormat,
  resolveReportingRegionForFormat,
  type FormatOverwriteAnalysis,
} from "./fullReportFormat";
import { alignRecommendationToObservations } from "@/lib/impressionRecommendationWiring";
import { getFormatApplyBridge } from "./formatApplyBridge";
import { appendClinicalPhrase } from "@/lib/clinicalHistoryText";
import { DEFAULT_SNIPPET_MACROS, lookupMacros, lookupMacrosForContext, loadMacros, saveMacros, createMacro } from "./snippet-macros-library";
import { DEFAULT_SIGN_OFF_PROFILES, loadProfiles, saveProfiles, lookupProfile, formatSignOff, createProfile } from "./sign-off-profiles";
import {
  mergeReportFieldContentWithProvenance,
  provenanceFromText,
  reconcileProvenanceAfterManualEdit,
  normalizeForDedupe,
  type FieldProvenanceMap,
  type InsertSource,
  type ReportFieldKey,
} from "@/lib/reportFieldMerge";
import { resolveCopilotAcceptance } from "@/lib/zai-workspace/copilotAcceptanceContract";
import {
  currentAiProposalContext,
  evaluateAiProposal,
  type AiProposalBinding,
  type AiProposalStaleReason,
} from "@/lib/zai-workspace/aiProposalContext";
import {
  EMPTY_REPORTING_STUDY_CONTEXT,
  canonicalContentRegion,
  reportingContextEqual,
  type ReportingStudyContext,
} from "@/lib/reportingStudyContext";
import {
  applyPathologyPatch as overlayPathology,
  applySideToIncoming,
  inferOwnership,
  relateralizeOwnedText,
  type PathologyIncoming,
  type PathologyOwnership,
  type ReportNarrative,
} from "@/lib/pathologyPatch";
import type { Side } from "@/lib/sideSwap";
import {
  defaultLumbarNumbering,
  lumbarApCanalLevels,
  type LumbarNumberingState,
} from "@/lib/mriSpineNumbering";
import {
  defaultDorsalNumbering,
  dorsalApCanalLevels,
  type DorsalNumberingState,
} from "@/lib/mriDorsalNumbering";
import type {
  CompositionProvenance,
  StudyComposition,
} from "@/lib/mriDorsoLumbarCatalog";
import { isDorsoLumbarDedicated } from "@/lib/mriDorsoLumbarCatalog";
import { rankDorsoLumbarImpressionLine } from "@/lib/mriDorsoLumbarImpression";
import {
  defaultDorsoLumbarState,
  type DorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import { canonicalizeDorsoLumbarOwnership } from "@/lib/mriDorsoLumbarJunction";
import {
  defaultSpineSequences,
  type SpineSequencesAvailable,
} from "@/lib/mriSpineSequences";
import {
  SCREENING_BUNDLE_PREFIX,
  SCREENING_LIMITATION_BUNDLE_ID,
  defaultScreeningRegionState,
  defaultScreeningState,
  screeningLedgerBundles,
  screeningRegionBundleId,
  type ScreeningRegionState,
  type ScreeningState,
} from "@/lib/mriSpineScreening";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import {
  roleImpliesPerformed,
  type RegionRole,
  type SpineScreeningRegion,
} from "@/lib/mriSpineScreeningSchema";
import { orderImpressionLines } from "@/lib/impressionPriority";
import {
  ensureSectionedFindings,
  findingsSectionBlocks,
  flattenSectionedFindings,
  mergeScopedFindingsProvenance,
  replaceFindingsSectionBody,
  routeChipToFindingsSection,
  type FindingsStudySection,
} from "@/lib/multiStudyReport";
import { applyChangePlan } from "@/lib/voiceReportComposer/applyChangePlan";
import type { VoiceChangePlan, VoiceObservation } from "@/lib/voiceReportComposer/types";
import {
  buildCanonicalObservation,
  contributionPresent,
  contributionProtected,
  findSameSlotSiblings,
  mergeObservationInPlace,
  observationsMutuallyExclusive,
  ownershipFromObservation,
  planSameSlotReplacement,
  type CanonicalObservation,
} from "@/lib/observationSlot";
import {
  evaluateImpressionDependency,
  extractImpressionBasis,
  type ImpressionBasis,
  type ImpressionDependencyReason,
  observationInputFromVoice,
  refreshImpressionFromObservations,
  removeLedgerObservation,
  serializeObservationLedger,
  parseObservationLedger,
  reconstructProvenanceFromLedger,
  logLedgerHydrationSafe,
  detectUnownedSiblingConflictsForLedger,
  UNOWNED_SIBLING_HINT,
  renderedInField,
  extractRecordedHashes,
  reconcilePatchAgainstNarrative,
  stampVoiceAuthoredProvenance,
  stripContribution,
  type LedgerHydrationResult,
  type LedgerPatch,
  type SerializedObservationLedger,
} from "@/lib/observationLedger";
import { mayReplaceMachineTechniqueWithApproved } from "@/lib/techniqueStudyTabOrigin";
import {
  CLINICAL_UNDO_DEPTH,
  pushClinicalUndoSnapshot,
  popClinicalUndoSnapshot,
  topClinicalUndoSnapshot,
} from "./clinicalUndo";
import { emptyClinicalState } from "./clinicalStateReset";
import type { StartingCanvasBaseline } from "./startingCanvasHighlight";
import {
  defaultImpressionFromFindings,
  observationSlotKey,
} from "@/lib/findingComposerModel";
import { generateLocalImpression } from "@/lib/generateLocalImpression";
import type { ObservationAnchor } from "@/lib/observationAnchor";
import {
  buildSystemNormalPatch,
  findSystemNormalPatch,
  hasImpressionworthyAbnormal,
  impressionHasManualContribution,
  isSystemNormalPatch,
  SYSTEM_NORMAL_IMPRESSION_TEXT,
  SYSTEM_NORMAL_PATCH_ID,
} from "@/lib/conceptCanon/normalImpression";
import { isImpressionworthyAbnormal } from "@/lib/conceptCanon/contentPacks";
import { anchorsEqual } from "@/lib/observationAnchor";
import type { CoverageMark } from "@/lib/coverageMarks";
import {
  emptyViewerMeasurementsState,
  upsertStructuredMeasurement,
  detachStructuredMeasurementsFromObservation,
  remapStructuredMeasurementsObservationId,
  type MeasurementIntent,
  type ViewerMeasurementsState,
  type StructuredMeasurement,
} from "@/lib/structuredViewerMeasurements";
import {
  applyCanalManualValue,
  applyCanalViewerValue,
  canalSegmentForLevel,
  canonicalizeCanalMap,
  flagRenumberedCanalLevels,
  normalizeDiscLevel,
  parseCanalApNumber,
  resolveActiveCanalSegment,
  type CanalApCellProvenance,
  type CanalApProvenanceMap,
  type CanalSegment,
  type CanalViewerValueWrite,
} from "@/lib/spineCanalAp";
import {
  quickNormalOutcomeMessage,
  resolveNormalBootstrapFormat,
} from "./normalBootstrap";
import {
  alreadySaysThis,
  canalApReportTable,
  levelsContradictedByUnexplainedLines,
  radiologistObservations,
  reportHasDeviation,
  rowLevelKey,
  supersededBaselineTexts,
  unexplainedFindingLines,
  type ProfessionalReportOutcome,
} from "./professionalReport";
import {
  defaultVascularTechnique,
  markVascularTechniqueManual,
} from "@/lib/mriBrainVascularTechnique";
import { isImpressionReorderOf } from "@/lib/mriBrainVascularImpression";
import type { VascularTechniqueKey, VascularTechniqueState } from "@/lib/mriBrainVascularTechnique";
import {
  coverageMarksEqual,
  defaultCoverageMarks,
  setCoverageStatus,
  markRegionViewed,
  parseCoverageMarks,
  filterCoverageForScope,
  serializeCoverageEnvelope,
  COVERAGE_ENVELOPE_KEY,
} from "@/lib/coverageMarks";
import { coverageScopeKey } from "@/lib/mriLumbarLevelState";
import { materializeFormatBaseline, reportFormatRevision } from "./fullReportBaseline";
import type { RegionTransitionPlan, RegionTransitionRecord } from "@/lib/regionTransition";
import { regionIdentityConflictMessage } from "@/lib/regionTransition";

function parseCoverageFromRaw(raw: unknown): CoverageMark[] | null {
  return parseCoverageMarks(raw);
}

function hydrateCoverageFromLedgerRaw(raw: unknown): CoverageMark[] | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  // Prefer full envelope (scoped) when present
  if (rec[COVERAGE_ENVELOPE_KEY] != null || rec.careCoverageByScope != null) {
    return parseCoverageMarks(rec);
  }
  if (rec.careCoverageMarks != null) return parseCoverageMarks(rec.careCoverageMarks);
  return null;
}

export type EditorField = "findings" | "impression" | "recommendation" | "technique" | "clinicalHistory";
export type RailStage = "orient" | "observe" | "measure" | "conclude" | "verify";

type FieldProvenanceState = Partial<Record<EditorField, FieldProvenanceMap>>;

export type AppliedPathologyPatch = {
  id: string;
  ownership: PathologyOwnership;
  templates: PathologyIncoming;
  lastRendered: PathologyIncoming;
  source: InsertSource;
  observation?: CanonicalObservation;
  replacedBaseline?: { findings: string[]; impression: string[] };
  protected?: boolean;
  stale?: boolean;
};

export type PendingPathologyPatch = {
  incoming: PathologyIncoming;
  ownership: PathologyOwnership;
  source: InsertSource;
  side?: Side | "";
  templates?: PathologyIncoming;
  id?: string;
  region?: string;
  concept?: string | null;
  level?: string;
  laterality?: string;
  label?: string;
  catalogId?: number | string;
  properties?: string;
  supportsLaterality?: boolean;
  findingsText?: string;
  /** Chip study-tab / region used only to route multi-study findings sub-sections. */
  studyType?: string;
  /** Explicit findings sub-section. When omitted, overlay routes from chip metadata then active focus. */
  findingsSectionId?: string;
  bundleId?: string;
  sectionsOwned?: CanonicalObservation["sectionsOwned"];
  role?: CanonicalObservation["role"];
  specificity?: CanonicalObservation["specificity"];
  /** Optional explicit anchor; when omitted, store stamps activeAnchor at apply time. */
  anchor?: ObservationAnchor | null;
  severity?: string;
  state?: string;
  measurement?: string;
  /**
   * Same-slot / composer slot-change: observation being vacated so force-confirm
   * or cancel can remap evidence (measurements / key images) onto the survivor.
   */
  vacatedObservationId?: string;
  force?: boolean;
  /** When true, do not push a clinical Undo frame (used by bundle wrappers). */
  skipUndoSnapshot?: boolean;
};

type PatchSnapshot = {
  /**
   * The study this frame was captured against. `useWorkspace` is a module-scope
   * singleton, so an undo frame outlives the study it belongs to; restoring one
   * blindly writes Patient A's five texts into Patient B's report. Compared in
   * `undoLastPatch` before anything is restored.
   */
  activeStudyId: string | null;
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  fieldProvenance: FieldProvenanceState;
  appliedPathologyPatches: AppliedPathologyPatch[];
  voiceComposerObservations: VoiceObservation[];
  voiceComposerTranscriptHistory: string[];
  appliedFormatName?: string | null;
  appliedFormatReportTitle?: string | null;
  startingCanvasBaseline?: StartingCanvasBaseline | null;
  appliedPatternMarkers?: AppliedPatternMarker[];
  /**
   * Optional, like the four above, so frames captured before this field existed
   * restore nothing rather than forcing the flag to a value they never recorded.
   */
  impressionNeedsRefresh?: boolean;
  /** The dependency link as it stood. Undo restores it with the prose. */
  impressionBasis?: ImpressionBasis | null;
  /**
   * ADR-004 — the transition history, optional for the same reason as the four above: a
   * frame captured before this field existed restores nothing rather than forcing the
   * history to a value it never recorded. Undo has to roll the record back WITH the
   * sentences: leaving it behind would claim lines left the report while they are sitting
   * on the page, and the next autosave would persist that claim as provenance.
   */
  regionTransitions?: RegionTransitionRecord[];
};

const CLINICAL_UNDO_MAX = CLINICAL_UNDO_DEPTH;

function captureClinicalSnapshot(s: S): PatchSnapshot {
  return {
    activeStudyId: s.activeStudyId,
    clinicalHistoryText: s.clinicalHistoryText,
    techniqueText: s.techniqueText,
    findingsText: s.findingsText,
    impressionText: s.impressionText,
    recommendationText: s.recommendationText,
    fieldProvenance: { ...s.fieldProvenance },
    appliedPathologyPatches: s.appliedPathologyPatches.map((p) => ({ ...p })),
    voiceComposerObservations: [...s.voiceComposerObservations],
    voiceComposerTranscriptHistory: [...s.voiceComposerTranscriptHistory],
    appliedFormatName: s.appliedFormatName,
    appliedFormatReportTitle: s.appliedFormatReportTitle,
    startingCanvasBaseline: s.startingCanvasBaseline ?? null,
    appliedPatternMarkers: s.appliedPatternMarkers.map((m) => ({ ...m })),
    impressionNeedsRefresh: s.impressionNeedsRefresh,
    impressionBasis: s.impressionBasis ?? null,
    regionTransitions: [...s.regionTransitions],
  };
}

function withPushedClinicalUndo(s: S, snap: PatchSnapshot): Pick<S, "patchUndoStack" | "lastPatchSnapshot"> {
  const patchUndoStack = pushClinicalUndoSnapshot(s.patchUndoStack, snap, CLINICAL_UNDO_MAX);
  return {
    patchUndoStack,
    lastPatchSnapshot: topClinicalUndoSnapshot(patchUndoStack),
  };
}

/**
 * The one place that decides whether a signed study may still be written to.
 *
 * Scope is the same-session window, and that is a real limit rather than an
 * oversight: `completeFinalize` is the only writer of `isFinalized: true` and
 * nothing rehydrates it from the server's REPORT_FINAL status, so a report
 * signed on another workstation is held by `studyIsSignedElsewhere` in the hook
 * layer and by `assertDraftWritable` (409 REPORT_LOCKED) on the server. What
 * this closes is the window where the report was signed here, the workspace is
 * still on screen, and an action armed before signing — an open merge preview, a
 * pending overwrite, a tile still selected — fires after it.
 *
 * `allowEditSigned` is not consulted because it cannot be true: its only setter
 * call passes `false`, and `signedReportCorrectionTruth.test.ts` pins that no
 * click handler ever flips it on. The guards already in this file do not
 * consult it either.
 *
 * Not applied to the reset/hydration paths (`selectStudy`, `setEditorContent`,
 * `hydrateObservationLedger`) — reopening a signed study to read or print it is
 * legitimate, and those are how its content reaches the screen.
 */
/**
 * Changing vertebral numbering must never move a stored measurement onto a
 * different disc. Levels the new numbering no longer offers are flagged for
 * review and stop reporting a number; nothing is renamed and nothing deleted,
 * because relabelling "L5-S1: 8.2 mm" to whatever the new count calls that
 * position is exactly how a measurement changes anatomy in silence.
 */
function reconcileCanalLevels(
  records: CanalApProvenanceMap,
  segment: CanalSegment,
  offered: readonly string[],
): CanalApProvenanceMap {
  const valid = new Set(
    offered.map((level) => normalizeDiscLevel(level) ?? level).filter(Boolean) as string[],
  );
  const { records: next } = flagRenumberedCanalLevels(records, (level) => {
    const owner = records[level]?.region ?? canalSegmentForLevel(level);
    return owner !== segment || valid.has(level);
  });
  return next;
}

function refuseSignedMutation(s: S, action: string, announce = true): boolean {
  if (!s.isFinalized) return false;
  console.warn("[care.workspace_store] clinical mutation refused — the report is signed", {
    action,
    activeStudyId: s.activeStudyId,
  });
  // That console line was the entire trace a refusal left, and nobody in a
  // reporting room opens a console. `announce` is false for exactly one caller —
  // `undoLastPatch`, whose refusal `useWorkspaceCommands` already explains with a
  // more specific message: it reads the frame this guard deliberately leaves on
  // the stack to tell "refused" apart from "nothing to undo", and with
  // TOAST_LIMIT at 1 a second toast here would only flash underneath it.
  if (announce) announceSignedMutationRefusal(action);
  return true;
}


function narrativeFromState(s: Pick<S, "clinicalHistoryText" | "techniqueText" | "findingsText" | "impressionText" | "recommendationText">): ReportNarrative {
  return {
    clinicalHistory: s.clinicalHistoryText,
    technique: s.techniqueText,
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
  };
}

/** Stable empty provenance — never use inline `?? {}` inside zustand selectors (React #185). */
export const EMPTY_FIELD_PROVENANCE: FieldProvenanceMap = {};

function toLedgerPatch(p: AppliedPathologyPatch): LedgerPatch {
  const observation = p.observation ?? buildCanonicalObservation({
    id: p.id,
    conflictGroup: p.ownership.conflictGroup,
    anatomicalSection: p.ownership.anatomicalSection,
    baselineReplaces: p.ownership.baselineReplaces,
    concept: p.ownership.concept,
    level: p.ownership.level,
    laterality: p.ownership.laterality,
    source: p.source,
  });
  return {
    id: p.id,
    observation,
    templates: p.templates,
    lastRendered: p.lastRendered,
    replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
    source: p.source,
    protected: p.protected ?? false,
    stale: p.stale,
  };
}

/**
 * The one derivation of "does this Impression still follow from these Findings?".
 *
 * Every writer goes through here — a keystroke, a Quick Select tile, dictation, a
 * template, an accepted AI ghost, a ledger restore — so the answer cannot depend
 * on which of them produced the text, which is exactly how D-1 got its two
 * predicates. Pass `ownership` when the write covers both sides of the dependency
 * (findings and their summary together); that records a new basis instead of
 * comparing against the old one, and is the only way the flag clears other than by
 * the contradiction disappearing.
 */
function deriveImpressionDependency(
  s: S,
  ownership?: { rebase: true; recordedBy?: ImpressionBasis["recordedBy"] },
  opts?: { findingsJustChanged?: boolean; arm?: ImpressionDependencyReason },
): Pick<S, "impressionNeedsRefresh" | "impressionDependencyReasons" | "impressionBasis"> {
  const state = evaluateImpressionDependency({
    findings: s.findingsText,
    impression: s.impressionText,
    patches: s.appliedPathologyPatches.map(toLedgerPatch),
    provenance: s.fieldProvenance.impression,
    basis: ownership ? null : s.impressionBasis,
    recordedNow: ownership ? ownership.recordedBy ?? "impression-write" : undefined,
    findingsJustChanged: opts?.findingsJustChanged ?? false,
  });
  // A site can arm the dependency without changing either field's text (a
  // participation toggle). It still has to travel through the same basis, or the
  // arm would exist in this session and vanish on reopen — which is D-1.
  const armed = !!opts?.arm && !ownership;
  const basis = armed && state.basis?.recordedBy !== "unreconciled"
    ? { ...state.basis!, findingsSignature: state.findingsSignature, impressionFingerprint: state.impressionFingerprint, recordedBy: "unreconciled" as const }
    : state.basis;
  return {
    impressionNeedsRefresh: state.needsRefresh || !!opts?.arm,
    impressionDependencyReasons: opts?.arm && !state.reasons.includes(opts.arm)
      ? [...state.reasons, opts.arm]
      : state.reasons,
    impressionBasis: basis,
  };
}

function observationFromPending(
  opts: PendingPathologyPatch,
  reportingRegion: string | null,
  activeAnchor?: ObservationAnchor | null,
  studyComposition?: StudyComposition | null,
): CanonicalObservation {
  const templates = opts.templates ?? opts.incoming;
  const metaMissing = !(opts.ownership.anatomicalSection || opts.ownership.conflictGroup || opts.ownership.baselineReplaces || opts.concept);
  const inferred = metaMissing
    ? inferOwnership(opts.label ?? "", [templates.findings ?? "", templates.impression ?? ""])
    : {};
  const ownership = { ...inferred, ...opts.ownership };
  const now = new Date().toISOString();
  const stampAnchor = opts.anchor === null
    ? undefined
    : (opts.anchor ?? activeAnchor ?? undefined);
  // Dorso-Lumbar junction rule, applied where every observation enters the
  // ledger. Presets, macros, quick-select, AI proposals, imported observations
  // and restored drafts all come through here, so no write path can give the
  // thoracolumbar bridge a second identity (dorso-lumbar spec §6). Outside that
  // composition nothing is touched.
  const canonical = canonicalizeDorsoLumbarOwnership(
    {
      region: opts.region || reportingRegion || "",
      level: opts.level ?? ownership.level,
      anatomicalSection: ownership.anatomicalSection,
    },
    studyComposition,
  );
  return buildCanonicalObservation({
    id: opts.id,
    catalogId: opts.catalogId,
    region: canonical.changed ? canonical.region : (opts.region || reportingRegion || ""),
    concept: opts.concept ?? ownership.concept,
    conflictGroup: ownership.conflictGroup,
    anatomicalSection: canonical.changed ? canonical.anatomicalSection : ownership.anatomicalSection,
    baselineReplaces: ownership.baselineReplaces,
    label: opts.label,
    findingsText: opts.findingsText ?? templates.findings,
    level: canonical.changed ? canonical.level : (opts.level ?? ownership.level),
    laterality: opts.laterality ?? opts.side,
    supportsLaterality: opts.supportsLaterality,
    properties: opts.properties,
    source: opts.source,
    bundleId: opts.bundleId,
    sectionsOwned: opts.sectionsOwned,
    role: opts.role,
    specificity: opts.specificity,
    severity: opts.severity,
    state: opts.state,
    measurement: opts.measurement,
    impressionText: templates.impression,
    recommendationText: templates.recommendation,
    anchor: stampAnchor,
    createdAt: now,
    updatedAt: now,
  });
}

function splitReplacedByField(replaced: string[], existing: ReportNarrative): { findings: string[]; impression: string[] } {
  const findings: string[] = [];
  const impression: string[] = [];
  for (const s of replaced) {
    if (existing.findings.includes(s)) findings.push(s);
    else if (existing.impression.includes(s)) impression.push(s);
    else findings.push(s);
  }
  return { findings, impression };
}

function contributionMutated(prevField: string, nextField: string, lastRendered: string | undefined): boolean {
  const last = (lastRendered ?? "").trim();
  if (!last) return false;
  if (!nextField.includes(last)) {
    const parts = last.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!(parts.length > 1 && parts.every((s) => nextField.includes(s)))) return true;
  }
  const idx = nextField.indexOf(last);
  if (idx >= 0) {
    const after = nextField.slice(idx + last.length);
    if (after.trim() && !after.startsWith("\n")) return true;
  }
  return false;
}

function fieldProvenanceEqual(a: FieldProvenanceMap | undefined, b: FieldProvenanceMap): boolean {
  if (!a || Object.keys(a).length === 0) return Object.keys(b).length === 0;
  return JSON.stringify(a) === JSON.stringify(b);
}

interface S {
  studies: Study[]; activeStudyId: string | null; nextStudyId: string | null; nextStudyPreloaded: boolean;
  findingsText: string; impressionText: string; recommendationText: string; techniqueText: string; clinicalHistoryText: string;
  /** Editor-only source map; never serialized into clinical report / preview / PDF. */
  fieldProvenance: FieldProvenanceState;
  measurements: MeasurementRow[]; priors: PriorStudy[]; criticalFindings: CriticalFinding[];
  isDirty: boolean; isFinalizing: boolean; isFinalized: boolean; railStage: RailStage;
  showCommandPalette: boolean; showVoiceBar: boolean; voiceListening: boolean; voiceTranscript: string; voiceProvider: string | null;
  ghostText: string | null; ghostTextTarget: EditorField | null;
  /** C2 — the report state `ghostText` was generated FROM (digest + identities,
   *  never the text itself). Null means the suggestion carries no provenance of
   *  its own, which acceptance treats as unbound rather than as current. */
  ghostProposal: AiProposalBinding | null;
  /** C2 — monotonic ordering of generation requests, so a late response from an
   *  older Ctrl+I cannot overwrite a newer proposal. Session state, not clinical:
   *  it is deliberately NOT reset on a study switch. */
  ghostRequestSeq: number;
  copilotItems: CopilotItem[]; acknowledgedCopilotIds: Set<string>; activeCopilotItem: CopilotItem | null;
  completedStudyIds: Set<string>; parkedStudyIds: Set<string>;
  sessionStartedAt: number; lastSignAt: number | null; fatigueCardDismissed: boolean;
  notification: { kind: "interrupt" | "edge-glow" | "ledger"; text: string; id: string } | null;
  criticalSlaStartedAt: number | null; criticalSlaMinutes: number; criticalSlaEscalated: boolean;
  quickSelectTiles: QuickSelectTile[]; quickSelectEditorOpen: boolean; quickSelectEditingTile: QuickSelectTile | null; quickSelectEditorField: QuickSelectField | null;
  reportFormats: ReportFormat[]; selectedFormatIds: string[]; reportFormatPickerOpen: boolean;
  /** Templates-screen rows the current format library was built from. */
  structuredNormalRows: StructuredNormalRow[];
  /** Printed heading from the last applied Full Report Format (null = use fallback chain). */
  appliedFormatReportTitle: string | null;
  saveAsFormatDialogOpen: boolean; mergePreviewOpen: boolean; lastMergeResult: MergeResult | null;
  lastMergeFormats: { a: ReportFormat; b: ReportFormat | null } | null; confirmOverwriteOpen: boolean; pendingFormatIds: string[];
  /** Provenance + region analysis for the pending format overwrite dialog. */
  pendingFormatOverwrite: FormatOverwriteAnalysis | null;
  /** Region to apply atomically with format content (null = keep current). */
  pendingFormatRegion: string | null;
  pendingPathologyPatch: PendingPathologyPatch | null;
  lastPatchSnapshot: PatchSnapshot | null;
  /** Bounded clinical Undo stack (~5 radiologist actions). */
  patchUndoStack: PatchSnapshot[];
  /** Starting Canvas reference for workspace-only change highlighting. */
  startingCanvasBaseline: StartingCanvasBaseline | null;
  appliedPathologyPatches: AppliedPathologyPatch[];
  impressionNeedsRefresh: boolean;
  /** Why it is stale, named — so the sign dialog can say which fact moved. */
  impressionDependencyReasons: ImpressionDependencyReason[];
  /** The Findings the current Impression was written against. Persisted with the ledger. */
  impressionBasis: ImpressionBasis | null;
  /** Live FRAMES/OHIF viewport context — ephemeral; stamped onto new observations only. */
  activeAnchor: ObservationAnchor | null;
  /** Selected ledger observation for key-image attach (Reporting Canvas R2). */
  selectedObservationId: string | null;
  /**
   * Explicit MEASURE intent — radiologist chooses Canal AP / Lesion / Midline / Other
   * before the next viewer caliper is classified. Never infer blindly.
   */
  measurementIntent: MeasurementIntent | null;
  /** Disc level selected for Canal AP intent (e.g. L4-L5). */
  canalIntentLevel: string | null;
  /** Draft-scoped structured viewer measurements (care.viewer_measurements.v1). */
  structuredViewerMeasurements: ViewerMeasurementsState;
  /** Force-show dorsal canal table when radiologist explicitly activates it. */
  dorsalCanalForced: boolean;
  /** Canal AP cell provenance (manualOverride + DICOM UIDs) — draft-scoped. */
  canalApProvenance: CanalApProvenanceMap;
  /**
   * ADR-004 — the confirmed region transitions this report has been through, oldest first.
   * One entry per decision, carrying every sentence the report stopped claiming and who
   * decided it. Persisted in the draft envelope so a reload names the transition instead of
   * reporting the missing rows as a lost draft.
   */
  regionTransitions: RegionTransitionRecord[];
  /**
   * MRI Lumbar V3: vertebral numbering mode + LSTV detail. Level keys, AP rows,
   * root mapping, findings prose and LS screening all read this through
   * `LumbarNumberingResolver` — never a hard-coded level array (spec §5).
   */
  lumbarNumbering: LumbarNumberingState;
  /**
   * MRI Dorsal V3: acquired coverage extent + numbering confidence. Level rows,
   * AP canal table, cord/conus sentences, findings prose and dorsal screening all
   * read this through `DorsalLevelResolver` (dorsal spec §4). The conus is never
   * described when coverage does not reach it.
   */
  dorsalNumbering: DorsalNumberingState;
  /**
   * MRI Dorso-Lumbar V3: the acquired coverage, numbering basis and lumbar
   * transitional anatomy of one dedicated Dorso-Lumbar examination. The canvas,
   * the level dispatcher, the AP table, findings order and validation all read
   * the level list through `dorsoLumbarLevelEntryOptions` / `dorsolumbarLevelKeys`;
   * no component keeps its own level array (dorso-lumbar spec §4, §5).
   */
  dorsoLumbarNumbering: DorsoLumbarState;
  /**
   * MRI Dorso-Lumbar V3: what this examination *is*, as one composition rather
   * than as a set of regions. `dorsolumbar-dedicated` means the thoracic,
   * junction and lumbar domains are dedicated parts of a single study — not
   * dorsal-plus-LS screening, not two concatenated reports (dorso-lumbar spec §0,
   * §7). It is a composition discriminator only: observations keep the region
   * ownership the composer, macro rules and anatomy context already understand.
   */
  studyComposition: StudyComposition;
  /** How the composition was decided, so the header can show its evidence. */
  studyCompositionProvenance: CompositionProvenance;
  /** True once the radiologist states it, so billing cannot overwrite it. */
  studyCompositionOverridden: boolean;
  /**
   * MRI Lumbar V3: what this examination actually included. Defaults derived
   * from technique/protocol text, always manually overridable (spec §35).
   */
  sequencesAvailable: SpineSequencesAvailable;
  /**
   * MRI Lumbar V3: three-region spine screening state (cervical/dorsal/ls).
   * Structured selections live here; their prose enters the ledger through
   * `applyMacroBundle` with `screen-<region>-<section>` conflict groups (§22).
   */
  screening: ScreeningState;
  /** Radiologist reordered / rewrote the Impression — auto-priority stays off (§37). */
  impressionOrderFrozen: boolean;
  /**
   * What the vascular acquisition actually performed (mra/mrv spec §4) — draft-scoped,
   * derived from the Technique field and manually overridable. Gates every strong
   * vascular sentence; separate from the parenchymal sequence model and from billing.
   */
  vascularTechnique: VascularTechniqueState;
  /** Expected study UID for activeAnchor rejection across study switches. */
  activeStudyInstanceUID: string | null;
  /** Advisory coverage marks for the active Study Tab scope. Never a finalize hard gate. */
  coverageMarks: CoverageMark[];
  /** Coverage bags keyed by Study Tab / reporting region. */
  coverageByScope: Record<string, CoverageMark[]>;
  /** Format name last applied (display); title remains appliedFormatReportTitle. */
  appliedFormatName: string | null;
  ownershipReviewWarnings: Array<{ sentence: string; token: string; hint: string }>;
  ledgerHydrationWarning: string | null;
  /** Active voice-composer observations for incremental dictation context. */
  voiceComposerObservations: VoiceObservation[];
  voiceComposerTranscriptHistory: string[];
  snippetMacros: SnippetMacro[]; macroEditorOpen: boolean; editingMacro: SnippetMacro | null;
  activeMacroPrompt: { macro: SnippetMacro; field: EditorField; startPos: number } | null;
  signOffProfiles: SignOffProfile[];
  preloadTriggered: boolean;
  /** Resolved reporting identity — content selectors must use this, not DICOM bodyPart. */
  reportingContext: ReportingStudyContext;
  /** Primary study heading when a second study is linked into this report. */
  primaryFindingsSection: FindingsStudySection | null;
  /** Second worklist study combined into this report. Persisted as structuredJson.linkedStudyId. */
  linkedStudy: FindingsStudySection | null;
  /** Findings sub-section that receives chips when metadata does not pick a unique section. */
  activeFindingsSectionId: string | null;
  /** Governed abnormal-pattern library (seeds until pacs-settings hydrates). */
  abnormalPatternLibrary: AbnormalPattern[];
  /** Clinic flag `abnormal_pattern_suggestions_enabled`. Default true. */
  abnormalPatternSuggestionsEnabled: boolean;
  /** Draft markers. Included in the clinical undo snapshot so undo restores them. */
  appliedPatternMarkers: AppliedPatternMarker[];
  /** Local usage-counter seam (not telemetry). */
  patternUsageCounts: Record<string, number>;
  /**
   * When set, Merge Preview Apply runs this instead of the format-merge write.
   * Pattern confirm calls applyMacroBundle from the suggestions hook.
   */
  abnormalPatternConfirm: (() => void) | null;
}

export type WorkspaceStore = S & {
  setStudies: (s: unknown) => void; selectStudy: (id: string) => void; setNextStudy: (id: string | null) => void; markNextStudyPreloaded: () => void;
  setField: (f: EditorField, v: string, opts?: InsertSource | { source?: InsertSource; replaceProvenance?: boolean }) => void;
  /** Semantic merge + provenance update (Quick Select / Quick Findings / protocol / …).
   *  Reports whether the write landed so a caller that rewards the action — the
   *  Quick Select counter and its `onAfterPick` — can tell a refusal from a
   *  success. Widened from `void`, so every existing caller that discards it is
   *  unaffected. */
  mergeField: (f: EditorField, incoming: string, source: InsertSource) => "applied" | "refused";
  /** Fill only when the field is empty; assigns provenance for the inserted block. */
  setFieldIfEmpty: (f: EditorField, v: string, source: InsertSource) => void;
  /** Wholesale replace with provenance for the new content. */
  replaceField: (f: EditorField, v: string, source: InsertSource) => void;
  setEditorContent: (c: { findings: string; impression: string; recommendation: string; technique: string; clinicalHistory: string }) => void;
  setMeasurements: (m: MeasurementRow[]) => void; setPriors: (p: PriorStudy[]) => void;
  insertMeasurement: (id: string) => void; insertAllMeasurements: () => void;
  /** `binding` is the C2 context the proposal was generated from. Optional only
   *  for the two callers that cannot know it (dismiss, and a producer that has no
   *  clinical source at all); a suggestion stored without one is `unbound` and
   *  acceptance refuses it, so omitting it fails closed rather than open. */
  setGhostText: (t: string | null, target: EditorField | null, binding?: AiProposalBinding | null) => void;
  acceptGhostText: () => void;
  /** Call before firing a generation request; returns the sequence number to bind. */
  beginAiProposalRequest: () => number;
  /** Recomputed on every read — never a stored flag, so it cannot go stale itself. */
  ghostProposalStale: () => boolean; ghostProposalStaleReason: () => AiProposalStaleReason | null;
  acknowledgeCopilotItem: (id: string) => void; setActiveCopilotItem: (i: CopilotItem | null) => void; insertCopilotText: (i: CopilotItem) => void; recomputeCopilot: () => void;
  setRailStage: (s: RailStage) => void; toggleCommandPalette: () => void; setCommandPalette: (o: boolean) => void;
  toggleVoiceBar: () => void; setVoiceListening: (o: boolean) => void; setVoiceTranscript: (t: string) => void; setVoiceProvider: (p: string | null) => void;
  parkStudy: () => void; startFinalize: () => void; completeFinalize: () => void; cancelFinalize: () => void; advanceToNextStudy: () => void;
  dismissFatigueCard: () => void; pushNotification: (n: { kind: "interrupt" | "edge-glow" | "ledger"; text: string }) => void; clearNotification: () => void;
  startCriticalSla: () => void; clearCriticalSla: () => void; escalateCriticalSla: () => void;
  openQuickSelectEditor: (t: QuickSelectTile | null, f: QuickSelectField) => void; closeQuickSelectEditor: () => void;
  saveQuickSelectTile: (i: Omit<QuickSelectTile, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void; deleteQuickSelectTile: (id: string) => void;
  incrementTileUsage: (id: string) => void; toggleTileFavorite: (id: string) => void; resetQuickSelectToDefaults: () => void;
  toggleReportFormatPicker: () => void; setReportFormatPickerOpen: (o: boolean) => void; toggleFormatSelection: (id: string) => void; clearFormatSelection: () => void;
  /**
   * `regionChoice` says who is responsible for the region the format implies.
   * `"radiologist"` (the default — a press in the picker, the strip or Quick Normal)
   * syncs the reporting region onto the format's own region. `"automatic"` is the
   * auto-open normal bootstrap: the study's region was resolved from the billed code
   * before the report existed, and a report that opened itself must not come back
   * later claiming the radiologist overrode it.
   */
  applySelectedFormats: (opts?: { regionChoice?: "radiologist" | "automatic" }) => void;
  applyFormatById: (id: string, opts?: { regionChoice?: "radiologist" | "automatic" }) => void;
  confirmOverwriteAndApply: () => void; cancelOverwrite: () => void; applyMergedResult: () => void; cancelMerge: () => void;
  /**
   * VERTICAL INTEGRATION M1 — the one deterministic "Generate Professional Report"
   * action. Builds the report from material that already exists: the study's
   * approved Full Normal Format, the observations in the ledger, the canal AP
   * numbers recorded for this study, and the Impression the ledger implies. No AI,
   * no second composer, and no sentence CARE has not been given — a study whose
   * identity or normal format cannot be resolved is refused with a reason rather
   * than filled with a guess. Never replaces a field: the radiologist's own text
   * is merged in, so nothing typed is lost by pressing it.
   */
  generateProfessionalReport: (ctx: Pick<ReportingStudyContext, "modality" | "region" | "regions" | "source" | "protocolName" | "studyDescription">) => ProfessionalReportOutcome;
  ingestStructuredNormalFormats: (rows: StructuredNormalRow[]) => void;
  toggleFormatFavorite: (id: string) => void;
  /** `"refused"` is the signed-report boundary declining the write. Distinct from
   *  `"pending"` (queued for confirmation) and from `"blocked"` used by the batch
   *  entrypoints, so a caller that rewards the action can tell them apart. */
  applyPathologyOverlay: (opts: PendingPathologyPatch & { force?: boolean }) => "applied" | "pending" | "refused";
  setLinkedStudies: (primary: FindingsStudySection, linked: FindingsStudySection, opts?: { markDirty?: boolean }) => void;
  clearLinkedStudy: () => void;
  setActiveFindingsSection: (studyId: string | null) => void;
  applyMacroBundle: (opts: { bundleId?: string; observations: Array<PendingPathologyPatch & { force?: boolean }> }) => "applied" | "pending" | "blocked";
  /**
   * Bundle deselect: remove only this bundle's observations that are (a) not protected
   * and (b) not superseded by a newer QS/voice observation on the same slotKey.
   * Overridden slots keep the overriding observation's text and ownership.
   * Non-overridden slots restore replacedBaseline, same as removeObservation.
   */
  removeMacroBundle: (bundleId: string) => "removed" | "preserved-manual" | "no-op-unproven" | "missing" | "blocked";
  /**
   * ADR-004 — commit a region transition the radiologist has CONFIRMED. Each retired row goes
   * through the same per-observation withdrawal a bundle deselection uses, so its sentence
   * leaves the text, any baseline it was covering comes back, linked measurements detach and
   * the Recommendation re-aligns — inside ONE clinical undo frame, and with the decision
   * recorded: only the rows whose sentence really left the report appear in it. Returns null
   * without writing a record when the plan retires nothing, when nothing was actually
   * removable, or when the report is signed: a confirmed dialog is not a licence to edit a
   * signed report (#838's boundary).
   */
  commitRegionTransition: (plan: RegionTransitionPlan, decidedBy: string) => RegionTransitionRecord | null;
  /** Restore the transition history a saved draft carries (ADR-004: provenance survives reload). */
  hydrateRegionTransitions: (records: RegionTransitionRecord[]) => void;
  /**
   * The screening panel's whole ledger truth: plan from `screeningLedgerBundles`,
   * remove what the plan no longer holds, re-apply the changed region and the
   * once-only limitation row. Lives here rather than in the component so the
   * withdrawal and once-only rules are testable against the real store.
   */
  syncScreeningLedger: (opts: {
    state: ScreeningState;
    changed: SpineScreeningRegion;
    ledgerRegion?: string;
  }) => void;
  /**
   * `skipUndoSnapshot` is for a withdrawal that is one step of a larger action: the caller
   * captures the frame itself, so one Undo restores the whole action instead of its last row.
   * Same option `applyPathologyOverlay` already takes.
   */
  removeObservation: (id: string, opts?: { remapEvidenceTo?: string | null; skipUndoSnapshot?: boolean }) => "removed" | "preserved-manual" | "no-op-unproven" | "missing" | "blocked";
  /**
   * Composer / dictation-confirmed commit — always via applyPathologyOverlay (same-slot).
   * When editingId's clinical slot changes to an occupied sibling, updates that sibling
   * and removes the previous observation after remapping evidence onto the survivor.
   * Same-slot edits preserve observation id + evidence.
   *
   * `"refused"` is propagated from `applyPathologyOverlay` and is kept distinct
   * from `"blocked"`, which this entrypoint already uses for provenance and
   * ownership conflicts awaiting confirmation — a different reason, and the
   * caller cannot tell the radiologist what to do about a signed report by
   * reading "there is a conflict".
   */
  applyComposerFinding: (opts: PendingPathologyPatch & {
    editingId?: string | null;
    force?: boolean;
  }) => "applied" | "pending" | "blocked" | "refused";
  /**
   * Toggle Impression participation by clearing/setting lastRendered.impression
   * (existing CARE semantics — no parallel boolean). Marks impressionNeedsRefresh.
   * Never silently overwrites manually protected Impression text.
   */
  setObservationImpressionParticipation: (id: string, include: boolean) => "applied" | "blocked" | "missing";
  refreshImpressionFromLedger: (opts?: { excludeBaselineObservations?: boolean }) => void;
  /**
   * The radiologist has read the Impression against the Findings and says it
   * stands as written. Records that against the current clinical content, so the
   * same report does not nag after a reload — and so the next clinical change in
   * the Findings arms it again. Writes no text.
   */
  markImpressionReviewed: () => void;
  /**
   * §18 (mra/mrv) / §37 (spine): re-sort the Impression by clinical priority. A caller
   * may propose the order it computed (brain vascular protects hand-written lines before
   * proposing); with no proposal the stored priority module re-sorts what is there.
   * Anything accepted may only ever PERMUTE the existing lines, so a reorder can never
   * add, drop or reword a clinical statement, and nothing runs once the radiologist has
   * frozen the arrangement. Returns whether the Impression changed.
   */
  orderImpressionByPriority: (proposed?: readonly string[]) => boolean;
  hydrateObservationLedger: (raw: unknown) => LedgerHydrationResult;
  serializeObservationLedger: () => SerializedObservationLedger;
  /**
   * PR #662 §2 — System-owned Normal Study impression.
   *
   * Seeds the system normal patch into `appliedPathologyPatches` and writes
   * the canonical "Normal study." sentence into `impressionText` with
   * provenance source = "system". Idempotent — calling when a system
   * normal patch already exists is a no-op.
   *
   * NEVER called when the workspace has manual impression contributions
   * (radiologist-owned) or any impression-worthy abnormal observation.
   * Auto-yield is decided by `applyPathologyOverlay` / `removeObservation`
   * based on patch identity, NOT by NLP on impression text.
   */
  seedSystemNormalImpression: () => void;
  /** Withdraw the system normal patch (if present). Used by finalize / reset. */
  withdrawSystemNormalImpression: () => void;
  setActiveAnchor: (anchor: ObservationAnchor | null) => void;
  setSelectedObservationId: (id: string | null) => void;
  setMeasurementIntent: (intent: MeasurementIntent | null) => void;
  setCanalIntentLevel: (level: string | null) => void;
  setStructuredViewerMeasurements: (s: ViewerMeasurementsState) => void;
  upsertStructuredViewerMeasurement: (
    m: Omit<StructuredMeasurement, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ) => void;
  setDorsalCanalForced: (v: boolean) => void;
  /**
   * Draft hydration. Folds alias spellings ("T8-T9" and "D8-D9") onto one
   * canonical record before anything reads the map, so a reopen cannot restore
   * the duplicate. Returns the levels left in conflict — never resolved here.
   */
  hydrateCanalApRecords: (raw: Record<string, unknown> | null | undefined) => string[];
  /** The only writer of a caliper's number. Returns the canonical level written. */
  recordCanalApViewerValue: (write: CanalViewerValueWrite) => string | null;
  /** The only writer of the radiologist's own number. Keeps the caliper's. */
  recordCanalApManualValue: (level: string, raw: string, region?: CanalSegment | null) => string | null;
  /** Wholesale write — used by draft hydration and by "revert to derived technique". */
  setVascularTechnique: (s: VascularTechniqueState) => void;
  /** A radiologist-stated acquisition answer. Wins over every later text derivation. */
  setVascularTechniqueManual: (key: VascularTechniqueKey, on: boolean) => void;
  setVascularTechniqueDesignation: (note: string | null) => void;
  setCoverageMark: (regionKey: string, status: CoverageMark["status"], reason?: string) => void;
  /** Focus / jump: promote unopened → viewed only; never downgrade or dirty. */
  touchCoverageViewed: (regionKey: string) => void;
  hydrateCoverageMarks: (raw: unknown) => void;
  serializeCoverageMarks: () => CoverageMark[];
  /** MRI Lumbar V3 §5 — numbering mode / LSTV detail. */
  setLumbarNumbering: (patch: Partial<LumbarNumberingState>) => void;
  setDorsalNumbering: (patch: Partial<DorsalNumberingState>) => void;
  /**
   * Dorso-Lumbar coverage / numbering. Changing it never renumbers an existing
   * observation: levels that fall outside the new coverage are reported as
   * stranded by `dorsolumbarStrandedLevels` (dorso-lumbar spec §5).
   */
  setDorsoLumbarNumbering: (patch: Partial<DorsoLumbarState>) => void;
  /**
   * What this examination is. Initialised from billing evidence; a manual call
   * marks it overridden so a later re-derivation from the catalog cannot walk
   * back what the radiologist stated about the performed study.
   */
  setStudyComposition: (
    composition: StudyComposition,
    provenance?: CompositionProvenance,
    manual?: boolean,
  ) => void;
  /** MRI Lumbar V3 §35 — what the examination actually included. */
  setSequencesAvailable: (patch: Partial<SpineSequencesAvailable>) => void;
  replaceSequencesAvailable: (next: SpineSequencesAvailable) => void;
  /** MRI Lumbar V3 §22-§23 — one region's screening role and selections. */
  setScreeningRegion: (region: SpineScreeningRegion, patch: Partial<ScreeningRegionState>) => void;
  /** MRI Lumbar V3 §23 — billing/protocol derived default roles, overridable. */
  replaceScreeningRoles: (roles: Record<SpineScreeningRegion, RegionRole>) => void;
  /** MRI Lumbar V3 §37 — manual Impression edit / reorder freezes auto priority. */
  setImpressionOrderFrozen: (frozen: boolean) => void;
  dismissOwnershipReview: () => void;
  dismissLedgerHydrationWarning: () => void;
  undoLastPatch: () => boolean;
  applyVoiceComposerPlan: (plan: VoiceChangePlan, transcript: string, opts?: { force?: boolean }) => "applied" | "blocked";
  /**
   * PR #662 §3 — Fast per-level spine workflow.
   *
   * Apply multiple spine levels at once (e.g. L3-L4 bulge + L4-L5 bulge +
   * L5-S1 protrusion). Internally calls `applyPathologyOverlay` once per
   * level — there is no second batch mutation engine. Each resulting
   * observation is independently owned and independently removable.
   *
   * Same-slot replacement, different-level coexistence, laterality,
   * manual protection, measurements, anchors, and undo semantics are
   * preserved exactly as in single-level apply.
   */
  applyMultiLevelSpine: (opts: {
    bundleId?: string;
    region: string;
    levels: Array<{
      level: string;
      concept: string;
      findingsText: string;
      impressionText?: string;
      laterality?: string;
      severity?: string;
    }>;
  }) => "applied" | "pending" | "blocked";
  /** Apply accepted AI composer plain text in one atomic undo snapshot (Guard 9). */
  applyAiComposerAccepted: (opts: {
    findings: string;
    impression: string;
    recommendation: string;
  }) => "applied" | "blocked";
  clearVoiceComposerSession: () => void;
  relateralizePatches: (side: Side) => void;
  /** Host-injected hook for Ctrl+I / command palette — set by RadiologyReportingWorkspace. */
  triggerAiImpression?: () => void | Promise<void>;
  saveAsFormat: (i: Omit<ReportFormat, "id" | "createdAt" | "updatedAt">) => void; deleteReportFormat: (id: string) => void;
  openSaveAsFormatDialog: () => void; closeSaveAsFormatDialog: () => void; resetReportFormatsToDefaults: () => void;
  /** Hydrate formats (+ chocolate macros) from server; migrate localStorage once. */
  hydrateContentLibraries: () => Promise<void>;
  /** Sibling of hydrateContentLibraries. Missing/invalid key → built-in seeds. */
  hydrateAbnormalPatternLibrary: (rows?: ReadonlyArray<{ key: string; value: string | null }> | null) => void;
  openMacroEditor: (m: SnippetMacro | null) => void; closeMacroEditor: () => void; saveMacro: (i: Omit<SnippetMacro, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;
  deleteMacro: (id: string) => void; setActiveMacroPrompt: (p: { macro: SnippetMacro; field: EditorField; startPos: number } | null) => void; applyMacroWithValues: (v: Record<string, string>) => void;
  updateSignOffProfile: (m: Modality, n: string, c: string) => void; triggerPreload: () => void; resetPreload: () => void;
  setReportingContext: (ctx: ReportingStudyContext) => void;
};

function scopedSnippetMacros(get: () => WorkspaceStore): SnippetMacro[] {
  const st = get().studies.find((s) => s.id === get().activeStudyId);
  return lookupMacrosForContext(get().snippetMacros, st?.modality, get().reportingContext);
}

function fieldTextKey(f: EditorField): keyof Pick<S, "findingsText" | "impressionText" | "recommendationText" | "techniqueText" | "clinicalHistoryText"> {
  if (f === "findings") return "findingsText";
  if (f === "impression") return "impressionText";
  if (f === "recommendation") return "recommendationText";
  if (f === "technique") return "techniqueText";
  return "clinicalHistoryText";
}

const createWorkspaceStore: StateCreator<WorkspaceStore> = (set, get) => ({
  studies: [], activeStudyId: null, nextStudyId: null, nextStudyPreloaded: false,
  findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: "",
  fieldProvenance: {},
  measurements: [], priors: [], criticalFindings: [],
  isDirty: false, isFinalizing: false, isFinalized: false, railStage: "orient",
  showCommandPalette: false, showVoiceBar: false, voiceListening: false, voiceTranscript: "", voiceProvider: null,
  ghostText: null, ghostTextTarget: null, ghostProposal: null, ghostRequestSeq: 0,
  copilotItems: [], acknowledgedCopilotIds: new Set(), activeCopilotItem: null,
  completedStudyIds: new Set(), parkedStudyIds: new Set(),
  sessionStartedAt: Date.now(), lastSignAt: null, fatigueCardDismissed: false,
  notification: null, criticalSlaStartedAt: null, criticalSlaMinutes: 15, criticalSlaEscalated: false,
  quickSelectTiles: typeof window !== "undefined" ? loadTiles() : DEFAULT_QUICK_SELECT_TILES, quickSelectEditorOpen: false, quickSelectEditingTile: null, quickSelectEditorField: null,
  reportFormats: typeof window !== "undefined" ? loadFormats() : DEFAULT_REPORT_FORMATS, structuredNormalRows: [], selectedFormatIds: [], reportFormatPickerOpen: false,
  appliedFormatReportTitle: null,
  saveAsFormatDialogOpen: false, mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null, confirmOverwriteOpen: false, pendingFormatIds: [],
  pendingFormatOverwrite: null, pendingFormatRegion: null,
  pendingPathologyPatch: null, lastPatchSnapshot: null, patchUndoStack: [], startingCanvasBaseline: null, appliedPathologyPatches: [], impressionNeedsRefresh: false,
  impressionDependencyReasons: [], impressionBasis: null,
  activeAnchor: null, selectedObservationId: null,
  measurementIntent: null, canalIntentLevel: null,
  structuredViewerMeasurements: emptyViewerMeasurementsState(),
  dorsalCanalForced: false,
  canalApProvenance: {},
  regionTransitions: [],
  lumbarNumbering: defaultLumbarNumbering(),
  dorsalNumbering: defaultDorsalNumbering(),
  dorsoLumbarNumbering: defaultDorsoLumbarState(),
  studyComposition: "unknown",
  studyCompositionProvenance: "none",
  studyCompositionOverridden: false,
  sequencesAvailable: defaultSpineSequences(),
  screening: defaultScreeningState(),
  impressionOrderFrozen: false,
  vascularTechnique: defaultVascularTechnique(),
  activeStudyInstanceUID: null, coverageMarks: [], coverageByScope: {},
  appliedFormatName: null,
  ownershipReviewWarnings: [], ledgerHydrationWarning: null,
  voiceComposerObservations: [], voiceComposerTranscriptHistory: [],
  snippetMacros: typeof window !== "undefined" ? loadMacros() : DEFAULT_SNIPPET_MACROS, macroEditorOpen: false, editingMacro: null, activeMacroPrompt: null,
  signOffProfiles: typeof window !== "undefined" ? loadProfiles() : DEFAULT_SIGN_OFF_PROFILES, preloadTriggered: false,
  reportingContext: EMPTY_REPORTING_STUDY_CONTEXT,
  primaryFindingsSection: null,
  linkedStudy: null,
  activeFindingsSectionId: null,
  abnormalPatternLibrary: cloneBuiltinAbnormalPatterns(),
  abnormalPatternSuggestionsEnabled: true,
  appliedPatternMarkers: [],
  patternUsageCounts: readPatternUsageCounts(),
  abnormalPatternConfirm: null,

  setStudies: (s) => {
    const next = normalizeWorkspaceStudies(s);
    const prev = get().studies;
    // Skip no-op updates — otherwise setStudies(workflow.queue) in a render-driven
    // effect can thrash when the queue array is a new [] reference each render
    // (React minified error #185 / maximum update depth).
    if (
      prev.length === next.length
      && prev.every((p, i) => {
        const n = next[i]!;
        return p.id === n.id
          && p.accession === n.accession
          && p.studyInstanceUID === n.studyInstanceUID
          && p.status === n.status
          && p.priority === n.priority
          && p.patient?.id === n.patient?.id
          && p.patient?.name === n.patient?.name
          && p.tatMinutes === n.tatMinutes
          && p.lockedBy === n.lockedBy;
      })
    ) {
      return;
    }
    set({ studies: next });
  },
  selectStudy: (id) => {
    const st = get().studies.find(s => s.id === id);
    if (!st) {
      // Was a bare `return`. A silent no-op on a reset path is how the
      // cross-patient undo leak stayed hidden: every caller assumes the switch
      // happened and carries on with the previous study's state on screen.
      console.warn("[care.workspace_store] selectStudy ignored — id is not in the worklist; clinical state NOT reset", {
        id,
        activeStudyId: get().activeStudyId,
        knownStudies: get().studies.length,
      });
      return;
    }
    set({
      ...emptyClinicalState(),
      // Identity and context stay per-caller: the PARTIAL reset in
      // useDraftPersistence must not wipe reportingContext or race hydration.
      activeStudyId: id,
      activeStudyInstanceUID: st.studyInstanceUID ?? null,
      clinicalHistoryText: st.clinicalHistory || "",
      reportingContext: EMPTY_REPORTING_STUDY_CONTEXT,
    });
    setTimeout(() => { get().recomputeCopilot(); get().seedSystemNormalImpression(); }, 0);
  },
  setNextStudy: (id) => set({ nextStudyId: id }), markNextStudyPreloaded: () => set({ nextStudyPreloaded: true }),
  setField: (f, v, optsOrSource) => {
    // Also covers setFieldIfEmpty and replaceField, which both delegate here.
    if (refuseSignedMutation(get(), `setField:${f}`)) return;
    const opts = typeof optsOrSource === "string"
      ? { source: optsOrSource, replaceProvenance: true as const }
      : optsOrSource;
    const key = fieldTextKey(f);
    const prevText = get()[key];
    const prevProv = get().fieldProvenance[f] ?? EMPTY_FIELD_PROVENANCE;
    let nextProv: FieldProvenanceMap;
    if (opts?.replaceProvenance && opts.source) {
      nextProv = provenanceFromText(v, opts.source);
    } else if (opts?.source && opts.source !== "manual") {
      // Wholesale assign from a known source without semantic merge.
      nextProv = provenanceFromText(v, opts.source);
    } else {
      nextProv = reconcileProvenanceAfterManualEdit(prevText, v, prevProv);
    }
    if (prevText === v && fieldProvenanceEqual(prevProv, nextProv)) return;
    const p: Partial<S> = {
      isDirty: true,
      [key]: v,
      fieldProvenance: { ...get().fieldProvenance, [f]: nextProv },
    };
    if (f === "impression" && (!opts?.source || opts.source === "manual")) {
      // §37: a hand-written or hand-reordered Impression belongs to the
      // radiologist — automatic priority sorting must never reshuffle it again.
      // (A true no-op write has already returned above, so this only fires when
      // the radiologist actually changed the field or its ownership.)
      p.impressionOrderFrozen = true;
    }
    set(p);
    if (opts?.source === "manual" || !opts?.source) {
      const narrative = narrativeFromState(get());
      const prov = get().fieldProvenance;
      set({
        appliedPathologyPatches: get().appliedPathologyPatches.map((patch) => {
          if (patch.protected) return patch;
          const lastF = patch.lastRendered.findings ?? "";
          const lastI = patch.lastRendered.impression ?? "";
          const lastR = patch.lastRendered.recommendation ?? "";
          const missingFindings = Boolean(lastF.trim()) && !contributionPresent(narrative.findings, lastF);
          const missingImpression = Boolean(lastI.trim()) && !contributionPresent(narrative.impression, lastI);
          const mutated = (f === "findings" && contributionMutated(prevText, v, lastF))
            || (f === "impression" && contributionMutated(prevText, v, lastI))
            || (f === "recommendation" && contributionMutated(prevText, v, lastR));
          const manual = contributionProtected(lastF, prov.findings)
            || contributionProtected(lastI, prov.impression)
            || contributionProtected(lastR, prov.recommendation);
          return { ...patch, protected: Boolean(patch.protected || missingFindings || missingImpression || mutated || manual) };
        }),
      });
    }
    if (f === "findings" || f === "impression") {
      // Derived after the marking above, from the text as it now stands, so the
      // answer a keystroke produces is the answer the same report produces when it
      // is reopened. `rebase` is the paired write: a source that owns both sides
      // is claiming the summary now matches the findings, which is why `ai-draft`
      // is excluded here as it already was in mergeField — a model's sentence
      // proves nothing about the findings behind it.
      const ownsBoth =
        f === "impression" && !!opts?.source && opts.source !== "manual" && opts.source !== "ai-draft";
      set(deriveImpressionDependency(get(), ownsBoth ? { rebase: true } : undefined, { findingsJustChanged: f === "findings" }));
    }
    if (f === "findings" || f === "impression" || f === "recommendation") {
      const d = detectMacroTrigger(v, scopedSnippetMacros(get));
      if (d) set({ activeMacroPrompt: { macro: d.macro, field: f, startPos: d.startPos } });
      else if (get().activeMacroPrompt) set({ activeMacroPrompt: null });
    }
    const st = get().studies.find(s => s.id === get().activeStudyId);
    if (f === "findings" && st && shouldPreloadNext(v, st.modality, get().preloadTriggered)) set({ preloadTriggered: true });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  mergeField: (f, incoming, source) => {
    // Subsumes the old voice-only guard. Dictation was the single source refused
    // on a signed report; every other source that reaches here — tile, template,
    // companion panel, measurement box, an accepted AI ghost — was let through.
    if (refuseSignedMutation(get(), `mergeField:${source}`)) return "refused";
    const key = fieldTextKey(f);
    const existing = get()[key];
    const existingProvenance = get().fieldProvenance[f] ?? EMPTY_FIELD_PROVENANCE;
    const result = mergeReportFieldContentWithProvenance({
      field: f as ReportFieldKey,
      existing,
      incoming,
      source,
      existingProvenance,
    });
    if (
      result.text === existing
      && fieldProvenanceEqual(existingProvenance, result.provenance)
    ) {
      // Nothing to write, but nothing was refused either — the field already says
      // this. Reported as applied so a caller rewards the action rather than
      // treating a duplicate insert as a rejection.
      return "applied";
    }
    set({
      isDirty: true,
      [key]: result.text,
      fieldProvenance: { ...get().fieldProvenance, [f]: result.provenance },
    });
    if (f === "findings" || f === "impression") {
      // B-04 (narrow), kept and moved rather than dropped: clearing the flag is a
      // claim that the Impression now matches the Findings, so only a source that
      // owns BOTH sides may make it. A Quick Select tile writes the finding and
      // its impression line in one action; a template or protocol is applied
      // whole; dictation is the radiologist concluding. An accepted AI proposal
      // owns neither — it changes the Impression's words, which proves nothing
      // about the findings behind them, and the model summarised a snapshot that
      // may already have moved — so `ai-draft` keeps whatever the Findings edits
      // decided. Everything else is derived from the text, which is also why the
      // additive insert here and a hand-typed Findings edit now behave the same:
      // before this, tiles, templates, dictation, the measurement box and the AI
      // ghost all left the Impression unflagged while typing did flag it.
      const ownsBoth = f === "impression" && source !== "manual" && source !== "ai-draft";
      set(deriveImpressionDependency(get(), ownsBoth ? { rebase: true } : undefined, { findingsJustChanged: f === "findings" }));
    }
    if (f === "findings" || f === "impression" || f === "recommendation") {
      const d = detectMacroTrigger(result.text, scopedSnippetMacros(get));
      if (d) set({ activeMacroPrompt: { macro: d.macro, field: f, startPos: d.startPos } });
      else if (get().activeMacroPrompt) set({ activeMacroPrompt: null });
    }
    const st = get().studies.find(s => s.id === get().activeStudyId);
    if (f === "findings" && st && shouldPreloadNext(result.text, st.modality, get().preloadTriggered)) set({ preloadTriggered: true });
    setTimeout(() => get().recomputeCopilot(), 0);
    return "applied";
  },
  setFieldIfEmpty: (f, v, source) => {
    const existing = get()[fieldTextKey(f)];
    if (!existing.trim() && v.trim()) {
      get().setField(f, v, { source, replaceProvenance: true });
    }
  },
  replaceField: (f, v, source) => {
    get().setField(f, v, { source, replaceProvenance: true });
  },
  setEditorContent: (c) => {
    // Normalize: API may return impression/recommendation as string[] or string
    const norm = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
    const findings = norm(c.findings);
    const impression = norm(c.impression);
    const recommendation = norm(c.recommendation);
    const technique = norm(c.technique);
    const clinicalHistory = norm(c.clinicalHistory);
    const state = get();
    const nextProv = {
      findings: provenanceFromText(findings, "manual"),
      impression: provenanceFromText(impression, "manual"),
      recommendation: provenanceFromText(recommendation, "manual"),
      technique: provenanceFromText(technique, "manual"),
      clinicalHistory: provenanceFromText(clinicalHistory, "manual"),
    };
    if (
      state.findingsText === findings
      && state.impressionText === impression
      && state.recommendationText === recommendation
      && state.techniqueText === technique
      && state.clinicalHistoryText === clinicalHistory
      && fieldProvenanceEqual(state.fieldProvenance.findings, nextProv.findings)
      && fieldProvenanceEqual(state.fieldProvenance.impression, nextProv.impression)
      && fieldProvenanceEqual(state.fieldProvenance.recommendation, nextProv.recommendation)
      && fieldProvenanceEqual(state.fieldProvenance.technique, nextProv.technique)
      && fieldProvenanceEqual(state.fieldProvenance.clinicalHistory, nextProv.clinicalHistory)
    ) {
      return;
    }
    // Loaded drafts/templates have uncertain provenance — mark as manual (safe).
    set({
      findingsText: findings,
      impressionText: impression,
      recommendationText: recommendation,
      techniqueText: technique,
      clinicalHistoryText: clinicalHistory,
      fieldProvenance: nextProv,
      isDirty: true,
    });
    // Every other content writer defers this (setField, mergeField,
    // insertMeasurement, insertAllMeasurements, insertCopilotText,
    // applyMacroWithValues) and setEditorContent was the omission. It matters
    // because this is the writer draft hydration uses, and hydration follows
    // the study-switch reset that empties copilotItems — without the recompute
    // the rail stayed empty until the radiologist's first keystroke. Deliberately
    // after the no-op return above, so an identical write is still a true no-op.
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  setMeasurements: (m) => {
    const prev = get().measurements;
    if (
      prev.length === m.length
      && prev.every((p, i) => {
        const n = m[i]!;
        return p.id === n.id
          && p.name === n.name
          && p.value === n.value
          && p.unit === n.unit
          && p.priorValue === n.priorValue
          && p.delta === n.delta
          && p.source === n.source
          && p.inserted === n.inserted;
      })
    ) {
      return;
    }
    set({ measurements: m });
  }, setPriors: (p) => set({ priors: p }),
  insertMeasurement: (id) => {
    // Guarded here rather than only through mergeField below. mergeField refuses
    // the Findings write on a signed report, but the `set({ measurements: ms })`
    // after it is unconditional and stamps `inserted: true` regardless — and the
    // copilot rail renders its Insert button only for `!m.inserted`
    // (copilot-rail.tsx:67) with no lock prop of its own. So a click on a signed
    // report announced the refusal, then hid the button and greyed the row as
    // inserted for a sentence that never reached Findings.
    if (refuseSignedMutation(get(), "insertMeasurement")) return;
    const ms = get().measurements.map(m => m.id === id ? { ...m, inserted: true } : m);
    const m = ms.find(x => x.id === id);
    if (m) {
      const t = `${m.name}: ${m.value}${m.unit}${m.priorValue ? ` (prior ${m.priorValue}${m.unit})` : ""}`;
      const sentence = t.trim().endsWith(".") ? t.trim() : `${t.trim()}.`;
      get().mergeField("findings", sentence, "companion");
    }
    set({ measurements: ms });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  insertAllMeasurements: () => {
    // The same unconditional `inserted` stamp. Its one live caller — the
    // measurement branch of insertCopilotText — is guarded above it, and the
    // other, viewer-panel.tsx, is imported nowhere, so nothing reaches this today.
    // It is guarded because `measurements` is now a clinical key and the boundary
    // ratchet has to be able to say so about every writer of it.
    if (refuseSignedMutation(get(), "insertAllMeasurements")) return;
    const ms = get().measurements.map(m => ({ ...m, inserted: true }));
    const t = ms.map(m => `${m.name}: ${m.value}${m.unit}${m.priorValue ? ` (prior ${m.priorValue}${m.unit})` : ""}`).join(", ");
    get().mergeField("findings", `Measurements: ${t}.`, "companion");
    set({ measurements: ms });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  setGhostText: (t, target, binding) => {
    // Clearing is always allowed: dismissal must never be blocked by a staleness
    // or ordering question, and Discard has no clinical effect to get wrong.
    if (!t || !target) { set({ ghostText: null, ghostTextTarget: null, ghostProposal: null }); return; }
    const seq = typeof binding?.requestSeq === "number" ? binding.requestSeq : null;
    // Ordering, enforced here rather than in the hook, so no producer can bypass
    // it: two rapid Ctrl+I presses can answer out of order, and the older sentence
    // must not replace the newer one the radiologist is already looking at.
    if (seq !== null && seq < get().ghostRequestSeq) return;
    set({ ghostText: t, ghostTextTarget: target, ghostProposal: binding ?? null });
  },
  beginAiProposalRequest: () => { const seq = get().ghostRequestSeq + 1; set({ ghostRequestSeq: seq }); return seq; },
  ghostProposalStale: () => !evaluateAiProposal(
    get().ghostProposal, currentAiProposalContext(get()),
  ).fresh,
  ghostProposalStaleReason: () => evaluateAiProposal(
    get().ghostProposal, currentAiProposalContext(get()),
  ).reason,
  acceptGhostText: () => {
    const { ghostText, ghostTextTarget } = get();
    if (!ghostText || !ghostTextTarget) return;
    // C2 — the trust boundary is here, not in the UI. GhostLayer's banner uses the
    // same pure call to decide what to show, but a disabled button is UX: Tab, the
    // command palette and any future caller arrive at this line, so freshness is
    // re-checked at acceptance rather than trusted from the last render.
    const verdict = evaluateAiProposal(get().ghostProposal, currentAiProposalContext(get()));
    if (!verdict.fresh) {
      // The proposal stays on screen, visibly stale, rather than vanishing on a
      // click that did nothing. Regenerate or Discard are the only ways out; there
      // is deliberately no "accept anyway" that reaches this line.
      get().pushNotification({
        kind: "interrupt",
        text: `Out-of-date AI suggestion not inserted — ${verdict.detail}`,
      });
      return;
    }
    // The one write, into the one boundary #880 owns. Everything after this —
    // how the sentence joins the field, what provenance it carries, whether the
    // Impression still needs reconciling — is decided there, not here.
    get().mergeField(ghostTextTarget, ghostText, "ai-draft");
    set({ ghostText: null, ghostTextTarget: null, ghostProposal: null });
  },
  acknowledgeCopilotItem: (id) => { const a = new Set(get().acknowledgedCopilotIds); a.add(id); set({ acknowledgedCopilotIds: a }); },
  setActiveCopilotItem: (i) => set({ activeCopilotItem: i }),
  insertCopilotText: (item) => {
    // Before the study stamp check: a signed report is not writable whatever
    // study the suggestion came from. The rail's Insert button is one of the few
    // controls the canvas does NOT disable on a signed study (it receives only
    // `measureDisabled`), so this is the only thing standing between that click
    // and the signed Findings.
    if (refuseSignedMutation(get(), "insertCopilotText")) return;
    // Defence in depth, on the same reasoning as undoLastPatch's cross-study
    // refusal: copilotItems, acknowledgedCopilotIds and activeCopilotItem are
    // all in CLINICAL_RESET_FIELDS, so the ordinary switch path has already
    // emptied the rail before this can fire. Reaching the refusal means the
    // item arrived by a route that went round that reset — a click handler
    // holding the previous render's item after a navigation, a deep link, or
    // browser Back/Forward. Inserting would write the previous patient's
    // sentence into this patient's Findings, and autosave would then persist it
    // inside the current generation where no guard intercepts.
    //
    // Checked before the insertText test so the refusal does not depend on what
    // the item happens to carry. The `missing-impression` branch below is
    // currently unreachable — that item is built without insertText — and this
    // ordering means it cannot be revived unguarded.
    //
    // An unstamped item is refused as well: see CopilotItem.studyId.
    //
    // A-02 — what makes this comparison mean anything. `recomputeCopilot` stamps items
    // with `st.id`, resolved from `get().activeStudyId`, so a guard that also reads
    // `activeStudyId` was self-referential for as long as that field could lag the route
    // study: an item computed against the PREVIOUS study's modality, sex and priors —
    // while reading the current study's narrative — was stamped with the previous study's
    // id and then waved through by comparing that id with itself. It is now a real check
    // because `activeStudyId` is written inside the same setState as the clinical reset in
    // `useDraftPersistence`, from the authoritative route `studyId`, and the mirror effect
    // that used to leave it stale when a study had not yet landed in `studies` is gone.
    // Required invariant: an item generated for A cannot insert while route study B is
    // active, even if stale store state or a stale click handler survives.
    if (item.studyId !== get().activeStudyId) {
      console.warn("[care.workspace_store] copilot insert refused — the suggestion belongs to a different study", {
        itemId: item.id,
        itemStudyId: item.studyId ?? null,
        activeStudyId: get().activeStudyId,
      });
      return;
    }
    if (!item.insertText) return;
    if (item.kind === "missing" && item.id === "missing-impression") {
      set({ activeCopilotItem: item });
      return;
    }
    // B-03 — the suggestion's own declared destination and authorship are
    // authoritative. This boundary used to end in
    // `mergeField("findings", item.insertText, "companion")` for every item, so
    // an AI impression line landed in Findings next to the radiologist's "No
    // acute infarct." (a Findings section asserting a thing and its negation,
    // with the Impression still empty) and accepted AI prose was attributed to
    // the companion panel. Both questions are answered by one contract module
    // now, and an unknown target — or AI prose with no target at all — refuses
    // rather than guesses. Resolved AFTER the signed-report and study-stamp
    // guards above, so a refusal is never the thing that mutates a report.
    const acceptance = resolveCopilotAcceptance(item);
    if (!acceptance.accepted) {
      console.warn("[care.workspace_store] copilot insert refused — the suggestion declared no destination, or an unknown one", {
        itemId: item.id,
        insertTarget: item.insertTarget ?? null,
        reason: acceptance.reason,
        detail: acceptance.detail,
      });
      return;
    }
    const targetField = acceptance.field;
    const targetSource = acceptance.source;
    if (item.id === "missing-comparison" && targetField === "findings") {
      const insert = item.insertText.trim();
      const c = get().findingsText;
      if (!c.trim()) {
        get().mergeField("findings", insert, targetSource);
      } else if (c.startsWith("Comparison")) {
        get().mergeField("findings", insert, targetSource);
      } else {
        const combined = `${insert} ${c}`;
        const prevProv = get().fieldProvenance.findings ?? EMPTY_FIELD_PROVENANCE;
        const nextProv = reconcileProvenanceAfterManualEdit(c, combined, prevProv);
        for (const [k, sources] of Object.entries(provenanceFromText(insert, targetSource))) {
          nextProv[k] = sources;
        }
        set({
          isDirty: true,
          findingsText: combined,
          fieldProvenance: { ...get().fieldProvenance, findings: nextProv },
        });
        // This branch is the only one in `insertCopilotText` that does not end in
        // `mergeField`, and `mergeField` is where the Impression dependency gets
        // re-read. A comparison line that says "there is a new C2 fracture" changes
        // what the Findings assert, so it has to change the verdict too — otherwise
        // the rail arms the report on reload and not on click.
        set(deriveImpressionDependency(get()));
        setTimeout(() => get().recomputeCopilot(), 0);
      }
    } else if (item.kind === "measurement") {
      get().insertAllMeasurements();
    } else {
      get().mergeField(targetField, item.insertText, targetSource);
    }
    get().acknowledgeCopilotItem(item.id);
  },
  /**
   * Every item is stamped with the study it was computed from, and the stamp is
   * applied BEFORE the `JSON.stringify` no-op comparison below — the stored
   * items already carry it, so comparing unstamped against stamped would never
   * match and would silently turn that early return into dead code (pinned by
   * `clinicalStateReset.hardening.test.ts` and `setFieldIdempotent.test.ts`).
   * `st.id` is used rather than `activeStudyId` because the guard above has
   * already proven they are the same study and `st.id` is non-nullable.
   */
  recomputeCopilot: () => { const { findingsText, impressionText, measurements, activeStudyId, priors, copilotItems } = get(); const st = get().studies.find(s => s.id === activeStudyId); if (!st?.patient) { if (copilotItems.length) set({ copilotItems: [] }); return; } const items = runCopilotAnalysis({ findingsText, impressionText, measurements, modality: st.modality, sex: st.patient?.sex, hasPrior: priors.length > 0 }).map(i => ({ ...i, studyId: st.id })); if (JSON.stringify(copilotItems) === JSON.stringify(items)) return; /* ff_radiology_critical_result_comms OFF ⇒ no SLA clock and no interrupt card, but `set({ copilotItems: items })` below still runs: the rail's "Critical finding detected" item is the DETECTOR's informational output, which this flag deliberately does not suppress. What the flag removes is the communication WORKFLOW built on top of it — the 15-minute clock, the popup, the pre-sign block, the checklist panel and the tracker page. */ const ci = criticalCommsEnabled() ? items.filter(i => i.kind === "critical" && !get().acknowledgedCopilotIds.has(i.id)) : []; if (ci.length > 0) { /* The SLA clock starts on the finding, not on the card. Both used to sit inside the `!get().notification` gate, so a card still on screen from the previous study suppressed the clock too — the finding ran unacknowledged with no elapsed time being measured at all. */ if (!get().criticalSlaStartedAt) get().startCriticalSla(); if (!get().notification) get().pushNotification({ kind: "interrupt", text: `Critical finding: ${ci[0].detail}` }); } set({ copilotItems: items }); },
  setRailStage: (s) => set({ railStage: s }), toggleCommandPalette: () => set({ showCommandPalette: !get().showCommandPalette }), setCommandPalette: (o) => set({ showCommandPalette: o }),
  toggleVoiceBar: () => set({ showVoiceBar: !get().showVoiceBar }), setVoiceListening: (o) => set({ voiceListening: o }), setVoiceTranscript: (t) => set({ voiceTranscript: t }), setVoiceProvider: (p) => set({ voiceProvider: p }),
  parkStudy: () => { const id = get().activeStudyId; if (!id) return; const pk = new Set(get().parkedStudyIds); pk.add(id); set({ parkedStudyIds: pk }); get().advanceToNextStudy(); },
  startFinalize: () => set({ isFinalizing: true }),
  completeFinalize: () => { const id = get().activeStudyId; if (!id) { set({ isFinalizing: false }); return; } const c = new Set(get().completedStudyIds); c.add(id); set({ isFinalizing: false, isFinalized: true, completedStudyIds: c, lastSignAt: Date.now(), criticalSlaStartedAt: null, criticalSlaEscalated: false }); /* Navigation after finalize is handled by the workspace page (React Router navigate),  not here — the store has no router access. */ },
  cancelFinalize: () => set({ isFinalizing: false }),
  advanceToNextStudy: () => { const { studies, completedStudyIds, activeStudyId, nextStudyId, nextStudyPreloaded } = get(); if (nextStudyId && nextStudyPreloaded) { get().selectStudy(nextStudyId); set({ nextStudyId: null, nextStudyPreloaded: false }); return; } const r = studies.filter(s => !completedStudyIds.has(s.id) && s.id !== activeStudyId); const pr: Record<string, number> = { stat: 0, urgent: 1, routine: 2, vip: 1 }; r.sort((a, b) => ((pr[a.priority] ?? 2) - (pr[b.priority] ?? 2)) || (a.tatMinutes - b.tatMinutes)); if (r[0]) { get().selectStudy(r[0].id); return; }
    // End of the queue — no study is open, so nothing clinical may remain. This
    // was a third hand-maintained reset list (4 of ~61 fields) and it left the
    // last reported study's ledger, undo stack, measurements and protocol
    // answers sitting in the singleton store.
    set({ ...emptyClinicalState(), activeStudyId: null, reportingContext: EMPTY_REPORTING_STUDY_CONTEXT });
  },
  dismissFatigueCard: () => set({ fatigueCardDismissed: true }),
  pushNotification: (n) => set({ notification: { ...n, id: Math.random().toString(36).slice(2) } }), clearNotification: () => set({ notification: null }),
  startCriticalSla: () => set({ criticalSlaStartedAt: Date.now(), criticalSlaEscalated: false }), clearCriticalSla: () => set({ criticalSlaStartedAt: null, criticalSlaEscalated: false }), escalateCriticalSla: () => set({ criticalSlaEscalated: true }),
  openQuickSelectEditor: (t, f) => set({ quickSelectEditorOpen: true, quickSelectEditingTile: t, quickSelectEditorField: f }),
  closeQuickSelectEditor: () => set({ quickSelectEditorOpen: false, quickSelectEditingTile: null, quickSelectEditorField: null }),
  saveQuickSelectTile: (input) => { const e = input.id ? get().quickSelectTiles.find(t => t.id === input.id) : null; let tiles: QuickSelectTile[]; if (e) tiles = get().quickSelectTiles.map(t => t.id === e.id ? { ...t, ...input, updatedAt: new Date().toISOString() } : t); else tiles = [...get().quickSelectTiles, createTile(input)]; saveTiles(tiles); set({ quickSelectTiles: tiles }); get().closeQuickSelectEditor(); },
  deleteQuickSelectTile: (id) => { const t = get().quickSelectTiles.filter(t => t.id !== id); saveTiles(t); set({ quickSelectTiles: t }); get().closeQuickSelectEditor(); },
  // The only tile mutator that did not persist. Its three siblings all call
  // saveTiles, so usage counts lived in memory and reset on every reload — which
  // also partly concealed the refused-use bug below: the false increments did not
  // survive long enough to be noticed. `updatedAt` is deliberately not bumped —
  // a use is not an edit to the tile's content, and the library sorts on it.
  incrementTileUsage: (id) => { const t = get().quickSelectTiles.map(x => x.id === id ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x); saveTiles(t); set({ quickSelectTiles: t }); },
  toggleTileFavorite: (id) => { const t = get().quickSelectTiles.map(x => x.id === id ? { ...x, favorite: !x.favorite, updatedAt: new Date().toISOString() } : x); saveTiles(t); set({ quickSelectTiles: t }); },
  resetQuickSelectToDefaults: () => set({ quickSelectTiles: resetToDefaults() }),
  toggleReportFormatPicker: () => set({ reportFormatPickerOpen: !get().reportFormatPickerOpen }),
  setReportFormatPickerOpen: (o) => set({ reportFormatPickerOpen: o }),
  toggleFormatSelection: (id) => { const c = get().selectedFormatIds; if (c.includes(id)) set({ selectedFormatIds: c.filter(x => x !== id) }); else if (c.length < 2) set({ selectedFormatIds: [...c, id] }); },
  clearFormatSelection: () => set({ selectedFormatIds: [] }),
  applySelectedFormats: (opts?: { regionChoice?: "radiologist" | "automatic" }) => {
    if (get().isFinalized) return;
    const ids = get().selectedFormatIds;
    if (!ids.length) return;
    const fs = get().reportFormats.filter((f: ReportFormat) => ids.includes(f.id));
    if (!fs.length) return;
    const bridge = getFormatApplyBridge();
    const availableRegions = bridge?.availableRegions() ?? [];
    const currentRegion = bridge?.currentRegion() ?? get().reportingContext.region ?? null;
    // An automatic apply takes no region decision at all — see the type comment. It
    // also keeps the analysis on the study's own region, so a report that opened
    // itself cannot be described as a region change the radiologist made.
    const automatic = opts?.regionChoice === "automatic";
    let pendingRegion: string | null = null;
    if (!automatic && fs.length === 1) {
      const resolved = resolveReportingRegionForFormat(fs[0]!, availableRegions);
      if (resolved.status === "resolved") {
        pendingRegion = resolved.region;
      }
      // ambiguous / unresolved → keep current region (fail safe, no silent pick)
    }
    const {
      findingsText, impressionText, recommendationText, techniqueText, fieldProvenance,
    } = get();
    const analysis = analyzeFormatOverwrite({
      technique: techniqueText,
      findings: findingsText,
      impression: impressionText,
      recommendation: recommendationText,
      fieldProvenance: {
        technique: fieldProvenance.technique,
        findings: fieldProvenance.findings,
        impression: fieldProvenance.impression,
        recommendation: fieldProvenance.recommendation,
      },
      currentRegion,
      resolvedRegion: pendingRegion,
    });
    if (analysis.requiresConfirmation) {
      set({
        confirmOverwriteOpen: true,
        pendingFormatIds: ids,
        pendingFormatOverwrite: analysis,
        pendingFormatRegion: pendingRegion,
        pendingPathologyPatch: null,
      });
      return;
    }
    set({ pendingFormatIds: ids, pendingFormatOverwrite: analysis, pendingFormatRegion: pendingRegion });
    get().confirmOverwriteAndApply();
  },
  applyFormatById: (id, opts) => {
    if (get().isFinalized) return;
    set({ selectedFormatIds: [id] });
    get().applySelectedFormats(opts);
  },
  generateProfessionalReport: (ctx) => {
    // The whole report from one press, with no model in the loop. Every string it
    // writes is one the clinic or the radiologist already supplied: the approved
    // Full Normal Format for this examination, the observations in the ledger, the
    // canal AP numbers recorded for this study, and the Impression those
    // observations imply. Nothing is composed here, and an examination whose
    // identity or normal format cannot be resolved is refused with a reason rather
    // than filled with a guess.
    if (refuseSignedMutation(get(), "generateProfessionalReport")) {
      return {
        status: "refused",
        code: "signed",
        reason: "This report is signed. Withdraw it before regenerating.",
      };
    }
    // A confirmation already on screen is CARE asking the radiologist about a
    // write it has not answered. Generating underneath it would answer for them.
    if (get().confirmOverwriteOpen || get().pendingPathologyPatch || get().mergePreviewOpen) {
      return {
        status: "refused",
        code: "confirmation-open",
        reason: "Answer the confirmation already on screen first.",
      };
    }
    // ADR-004, PR E PRIORITY 1 — the region a reloaded report is READ as is the booked one,
    // because the override is session state and only the transition record survives the draft.
    // Generating from that region would merge the booked examination's normals back over the
    // report the radiologist narrowed: measured as 10 retired dorsal/lumbar normal sentences
    // returning to a 6-line cervical-only report on one press. The recorded decision outranks
    // an unconfirmed region reading; an explicit region choice clears it (see the predicate).
    const regionConflict = regionIdentityConflictMessage({
      source: ctx.source,
      regions: ctx.regions.length ? ctx.regions : [ctx.region],
      records: get().regionTransitions,
    });
    if (regionConflict) {
      return { status: "refused", code: "region-transition", reason: regionConflict };
    }
    if (get().reportFormats.length === 0) {
      return {
        status: "refused",
        code: "library-loading",
        reason: "Report formats are still loading. Try again in a moment.",
      };
    }
    const decision = resolveNormalBootstrapFormat({
      ctx,
      formats: get().reportFormats,
      // A recorded region move is part of this study's identity, so the format
      // chosen here is capped by it — the same provenance Generate already honours.
      records: get().regionTransitions,
    });
    if (!decision) {
      return {
        status: "refused",
        code: "identity-unresolved",
        reason: "This examination is not identified yet. Set the study region, then generate again.",
      };
    }
    if (decision.status !== "apply") {
      const message = quickNormalOutcomeMessage(decision);
      return {
        status: "refused",
        code: decision.status === "ambiguous" ? "ambiguous" : "no-normal-format",
        reason: `${message.title} — ${message.description}`,
      };
    }

    const format = decision.format;
    const clinical = clinicalFieldsFromFormat(format);
    const undoSnap = captureClinicalSnapshot(get());
    const findingsBefore = get().findingsText;
    const patchCountBefore = get().appliedPathologyPatches.length;
    const flaggedBefore = get().impressionNeedsRefresh;
    // Read before anything is written: these are the statements the report must
    // still make when the action finishes.
    const retained = radiologistObservations(get().appliedPathologyPatches);
    const freeTextBefore = unexplainedFindingLines(findingsBefore, get().appliedPathologyPatches);
    // Does this examination deviate from its approved normal? Decided once, from
    // what is on the page before the press, because it answers two separate
    // questions below: whether the format's own conclusion may be used at all,
    // and whether the conclusion has to be re-derived.
    const deviates = reportHasDeviation(get().appliedPathologyPatches, freeTextBefore);
    // Which disc levels has the radiologist described in their own words? Those
    // are the levels the scaffold must stop describing for it: typing
    // "C5-C6: Disc herniation with cord compression." and pressing Generate used
    // to write the approved normal underneath it, including "C5-C6: No significant
    // disc bulge or protrusion is seen." — one report, both statements, nothing on
    // the page to say which the examination showed.
    const contradictedLevels = levelsContradictedByUnexplainedLines(freeTextBefore);
    const supersededNormalSentences = supersededBaselineTexts(
      format.baselineManifest?.observations ?? [],
      contradictedLevels,
    );
    /** True for a scaffold sentence this examination has already contradicted. */
    const supersededNormal = (line: string) => supersededNormalSentences.has(line.trim());

    // The scaffold is merged in, never dropped on top of the report. An identical
    // sentence is not written twice, and no sentence the format does not contain
    // is removed — so pressing this on a study that already has dictated text
    // cannot lose it, and pressing it twice changes nothing the second time.
    //
    // One exception, and it is bounded by provenance rather than by text: the setup half of
    // Start Report runs before this and writes the Study Tab's or protocol's own acquisition
    // sentence, so on a study that started with an empty Technique box the approved statement
    // would merge beside a machine claim nobody authored — measured as three printed accounts
    // of one whole-spine screening examination. Machine-authored technique is replaced by what
    // this examination's format actually establishes; anything a person typed, dictated or
    // accepted stays on the page and the approved sentence joins it.
    if (clinical.technique.trim() && !alreadySaysThis(get().techniqueText, clinical.technique)) {
      const regionCount = (ctx.regions && ctx.regions.length ? ctx.regions : [ctx.region]).length;
      const replacesMachineText = mayReplaceMachineTechniqueWithApproved({
        techniqueText: get().techniqueText,
        provenance: get().fieldProvenance.technique,
        regionCount,
      });
      if (replacesMachineText) {
        get().setField("technique", clinical.technique, { source: "template", replaceProvenance: true });
      } else {
        get().mergeField("technique", clinical.technique, "template");
      }
    }
    if (clinical.findings.trim() && !alreadySaysThis(get().findingsText, clinical.findings)) {
      // Written without the superseded levels rather than written and deleted: a
      // sentence removed from a block leaves the blank line it sat on, and the
      // second press would then differ from the first by whitespace nobody chose.
      const findingsToMerge = supersededNormalSentences.size === 0
        ? clinical.findings
        : clinical.findings.split("\n").filter((line) => !supersededNormal(line)).join("\n");
      if (findingsToMerge.trim()) get().mergeField("findings", findingsToMerge, "template");
    }
    // A format's Impression is the clinic's sentence for THIS EXAMINATION BEING
    // NORMAL. Merging it underneath a recorded abnormality produces a conclusion
    // that asserts both — measured on the shipped Brain format: "Normal MRI of
    // the brain. No acute intracranial abnormality." arriving immediately above
    // "Acute infarct in the left MCA territory." A deviating report's conclusion
    // is derived from its own findings below, not borrowed from a normal one.
    if (!deviates && clinical.impression.trim()
      && !alreadySaysThis(get().impressionText, clinical.impression)) {
      get().mergeField("impression", clinical.impression, "template");
    }
    if (clinical.recommendation.trim() && !alreadySaysThis(get().recommendationText, clinical.recommendation)) {
      get().mergeField("recommendation", clinical.recommendation, "template");
    }

    // Record which sentences the scaffold owns. Without these ledger rows an
    // abnormality recorded later sits beside the normal it contradicts instead of
    // taking its place. Idempotent by patch id, so a second press adds nothing.
    const baselineRegion = get().reportingContext.region || format.bodyPart || "";
    const knownIds = new Set(get().appliedPathologyPatches.map((p) => p.id));
    const baselinePatches = materializeFormatBaseline(format, baselineRegion)
      .filter((p) => !knownIds.has(p.id))
      .map((p) => ({
        id: p.id,
        ownership: ownershipFromObservation(p.observation),
        templates: p.templates,
        lastRendered: p.lastRendered,
        source: p.source,
        observation: p.observation,
        replacedBaseline: p.replacedBaseline,
        protected: p.protected,
        // No `stale` here on purpose. The row below this one is the only place
        // that decides a normal has been superseded, and a second mechanism
        // reaching the same label from a different condition makes each of them
        // invisible to a test — a mutation of either half then passes, because
        // the other half still marks the row.
      }));
    if (baselinePatches.length > 0) {
      set({ appliedPathologyPatches: [...get().appliedPathologyPatches, ...baselinePatches] });
    }

    // Each observation reclaims the slot it owns. Same id, so its measurements and
    // key-image evidence stay attached, and one undo frame for the whole press
    // rather than one per finding.
    let needingReview = 0;
    for (const input of retained) {
      const outcome = get().applyPathologyOverlay({ ...input, skipUndoSnapshot: true });
      if (outcome !== "applied") needingReview += 1;
    }

    // The case the merge above cannot reach: a normal that is ALREADY on the page,
    // written by an earlier press before this level was described. Its text goes
    // through the ledger's own removal, so a sentence the radiologist protected
    // stays where they put it, and the row is marked superseded rather than
    // deleted — one undo frame still takes the whole press back.
    if (contradictedLevels.size > 0) {
      const targets = get().appliedPathologyPatches.filter((p) => {
        if (p.observation?.role !== "baseline" || p.stale) return false;
        const key = rowLevelKey(p.observation.level);
        return key !== "" && contradictedLevels.has(key);
      });
      if (targets.length > 0) {
        let narrative = narrativeFromState(get());
        let provenance = get().fieldProvenance;
        for (const p of targets) {
          const removed = removeLedgerObservation(narrative, provenance, toLedgerPatch(p));
          narrative = removed.narrative;
          provenance = removed.provenance;
        }
        const ids = new Set(targets.map((p) => p.id));
        set({
          clinicalHistoryText: narrative.clinicalHistory,
          techniqueText: narrative.technique,
          findingsText: narrative.findings,
          impressionText: narrative.impression,
          recommendationText: narrative.recommendation,
          fieldProvenance: provenance,
          appliedPathologyPatches: get().appliedPathologyPatches.map((p) =>
            ids.has(p.id) ? { ...p, stale: true } : p,
          ),
          isDirty: true,
        });
      }
    }

    const segment = resolveActiveCanalSegment({
      spineSegment: get().reportingContext.spineSegment,
      regionHint: get().reportingContext.region,
      reportingRegion: get().reportingContext.region,
      studyDescription: ctx.studyDescription,
      regions: ctx.regions,
      forceDorsal: get().dorsalCanalForced,
    });
    const measurementTable = canalApReportTable(get().canalApProvenance, segment);
    const measurementTableIncluded = Boolean(measurementTable);
    if (measurementTableIncluded && !alreadySaysThis(get().findingsText, measurementTable)) {
      get().mergeField("findings", measurementTable, "companion");
    }

    // Re-derive the Impression — only over a report that deviates from its
    // approved normal, and only when this press (or the radiologist before it)
    // actually changed something.
    //  - A complete normal has nothing to derive: the format's own Impression is
    //    the clinic-approved conclusion, and deriving over it restates the
    //    Findings body. That is the duplicated conclusion section this milestone
    //    forbids, and it is why `deviates` is the gate rather than "always".
    //  - `refreshImpressionFromLedger` writes unconditionally and sets the dirty
    //    flag even when the text comes back identical, so a press that changed
    //    nothing must not call it. `flaggedBefore` is the case the press itself
    //    cannot see: an abnormality typed after the format was already applied,
    //    where the Findings and the ledger both stay exactly as they are.
    const changed = get().findingsText !== findingsBefore
      || get().appliedPathologyPatches.length !== patchCountBefore;
    if (deviates && (changed || flaggedBefore)) {
      get().refreshImpressionFromLedger({ excludeBaselineObservations: true });
    }
    get().orderImpressionByPriority();

    set({
      ...withPushedClinicalUndo(get(), undoSnap),
      appliedFormatReportTitle: clinical.reportTitle || null,
      appliedFormatName: format.name || null,
      startingCanvasBaseline: {
        formatName: format.name || "",
        formatRevision: format.baselineManifest?.revision ?? reportFormatRevision(format),
        findings: get().findingsText,
        impression: get().impressionText,
        appliedAt: new Date().toISOString(),
      },
      // No `isDirty` here on purpose. Every write this action can make goes through
      // mergeField or applyPathologyOverlay, and each one sets the flag itself. A
      // second, unconditional `isDirty: true` would mark a report dirty that had
      // nothing change — which is exactly what pressing this twice does.
    });
    getFormatApplyBridge()?.invalidatePendingAutosave?.();
    void bumpReportFormatUsage(format.id);
    get().pushNotification({
      kind: "ledger",
      text: needingReview > 0
        ? `Professional report built from “${format.name}”. ${needingReview} finding(s) need your review.`
        : `Professional report built from “${format.name}”.`,
    });
    return {
      status: "generated",
      formatName: format.name || "",
      baselineConcepts: baselinePatches.length,
      observationsRetained: retained.length,
      observationsNeedingReview: needingReview,
      measurementTableIncluded,
    };
  },
  toggleFormatFavorite: (id) => {
    const nf = get().reportFormats.map((x: ReportFormat) => x.id === id ? { ...x, favorite: !x.favorite, updatedAt: new Date().toISOString() } : x);
    saveFormats(nf);
    set({ reportFormats: nf });
  },
  confirmOverwriteAndApply: () => {
    // Hoisted above BOTH branches. The format branch already refused on a signed
    // study, but the `pendingPathologyPatch` branch returned before that check ran,
    // so a same-slot overwrite dialog armed before signing still called
    // undoLastPatch + applyPathologyOverlay after it. A ratchet that only asks
    // whether the method mentions the guard cannot see that.
    //
    // The dialog is still dismissed: a modal that cannot be closed on a signed
    // report is worse than one that closes having done nothing.
    if (refuseSignedMutation(get(), "confirmOverwriteAndApply")) {
      set({
        confirmOverwriteOpen: false,
        pendingFormatIds: [],
        pendingFormatOverwrite: null,
        pendingFormatRegion: null,
        pendingPathologyPatch: null,
      });
      return;
    }
    const pendingPatch = get().pendingPathologyPatch;
    if (pendingPatch) {
      const vacatedId = (pendingPatch.vacatedObservationId ?? "").trim() || null;
      const survivorId = (pendingPatch.id ?? "").trim() || null;
      get().undoLastPatch();
      get().applyPathologyOverlay({ ...pendingPatch, force: true });
      if (vacatedId && survivorId && vacatedId !== survivorId) {
        const stillVacated = get().appliedPathologyPatches.some((p) => p.id === vacatedId);
        if (stillVacated) {
          get().removeObservation(vacatedId, { remapEvidenceTo: survivorId });
        }
      }
      set({ confirmOverwriteOpen: false, pendingPathologyPatch: null });
      return;
    }
    const ids = get().pendingFormatIds.length ? get().pendingFormatIds : get().selectedFormatIds;
    const fs = get().reportFormats.filter((f: ReportFormat) => ids.includes(f.id));
    const pendingRegion = get().pendingFormatRegion;
    if (!fs.length) {
      set({
        confirmOverwriteOpen: false,
        pendingFormatIds: [],
        pendingFormatOverwrite: null,
        pendingFormatRegion: null,
      });
      return;
    }
    if (fs.length === 1) {
      const f = fs[0]!;
      const clinical = clinicalFieldsFromFormat(f);
      const formatSnapshot = captureClinicalSnapshot(get());
      // Content first, then region — format technique wins over region protocol sync.
      get().setField("technique", clinical.technique, { source: "template", replaceProvenance: true });
      get().setField("findings", clinical.findings, { source: "template", replaceProvenance: true });
      get().setField("impression", clinical.impression, { source: "template", replaceProvenance: true });
      get().setField("recommendation", clinical.recommendation, { source: "template", replaceProvenance: true });
      if (clinical.clinicalHistory.trim()) {
        // Patient/worklist/manual Hx wins: merge format phrase (no duplicate), never replace.
        const cur = get().clinicalHistoryText;
        const phrase = clinical.clinicalHistory.trim();
        if (!cur.trim()) {
          get().setField("clinicalHistory", phrase, { source: "template", replaceProvenance: true });
        } else {
          const merged = appendClinicalPhrase(cur, phrase);
          if (merged !== cur) {
            get().setField("clinicalHistory", merged, { source: "template" });
          }
        }
      }
      const nf = get().reportFormats.map((x: ReportFormat) => x.id === f.id ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x);
      saveFormats(nf);
      // A full report establishes a new baseline. Keep prior non-baseline
      // observations as stale audit context, then materialize only explicitly
      // curated baseline slots. Legacy prose formats safely produce no patches.
      const stalePatches = get().appliedPathologyPatches
        .filter((p) => p.observation?.role !== "baseline" && !isSystemNormalPatch(p))
        .map((p) => ({ ...p, stale: true as const }));
      const baselineRegion = pendingRegion || get().reportingContext.region || f.bodyPart;
      const baselinePatches = materializeFormatBaseline(f, baselineRegion).map((p) => ({
        id: p.id,
        ownership: ownershipFromObservation(p.observation),
        templates: p.templates,
        lastRendered: p.lastRendered,
        source: p.source,
        observation: p.observation,
        replacedBaseline: p.replacedBaseline,
        protected: p.protected,
      }));
      set({
        reportFormats: nf,
        confirmOverwriteOpen: false,
        pendingFormatIds: [],
        pendingFormatOverwrite: null,
        pendingFormatRegion: null,
        reportFormatPickerOpen: false,
        appliedPathologyPatches: [...stalePatches, ...baselinePatches],
        ...withPushedClinicalUndo(get(), formatSnapshot),
        appliedFormatReportTitle: clinical.reportTitle || null,
        appliedFormatName: f.name || null,
        startingCanvasBaseline: {
          formatName: f.name || "",
          formatRevision: f.baselineManifest?.revision ?? reportFormatRevision(f),
          findings: clinical.findings,
          impression: clinical.impression,
          appliedAt: new Date().toISOString(),
        },
      });
      // Reporting context only — never mutate DICOM / ERP identity fields.
      if (pendingRegion) {
        getFormatApplyBridge()?.applyReportingRegion(pendingRegion);
      }
      getFormatApplyBridge()?.invalidatePendingAutosave?.();
      get().pushNotification({
        kind: "ledger",
        text: baselinePatches.length > 0
          ? `Full normal report applied with ${baselinePatches.length} owned baseline concepts.`
          : "Full report applied as legacy narrative. Prior structured contributions marked stale for review.",
      });
      void bumpReportFormatUsage(f.id);
      return;
    }
    const [a, b] = fs;
    const r = mergeTwoFormats(a!, b!);
    set({
      lastMergeResult: r,
      lastMergeFormats: { a: a!, b: b! },
      mergePreviewOpen: true,
      abnormalPatternConfirm: null,
      confirmOverwriteOpen: false,
      pendingFormatIds: [],
      pendingFormatOverwrite: null,
      pendingFormatRegion: null,
    });
  },
  cancelOverwrite: () => {
    const pendingPatch = get().pendingPathologyPatch;
    // The pendingPatch branch is not a plain dismiss: it runs undoLastPatch and
    // then re-inserts the vacated chip, which is a clinical write. On a signed
    // report that is refused and control falls through to the shared clear below,
    // so the dialog still closes — a modal that cannot be dismissed is worse than
    // one that dismisses having changed nothing.
    if (pendingPatch && !refuseSignedMutation(get(), "cancelOverwrite")) {
      get().undoLastPatch();
      const patchId = pendingPatch.id || `pending_${Date.now().toString(36)}`;
      const vacatedId = (pendingPatch.vacatedObservationId ?? "").trim();
      // Same-slot update: undo restored the vacated sibling. Do not re-insert the
      // incoming survivor id (that would leave mild text under a moderate chip).
      if (!vacatedId) {
        // Legacy QS ambiguous path: keep the chip selected but blocked from narrative.
        const restoredIncoming = get().appliedPathologyPatches.some((p) => p.id === patchId);
        if (!restoredIncoming) {
          const observation = observationFromPending(pendingPatch, get().reportingContext.region, get().activeAnchor, get().studyComposition);
          const templates = pendingPatch.templates ?? pendingPatch.incoming;
          set({
            appliedPathologyPatches: [
              ...get().appliedPathologyPatches.filter((p) => p.id !== patchId),
              {
                id: patchId,
                ownership: pendingPatch.ownership,
                templates,
                lastRendered: pendingPatch.incoming,
                source: pendingPatch.source,
                observation: { ...observation, id: patchId },
                replacedBaseline: { findings: [], impression: [] },
                protected: false,
              },
            ],
          });
        }
      }
      set({
        confirmOverwriteOpen: false,
        pendingPathologyPatch: null,
      });
      return;
    }
    // Cancel preserves current region and report body (no apply).
    set({
      confirmOverwriteOpen: false,
      pendingFormatIds: [],
      pendingFormatOverwrite: null,
      pendingFormatRegion: null,
      pendingPathologyPatch: null,
    });
  },
  setLinkedStudies: (primary, linked, opts) => {
    // Two callers, and only one of them is refused. The one that must stop is the
    // same-session Link Study control in WorkspaceOverlays, whose
    // `ensureSectionedFindings` would rewrite a signed report's Findings. The
    // other is the draft restore in useDraftPersistence, which is not caught:
    // that effect runs once per studyId and is declared after the study-switch
    // effect that spreads emptyClinicalState, so isFinalized is already false by
    // the time reopening a signed study reaches here.
    if (refuseSignedMutation(get(), "setLinkedStudies")) return;
    if (!primary?.studyId || !linked?.studyId || primary.studyId === linked.studyId) return;
    const findingsText = ensureSectionedFindings(get().findingsText, primary, linked);
    const active = get().activeFindingsSectionId;
    const activeOk = active === primary.studyId || active === linked.studyId;
    set({
      primaryFindingsSection: primary,
      linkedStudy: linked,
      activeFindingsSectionId: activeOk ? active : primary.studyId,
      findingsText,
      isDirty: opts?.markDirty === false ? get().isDirty : true,
    });
  },
  clearLinkedStudy: () => {
    // Unlinking flattens the two sectioned Findings back into one body, which is a
    // rewrite of signed prose even though nothing is added or removed clinically.
    if (refuseSignedMutation(get(), "clearLinkedStudy")) return;
    const primary = get().primaryFindingsSection;
    const linked = get().linkedStudy;
    const findingsText = primary && linked
      ? flattenSectionedFindings(get().findingsText, [primary, linked])
      : get().findingsText;
    set({
      primaryFindingsSection: null,
      linkedStudy: null,
      activeFindingsSectionId: null,
      findingsText,
      isDirty: true,
    });
  },
  setActiveFindingsSection: (studyId) => {
    const primary = get().primaryFindingsSection;
    const linked = get().linkedStudy;
    if (!studyId || !primary || !linked) {
      set({ activeFindingsSectionId: null });
      return;
    }
    if (studyId !== primary.studyId && studyId !== linked.studyId) return;
    if (get().activeFindingsSectionId === studyId) return;
    set({ activeFindingsSectionId: studyId });
  },
  applyPathologyOverlay: (opts) => {
    // Was a one-off `if (get().isFinalized)`, which left the highest-traffic
    // control in the workspace refusing with no trace at all: QuickSelectStrip
    // has no `disabled` prop — its five are field, bodyPart, compact,
    // anatomyFilter, onAfterPick — and ReportCanvas.tsx:1602 hands
    // `disabled={contentLocked}` to the sibling rendered directly above it, not
    // to the strip, so a findings or impression tile stays clickable on a signed
    // study. `onPick` then runs `incUsage` and `onAfterPick` either way, and
    // feedbackAfterAbnormalApply highlights the most recent pre-existing patch —
    // positive feedback for a write that was refused.
    //
    // Used to return "applied" here, which is a refusal reporting success. The
    // comment that deferred it said widening was "a behaviour change that belongs
    // in its own PR" — this is that PR. Measured propagation, so the claim is not
    // left as prose: two internal callers branch on `=== "pending"` and are
    // self-guarded at their own entry (`applyMacroBundle`, `applyMultiLevelSpine`
    // both refuse before the loop), so their inner call can never reach this
    // return; one branches on `=== "applied"` and now correctly stops firing on a
    // refusal; one re-exports the union through `applyComposerFinding`, whose
    // single live consumer reads it. All nine external call sites discard it.
    if (refuseSignedMutation(get(), "applyPathologyOverlay")) return "refused";

    const templates = opts.templates ?? opts.incoming;
    const draftId = opts.id ?? `patch_${Date.now().toString(36)}`;
    let observation = observationFromPending(
      { ...opts, id: draftId },
      get().reportingContext.region,
      get().activeAnchor,
      get().studyComposition,
    );
    // The values the substitution path below can actually resolve. `side` was
    // already gated on the observation declaring laterality; `severity` is new
    // and gated further to the Quick Select sources, so the structured-format and
    // macro surfaces keep getting exactly the two-argument behaviour they were
    // written against (they fill `{level}` / `{value}` themselves, upstream).
    const sideForWrite: Side | "" = observation.supportsLaterality ? (opts.side ?? "") : "";
    const severityForWrite = isQuickSelectSource(opts.source)
      ? resolvedQuickSelectSeverity(opts.severity)
      : "";

    // B-09 — a Quick Select tile may write a resolved clinical statement, or it
    // may write nothing.
    //
    // Ten shipped tiles carry `{side}` in their sentence and one carries
    // `{severity}`. The strip had a substitution path (`applySideToIncoming`) but
    // never passed a value through it, so `applySideToIncoming` hit its
    // `if (!side) return incoming` guard and the template reached the page as
    // authored: Findings "Restricted diffusion in the {side} MCA territory…",
    // Impression "Acute {side} MCA territory infarct.", the same braces in the
    // ledger's rendered copy — on three `category: "critical"` tiles — and the
    // click still returned "applied", so usage counted, feedback fired and a
    // silent draft save followed.
    //
    // Refusing here, before the first write, is the only honest option at this
    // boundary. Deleting the token is what `fillTemplate` already does to an
    // unfilled `{severity}` and produces a fluent, unfounded sentence; replacing
    // it with "unspecified" invents a finding; defaulting to "left" is exactly the
    // guess the contract forbids. Nothing below this line runs on a refusal, so
    // the system-normal yield, the same-slot plan, the ledger row, the prose, the
    // provenance, the undo frame and the dirty flag all stay untouched — and a
    // tile that resolved both parameters applies exactly as it did before.
    if (isQuickSelectSource(opts.source)) {
      const unresolved = unresolvedQuickSelectParameters(
        templates,
        { side: sideForWrite, severity: severityForWrite },
      );
      if (unresolved.length > 0) {
        console.warn(
          `[care] applyPathologyOverlay refused: "${opts.label ?? opts.id}" needs ${unresolved.join(", ")}`,
        );
        announceQuickSelectParameterRefusal(unresolved);
        return "refused";
      }
    }

    const incoming = applySideToIncoming(templates, sideForWrite, severityForWrite);

    // PR #662 §2 — System normal auto-yield.
    //
    // When the incoming observation is impression-worthy abnormal (i.e. it
    // carries an impression contribution and its concept is marked
    // impression-worthy in the content packs), the system-owned normal
    // impression patch yields BEFORE the overlay runs. We use the standard
    // removeLedgerObservation path — it strips the system patch's
    // lastRendered.impression from impressionText AND cleans up provenance
    // in one atomic operation. No regex / NLP. Manual / protected
    // impression text is NEVER touched — the system normal patch is the
    // only contribution that auto-yields.
    //
    // This decision is based on the incoming patch's CONCEPT (identity),
    // NOT on string matching of impressionText.
    if (
      isImpressionworthyAbnormal(observation.concept, { role: observation.role })
      && (incoming.impression ?? "").trim()
      && opts.source !== "system"
    ) {
      const systemNormal = findSystemNormalPatch(get().appliedPathologyPatches);
      if (systemNormal) {
        const yieldResult = removeLedgerObservation(
          narrativeFromState(get()),
          get().fieldProvenance,
          toLedgerPatch(systemNormal),
        );
        // Preserve the system-owned patch in a suspended state so removing
        // the final abnormal can restore the exact format impression rather
        // than inventing a generic replacement. Protected/manual text never
        // yields and therefore never enters the suspended state.
        if (yieldResult.outcome === "removed") {
          set({
            impressionText: yieldResult.narrative.impression,
            findingsText: yieldResult.narrative.findings,
            recommendationText: yieldResult.narrative.recommendation,
            techniqueText: yieldResult.narrative.technique,
            clinicalHistoryText: yieldResult.narrative.clinicalHistory,
            fieldProvenance: yieldResult.provenance,
            appliedPathologyPatches: get().appliedPathologyPatches.map((p) =>
              p.id === SYSTEM_NORMAL_PATCH_ID
                ? { ...p, lastRendered: { ...p.lastRendered, impression: "" } }
                : p,
            ),
          });
        }
      }
    }

    // Same-slot plan — CARE mutex identity. Incoming id is the survivor so Quick
    // Select selection / deselect-by-tile stay correct; evidence remaps onto it.
    const slotSiblings = findSameSlotSiblings(
      get().appliedPathologyPatches.filter((p) => p.id !== draftId && !p.stale),
      observation,
    );
    const contributionIsManual = Boolean(
      slotSiblings.some((s) => s.protected)
      || slotSiblings.some((s) =>
        contributionProtected(s.lastRendered.findings, get().fieldProvenance.findings)
        || contributionProtected(s.lastRendered.impression, get().fieldProvenance.impression)),
    );
    const plan = planSameSlotReplacement({
      incoming: observation,
      incomingFindings: incoming.findings,
      incomingImpression: incoming.impression,
      siblings: slotSiblings,
      contributionIsManual,
      force: opts.force,
    });

    if (plan.action === "noop") {
      // Exact re-click: focus existing observation, no duplicate row.
      set({ selectedObservationId: plan.existingId });
      return "applied";
    }

    const vacatedId = plan.action === "update" ? plan.existingId : null;
    const stableId = draftId;
    if (plan.action === "update") {
      // Keep anchor / createdAt / measurement string from vacated sibling; use incoming id.
      observation = {
        ...mergeObservationInPlace(plan.existing.observation, {
          ...observation,
          id: stableId,
        }),
        id: stableId,
      };
      // An explicitly materialized Full Normal baseline owns its exact atomic
      // contribution. Carry that contract into the incoming abnormal so the
      // existing overlay removes the baseline without heuristic text search.
      if (plan.existing.observation.role === "baseline") {
        observation = {
          ...observation,
          baselineReplaces:
            plan.existing.lastRendered.findings
            || plan.existing.lastRendered.impression
            || observation.baselineReplaces,
          role: "finding",
        };
      }
    } else {
      observation = { ...observation, id: stableId };
    }
    const ownership = ownershipFromObservation(observation);

    const snap = captureClinicalSnapshot(get());

    const dropIds = new Set<string>([stableId]);
    if (plan.action === "update") {
      dropIds.add(plan.existingId);
      for (const id of plan.supersededIds) dropIds.add(id);
    } else {
      // Unstructured / no sibling: keep prior mutex drop for callers that
      // still pass matching conflictGroup without a resolved concept — rare.
      for (const p of get().appliedPathologyPatches) {
        if (p.id === stableId) continue;
        const other = toLedgerPatch(p).observation;
        if (observationsMutuallyExclusive(observation, other)) dropIds.add(p.id);
      }
    }

    const narrative = narrativeFromState(get());
    const provenance = get().fieldProvenance;
    const primarySection = get().primaryFindingsSection;
    const linkedSection = get().linkedStudy;
    const sectionList = primarySection && linkedSection ? [primarySection, linkedSection] : [];
    const routedSectionId = sectionList.length === 2
      ? routeChipToFindingsSection({
        sections: sectionList,
        activeSectionId: opts.findingsSectionId ?? get().activeFindingsSectionId,
        anatomicalSection: opts.ownership?.anatomicalSection,
        region: opts.region,
        studyType: opts.studyType,
      })
      : null;
    const sectionBefore = routedSectionId
      ? (findingsSectionBlocks(narrative.findings, sectionList).find((b) => b.studyId === routedSectionId)?.body ?? "")
      : "";
    const overlayNarrative = routedSectionId
      ? { ...narrative, findings: sectionBefore }
      : narrative;
    // Drop same-slot siblings from the ledger only. Do not pre-strip their
    // sentences — structured overlay owns replacement and records
    // replacedBaseline so deselect can restore a normal/baseline.
    // Incoming id is the survivor; remap measurements / key images onto it.
    let patches = get().appliedPathologyPatches.filter((p) => !dropIds.has(p.id));
    if (plan.action === "update" && plan.existing.observation.role === "baseline") {
      const baselinePatch = get().appliedPathologyPatches.find((p) => p.id === plan.existing.id);
      if (baselinePatch) {
        patches.push({
          ...baselinePatch,
          stale: true,
          lastRendered: {
            ...baselinePatch.lastRendered,
            findings: "",
            impression: "",
          },
        });
      }
    }

    let nextMeasurements = get().structuredViewerMeasurements;
    if (vacatedId && vacatedId !== stableId) {
      const remapped = remapStructuredMeasurementsObservationId(
        nextMeasurements,
        vacatedId,
        stableId,
      );
      nextMeasurements = remapped.state;
      if (typeof window !== "undefined" && remapped.remapped > 0) {
        window.dispatchEvent(new CustomEvent("care:observation-reassigned", {
          detail: { fromObservationId: vacatedId, toObservationId: stableId },
        }));
      }
    }

    const needsSlotConfirm = plan.action === "update" && plan.requiresConfirmation && !opts.force;

    const result = overlayPathology({
      existing: overlayNarrative,
      incoming,
      ownership,
      provenance,
      source: opts.source,
      force: opts.force || (plan.action === "update" && !needsSlotConfirm),
    });
    if (routedSectionId) {
      const sectionAfter = result.narrative.findings;
      result.narrative.findings = replaceFindingsSectionBody(
        narrative.findings,
        sectionList,
        routedSectionId,
        sectionAfter,
      );
      result.provenance = {
        ...result.provenance,
        findings: mergeScopedFindingsProvenance({
          previous: provenance.findings,
          sectionBefore,
          sectionAfter,
          sectionProvenance: result.provenance.findings,
        }),
      };
    }
    const replaced = splitReplacedByField(result.replacedSentences, narrative);
    const lastRendered: PathologyIncoming = {
      findings: renderedInField(incoming.findings, result.narrative.findings) || incoming.findings,
      impression: renderedInField(incoming.impression, result.narrative.impression) || incoming.impression,
      technique: renderedInField(incoming.technique, result.narrative.technique) || incoming.technique,
      recommendation: renderedInField(incoming.recommendation, result.narrative.recommendation) || incoming.recommendation,
    };
    const nextPatch: AppliedPathologyPatch = {
      id: stableId,
      ownership,
      templates,
      lastRendered,
      source: opts.source,
      observation: { ...observation, id: stableId },
      replacedBaseline: replaced,
      // Same-slot auto-update clears prior protected flag; confirm path may restore via undo.
      protected: false,
    };
    const nextPatches = [...patches.filter((p) => p.id !== stableId), nextPatch];
    const alignedRecommendation = alignRecommendationToObservations({
      current: result.narrative.recommendation,
      provenance: result.provenance.recommendation,
      patches: nextPatches,
    });
    if (alignedRecommendation.changed) {
      result.narrative.recommendation = alignedRecommendation.text;
      result.provenance.recommendation = alignedRecommendation.provenance;
    }
    const siblingHits = detectUnownedSiblingConflictsForLedger({
      findings: result.narrative.findings,
      patches: nextPatches.map(toLedgerPatch),
    });
    const ownershipReviewWarnings = siblingHits.map((w) => ({
      sentence: w.sentence,
      token: w.token,
      hint: UNOWNED_SIBLING_HINT,
    }));
    if ((result.ambiguous || needsSlotConfirm) && !opts.force) {
      set({
        clinicalHistoryText: result.narrative.clinicalHistory,
        techniqueText: result.narrative.technique,
        findingsText: result.narrative.findings,
        impressionText: result.narrative.impression,
        recommendationText: result.narrative.recommendation,
        fieldProvenance: result.provenance,
        isDirty: true,
        ...(opts.skipUndoSnapshot ? { lastPatchSnapshot: get().lastPatchSnapshot, patchUndoStack: get().patchUndoStack } : withPushedClinicalUndo(get(), snap)),
        appliedPathologyPatches: nextPatches,
        structuredViewerMeasurements: nextMeasurements,
        ownershipReviewWarnings,
        confirmOverwriteOpen: true,
        pendingPathologyPatch: {
          ...opts,
          incoming,
          templates,
          ownership,
          id: stableId,
          ...(vacatedId && vacatedId !== stableId ? { vacatedObservationId: vacatedId } : {}),
          // Same-slot confirm copy (consumed by ConfirmOverwriteDialog).
          ...(plan.action === "update"
            ? {
              level: observation.level || plan.existing.observation.level,
              concept: observation.concept,
              label: opts.label,
              findingsText: incoming.findings,
            }
            : {}),
        },
        selectedObservationId: stableId,
        ...(routedSectionId ? { activeFindingsSectionId: routedSectionId } : {}),
      });
      return "pending";
    }
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      findingsText: result.narrative.findings,
      impressionText: result.narrative.impression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: result.provenance,
      isDirty: true,
      ...(opts.skipUndoSnapshot ? { lastPatchSnapshot: get().lastPatchSnapshot, patchUndoStack: get().patchUndoStack } : withPushedClinicalUndo(get(), snap)),
      appliedPathologyPatches: nextPatches,
      structuredViewerMeasurements: nextMeasurements,
      ownershipReviewWarnings,
      selectedObservationId: stableId,
      ...(routedSectionId ? { activeFindingsSectionId: routedSectionId } : {}),
    });
    // A tile, a voice sentence or a structured row writes its finding AND its
    // conclusion in one action, so it owns both sides: the basis is re-recorded
    // here rather than compared, exactly as it was when this line simply cleared
    // the flag. What changes is that the clearing is now a derivation — a patch
    // whose own conclusion is missing from the new Impression, or an Impression
    // that calls the study normal over an asserted abnormality, still arms.
    //
    // The first half of that sentence only holds when the applied row HAS a
    // conclusion. A Quick Select row with its Impression participation switched
    // off, a dictation sentence that carries findings text only, and a structured
    // row contributing to Findings alone all write ONE side while claiming the
    // pair — which re-recorded the basis over a summary that never mentioned the
    // new finding, in the session and on every reload after it. Ownership is now
    // decided by what the row actually wrote, which is also what a hand-typed
    // finding does (setField/mergeField never rebase on a findings write).
    const appliedPatch = nextPatches.find((p) => p.id === stableId);
    const ownsImpressionSide = Boolean(
      (appliedPatch?.templates.impression ?? appliedPatch?.lastRendered.impression ?? "").trim(),
    );
    set(deriveImpressionDependency(get(), ownsImpressionSide ? { rebase: true } : undefined));
    return "applied";
  },
  applyMacroBundle: (opts) => {
    // Not a clinical writer: every prose and ledger write below goes through
    // applyPathologyOverlay, which already refused on a signed study before this
    // guard existed. Guarded anyway because the trailing
    // `set({ ...withPushedClinicalUndo(get(), snap), isDirty: true })` is a real
    // mutation of a signed study — it grows the clinical undo stack and marks the
    // report dirty. Autosave refuses while finalized, so neither could reach the
    // server, but a signed report that shows as dirty misstates its own state.
    if (refuseSignedMutation(get(), "applyMacroBundle")) return "blocked";
    const bundleId = opts.bundleId || `bundle_${Date.now().toString(36)}`;
    let status: "applied" | "pending" = "applied";
    const snap = captureClinicalSnapshot(get());
    for (const obs of opts.observations) {
      // Severity/level-block updates should reuse an existing same-slot id so QS
      // selection and linked measurements stay on the original observation.
      const fallbackId = obs.id ?? `${bundleId}-${obs.concept ?? obs.label ?? "obs"}`;
      const probe = observationFromPending(
        { ...obs, id: fallbackId, bundleId },
        get().reportingContext.region,
        get().activeAnchor,
        get().studyComposition,
      );
      const siblings = findSameSlotSiblings(
        get().appliedPathologyPatches.filter((p) => p.id !== fallbackId),
        probe,
      );
      // A format baseline is not one of those siblings. Adopting its id blinds the
      // overlay's own lookup, which filters `p.id !== draftId`: the row it was meant
      // to supersede disappears from view, the apply falls to the insert path, and
      // that path drops the baseline row without its prose contract — so the row
      // vanishes while its sentence keeps printing. Measured on MRI Whole Spine: one
      // click on Dorsal → Compression deformity left that region's normal printing
      // beside the new abnormality. Keeping the baseline's identity lets the update
      // path below retire it and record `baselineReplaces`.
      const id = siblings.find((s) => s.observation.role !== "baseline")?.id ?? fallbackId;
      const r = get().applyPathologyOverlay({ ...obs, bundleId, id, skipUndoSnapshot: true });
      if (r === "pending") status = "pending";
    }
    set({ ...withPushedClinicalUndo(get(), snap) });
    return status;
  },
  /**
   * PR #662 §3 — Fast per-level spine workflow.
   *
   * Apply multiple spine levels quickly. Each level is internally applied
   * via applyPathologyOverlay — there is NO second batch mutation engine.
   * Every resulting observation is independently owned, independently
   * removable, and preserves same-slot replacement / different-level
   * coexistence / laterality / manual protection / measurements / anchors
   * / undo semantics exactly as in single-level apply.
   *
   * The caller passes a bundleId (auto-generated if absent) plus an array
   * of level descriptors. Each descriptor carries:
   *   - level     (e.g. "L3-L4", "C5-C6")
   *   - concept   (canonical concept id; e.g. "disc_contour")
   *   - findingsText  (composed findings sentence for this level)
   *   - impressionText (optional; composed impression fragment)
   *   - laterality / severity (optional metadata)
   *
   * Returns "applied" if every level applied cleanly, "pending" if any
   * required user confirmation (e.g. protected same-slot confirmation).
   */
  applyMultiLevelSpine: (opts) => {
    // Same class as applyMacroBundle: delegates its writes to applyPathologyOverlay
    // and pushes an undo frame of its own.
    if (refuseSignedMutation(get(), "applyMultiLevelSpine")) return "blocked";
    const bundleId = opts.bundleId || `spine-bundle_${Date.now().toString(36)}`;
    let status: "applied" | "pending" = "applied";
    const snap = captureClinicalSnapshot(get());
    for (const entry of opts.levels) {
      if (!entry.level || !entry.concept || !entry.findingsText.trim()) continue;
      const id = `${bundleId}-${entry.concept}-${entry.level}`;
      const r = get().applyPathologyOverlay({
        incoming: {
          findings: entry.findingsText,
          impression: entry.impressionText,
        },
        templates: {
          findings: entry.findingsText,
          impression: entry.impressionText,
        },
        ownership: {
          concept: entry.concept,
          conflictGroup: entry.concept,
          anatomicalSection: "disc",
        },
        source: "structured-template",
        id,
        region: opts.region,
        concept: entry.concept,
        level: entry.level,
        laterality: entry.laterality,
        severity: entry.severity,
        label: `${entry.level} ${entry.concept}`,
        findingsText: entry.findingsText,
        bundleId,
        supportsLaterality: Boolean(entry.laterality),
        properties: entry.laterality ? "side" : undefined,
        skipUndoSnapshot: true,
      });
      if (r === "pending") status = "pending";
    }
    set({ ...withPushedClinicalUndo(get(), snap) });
    return status;
  },
  /**
   * Bundle deselect: remove only this bundle's observations that are
   * (a) not protected and (b) not superseded by a newer QS/voice observation
   * on the same slotKey. Overridden slots keep the overriding observation's
   * text and ownership; remaining bundle slots restore replacedBaseline,
   * same as individual removeObservation. Never auto-deletes manual text.
   */
  removeMacroBundle: (bundleId) => {
    // Same class as applyMacroBundle: its per-patch work goes through
    // removeObservation, which refuses, and what is left is the undo frame.
    if (refuseSignedMutation(get(), "removeMacroBundle")) return "blocked";
    const id = (bundleId ?? "").trim();
    if (!id) return "missing";
    const all = get().appliedPathologyPatches;
    const bundle = all.filter((p) => (p.observation?.bundleId ?? "") === id);
    if (bundle.length === 0) return "missing";
    const others = all.filter((p) => (p.observation?.bundleId ?? "") !== id);
    const snap = captureClinicalSnapshot(get());
    let anyRemoved = false;
    let anyPreserved = false;
    for (const patch of bundle) {
      if (patch.protected) {
        anyPreserved = true;
        continue;
      }
      const slot = patch.observation?.slotKey;
      const overridden = Boolean(slot && others.some((o) => {
        if (o.observation?.slotKey !== slot) return false;
        return o.source === "quick-select" || o.source === "quick-findings" || o.source === "radiologist-voice";
      }));
      if (overridden) continue;
      const outcome = get().removeObservation(patch.id);
      if (outcome === "preserved-manual") anyPreserved = true;
      if (outcome === "removed") anyRemoved = true;
    }
    set({ ...withPushedClinicalUndo(get(), snap), isDirty: true });
    if (anyPreserved && !anyRemoved) return "preserved-manual";
    if (anyRemoved) return "removed";
    return "no-op-unproven";
  },
  commitRegionTransition: (plan, decidedBy) => {
    if (refuseSignedMutation(get(), "commitRegionTransition")) return null;
    if (!plan.actionable || plan.retire.length === 0) return null;
    const snap = captureClinicalSnapshot(get());
    const removedIds = new Set<string>();
    for (const row of plan.retire) {
      // removeObservation owns the clinical semantics: it will NOT delete a line the
      // radiologist wrote themselves (it returns "preserved-manual"), and it restores the
      // baseline a retired row had been covering.
      const outcome = get().removeObservation(row.id, { skipUndoSnapshot: true });
      if (outcome === "removed") removedIds.add(row.id);
    }
    // Nothing actually left the report, so there is nothing to record. A row the
    // radiologist had rewritten by hand is refused by the withdrawal above, and its
    // surviving line is already counted in `manualLinesPreserved`; a record naming it would
    // claim a sentence was taken out while it sits on the page.
    if (removedIds.size === 0) return null;
    const full = plan.record({ decidedBy });
    const record: RegionTransitionRecord = {
      ...full,
      retired: full.retired.filter((r) => removedIds.has(r.id)),
    };
    set({
      regionTransitions: [...get().regionTransitions, record],
      ...withPushedClinicalUndo(get(), snap),
      isDirty: true,
    });
    return record;
  },
  hydrateRegionTransitions: (records) => {
    set({ regionTransitions: Array.isArray(records) ? records : [] });
  },
  syncScreeningLedger: (opts: { state: ScreeningState; changed: SpineScreeningRegion; ledgerRegion?: string }) => {
    const plan = screeningLedgerBundles({
      state: opts.state,
      schemas: SCREENING_SCHEMAS,
      sequences: get().sequencesAvailable,
      numbering: get().lumbarNumbering,
      ledgerRegion: opts.ledgerRegion ?? "LS Spine",
    });
    const planned = new Map(plan.map((b) => [b.bundleId, b] as const));
    const live = new Set<string>();
    get().appliedPathologyPatches.forEach((p) => {
      const b = p.observation?.bundleId;
      if (b && !p.stale) live.add(b);
    });
    const changedBundleId = screeningRegionBundleId(opts.changed);
    live.forEach((id) => {
      if ((id.startsWith(SCREENING_BUNDLE_PREFIX) && !planned.has(id)) || id === changedBundleId) {
        get().removeMacroBundle(id);
      }
    });
    // Then write the plan. Whether the region is ALREADY live is deliberately not
    // consulted here: the panel used to answer that from a snapshot taken before its
    // own removals, so a rebuilt region always looked still-present, the write was
    // skipped, and the radiologist's click deleted the sentence it was replacing and
    // wrote nothing. Measured in the workspace: the one-click normal's five dorsal
    // sentences collapsed to the 56-character limitation alone. Re-applying over a
    // bundle that is still live is idempotent — same-slot replacement recognises its
    // own rows — and a row the radiologist hand-edited is protected by that same
    // engine, which asks before overwriting it rather than silently dropping either
    // the edit or the click.
    for (const id of [changedBundleId, SCREENING_LIMITATION_BUNDLE_ID]) {
      const bundle = planned.get(id);
      if (bundle) get().applyMacroBundle({ bundleId: bundle.bundleId, observations: bundle.observations });
    }
  },
  refreshImpressionFromLedger: (opts?: { excludeBaselineObservations?: boolean }) => {
    // Six callers. Four are already gated: two handlers in useWorkspaceClinicalUi
    // open with `if (contentLocked) return`, ReportCanvas hands the warning strip
    // `disabled={contentLocked}`, and XrayLsSpineCanvas reaches it only
    // when applyMacroBundle returned "applied" — which is now "blocked" on a signed
    // study. The sign dialog's opener is disabled once signed too, but a dialog
    // left open across signing still reaches this, and so does the derived-
    // impression effect in useWorkspaceClinicalUi, which nothing gates at all.
    // Those two are what this refuses: a silent rewrite of a signed Impression.
    if (refuseSignedMutation(get(), "refreshImpressionFromLedger")) return;
    // `excludeBaselineObservations` is for a report that has already been judged
    // to deviate from its approved normal. The scaffold rows ARE the normal, and
    // their impression contributions — for the Brain format, "Normal MRI of the
    // brain. No acute intracranial abnormality." — would otherwise be collected
    // straight back into the conclusion of a study that has an infarct in it.
    // Callers that do not know yet keep the previous behaviour: the full ledger.
    const patches = get().appliedPathologyPatches
      .filter((p) => !opts?.excludeBaselineObservations
        || (p.observation?.role !== "baseline" && !isSystemNormalPatch(p)))
      .map(toLedgerPatch);
    // The picker reads the Findings text — and the Findings text holds the
    // scaffold's own sentences too. Excluding the baseline patches above and then
    // re-reading every sentence below let those same sentences back in through the
    // door the ledger had just closed: measured on a cervical study with one
    // hand-typed herniation, the Conclusion came back as six lines, five of them
    // the report's own per-level normals ("C2-C3: No exiting or traversing nerve
    // root compression is seen."). A sentence a ledger row already speaks for is
    // not a leftover; only what nobody owns is still waiting to be concluded.
    const remaining = generateLocalImpression(
      unexplainedFindingLines(get().findingsText, get().appliedPathologyPatches).join("\n"),
    );
    const next = refreshImpressionFromObservations({
      currentImpression: get().impressionText,
      patches,
      remainingAbnormalLines: remaining,
      provenance: get().fieldProvenance.impression,
    });
    const nextProv = { ...(get().fieldProvenance.impression ?? EMPTY_FIELD_PROVENANCE) };
    for (const s of next.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      const key = normalizeForDedupe(s);
      if (!key) continue;
      if (nextProv[key]?.includes("manual")) continue;
      const prev = nextProv[key] ?? [];
      nextProv[key] = prev.includes("quick-findings") ? prev : [...prev, "quick-findings"];
    }
    set({
      impressionText: next,
      fieldProvenance: { ...get().fieldProvenance, impression: nextProv },
      isDirty: true,
    });
    // The radiologist pressed "Refresh": the summary was regenerated from the
    // findings, so this is the paired write and the basis moves with it. Recorded
    // as a refresh rather than an authored write, because the dependency history
    // says who decided the summary was current.
    set(deriveImpressionDependency(get(), { rebase: true, recordedBy: "refresh" }));
  },
  markImpressionReviewed: () => {
    // "I have read it and it stands." The only way to clear a dependency the
    // radiologist has not rewritten, so it records who decided and against what —
    // and because the basis is the clinical content, not a timestamp, the same
    // pairing stays cleared after a reload instead of nagging on reopen.
    if (refuseSignedMutation(get(), "markImpressionReviewed")) return;
    set(deriveImpressionDependency(get(), { rebase: true, recordedBy: "review" }));
  },
  orderImpressionByPriority: (proposed) => {
    // A reorder is still a write: it replaces the signed Impression with a
    // permutation of itself. This action was invisible to the boundary ratchet
    // because its write is a single-line `set({ impressionText: … })`, which the
    // line-anchored pattern could not see.
    if (refuseSignedMutation(get(), "orderImpressionByPriority")) return false;
    if (get().impressionOrderFrozen) return false;
    const before = get().impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (before.length < 2) return false;
    // One sorter and one freeze rule for every study; only the clinical category
    // table changes for a dedicated Dorso-Lumbar examination (spec §26).
    const ordered = isDorsoLumbarDedicated(get().studyComposition)
      ? orderImpressionLines(before, { rankLine: rankDorsoLumbarImpressionLine })
      : orderImpressionLines(before, { spineSegment: get().reportingContext.spineSegment });
    const next = (proposed ?? ordered)
      .map((s) => s.trim())
      .filter(Boolean);
    if (before.join("\n") === next.join("\n")) return false;
    // A reorder may only ever permute. Anything else is a rewrite, and this action is
    // never allowed to reword a clinical statement (§18, §37).
    if (!isImpressionReorderOf(before, next)) return false;
    set({ impressionText: next.join("\n"), isDirty: true });
    return true;
  },
  seedSystemNormalImpression: () => {
    // Safety: never seed when impression-worthy abnormal observations exist.
    if (hasImpressionworthyAbnormal(get().appliedPathologyPatches)) return;
    // Safety: never seed when the radiologist has manually owned impression.
    if (impressionHasManualContribution(get().fieldProvenance.impression)) return;
    // Safety: never seed on a finalized study.
    if (get().isFinalized) return;
    const existing = findSystemNormalPatch(get().appliedPathologyPatches);
    if (existing?.lastRendered.impression?.trim()) return;
    // A full-format normal impression may be suspended while abnormalities
    // exist. Restore its exact owned contribution after the last one is
    // removed; do not degrade it to the generic "Normal study." string.
    if (existing?.templates.impression?.trim()) {
      const restored = mergeReportFieldContentWithProvenance({
        field: "impression",
        existing: get().impressionText,
        incoming: existing.templates.impression,
        source: "system",
        existingProvenance: get().fieldProvenance.impression ?? {},
      });
      const restoredText = get().impressionText.trim()
        ? restored.text
        : existing.templates.impression;
      set({
        impressionText: restoredText,
        fieldProvenance: { ...get().fieldProvenance, impression: restored.provenance },
        appliedPathologyPatches: get().appliedPathologyPatches.map((p) =>
          p.id === existing.id
            ? { ...p, lastRendered: { ...p.lastRendered, impression: existing.templates.impression } }
            : p,
        ),
        isDirty: true,
      });
      return;
    }
    const region = get().reportingContext.region ?? "*";
    const patch = buildSystemNormalPatch(region);
    // Write the canonical "Normal study." line into impressionText with
    // provenance source = "system". mergeReportFieldContentWithProvenance
    // is the canonical path for inserting a contribution into a report
    // field with provenance — same path used by every other producer.
    const result = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: get().impressionText,
      incoming: SYSTEM_NORMAL_IMPRESSION_TEXT,
      source: "system",
      existingProvenance: get().fieldProvenance.impression ?? {},
    });
    set({
      impressionText: result.text,
      fieldProvenance: { ...get().fieldProvenance, impression: result.provenance },
      appliedPathologyPatches: [...get().appliedPathologyPatches, patch],
      isDirty: true,
    });
  },
  withdrawSystemNormalImpression: () => {
    if (refuseSignedMutation(get(), "withdrawSystemNormalImpression")) return;
    const existing = findSystemNormalPatch(get().appliedPathologyPatches);
    if (!existing) return;
    // Use removeLedgerObservation for atomic narrative + provenance cleanup.
    // No regex / NLP — operates purely on patch identity.
    const result = removeLedgerObservation(
      narrativeFromState(get()),
      get().fieldProvenance,
      toLedgerPatch(existing),
    );
    set({
      impressionText: result.narrative.impression,
      findingsText: result.narrative.findings,
      recommendationText: result.narrative.recommendation,
      techniqueText: result.narrative.technique,
      clinicalHistoryText: result.narrative.clinicalHistory,
      fieldProvenance: result.provenance,
      appliedPathologyPatches: get().appliedPathologyPatches.filter((p) => p.id !== SYSTEM_NORMAL_PATCH_ID),
      isDirty: true,
    });
  },
  hydrateObservationLedger: (raw) => {
    const parsed = parseObservationLedger(raw);
    if (parsed.status === "absent") {
      set({ appliedPathologyPatches: [], ledgerHydrationWarning: null });
      return { ok: true, mode: "narrative-only", reason: "absent", patchCount: 0 };
    }
    if (parsed.status !== "restored") {
      const result: LedgerHydrationResult = {
        ok: false,
        mode: "narrative-only",
        reason: parsed.status,
        patchCount: 0,
        warning: "Observation ledger could not be restored. Report text is unchanged.",
      };
      logLedgerHydrationSafe(result);
      set({ appliedPathologyPatches: [], ledgerHydrationWarning: result.warning ?? null });
      return result;
    }
    const narrative = narrativeFromState(get());
    const hashes = extractRecordedHashes(raw);
    const reconciled = parsed.patches.map((p) => reconcilePatchAgainstNarrative(p, narrative, hashes.get(p.id)));
    const staleCount = reconciled.filter((p) => p.stale).length;
    const provenance = parsed.fieldProvenance ?? reconstructProvenanceFromLedger(narrative, reconciled);
    const warning = staleCount > 0
      ? "Some saved observations no longer match the report text. Narrative was not changed."
      : null;
    // The dependency link travels with the draft: the Findings the stored
    // Impression was written against are compared against the stored Findings, so
    // a report that was armed when it was saved is armed when it is opened. This
    // is the whole of D-1 — the ledger alone could not see a hand-typed sentence,
    // so a reload quietly un-armed it.
    const storedBasis = extractImpressionBasis(raw);
    const dependency = evaluateImpressionDependency({
      findings: narrative.findings,
      impression: narrative.impression,
      patches: reconciled,
      provenance: provenance.impression,
      basis: storedBasis,
    });
    set({
      appliedPathologyPatches: reconciled.map((p) => ({
        id: p.id,
        ownership: ownershipFromObservation(p.observation),
        templates: p.templates,
        lastRendered: p.lastRendered,
        source: p.source,
        observation: p.observation,
        replacedBaseline: p.replacedBaseline,
        protected: p.protected,
        stale: p.stale,
      })),
      fieldProvenance: {
        ...get().fieldProvenance,
        findings: provenance.findings ?? get().fieldProvenance.findings,
        impression: provenance.impression ?? get().fieldProvenance.impression,
        technique: provenance.technique ?? get().fieldProvenance.technique,
        recommendation: provenance.recommendation ?? get().fieldProvenance.recommendation,
        clinicalHistory: provenance.clinicalHistory ?? get().fieldProvenance.clinicalHistory,
      },
      ledgerHydrationWarning: warning,
      impressionNeedsRefresh: dependency.needsRefresh,
      impressionDependencyReasons: dependency.reasons,
      impressionBasis: storedBasis,
      ...(hydrateCoverageFromLedgerRaw(raw) ? { coverageMarks: hydrateCoverageFromLedgerRaw(raw)! } : {}),
    });
    return {
      ok: true,
      mode: "restored",
      reason: "restored",
      patchCount: reconciled.length,
      warning: warning ?? undefined,
    };
  },
  serializeObservationLedger: () => {
    const scope = coverageScopeKey(get().reportingContext.region);
    const byScope = { ...get().coverageByScope, [scope]: get().coverageMarks };
    return serializeObservationLedger(
      get().appliedPathologyPatches.map(toLedgerPatch),
      get().fieldProvenance,
      get().coverageMarks.length > 0
        ? serializeCoverageEnvelope(get().coverageMarks, { scopeKey: scope, byScope })
        : undefined,
      // The dependency link travels inside the envelope the draft already persists
      // verbatim, so save → close → reopen restores the same answer without a new
      // column and without touching the signed document's own hash.
      get().impressionBasis,
    );
  },
  setActiveAnchor: (anchor) => {
    if (anchorsEqual(get().activeAnchor, anchor)) return;
    const expected = get().activeStudyInstanceUID;
    if (
      anchor
      && expected
      && anchor.studyInstanceUID
      && anchor.studyInstanceUID !== expected
    ) {
      return;
    }
    set({ activeAnchor: anchor });
  },
  setSelectedObservationId: (id) => {
    if (get().selectedObservationId === id) return;
    set({ selectedObservationId: id });
  },
  setMeasurementIntent: (intent) => {
    if (get().measurementIntent === intent) return;
    set({ measurementIntent: intent });
  },
  setCanalIntentLevel: (level) => {
    if (get().canalIntentLevel === level) return;
    set({ canalIntentLevel: level });
  },
  setStructuredViewerMeasurements: (s) => set({ structuredViewerMeasurements: s }),
  upsertStructuredViewerMeasurement: (m) => {
    set({
      structuredViewerMeasurements: upsertStructuredMeasurement(get().structuredViewerMeasurements, m),
    });
  },
  setDorsalCanalForced: (v) => set({ dorsalCanalForced: v }),
  hydrateCanalApRecords: (raw) => {
    const { records, conflictedLevels } = canonicalizeCanalMap(raw);
    set({ canalApProvenance: records });
    return conflictedLevels;
  },
  recordCanalApViewerValue: (write) => {
    const level = normalizeDiscLevel(write.level);
    if (!level) return null;
    const s = get();
    if (refuseSignedMutation(s, "canalAp:viewer")) return null;
    const next = applyCanalViewerValue(s.canalApProvenance[level] ?? null, { ...write, level });
    // isDirty is not decoration: autosave returns early while the draft is
    // clean, so a measurement that never dirtied it could be lost on close.
    set({ canalApProvenance: { ...s.canalApProvenance, [level]: next }, isDirty: true });
    return level;
  },
  recordCanalApManualValue: (levelRaw, raw, region) => {
    const level = normalizeDiscLevel(levelRaw);
    if (!level) return null;
    const s = get();
    if (refuseSignedMutation(s, "canalAp:manual")) return null;
    const parsed = parseCanalApNumber(raw);
    const next = applyCanalManualValue(
      s.canalApProvenance[level] ?? null,
      level,
      parsed ? Number(parsed) : null,
      region,
    );
    set({ canalApProvenance: { ...s.canalApProvenance, [level]: next }, isDirty: true });
    return level;
  },
  setVascularTechnique: (s) => set({ vascularTechnique: s }),
  setVascularTechniqueManual: (key, on) => {
    const prev = get().vascularTechnique;
    if (prev.manual[key] === on) return;
    // An explicit acquisition answer must reach the draft, not only the screen.
    set({ vascularTechnique: markVascularTechniqueManual(prev, key, on), isDirty: true });
  },
  setVascularTechniqueDesignation: (note) => {
    const prev = get().vascularTechnique;
    const nextNote = note?.trim() ? note.trim() : null;
    if (prev.designationNote === nextNote) return;
    set({ vascularTechnique: { ...prev, designationNote: nextNote }, isDirty: true });
  },
  setCoverageMark: (regionKey, status, reason) => {
    const scope = coverageScopeKey(get().reportingContext.region);
    const base = get().coverageMarks.length ? get().coverageMarks : defaultCoverageMarks(scope);
    const next = setCoverageStatus(base, regionKey, status, reason, scope);
    if (coverageMarksEqual(get().coverageMarks, next)) return;
    const byScope = { ...get().coverageByScope, [scope]: next };
    set({
      coverageMarks: next,
      coverageByScope: byScope,
      isDirty: status === "reviewed" || status === "waived" || status === "partial" || get().isDirty,
    });
  },
  touchCoverageViewed: (regionKey) => {
    const scope = coverageScopeKey(get().reportingContext.region);
    const base = get().coverageMarks.length ? get().coverageMarks : defaultCoverageMarks(scope);
    const next = markRegionViewed(base, regionKey, get().activeAnchor);
    if (coverageMarksEqual(get().coverageMarks, next)) return;
    const byScope = { ...get().coverageByScope, [scope]: next };
    set({
      coverageMarks: next,
      coverageByScope: byScope,
      // Focus alone never dirties the report.
    });
  },
  hydrateCoverageMarks: (raw) => {
    const parsed = parseCoverageFromRaw(raw);
    if (!parsed) return;
    const scope = coverageScopeKey(get().reportingContext.region);
    const scoped = filterCoverageForScope(parsed, scope);
    set({
      coverageMarks: scoped,
      coverageByScope: { ...get().coverageByScope, [scope]: scoped },
    });
  },
  serializeCoverageMarks: () => get().coverageMarks,
  setLumbarNumbering: (patch) => set((s) => {
    const lumbarNumbering = { ...s.lumbarNumbering, ...patch };
    return {
      lumbarNumbering,
      canalApProvenance: reconcileCanalLevels(
        s.canalApProvenance, "lumbar", lumbarApCanalLevels(lumbarNumbering),
      ),
    };
  }),
  setDorsalNumbering: (patch) => set((s) => {
    const dorsalNumbering = { ...s.dorsalNumbering, ...patch };
    return {
      dorsalNumbering,
      canalApProvenance: reconcileCanalLevels(
        s.canalApProvenance, "dorsal", dorsalApCanalLevels(dorsalNumbering),
      ),
    };
  }),
  setDorsoLumbarNumbering: (patch) => set((s) => ({ dorsoLumbarNumbering: { ...s.dorsoLumbarNumbering, ...patch } })),
  setStudyComposition: (composition, provenance = "none", manual = false) => set((s) => ({
    studyComposition: composition,
    studyCompositionProvenance: manual ? "none" : provenance,
    studyCompositionOverridden: manual ? true : s.studyCompositionOverridden,
  })),
  setSequencesAvailable: (patch) => set((s) => ({ sequencesAvailable: { ...s.sequencesAvailable, ...patch } })),
  replaceSequencesAvailable: (next) => set({ sequencesAvailable: next }),
  setScreeningRegion: (region, patch) => set((s) => {
    const prev = s.screening[region] ?? defaultScreeningRegionState();
    const next: ScreeningRegionState = { ...prev, ...patch };
    // performed follows the role unless the caller states otherwise (spec §23).
    if (patch.role && patch.performed === undefined) next.performed = roleImpliesPerformed(patch.role);
    return { screening: { ...s.screening, [region]: next } };
  }),
  replaceScreeningRoles: (roles) => set((s) => {
    const next = { ...s.screening };
    for (const region of Object.keys(roles) as SpineScreeningRegion[]) {
      const role = roles[region]!;
      if (next[region]?.role === role) continue;
      next[region] = defaultScreeningRegionState(role);
    }
    return { screening: next };
  }),
  setImpressionOrderFrozen: (frozen) => set({ impressionOrderFrozen: frozen }),
  dismissOwnershipReview: () => set({ ownershipReviewWarnings: [] }),
  dismissLedgerHydrationWarning: () => set({ ledgerHydrationWarning: null }),
  applyComposerFinding: (opts) => {
    if (get().isFinalized) return "blocked";
    const editingId = (opts.editingId ?? opts.id ?? "").trim() || null;
    const existing = editingId
      ? get().appliedPathologyPatches.find((p) => p.id === editingId)
      : undefined;

    // Build incoming observation to compare slot keys.
    const draftId = editingId || opts.id || `composer_${Date.now().toString(36)}`;
    const incomingObs = observationFromPending(
      { ...opts, id: draftId },
      get().reportingContext.region,
      get().activeAnchor,
      get().studyComposition,
    );
    const existingSlot = existing?.observation ? observationSlotKey(existing.observation) : "";
    const incomingSlot = observationSlotKey(incomingObs);
    const slotChanged = Boolean(existing && existingSlot && incomingSlot && existingSlot !== incomingSlot);

    if (existing && slotChanged) {
      // Target slot may already have a sibling — let same-slot engine resolve
      // without binding to the old id first.
      const siblings = findSameSlotSiblings(
        get().appliedPathologyPatches.filter((p) => p.id !== editingId),
        incomingObs,
      );
      if (siblings.length > 0) {
        const survivorId = siblings[0]!.id;
        // Occupied: apply toward sibling id; stash vacated id for confirm path.
        const status = get().applyPathologyOverlay({
          ...opts,
          id: survivorId,
          force: opts.force,
          vacatedObservationId: editingId!,
        });
        if (status === "applied") {
          const stillThere = get().appliedPathologyPatches.some((p) => p.id === editingId);
          if (stillThere) {
            get().removeObservation(editingId!, { remapEvidenceTo: survivorId });
          }
        }
        // pending: vacatedObservationId rides on pendingPathologyPatch for confirmOverwriteAndApply
        return status;
      }
      // Empty target slot: move in place (preserve id + evidence), but strip
      // the previous generated Findings sentence first so old-level prose does
      // not linger under the new ownership.
      const oldFindings = (existing.lastRendered.findings ?? "").trim();
      if (oldFindings) {
        const stripped = stripContribution(
          get().findingsText,
          oldFindings,
          get().fieldProvenance.findings,
        );
        if (stripped.outcome === "removed") {
          set({ findingsText: stripped.text });
        } else if (contributionPresent(get().findingsText, oldFindings)) {
          // Manual / unproven — do not silently leave contradictory levels.
          return "blocked";
        }
      }
      const oldImp = (existing.lastRendered.impression ?? "").trim();
      if (oldImp && !contributionProtected(oldImp, get().fieldProvenance.impression)) {
        const strippedImp = stripContribution(
          get().impressionText,
          oldImp,
          get().fieldProvenance.impression,
        );
        if (strippedImp.outcome === "removed") {
          set({ impressionText: strippedImp.text });
        }
      } else if (oldImp && contributionProtected(oldImp, get().fieldProvenance.impression)) {
        return "blocked";
      }
    }

    return get().applyPathologyOverlay({
      ...opts,
      id: editingId || draftId,
      force: opts.force,
    });
  },

  setObservationImpressionParticipation: (id, include) => {
    if (get().isFinalized) return "blocked";
    const patch = get().appliedPathologyPatches.find((p) => p.id === id);
    if (!patch) return "missing";

    const snap = captureClinicalSnapshot(get());

    const currentImp = (patch.lastRendered.impression ?? patch.templates.impression ?? "").trim();
    let nextTemplates = { ...patch.templates };
    let nextLast = { ...patch.lastRendered };
    let nextSections = [...(patch.observation?.sectionsOwned ?? ["findings"])];
    let nextImpressionText = get().impressionText;
    let nextProv = { ...get().fieldProvenance };

    if (!include) {
      // Exclude: clear impression contribution; strip generated line if not manual.
      if (currentImp && !contributionProtected(currentImp, get().fieldProvenance.impression)) {
        const stripped = stripContribution(nextImpressionText, currentImp, nextProv.impression);
        if (stripped.outcome === "removed") {
          nextImpressionText = stripped.text;
        }
      }
      nextTemplates = { ...nextTemplates, impression: "" };
      nextLast = { ...nextLast, impression: "" };
      nextSections = nextSections.filter((s) => s !== "impression");
      if (!nextSections.includes("findings")) nextSections.push("findings");
    } else {
      // Include: ensure impression template exists; mark stale — do not overwrite manual Impression.
      let imp = (patch.templates.impression || patch.lastRendered.impression || "").trim();
      if (!imp) {
        imp = defaultImpressionFromFindings(patch.lastRendered.findings || patch.templates.findings || "");
      }
      nextTemplates = { ...nextTemplates, impression: imp };
      nextLast = { ...nextLast, impression: imp };
      if (!nextSections.includes("impression")) nextSections = [...nextSections, "impression"];
      // Do not silently merge into Impression narrative — set impressionNeedsRefresh instead.
    }

    const nextObs = patch.observation
      ? { ...patch.observation, sectionsOwned: nextSections as CanonicalObservation["sectionsOwned"] }
      : patch.observation;

    const nextPatches = get().appliedPathologyPatches.map((p) =>
      p.id === id
        ? {
          ...p,
          templates: nextTemplates,
          lastRendered: nextLast,
          observation: nextObs,
        }
        : p,
    );

    set({
      ...withPushedClinicalUndo(get(), snap),
      appliedPathologyPatches: nextPatches,
      impressionText: nextImpressionText,
      fieldProvenance: nextProv,
      isDirty: true,
      selectedObservationId: id,
    });
    // Inclusion changed what the Impression ought to say without changing the
    // Findings' text, so it is named rather than inferred, and it is not a rebase:
    // the summary still has to be re-read before it can be signed.
    set(deriveImpressionDependency(get(), undefined, { arm: "participation-changed" }));
    return "applied";
  },

  removeObservation: (id, opts) => {
    if (refuseSignedMutation(get(), "removeObservation")) return "blocked";
    const patch = get().appliedPathologyPatches.find((p) => p.id === id);
    if (!patch) return "missing";
    const remapTo = (opts?.remapEvidenceTo ?? "").trim() || null;
    const snap = captureClinicalSnapshot(get());
    const result = removeLedgerObservation(narrativeFromState(get()), get().fieldProvenance, toLedgerPatch(patch));
    let nextMs = get().structuredViewerMeasurements;
    if (remapTo) {
      nextMs = remapStructuredMeasurementsObservationId(nextMs, id, remapTo).state;
    } else {
      nextMs = detachStructuredMeasurementsFromObservation(nextMs, id).state;
    }
    let nextPatches = get().appliedPathologyPatches.filter((p) => p.id !== id);
    let nextProvenance = result.provenance;
    const suspendedBaseline = patch.observation
      ? nextPatches.find((candidate) =>
          candidate.stale
          && candidate.observation?.role === "baseline"
          && observationsMutuallyExclusive(candidate.observation, patch.observation!))
      : undefined;
    if (suspendedBaseline && result.outcome === "removed") {
      nextPatches = nextPatches.map((candidate) =>
        candidate.id === suspendedBaseline.id
          ? {
              ...candidate,
              stale: false,
              lastRendered: { ...candidate.templates },
            }
          : candidate,
      );
      const restoredFindings = suspendedBaseline.templates.findings ?? "";
      const restoredImpression = suspendedBaseline.templates.impression ?? "";
      nextProvenance = {
        ...nextProvenance,
        findings: {
          ...(nextProvenance.findings ?? {}),
          ...provenanceFromText(restoredFindings, suspendedBaseline.source),
        },
        impression: {
          ...(nextProvenance.impression ?? {}),
          ...provenanceFromText(restoredImpression, suspendedBaseline.source),
        },
      };
    }
    const alignedRecommendation = alignRecommendationToObservations({
      current: result.narrative.recommendation,
      provenance: nextProvenance.recommendation,
      patches: nextPatches,
    });
    if (alignedRecommendation.changed) {
      result.narrative.recommendation = alignedRecommendation.text;
      nextProvenance = { ...nextProvenance, recommendation: alignedRecommendation.provenance };
    }
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      findingsText: result.narrative.findings,
      impressionText: result.narrative.impression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: nextProvenance,
      appliedPathologyPatches: nextPatches,
      selectedObservationId: get().selectedObservationId === id
        ? (remapTo || null)
        : get().selectedObservationId,
      structuredViewerMeasurements: nextMs,
      ...(opts?.skipUndoSnapshot
        ? { lastPatchSnapshot: get().lastPatchSnapshot, patchUndoStack: get().patchUndoStack }
        : withPushedClinicalUndo(get(), snap)),
      isDirty: true,
    });
    if (typeof window !== "undefined") {
      if (remapTo) {
        window.dispatchEvent(new CustomEvent("care:observation-reassigned", {
          detail: { fromObservationId: id, toObservationId: remapTo },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("care:observation-removed", { detail: { observationId: id } }));
      }
    }

    // PR #662 §2 — System normal auto-return.
    //
    // After removing an impression-worthy abnormal observation, if NO other
    // impression-worthy abnormal patches remain AND the radiologist has not
    // manually owned the impression AND the workspace is not finalized,
    // re-seed the system normal patch. The seed action itself is idempotent
    // and re-checks every safety predicate before applying.
    //
    // Identity is decided by patch concept/source, NOT by string heuristics.
    //
    // This first test asks the CONCEPT-ONLY question ("was the thing I removed
    // an abnormal-typed concept?") and keeps its current-main answer, because a
    // shipped MRI Lumbar normal tile carries `canal_stenosis` / `conus_medullaris`
    // as baseline atoms and deselecting one has always restored the normal.
    // Whether the normal may actually come back is still decided by the single
    // authoritative rule, one call below in hasImpressionworthyAbnormal.
    if (
      !isSystemNormalPatch(patch)
      && isImpressionworthyAbnormal(patch.observation?.concept ?? null)
      && !get().isFinalized
    ) {
      const remainingPatches = get().appliedPathologyPatches;
      if (!hasImpressionworthyAbnormal(remainingPatches)) {
        get().seedSystemNormalImpression();
      }
    }
    // Taking a finding OUT of the Findings is the same clinical event as typing
    // over them, so it has to give the same answer. `undoLastPatch` and
    // `applyMergedResult` re-derive after putting text BACK; until now nothing ran
    // after taking it OUT, so the session kept the pre-removal verdict while the
    // same report after a reload reported `findings-changed` — D-1's two answers
    // from the other side.
    //
    // A removal that completed took the observation's Findings sentence and its
    // Impression sentence out together, so it has re-paired the two sides and
    // rebases the basis — the same rule `applyPathologyOverlay` follows when it
    // ADDS such a pair, which is also why a reload agrees. A removal that only
    // half-applied (`preserved-manual`, `no-op-unproven`) did not touch both
    // sides, so it is re-read against the existing basis instead: rebasing there
    // would have the store claim a summary it did not write.
    //
    // Rebasing is not silencing. `impression-write` does not clear the semantic
    // half of the predicate, and a removal whose generated sentence the radiologist
    // has already replaced is refused outright (`preserved-manual`) rather than
    // re-paired — both pinned in `findingsImpressionDependency.test.ts`, along with
    // the brain-vascular bundle's "withdraws the impression line when the linked
    // finding is removed".
    set(deriveImpressionDependency(
      get(),
      result.outcome === "removed" ? { rebase: true } : undefined,
    ));
    return result.outcome;
  },
  undoLastPatch: () => {
    // Checked before the pop so the frame stays on the stack: it is still the
    // correct history for this study, and `useWorkspaceCommands` reads the top
    // frame to tell "refused" apart from "nothing to undo" when it decides
    // whether Ctrl+Shift+Z owes the radiologist an explanation.
    if (refuseSignedMutation(get(), "undoLastPatch", false)) return false;
    const popped = popClinicalUndoSnapshot(get().patchUndoStack);
    if (!popped) return false;
    const { snapshot: snap, remaining } = popped;
    if (snap.activeStudyId !== get().activeStudyId) {
      // Defence in depth. All three reset paths now clear the stack, so reaching
      // this branch means a switch that went through none of them — a deep link,
      // browser Back/Forward, or selectStudy no-oping on an id absent from the
      // worklist.
      // Restoring here would write the previous patient's five texts, provenance
      // and ledger into this patient's report, and autosave would then persist
      // them inside the current generation where no guard intercepts.
      //
      // The frame is left on the stack rather than dropped: it is still the
      // correct history for the study it came from, and discarding it would
      // destroy the only record of what the radiologist undid there. Callers
      // that surface this (Ctrl+Shift+Z) read the top frame's activeStudyId to
      // tell "refused" apart from "nothing to undo".
      console.warn("[care.workspace_store] undo refused — the frame belongs to a different study", {
        frameStudyId: snap.activeStudyId,
        activeStudyId: get().activeStudyId,
      });
      return false;
    }
    set({
      clinicalHistoryText: snap.clinicalHistoryText,
      techniqueText: snap.techniqueText,
      findingsText: snap.findingsText,
      impressionText: snap.impressionText,
      recommendationText: snap.recommendationText,
      fieldProvenance: snap.fieldProvenance,
      appliedPathologyPatches: snap.appliedPathologyPatches,
      voiceComposerObservations: snap.voiceComposerObservations ?? [],
      voiceComposerTranscriptHistory: snap.voiceComposerTranscriptHistory ?? [],
      ...(snap.appliedFormatName !== undefined
        ? { appliedFormatName: snap.appliedFormatName }
        : {}),
      ...(snap.appliedFormatReportTitle !== undefined
        ? { appliedFormatReportTitle: snap.appliedFormatReportTitle }
        : {}),
      ...(snap.startingCanvasBaseline !== undefined
        ? { startingCanvasBaseline: snap.startingCanvasBaseline ?? null }
        : {}),
      ...(snap.appliedPatternMarkers !== undefined
        ? { appliedPatternMarkers: snap.appliedPatternMarkers }
        : {}),
      ...(snap.impressionNeedsRefresh !== undefined
        ? { impressionNeedsRefresh: snap.impressionNeedsRefresh }
        : {}),
      ...(snap.impressionBasis !== undefined
        ? { impressionBasis: snap.impressionBasis ?? null }
        : {}),
      ...(snap.regionTransitions !== undefined
        ? { regionTransitions: snap.regionTransitions }
        : {}),
      patchUndoStack: remaining,
      lastPatchSnapshot: topClinicalUndoSnapshot(remaining),
      isDirty: true,
    });
    // Undo puts the prose and its dependency link back together, so the answer is
    // re-derived from the pair rather than trusting the flag the frame recorded —
    // the same predicate, whichever direction the text just moved.
    set(deriveImpressionDependency(get()));
    return true;
  },
  applyVoiceComposerPlan: (plan: VoiceChangePlan, transcript: string, opts?: { force?: boolean }) => {
    // `"blocked"` is the union's existing "nothing was applied" value, so
    // `useVoiceComposer`'s applyPreview already treats this as a non-apply. That
    // path is unreachable while signed anyway — `useVoiceReporting` refuses
    // dictation on a finalized study — so this is defence in depth, not a message
    // the radiologist can be shown.
    if (refuseSignedMutation(get(), "applyVoiceComposerPlan")) return "blocked";
    const snap = captureClinicalSnapshot(get());
    const result = applyChangePlan({
      narrative: narrativeFromState(get()),
      provenance: get().fieldProvenance,
      plan,
      activeObservations: get().voiceComposerObservations,
      force: opts?.force,
    });
    if (!result.ok || !result.narrative || !result.provenance) {
      return "blocked";
    }
    const region = get().reportingContext.region || "";

    // P0-B FIX (PR #660 hardening): Separate NARRATIVE APPLICATION from
    // LEDGER CANONICALIZATION to avoid double narrative mutation.
    //
    // OPTION A: applyPathologyOverlay is the SINGLE canonical application
    // path for both narrative AND ledger. We do NOT install result.narrative
    // into the workspace before calling applyPathologyOverlay — instead
    // we strip old voice patches' narrative text FIRST, then let
    // applyPathologyOverlay handle the narrative merge for each voice
    // observation.
    //
    // Step 1: Strip old voice-* patches' narrative contributions from the
    // live findings/impression text. This removes the old voice wording so
    // applyPathologyOverlay can write the new wording without duplication.
    const oldVoicePatches = get().appliedPathologyPatches.filter((p) => p.id.startsWith("voice-"));
    let cleanFindings = get().findingsText;
    let cleanImpression = get().impressionText;
    let cleanTechnique = get().techniqueText;
    let cleanRecommendation = get().recommendationText;
    let cleanHistory = get().clinicalHistoryText;
    for (const vp of oldVoicePatches) {
      // Strip old voice findings text from narrative
      if (vp.lastRendered.findings) {
        cleanFindings = stripContribution(cleanFindings, vp.lastRendered.findings, get().fieldProvenance.findings).text;
      }
      if (vp.lastRendered.impression) {
        cleanImpression = stripContribution(cleanImpression, vp.lastRendered.impression, get().fieldProvenance.impression).text;
      }
    }
    // Also strip from result.narrative so the narrative we'll use for
    // technique/recommendation/history (non-observation fields) doesn't
    // contain old voice text.
    // Note: applyChangePlan already computed result.narrative with the
    // new voice text merged in. We use result.narrative for technique,
    // recommendation, and clinicalHistory (non-observation narrative that
    // applyPathologyOverlay does NOT manage). For findings and impression
    // we use the cleaned text and let applyPathologyOverlay write the
    // new voice observations into it.

    // Step 2: Drop old voice patches from the ledger (keep non-voice patches).
    const kept = get().appliedPathologyPatches.filter((p) => !p.id.startsWith("voice-"));

    // Step 3: Set the cleaned narrative + non-observation fields from
    // result.narrative. applyPathologyOverlay will merge voice observation
    // text into findings/impression.
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      // Use cleaned findings/impression (old voice text stripped) so
      // applyPathologyOverlay writes new voice text without duplication.
      findingsText: cleanFindings,
      impressionText: cleanImpression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: stampVoiceAuthoredProvenance(result.provenance, {
        findings: (result.activeObservations ?? []).map((o) => o.findingsText).filter(Boolean).join("\n"),
        impression: (result.activeObservations ?? []).map((o) => o.impressionText).filter(Boolean).join("\n"),
      }),
      appliedPathologyPatches: kept,
      isDirty: true,
      ...withPushedClinicalUndo(get(), snap),
      voiceComposerObservations: result.activeObservations ?? [],
      voiceComposerTranscriptHistory: transcript
        ? [...get().voiceComposerTranscriptHistory, transcript]
        : get().voiceComposerTranscriptHistory,
    });

    // Step 4: Apply each voice observation through applyPathologyOverlay.
    // This is the SINGLE canonical application path — it handles:
    //   - narrative merge (findings/impression text)
    //   - same-slot replacement (findSameSlotSiblings + planSameSlotReplacement)
    //   - evidence remap (mergeObservationInPlace)
    //   - protected/manual text preservation
    //   - baseline replacement (baselineReplaces)
    //   - provenance stamping
    // NO double narrative application — the narrative is written ONLY here.
    for (const obs of (result.activeObservations ?? [])) {
      const observation = buildCanonicalObservation(observationInputFromVoice(obs, region));
      // Use a level-inclusive ID so different levels don't collide.
      const voiceId = `voice-${obs.concept ?? "obs"}-${obs.level ?? ""}-${obs.laterality ?? ""}`;
      get().applyPathologyOverlay({
        incoming: { findings: obs.findingsText, impression: obs.impressionText },
        templates: { findings: obs.findingsText, impression: obs.impressionText },
        ownership: ownershipFromObservation(observation),
        source: "radiologist-voice",
        region,
        concept: observation.concept,
        level: observation.level || undefined,
        laterality: observation.laterality || undefined,
        findingsText: obs.findingsText,
        id: voiceId,
        force: opts?.force,
        skipUndoSnapshot: true,
      });
    }
    // Restore the voice plan's pre-apply snapshot so undo restores the
    // state BEFORE the voice plan was applied.
    set({ ...withPushedClinicalUndo(get(), snap) });
    return "applied";
  },
  applyAiComposerAccepted: (opts) => {
    // P0-A STRATEGY: AI accepted wording is PRESENTATION, not CLINICAL TRUTH.
    //
    // This function intentionally does NOT modify appliedPathologyPatches.
    // The canonical observation ledger remains the single source of clinical
    // truth. AI paraphrasing changes the narrative wording but does NOT:
    //   - create new clinical observations
    //   - delete existing canonical observations
    //   - mark observations stale (which would exclude them from AI view)
    //
    // deriveComposeObservations() uses lastRendered.findings || templates.findings
    // (NOT live narrative matching), so AI paraphrasing does NOT cause
    // observations to disappear from the AI's view on subsequent compose.
    //
    // The only consequence is that lastRendered.findings may no longer match
    // the live narrative text — but that is a presentation concern, not a
    // clinical truth concern. The observation's clinical identity (concept,
    // level, laterality, severity) remains unchanged.
    //
    // On save/reopen: hydrateObservationLedger calls reconcilePatchAgainstNarrative
    // which MAY mark a patch stale when lastRendered.findings no longer appears
    // in the narrative AND the recorded hash disagrees. This is correct behavior:
    // if the AI rephrased the text, the stale flag is set, but the observation
    // is NOT deleted — it remains in the ledger with stale=true. The radiologist
    // sees the stale warning and can decide to keep or remove it.
    //
    // This is the SAFEST non-destructive strategy: clinical truth is preserved,
    // AI wording is applied as presentation, and the radiologist has the final say.
    if (refuseSignedMutation(get(), "applyAiComposerAccepted")) return "blocked";
    const snap = captureClinicalSnapshot(get());
    const markField = (field: "findings" | "impression" | "recommendation", text: string): FieldProvenanceMap => {
      const map: FieldProvenanceMap = { ...(get().fieldProvenance[field] ?? EMPTY_FIELD_PROVENANCE) };
      for (const sent of text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
        const key = normalizeForDedupe(sent);
        if (!key) continue;
        const prev = map[key] ?? [];
        map[key] = prev.includes("ai-draft") ? prev : [...prev, "ai-draft"];
      }
      return map;
    };
    set({
      findingsText: opts.findings,
      impressionText: opts.impression,
      recommendationText: opts.recommendation,
      fieldProvenance: {
        ...get().fieldProvenance,
        findings: markField("findings", opts.findings),
        impression: markField("impression", opts.impression),
        recommendation: markField("recommendation", opts.recommendation),
      },
      isDirty: true,
      ...withPushedClinicalUndo(get(), snap),
    });
    // The Composer rewrites both fields in one action, which looks like a write
    // that owns the pairing — but it is the model's wording, and CARE's standing
    // rule for accepted AI prose (`mergeField` with `ai-draft`, and B-04's
    // acceptance boundary) is that it owns neither side: a sentence proves nothing
    // about the findings behind it. So this re-reads the dependency instead of
    // rebasing it, which is also precisely what a reload of the same draft reports.
    set(deriveImpressionDependency(get()));
    return "applied";
  },
  clearVoiceComposerSession: () => {
    // Drops every `voice-*` observation from the ledger. No caller reaches this
    // today; the guard is here so a future one does not find an open door.
    if (refuseSignedMutation(get(), "clearVoiceComposerSession")) return;
    set({
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      appliedPathologyPatches: get().appliedPathologyPatches.filter((p) => !p.id.startsWith("voice-")),
    });
  },
  relateralizePatches: (side) => {
    if (refuseSignedMutation(get(), "relateralizePatches")) return;
    const patches = get().appliedPathologyPatches;
    if (!patches.length) return;
    let findings = get().findingsText;
    let impression = get().impressionText;
    let technique = get().techniqueText;
    let recommendation = get().recommendationText;
    const nextPatches = patches.map((p) => {
      if (p.observation && !p.observation.supportsLaterality) return p;
      // Re-rendered from the template, so every parameter the template asks for
      // has to be re-supplied — not just the side. Before B-09 a Quick Select row
      // could never carry a severity, so passing only `side` cost nothing; now a
      // "moderate left foraminal stenosis" would re-render as "right foraminal
      // stenosis", the qualifier silently deleted by `fillTemplate` while the
      // ledger still recorded severity = moderate. Same source gate as the apply
      // path, so the structured-format and macro templates re-render exactly as
      // they always did.
      const next = applySideToIncoming(
        p.templates,
        side,
        isQuickSelectSource(p.source) ? resolvedQuickSelectSeverity(p.observation?.severity) : "",
      );
      findings = relateralizeOwnedText(findings, p.lastRendered.findings ?? "", next.findings ?? "");
      impression = relateralizeOwnedText(impression, p.lastRendered.impression ?? "", next.impression ?? "");
      technique = relateralizeOwnedText(technique, p.lastRendered.technique ?? "", next.technique ?? "");
      recommendation = relateralizeOwnedText(recommendation, p.lastRendered.recommendation ?? "", next.recommendation ?? "");
      const observation = p.observation
        ? buildCanonicalObservation({
          ...p.observation,
          laterality: side,
          supportsLaterality: true,
          id: p.observation.id,
        })
        : p.observation;
      return { ...p, lastRendered: next, observation };
    });
    set({
      findingsText: findings,
      impressionText: impression,
      techniqueText: technique,
      recommendationText: recommendation,
      appliedPathologyPatches: nextPatches,
      isDirty: true,
    });
  },
  applyMergedResult: () => {
    if (refuseSignedMutation(get(), "applyMergedResult")) {
      // Same shape as confirmOverwriteAndApply's finalized branch: clear the
      // dialog instead of leaving an Apply button that silently does nothing.
      // The merge preview can be armed before signing and applied after it.
      set({
        mergePreviewOpen: false,
        lastMergeResult: null,
        lastMergeFormats: null,
        abnormalPatternConfirm: null,
      });
      return;
    }
    const patternConfirm = get().abnormalPatternConfirm;
    if (patternConfirm) {
      set({
        mergePreviewOpen: false,
        lastMergeResult: null,
        lastMergeFormats: null,
        abnormalPatternConfirm: null,
      });
      patternConfirm();
      return;
    }
    const r = get().lastMergeResult;
    if (!r) return;
    // Build per-sentence provenance from the merge result so differential colors
    // (Format A = emerald, Format B = sky, common = template/gray) persist in the editor.
    const buildProv = (sentences: Array<{ text: string; source: "common" | "from-a" | "from-b" }>): FieldProvenanceMap => {
      const out: FieldProvenanceMap = {};
      for (const s of sentences) {
        const key = normalizeForDedupe(s.text);
        if (!key) continue;
        const src: InsertSource = s.source === "from-a" ? "template-a" : s.source === "from-b" ? "template-b" : "template";
        out[key] = [src];
      }
      return out;
    };
    const techniqueProv = provenanceFromText(r.technique, "template");
    const findingsProv = buildProv(r.findingsMerged.sentences);
    const impressionProv = buildProv(r.impressionMerged.sentences);
    const recommendationProv = buildProv(r.recommendationMerged.sentences);
    const historyText = (r.clinicalHistory ?? "").trim() ? r.clinicalHistory : get().clinicalHistoryText;
    const historyProv = (r.clinicalHistory ?? "").trim()
      ? buildProv(r.clinicalHistorySentences ?? [])
      : (get().fieldProvenance.clinicalHistory ?? EMPTY_FIELD_PROVENANCE);
    const mergedNarrative: ReportNarrative = {
      clinicalHistory: historyText,
      technique: r.technique,
      findings: r.findings,
      impression: r.impression,
      recommendation: r.recommendation,
    };
    // The merge replaces all five fields with template-derived prose, so an
    // observation whose rendered contribution is no longer present is stale —
    // the same judgement hydrateObservationLedger makes on reopen, using the
    // same function. Stale is not deleted: the ledger panel shows NEEDS REFRESH
    // and the radiologist can re-apply. Leaving a patch live instead would have
    // it claim ownership of sentences the merge just overwrote, so the next tile
    // re-select would strip prose that is no longer his.
    const reconciledPatches = get().appliedPathologyPatches.map((p) => (
      reconcilePatchAgainstNarrative(toLedgerPatch(p), mergedNarrative).stale
        ? { ...p, stale: true }
        : p
    ));
    const mergeSnapshot = captureClinicalSnapshot(get());
    set({
      techniqueText: r.technique,
      findingsText: r.findings,
      impressionText: r.impression,
      recommendationText: r.recommendation,
      clinicalHistoryText: historyText,
      fieldProvenance: {
        technique: techniqueProv,
        findings: findingsProv,
        impression: impressionProv,
        recommendation: recommendationProv,
        clinicalHistory: historyProv,
      },
      isDirty: true,
      mergePreviewOpen: false,
      lastMergeResult: null,
      lastMergeFormats: null,
      reportFormatPickerOpen: false,
      appliedPathologyPatches: reconciledPatches,
      ...withPushedClinicalUndo(get(), mergeSnapshot),
      appliedFormatReportTitle:
        r.combinedReportTitle
        || (get().lastMergeFormats?.a?.reportTitle ?? "").trim()
        || (get().lastMergeFormats?.b?.reportTitle ?? "").trim()
        || null,
    });
    // A merged format rewrites all five fields from the template, so it owns both
    // sides of the dependency and re-bases it — while still being read by the same
    // predicate, which is the point: a template whose impression calls the study
    // normal over the findings it just merged arms here exactly as it would after
    // a reload.
    set(deriveImpressionDependency(get(), { rebase: true }));
    // Increment usage count
    const ids = get().selectedFormatIds;
    const nf = get().reportFormats.map((x: ReportFormat) => ids.includes(x.id) ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x);
    saveFormats(nf);
    set({ reportFormats: nf });
  },
  cancelMerge: () => set({ mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null, abnormalPatternConfirm: null }),
  saveAsFormat: (i) => {
    const local = createFormat({
      ...i,
      bodyPart: canonicalContentRegion(i.bodyPart) || i.bodyPart,
      clinicalHistory: i.clinicalHistory ?? "",
    });
    const optimistic = [...get().reportFormats, local];
    saveFormats(optimistic);
    set({ reportFormats: optimistic, saveAsFormatDialogOpen: false });
    void createReportFormatOnServer(i)
      .then((serverFmt) => {
        const withoutTemp = get().reportFormats.filter((f) => f.id !== local.id);
        const next = [...withoutTemp, serverFmt];
        saveFormats(next);
        set({ reportFormats: next });
      })
      .catch(() => {
        /* offline: local cache remains until next hydrate/migrate */
      });
  },
  deleteReportFormat: (id) => {
    const fs = get().reportFormats.filter((f: ReportFormat) => f.id !== id);
    saveFormats(fs);
    set({ reportFormats: fs, selectedFormatIds: get().selectedFormatIds.filter((x: string) => x !== id) });
    void deleteReportFormatOnServer(id).catch(() => { /* offline soft-fail */ });
  },
  openSaveAsFormatDialog: () => set({ saveAsFormatDialogOpen: true }), closeSaveAsFormatDialog: () => set({ saveAsFormatDialogOpen: false }),
  resetReportFormatsToDefaults: () => set({
    reportFormats: mergeStructuredNormalFormats(resetFormatsToDefaults(), get().structuredNormalRows),
    selectedFormatIds: [],
  }),
  /**
   * The Templates screen's rows ARE the Normal Formats: each complete normal
   * becomes a format and shadows the built-in copy of the same exam, so what
   * auto-opens and what Quick Normal applies is the wording edited on screen.
   *
   * Idempotent — the structured entries are dropped before merging, so calling
   * this on every template refresh cannot accumulate duplicates.
   */
  ingestStructuredNormalFormats: (rows) => {
    const library = get().reportFormats.filter((f: ReportFormat) => f.structuredTemplateId == null);
    set({
      structuredNormalRows: rows,
      reportFormats: mergeStructuredNormalFormats(library, rows),
    });
  },
  hydrateContentLibraries: async () => {
    try {
      const formats = await hydrateReportFormatsLibrary();
      set({ reportFormats: mergeStructuredNormalFormats(formats, get().structuredNormalRows) });
    } catch { /* keep bootstrap loadFormats() */ }
    try {
      await hydrateChocolateMacrosFromServer();
    } catch { /* keep local chocolate cache */ }
  },
  hydrateAbnormalPatternLibrary: (rows) => {
    const resolved = resolveAbnormalPatternSettings(rows);
    set({
      abnormalPatternLibrary: resolved.patterns,
      abnormalPatternSuggestionsEnabled: resolved.suggestionsEnabled,
    });
  },
  openMacroEditor: (m) => set({ macroEditorOpen: true, editingMacro: m }), closeMacroEditor: () => set({ macroEditorOpen: false, editingMacro: null }),
  saveMacro: (input) => { const e = input.id ? get().snippetMacros.find((m: SnippetMacro) => m.id === input.id) : null; let ms: SnippetMacro[]; if (e) ms = get().snippetMacros.map((m: SnippetMacro) => m.id === e.id ? { ...m, ...input, updatedAt: new Date().toISOString() } : m); else ms = [...get().snippetMacros, createMacro(input)]; saveMacros(ms); set({ snippetMacros: ms }); get().closeMacroEditor(); },
  deleteMacro: (id) => { const ms = get().snippetMacros.filter((m: SnippetMacro) => m.id !== id); saveMacros(ms); set({ snippetMacros: ms }); get().closeMacroEditor(); },
  setActiveMacroPrompt: (p) => set({ activeMacroPrompt: p }),
  applyMacroWithValues: (values: Record<string, string>) => {
    // First statement, because the write below uses a COMPUTED clinical key
    // (`[fieldTextKey(p.field)]`) that no line-anchored scan can see — this
    // action was only ever in the inventory via its `fieldProvenance` write.
    // The popover is still dismissed: a prompt armed before signing must not be
    // left open on a report that can no longer answer it.
    if (refuseSignedMutation(get(), "applyMacroWithValues")) {
      set({ activeMacroPrompt: null });
      return;
    }
    const p = get().activeMacroPrompt;
    if (!p) return;
    const exp = expandMacro(p.macro, values);
    const c = get()[`${p.field}Text` as "findingsText"];
    const before = c.slice(0, p.startPos);
    const after = c.slice(p.startPos).replace(/^:[a-z][a-z0-9_]*/i, "");
    // Macro expansion replaces the trigger token; merge the expanded text with macro provenance.
    const assembled = before + exp + " " + after;
    const prevProv = get().fieldProvenance[p.field] ?? EMPTY_FIELD_PROVENANCE;
    const macroProv = provenanceFromText(exp, "macro");
    const reconciled = reconcileProvenanceAfterManualEdit(c, assembled, { ...prevProv, ...macroProv });
    // Prefer macro attribution for sentences that came from the expansion.
    for (const [k, sources] of Object.entries(macroProv)) {
      reconciled[k] = sources;
    }
    set({
      isDirty: true,
      [fieldTextKey(p.field)]: assembled,
      fieldProvenance: { ...get().fieldProvenance, [p.field]: reconciled },
      activeMacroPrompt: null,
    });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  updateSignOffProfile: (m: Modality, n: string, c: string) => { const e = get().signOffProfiles.find((p: SignOffProfile) => p.modality === m); let ps: SignOffProfile[]; if (e) ps = get().signOffProfiles.map((p: SignOffProfile) => p.id === e.id ? { ...p, signerName: n, signerCredentials: c } : p); else ps = [...get().signOffProfiles, createProfile({ modality: m, signerName: n, signerCredentials: c, isDefault: true })]; saveProfiles(ps); set({ signOffProfiles: ps }); },
  triggerPreload: () => set({ preloadTriggered: true }), resetPreload: () => set({ preloadTriggered: false, nextStudyPreloaded: false }),
  setReportingContext: (ctx) => {
    if (reportingContextEqual(get().reportingContext, ctx)) return;
    const prevScope = coverageScopeKey(get().reportingContext.region);
    const nextScope = coverageScopeKey(ctx.region);
    const byScope = { ...get().coverageByScope, [prevScope]: get().coverageMarks };
    const nextMarks = filterCoverageForScope(byScope[nextScope] ?? [], nextScope);
    // Region change: swap coverage scope; do not leak LS marks into Brain UI.
    set({
      reportingContext: ctx,
      coverageByScope: { ...byScope, [nextScope]: nextMarks },
      coverageMarks: nextMarks,
    });
  },
} as WorkspaceStore);

export const useWorkspace: UseBoundStore<StoreApi<WorkspaceStore>> = create<WorkspaceStore>()(createWorkspaceStore);

/**
 * Typed selector — shallow equality by default so selectors never trigger
 * infinite re-renders from fresh `{}` / `[]` fallbacks (React minified #185).
 */
export function useWorkspaceSelector<T>(selector: (state: WorkspaceStore) => T): T {
  return useWorkspace(useShallow(selector));
}

export { DEFAULT_QUICK_SELECT_TILES, lookupTiles, DEFAULT_REPORT_FORMATS, lookupFormats, DEFAULT_SNIPPET_MACROS, lookupMacros, DEFAULT_SIGN_OFF_PROFILES, lookupProfile, formatSignOff };
