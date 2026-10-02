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
  "isDirty",
  "isFinalized",
  "isFinalizing",
  "railStage",
  "ghostText",
  "ghostTextTarget",
  "acknowledgedCopilotIds",
  "activeCopilotItem",
  "voiceTranscript",
  "voiceListening",
  "selectedFormatIds",
  "reportFormatPickerOpen",
  "appliedFormatReportTitle",
  "appliedPathologyPatches",
  "patchUndoStack",
  "lastPatchSnapshot",
  "startingCanvasBaseline",
  "impressionNeedsRefresh",
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
    isDirty: false,
    isFinalized: false,
    isFinalizing: false,
    railStage: "orient",
    ghostText: null,
    ghostTextTarget: null,
    acknowledgedCopilotIds: new Set(),
    activeCopilotItem: null,
    voiceTranscript: "",
    voiceListening: false,
    selectedFormatIds: [],
    reportFormatPickerOpen: false,
    appliedFormatReportTitle: null,
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    startingCanvasBaseline: null,
    impressionNeedsRefresh: false,
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
