import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/vanilla/shallow";
import type { Study, MeasurementRow, PriorStudy, CopilotItem, CriticalFinding, ReportFormat, SnippetMacro, SignOffProfile, MergeResult, MergeSentence, Modality, LintIssue } from "./types";
import { runLintRules, runCopilotAnalysis, computeQualityScore, mergeTwoFormats, expandMacro, detectMacroTrigger, shouldPreloadNext, studyPriorityRank } from "./types";
// Single read point for ff_radiology_critical_result_comms. staffSession.ts has
// no imports of its own and criticalResultCommsFlag.ts imports only that, so
// this cannot introduce a cycle back into the store.
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import { normalizeWorkspaceStudies } from "./normalizeWorkspaceStudy";
import { announceSignedMutationRefusal } from "./signedMutationRefusalNotice";
import {
  announceQuickSelectParameterRefusal,
  announceQuickSelectPlaceholderRefusal,
  isQuickSelectSource,
  resolvedQuickSelectLevel,
  resolvedQuickSelectSeverity,
  unresolvedQuickSelectParameters,
  unresolvedQuickSelectPlaceholders,
} from "./quickSelectParameterContract";
import { DEFAULT_QUICK_SELECT_TILES, lookupTiles } from "./quick-select-library";
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
import {
  appendClinicalPhrase,
  historyPhraseVariants,
  historyTemplateNeedsSide,
  removeClinicalPhrase,
  resolveHistoryPhrase,
} from "@/lib/clinicalHistoryText";
import { DEFAULT_SNIPPET_MACROS, lookupMacros, lookupMacrosForContext, loadMacros, saveMacros, createMacro } from "./snippet-macros-library";
import { DEFAULT_SIGN_OFF_PROFILES, loadProfiles, saveProfiles, lookupProfile, formatSignOff, createProfile } from "./sign-off-profiles";
import {
  mergeReportFieldContent,
  mergeReportFieldContentWithProvenance,
  provenanceFromText,
  reconcileProvenanceAfterManualEdit,
  rejoinAuthoredStatement,
  normalizeForDedupe,
  splitToSentences,
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
  type ManualKeptSentences,
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
  hasStructuredOwnership,
  liveContributionKeys,
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
  dropProvenanceForRemoved,
  serializeObservationLedger,
  parseObservationLedger,
  storedProvenanceWithLedgerFallback,
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
import {
  activeSuppressors,
  canonicalOrderFromText,
  claimsDeclaredBy,
  falsifies,
  type SuppressingObservation,
} from "@/lib/clinicalSelection/normalSuppression";
import { mayReplaceMachineTechniqueWithApproved, techniqueDecisionRegionCount } from "@/lib/techniqueStudyTabOrigin";
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
import { assertsNormalStatement, cuedAbnormalSentences, generateLocalImpression, refusedAutomaticSentences, WHOLE_REPORT_NORMAL_IMPRESSION } from "@/lib/generateLocalImpression";
import { impressionProvenanceIsRadiologistManual } from "@/lib/impressionProvenance";
import {
  provenanceForRestoredField,
  reportContextIsVerified,
  sameReportId,
  type PreservedRestoreProvenance,
} from "@/lib/aiAttributionRestore";
import type { ObservationAnchor } from "@/lib/observationAnchor";
import {
  buildSystemNormalPatch,
  findSystemNormalPatch,
  impressionHasManualContribution,
  incomingStatesAbnormalImpression,
  isSystemNormalPatch,
  patchOwnsAbnormalFinding,
  reportAssertsAbnormality,
  statesAbnormalImpression,
  suppressesSystemNormal,
  SYSTEM_NORMAL_IMPRESSION_TEXT,
  SYSTEM_NORMAL_PATCH_ID,
} from "@/lib/conceptCanon/normalImpression";
import { isImpressionworthyAbnormal } from "@/lib/conceptCanon/contentPacks";
import { withheldMergedImpression } from "./mergeImpressionGuard";
import {
  claimRetiredBaselines, mergedFindingsWithdrawal, retainedNormalReviewWarnings, withdrawSupersededNormals,
  anchorContributionForWithheld, anchorAfterRetiredBaselineOwner, claimWithheldIncomingNormals,
  filterWithheldFromIncoming, withheldIncomingNormalSentences,
} from "./withdrawSupersededNormals";
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
  hasOwnedApprovedNormal,
  ledgerIdentity,
  levelsContradictedByUnexplainedLines,
  radiologistObservations,
  reportHasDeviation,
  rowLevelKey,
  supersededBaselineTexts,
  deletedScaffoldLines,
  unexplainedFindingLines,
  type ProfessionalReportOutcome,
} from "./professionalReport";
import {
  decideInstantReport,
  holdFromRefusal,
  holdIsReportable,
  readInstantReportEnabled,
  IMPRESSION_UNDECIDED_HOLD,
} from "./instantReport";
import type { InstantReportDecision, InstantReportHoldCode } from "./instantReport";
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
import { previewQuickSelectRetirement, type QuickSelectRetirementPreview } from "@/lib/quickSelectRetirementPreview";

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
  /**
   * The sentence a clinical-history box contributes to the Clinical History
   * section. `PathologyIncoming` is the report BODY — Technique, Findings,
   * Impression, Recommendation — and an indication is none of those, so a box
   * authored as history carries its sentence here and nothing in `incoming`.
   * `toggleClinicalHistoryContribution` is the only writer of the section, and
   * it is the toggle the Clinical History chips already use.
   */
  clinicalHistory?: string;
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
  /**
   * The radiologist's own sentences this patch would have replaced if he confirmed.
   * Filled only on the pending path, and read by the overwrite dialog so the
   * warning names the words at risk rather than only the slot that collided.
   */
  manualKept?: ManualKeptSentences;
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
  /**
   * "Undo apply" identity: stamped only on the frame `applyVoiceComposerPlan` names
   * as its own, so the affordance beside the Apply button can revert exactly that
   * apply while it is still the newest clinical change. Never restored — it is
   * history metadata, not clinical state, so `clinicalRestorePatch` deliberately
   * ignores it.
   */
  voiceApplyId?: string;
};

const CLINICAL_UNDO_MAX = CLINICAL_UNDO_DEPTH;

/** Monotonic id for voice-composer Apply frames — readable in traces, unique per apply. */
let voiceApplySeq = 0;

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

function withPushedClinicalUndo(
  s: S,
  snap: PatchSnapshot,
): Pick<S, "patchUndoStack" | "lastPatchSnapshot" | "patchRedoStack"> {
  const patchUndoStack = pushClinicalUndoSnapshot(s.patchUndoStack, snap, CLINICAL_UNDO_MAX);
  return {
    patchUndoStack,
    lastPatchSnapshot: topClinicalUndoSnapshot(patchUndoStack),
    // One place, so no clinical writer has to remember it: a new edit forks the history, and replaying
    // the branch the radiologist abandoned would overwrite what they just chose instead.
    patchRedoStack: [],
  };
}

/**
 * The state a clinical history frame restores, in one definition shared by Undo and Redo.
 *
 * Both directions move through the SAME frames, so the set of fields a step back writes — and the
 * optional ones it deliberately leaves alone because the frame predates them — must be identical in
 * both. Two hand-maintained copies of that list is how a redo ends up restoring the prose but not the
 * provenance, or a new field gets added to Undo and quietly skipped by Redo.
 */
function clinicalRestorePatch(snap: PatchSnapshot): Partial<S> {
  return {
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
 * P0-1a, 20-case audit 2026-10-26 — the invented whole-report normal has no
 * owner, so it may not land on a report whose LEDGER owns an abnormality.
 *
 * Both PRESSED impression derivations read only the residue nobody owns
 * (`unexplainedFindingLines`): every abnormal sentence a patch explains is
 * subtracted first, so when the residue reads normal, `generateLocalImpression`
 * answers with "No significant abnormality detected." — a whole-report normal
 * the page never authorised, printed under Findings that say the opposite (the
 * audit's D3: spondylodiscitis, an epidural collection and cord compression,
 * Impression "No significant abnormality detected."). The automatic arm never
 * had the defect — `cuedAbnormalSentences` deliberately has no all-normal
 * branch, and its doc comment is the ruling this helper enforces for the two
 * doors the ruling never reached: the press and the hover preview.
 *
 * The oracle is deliberately the LEDGER, not the free text: an abnormal line
 * nobody owns is still sitting in the residue, so it flows through the
 * candidates as a real finding and never coexists with the invention — the
 * only way the residue is all-normal while the report is abnormal is a patch
 * owning that abnormality. `suppressesSystemNormal` reads the concepts and the
 * rows' own Conclusion prose; `patchOwnsAbnormalFinding` reads the rows'
 * Findings prose, which is the arm a concept-unflagged, impression-silent box
 * travels (measured: the cervical Facet arthropathy box, whose registry concept
 * is not impressionworthy and whose tile authors no impression sentence). A
 * genuinely normal report owns nothing on either arm and keeps the invention —
 * its correct conclusion, pinned by the positive controls in
 * impressionNormalInvention.test.ts and by impressionManualProsePreservation's
 * audit-B suite ("Gyral thickening noted." owns no ledger row, so the press
 * still offers the canned normal for prose it cannot name).
 */
function suppressInventedNormalOverAbnormality(
  candidates: string[],
  s: Pick<S, "appliedPathologyPatches">,
): string[] {
  const ledgerOwnsAbnormality = suppressesSystemNormal(s.appliedPathologyPatches)
    || s.appliedPathologyPatches.some(patchOwnsAbnormalFinding);
  if (!ledgerOwnsAbnormality) return candidates;
  return candidates.filter((line) => line !== WHOLE_REPORT_NORMAL_IMPRESSION);
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

/**
 * The provenance view the dictation door needs in order to retire ITS OWN earlier
 * wording. `contributionProtected` counts `radiologist-voice` as protected text
 * (observationSlot.ts:596) — correct when anything else tries to delete what the
 * radiologist dictated, useless when the radiologist dictates a correction: passing the
 * live map made every retire answer `preserved-manual`, so the retracted sentence stayed
 * in the report while the ledger row that owned it was deleted. Dropping that one source
 * keeps every other protection intact — a sentence the radiologist has since rewritten by
 * hand also carries `manual`, and stays exactly where they left it.
 */
function voiceRetirableProvenance(map: FieldProvenanceMap | undefined): FieldProvenanceMap {
  const next: FieldProvenanceMap = {};
  for (const [key, sources] of Object.entries(map ?? {})) {
    const rest = (sources ?? []).filter((s) => s !== "radiologist-voice");
    if (rest.length) next[key] = rest;
  }
  return next;
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
  /**
   * Per-study critical-SLA start timestamps for THIS browser session — the
   * ledger `criticalSlaStartedAt` is the ACTIVE study's projection of. The
   * single scalar is clinical-reset state (wiped on every study switch so a
   * clock can never leak across patients), which used to mean the elapsed time
   * itself was lost too: reopen a study whose critical finding is still
   * uncommunicated and the clock restarted from zero. The map survives study
   * switches — like `completedStudyIds`, it is SESSION state about the queue,
   * not clinical content of one study — and `restoreCriticalSlaFor` reprojects
   * the incoming study's entry back into the scalar. Entries are deleted by
   * finalize (the study closed) and by `clearCriticalSla`; they are honest
   * within the session and deliberately NOT persisted to disk.
   */
  criticalSlaStarts: Record<string, number>;
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
  /**
   * The forward branch of the same history, in the same frame shape and under the same depth bound.
   * Pushed by `undoLastPatch` and emptied by any new clinical edit, so redo can only ever replay the
   * line of history the radiologist actually stepped back from — never a branch their next click has
   * already replaced. Same study stamp and same signed boundary as undo, enforced in `redoLastPatch`.
   */
  patchRedoStack: PatchSnapshot[];
  /**
   * The newest voice-composer Apply's frame id. COMPARED, never trusted:
   * `undoLastVoiceApply` only acts while the TOP undo frame still carries this
   * id — any newer clinical write hides the affordance instead of letting it
   * revert a change the radiologist can still see on the page.
   */
  lastVoiceApplyId: string | null;
  startingCanvasBaseline: StartingCanvasBaseline | null;
  appliedPathologyPatches: AppliedPathologyPatch[];
  /**
   * Approved-normal sentences the radiologist deleted from a canvas this engine wrote.
   * MODE A only: an unpressed pass merges the normal in, so without this record a
   * deleted line walks back on the NEXT pass, overwriting an edit nobody asked it to
   * make. Cleared by a press — that is the radiologist asking for the whole normal
   * again — and by a study change.
   */
  normalLinesRemovedByRadiologist: string[];
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
  /**
   * Contribute a clinical-history sentence to the Clinical History section, or
   * withdraw the exact one already there. This is `ClinicalHistoryChipStrip`'s
   * toggle — the same append-if-absent, remove-if-exact, never-clobber-typed-text
   * rules — reached from a Quick Select box instead than from a chip, so one
   * section keeps one mechanism and no history text is stored twice.
   *
   * `"refused"` covers a signed report, an empty phrase, and a `{side}` template
   * clicked with no side chosen; the second click is the deselect, which reports
   * `"removed"`. One clinical undo frame per click that changed the section, so a
   * history box steps back like any other Quick Select click.
   */
  toggleClinicalHistoryContribution: (
    phrase: string,
    selected: boolean,
    side?: Side | "",
  ) => "applied" | "removed" | "refused";
  /** Fill only when the field is empty; assigns provenance for the inserted block. */
  setFieldIfEmpty: (f: EditorField, v: string, source: InsertSource) => void;
  /** Wholesale replace with provenance for the new content. */
  replaceField: (f: EditorField, v: string, source: InsertSource) => void;
  /**
   * Record the approved normal a structured report template wrote at open, so the
   * two questions Quick Select answers about that report have the same reference
   * they have on an engine-built canvas: which sentences a box actually wrote
   * (`renderedInField`, judged by COUNT against this text rather than by presence
   * on the page), and where a deselected box's retired normal belongs
   * (`canonicalOrderFromText`).
   *
   * Marks the stamp `source: "template"`, which deliberately does NOT hand the
   * canvas to MODE A — an unpressed pass may not rebuild a report it did not write.
   *
   * Returns false, and changes nothing, when the ENGINE owns the canvas (a Start
   * Report or an automatic pass stamped that format's own normal, and a second
   * authority for the same report would disagree with it), and when `findings` is
   * blank (there is no approved normal to judge against, and claiming one would
   * invent prose the clinic never authored). A previous template stamp IS
   * replaceable, because a region change re-applies a different examination's
   * normal and a reference to the old one would rank sentences that are no longer
   * on the page. Never reads the live page: the caller passes the template's own
   * text, because the reference has to be pristine.
   */
  stampTemplateApprovedNormal: (b: {
    name: string;
    findings: string;
    impression: string;
  }) => boolean;
  /**
   * Wholesale text replacement — a signed report opening, a draft restoring from
   * the local backup. Sentences whose authorship is not established keep the
   * conservative `manual` default.
   *
   * `preserved` is the one exception, and it is not a licence: the store decides
   * whether attribution may be carried at all (the context must be verified and
   * belong to the study this store is on), and `aiAttributionRestore` decides it
   * sentence by sentence. Without it this action behaves exactly as it did.
   */
  setEditorContent: (c: { findings: string; impression: string; recommendation: string; technique: string; clinicalHistory: string }, preserved?: PreservedRestoreProvenance) => void;
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
  startCriticalSla: () => void; clearCriticalSla: () => void; escalateCriticalSla: () => void; restoreCriticalSlaFor: (studyId: string | number | null | undefined) => void;
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
  generateProfessionalReport: (ctx: Pick<ReportingStudyContext, "modality" | "region" | "regions" | "source" | "protocolName" | "studyDescription">, opts?: {
    /** Run by the instant report, not pressed by the radiologist. */
    automatic?: boolean;
    /** MODE A only: refuse unless the resolved format is the clinic's OWNED approved
     *  normal for this examination. A normal nobody approved is not a fact, and an
     *  unpressed pass may not add one. */
    requireOwnedApprovedNormal?: boolean;
  }) => ProfessionalReportOutcome;
  /**
   * MODE A — the debounced automatic pass. Decides from `instantReport.ts` whether
   * an unpressed rebuild is allowed here, runs the one deterministic engine when it
   * is, and records the reason when it is not, so the canvas can say it out loud
   * instead of failing silently. Returns the decision so a test can assert the hold
   * without a screen.
   */
  composeInstantReport: (ctx: Pick<ReportingStudyContext, "modality" | "region" | "regions" | "source" | "protocolName" | "studyDescription">, contentLocked: boolean) => InstantReportDecision;
  /** Why the instant report is not rebuilding itself, or null when it is. */
  instantReportHold: { code: InstantReportHoldCode; message: string } | null;
  setInstantReportHold: (hold: { code: InstantReportHoldCode; message: string } | null) => void;
  ingestStructuredNormalFormats: (rows: StructuredNormalRow[]) => void;
  toggleFormatFavorite: (id: string) => void;
  /** `"refused"` is the signed-report boundary declining the write. Distinct from
   *  `"pending"` (queued for confirmation) and from `"blocked"` used by the batch
   *  entrypoints, so a caller that rewards the action can tell them apart. */
  applyPathologyOverlay: (opts: PendingPathologyPatch & { force?: boolean }) => "applied" | "pending" | "refused";

  /**
   * Owner brief (Composer 99.9 Phase 3, item C): show which normal statement a
   * tile click will replace — BEFORE the click. Read-only preview computed by
   * the same oracles `applyPathologyOverlay` retires through; a `refusal` word
   * names why the click would write nothing instead.
   */
  previewPathologyOverlay: (opts: PendingPathologyPatch) => QuickSelectRetirementPreview & { refusal?: string };
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
  /**
   * Rebuild the Impression from the ledger plus whatever Findings text nobody
   * owns.
   *
   * `automatic: true` is the same recomputation for a caller with no press behind
   * it — today, the derived-impression effect. It differs in two ways, and both are
   * about who asked: free text is concluded only when it names a recognised
   * abnormality (never on the length default), and a Conclusion the radiologist
   * wrote by hand is left exactly as they wrote it. The controls the doctor presses
   * — Generate Impression, Refresh from Findings, the sign dialog's refresh,
   * Generate Professional Report — pass nothing and behave as they always have.
   *
   * The result says whether the Conclusion moved. `undefined` is "it was rewritten";
   * `"held-protected"` is "it was not, because what is there is somebody's clinical
   * claim"; `"held-empty"` is MODE A's case — not rewritten because rewriting it would
   * have left the report stating nothing. A caller that treats "refused" and "did the
   * work" as the same outcome is how a silently emptied Impression stayed invisible.
   * (A refusal by the SIGNED boundary is not one of these: it reports itself through
   * `refuseSignedMutation`, which is the witness every signed writer is tested against.)
   */
  refreshImpressionFromLedger: (opts?: {
    excludeBaselineObservations?: boolean;
    automatic?: boolean;
  }) => "held-empty" | "held-protected" | undefined;
  /**
   * The radiologist has read the Impression against the Findings and says it
   * stands as written. Records that against the current clinical content, so the
   * same report does not nag after a reload — and so the next clinical change in
   * the Findings arms it again. Writes no text.
   */
  markImpressionReviewed: () => void;
  /**
   * Phase 3, item D — the READ-ONLY half of `refreshImpressionFromLedger`. Runs
   * the exact derivation a pressed Refresh runs (same patches, same leftover
   * scan, same `refreshImpressionFromObservations`) and returns the text it
   * WOULD write, without writing a character: no field text, no provenance, no
   * dirty flag, no rebase, no reordering. The stale banner shows this as a
   * preview so the radiologist accepts the update or keeps their manual edit
   * EXPLICITLY — one press never silently overwrites a Conclusion a doctor
   * wrote by hand. `refused: "signed"` mirrors the apply path's signed guard.
   */
  previewImpressionFromLedger: (opts?: { excludeBaselineObservations?: boolean }) => {
    next: string;
    refused: string | null;
  };
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
  /**
   * Replay the frame `undoLastPatch` just took. Returns false when there is nothing to redo, when the
   * frame belongs to another study, or when the report has been signed — the same three refusals as
   * undo, and in every case the frame stays on the stack and the report is not written to.
   */
  redoLastPatch: () => boolean;
  /**
   * Undo the newest voice-composer Apply — the affordance shown beside the
   * Apply button the moment it succeeds. `"gone"` (never a silent revert of
   * something else) once a newer clinical edit has buried the apply's frame or
   * the depth bound evicted it; `"refused"` on a signed report or when the
   * frame belongs to another study. In every non-`"undone"` case the undo
   * history is left exactly as it was.
   */
  undoLastVoiceApply: () => "undone" | "gone" | "refused";
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
  notification: null, criticalSlaStartedAt: null, criticalSlaMinutes: 15, criticalSlaEscalated: false, criticalSlaStarts: {},
  reportFormats: typeof window !== "undefined" ? loadFormats() : DEFAULT_REPORT_FORMATS, structuredNormalRows: [], selectedFormatIds: [], reportFormatPickerOpen: false,
  appliedFormatReportTitle: null,
  saveAsFormatDialogOpen: false, mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null, confirmOverwriteOpen: false, pendingFormatIds: [],
  pendingFormatOverwrite: null, pendingFormatRegion: null,
  pendingPathologyPatch: null, lastPatchSnapshot: null, patchUndoStack: [], patchRedoStack: [], lastVoiceApplyId: null, startingCanvasBaseline: null, appliedPathologyPatches: [], impressionNeedsRefresh: false,
  normalLinesRemovedByRadiologist: [],
  instantReportHold: null,
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
    // The switch wiped the ACTIVE clock with the rest of the clinical state;
    // this study's own session ledger entry — if it has one — is the honest
    // replacement. Without it, reopening a study with an uncommunicated
    // critical finding restarted the SLA from zero and under-reported elapsed
    // time by however long the radiologist spent elsewhere.
    get().restoreCriticalSlaFor(id);
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
      // Typing is a clinical edit even though it takes no undo frame of its own — the editor keeps its
      // own history for that. Redoing an abandoned branch on top of it would delete what the
      // radiologist just wrote, with nothing left to step back to.
      patchRedoStack: [],
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
    // Owner ruling 1 (2026-10-18): a hand-written abnormal Conclusion and a
    // system-generated whole-study normal may not both stand on the page. The system's
    // own sentence withdraws — by recorded identity, so the only text it can reach is
    // the text the system wrote — and the radiologist's never does. Where even that
    // withdrawal is refused, the contradiction is flagged on the canvas rather than
    // left silent.
    let normalYieldRefusedByManual = false;
    if (f === "impression" && (!opts?.source || opts.source === "manual")) {
      const systemNormal = findSystemNormalPatch(get().appliedPathologyPatches);
      if (
        systemNormal?.lastRendered.impression?.trim()
        && reportAssertsAbnormality(get().appliedPathologyPatches, {
          findings: get().findingsText,
          impression: get().impressionText,
        })
      ) {
        const yielded = removeLedgerObservation(
          narrativeFromState(get()),
          get().fieldProvenance,
          toLedgerPatch(systemNormal),
        );
        if (yielded.outcome === "removed") {
          set({
            impressionText: yielded.narrative.impression,
            findingsText: yielded.narrative.findings,
            recommendationText: yielded.narrative.recommendation,
            techniqueText: yielded.narrative.technique,
            fieldProvenance: yielded.provenance,
            // Suspended, not deleted, and the approved wording is left untouched on the
            // row: ruling 3 restores a normal only where provenance and compatibility
            // justify it, and that question cannot be answered once the text is gone.
            appliedPathologyPatches: get().appliedPathologyPatches.map((p) =>
              p.id === SYSTEM_NORMAL_PATCH_ID
                ? { ...p, lastRendered: { ...p.lastRendered, impression: "" } }
                : p,
            ),
          });
        } else if (yielded.preservedManual) {
          normalYieldRefusedByManual = true;
        }
      }
    }
    // Snippet macros are detected here — before the derivation below — for one
    // reason: a macro with nothing to fill has nothing to wait for. Expanding it
    // inside this keystroke puts the sentence in the text that
    // `deriveImpressionDependency` is about to read, so a Findings macro moves the
    // Conclusion in the same stroke instead of one stroke late.
    //
    // Detection reads the CURRENT field text, not `v`: the system-normal withdrawal
    // above can rewrite this very field in this same call, and `applyMacroWithValues`
    // splices at `startPos` against whatever the field now holds. Arming a prompt with
    // a stale offset was already wrong; expanding with one would corrupt clinical text.
    if (f === "findings" || f === "impression" || f === "recommendation") {
      const atCaret = detectMacroTrigger(get()[key], scopedSnippetMacros(get));
      if (atCaret && atCaret.macro.variables.length === 0) {
        // No popover for these. The popover's focus `ref` attaches only to a text
        // input (macro-prompt-popover.tsx), so a macro with no input never gets
        // focus, and the "press Enter" it prints stays in the textarea as a newline
        // with the trigger left unexpanded. Routing through `applyMacroWithValues`
        // rather than a second writer keeps the signed-report refusal, the macro
        // provenance merge and the Copilot recompute on the path the Expand button
        // already used.
        set({ activeMacroPrompt: { macro: atCaret.macro, field: f, startPos: atCaret.startPos } });
        get().applyMacroWithValues({});
      } else if (atCaret) {
        set({ activeMacroPrompt: { macro: atCaret.macro, field: f, startPos: atCaret.startPos } });
      } else if (get().activeMacroPrompt) {
        set({ activeMacroPrompt: null });
      }
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
      set(deriveImpressionDependency(get(), ownsBoth ? { rebase: true } : undefined, {
        findingsJustChanged: f === "findings",
        // The one case where the system normal stayed and the Conclusion now says two
        // opposite things. Naming the reason is what puts the amber notice on the canvas;
        // the alternative is a silent contradiction reaching signed paper.
        arm: normalYieldRefusedByManual ? "impression-contradicts-findings" : undefined,
      }));
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
  toggleClinicalHistoryContribution: (phrase, selected, side) => {
    // The signed boundary is this section's own: a history box is a clinical
    // write like any other, and `setField` below would refuse silently.
    if (refuseSignedMutation(get(), "toggleClinicalHistoryContribution")) return "refused";
    const template = (phrase ?? "").trim();
    if (!template) return "refused";
    const before = get().clinicalHistoryText;
    let next = before;
    if (selected) {
      if (historyTemplateNeedsSide(template) && !(side ?? "").trim()) return "refused";
      // Duplicate-safe: a section that already says this is left alone.
      next = appendClinicalPhrase(before, resolveHistoryPhrase(template, side ?? ""));
    } else {
      // Only an exact contribution this action could have written is withdrawn, at
      // any side it may have been written with. A sentence the radiologist edited
      // is theirs and stays, which is the rule `removeClinicalPhrase` encodes.
      const present = historyPhraseVariants(template).find((p) => before.includes(p));
      if (present) next = removeClinicalPhrase(before, present);
    }
    if (next === before) return selected ? "applied" : "removed";
    const snap = captureClinicalSnapshot(get());
    get().setField("clinicalHistory", next, { source: "quick-findings" });
    set(withPushedClinicalUndo(get(), snap));
    return selected ? "applied" : "removed";
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
  stampTemplateApprovedNormal: ({ name, findings, impression }) => {
    const existing = get().startingCanvasBaseline;
    if (existing && existing.source !== "template") return false;
    if (!findings.trim()) return false;
    set({
      startingCanvasBaseline: {
        formatName: name,
        formatRevision: null,
        findings,
        impression,
        appliedAt: new Date().toISOString(),
        source: "template",
      },
    });
    return true;
  },
  setEditorContent: (c, preserved) => {
    // Normalize: API may return impression/recommendation as string[] or string
    const norm = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
    const findings = norm(c.findings);
    const impression = norm(c.impression);
    const recommendation = norm(c.recommendation);
    const technique = norm(c.technique);
    const clinicalHistory = norm(c.clinicalHistory);
    const state = get();
    // The trust boundary, not the caller's: a preserved map is only usable if its
    // context was verified AND names the study this store is on. A caller that
    // hand-built one, or one captured before a navigation, is ignored here rather
    // than trusted — which is how a previous patient's attribution could otherwise
    // land on an identical sentence in this patient's report.
    const carryAttribution = preserved != null
      && reportContextIsVerified(preserved.context)
      && sameReportId(preserved.context.studyId, state.activeStudyId);
    const provFor = (f: EditorField, text: string): FieldProvenanceMap => provenanceForRestoredField({
      previousText: state[fieldTextKey(f)],
      previousProvenance: state.fieldProvenance[f],
      restoredText: text,
      carryAttribution,
    });
    const nextProv = {
      findings: provFor("findings", findings),
      impression: provFor("impression", impression),
      recommendation: provFor("recommendation", recommendation),
      technique: provFor("technique", technique),
      clinicalHistory: provFor("clinicalHistory", clinicalHistory),
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
    // A sentence whose authorship cannot be established is labelled `manual`,
    // which protects it from automated removal. It is now carried over from the
    // recorded provenance only when the restore happened inside one verified
    // report — see `aiAttributionRestore` for the sentence-level rules.
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
  completeFinalize: () => { const id = get().activeStudyId; if (!id) { set({ isFinalizing: false }); return; } const c = new Set(get().completedStudyIds); c.add(id); const starts = { ...get().criticalSlaStarts }; delete starts[id]; set({ isFinalizing: false, isFinalized: true, completedStudyIds: c, lastSignAt: Date.now(), criticalSlaStartedAt: null, criticalSlaEscalated: false, criticalSlaStarts: starts }); /* Navigation after finalize is handled by the workspace page (React Router navigate),  not here — the store has no router access. */ },
  cancelFinalize: () => set({ isFinalizing: false }),
  advanceToNextStudy: () => { const { studies, completedStudyIds, activeStudyId, nextStudyId, nextStudyPreloaded } = get(); if (nextStudyId && nextStudyPreloaded) { get().selectStudy(nextStudyId); set({ nextStudyId: null, nextStudyPreloaded: false }); return; } const r = studies.filter(s => !completedStudyIds.has(s.id) && s.id !== activeStudyId); /* #1167 — the shared rank mirrors the server's triage doctrine (stat > emergency > urgent > vip > routine). The private map here had no emergency tier and tied vip with urgent. */ r.sort((a, b) => (studyPriorityRank(a.priority) - studyPriorityRank(b.priority)) || (a.tatMinutes - b.tatMinutes)); if (r[0]) { get().selectStudy(r[0].id); return; }
    // End of the queue — no study is open, so nothing clinical may remain. This
    // was a third hand-maintained reset list (4 of ~61 fields) and it left the
    // last reported study's ledger, undo stack, measurements and protocol
    // answers sitting in the singleton store.
    set({ ...emptyClinicalState(), activeStudyId: null, reportingContext: EMPTY_REPORTING_STUDY_CONTEXT });
  },
  dismissFatigueCard: () => set({ fatigueCardDismissed: true }),
  pushNotification: (n) => set({ notification: { ...n, id: Math.random().toString(36).slice(2) } }), clearNotification: () => set({ notification: null }),
  /* Both clock actions keep the per-study ledger in step with the scalar: start
   * records the finding's FIRST detection time for the active study (an
   * existing entry is left alone — re-detection after a switch back must not
   * restart the clock), clear retires it (the communication is recorded or the
   * clock was raised in error). */
  startCriticalSla: () => { const id = get().activeStudyId; const now = Date.now(); if (id) { const starts = get().criticalSlaStarts; if (starts[id] == null) set({ criticalSlaStartedAt: now, criticalSlaEscalated: false, criticalSlaStarts: { ...starts, [id]: now } }); else set({ criticalSlaStartedAt: starts[id], criticalSlaEscalated: false }); } else { set({ criticalSlaStartedAt: now, criticalSlaEscalated: false }); } },
  clearCriticalSla: () => { const id = get().activeStudyId; const starts = { ...get().criticalSlaStarts }; if (id) delete starts[id]; set({ criticalSlaStartedAt: null, criticalSlaEscalated: false, criticalSlaStarts: starts }); },
  escalateCriticalSla: () => set({ criticalSlaEscalated: true }),
  /* Re-project the incoming study's ledger entry into the active clock. Called
   * after every clinical reset that names an incoming study (store selectStudy,
   * useDraftPersistence's route-param transition). A study with no entry gets
   * a clean null clock — never the previous study's — and an entry older than
   * the SLA window restores as already-escalated, because the elapsed time is
   * what it is regardless of which screen was showing. */
  restoreCriticalSlaFor: (studyId) => { const key = studyId == null || studyId === "" ? null : String(studyId); const startedAt = key != null ? (get().criticalSlaStarts[key] ?? null) : null; if (startedAt == null) { set({ criticalSlaStartedAt: null, criticalSlaEscalated: false }); return; } set({ criticalSlaStartedAt: startedAt, criticalSlaEscalated: Date.now() - startedAt >= get().criticalSlaMinutes * 60_000 }); },
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
  generateProfessionalReport: (ctx, opts) => {
    // MODE A: the same engine, run without a press. `automatic` is not a second
    // code path for building the report — every string it writes is written the
    // same way — it is the set of things a press is allowed to do that a pass the
    // radiologist never asked for is not: claim a format use, notify, spend an undo
    // frame, rebuild a Conclusion they wrote, or bring back a normal they retired.
    const automatic = opts?.automatic === true;
    // MODE A's "no normal inferred to fill space" rule, enforced HERE rather than by
    // a second format lookup in the caller. Two lookups can disagree about which
    // normal this study got, and the disagreement is invisible — one of them decides
    // the report and the other decides whether to trust it.
    const requireOwnedApprovedNormal = opts?.requireOwnedApprovedNormal === true;
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
    // MODE A's rule, checked before the first write and here rather than in the
    // caller: the format this examination resolved to must be one the clinic OWNS as
    // its approved normal. A Templates row that happens to be called "MRI Brain
    // Plain" is prose somebody typed, not a baseline the department signed off, and
    // an automatic pass merging it is the "normal inferred to fill space" the
    // requirement forbids. A press is exempt — the radiologist chose that format.
    if (requireOwnedApprovedNormal && !hasOwnedApprovedNormal(format.baselineManifest)) {
      return {
        status: "refused",
        code: "no-owned-normal",
        reason: `“${format.name || "This format"}” is not this examination's approved normal, so the report will not rebuild itself onto it. Press Generate to build it anyway.`,
      };
    }
    const clinical = clinicalFieldsFromFormat(format);
    const undoSnap = captureClinicalSnapshot(get());
    const findingsBefore = get().findingsText;
    const patchCountBefore = get().appliedPathologyPatches.length;
    const flaggedBefore = get().impressionNeedsRefresh;
    // The four prose fields, not just Findings: an automatic pass that wrote
    // nothing must not look like a clinical edit to the undo stack, and a pass that
    // only reordered the Conclusion did write something.
    const proseBefore = [
      get().clinicalHistoryText,
      get().techniqueText,
      get().findingsText,
      get().impressionText,
      get().recommendationText,
    ].join("\u0000");
    const ledgerBefore = ledgerIdentity(get().appliedPathologyPatches);
    // Read before anything is written: these are the statements the report must
    // still make when the action finishes.
    const retained = radiologistObservations(get().appliedPathologyPatches);
    const freeTextBefore = unexplainedFindingLines(findingsBefore, get().appliedPathologyPatches);
    // Does this examination deviate from its approved normal? Decided once, from
    // what is on the page before the press, because it answers two separate
    // questions below: whether the format's own conclusion may be used at all,
    // and whether the conclusion has to be re-derived.
    const deviates = reportHasDeviation(get().appliedPathologyPatches, freeTextBefore);
    // Read before any write, because the pass itself changes provenance: once a
    // template has merged into the Conclusion, "who wrote this line" is no longer the
    // question the radiologist meant.
    const manualImpression = impressionProvenanceIsRadiologistManual(get().fieldProvenance.impression);
    // Which disc levels has the radiologist described in their own words? Those
    // are the levels the scaffold must stop describing for it: typing
    // "C5-C6: Disc herniation with cord compression." and pressing Generate used
    // to write the approved normal underneath it, including "C5-C6: No significant
    // disc bulge or protrusion is seen." — one report, both statements, nothing on
    // the page to say which the examination showed.
    //
    // What is NOT the radiologist's own words: a sentence this workspace inserted from
    // a structured tool. The canal AP grid merges a prose line naming the measured
    // levels, and reading that as a clinical description retired those levels' normals
    // — a number is a measurement, and "L3-L4: 11 mm" makes no claim about a disc.
    // `mergeField` has already attributed every sentence it wrote, so this reads the
    // provenance instead of guessing from the text.
    const companionLines = new Set(
      Object.entries(get().fieldProvenance.findings ?? {})
        .filter(([, sources]) => sources.includes("companion"))
        .map(([key]) => key),
    );
    const ownWordsBefore = freeTextBefore.filter(
      (line) => !companionLines.has(normalizeForDedupe(line)),
    );
    const contradictedLevels = levelsContradictedByUnexplainedLines(ownWordsBefore);
    const supersededNormalSentences = supersededBaselineTexts(
      format.baselineManifest?.observations ?? [],
      contradictedLevels,
    );
    /** True for a scaffold sentence this examination has already contradicted. */
    const supersededNormal = (line: string) => supersededNormalSentences.has(line.trim());

    // A normal the radiologist already retired must not walk back in.
    //
    // `supersededBaselineTexts` reads the manifest against the free text on the
    // page right now. So when a press retired a normal — its ledger row went
    // `stale`, its sentence left the Findings — and the contradicting sentence was
    // then edited away, the next pass finds nothing contradicted and merges the
    // normal straight back. Pressing Generate after doing that deliberately is the
    // radiologist asking for a rebuild; an automatic pass resurrecting a normal the
    // report had disowned is not, and it is invisible: one extra line in a block of
    // twenty, on a study that says the level is abnormal. Only automatic passes get
    // this guard, because only they have no press to attribute the rebuild to, and
    // it reads the retired row's own text rather than re-deriving anything.
    if (automatic) {
      for (const p of get().appliedPathologyPatches) {
        if (p.observation?.role !== "baseline" || !p.stale) continue;
        for (const retired of [p.lastRendered.findings, p.templates.findings]) {
          const text = (retired ?? "").trim();
          if (text) supersededNormalSentences.add(text);
        }
      }
      // And a normal the radiologist DELETED is theirs removed, not the format's to
      // re-issue. Measured before this existed: taking "Normal lumbar lordosis is
      // maintained." out of an auto-composed report put it back on the next pass,
      // because the merge reads the FORMAT rather than the page.
      //
      // The comparison is against the stamp this engine left at the end of its previous
      // pass — the only record of what it wrote — and the answer is REMEMBERED, because
      // recomputing it on the pass after next would find the line already gone from the
      // stamp too, and re-merge it. A press clears the list: that is the radiologist
      // asking for the approved normal rebuilt, which is what the press has always done.
      const removedNow = deletedScaffoldLines({
        lastStamped: get().startingCanvasBaseline?.findings ?? "",
        current: get().findingsText,
        scaffold: clinical.findings.split("\n"),
      });
      const rememberedNow = [...new Set([
        ...get().normalLinesRemovedByRadiologist,
        ...removedNow,
      ])];
      if (removedNow.size > 0) set({ normalLinesRemovedByRadiologist: rememberedNow });
      for (const text of rememberedNow) supersededNormalSentences.add(text);
    } else if (get().normalLinesRemovedByRadiologist.length > 0) {
      set({ normalLinesRemovedByRadiologist: [] });
    }

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
      // P0-2 (audit 2026-10-26): the linked study's region counts — a linked
      // dorsal+brain report describes two examinations, and the brain statement
      // merging beside the machine dorsal text is the only honest outcome.
      const regionCount = techniqueDecisionRegionCount({
        contextRegions: ctx.regions && ctx.regions.length ? ctx.regions : [ctx.region],
        primaryRegion: get().primaryFindingsSection?.region,
        linkedRegion: get().linkedStudy?.region,
      });
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
      && !alreadySaysThis(get().impressionText, clinical.impression)
      // A pass nobody pressed may not add the clinic's "this examination is normal"
      // sentence underneath a Conclusion the radiologist wrote. The findings scaffold
      // is still merged, because that is what Mode A is for and each normal line it
      // contradicts is retired on the way in; a conclusion is a claim about the whole
      // study, and two of them in one section is the contradiction this branch exists
      // to prevent. A press is exempt — the radiologist asked for the rebuild.
      && !(automatic && manualImpression)) {
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

    // No canal AP table is written into Findings here, on purpose. The press used to
    // append one for the segment the study resolved to, and that grid then *suppressed*
    // the printed table: a body carrying a valued canal grid is left exactly as it is,
    // so a level measured after this press never reached the report, and a Dorso-Lumbar
    // study printed only the segment the resolver favoured. The canal table is the print
    // renderer's job — drawn from `canalApProvenance` at the moment of printing, over
    // every segment the study measured (owner DECISIONS 1 and 2, 2026-10-17).
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
    let impressionHeld = false;
    if (deviates && (changed || flaggedBefore)) {
      // An automatic pass never rebuilds a Conclusion the radiologist wrote by hand.
      // `refreshImpressionFromLedger` obeys that itself when told the write was not
      // pressed, while a press still may — which is how the stale banner raised over
      // a manual Impression gets cleared.
      impressionHeld = get().refreshImpressionFromLedger({
        excludeBaselineObservations: true, automatic,
      }) === "held-empty";
    }
    get().orderImpressionByPriority();

    // Did this pass write anything? `pushClinicalUndoSnapshot` does not dedupe, so an
    // automatic pass over a report that already says everything it has to say would
    // bury the radiologist's real edits under no-op undo frames — one Ctrl+Z doing
    // nothing, twice over. A press always takes its frame, because a press is an
    // event the radiologist can point at.
    const wroteSomething = [
      get().clinicalHistoryText,
      get().techniqueText,
      get().findingsText,
      get().impressionText,
      get().recommendationText,
    ].join("\u0000") !== proseBefore
      || ledgerIdentity(get().appliedPathologyPatches) !== ledgerBefore;
    if (automatic && !wroteSomething) {
      // Nothing moved, so nothing is claimed: no format usage, no notification, no
      // canvas restamp, no undo frame. The report is already the report.
      return {
        status: "generated",
        formatName: format.name || "",
        baselineConcepts: 0,
        observationsRetained: retained.length,
        observationsNeedingReview: 0,
      };
    }

    set({
      ...withPushedClinicalUndo(get(), undoSnap),
      appliedFormatReportTitle: clinical.reportTitle || null,
      appliedFormatName: format.name || null,
      // The canvas BASELINE is the pristine approved normal, not the page this
      // pass leaves behind. Two readers depend on that and both were broken by
      // the mutated stamp this used to write (`get().findingsText`):
      //   - `removeObservation` restores a deselected tile's retired normal at
      //     its canonical anatomical position by looking the sentence up in
      //     `canonicalOrderFromText(canvas.findings)`. A stamp that already
      //     lost the retired sentence to a click cannot rank it, so after one
      //     automatic pass every deselect appended the restored normal at the
      //     END of the Findings — below L5-S1, outside its level block
      //     (measured: bulge + LF, one pass, deselect bulge, 2026-10-19).
      //   - the canvas-change overlay diffs the page against exactly this
      //     reference; a stamp matching the page erased the retirement diffs
      //     after the first pass, so the radiologist stopped seeing what the
      //     clicks had taken out.
      // `deletedScaffoldLines` still compares stamp to page and unions the
      // result into the remembered list, so the radiologist-deleted-normal
      // guard is unchanged. The applyFormatById door (Start Report) has always
      // stamped the format's own text; this is the same rule.
      startingCanvasBaseline: {
        formatName: format.name || "",
        formatRevision: format.baselineManifest?.revision ?? reportFormatRevision(format),
        findings: clinical.findings,
        impression: clinical.impression,
        appliedAt: new Date().toISOString(),
      },
      // No `isDirty` here on purpose. Every write this action can make goes through
      // mergeField or applyPathologyOverlay, and each one sets the flag itself. A
      // second, unconditional `isDirty: true` would mark a report dirty that had
      // nothing change — which is exactly what pressing this twice does.
    });
    getFormatApplyBridge()?.invalidatePendingAutosave?.();
    // An automatic pass claims nothing. The usage counter is how the clinic's
    // format library ranks itself, so a debounced engine running sixty times an hour
    // would report a radiologist preferring a format they never chose; and a
    // notification per pass is a ledger that scrolls faster than anyone can read.
    if (!automatic) {
      void bumpReportFormatUsage(format.id);
      get().pushNotification({
        kind: "ledger",
        text: needingReview > 0
          ? `Professional report built from “${format.name}”. ${needingReview} finding(s) need your review.`
          : `Professional report built from “${format.name}”.`,
      });
    }
    return {
      status: "generated",
      formatName: format.name || "",
      baselineConcepts: baselinePatches.length,
      observationsRetained: retained.length,
      observationsNeedingReview: needingReview,
      ...(impressionHeld ? { impressionHeld: true } : {}),
    };
  },
  /**
   * MODE A — the instant report. This is the debounced pass the workspace runs when
   * the observations move; it owns the decision and nothing else, delegating the
   * whole build to `generateProfessionalReport`, so there is one report engine and
   * one set of clinical rules, not two that can drift apart.
   *
   * `contentLocked` comes from the caller because the workspace's lock is wider than
   * the store's signed flag: another surface holding the report, or a study signed
   * elsewhere, never reaches the store as `isFinalized`. The generator's own signed
   * refusal still runs underneath this as the second line of defence.
   */
  composeInstantReport: (ctx, contentLocked) => {
    const state = get();
    // Which format this study resolves to, and whether the clinic owns it, is
    // decided inside the generator — never here. A second lookup would be a second
    // authority on the same question, and the two could answer differently while both
    // still looked correct in isolation: one decides the report, the other decides
    // whether the report may be rebuilt without being asked.
    const decision = decideInstantReport({
      enabled: readInstantReportEnabled(),
      contentLocked,
      confirmationOpen: state.confirmOverwriteOpen
        || !!state.pendingPathologyPatch
        || state.mergePreviewOpen,
      manualImpression: impressionProvenanceIsRadiologistManual(state.fieldProvenance.impression),
      foreignFindingsLines: unexplainedFindingLines(
        state.findingsText,
        state.appliedPathologyPatches,
      ).length,
      engineOwnsCanvas: !!state.startingCanvasBaseline
        && state.startingCanvasBaseline.source !== "template",
    });
    if (decision.action === "hold") {
      set({
        instantReportHold: holdIsReportable(decision.code)
          ? { code: decision.code, message: decision.message }
          : null,
      });
      return decision;
    }
    const outcome = get().generateProfessionalReport(ctx, {
      automatic: true,
      requireOwnedApprovedNormal: true,
    });
    if (outcome.status === "refused") {
      const hold = holdFromRefusal(outcome);
      set({ instantReportHold: hold.message ? hold : null });
      return { action: "hold", code: hold.code, message: hold.message };
    }
    // The Findings were rebuilt and the Conclusion deliberately was not, because
    // rebuilding it would have left the report with no conclusion at all. That is a
    // result the radiologist has to see, not a log line: the reason is the same
    // sentence the canvas chip and the store agree on.
    if (outcome.impressionHeld) {
      set({ instantReportHold: IMPRESSION_UNDECIDED_HOLD });
      return {
        action: "hold",
        code: IMPRESSION_UNDECIDED_HOLD.code,
        message: IMPRESSION_UNDECIDED_HOLD.message,
      };
    }
    set({ instantReportHold: null });
    return decision;
  },
  setInstantReportHold: (hold) => set({ instantReportHold: hold }),
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
      // Priority 1 hold semantics: the ask-first click wrote nothing — the
      // system-normal yield included, it sits below the gate — so there is no
      // frame of THIS click to undo. `undoLastPatch` here would eat the
      // radiologist's PREVIOUS legitimate action (the deselect that restored
      // the normal, the severity change before it). The force pass below runs
      // on the untouched pre-click report directly, pushes its own undo frame
      // for Ctrl+Z, and retires the user-owned normal on the authority this
      // confirm just granted.
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
      // CAT-P5, applied to this door (#168). A Full Normal Format carries a
      // whole-examination Conclusion. Writing it over a report that already asserts
      // an abnormality produces a report answering itself — "Moderate canal stenosis
      // at L4-L5." above "Normal MRI of the lumbosacral spine." — and the wholesale
      // replace here also DELETED the abnormal Conclusion the radiologist had
      // clicked, which the confirmation gate never warned him about because a
      // Quick Select sentence classifies as "generated", not as his own text. So
      // when the report asserts abnormality, this door reconciles instead of
      // replacing: his observations stay live, the format's anatomy merges in
      // additively, and the format's normal Conclusion is withheld — the same
      // outcome the click door reaches, from the same predicate.
      const assertsAbnormality = reportAssertsAbnormality(
        get().appliedPathologyPatches,
        { findings: get().findingsText, impression: get().impressionText },
      );
      // RULING 3 (#174) — the baseline is materialized BEFORE this door writes any text,
      // because the slots it is about to declare are exactly the ones the report's live
      // abnormality may already have retired. Measured on the shipped catalogue before
      // this, applying "MRI LS Spine — Standard Normal" over a clicked L4-L5 herniation
      // put "L4-L5: No significant disc bulge or protrusion is seen." back on the page
      // AND back on the ledger (39/39 normal lines, both rows live), so the Findings
      // section asserted the disc was normal three lines above the disc that is not.
      const baselineRegion = pendingRegion || get().reportingContext.region || f.bodyPart;
      const formatBaselinePatches = materializeFormatBaseline(f, baselineRegion).map((p) => ({
        id: p.id,
        ownership: ownershipFromObservation(p.observation),
        templates: p.templates,
        lastRendered: p.lastRendered,
        source: p.source,
        observation: p.observation,
        replacedBaseline: p.replacedBaseline,
        protected: p.protected,
      }));
      const normals = withdrawSupersededNormals({
        incoming: clinical.findings,
        baselineRows: formatBaselinePatches,
        livePatches: get().appliedPathologyPatches,
        assertsAbnormality,
      });
      // P0-2, 20-case audit 2026-10-26 — this door was the only format door with
      // NO replace-or-merge decision at all: it replaced the Technique field
      // wholesale, so applying the linked study's format erased the machine
      // statement of the examination the page also describes (the audit's
      // D-cases printed a brain-only Technique on every dorsal+brain study). It
      // now runs the same predicate the generate and merge doors run — replace
      // machine-authored text ONLY when the report describes one region,
      // counting the linked study's region; anything a person typed, dictated
      // or accepted merges beside, never below.
      const existingTechnique = get().techniqueText.trim();
      const replacesMachineTechnique = existingTechnique !== ""
        && mayReplaceMachineTechniqueWithApproved({
          techniqueText: get().techniqueText,
          provenance: get().fieldProvenance.technique,
          regionCount: techniqueDecisionRegionCount({
            contextRegions: get().reportingContext?.regions?.length
              ? get().reportingContext!.regions
              : [get().reportingContext?.region],
            primaryRegion: get().primaryFindingsSection?.region,
            linkedRegion: get().linkedStudy?.region,
          }),
        });
      if (existingTechnique && !replacesMachineTechnique && clinical.technique.trim()) {
        get().mergeField("technique", clinical.technique, "template");
      } else {
        get().setField("technique", clinical.technique, { source: "template", replaceProvenance: true });
      }
      if (assertsAbnormality) {
        get().mergeField("findings", normals.incoming, "template");
      } else {
        get().setField("findings", clinical.findings, { source: "template", replaceProvenance: true });
      }
      if (!assertsAbnormality) {
        get().setField("impression", clinical.impression, { source: "template", replaceProvenance: true });
      }
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
      //
      // In reconcile mode nothing is marked stale: the abnormal observations are the
      // report's clinical content now, and a stale row is dropped by the next rebuild
      // — so the saved-and-reopened report would come back normal under an abnormal
      // Findings section.
      const priorObservations = get().appliedPathologyPatches.filter(
        (p) => p.observation?.role !== "baseline" && !isSystemNormalPatch(p),
      );
      // RULING 3 — record on each abnormal observation's own record which normal sentence
      // this door withdrew for its sake. A deselection restores what the removed
      // observation declares, and it declares only `replacedBaseline` plus its canonical
      // claim; a door that withheld a sentence without saying so left the ledger holding a
      // live baseline row with no prose on the page.
      const stalePatches = assertsAbnormality
        ? claimRetiredBaselines(priorObservations, normals.suspended)
        : priorObservations.map((p) => ({ ...p, stale: true as const }));
      // A retired slot is SUSPENDED, not dropped: it goes stale with an empty
      // `lastRendered` and keeps its `templates`, which is the shape
      // `removeObservation` restores from (`stale` + baseline role + mutual exclusion).
      // Deselecting the herniation therefore returns this exact sentence, on this door
      // too, and nothing is invented on the way back.
      const retiredIds = new Set(normals.suspended.map((r) => r.id));
      const baselinePatches = formatBaselinePatches.map((p) => {
        if (retiredIds.has(p.id)) {
          return { ...p, stale: true as const, lastRendered: { ...p.lastRendered, findings: "", impression: "" } };
        }
        return assertsAbnormality && isSystemNormalPatch(p)
          ? { ...p, lastRendered: { ...p.lastRendered, impression: "" } }
          : p;
      });
      set({
        reportFormats: nf,
        confirmOverwriteOpen: false,
        pendingFormatIds: [],
        pendingFormatOverwrite: null,
        pendingFormatRegion: null,
        reportFormatPickerOpen: false,
        appliedPathologyPatches: [...stalePatches, ...baselinePatches],
        ownershipReviewWarnings: retainedNormalReviewWarnings(
          get().ownershipReviewWarnings,
          normals.retained,
        ),
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
            + (normals.withheld.length > 0
              ? ` Withheld ${normals.withheld.length} normal ${normals.withheld.length === 1 ? "statement" : "statements"} that the abnormality already on this report contradicts; deselecting that finding brings ${normals.withheld.length === 1 ? "it" : "them"} back.`
              : "")
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
    // The pendingPatch branch is a dismissal of a click that WROTE NOTHING
    // (Priority 1 hold semantics): the gate sits above the system-normal
    // yield, so while the dialog was open not one byte of the report moved —
    // no narrative, no ledger row, no undo frame, not even the yield. There is
    // nothing to restore and nothing to pop; the undo stack keeps the
    // radiologist's real history.
    //
    // No `refuseSignedMutation` here, and that is a measured absence, not an
    // omission: the function's entire payload is dialog state, which a signed
    // report must still be able to close (a modal that cannot be dismissed is
    // worse than one that dismisses having changed nothing — the rule the
    // confirm path keeps with its explicit refusal + clear). The clinical
    // safety comes from the gate itself: on a signed study the arming call
    // (`applyPathologyOverlay`) never reached this branch's pending state, so
    // there is no clinical write for a refusal to stop. When the hold was
    // installed this method left the finalized-mutation boundary's writer
    // population — the scanner's ratchet (finalizedMutationBoundary.hardening)
    // pins the new count, and askFirstHoldSemantics pins the hold itself.
    if (pendingPatch) {
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
    // written against (they fill `{chronicity}` / `{value}` themselves, upstream).
    // `level` (Phase 3, item B) joins them for the parameterized spine tiles:
    // validated by the same contract, resolved by the same substitution path.
    const sideForWrite: Side | "" = observation.supportsLaterality ? (opts.side ?? "") : "";
    const severityForWrite = isQuickSelectSource(opts.source)
      ? resolvedQuickSelectSeverity(opts.severity)
      : "";
    const levelForWrite = isQuickSelectSource(opts.source)
      ? resolvedQuickSelectLevel(opts.level)
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
        { side: sideForWrite, severity: severityForWrite, level: levelForWrite },
      );
      if (unresolved.length > 0) {
        console.warn(
          `[care] applyPathologyOverlay refused: "${opts.label ?? opts.id}" needs ${unresolved.join(", ")}`,
        );
        announceQuickSelectParameterRefusal(unresolved);
        return "refused";
      }
    }

    const incoming = applySideToIncoming(templates, sideForWrite, severityForWrite, levelForWrite);

    // The side/severity guard above refuses the two tokens this boundary can
    // resolve from a chip. `applySideToIncoming` → `fillTemplate` also drops the
    // three tokens it knows but has no value for (`{chronicity} {level} {value}`).
    // A `{name}` that survives substitution is neither: it is a parameter this
    // boundary was never given and no chip offers — `{size}`, `{location}`,
    // `{grade}`, `{vessel}` — and writing it would print the literal brace into
    // Findings/Impression/Recommendation. Refusing here is the property the audit
    // brief asked for — no unresolved `{token}` reaches a report section, whatever
    // its name — and it sits behind the dialog fix, so a box resolved through
    // `fillStructuredTemplate` has no brace left to trip it. Still a refusal, so
    // nothing below runs: no ledger row, no prose, no provenance, no undo frame.
    if (isQuickSelectSource(opts.source)) {
      const leaked = unresolvedQuickSelectPlaceholders(incoming);
      if (leaked.length > 0) {
        console.warn(
          `[care] applyPathologyOverlay refused: "${opts.label ?? opts.id}" has unresolved {${leaked.join("}, {")}}`,
        );
        announceQuickSelectPlaceholderRefusal(leaked);
        return "refused";
      }
    }

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
    // This decision is based on the incoming patch's CONCEPT and, where the
    // concept registry has no opinion, on its own conclusion sentence read by the
    // same classifier the print surface uses to bold a finding — NOT on hunting the
    // Impression field for normal-looking words. What is withdrawn stays scoped to
    // the system normal patch's recorded contribution either way.
    //
    // The sentence arm exists because eight of the twenty-two shipped lumbar boxes
    // carry a concept the registry does not flag (facet arthropathy, ligamentum
    // flavum hypertrophy, reduced disc height, disc desiccation, Modic, Schmorl):
    // with the concept test alone their conclusion printed BENEATH "Normal MRI of
    // the lumbosacral spine." — one section asserting the study was normal and the
    // next asserting it was not (CAT-P5).
    let normalYieldRefusedByManual = false;
    // Priority 1 hold semantics: the system-normal auto-yield that used to run
    // HERE has moved BELOW the ask-first gate, together with its comment. It is
    // the only write that can precede the ambiguity decision, and a click that
    // is about to ask must not withdraw the study's normal conclusion before
    // the radiologist has said Replace — the pending branch now provably writes
    // nothing, and a cancel is a pure dismissal with nothing to restore.

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
    // A clicked normal is a claim to test, not a claim to insert (owner ruling,
    // 2026-10-19). Computed against the FULL live ledger here, before the same-slot
    // plan, because the plan itself is the second half of the defect: a normal tile
    // that shares a mutex slot with a live abnormal (`Normal ventricles` vs
    // `Hydrocephalus`, both concept `ventricles`) used to take the slot over and
    // silently evict the abnormal's finding from the report while its row vanished
    // from the ledger. A normal claim never evicts a live abnormal: the takeover is
    // refused, the abnormal stays live, its contribution stays fenced in the prose
    // walk below, and the normal's owned sentences are withheld instead — which is
    // exactly what the other click order does to them.
    const withheldNormal = withheldIncomingNormalSentences({
      incoming,
      livePatches: get().appliedPathologyPatches.filter((p) => p.id !== draftId && !p.stale),
    });
    const planRaw = planSameSlotReplacement({
      incoming: observation,
      incomingFindings: incoming.findings,
      incomingImpression: incoming.impression,
      siblings: slotSiblings,
      contributionIsManual,
      force: opts.force,
    });
    // Refuse the takeover only when the row being vacated is one of the abnormal
    // observations that own the normal's sentences. A re-click of the normal itself
    // (noop) and an honest normal-vs-normal slot update keep today's semantics.
    const refusedNormalOverAbnormalTakeover = Boolean(
      withheldNormal
      && planRaw.action === "update"
      && withheldNormal.perSentence.some((w) => w.ownerIds.includes(planRaw.existingId))
    );
    const plan: typeof planRaw = refusedNormalOverAbnormalTakeover
      ? { action: "insert", reason: "no-sibling" }
      : planRaw;

    // C3 — the row whose slot the incoming tile is taking over, read in full
    // (plan.existing is the sibling PROBE: id + observation + lastRendered only,
    // no templates, no replacedBaseline). Its inherited `replacedBaseline` is the
    // SLOT's lineage — the normal the first abnormal in this chain retired — and
    // its own wording is the intermediate abnormal prose a later deselect must
    // never resurrect. Null on insert; on a re-click of the same row it IS the
    // surviving row, which is the replay case the priorRow lookup already
    // covers.
    const vacatedRow = plan.action === "update"
      ? get().appliedPathologyPatches.find((p) => p.id === plan.existingId) ?? null
      : null;

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
      //
      // P1-a, 20-case audit 2026-10-26 — MERGE, never overwrite. The old
      // `inherited || declared` chain let the vacated row's own text DISPLACE
      // the incoming tile's declared claim: "Disc herniation L4-L5" took over
      // the scaffold's disc-contour slot, inherited
      // "L4-L5: No significant disc bulge or protrusion is seen.", and its
      // declared canal claim ("L4-L5: No spinal canal or thecal sac
      // compression is seen.") never reached the ownership matcher — so the
      // page printed the canal normal beside the very prose that indents the
      // thecal sac (the audit's L2). Both claims are legitimate retirements —
      // one covers the row the tile superseded, the other the sentence the
      // tile's curation says it contradicts — and `baselineClaimCovers`
      // already reads a multi-sentence claim part-by-part, so the join is the
      // honest union. Deduped on the rendered text: a claim that names the
      // row's own sentence twice changes nothing.
      if (plan.existing.observation.role === "baseline") {
        const inheritedClaim =
          (plan.existing.lastRendered.findings || plan.existing.lastRendered.impression || "").trim();
        const declaredClaim = (observation.baselineReplaces ?? "").trim();
        const parts = [inheritedClaim, declaredClaim]
          .filter(Boolean)
          .filter((part, i, arr) => arr.indexOf(part) === i);
        observation = {
          ...observation,
          ...(parts.length > 0 ? { baselineReplaces: parts.join("\n") } : {}),
          role: "finding",
        };
      }
    } else {
      observation = { ...observation, id: stableId };
    }
    const ownership = ownershipFromObservation(observation);

    const dropIds = new Set<string>([stableId]);
    if (plan.action === "update") {
      dropIds.add(plan.existingId);
      for (const id of plan.supersededIds) dropIds.add(id);
    } else if (!refusedNormalOverAbnormalTakeover) {
      // Unstructured / no sibling: keep prior mutex drop for callers that
      // still pass matching conflictGroup without a resolved concept — rare.
      // A refused normal-over-abnormal takeover falls through empty-handed on
      // purpose: the abnormal rows it would drop are the ones whose findings
      // must stay on the page, stay fenced in the prose walk, and stay live as
      // the owners whose deselect restores the normal.
      for (const p of get().appliedPathologyPatches) {
        if (p.id === stableId) continue;
        const other = toLedgerPatch(p).observation;
        if (observationsMutuallyExclusive(observation, other)) dropIds.add(p.id);
      }
    }

    // `let` for the ask-first hold: when the commit path's system-normal yield
    // (below the gate) removes the study's normal conclusion, the local pair is
    // refreshed to the post-yield page so every later reader — section routing,
    // the claim walk, lastRendered — sees exactly what it saw when the yield
    // still ran before the overlay.
    let narrative = narrativeFromState(get());
    let provenance = get().fieldProvenance;
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
    // Rebuilt from the (possibly post-yield) narrative on the commit path —
    // same construction, so the routed section body is always read against
    // the page as it stands when the overlay runs.
    const overlayNarrativeFor = (n: ReportNarrative) => routedSectionId
      ? { ...n, findings: sectionBefore }
      : n;
    const overlayNarrative = overlayNarrativeFor(narrative);
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
    // Priority 1 hold semantics: the reassignment event is the viewer's signal
    // that evidence has MOVED to the survivor row. On the pending path nothing
    // has moved yet — the dialog owns the decision — so the dispatch is held
    // with the write and fires only from the commit branch below (and again on
    // the confirm pass, which re-runs this code with authority).
    let pendingReassignmentEvent: { fromObservationId: string; toObservationId: string } | null = null;
    if (vacatedId && vacatedId !== stableId) {
      const remapped = remapStructuredMeasurementsObservationId(
        nextMeasurements,
        vacatedId,
        stableId,
      );
      nextMeasurements = remapped.state;
      if (remapped.remapped > 0) {
        pendingReassignmentEvent = { fromObservationId: vacatedId, toObservationId: stableId };
      }
    }

    const needsSlotConfirm = plan.action === "update" && plan.requiresConfirmation && !opts.force;

    // The retirement half of the shared contradiction rule — an abnormal clicked
    // second withdrawing the normal it falsifies — has always lived in the overlay
    // below; `withheldNormal` (computed above, before the same-slot plan) is the
    // missing reverse half: a normal clicked onto a page that already asserts an
    // abnormality never re-adds the sentence that abnormal owns. Same judge
    // (prepareNormalSupersession via abnormalSlotOwners), same retirement record
    // (replacedBaseline on the owning row, written after the overlay), so a deselect
    // and the Mode A replay bring the normal back through the one shipped mechanism,
    // and the two click orders print the same page.
    const overlayIncoming = withheldNormal ? filterWithheldFromIncoming(incoming, withheldNormal) : incoming;
    const placeIncomingAfter = withheldNormal
      ? anchorContributionForWithheld(patches, withheldNormal, overlayNarrative.findings)
      // An abnormal whose in-place slot a live sibling already took (both tiles
      // retire one baseline sentence without sharing a conflict group) anchors
      // after that sibling's contribution — the shared slot — so the finding
      // prints beside its neighbour in EITHER click order instead of at the
      // report tail in one of them (measured: the two 11-line census pairs,
      // 2026-10-19).
      : anchorAfterRetiredBaselineOwner(patches, incoming, ownership, overlayNarrative.findings);

    // The overlay, in one place, so the ask-first probe and the post-yield
    // commit pass are byte-identical computations — the probe decides the gate,
    // the commit pass is the one whose result is kept. `baseNarrative` is the
    // UNROUTED page (its `findings` is only read by the routed merge below).
    const runOverlay = (
      overlayExisting: ReportNarrative,
      overlayProvenance: FieldProvenanceState,
      baseNarrative: ReportNarrative,
    ) => {
      const overlayResult = overlayPathology({
        existing: overlayExisting,
        incoming: overlayIncoming,
        ownership,
        provenance: overlayProvenance,
        source: opts.source,
        // `plan.action === "update"` authorises taking over the ROW this slot points
        // at, which the same-slot machinery below already does. It is not authority
        // over the radiologist's prose: `force` is the single flag that lets
        // `applyPathologyPatch` evict a provenance-protected sentence, so implying it
        // here deleted a hand-typed Impression line whenever a tile's own slot claimed
        // that sentence (#180). The collision now takes the path built for it —
        // `ambiguous` → the overwrite dialog — so the replacement stays his decision.
        force: opts.force,
        // Phase 5 — the sentence fence. `patches` is already the ledger with this
        // observation and its mutex siblings removed, so what is left is exactly the
        // other live findings whose words must survive this click.
        liveRows: patches,
        ...(placeIncomingAfter ? { placeIncomingAfter } : {}),
        ...(withheldNormal
          ? { withheldIncoming: withheldNormal.perSentence.map((w) => normalizeForDedupe(w.sentence)) }
          : {}),
      });
      if (routedSectionId) {
        const sectionAfter = overlayResult.narrative.findings;
        overlayResult.narrative.findings = replaceFindingsSectionBody(
          baseNarrative.findings,
          sectionList,
          routedSectionId,
          sectionAfter,
        );
        overlayResult.provenance = {
          ...overlayResult.provenance,
          findings: mergeScopedFindingsProvenance({
            previous: overlayProvenance.findings,
            sectionBefore,
            sectionAfter,
            sectionProvenance: overlayResult.provenance.findings,
          }),
        };
      }
      return overlayResult;
    };

    // The PROBE pass — pure, pre-yield, nothing has been written. It answers one
    // question: does this click have to ask? Its `result` is kept only when no
    // yield runs below; the commit path recomputes against the post-yield page.
    let result = runOverlay(overlayNarrative, provenance, narrative);

    if ((result.ambiguous || needsSlotConfirm) && !opts.force) {
      // Priority 1 — never insert the abnormal while its conflicting normal is
      // awaiting the radiologist's answer. The branch used to write the merged
      // narrative AND park the ledger row BEFORE the dialog, so the pending
      // state showed a Findings section asserting a thing and its own negation
      // (the contradiction lint fired at the study while the decision was still
      // open), and "closing the dialog" had to undo its way back through a
      // write the radiologist never authorised. The ask-first gate is now a
      // HOLD, not a preview-write: nothing is written — no prose, no ledger
      // row, no measurements, no undo frame, no dirty flag, no selection, no
      // section routing, not even the system-normal yield below — until Replace
      // is pressed. "Keep existing" then means exactly what it says: the
      // report is byte-identical to what the radiologist was reading, and a
      // cancel is a pure dismissal with nothing to restore. The overlay stays
      // pure: `result` is read here for the gate only, recomputed by the commit
      // pass, and discarded by cancel.
      set({
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
          manualKept: result.manualKept,
        },
      });
      return "pending";
    }

    // PR #662 §2 — System normal auto-yield (MOVED below the ask-first gate).
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
    // This decision is based on the incoming patch's CONCEPT and, where the
    // concept registry has no opinion, on its own conclusion sentence read by
    // the same classifier the print surface uses to bold a finding — NOT on hunting the
    // Impression field for normal-looking words. What is withdrawn stays scoped to
    // the system normal patch's recorded contribution either way.
    //
    // The sentence arm exists because eight of the twenty-two shipped lumbar boxes
    // carry a concept the registry does not flag (facet arthropathy, ligamentum
    // flavum hypertrophy, reduced disc height, disc desiccation, Modic, Schmorl):
    // with the concept test alone their conclusion printed BENEATH "Normal MRI of
    // the lumbosacral spine." — one section asserting the study was normal and the
    // next asserting it was not (CAT-P5).
    //
    // Placement: after the gate, because the gate decision (the probe above) is
    // yield-invariant — the system conclusion is never manual-protected when the
    // yield removes it, so the probe's ambiguity answer equals the post-yield
    // one. The recompute below is what keeps the commit byte-identical to the
    // old yield-first order: the overlay re-runs against the post-yield page,
    // the same page it always ran against.
    if (
      opts.source !== "system"
      && (incoming.impression ?? "").trim()
      && incomingStatesAbnormalImpression(observation.concept, observation.role, incoming.impression)
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
          // Refresh the locals to the post-yield page and re-run the overlay
          // against it — the exact state the old order computed against. The
          // probe is discarded, together with the claims it would have made
          // about a page the yield has just left.
          narrative = yieldResult.narrative;
          provenance = yieldResult.provenance;
          patches = patches.map((p) =>
            p.id === SYSTEM_NORMAL_PATCH_ID
              ? { ...p, lastRendered: { ...p.lastRendered, impression: "" } }
              : p,
          );
          result = runOverlay(overlayNarrativeFor(narrative), provenance, narrative);
        }
        // The normal words on the page are the radiologist's own by then, so the
        // yield refused and nothing was deleted. Deleting them is not an option
        // this system ever has; leaving the contradiction silent is. Arming the
        // dependency is what puts the amber "Impression needs refresh" and the
        // named reason on the canvas, which is how the doctor is told the
        // Conclusion still says normal above a finding that is not normal.
        if (yieldResult.outcome === "preserved-manual") {
          normalYieldRefusedByManual = true;
        }
      }
    }

    if (pendingReassignmentEvent && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("care:observation-reassigned", {
        detail: pendingReassignmentEvent,
      }));
    }
    const snap = captureClinicalSnapshot(get());
    const replaced = splitReplacedByField(result.replacedSentences, narrative);
    // The Impression sweep's retirements are Impression sentences by construction, so
    // they join the Impression claims directly — the substring test above would route
    // a normal label that also appears in the Findings body to the wrong field, and a
    // claim on the wrong field is text deselection restores to the wrong place.
    for (const retired of result.impressionRetired) {
      const key = normalizeForDedupe(retired);
      if (!key) continue;
      if (replaced.impression.some((s) => normalizeForDedupe(s) === key)) continue;
      replaced.impression.push(retired);
    }
    // A row can never be the baseline it replaced.
    //
    // Mode A's automatic pass replays the ledger through this same writer 700 ms after
    // a click. By then the tile's own sentence is on the page, and the ownership walk in
    // `overlayPathology` counts every sentence this tile owns — including the one it
    // wrote — as replaced. The re-apply therefore recorded the tile's own wording as the
    // normal it superseded and dropped the real claim, so the next deselection deleted
    // the sentence and put it straight back: a Quick Select box that comes off the
    // ledger but never comes off the report, in Findings and in the Impression (#167,
    // measured on study 17 in the browser and reproduced against the store).
    // The claim an earlier click recorded is carried forward instead, because a replay
    // replaces nothing that the first click did not already replace.
    const priorRow = get().appliedPathologyPatches.find((p) => p.id === stableId);
    const ownWording = new Set<string>();
    for (const text of [
      incoming.findings, incoming.impression, incoming.technique, incoming.recommendation,
      templates.findings, templates.impression, templates.technique, templates.recommendation,
      priorRow?.lastRendered.findings, priorRow?.lastRendered.impression,
      priorRow?.lastRendered.technique, priorRow?.lastRendered.recommendation,
      // C3: the vacated sibling's own words count as "already said" for this
      // click as well — bulge → protrusion must not record the bulge's sentence
      // as a claim deselect could restore, only the bulge row's own inherited
      // claims. A BASELINE row is exempt, because a baseline's wording IS the
      // claim its takeover must keep restorable (normal → abnormal is the
      // primary journey; the takeover is what records the normal).
      ...(vacatedRow && vacatedRow.observation?.role !== "baseline" ? [
        vacatedRow.lastRendered.findings, vacatedRow.lastRendered.impression,
        vacatedRow.lastRendered.technique, vacatedRow.lastRendered.recommendation,
        vacatedRow.templates.findings, vacatedRow.templates.impression,
        vacatedRow.templates.technique, vacatedRow.templates.recommendation,
      ] : []),
    ]) {
      const trimmed = (text ?? "").trim();
      if (!trimmed) continue;
      for (const s of splitToSentences(trimmed)) {
        const key = normalizeForDedupe(s);
        if (key) ownWording.add(key);
      }
    }
    const isNotItsOwnWording = (sentence: string): boolean => {
      const key = normalizeForDedupe(sentence);
      if (!key) return false;
      // The probe may carry its line's level prefix ("L4-L5: …"), which the tile's own
      // contribution does not, so both forms are compared before one is called self.
      const unprefixed = key.replace(/^[a-z0-9]+(?:-[a-z0-9]+)?:\s+/, "");
      const said = ownWording.has(key) || ownWording.has(unprefixed);
      if (!said) return true;
      // C3's filter exists to keep a chain's intermediate ABNORMAL wording out
      // of the claim a deselect restores — bulge → protrusion must never
      // resurrect the bulge sentence. A NORMAL statement the vacated row
      // rendered is not that: it IS the claim (a normal tile's own sentence,
      // restated by this walk), and filtering it is how the ventricles →
      // hydrocephalus journey lost the ventricles normal on deselect and came
      // back empty (the R5 regression the ownership matrix caught). Normal
      // wording stays recordable; abnormal wording never does.
      if (assertsNormalStatement(sentence)) return true;
      return false;
    };
    const claimBaseline = (carried: string[], fresh: string[]): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const s of [...carried, ...fresh.filter(isNotItsOwnWording)]) {
        const key = normalizeForDedupe(s);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(s);
      }
      return out;
    };
    // C3 — lineage belongs to the slot, not to whichever abnormal last sat on
    // it. A same-slot update carries the VACATED row's inherited claims
    // forward, so bulge → protrusion → deselect restores the original normal
    // instead of the intermediate abnormal's wording (owner directive: never
    // restore intermediate abnormal wording after deselection). A re-click of
    // the row itself has no vacated sibling and keeps today's priorRow carry.
    const lineageRow = vacatedRow ?? priorRow;
    // A SHARED study-wide claim is recorded on every row that falsifies it,
    // not only on the row whose click happened to retire it first. The walk
    // above records a retirement on the row that found the sentence on the
    // page — "Lumbar facet joints are unremarkable." goes on the L4-L5 facet
    // row and never on L5-S1's, because by the time the second tile is clicked
    // the sentence is already gone. Deselect restoration is then
    // order-dependent: leave L4-L5 first and its record leaves with the row,
    // so when L5-S1 goes last there is nothing left to restore and the normal
    // the study still needs is lost for good. The normalSuppression oracle is
    // the shipped answer to "two abnormalities, one normal" (its header), and
    // this is its walk-derived half: a claim a LIVE sibling row carries that
    // this observation ALSO falsifies on its own terms is inherited here, so
    // the LAST row out can restore it whichever order the tiles leave in.
    // Only falsified claims are inherited — never the sibling's own wording,
    // never a claim of a concept this tile has no stake in — and suppression
    // on deselect is decided by the SURVIVING set (`filterRestorableBaselines`),
    // so the same claim recorded twice can never print twice: it only decides
    // which row is allowed to bring it back when no row is left to falsify it.
    const sharedClaimCarrier: SuppressingObservation = {
      baselineReplaces: observation.baselineReplaces || null,
      concept: observation.concept ?? null,
      level: observation.level || null,
      renderedText: incoming.findings ?? null,
      role: observation.role ?? null,
      laterality: observation.laterality || null,
    };
    const inheritedClaims = (field: "findings" | "impression"): string[] => {
      if (!hasStructuredOwnership(observation)) return [];
      const out: string[] = [];
      const seen = new Set((lineageRow?.replacedBaseline?.[field] ?? []).map(normalizeForDedupe));
      for (const p of patches) {
        if (p.stale) continue;
        for (const claim of p.replacedBaseline?.[field] ?? []) {
          const key = normalizeForDedupe(claim);
          if (!key || seen.has(key)) continue;
          if (!falsifies(sharedClaimCarrier, claim)) continue;
          seen.add(key);
          out.push(claim);
        }
      }
      return out;
    };
    const replacedBaseline = {
      findings: claimBaseline(
        [...(lineageRow?.replacedBaseline?.findings ?? []), ...inheritedClaims("findings")],
        replaced.findings,
      ),
      impression: claimBaseline(
        [...(lineageRow?.replacedBaseline?.impression ?? []), ...inheritedClaims("impression")],
        replaced.impression,
      ),
    };
    // What THIS box wrote, judged against the approved normal the study opened
    // with rather than the page the click landed on — see `renderedInField`.
    // `lastRendered` is exactly what deselection removes, so over-claiming here
    // deletes a normal the box never owned, and under-claiming leaves a finding
    // printed with no row left to take it off.
    const approvedNormal = get().startingCanvasBaseline;
    const lastRendered: PathologyIncoming = {
      findings: renderedInField(incoming.findings, result.narrative.findings, approvedNormal?.findings),
      impression: renderedInField(incoming.impression, result.narrative.impression, approvedNormal?.impression),
      // Technique and Recommendation are not part of the canvas baseline, so
      // there is no normal to judge them against and they keep the plain
      // presence inference exactly as it was.
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
      replacedBaseline,
      // Same-slot auto-update clears prior protected flag; confirm path may restore via undo.
      protected: false,
    };
    // The withheld sentences are recorded ON the abnormal rows that own them — the
    // same `replacedBaseline` contract the retirement half writes — so deselecting
    // the abnormal and the Mode A replay restore the normal through the shipped
    // mechanism instead of leaving a ledger row whose words never return.
    const nextPatches = withheldNormal
      ? claimWithheldIncomingNormals([...patches.filter((p) => p.id !== stableId), nextPatch], withheldNormal)
      : [...patches.filter((p) => p.id !== stableId), nextPatch];
    // C4 — the vacated sibling's advice leaves with it. The deselect path strips a
    // row's own recommendation through removeLedgerObservation → stripContribution;
    // a same-slot update dropped the row from the ledger without that strip, so the
    // report kept advising about a finding it no longer contained. Same helper, same
    // rules, same order: strip what the vacated row rendered, then the alignment
    // below re-adds any surviving row's advice — which is exactly how a deselection
    // keeps a sentence another live box also owns. Hand-edited advice is the
    // strip's own provenance case and stays.
    if (vacatedRow && !vacatedRow.stale && (vacatedRow.lastRendered.recommendation ?? "").trim()) {
      const adviceStripped = stripContribution(
        result.narrative.recommendation,
        vacatedRow.lastRendered.recommendation,
        result.provenance.recommendation,
      );
      if (
        adviceStripped.outcome !== "preserved-manual"
        && adviceStripped.text !== result.narrative.recommendation
      ) {
        const afterAdviceStrip = { ...result.narrative, recommendation: adviceStripped.text };
        result.provenance = dropProvenanceForRemoved(
          result.provenance,
          result.narrative,
          afterAdviceStrip,
        );
        result.narrative = afterAdviceStrip;
      }
    }
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
    // (The ask-first gate and the system-normal yield both live ABOVE, right
    // after the overlay probe — nothing between here and the commit writes.)
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      findingsText: result.narrative.findings,
      impressionText: result.narrative.impression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: result.provenance,
      isDirty: true,
      ...(opts.skipUndoSnapshot ? { lastPatchSnapshot: get().lastPatchSnapshot, patchUndoStack: get().patchUndoStack, patchRedoStack: get().patchRedoStack } : withPushedClinicalUndo(get(), snap)),
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
    // CAT-P5, refused: the normal wording this click could not delete is the
    // radiologist's own, so it stays exactly where they left it. What must not stay
    // is the silence — arming the named contradiction reason is what puts the review
    // prompt on the canvas and into the sign dialog, which is how the doctor learns
    // the Conclusion still calls the study normal above a finding that does not.
    if (normalYieldRefusedByManual) {
      set(deriveImpressionDependency(get(), undefined, {
        arm: "impression-contradicts-findings",
      }));
      return "applied";
    }
    // The Conclusion this click composed is ordered by clinical priority rather
    // than by the order the boxes were pressed, and each statement stays on the line
    // it was authored on (§158, CAT-P4). A radiologist who has hand-ordered the field
    // has frozen both, and this is a no-op for them.
    get().orderImpressionByPriority();
    set(deriveImpressionDependency(get(), ownsImpressionSide ? { rebase: true } : undefined));
    return "applied";
  },
  previewPathologyOverlay: (opts) => {
    // The read-only half of `applyPathologyOverlay` (Phase 3, item C): build the
    // exact observation a click builds, run the exact refusal guards a click
    // runs, then answer which live normal sentences the two oracles would
    // retire — and write NOTHING. No ledger row, no prose, no provenance, no
    // undo frame, no dirty flag, and no toast: a hover preview must not be
    // indistinguishable in the console from a refused clinical write, so the
    // signed guard here is the plain `isFinalized` read the witness wraps.
    const empty = { retiredFindings: [], retiredImpression: [], vacatedFindings: [], vacatedImpression: [], nothingRetires: true };
    if (get().isFinalized) return { ...empty, refusal: "signed" };
    const templates = opts.templates ?? opts.incoming;
    const observation = observationFromPending(
      { ...opts, id: opts.id ?? "preview_patch" },
      get().reportingContext.region,
      get().activeAnchor,
      get().studyComposition,
    );
    const sideForWrite: Side | "" = observation.supportsLaterality ? (opts.side ?? "") : "";
    const severityForWrite = isQuickSelectSource(opts.source)
      ? resolvedQuickSelectSeverity(opts.severity)
      : "";
    const levelForWrite = isQuickSelectSource(opts.source)
      ? resolvedQuickSelectLevel(opts.level)
      : "";
    const unresolved = unresolvedQuickSelectParameters(templates, { side: sideForWrite, severity: severityForWrite, level: levelForWrite });
    if (unresolved.length > 0) {
      return { ...empty, refusal: `unresolved: ${unresolved.join(", ")}` };
    }
    const incoming = applySideToIncoming(templates, sideForWrite, severityForWrite, levelForWrite);
    const leaked = unresolvedQuickSelectPlaceholders(incoming);
    if (leaked.length > 0) {
      return { ...empty, refusal: `unresolved placeholders: ${leaked.join(", ")}` };
    }
    const preview = previewQuickSelectRetirement({
      observation,
      incoming,
      livePatches: get().appliedPathologyPatches,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
    });
    return preview;
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
  refreshImpressionFromLedger: (opts?: { excludeBaselineObservations?: boolean; automatic?: boolean }) => {
    // Six callers. Four are already gated: two handlers in useWorkspaceClinicalUi
    // open with `if (contentLocked) return`, ReportCanvas hands the warning strip
    // `disabled={contentLocked}`, and XrayLsSpineCanvas reaches it only
    // when applyMacroBundle returned "applied" — which is now "blocked" on a signed
    // study. The sign dialog's opener is disabled once signed too, but a dialog
    // left open across signing still reaches this, and so does the derived-
    // impression effect in useWorkspaceClinicalUi, which nothing gates at all.
    // Those two are what this refuses: a silent rewrite of a signed Impression.
    // Its refusal is reported by `refuseSignedMutation` itself — the shared witness
    // every signed writer is contract-tested against — so this arm returns nothing on
    // purpose. `finalizedMutationBoundary.hardening.test.ts` pins that.
    if (refuseSignedMutation(get(), "refreshImpressionFromLedger")) return;
    // A silent refresh never touches a Conclusion the radiologist wrote. The
    // derived-impression effect checked this at its own call site, which made it a
    // rule one caller obeyed rather than a property of the action — and this action
    // re-splits the field it writes (`splitToSentences` → lines joined with "\n"),
    // so reaching it by any other route rebuilt a hand-written sentence into pieces
    // and appended to it. Measured on main with the effect's own arguments:
    // "No acute infarction. Chronic small vessel disease only." came back as three
    // lines, the third one a finding the doctor had dictated and never concluded.
    // The controls the doctor presses are still allowed to rewrite it — that is how
    // they clear the stale banner a manual Impression raises.
    if (opts?.automatic && impressionProvenanceIsRadiologistManual(get().fieldProvenance.impression)) return "held-protected";
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
    //
    // What the automatic path takes from those leftovers is only what names a
    // recognised abnormality. Everything else stays a finding, where the
    // radiologist wrote it, until they press a control that asks for prose to be
    // summarised — because the alternative rule is a character count, and a
    // sentence's clinical significance is not its length.
    const leftovers = unexplainedFindingLines(get().findingsText, get().appliedPathologyPatches).join("\n");
    const candidates = opts?.automatic
      ? cuedAbnormalSentences(leftovers)
      : suppressInventedNormalOverAbnormality(generateLocalImpression(leftovers), get());
    /**
     * Owner ruling, 2026-10-21: wording the radiologist accepted from an AI draft is
     * a FINDING they reviewed, not a conclusion they wrote. The automatic pass may
     * still conclude anything it can name that a person authored — a dictated or
     * hand-typed sentence, a Quick Select tile, a line the radiologist has since
     * edited by hand (which carries `manual` and is therefore protected text) — but a
     * sentence whose only author is `ai-draft` waits for a press.
     *
     * Withholding is not silence: the refused sentence keeps the Findings→Impression
     * dependency armed below, which is what raises the amber "needs refresh", and the
     * controls the doctor presses (`Generate Impression`, `Refresh from Findings`) do
     * not pass `automatic`, so they still summarise exactly what they summarise today.
     */
    const findingsProv = get().fieldProvenance.findings ?? EMPTY_FIELD_PROVENANCE;
    const authoredByAiAlone = (line: string) => {
      const key = normalizeForDedupe(line);
      const tags = key ? findingsProv[key] : undefined;
      return !!tags?.includes("ai-draft") && !contributionProtected(line, findingsProv);
    };
    const withheld = opts?.automatic ? candidates.filter(authoredByAiAlone) : [];
    const remaining = opts?.automatic ? candidates.filter((s) => !authoredByAiAlone(s)) : candidates;
    // A refusal has to stay visible. `deriveImpressionDependency({ rebase: true })`
    // below is what tells the workspace this Conclusion now matches its Findings, and
    // a silent refresh that withheld a sentence cannot also certify that pairing.
    const refused = opts?.automatic
      ? refusedAutomaticSentences(leftovers).length > 0 || withheld.length > 0
      : false;
    const next = refreshImpressionFromObservations({
      currentImpression: get().impressionText,
      patches,
      remainingAbnormalLines: remaining,
      provenance: get().fieldProvenance.impression,
    });
    // An unpressed pass may not answer "what is the impression?" with nothing.
    //
    // Reaching this needs no contrivance: a Quick Select box that records an
    // abnormality can carry Findings prose and no Impression prose, and the tile
    // catalog has sixteen such boxes on the LS Spine strip alone. Once the approved
    // normal that box falsifies is retired, the ledger concludes for nothing, the
    // derived Conclusion is empty, and the old behaviour was to write the empty
    // string over the clinic's normal and then `rebase` — certify that a report
    // with no diagnosis in it matches its findings.
    //
    // A press still does it. Nobody pressed this.
    //
    // The PRESSED arm deliberately does NOT share this refusal — that is the
    // A5 ruling in instantReport.test.ts ("a rule that silenced their own press
    // would be Mode A claiming authority over the doctor"): pressing Generate
    // commands a rebuild from the ledger, and when the P0-1a suppression below
    // removes the invented normal from what the ledger concludes, the press
    // rebuilds the Conclusion down to exactly what it can own — even to nothing —
    // rather than keeping a machine normal the Findings contradict. The
    // pressed-blank control is pinned there ("a press still rebuilds the
    // Conclusion down to nothing", re-measured on this change).
    if (opts?.automatic && !next.trim() && get().impressionText.trim()) {
      // Nothing is written, so nothing is certified: arming the dependency is what
      // raises the amber "Impression needs refresh" the pressed surfaces already
      // render, and `IMPRESSION_UNDECIDED_HOLD` is the canvas reason that names the
      // sentence the radiologist has to write.
      set(deriveImpressionDependency(get(), undefined, { arm: "findings-changed" }));
      return "held-empty";
    }
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
    // A composed Conclusion reads in clinical order, not in the order the
    // contributions were collected — which is the ledger's insertion order, i.e. the
    // order the boxes were clicked. One sorter for both the press and the automatic
    // pass, and a hand-ordered field is frozen inside it (§158).
    get().orderImpressionByPriority();
    // The radiologist pressed "Refresh": the summary was regenerated from the
    // findings, so this is the paired write and the basis moves with it. Recorded
    // as a refresh rather than an authored write, because the dependency history
    // says who decided the summary was current.
    //
    // A silent refresh that refused a sentence is not that pairing, so it does not
    // re-base. It arms the same dependency the workspace already renders instead —
    // the amber "Impression needs refresh", the dialog that asks — which is how the
    // doctor finds out the Conclusion does not cover everything they dictated, and
    // how they get the one press that does. Arming rather than merely skipping keeps
    // it on reload too, which is the reason `unreconciled` exists.
    if (refused) {
      set(deriveImpressionDependency(get(), undefined, { arm: "findings-changed" }));
      return "held-protected";
    }
    set(deriveImpressionDependency(get(), { rebase: true, recordedBy: "refresh" }));
    return undefined;
  },
  markImpressionReviewed: () => {
    // "I have read it and it stands." The only way to clear a dependency the
    // radiologist has not rewritten, so it records who decided and against what —
    // and because the basis is the clinical content, not a timestamp, the same
    // pairing stays cleared after a reload instead of nagging on reopen.
    if (refuseSignedMutation(get(), "markImpressionReviewed")) return;
    set(deriveImpressionDependency(get(), { rebase: true, recordedBy: "review" }));
  },
  previewImpressionFromLedger: (opts) => {
    // Phase 3, item D — the same derivation a pressed Refresh runs, with every
    // write removed. Guards are the plain read-only twins of the apply path's:
    // the signed boundary refuses (without firing the mutation toast a hover
    // must not produce), and the manual-impression hold does NOT apply here —
    // the preview exists precisely for a Conclusion a doctor wrote by hand.
    if (get().isFinalized) return { next: "", refused: "signed" };
    const patches = get().appliedPathologyPatches
      .filter((p) => !opts?.excludeBaselineObservations
        || (p.observation?.role !== "baseline" && !isSystemNormalPatch(p)))
      .map(toLedgerPatch);
    const leftovers = unexplainedFindingLines(get().findingsText, get().appliedPathologyPatches).join("\n");
    const remaining = suppressInventedNormalOverAbnormality(
      generateLocalImpression(leftovers),
      get(),
    );
    const next = refreshImpressionFromObservations({
      currentImpression: get().impressionText,
      patches,
      remainingAbnormalLines: remaining,
      provenance: get().fieldProvenance.impression,
    });
    return { next, refused: null };
  },
  orderImpressionByPriority: (proposed) => {
    // A reorder is still a write: it replaces the signed Impression with a
    // permutation of itself. This action was invisible to the boundary ratchet
    // because its write is a single-line `set({ impressionText: … })`, which the
    // line-anchored pattern could not see.
    if (refuseSignedMutation(get(), "orderImpressionByPriority")) return false;
    if (get().impressionOrderFrozen) return false;
    const original = get().impressionText;
    // CAT-P4 — one authored statement, one line — before anything is sorted.
    //
    // `mergeSentencesWithProvenance` reads a field sentence by sentence, because
    // provenance is keyed per sentence, and writes it back one sentence per line, so
    // a Conclusion authored as a single statement ("Normal MRI of the lumbosacral
    // spine. No significant disc, canal, foraminal or neural compressive
    // abnormality.") arrived from a click as two. On the numbered Impression the
    // clinic prints that is two conclusions where the radiologist wrote one. This
    // rejoins a live contribution's own sentences only when all of them are still on
    // the page, adjacent, in the order they were authored — so a sentence the
    // radiologist deleted stays deleted and two different producers' lines are never
    // fused.
    let laid = original;
    if (!proposed) {
      // A caller that hands in `proposed` owns both the order and the shape of the
      // field it derived them from; re-splitting its lines would make the proposal no
      // longer a permutation of what is on the page, and the guard below would —
      // correctly — refuse the whole write.
      for (const p of get().appliedPathologyPatches) {
        if (p.stale) continue;
        laid = rejoinAuthoredStatement(laid, (p.templates.impression ?? "").trim());
      }
    }
    const before = laid.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (before.length < 2) {
      // Nothing to sort, but the shape may still have moved.
      if (laid === original) return false;
      set({ impressionText: laid, isDirty: true });
      return true;
    }
    // One sorter and one freeze rule for every study; only the clinical category
    // table changes for a dedicated Dorso-Lumbar examination (spec §26).
    const ordered = isDorsoLumbarDedicated(get().studyComposition)
      ? orderImpressionLines(before, { rankLine: rankDorsoLumbarImpressionLine })
      : orderImpressionLines(before, { spineSegment: get().reportingContext.spineSegment });
    const next = (proposed ?? ordered)
      .map((s) => s.trim())
      .filter(Boolean);
    if (before.join("\n") === next.join("\n") && laid === original) return false;
    // A reorder may only ever permute. Anything else is a rewrite, and this action is
    // never allowed to reword a clinical statement (§18, §37).
    if (!isImpressionReorderOf(before, next)) return false;
    set({ impressionText: next.join("\n"), isDirty: true });
    return true;
  },
  seedSystemNormalImpression: () => {
    // Safety: never seed while an abnormal conclusion is on the page.
    if (suppressesSystemNormal(get().appliedPathologyPatches)) return;
    // Safety: never seed when the radiologist has manually owned impression.
    if (impressionHasManualContribution(get().fieldProvenance.impression)) return;
    // Safety: never seed on a finalized study.
    if (get().isFinalized) return;
    // Safety: never seed a second normal over the report's OWN approved normal.
    //
    // Measured on the template-opened USG (worklist 7, 2026-10-28): deselecting the
    // last box put the template's Conclusion back, and then this seed added the
    // generic "Normal study." beside it — two conclusions for one examination, and
    // the merge that writes the seed is sentence-per-line, so it re-split the
    // authored normal into two numbered items as well. The test is against the
    // recorded approved normal, not a hunt for normal-looking words in the field:
    // a report that carries its own normal conclusion already says what the seed
    // exists to say.
    const approved = (get().startingCanvasBaseline?.impression ?? "").trim();
    if (approved) {
      const onPage = new Set(
        splitToSentences(get().impressionText).map((s) => normalizeForDedupe(s)).filter(Boolean),
      );
      const sentences = splitToSentences(approved).map((s) => normalizeForDedupe(s)).filter(Boolean);
      if (sentences.length > 0 && sentences.every((s) => onPage.has(s))) return;
    }
    const existing = findSystemNormalPatch(get().appliedPathologyPatches);
    // A normal the radiologist deleted is not a gap to refill. That case cannot
    // reach here: deleting the sentence leaves the row's own contribution recorded and
    // non-empty, which the line below refuses on, and typing over the field marks the
    // sentence manual, which `impressionHasManualContribution` above refuses on. Both
    // are pinned in `impressionCompositionAdversarial.test.ts`.
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
      // CAT-P4 — the merge below keys provenance per sentence, so it writes the
      // restored normal as one sentence per line. A baseline Impression authored as
      // a single statement comes back from that as two numbered items, which is a
      // different report from the one the clinic approved. Rejoin it onto the line it
      // was authored on; a sentence the radiologist deleted is not present, so it is
      // not put back by this.
      // CAT-P4 is settled by the one layout pass every composer ends with, not here:
      // the merge above keys provenance per sentence and therefore writes the
      // restored normal as one sentence per line, and `orderImpressionByPriority` is
      // what puts an authored statement back on its own line.
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
    const provenance = storedProvenanceWithLedgerFallback(parsed.fieldProvenance, narrative, reconciled);
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
    if (shallow(s.dorsalNumbering, dorsalNumbering)) return s;
    return {
      dorsalNumbering,
      isDirty: true,
      canalApProvenance: reconcileCanalLevels(
        s.canalApProvenance, "dorsal", dorsalApCanalLevels(dorsalNumbering),
      ),
    };
  }),
  setDorsoLumbarNumbering: (patch) => set((s) => {
    const dorsoLumbarNumbering = { ...s.dorsoLumbarNumbering, ...patch };
    // A freshly copied lumbar bag with the same values is not a user change.
    if (shallow(s.dorsoLumbarNumbering.lumbar, dorsoLumbarNumbering.lumbar)
      && shallow(s.dorsoLumbarNumbering, { ...dorsoLumbarNumbering, lumbar: s.dorsoLumbarNumbering.lumbar })) return s;
    return { dorsoLumbarNumbering, isDirty: true };
  }),
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
    // Computed BEFORE the removal is applied, from the set that survives it. Suppression is a property
    // of which abnormalities the radiologist is still holding, never of which patch happened to
    // delete the sentence first — so a normal shared by two tiles stays retired while either is held.
    const survivingPatches = get().appliedPathologyPatches.filter((p) => p.id !== id);
    const canvas = get().startingCanvasBaseline;
    const canonicalFindings = canonicalOrderFromText(canvas?.findings ?? null);
    const canonicalImpression = canonicalOrderFromText(canvas?.impression ?? null);
    // What this deselection has authority to put back. The patch's own record is only what it
    // happened to delete first, so when two abnormalities declare one normal the second one has no
    // record and its removal would restore nothing. The declaration itself answers the question,
    // because it is still on the observation: a baseline sentence this tile names is in scope even
    // if an earlier click had already taken it off the page.
    const claimFor = (renderedText: string | undefined): SuppressingObservation => ({
      baselineReplaces: patch.observation?.baselineReplaces ?? null,
      concept: patch.observation?.concept ?? null,
      role: patch.observation?.role ?? null,
      laterality: patch.observation?.laterality ?? null,
      renderedText: renderedText ?? null,
    });
    const result = removeLedgerObservation(
      narrativeFromState(get()),
      get().fieldProvenance,
      toLedgerPatch(patch),
      {
        surviving: activeSuppressors(survivingPatches),
        canonicalFindings,
        canonicalImpression,
        claimsFindings: claimsDeclaredBy(claimFor(patch.lastRendered.findings), canonicalFindings),
        claimsImpression: claimsDeclaredBy(claimFor(patch.lastRendered.impression), canonicalImpression),
        // Removal is proved sentence by sentence, so the same identity fence the click path
        // uses has to guard the removal path too: a sentence another live box also wrote is
        // that box's statement, and clicking this one off must not take it away.
        heldElsewhere: liveContributionKeys(survivingPatches),
      },
    );
    let nextMs = get().structuredViewerMeasurements;
    if (remapTo) {
      nextMs = remapStructuredMeasurementsObservationId(nextMs, id, remapTo).state;
    } else {
      nextMs = detachStructuredMeasurementsFromObservation(nextMs, id).state;
    }
    let nextPatches = survivingPatches;
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
        ? { lastPatchSnapshot: get().lastPatchSnapshot, patchUndoStack: get().patchUndoStack, patchRedoStack: get().patchRedoStack }
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
    // After removing an abnormal observation, if NO other abnormal conclusion
    // remains AND the radiologist has not manually owned the impression AND the
    // workspace is not finalized, re-seed the system normal patch. The seed action
    // itself is idempotent and re-checks every safety predicate before applying.
    //
    // Identity is decided by patch concept/source and by the row's own recorded
    // conclusion, NOT by hunting the Impression field for normal-looking words.
    //
    // This first question is "was the thing I removed one of the abnormalities the
    // normal was standing behind?" and it is the UNION of the two readings, because
    // dropping either one changes a shipped report. The concept-only arm is main's
    // answer and is what restores the normal under a MRI Lumbar routine normal tile
    // — those emit baseline atoms whose concepts (`canal_stenosis`,
    // `conus_medullaris`, `bone_lesion`, `disc_contour`, `compression_fracture`,
    // `foraminal_stenosis`, `cauda_equina`) are impression-worthy while their sentence
    // names no cue. The sentence arm is CAT-P5: eight of the twenty-two lumbar boxes
    // carry a concept the registry does not flag (facet arthropathy and the rest), so
    // with the concept test alone their deselection would leave the normal suspended
    // forever — withdrawn on the click and never brought back.
    //
    // The sentence arm is asked only of a study that HAS a system normal row, and that
    // scoping is load-bearing. `seedSystemNormalImpression` falls through to writing
    // the generic "Normal study." when no row exists, so on a report that never
    // carried one — a hand-written cervical cord report with a C2 fracture tile —
    // deselecting the tile answered "Normal study." underneath a fracture. Measured:
    // `findingsImpressionDependency.test.ts` caught it as an Impression that now
    // contradicts its own Findings. Nothing was ever suspended there, so nothing had
    // to come back.
    const suspendedNormal = findSystemNormalPatch(get().appliedPathologyPatches);
    if (
      !isSystemNormalPatch(patch)
      && (
        isImpressionworthyAbnormal(patch.observation?.concept ?? null)
        || (suspendedNormal !== null && statesAbnormalImpression(patch))
      )
      && !get().isFinalized
    ) {
      const remainingPatches = get().appliedPathologyPatches;
      if (!suppressesSystemNormal(remainingPatches)) {
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
    // re-paired — both pinned in `findingsImpressionDependency.test.ts`.
    //
    // Ordered first, then derived: the basis has to record the Conclusion as the
    // radiologist will read it, which is the prioritised shape, not the residue of
    // whichever box was clicked last.
    get().orderImpressionByPriority();
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
    // The state being stepped away from is what redo will put back. Captured here, before anything is
    // written, because after the restore it no longer exists anywhere.
    const steppedAway = captureClinicalSnapshot(get());
    set({
      ...clinicalRestorePatch(snap),
      patchUndoStack: remaining,
      lastPatchSnapshot: topClinicalUndoSnapshot(remaining),
      patchRedoStack: pushClinicalUndoSnapshot(get().patchRedoStack, steppedAway, CLINICAL_UNDO_MAX),
      isDirty: true,
    });
    // Undo puts the prose and its dependency link back together, so the answer is
    // re-derived from the pair rather than trusting the flag the frame recorded —
    // the same predicate, whichever direction the text just moved.
    set(deriveImpressionDependency(get()));
    return true;
  },
  redoLastPatch: () => {
    // The same refusals as undo, in the same order, for the same reasons: a signed report is not
    // writable from client state, an empty stack is not a failure, and a frame from another study must
    // stay where it belongs rather than be dropped on the floor.
    //
    // Undo passes `false` here because `useWorkspaceCommands` owns that shortcut's explanation and
    // reads the top frame to distinguish "refused" from "nothing to undo". Redo has no command layer
    // yet, so a silent refusal would be a shortcut that does nothing at all — the ratchet that counts
    // the opted-out callers keeps naming exactly one, and this is not it.
    if (refuseSignedMutation(get(), "redoLastPatch")) return false;
    const popped = popClinicalUndoSnapshot(get().patchRedoStack);
    if (!popped) return false;
    const { snapshot: snap, remaining } = popped;
    if (snap.activeStudyId !== get().activeStudyId) {
      console.warn("[care.workspace_store] redo refused — the frame belongs to a different study", {
        frameStudyId: snap.activeStudyId,
        activeStudyId: get().activeStudyId,
      });
      return false;
    }
    // Redo is reversible too: the frame is handed back to the undo stack, so stepping forward does not
    // cost the radiologist the way back they had before they pressed it.
    const steppedAway = captureClinicalSnapshot(get());
    const patchUndoStack = pushClinicalUndoSnapshot(get().patchUndoStack, steppedAway, CLINICAL_UNDO_MAX);
    set({
      ...clinicalRestorePatch(snap),
      patchUndoStack,
      lastPatchSnapshot: topClinicalUndoSnapshot(patchUndoStack),
      patchRedoStack: remaining,
      isDirty: true,
    });
    set(deriveImpressionDependency(get()));
    return true;
  },
  undoLastVoiceApply: () => {
    // Signed first, like every clinical writer: the refusal leaves the frame on
    // the stack. Announced (unlike undoLastPatch's opt-out) because the panel
    // that offers this affordance explains only the "gone" race — a signed
    // report refusing an undo deserves the standard withdrawal guidance, and
    // there is no second toast underneath it to crowd out.
    if (refuseSignedMutation(get(), "undoLastVoiceApply")) return "refused";
    const marker = get().lastVoiceApplyId;
    const top = get().patchUndoStack[get().patchUndoStack.length - 1] ?? null;
    if (!marker || !top || top.voiceApplyId !== marker) {
      // Buried by a newer clinical edit, evicted by the depth bound, or already
      // stepped back through Ctrl/⌘+Z. Reverting "the top frame anyway" could
      // undo a change the radiologist can still see on the page; the honest
      // answer is "gone", and the generic history still owns every step.
      return "gone";
    }
    // The top frame IS this apply's own snapshot, so the shared restore path —
    // with its cross-study refusal and redo bookkeeping — reverts exactly it.
    return get().undoLastPatch() ? "undone" : "refused";
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
    // Step 1: Retire the narrative of the voice contributions this plan does NOT carry
    // forward. Two conditions, both load-bearing:
    //
    //  - only wording the plan drops. A surviving observation's own sentence is in
    //    `carriedForward`, so it is left where it is — strip-then-replay would move every
    //    retained dictated line to the end of the Findings on each new dictation.
    //  - provenance with the voice authorship lifted. With the live map, the guard refuses
    //    the one thing this loop exists to do (see voiceRetirableProvenance).
    const oldVoicePatches = get().appliedPathologyPatches.filter((p) => p.id.startsWith("voice-"));
    let cleanFindings = get().findingsText;
    let cleanImpression = get().impressionText;
    let cleanTechnique = get().techniqueText;
    let cleanRecommendation = get().recommendationText;
    let cleanHistory = get().clinicalHistoryText;
    const carriedForward = new Set(
      (result.activeObservations ?? [])
        .flatMap((o) => [o.findingsText, o.impressionText])
        .filter((t): t is string => Boolean(t?.trim()))
        .map((t) => normalizeForDedupe(t.trim())),
    );
    const findingsOwnedByVoice = voiceRetirableProvenance(get().fieldProvenance.findings);
    const impressionOwnedByVoice = voiceRetirableProvenance(get().fieldProvenance.impression);
    for (const vp of oldVoicePatches) {
      if (vp.lastRendered.findings && !carriedForward.has(normalizeForDedupe(vp.lastRendered.findings))) {
        cleanFindings = stripContribution(cleanFindings, vp.lastRendered.findings, findingsOwnedByVoice).text;
      }
      if (vp.lastRendered.impression && !carriedForward.has(normalizeForDedupe(vp.lastRendered.impression))) {
        cleanImpression = stripContribution(cleanImpression, vp.lastRendered.impression, impressionOwnedByVoice).text;
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

    // The observations this plan leaves behind are the text step 4 re-lays. The plan's
    // own `narrative.findings/impression` is deliberately NOT installed: `applyChangePlan`
    // retires lines by exact-line match with no provenance check, so installing it would
    // delete wording the radiologist typed by hand whenever it reads like a dictated
    // sentence. Retirement happens above, through `stripContribution`, whether or not any
    // observation survives.
    const remaining = result.activeObservations ?? [];

    // Step 3: Set the cleaned narrative + non-observation fields from
    // result.narrative. applyPathologyOverlay will merge voice observation
    // text into findings/impression.
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
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
    for (const obs of remaining) {
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
    // A dictated summary belongs to no observation, so the loop above can never
    // carry it: applyChangePlan merges it into its own narrative
    // (applyChangePlan.ts:238), which this store discards in favour of what the
    // overlay wrote. Dictating only a conclusion — or a conclusion alongside
    // findings — therefore returned "applied" while the Impression kept the words
    // it already had. Merge it through the one door dictation text already uses,
    // which re-reads the Findings against it in the same step: a summary that owns
    // the pairing records a new basis, and one that contradicts them arms it.
    const planSummary = (plan.impressionUpdate ?? plan.impressionCandidates?.[0] ?? "").trim();
    if (planSummary) {
      get().mergeField("impression", planSummary, "radiologist-voice");
    }
    if (!remaining.length) {
      // With no observation to apply, step 3 is the only write this plan makes, and
      // the merge above returns without deriving when it finds the sentence already
      // installed. So the pairing is answered here: a dictated summary records the
      // pairing it claims, a plan that only took words out asks for a re-read.
      // Without this the session and the reloaded report give different answers for
      // the same text, which is D-1 arriving through the dictation door.
      set(deriveImpressionDependency(get(), planSummary ? { rebase: true } : undefined));
    }
    // Restore the voice plan's pre-apply snapshot so undo restores the
    // state BEFORE the voice plan was applied.
    //
    // "Undo apply" names THIS apply's frame: the marker and the stamped frame
    // are written together, and only this final frame carries the id — the
    // step-3 push stays anonymous so a Ctrl/⌘+Z taken after an apply-undo
    // steps back through real history rather than a second copy of the same
    // apply frame. `undoLastVoiceApply` reverts it only while it is still the
    // top of the stack; a newer clinical write hides the affordance instead.
    voiceApplySeq += 1;
    const applyId = `voice-apply-${voiceApplySeq}`;
    set({
      ...withPushedClinicalUndo(get(), { ...snap, voiceApplyId: applyId }),
      lastVoiceApplyId: applyId,
    });
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
    const prior = {
      findings: get().findingsText,
      impression: get().impressionText,
      recommendation: get().recommendationText,
    };
    const sentences = (text: string) =>
      text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).map(normalizeForDedupe).filter(Boolean);
    /**
     * `ai-draft` is a claim about WHO WROTE a sentence, so it may only be made about
     * the sentences this accept wrote. The field's whole text used to be re-stamped,
     * which relabelled every one of the radiologist's own sentences as model output
     * the moment they accepted one AI line — and provenance is what `contributionProtected`
     * and the Findings→Impression guard read, so a doctor who accepted a suggestion
     * also lost the protection over their own prose.
     *
     * A sentence already in the field keeps the provenance it had (including none:
     * untagged clinician text stays untagged rather than becoming AI's). Only a
     * sentence that was not there before this accept is credited to the model, and a
     * sentence the radiologist later rewrites by hand is theirs again through
     * `mergeField`, which adds `manual` without removing anything.
     */
    const markField = (field: "findings" | "impression" | "recommendation", text: string): FieldProvenanceMap => {
      const map: FieldProvenanceMap = { ...(get().fieldProvenance[field] ?? EMPTY_FIELD_PROVENANCE) };
      const already = new Set(sentences(prior[field]));
      for (const key of sentences(text)) {
        if (already.has(key)) continue;
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
        // The level the click recorded on the row (Phase 3, item B): without it
        // a parameterized spine row re-rendered at a new side would have its
        // "at {level}" phrase grammatically deleted — the same silent deletion
        // the severity gate above was written to prevent.
        isQuickSelectSource(p.source) ? (p.observation?.level ?? "") : "",
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
    const pre = get();
    // RULING 2 — a merged second format is a whole-report door, so it is asked the same
    // question the Full Normal Format door is asked in `confirmOverwriteAndApply` above.
    // Measured on the shipped catalogue before this, merging "MRI LS Spine — Normal" with
    // "MRI Whole Spine — Screening" over a clicked L4-L5 herniation wrote "Normal MRI
    // lumbo-sacral spine." and DELETED the conclusion he had pressed onto the page, because
    // all five fields came from the two templates and nothing here looked at the report
    // being merged into.
    const impressionDecision = withheldMergedImpression(r.impressionMerged.sentences, pre.appliedPathologyPatches, {
      findings: pre.findingsText,
      impression: pre.impressionText,
    });
    // Per-sentence attribution is what gives the editor its differential colours (Format A
    // = emerald, Format B = sky, common = slate; two sources on one sentence = amber
    // "Merged"). It is built on top of the PROVENANCE THE REPORT ALREADY HAD rather than
    // over a re-keyed map: re-stamping every sentence as template-authored is what stripped
    // the manual protection off wording the merge never touched. A sentence he wrote that
    // the merge also carries ends up with both sources, which is the same union the click
    // door produces for that case.
    const attributeMerge = (
      existing: FieldProvenanceMap,
      fromMerge: MergeSentence[],
    ): FieldProvenanceMap => {
      const out: FieldProvenanceMap = { ...existing };
      for (const s of fromMerge) {
        const key = normalizeForDedupe(s.text);
        if (!key) continue;
        const src: InsertSource = s.source === "from-a" ? "template-a" : s.source === "from-b" ? "template-b" : "template";
        out[key] = [...new Set([...(out[key] ?? []), src])];
      }
      return out;
    };
    const priorProv = (field: ReportFieldKey): FieldProvenanceMap =>
      pre.fieldProvenance[field] ?? EMPTY_FIELD_PROVENANCE;
    // An empty field takes the merged prose exactly as the preview showed it — layout and
    // attribution included, so a conclusion authored as one statement is not re-split into
    // two numbered items. The provenance-aware merge runs only over a field that already
    // carries text, because that is the text a merge must not delete.
    const mergeInto = (
      field: ReportFieldKey,
      existing: string,
      incoming: string,
      fromMerge: MergeSentence[],
    ): { text: string; provenance: FieldProvenanceMap } => {
      const provenance = attributeMerge(priorProv(field), fromMerge);
      if (!existing.trim()) return { text: incoming, provenance };
      return {
        text: mergeReportFieldContent({
          field,
          existing,
          incoming,
          source: "template",
          existingProvenance: priorProv(field),
        }),
        provenance,
      };
    };
    // The withheld half lives in `withheldMergedImpression`, which the Merge Preview reads
    // too — so what he is shown is what gets written. `statesAbnormalImpressionText` is the
    // classifier the printed surfaces already use to decide what to bold, so no new
    // vocabulary enters and nothing depends on the two formats' wording. What the second
    // format genuinely adds still lands, and his own lines survive because the merge above
    // never removes text.
    const withheldNormalImpression = impressionDecision.withheld.length > 0;
    // Technique takes the one exception the scaffold door already applies, with the same
    // predicate: the setup half of Start Report writes this Study Tab's or protocol's own
    // acquisition sentence, so merging the format's statement additively prints two accounts
    // of one examination. When every sentence on the page is machine-authored the approved
    // statement REPLACES them; anything a person typed, dictated or accepted stays on the
    // page and the merged statement joins it.
    const techniqueCtx = get().reportingContext;
    const replacesMachineTechnique = pre.techniqueText.trim() !== "" && mayReplaceMachineTechniqueWithApproved({
      techniqueText: pre.techniqueText,
      provenance: priorProv("technique"),
      regionCount: (techniqueCtx?.regions && techniqueCtx.regions.length
        ? techniqueCtx.regions
        : [techniqueCtx?.region]).filter(Boolean).length || 1,
    });
    const techniqueNext = !pre.techniqueText.trim() || replacesMachineTechnique
      // The replaced machine sentences leave the text, so they leave the provenance map too:
      // a key for prose that is no longer on the page is how a later re-select comes back to
      // claim it.
      ? { text: r.technique, provenance: attributeMerge(EMPTY_FIELD_PROVENANCE, r.techniqueSentences ?? []) }
      : mergeInto("technique", pre.techniqueText, r.technique, r.techniqueSentences ?? []);
    // RULING 3 (#174) — the Findings half of the decision the block above already makes for
    // the Conclusion, from the same live state and the same shipped slot rule. Before it,
    // `mergeTwoFormats` compared the two TEMPLATES against each other and never consulted
    // the ledger the page is built from, so a merged normal for a slot this report already
    // states as abnormal arrived as unowned prose: merging "MRI LS Spine — Standard Normal"
    // with "MRI Whole Spine — Screening" over a clicked L4-L5 herniation wrote
    // "L4-L5: No significant disc bulge or protrusion is seen." back onto the page (39/39
    // normal lines against 1 ledger row) and it survived save/reload.
    const mergedNormals = mergedFindingsWithdrawal({
      merged: r.findings,
      formats: [pre.lastMergeFormats?.a, pre.lastMergeFormats?.b].filter(Boolean) as ReportFormat[],
      region: get().reportingContext.region || "",
      livePatches: pre.appliedPathologyPatches,
      fields: { findings: pre.findingsText, impression: pre.impressionText },
    });
    // A withheld sentence is not attributed: provenance for prose that never reaches the
    // page is how a later re-select comes back to claim a contribution it did not make.
    const withheldFindings = new Set(mergedNormals.withheld.map((s) => normalizeForDedupe(s)));
    const contributedFindings = r.findingsMerged.sentences
      .filter((s) => !withheldFindings.has(normalizeForDedupe(s.text)));
    const findingsNext = mergeInto("findings", pre.findingsText, mergedNormals.incoming, contributedFindings);
    const impressionNext = mergeInto(
      "impression",
      pre.impressionText,
      withheldNormalImpression
        ? impressionDecision.contributed.map((s) => s.text).join("\n")
        : r.impression,
      impressionDecision.contributed,
    );
    const recommendationNext = mergeInto(
      "recommendation", pre.recommendationText, r.recommendation, r.recommendationMerged.sentences,
    );
    // Patient/worklist/manual history wins: the merged phrase is appended when it says
    // something new and nothing already written is replaced — the rule the single-format
    // door applies to this section. Replacing it deleted what he had typed.
    const historyPhrase = (r.clinicalHistory ?? "").trim();
    const historyNext = historyPhrase
      ? {
        text: appendClinicalPhrase(pre.clinicalHistoryText, historyPhrase),
        provenance: attributeMerge(priorProv("clinicalHistory"), r.clinicalHistorySentences ?? []),
      }
      : { text: pre.clinicalHistoryText, provenance: priorProv("clinicalHistory") };
    const mergedNarrative: ReportNarrative = {
      clinicalHistory: historyNext.text,
      technique: techniqueNext.text,
      findings: findingsNext.text,
      impression: impressionNext.text,
      recommendation: recommendationNext.text,
    };
    // An observation whose rendered contribution is no longer on the page is stale —
    // the same judgement hydrateObservationLedger makes on reopen, using the same
    // function, and now made against the text this door actually WROTE rather than against
    // the two templates: an abnormal conclusion the merge preserved keeps its live row
    // instead of being marked stale and dropped by the next rebuild. Stale is still not
    // deleted: the ledger panel shows NEEDS REFRESH and the radiologist can re-apply.
    // Leaving a patch live when its prose IS gone would have it claim ownership of
    // sentences the merge overwrote, so the next tile re-select would strip prose that is
    // no longer his.
    const retiredRowIds = new Set(mergedNormals.suspended.map((row) => row.id));
    const reconciledPatches = claimRetiredBaselines(get().appliedPathologyPatches.map((p) => {
      // A slot this door withdrew is SUSPENDED, not deleted: `removeObservation` restores a
      // stale baseline row that is mutually exclusive with the finding being deselected, so
      // the normal sentence comes back on the same representation the click door uses.
      if (retiredRowIds.has(p.id)) {
        return { ...p, stale: true as const, lastRendered: { ...p.lastRendered, findings: "", impression: "" } };
      }
      return reconcilePatchAgainstNarrative(toLedgerPatch(p), mergedNarrative).stale
        ? { ...p, stale: true }
        : p;
    }), mergedNormals.suspended);
    // A merged normal that had no row on this ledger yet arrives carrying one, suspended.
    // Before this the merge door wrote those sentences as prose nobody owned, which left
    // them both unrecoverable when the abnormality was deselected and invisible to every
    // later supersession decision — including this ruling's own.
    const carriedRows = mergedNormals.suspended
      .filter((row) => !get().appliedPathologyPatches.some((p) => p.id === row.id))
      .map((row) => ({
        id: row.id,
        ownership: row.ownership ?? {},
        templates: row.templates,
        lastRendered: row.lastRendered ?? { findings: "", impression: "" },
        source: row.source ?? ("template" as const),
        observation: row.observation!,
        replacedBaseline: row.replacedBaseline,
        protected: row.protected,
        stale: true as const,
      }));
    const mergeSnapshot = captureClinicalSnapshot(get());
    set({
      techniqueText: techniqueNext.text,
      findingsText: findingsNext.text,
      impressionText: impressionNext.text,
      recommendationText: recommendationNext.text,
      clinicalHistoryText: historyNext.text,
      fieldProvenance: {
        technique: techniqueNext.provenance,
        findings: findingsNext.provenance,
        impression: impressionNext.provenance,
        recommendation: recommendationNext.provenance,
        clinicalHistory: historyNext.provenance,
      },
      isDirty: true,
      mergePreviewOpen: false,
      lastMergeResult: null,
      lastMergeFormats: null,
      reportFormatPickerOpen: false,
      appliedPathologyPatches: [...reconciledPatches, ...carriedRows],
      ownershipReviewWarnings: retainedNormalReviewWarnings(
        get().ownershipReviewWarnings,
        mergedNormals.retained,
      ),
      ...withPushedClinicalUndo(get(), mergeSnapshot),
      appliedFormatReportTitle:
        r.combinedReportTitle
        || (get().lastMergeFormats?.a?.reportTitle ?? "").trim()
        || (get().lastMergeFormats?.b?.reportTitle ?? "").trim()
        || null,
    });
    // A merged format speaks for both sides of the Findings→Impression dependency, so it
    // re-bases the pair — while still being read by the same predicate, which is the
    // point: a template whose impression calls the study normal over the findings it just
    // merged arms here exactly as it would after a reload.
    //
    // A merge that WITHHELD its conclusion does not speak for the Impression at all. It
    // changed the Findings and left the Conclusion as it found it, so re-basing would be a
    // claim this door never earned: measured on the shipped catalogue, that is the one case
    // where the Full Normal Format door flags "a conclusion is owed" over abnormal findings
    // and the merge door stayed silent. Passing no ownership keeps the earlier basis, so the
    // flag is derived from the same comparison every other surface uses — and it travels
    // through the basis instead of living only in this session, which is what D-1 was.
    set(withheldNormalImpression
      ? deriveImpressionDependency(get(), undefined, { findingsJustChanged: true })
      : deriveImpressionDependency(get(), { rebase: true }));
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
