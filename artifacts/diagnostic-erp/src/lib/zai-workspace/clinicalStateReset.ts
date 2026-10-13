/**
 * The clinical state that belongs to one study, in one place.
 *
 * `useWorkspace` is a module-scope singleton: it survives navigation and
 * survives unmount, so every isolation property is an explicit act of code
 * rather than a structural guarantee. There are three reset paths, not two as
 * the audit first recorded: `selectStudy` in the store (FULL, used by
 * openStudy), the study-switch effect in `useDraftPersistence` (PARTIAL, used by
 * worklist navigate and URL sync, which must not wipe `reportingContext` or race
 * draft hydration), and the end-of-queue branch of `advanceToNextStudy`, which
 * closed the last study in the list and cleared four fields. All three were
 * hand-maintained lists and they had drifted: the PARTIAL path cleared the five
 * narrative texts but left the observation ledger, the undo stack, measurements,
 * spine numbering, screening and vascular answers behind, so Patient A's
 * clinical state stayed in the store while Patient B's empty report was on
 * screen.
 *
 * All three now spread this one definition. Identity and context fields are
 * deliberately NOT in the list — each caller owns those, because the PARTIAL
 * path must preserve `reportingContext`:
 *
 *   activeStudyId, activeStudyInstanceUID, clinicalHistoryText, reportingContext
 *
 * A-02 note: `activeStudyId` is no longer free to be owned by anybody. The route
 * `studyId` (the radiology_worklist row) is the authoritative active reporting
 * study, and the transition in `useDraftPersistence` writes it in the same setState
 * as this reset, so content and identity can never be observed disagreeing. It is
 * kept out of the list itself because `emptyClinicalState()` means "no clinical
 * content", not "no study": the end-of-queue caller deliberately passes
 * `activeStudyId: null`, while a study transition passes the incoming id.
 * `activeStudyInstanceUID` is likewise caller-owned and must be nulled — never
 * carried over — when the incoming study's UID is not yet resolved.
 *
 * Some entries look like UI chrome rather than clinical state and are still
 * here on purpose. `notification` is the one that matters: it is the critical
 * interrupt card, and `recomputeCopilot` raises a new one only when the slot is
 * already empty. Left behind, Patient A's card suppressed Patient B's critical
 * finding outright — and, because the critical-result SLA clock was started from
 * inside that same branch, no elapsed time was measured for it either. The
 * clock is now decoupled in the store; resetting the field is what closes the
 * card half.
 *
 * The `pending*` / `confirmOverwriteOpen` / `activeMacroPrompt` entries are the
 * payload of a modal the radiologist had open on Patient A. Nothing closes that
 * modal on navigation, so its Apply would land on Patient B.
 *
 * Every value is constructed fresh per call. Hoisting any of them to a module
 * constant would hand two studies the same Set/array/object reference and
 * re-open the leak this module exists to close.
 */
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultDorsalNumbering } from "@/lib/mriDorsalNumbering";
import { defaultDorsoLumbarState } from "@/lib/mriDorsoLumbarCoverage";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import type { WorkspaceStore } from "./store";

/**
 * The enumerated list is the contract: `emptyClinicalState` must return exactly
 * these keys, and the tests assert both directions, so a field added to the
 * store's clinical state cannot be reset by one path and not the other without
 * a failing test naming the omission.
 */
export const CLINICAL_RESET_FIELDS = [
  "findingsText",
  "impressionText",
  "recommendationText",
  "techniqueText",
  "fieldProvenance",
  "measurements",
  "priors",
  "criticalFindings",
  "isDirty",
  "isFinalized",
  "isFinalizing",
  "railStage",
  "ghostText",
  "ghostTextTarget",
  // C2 — the binding travels with the suggestion it describes. Leaving it out
  // would leave Patient A's context digest sitting on Patient B's screen, and an
  // unmatched digest is what makes the proposal stale, not what makes it safe.
  // `ghostRequestSeq` is deliberately NOT here: it is a monotonic ordering
  // counter, not clinical state, and resetting it would let a response still in
  // flight from the previous study arrive as the newest one.
  "ghostProposal",
  "copilotItems",
  "notification",
  "acknowledgedCopilotIds",
  "activeCopilotItem",
  "voiceTranscript",
  "voiceListening",
  "activeMacroPrompt",
  "selectedFormatIds",
  "reportFormatPickerOpen",
  "confirmOverwriteOpen",
  "pendingFormatIds",
  "pendingFormatOverwrite",
  "pendingFormatRegion",
  "appliedFormatReportTitle",
  "appliedPathologyPatches",
  // ADR-004 — the transition history describes THIS study's ledger. Carrying it to the next
  // study would claim a transition that study never went through.
  "regionTransitions",
  "pendingPathologyPatch",
  "patchUndoStack",
  "lastPatchSnapshot",
  "startingCanvasBaseline",
  "impressionNeedsRefresh",
  "impressionBasis",
  "impressionDependencyReasons",
  "activeAnchor",
  "selectedObservationId",
  "measurementIntent",
  "canalIntentLevel",
  "structuredViewerMeasurements",
  "dorsalCanalForced",
  "canalApProvenance",
  "lumbarNumbering",
  "dorsalNumbering",
  "dorsoLumbarNumbering",
  "sequencesAvailable",
  "screening",
  "studyComposition",
  "studyCompositionProvenance",
  "studyCompositionOverridden",
  "impressionOrderFrozen",
  "vascularTechnique",
  "coverageMarks",
  "coverageByScope",
  "appliedFormatName",
  "ownershipReviewWarnings",
  "ledgerHydrationWarning",
  "voiceComposerObservations",
  "voiceComposerTranscriptHistory",
  "criticalSlaStartedAt",
  "criticalSlaEscalated",
  "preloadTriggered",
  "nextStudyPreloaded",
  "primaryFindingsSection",
  "linkedStudy",
  "activeFindingsSectionId",
  "appliedPatternMarkers",
  "abnormalPatternConfirm",
  "mergePreviewOpen",
  "lastMergeResult",
  "lastMergeFormats",
] as const;

export type ClinicalResetField = (typeof CLINICAL_RESET_FIELDS)[number];

/**
 * `Pick<WorkspaceStore, …>` rather than a hand-written shape: if the store
 * renames or retypes any of these fields this stops compiling, which is the
 * point. A hand-written duplicate would keep compiling and quietly reset the
 * wrong thing.
 */
export type ClinicalResetState = Pick<WorkspaceStore, ClinicalResetField>;

export function emptyClinicalState(): ClinicalResetState {
  return {
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    fieldProvenance: {},
    measurements: [],
    priors: [],
    criticalFindings: [],
    isDirty: false,
    isFinalized: false,
    isFinalizing: false,
    railStage: "orient",
    ghostText: null,
    ghostTextTarget: null,
    ghostProposal: null,
    copilotItems: [],
    notification: null,
    acknowledgedCopilotIds: new Set(),
    activeCopilotItem: null,
    voiceTranscript: "",
    voiceListening: false,
    activeMacroPrompt: null,
    selectedFormatIds: [],
    reportFormatPickerOpen: false,
    confirmOverwriteOpen: false,
    pendingFormatIds: [],
    pendingFormatOverwrite: null,
    pendingFormatRegion: null,
    appliedFormatReportTitle: null,
    appliedPathologyPatches: [],
    regionTransitions: [],
    pendingPathologyPatch: null,
    patchUndoStack: [],
    lastPatchSnapshot: null,
    startingCanvasBaseline: null,
    impressionNeedsRefresh: false,
    impressionBasis: null,
    impressionDependencyReasons: [],
    activeAnchor: null,
    selectedObservationId: null,
    measurementIntent: null,
    canalIntentLevel: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    dorsalCanalForced: false,
    canalApProvenance: {},
    lumbarNumbering: defaultLumbarNumbering(),
    dorsalNumbering: defaultDorsalNumbering(),
    dorsoLumbarNumbering: defaultDorsoLumbarState(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    studyComposition: "unknown",
    studyCompositionProvenance: "none",
    studyCompositionOverridden: false,
    impressionOrderFrozen: false,
    vascularTechnique: defaultVascularTechnique(),
    coverageMarks: [],
    coverageByScope: {},
    appliedFormatName: null,
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    criticalSlaStartedAt: null,
    criticalSlaEscalated: false,
    preloadTriggered: false,
    nextStudyPreloaded: false,
    primaryFindingsSection: null,
    linkedStudy: null,
    activeFindingsSectionId: null,
    appliedPatternMarkers: [],
    abnormalPatternConfirm: null,
    mergePreviewOpen: false,
    lastMergeResult: null,
    lastMergeFormats: null,
  };
}

/**
 * The complete store patch for ONE study transition, keyed on the authoritative route
 * study. A-02 hoisted it out of the `useDraftPersistence` effect so the contract that
 * actually matters — content reset and identity move together, from one write — can be
 * executed by a test instead of only being asserted about by reading the effect.
 *
 * `emptyClinicalState()` deliberately does not contain `activeStudyId`: "no clinical
 * content" is not "no study". This is the one place that says which study the emptied
 * content now belongs to.
 *
 * @param routeStudyId the URL study id (the radiology_worklist row), or null when no
 *   study is open. Never read the previous study's identity from anywhere here.
 */
export type StudyTransitionPatch = ClinicalResetState & {
  clinicalHistoryText: string;
  activeStudyId: string | null;
  activeStudyInstanceUID: string | null;
};

export function studyTransitionReset(
  routeStudyId: number | string | null | undefined,
): StudyTransitionPatch {
  const hasStudy = routeStudyId != null && routeStudyId !== "";
  return {
    ...emptyClinicalState(),
    // Identity field the helper leaves to the caller; reseeded from the study row by
    // selectStudy, and cleared here for a route-only transition.
    clinicalHistoryText: "",
    // The authoritative identity, moved atomically with the content reset above. A study
    // that has not yet landed in the scoped `studies` array still becomes the active
    // study — that is what the radiologist is looking at.
    activeStudyId: hasStudy ? String(routeStudyId) : null,
    // Not knowable synchronously. Null means "unknown", never "the previous study's":
    // a UID is only written by the effect that has verified it belongs to this route id.
    activeStudyInstanceUID: null,
  };
}
