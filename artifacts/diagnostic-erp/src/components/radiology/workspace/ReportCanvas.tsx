/**
 * ReportCanvas — Phase 4 JSX extraction (behavior unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck — Phase 4 vm bag; domain types live in clinical UI hook.
import type { RadiologyWorkspaceVm } from "./types";
import {
  ResizablePanel,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReportExportPanel from "@/components/radiology/ReportExportPanel";
import { ElectronicFilmPanel } from "@/components/radiology/ElectronicFilmPanel";
import { validateReport, computeQualityScore } from "@/lib/reportValidator";
import FieldCareMic from "@/components/radiology/FieldCareMic";
import QuickFindingsPanel, { type QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import {
  StructuredFormatPanel,
  formatHasStructuredFields,
  useDebouncedCallback,
} from "@/components/radiology/StructuredFormatPanel";
import {
  adaptSectionsJson,
  allNormalFindingsMap,
  extractCareStructuredFormatState,
  generateFromValues,
  labeledLinesFromMap,
  planStructuredFindingsUpdate,
  stripExactChunks,
  toDraftFormatState,
  type StructuredValues,
} from "@/lib/structuredFormat";
import PriorComparisonToolbar from "@/components/radiology/PriorComparisonToolbar";
import ViewerMeasurementsBanner from "@/components/radiology/ViewerMeasurementsBanner";
import { requestOhifNavigateToAnchor } from "@/lib/ohifViewerBridge";
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import { finalizeActionLabel } from "@/lib/radiologyReportLifecycle";
import {
  isMriCervicalReportingContext,
  isMriDorsalReportingContext,
} from "@/lib/mriSpineCanvasRegions";
import { isBrainMeasuresReportingContext, isMriBrainReportingContext } from "@/lib/reportingStudyContext";
import { buildLumbarLevelApplyBundle, deriveCanvasNarrativeState, ledgerSeverityContradiction, structuredCanalApContradiction } from "@/lib/mriLumbarLevelState";
import { buildCervicalLevelApplyBundle } from "@/lib/mriCervicalLevelState";
import { buildDorsalLevelApplyBundle } from "@/lib/mriDorsalLevelState";
import {
  AnchorRail,
  CoverageCockpit,
  FindingComposer,
  GhostLayer,
  MriLumbarCanvas,
  MriCervicalCanvas,
  MriDorsalCanvas,
  ObservationLedgerPanel,
  SpineApCanalMeasurements,
  BrainMeasuresStrip,
  MriBrainCanvas,
  useFindingComposerDraft,
} from "@/components/radiology/reporting-canvas";
import { defaultCoverageMarks } from "@/lib/coverageMarks";
import {
  canUndoLastAbnormal,
  describeLastAbnormalForUndo,
  describeRestoredBaseline,
} from "@/lib/undoLastAbnormal";
import { ReportingStickyActionBar } from "@/components/radiology/ReportingStickyActionBar";
import { NormalBaselineBadge } from "@/components/radiology/NormalBaselineBadge";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import MriReadinessStrip from "@/components/radiology/MriReadinessStrip";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
import { ConnectedFindingsHighlightEditor } from "@/components/radiology/zai-workspace/ConnectedFindingsHighlightEditor";
import ReportDemographyCard from "@/components/radiology/ReportDemographyCard";
import ComposerIdentityStrip from "@/components/radiology/workspace/ComposerIdentityStrip";
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import { StudyRegionReportFormatSection } from "@/components/radiology/StudyRegionReportFormatSection";
import { WholeReportFormatControl } from "@/components/radiology/WholeReportFormatControl";
import { MriAbnormalFormatStrip } from "@/components/radiology/MriAbnormalFormatStrip";
import ClinicalHistoryChipStrip from "@/components/radiology/ClinicalHistoryChipStrip";
import TechniqueChoiceStrip from "@/components/radiology/TechniqueChoiceStrip";
import FindingsAnatomyStrip from "@/components/radiology/FindingsAnatomyStrip";
import FindingsAnatomyChips from "@/components/radiology/FindingsAnatomyChips";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_RECOMMENDATION_CHIPS,
  RECOMMENDATION_CHIP_ALIASES,
  recommendationChipActive,
  removeRecommendationChip,
} from "@/lib/recommendationChips";
// Few-clicks — the impression chip row removes its own sentence exactly the
// way the recommendation row does: block removal, never a substring splice.
import { removeBlock } from "@/lib/quickFindingsMerge";
import { hasPhrase, appendClinicalPhrase, removeClinicalPhrase } from "@/lib/clinicalHistoryText";
import {
  isNarrowReportingViewport,
  isStudyDetailsSection,
  outerPanelPercents,
  isPhoneReportingViewport,
  shouldApplyAutomaticPaneFocus,
  shouldCollapseSetupChrome,
  shouldIgnorePaneFocusTarget,
  shouldUseCompactAccordion,
  shouldUseExclusiveReportSections,
  markPaneManualOverride,
  clearPaneManualOverride,
  type PaneManualOverrideState,
  type ReportingPaneBias,
} from "@/lib/reportingPaneFocus";
import { useWorkspace, formatSignOff, lookupProfile, EMPTY_FIELD_PROVENANCE, type WorkspaceStore } from "@/lib/zai-workspace/store";
import {
  billedNameFromWorklistRow,
  billedStudyContextForNormal,
  quickNormalOutcomeMessage,
  resolveNormalBootstrapFormat,
} from "@/lib/zai-workspace/normalBootstrap";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import { FindingsEditor } from "@/components/radiology/zai-workspace/findings-editor";
import { AbnormalPatternSuggestionStrip } from "@/components/radiology/workspace/AbnormalPatternSuggestionStrip";
import { QuickSelectStrip } from "@/components/radiology/zai-workspace/quick-select-strip";
import {
  FindingsToolDrawer,
  FindingsToolTabs,
  ReportAccordionSection,
} from "@/components/radiology/zai-workspace/report-section-accordion";
import { ImpressionWarningStrip } from "@/components/radiology/reporting-canvas/ImpressionWarningStrip";
import { MultiStudyFindingsEditors } from "@/components/radiology/zai-workspace/multi-study-findings-editor";
import { OwnershipTracePanel } from "@/components/radiology/zai-workspace/ownership-trace-panel";
import { ChocolateBoxMacros } from "@/components/radiology/zai-workspace/chocolate-box-macros";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import {
  Lock, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pause, Clock, ListChecks, ShieldCheck,
  FileCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2, Link2,
} from "lucide-react";


export function ReportCanvas({ vm }: { vm: RadiologyWorkspaceVm }) {
  const {
    _commandDispatcher,
    _handleFrictionlessSaveAndNext,
    abnormalHighlight,
    acceptStructuredImpressionCandidate,
    accordionProps,
    activateReportSection,
    activeAnchor,
    activeFindingsAnatomy,
    activeFindingsTool,
    activeReportSection,
    activeReportSectionRef,
    activeStudyId,
    aiAssistantMinimized,
    aiFinalizeBypassRef,
    aiFinalizeGate,
    aiProviderSettingsForComposer,
    aiSelectedKeyImageIds,
    allowEditSigned,
    appendFindings,
    appliedFormatName,
    appliedFormatReportTitle,
    appliedNormalFormatName,
    appliedPathologyPatches,
    applyCatalogAfterConfirmRef,
    applyStagedAiProposals,
    applyStructuredGeneration,
    applyStudyLocalEdit,
    applyVoiceComposerWithUndo,
    autoCollapseQueueOnStudyOpen,
    autoLinkNotifiedRef,
    autoRevealKeyRef,
    autoSaveStatus,
    blockedQuickFindingIds,
    bootstrapAppliedThisOpen,
    canShowVerify,
    canUndoStartReport,
    canVerifyRef,
    canalApByLevel,
    canonicalDemography,
    captureBusy,
    captureSavedDraft,
    catalogQuickFindings,
    checklistComm,
    clinicSettings,
    clinicalHistoryChips,
    clinicalHistoryStudyTabs,
    clinicalHistoryText,
    commandDispatcherRef,
    compactAccordion,
    companionEligible,
    completedCount,
    composerAiMode,
    composerBanner,
    composerConfig,
    composerCtx,
    composerDraft,
    composerKeyImagesQ,
    composerPrimaryRegionLabel,
    composerQuickFindings,
    composerRegion,
    composerReportTitle,
    composerSelectedKeyImages,
    composerSessionModelKey,
    composerSessionModelOptions,
    composerSessionResolved,
    confirmImpressionReplace,
    confirmVerify,
    confirmedReplaceImpression,
    confirmedVerifyReport,
    contentLocked,
    copilotLearning,
    copilotPrefs,
    coverageMarks,
    criticalNote,
    criticalSlaStartedAt,
    datePreset,
    demographyOverrides,
    dictateAddAsFinding,
    dictateAddAsNote,
    dictationTranscript,
    doctorsCatalogQ,
    draftBackup,
    draftHydratedStudyId,
    draftId,
    draftIdRef,
    embeddedViewerRef,
    ensureDraftOnce,
    enterClinicalEditorFocus,
    enterClinicalEditorFocusRef,
    enterReportingFocusMode,
    enterReportingFocusModeRef,
    enterViewerPaneFocus,
    exclusiveReportSections,
    exclusiveReportSectionsRef,
    continuousPrimarySections,
    existingDraft,
    exportingPdf,
    exportingWord,
    fatigueCardDismissed,
    feedbackAfterAbnormalApply,
    finalizeFlow,
    finalizeReport,
    findingsAssistedCount,
    findingsLintCount,
    findingsMap,
    findingsPct,
    findingsProvenance,
    findingsText,
    focusClinicalEditor,
    focusReportField,
    focusVoiceBar,
    formFContinueFinalizeRef,
    formFFinalizeOpen,
    frozenKeyImages,
    frozenKeyImagesQ,
    goNextStudy,
    goPrevStudy,
    handleEditBeforeInsert,
    handleExportPdf,
    handleExportWord,
    handleGenerateLocalImpression,
    handleOuterPanelLayout,
    handlePrintLikeFinal,
    handleQuickToggle,
    handleQuickToggleRef,
    handleRefreshImpressionFromFindings,
    handleSaveTeachingCase,
    handleShare,
    handleStartReport,
    instantReportHold,
    instantReportOn,
    setInstantReportEnabled,
    handleUndoLastAbnormal,
    handleVerifyReport,
    headerToggleTimerRef,
    headingCase,
    imageRefs,
    impressionContradictionWarnings,
    impressionManuallyEdited,
    impressionNeedsRefresh,
    impressionProvenance,
    impressionStyle,
    impressionText,
    insertRawDictation,
    isCritical,
    isCtModality,
    isDirty,
    isFinalized,
    isLoadingExistingDraft,
    isLocked,
    isMobile,
    isMriModality,
    isObUsg,
    isOnline,
    isOwner,
    isTabVisible,
    isUltrasound,
    jumpQueue,
    keyImageCounts,
    keyImageFilterObsId,
    lastClinicalTarget,
    lastPatchSnapshot,
    lastQuickRenderedRef,
    lastSavedAt,
    lastStructuredFindingsLinesRef,
    layoutMode,
    layoutPrefs,
    leaveDialogOpen,
    leavePromptReasonRef,
    leaveResolverRef,
    ledgerHydrationWarning,
    leftCollapsed,
    leftPanelRef,
    legacyTab,
    linkStudyOpen,
    linkedReportId,
    linkedReportIdRef,
    linkedStudy,
    liveDictationText,
    livePrintBodyHtml,
    lockLost,
    macroRecentIds,
    markMacroRecent,
    markPaletteRecent,
    measurementChips,
    microInstruction,
    modalityDeepLinkAppliedRef,
    modalityRaw,
    mriWarmBrowserTargets,
    mriWarmCountLabel,
    mriWarmStatus,
    myName,
    myUserId,
    navigate,
    normalBootstrapDoneRef,
    observationLabels,
    ohifTargetOriginRef,
    ohifUnavailable,
    onStudySwitchPageReset,
    openComposerForObservation,
    openLegacyTab,
    openLegacyTabRef,
    openReportingTools,
    openReportingToolsRef,
    openStudy,
    openStudyGuarded,
    openStudyRef,
    ownershipReviewWarnings,
    pacsSettingsRows,
    paletteFavourites,
    paletteRecent,
    paneManualOverrideRef,
    patientJumpFilter,
    patientMasterQ,
    pcpndtBlocked,
    pcpndtBlockedRef,
    pcpndtCompliance,
    pcpndtMissing,
    pendingStructuredPopulateRef,
    persistAiAssistantMinimized,
    persistDatePreset,
    persistQueueModality,
    persistQueueSort,
    personalTemplates,
    prefsSyncedRef,
    preloadTriggered,
    presentationTemplates,
    previewHtml,
    previewLayoutOverride,
    printFormat,
    printFormatLocked,
    stepPrintFormat,
    primaryFindingsSection,
    printingLikeFinal,
    protectedQuickLabels,
    qc,
    qsExternalSearch,
    qualityScore,
    queueDateRange,
    queueModality,
    queueSort,
    quickFindingTemplatesRef,
    quickInsertSource,
    quickSide,
    quickSideMountedRef,
    readingSession,
    impressionShortcutChips,
    recommendationChips,
    recommendationText,
    referringDoctorName,
    reportComposer,
    reportImagesOpen,
    reportLayout,
    reportLayoutLabel,
    reportNeedsStart,
    reportPanelRef,
    reportingToolsTab,
    requestFrozenKeyImageCapture,
    requestOhifAnnotatedCapture,
    resolveLeaveChoice,
    restoredDraftForStudyRef,
    rightCollapsed,
    rightPanelRef,
    role,
    saveDraft,
    saveDraftRef,
    saveGenerationRef,
    scheduleStructuredApply,
    scheduleStructuredDraftSave,
    sectionCollapsePrefs,
    sectionMeta,
    sectionSpacing,
    sectionStatus,
    selectFindingsTool,
    selectStudy,
    selectedClinicalHistoryTab,
    selectedObservationId,
    selectedQuickIds,
    selectedQuickIdsRef,
    sendHopeBusy,
    session,
    sessionFresh,
    sessionMin,
    sessionStartedAt,
    sessionTick,
    setAbnormalHighlight,
    setActiveFindingsAnatomy,
    setActiveReportSection,
    setAiAssistantMinimized,
    setAiFinalizeGate,
    setAiSelectedKeyImageIds,
    setAllowEditSigned,
    setAppliedNormalFormatName,
    setBootstrapAppliedThisOpen,
    setCanUndoStartReport,
    setCaptureBusy,
    setChecklistComm,
    setComposerAiMode,
    setComposerBanner,
    setComposerDraft,
    setComposerQuickFindings,
    setComposerSessionModelKey,
    setConfirmImpressionReplace,
    setConfirmVerify,
    setCriticalNote,
    setDatePreset,
    setDemographyOverrides,
    setDraftHydratedStudyId,
    setFindingsMap,
    setFormFFinalizeOpen,
    setHeadingCase,
    setImpressionStyle,
    setIsCritical,
    setKeyImageFilterObsId,
    setLastClinicalTarget,
    setLastSavedAt,
    setLastSavedAtRef,
    setLayoutMode,
    setLayoutPrefs,
    setLeaveDialogOpen,
    setLeftCollapsed,
    setLegacyTab,
    setLinkStudyOpen,
    setMicroInstruction,
    setPatientJumpFilter,
    setPersonalTemplates,
    setPreviewLayoutOverride,
    setQsExternalSearch,
    setQueueModality,
    setQueueSort,
    setQuickInsertSource,
    setQuickSide,
    setReadingSession,
    setReportImagesOpen,
    setReportingToolsTab,
    setRightCollapsed,
    setSectionCollapsePrefs,
    setSectionSpacing,
    setSelectedQuickIds,
    setSendHopeBusy,
    setSessionTick,
    setShortcutHelpOpen,
    setShowLetterpadHeader,
    setStagedAiProposals,
    setStartingCanvasExpanded,
    setStructuredValues,
    setStudies,
    setStudyDetailsOpen,
    setStudyLocalEdit,
    setTemplateRailCollapsed,
    setUseStructured,
    setViewerColumnExpanded,
    setViewerFocus,
    setWhatsappShareOpen,
    shortcutHelpOpen,
    showEmbeddedViewer,
    showFatigue,
    showLetterpadHeader,
    signedReport,
    signOffProfiles,
    signerLine,
    stageAiProposal,
    stagedAiProposals,
    startReportUndoRef,
    startingCanvasExpanded,
    structuredFormatDrivingRef,
    structuredTouchedRef,
    structuredValues,
    structuredViewerMeasurements,
    studies,
    study,
    studyDetailsOpen,
    studyId,
    studyLocalEdit,
    studyLock,
    studyNameForExport,
    studyReadyStatus,
    studyRegion,
    studySetup,
    studySetupSetters,
    studyTextOverridesRef,
    techniqueProvenance,
    techniqueText,
    templatePanelRef,
    templateRailCollapsed,
    toast,
    togglePaletteFavourite,
    triggerAiImpression,
    undoLastAbnormalEnabled,
    undoStepEnabled,
    redoStepEnabled,
    handleUndoStep,
    handleRedoStep,
    undoStartReport,
    useStructured,
    verifyActionRef,
    verifyBusy,
    verifyGate,
    viewerColumnExpanded,
    viewerFocusMode,
    viewerPanelRef,
    viewportWidthPx,
    voiceCapabilities,
    voiceComposer,
    voiceComposerComposeRef,
    voiceParkReasonRef,
    voiceSession,
    voiceSettings,
    warmMriTodayYesterday,
    whatsappShareOpen,
    workflow,
    worklistDetailQ,
    workspaceEntry,
  } = vm;

  return (
    <>
              <ResizablePanel defaultSize={48} minSize={36}>
                {/* #1168 bright composer — the editor column reads as a bright
                    sheet of paper: white at the top, a whisper of emerald-sky
                    at the foot, over the token background in dark mode. */}
                <div className="h-full flex bg-gradient-to-b from-white via-emerald-50/30 to-sky-50/20 dark:from-card dark:via-transparent dark:to-emerald-950/10 min-h-0">
                <div className="flex flex-1 min-w-0 flex-col min-h-0">
                  {/* Viewer chrome — never hidden behind an accordion header */}
                  <div className="shrink-0 space-y-2 px-3 pt-3 empty:hidden">
                    {!showEmbeddedViewer && layoutMode === "reportFocus" && (
                      <button
                        type="button"
                        data-testid="open-ohif-viewer"
                        onClick={() => setLayoutMode("split", { reenableAutoFocus: true })}
                        className="w-full rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-left text-xs text-sky-900 hover:bg-sky-100"
                      >
                        <span className="font-semibold">OHIF / WADO images are hidden.</span>
                        {" "}Click here (or the <span className="font-mono">OHIF</span> button in the top bar) to open the embedded viewer.
                      </button>
                    )}
                    {viewerFocusMode && showEmbeddedViewer && (
                      <div className="flex items-center gap-2 px-2 py-1.5 -mx-1 rounded border border-emerald-200/60 bg-emerald-50/40" data-testid="viewer-focus-strip">
                        <MonitorPlay size={13} className="text-emerald-600 shrink-0" />
                        <span className="text-xs font-semibold truncate flex-1">
                          {workflow.currentRow?.patientName ?? "Viewer focus"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setViewerFocus(false);
                            setStudyDetailsOpen(true);
                            setStartingCanvasExpanded(false);
                            activateReportSection("demography");
                          }}
                          className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                          title="Restore app chrome and open demography"
                          data-testid="viewer-focus-restore"
                        >
                          Show patient details
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Reporting pane — exclusive one-active on laptop; continuous
                      Findings+Impression only on wide desktop. Layout focus never
                      mutates clinical report state.
                      Always overflow-hidden (not overflow-y-auto): flex-1
                      Findings/Impression need a bounded flex parent or they
                      collapse to a 1–2 line editor. Section bodies scroll. */}
                  <div
                    className={
                      exclusiveReportSections
                        ? "flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2"
                        : "flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-3"
                    }
                    data-testid="reporting-canvas-r2"
                    data-report-accordion={exclusiveReportSections ? "exclusive" : "cockpit"}
                    data-pane-focus="reporting"
                    onPointerDownCapture={(e) => {
                      if (shouldIgnorePaneFocusTarget(e.target)) return;
                      enterReportingFocusMode();
                    }}
                  >
                    {activeAnchor?.studyInstanceUID ? (
                      <AnchorRail anchor={activeAnchor} />
                    ) : null}
                    {/* PR #1172 — the persistent identity strip: who this report is
                        about, on screen beside the editor always. Not behind the
                        Study details accordion, not a 10px top-bar mention — the
                        wrong-patient guardrail every other surface already has. */}
                    <ComposerIdentityStrip demography={canonicalDemography} />
                    <div
                      className="shrink-0 rounded-lg border border-emerald-300 bg-gradient-to-r from-emerald-50 via-white to-sky-50"
                      data-testid="full-normal-starting-canvas"
                      data-expanded={startingCanvasExpanded ? "true" : "false"}
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <button
                          type="button"
                          data-testid="starting-canvas-toggle"
                          aria-expanded={startingCanvasExpanded}
                          onClick={() => setStartingCanvasExpanded((v) => !v)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-emerald-100/60"
                          title={startingCanvasExpanded ? "Collapse Starting Canvas" : "Expand Starting Canvas"}
                        >
                          {startingCanvasExpanded ? (
                            <ChevronDown size={12} className="shrink-0 text-emerald-700" />
                          ) : (
                            <ChevronRight size={12} className="shrink-0 text-emerald-700" />
                          )}
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 shrink-0">
                            Starting Canvas
                          </span>
                          {appliedFormatName ? (
                            <Badge variant="outline" className="border-emerald-300 bg-white text-[9px] text-emerald-800 truncate max-w-[14rem]">
                              {appliedFormatName}
                            </Badge>
                          ) : (
                            <span className="truncate text-[10px] text-muted-foreground">
                              Format / Quick Normal
                            </span>
                          )}
                        </button>
                        {!contentLocked && appliedFormatName
                          && appliedPathologyPatches.every((p) => p.stale || p.observation?.role === "baseline" || isSystemNormalPatch(p)) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[9px] shrink-0"
                            onClick={() => useWorkspace.getState().undoLastPatch()}
                            data-testid="undo-full-report"
                          >
                            Undo
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          className="h-6 text-[10px] bg-sky-700 hover:bg-sky-800 text-white shrink-0"
                          onClick={handleStartReport}
                          data-testid="generate-professional-report"
                          disabled={contentLocked}
                          title="Build the full report from this examination's approved normal, your recorded findings and your measurements. No AI."
                        >
                          <FileCheck size={11} className="mr-1" />
                          Generate Professional Report
                        </Button>
                        {instantReportOn && instantReportHold ? (
                          <span
                            className="shrink-0 text-[9px] leading-tight text-amber-800 max-w-[15rem]"
                            data-testid="instant-report-hold"
                            title="The report is not rebuilding itself automatically."
                          >
                            {instantReportHold.message}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setInstantReportEnabled(!instantReportOn)}
                          data-testid="instant-report-toggle"
                          aria-pressed={instantReportOn}
                          title={instantReportOn
                            ? "The report builds itself from your findings as you work, with no AI. Click to stop it rebuilding on its own — press Generate when you want it rebuilt."
                            : "Click to let the report rebuild itself as your findings change. No AI, no provider, no network."}
                          className="h-6 shrink-0 rounded-full border border-sky-300 bg-white px-1.5 text-[9px] text-sky-800 hover:bg-sky-50"
                        >
                          Instant report: {instantReportOn ? "On" : "Off"}
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] shrink-0"
                          onClick={() => {
                            const state = useWorkspace.getState();
                            if (state.reportFormats.length === 0) {
                              toast({
                                title: "Normal reports are still loading",
                                description: "Try Quick Normal again in a moment.",
                              });
                              return;
                            }
                            // The by-id detail read survives the reading-queue
                            // filter; without it a deep-linked study lost its
                            // billed identity and Quick Normal could pick a
                            // different report than the auto-open did.
                            const billed = billedNameFromWorklistRow(workflow.currentRow, worklistDetailQ.data);
                            const decision = resolveNormalBootstrapFormat({
                              ctx: billedStudyContextForNormal(studySetup.studyContext, billed),
                              formats: state.reportFormats,
                              records: state.regionTransitions,
                            });
                            if (!decision || decision.status !== "apply") {
                              const message = quickNormalOutcomeMessage(decision);
                              toast({ title: message.title, description: message.description });
                              return;
                            }
                            state.applyFormatById(decision.format.id);
                            if (useWorkspace.getState().confirmOverwriteOpen) return;
                            const message = quickNormalOutcomeMessage(decision);
                            toast({ title: message.title, description: message.description });
                          }}
                          data-testid="quick-normal-fallback"
                          disabled={contentLocked}
                        >
                          Quick Normal
                        </Button>
                      </div>
                      {startingCanvasExpanded ? (
                        <div className="space-y-2 border-t border-emerald-200/70 px-2 pb-2 pt-1.5">
                          <p className="text-[10px] text-muted-foreground">
                            Apply a Full Normal Report, then record only deviations.
                          </p>
                          <WholeReportFormatControl
                            reportingContext={studySetup.studyContext}
                            modality={workflow.currentRow?.modality ?? null}
                            bodyPartFallback={studySetup.matchedStudyRegion}
                            studyDescription={billedNameFromWorklistRow(workflow.currentRow, worklistDetailQ.data)}
                            hasReportContent={Boolean(techniqueText.trim() || findingsText.trim() || impressionText.trim())}
                            disabled={contentLocked}
                          />
                          <MriAbnormalFormatStrip
                            studyId={studyId ?? null}
                            reportingContext={studySetup.studyContext}
                            modality={workflow.currentRow?.modality ?? null}
                            billedTestName={
                              workflow.currentRow?.testName
                              || workflow.currentRow?.billedTestName
                              || worklistDetailQ.data?.testName
                              || worklistDetailQ.data?.billedTestName
                              || null
                            }
                            studyDescription={
                              workflow.currentRow?.studyDescription
                              ?? worklistDetailQ.data?.studyDescription
                              ?? null
                            }
                            referringDoctorId={workflow.currentRow?.referringDoctorId ?? null}
                            referringDoctorName={
                              workflow.currentRow?.referringDoctorMasterName
                              || workflow.currentRow?.referringDoctor
                              || null
                            }
                            referringDoctorDegree={workflow.currentRow?.referringDoctorDegree ?? null}
                            doctorsCatalog={doctorsCatalogQ.data ?? []}
                            disabled={contentLocked}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div
                      className="shrink-0 rounded-md border border-border/60 bg-muted/10"
                      data-testid="study-details"
                      data-open={studyDetailsOpen ? "true" : "false"}
                    >
                      <button
                        type="button"
                        data-testid="study-details-toggle"
                        aria-expanded={studyDetailsOpen}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/40"
                        onClick={() => {
                          const next = !studyDetailsOpen;
                          setStudyDetailsOpen(next);
                          if (next && !isStudyDetailsSection(activeReportSection)) {
                            activateReportSection("demography");
                          } else if (!next && isStudyDetailsSection(activeReportSection)) {
                            activateReportSection("findings");
                          }
                        }}
                      >
                        {studyDetailsOpen ? (
                          <ChevronDown size={12} className="shrink-0" />
                        ) : (
                          <ChevronRight size={12} className="shrink-0" />
                        )}
                        Study details · patient, referring doctor, region/protocol
                      </button>
                      {studyDetailsOpen ? (
                      <div className="space-y-1 p-1.5">
                    {/* 1. DEMOGRAPHY — canonical, editable, feeds all outputs */}
                    <ReportAccordionSection {...accordionProps("demography")}>
                      {/* The queue row answers to the reading-queue FILTER and is null
                          for any study it excludes (different modality under the
                          active preset, a deep link, a filter change mid-report) —
                          but `canonicalDemography` is detail-first, so the card it
                          feeds survives the filter. Gating on the OPEN STUDY
                          instead of the queue row keeps the editable demography
                          panel on screen for exactly the studies that need it
                          (Radiology Highway Audit, Patient B finding). */}
                      {studyId != null ? (
                        <ReportDemographyCard
                          value={canonicalDemography}
                          onChange={(patch) => setDemographyOverrides((prev) => ({ ...prev, ...patch }))}
                          disabled={contentLocked}
                        />
                      ) : (
                        <p className="py-2 text-xs text-muted-foreground">No study selected.</p>
                      )}
                    </ReportAccordionSection>

                    {/* Report Format — first-class one-click whole-report control.
                        Below demography / study context; before Region and Technique.
                        Same Zustand apply engine as the right-rail picker. */}
                    {false && <div className="px-0.5" data-testid="report-format-primary-slot">
                      <WholeReportFormatControl
                        reportingContext={studySetup.studyContext}
                        modality={workflow.currentRow?.modality ?? null}
                        bodyPartFallback={studySetup.matchedStudyRegion}
                        studyDescription={workflow.currentRow?.studyDescription ?? null}
                        hasReportContent={Boolean(techniqueText.trim() || findingsText.trim() || impressionText.trim())}
                        disabled={contentLocked}
                      />
                    </div>}

                    {/* 2. REFERRING DOCTOR — current doctor, edit, quick chips, add */}
                    <ReportAccordionSection {...accordionProps("refDoctor")}>
                      {/* Same queue-filter independence as the demography card above:
                          the current name reads canonicalDemography (detail-first),
                          so the block renders whenever a study is open. */}
                      {studyId != null ? (
                        <div className="space-y-1" data-testid="ref-dr-block">
                          <ReferringDoctorQuickSelect
                            worklistId={studyId ?? 0}
                            currentName={canonicalDemography.referringDoctor || (workflow.currentRow as { referringDoctor?: string } | null)?.referringDoctor}
                            doctorsCatalog={doctorsCatalogQ.data ?? []}
                          />
                        </div>
                      ) : (
                        <p className="py-2 text-xs text-muted-foreground">No study selected.</p>
                      )}
                    </ReportAccordionSection>

                    {/* 3. REGION / STUDY — one Study/Region truth. Protocol still
                         auto-applies as metadata when region changes. Format apply
                         is first-class above (WholeReportFormatControl). */}
                    <ReportAccordionSection {...accordionProps("region")}>
                    <div className="space-y-2">
                    {/* One-click Start Report. Stays switched off on purpose, and
                        not because it was forgotten: `handleStartReport` now IS the
                        generator button in the Starting Canvas header above, so this
                        strip would be a second button for one action, in an accordion
                        that can be collapsed. Its copy is corrected rather than left
                        to rot so that reviving it cannot resurrect the old promise —
                        "applies protocol, template, and normal findings", which used
                        to mean "overwrites what you had". */}
                    {false && !contentLocked && reportNeedsStart && (studySetup.matchedStudyRegion || studySetup.studyRegions[0]) && (
                      <div
                        className="flex flex-wrap items-center gap-2 p-3 rounded-lg border-2 border-amber-400/50 bg-gradient-to-r from-amber-50 via-orange-50/80 to-amber-50/40 shadow-sm"
                        data-testid="start-report-banner"
                      >
                        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                          <Zap size={18} className="text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-[180px]">
                          <p className="text-sm font-semibold text-amber-950">
                            Ready to report — {studySetup.matchedStudyRegion ?? studySetup.studyRegions[0]}
                          </p>
                          <p className="text-[11px] text-amber-800/80">
                            One click loads this study&apos;s protocol and builds the report from its
                            approved normal, your selected findings and your measurements. Nothing you
                            already typed is discarded, and you can undo immediately. No AI.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs font-semibold gap-1 bg-amber-600 hover:bg-amber-700 text-white border-0"
                          onClick={handleStartReport}
                          data-testid="btn-start-report"
                        >
                          <Zap size={14} /> Generate Professional Report
                        </Button>
                      </div>
                    )}

                    {canUndoStartReport && !bootstrapAppliedThisOpen && !contentLocked && (
                      <div className="flex items-center gap-2 p-2 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs">
                        <span className="flex-1">Report bootstrapped — undo restores your previous text.</span>
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={undoStartReport}>
                          Undo start
                        </Button>
                      </div>
                    )}

                    {/* Single study-ready status strip (startup facts only) */}
                    {studyReadyStatus.label && !contentLocked && (
                      <div
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[11px] ${
                          studyReadyStatus.kind === "normal_not_applied"
                            ? "border-amber-200/80 bg-amber-50/70 text-amber-900"
                            : "border-emerald-200/70 bg-emerald-50/60 text-emerald-900"
                        }`}
                        data-testid="study-ready-status"
                        data-kind={studyReadyStatus.kind}
                      >
                        <span className={studyReadyStatus.kind === "normal_not_applied" ? "flex-1" : "flex-1 min-w-0 truncate"}>
                          {studyReadyStatus.label}
                        </span>
                        {studyReadyStatus.canUndo && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] shrink-0"
                            onClick={undoStartReport}
                            data-testid="study-ready-undo"
                          >
                            Undo
                          </Button>
                        )}
                      </div>
                    )}

                    {/* MRI readiness — when Companion is not shown */}
                    {!isLocked && isMriModality && !companionEligible && (
                      <MriReadinessStrip
                        studyRegion={studySetup.matchedStudyRegion}
                        protocolName={studySetup.activeProtocol?.name ?? null}
                        protocolApplied={!!studySetup.activeProtocol}
                        templateName={studySetup.selectedTemplate?.templateName ?? null}
                        templateMismatch={studySetup.templateMismatch}
                        priorCount={0}
                        pendingMeasurements={0}
                        checklistPercent={studySetup.activeProtocol ? studySetup.checklistPercent : null}
                        qualityScore={qualityScore.score}
                        disabled={contentLocked}
                        onOpenTab={(tab) => {
                          if (tab === "measurements") openReportingTools("measurements");
                          else if (tab === "templates" || tab === "quickselect") openReportingTools("templates");
                          else if (tab === "prior") openReportingTools("priors");
                          else openReportingTools("more");
                        }}
                      />
                    )}

                    {/* Study / Region — ONE region truth (format lives above). */}
                    <StudyRegionReportFormatSection
                      availableStudyTabs={studySetup.availableStudyTabs}
                      selectedRegion={studySetup.matchedStudyRegion}
                      autoDetectedRegion={studySetup.autoStudyRegion}
                      regionOverridden={studySetup.regionOverrides != null}
                      onSelectRegion={studySetup.selectPrimaryRegion}
                      onResetAutoRegion={studySetup.resetRegionOverrides}
                      pendingRegionTransition={studySetup.pendingRegionTransition?.plan ?? null}
                      onConfirmRegionTransition={studySetup.confirmRegionTransition}
                      onCancelRegionTransition={studySetup.cancelRegionTransition}
                      modality={workflow.currentRow?.modality ?? null}
                      disabled={contentLocked}
                      testName={studyNameForExport || studySetup.testName}
                      regionMatchSource={
                        studySetup.regionOverrides != null
                          ? "override"
                          : studySetup.autoRegionMatch.source
                      }
                      dicomMatchedRegion={studySetup.autoRegionMatch.dicomRegion}
                      billedMatchedRegion={studySetup.autoRegionMatch.billedRegion}
                      activeProtocolName={studySetup.activeProtocol?.name ?? null}
                      onReapplyDefaults={() => studySetup.reapplyDefaults()}
                      canReapplyDefaults={studySetup.studyRegions.length > 0}
                    />

                    </div>
                    </ReportAccordionSection>
                      </div>
                      ) : null}
                    </div>

                    {/* 4. HISTORY — History Quick Select + editor + dictation together */}
                    <ReportAccordionSection {...accordionProps("history")}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1.5">
                        <ClinicalHistoryChipStrip
                          chips={clinicalHistoryChips}
                          studyTabs={clinicalHistoryStudyTabs}
                          selectedStudyTabId={selectedClinicalHistoryTab?.id ?? null}
                          selectedStudyTabName={studySetup.matchedStudyRegion}
                          clinicalHistoryText={clinicalHistoryText}
                          onClinicalHistoryChange={(next) => useWorkspace.getState().setField("clinicalHistory", next)}
                          isOwner={isOwner}
                          disabled={contentLocked}
                        />
                        <FindingsEditor
                          field="clinicalHistory"
                          label="Clinical History"
                          minHeight="56px"
                          placeholder="Presenting complaint and relevant history."
                        />
                      </div>
                      {!contentLocked && (
                        <FieldCareMic voice={voiceSession} target="clinicalHistory" />
                      )}
                    </div>
                    </ReportAccordionSection>

                    {/* 5. TECHNIQUE — Study Tab technique choices + one editable field */}
                    <ReportAccordionSection {...accordionProps("technique")}>
                    <TechniqueChoiceStrip
                      protocols={studySetup.quickSelectData?.protocols ?? []}
                      studyTabs={clinicalHistoryStudyTabs}
                      selectedStudyTabId={studySetup.selectedStudyTabId}
                      selectedStudyTabName={studySetup.matchedStudyRegion}
                      activeProtocolId={studySetup.activeProtocol?.id ?? null}
                      onSelectProtocol={(p) => studySetup.requestProtocolChange(p)}
                      techniqueMismatch={studySetup.techniqueMismatch}
                      onLoadCurrentDefault={studySetup.loadCurrentRegionDefaultTechnique}
                      techniqueEmpty={!techniqueText.trim()}
                      isOwner={isOwner}
                      disabled={contentLocked}
                    />
                    <div className="flex items-center gap-2 mt-1.5" data-testid="canonical-technique-editor">
                      <div className="flex-1">
                        <FindingsEditor
                          field="technique"
                          label="Technique"
                          minHeight="60px"
                          placeholder="Modality, sequences, contrast..."
                        />
                      </div>
                      {!contentLocked && (
                        <FieldCareMic voice={voiceSession} target="technique" />
                      )}
                    </div>
                    </ReportAccordionSection>

                    {/* 6. FINDINGS — region-aware macros on top, editor as the hero,
                         and exactly ONE assistance drawer open at a time below. */}
                    <ReportAccordionSection
                      {...accordionProps("findings")}
                      emphasis="primary"
                      continuous={
                        // FEW-CLICKS (pass 2): the wide-desktop cockpit — Findings
                        // and Impression stay open together so the most-traveled
                        // hop in the composer costs zero clicks. Yields when a
                        // non-primary section is active (its exclusive 66vh
                        // economics still apply) and on every laptop/viewport
                        // the cockpit cannot seat (see
                        // shouldUseContinuousPrimarySections).
                        continuousPrimarySections
                          && (activeReportSection == null
                            || activeReportSection === "findings"
                            || activeReportSection === "impression")
                      }
                      onActivate={() => focusClinicalEditor("findings")}
                      onBodyActivate={() => focusClinicalEditor("findings")}
                      headerExtra={
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 border-sky-300 bg-sky-50 px-2 text-[10px] text-sky-900"
                            onClick={() => openReportingTools("quick-insert")}
                            data-testid="open-quick-insert"
                          >
                            <Plus className="mr-1 h-3 w-3" /> Quick Insert
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => openReportingTools("structured")}
                          >
                            Structured
                          </Button>
                          {!contentLocked && (
                            <FieldCareMic voice={voiceSession} target="findings" />
                          )}
                        </div>
                      }
                    >
                    {/* Legacy inline assistance stays mounted for state compatibility
                        but is visually retired. Its radiologist-facing controls now
                        live only under the single Reporting Tools surface. */}
                    {false && (
                    <div>
                    {/* A. Region-aware macros — driven by the Region section above.
                        Pencil edits a box; the dashed blank box adds a new one.
                        Same add/edit also lives in Settings → Radiology → Quick Select. */}
                    {!useStructured && (
                      <ChocolateBoxMacros
                        setKey={studySetup.chocolateBoxSet.key}
                        label={studySetup.chocolateBoxSet.label}
                        disabled={contentLocked}
                        onInsert={studySetup.applyChocolateTile}
                        onRemoveBundle={(bundleId) => useWorkspace.getState().removeMacroBundle(bundleId)}
                      />
                    )}

                    {isBrainMeasuresReportingContext({
                      modality: workflow.currentRow?.modality,
                      region: studySetup.matchedStudyRegion,
                      family: studySetup.studyContext?.family,
                      studyDescription: workflow.currentRow?.studyDescription ?? null,
                    }) && (
                      <>
                        {/* MRI Brain's 16 sub-master palettes render here, in the report body,
                            on the same tier as the lumbar / cervical / dorsal / chest canvases.
                            They used to exist only inside the tools rail's Structured sub-tab,
                            so a routine brain study showed measurements with no palette above
                            them and no hint that the catalog existed. `MriBrainCanvas` is
                            MRI-only, so it keeps its own narrower predicate: a CT brain gets
                            the measures strip and not the MRI tiles. */}
                        {isMriBrainReportingContext({
                          modality: workflow.currentRow?.modality,
                          region: studySetup.matchedStudyRegion,
                          family: studySetup.studyContext?.family,
                          studyDescription: workflow.currentRow?.studyDescription ?? null,
                        }) ? (
                          <div data-testid="r2-brain-canvas-body">
                            <MriBrainCanvas
                              disabled={contentLocked}
                              region={studySetup.matchedStudyRegion ?? "Brain"}
                            />
                          </div>
                        ) : null}
                        <BrainMeasuresStrip
                          disabled={contentLocked}
                          region={studySetup.matchedStudyRegion ?? "Brain"}
                        />
                      </>
                    )}

                    {isMriLumbarReportingContext({
                      modality: workflow.currentRow?.modality,
                      region: studySetup.matchedStudyRegion,
                      family: studySetup.studyContext?.family,
                      spineSegment: studySetup.studyContext?.spineSegment,
                      protocolName: studySetup.activeProtocol?.name ?? null,
                      studyDescription: workflow.currentRow?.studyDescription ?? null,
                    }) && (
                      <>
                        {(appliedFormatReportTitle || appliedFormatName) ? (
                          <div
                            className="mb-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-800"
                            data-testid="r2-applied-format-lumbar"
                          >
                            <span className="font-semibold">Format:</span>{" "}
                            {appliedFormatName ?? appliedFormatReportTitle}
                            {appliedPathologyPatches.some((p) => !p.stale) ? (
                              <span className="ml-1 text-amber-800">· modified</span>
                            ) : null}
                          </div>
                        ) : null}
                        <MriLumbarCanvas
                          patches={appliedPathologyPatches}
                          findingsText={findingsText}
                          disabled={contentLocked}
                          canalApByLevel={canalApByLevel}
                          onFocusRegion={(key) => {
                            useWorkspace.getState().touchCoverageViewed(key);
                          }}
                          onApplyLevel={(level, regionKey, sel) => {
                            const { bundleId, observations } = buildLumbarLevelApplyBundle({
                              level,
                              sel,
                              region: studySetup.matchedStudyRegion ?? "LS Spine",
                            });
                            if (observations.length === 0) return;
                            useWorkspace.getState().applyMacroBundle({ bundleId, observations });
                            useWorkspace.getState().setCoverageMark(regionKey, "partial");
                          }}
                          onInsertRegionPhrase={(regionKey, phrase, concept) => {
                            useWorkspace.getState().applyPathologyOverlay({
                              id: `r2-region-${regionKey}-${concept}`,
                              incoming: { findings: phrase },
                              templates: { findings: phrase },
                              ownership: {
                                anatomicalSection: regionKey,
                                conflictGroup: concept,
                                concept,
                                baselineReplaces: "",
                              },
                              source: "structured-template",
                              region: studySetup.matchedStudyRegion ?? "LS Spine",
                              concept,
                              label: `${regionKey} ${concept}`,
                              findingsText: phrase,
                            });
                            useWorkspace.getState().setCoverageMark(regionKey, "partial");
                          }}
                        />
                        {deriveCanvasNarrativeState({
                          findingsText,
                          patches: appliedPathologyPatches,
                          isLumbar: true,
                        }).banner ? (
                          <div
                            className="mt-1.5 rounded-md border border-indigo-200 bg-indigo-50/70 px-2 py-1.5 text-[10px] text-indigo-950"
                            data-testid="r2-unstructured-narrative-banner"
                          >
                            {deriveCanvasNarrativeState({
                              findingsText,
                              patches: appliedPathologyPatches,
                              isLumbar: true,
                            }).banner}
                          </div>
                        ) : null}
                        <SpineApCanalMeasurements segment="lumbar" disabled={contentLocked} />
                      </>
                    )}

                    {/* ── MRI Cervical Spine Canvas ────────────────────────── */}
                    {isMriCervicalReportingContext({
                      modality: workflow.currentRow?.modality,
                      region: studySetup.matchedStudyRegion,
                      family: studySetup.studyContext?.family,
                      spineSegment: studySetup.studyContext?.spineSegment,
                      protocolName: studySetup.activeProtocol?.name ?? null,
                      studyDescription: workflow.currentRow?.studyDescription ?? null,
                    }) && (
                      <>
                        {(appliedFormatReportTitle || appliedFormatName) ? (
                          <div
                            className="mb-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-800"
                            data-testid="r2-applied-format-cervical"
                          >
                            <span className="font-semibold">Format:</span>{" "}
                            {appliedFormatName ?? appliedFormatReportTitle}
                            {appliedPathologyPatches.some((p) => !p.stale) ? (
                              <span className="ml-1 text-emerald-800">· modified</span>
                            ) : null}
                          </div>
                        ) : null}
                        <MriCervicalCanvas
                          patches={appliedPathologyPatches}
                          findingsText={findingsText}
                          disabled={contentLocked}
                          canalApByLevel={canalApByLevel}
                          onFocusRegion={(key) => {
                            useWorkspace.getState().touchCoverageViewed(key);
                          }}
                          onApplyLevel={(level, regionKey, sel) => {
                            const { bundleId, observations } = buildCervicalLevelApplyBundle({
                              level,
                              sel,
                              region: studySetup.matchedStudyRegion ?? "Cervical Spine",
                            });
                            if (observations.length === 0) return;
                            useWorkspace.getState().applyMacroBundle({ bundleId, observations });
                            useWorkspace.getState().setCoverageMark(regionKey, "partial");
                          }}
                          onInsertRegionPhrase={(regionKey, phrase, concept) => {
                            useWorkspace.getState().applyPathologyOverlay({
                              id: `r2-cerv-region-${regionKey}-${concept}`,
                              incoming: { findings: phrase },
                              templates: { findings: phrase },
                              ownership: {
                                anatomicalSection: regionKey,
                                conflictGroup: concept,
                                concept,
                                baselineReplaces: "",
                              },
                              source: "structured-template",
                              region: studySetup.matchedStudyRegion ?? "Cervical Spine",
                              concept,
                              label: `${regionKey} ${concept}`,
                              findingsText: phrase,
                            });
                            useWorkspace.getState().setCoverageMark(regionKey, "partial");
                          }}
                        />
                        <SpineApCanalMeasurements segment="cervical" disabled={contentLocked} />
                      </>
                    )}

                    {/* ── MRI Dorsal Spine Canvas ──────────────────────────── */}
                    {isMriDorsalReportingContext({
                      modality: workflow.currentRow?.modality,
                      region: studySetup.matchedStudyRegion,
                      family: studySetup.studyContext?.family,
                      spineSegment: studySetup.studyContext?.spineSegment,
                      protocolName: studySetup.activeProtocol?.name ?? null,
                      studyDescription: workflow.currentRow?.studyDescription ?? null,
                    }) && (
                      <>
                        {(appliedFormatReportTitle || appliedFormatName) ? (
                          <div
                            className="mb-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-800"
                            data-testid="r2-applied-format-dorsal"
                          >
                            <span className="font-semibold">Format:</span>{" "}
                            {appliedFormatName ?? appliedFormatReportTitle}
                            {appliedPathologyPatches.some((p) => !p.stale) ? (
                              <span className="ml-1 text-teal-800">· modified</span>
                            ) : null}
                          </div>
                        ) : null}
                        <MriDorsalCanvas
                          patches={appliedPathologyPatches}
                          findingsText={findingsText}
                          disabled={contentLocked}
                          onFocusRegion={(key) => {
                            useWorkspace.getState().touchCoverageViewed(key);
                          }}
                          onApplyLevel={(level, regionKey, sel) => {
                            const { bundleId, observations } = buildDorsalLevelApplyBundle({
                              level,
                              sel,
                              region: studySetup.matchedStudyRegion ?? "Dorsal Spine",
                            });
                            if (observations.length === 0) return;
                            useWorkspace.getState().applyMacroBundle({ bundleId, observations });
                            useWorkspace.getState().setCoverageMark(regionKey, "partial");
                          }}
                          onInsertRegionPhrase={(regionKey, phrase, concept) => {
                            useWorkspace.getState().applyPathologyOverlay({
                              id: `r2-dors-region-${regionKey}-${concept}`,
                              incoming: { findings: phrase },
                              templates: { findings: phrase },
                              ownership: {
                                anatomicalSection: regionKey,
                                conflictGroup: concept,
                                concept,
                                baselineReplaces: "",
                              },
                              source: "structured-template",
                              region: studySetup.matchedStudyRegion ?? "Dorsal Spine",
                              concept,
                              label: `${regionKey} ${concept}`,
                              findingsText: phrase,
                            });
                            useWorkspace.getState().setCoverageMark(regionKey, "partial");
                          }}
                        />
                      </>
                    )}

                    <FindingComposer
                      region={composerRegion}
                      quickFindings={composerQuickFindings.length ? composerQuickFindings : quickFindingTemplatesRef.current}
                      draft={composerDraft}
                      onDraftChange={(d) => {
                        setComposerDraft(d);
                        if (!d.editingId) setComposerBanner(null);
                      }}
                      disabled={contentLocked}
                      banner={composerBanner}
                      onApplied={(status) => {
                        if (status === "applied") {
                          setComposerBanner(null);
                          feedbackAfterAbnormalApply();
                        }
                        if (status === "pending") {
                          toast({ title: "Confirm replacement", description: "Same-slot finding needs confirmation." });
                        }
                        if (status === "refused") {
                          toast({
                            title: "Finding not added",
                            description:
                              "Nothing was written to this report. The finding you were editing belongs to the study that was open before this one — add it again if it is this patient's.",
                            variant: "destructive",
                          });
                        }
                      }}
                    />

                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Observations
                        </span>
                        <NormalBaselineBadge
                          appliedFormatName={appliedFormatName}
                          appliedFormatReportTitle={appliedFormatReportTitle}
                          appliedPathologyPatches={appliedPathologyPatches}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1 shrink-0"
                        data-testid="undo-last-abnormal"
                        title="Restore the report state before the last abnormal selection. (Alt+U)"
                        disabled={!undoLastAbnormalEnabled}
                        onClick={handleUndoLastAbnormal}
                      >
                        <Undo2 className="h-3 w-3" />
                        Undo Last Abnormal
                      </Button>
                    </div>
                    <AbnormalPatternSuggestionStrip
                      suggestions={vm.patternSuggestions}
                      appliedMarkers={vm.appliedPatternMarkers}
                      suggestionsEnabled={vm.abnormalPatternSuggestionsEnabled}
                      contentLocked={contentLocked}
                      isFinalized={isFinalized}
                      onApply={vm.applyPattern}
                      onDismiss={vm.dismissPattern}
                    />
                    <ObservationLedgerPanel
                      patches={appliedPathologyPatches}
                      findingsText={findingsText}
                      selectedId={selectedObservationId}
                      keyImageCounts={keyImageCounts}
                      measurementChips={measurementChips}
                      impressionDisabled={contentLocked}
                      onOpenKeyImages={(id) => {
                        setKeyImageFilterObsId(id);
                        useWorkspace.getState().setSelectedObservationId(id);
                      }}
                      onJumpToMeasurement={(id) => {
                        const m = useWorkspace.getState().structuredViewerMeasurements.items
                          .find((x) => x.observationId === id && x.anchor);
                        const a = m?.anchor;
                        if (!a) {
                          toast({ title: "No source image for this measurement" });
                          return;
                        }
                        const framesOk = embeddedViewerRef.current?.goToAnchor({
                          studyInstanceUID: a.studyInstanceUID,
                          seriesInstanceUID: a.seriesInstanceUID,
                          sopInstanceUID: a.sopInstanceUID,
                          frameNumber: a.frameNumber,
                        });
                        if (!framesOk) {
                          const win = embeddedViewerRef.current?.getOhifWindow?.();
                          if (a.studyInstanceUID) {
                            requestOhifNavigateToAnchor({
                              target: win,
                              studyInstanceUID: a.studyInstanceUID,
                              seriesInstanceUID: a.seriesInstanceUID,
                              sopInstanceUID: a.sopInstanceUID,
                              frameNumber: a.frameNumber,
                              targetOrigin: ohifTargetOriginRef.current,
                            });
                          }
                        }
                      }}
                      onEdit={openComposerForObservation}
                      onToggleImpression={(id, include) => {
                        const r = useWorkspace.getState().setObservationImpressionParticipation(id, include);
                        if (r === "blocked") {
                          toast({ title: "Report is finalized", variant: "destructive" });
                        }
                      }}
                      onSelect={(id) => {
                        useWorkspace.getState().setSelectedObservationId(id);
                        const p = useWorkspace.getState().appliedPathologyPatches.find((x) => x.id === id);
                        const level = (p?.observation?.level ?? p?.ownership.anatomicalSection ?? "").trim();
                        if (level) {
                          // Each spine canvas anchors its level blocks under its own
                          // segment prefix — lumbar `r2-region-`, cervical
                          // `r2-cerv-region-`, dorsal `r2-dors-region-`, dorso-lumbar
                          // `r2-dl-region-`. The unqualified lookup only ever matched
                          // the lumbar one, so clicking a cervical or dorsal ledger row
                          // selected it and scrolled nowhere.
                          const target = ["", "cerv-", "dors-", "dl-"]
                            .map((prefix) => document.getElementById(`r2-${prefix}region-${level}`))
                            .find(Boolean);
                          target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        }
                      }}
                    />
                    <GhostLayer
                      contradictionHints={[
                        ...structuredCanalApContradiction(appliedPathologyPatches),
                        ...ledgerSeverityContradiction(appliedPathologyPatches, impressionText),
                        ...validateReport({
                          findings: findingsText,
                          impression: impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
                        }).filter((w) => /contradict|mismatch|severity|stenosis|moderate|severe/i.test(w)),
                      ].slice(0, 5)}
                    />

                    {!useStructured && (
                      <FindingsAnatomyStrip
                        findings={catalogQuickFindings}
                        selectedStudyTabId={studySetup.selectedStudyTabId}
                        selectedStudyTabName={studySetup.matchedStudyRegion}
                        activeAnatomy={activeFindingsAnatomy}
                        selectedIds={selectedQuickIds}
                        blockedIds={blockedQuickFindingIds}
                        onToggle={handleQuickToggle}
                        onFindingClick={(f) => studySetup.handleFindingClick(f, selectedQuickIds, handleQuickToggle)}
                        disabled={contentLocked}
                      />
                    )}
                    </div>
                    )}

                    {studySetup.templateMismatch && (
                      <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-amber-300 bg-amber-50 text-[11px] text-amber-900" data-testid="template-mismatch-banner">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>
                          Findings template ({studySetup.selectedTemplate?.templateName ?? "unknown"}) does not match study region
                          ({studySetup.matchedStudyRegion ?? studySetup.studyRegions[0]}).
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] ml-auto"
                          disabled={contentLocked}
                          onClick={() => {
                            pendingStructuredPopulateRef.current = true;
                            studySetup.loadCorrectTemplate();
                          }}
                          data-testid="load-correct-template"
                        >
                          Load {studySetup.matchedStudyRegion ?? studySetup.studyRegions[0]} template
                        </Button>
                      </div>
                    )}

                    {false && useStructured ? (
                      <div className="flex flex-col gap-2" data-testid="structured-findings-cards">
                        {Object.entries(findingsMap).map(([label, item]) => {
                          const baseline = studySetup.templateFindingsSections.find((s) => s.label === label)?.normal ?? item.text;
                          return (
                            <div key={label} className={`flex flex-col gap-1.5 border rounded-xl p-2.5 shadow-sm transition-colors ${
                              item.normal
                                ? "border-emerald-200/90 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/40"
                                : "border-rose-200/90 bg-gradient-to-br from-rose-50/70 via-white to-orange-50/30"
                            }`}>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs font-bold flex-1 min-w-0 truncate" title={label}>
                                  {label}
                                </Label>
                                <div className="inline-flex rounded-lg border border-border overflow-hidden shrink-0 shadow-sm" role="group">
                                  <button
                                    type="button"
                                    disabled={contentLocked}
                                    aria-pressed={item.normal}
                                    className={`h-7 px-2.5 text-[10px] font-bold transition-colors disabled:opacity-50 ${
                                      item.normal ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-inner" : "bg-white text-emerald-800 hover:bg-emerald-50"
                                    }`}
                                    onClick={() => setFindingsMap((prev) => ({
                                      ...prev,
                                      [label]: { normal: true, text: baseline },
                                    }))}
                                  >
                                    Normal
                                  </button>
                                  <button
                                    type="button"
                                    disabled={contentLocked}
                                    aria-pressed={!item.normal}
                                    className={`h-7 px-2.5 text-[10px] font-bold border-l border-border transition-colors disabled:opacity-50 ${
                                      !item.normal ? "bg-gradient-to-br from-rose-500 to-orange-600 text-white shadow-inner" : "bg-white text-rose-800 hover:bg-rose-50"
                                    }`}
                                    onClick={() => setFindingsMap((prev) => {
                                      const cur = prev[label];
                                      const nextText =
                                        cur.normal && cur.text.trim() === baseline.trim() ? "" : cur.text;
                                      return { ...prev, [label]: { normal: false, text: nextText } };
                                    })}
                                  >
                                    Abnormal
                                  </button>
                                </div>
                                {!contentLocked && (
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                                    title={`Remove "${label}" section`}
                                    aria-label={`Remove ${label} section`}
                                    onClick={() => setFindingsMap((prev) => {
                                      const next = { ...prev };
                                      delete next[label];
                                      return next;
                                    })}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                              {!item.normal ? (
                                <Textarea
                                  value={item.text}
                                  onChange={(e) => setFindingsMap((prev) => ({
                                    ...prev,
                                    [label]: { ...prev[label], text: e.target.value },
                                  }))}
                                  placeholder="Describe finding..."
                                  className="min-h-[48px] text-xs mt-1 resize-none"
                                  disabled={contentLocked}
                                  data-editor="findings-section"
                                />
                              ) : (
                                <div className="text-xs text-muted-foreground truncate">{item.text}</div>
                              )}
                            </div>
                          );
                        })}
                        {Object.keys(findingsMap).length === 0 && (
                          <div className="text-xs text-muted-foreground text-center py-6 border rounded-md bg-muted/20">
                            Start Report or select a structured template to load section cards.
                          </div>
                        )}
                      </div>
                    ) : false && studySetup.highlightFindings ? (
                      <ConnectedFindingsHighlightEditor
                        placeholder="Type findings. Abnormal lines tint amber."
                        className="min-h-[50vh]"
                        disabled={contentLocked}
                        dataEditor="findings"
                      />
                    ) : linkedStudy && primaryFindingsSection ? (
                      <MultiStudyFindingsEditors disabled={contentLocked} />
                    ) : (
                      /* B. The editor is the hero. It hosts no Quick Select strip:
                         each section renders its own, region-scoped, with its own
                         draft save wired. */
                      <FindingsEditor
                        field="findings"
                        label=""
                        minHeight="50vh"
                        fillHeight
                        placeholder="Type findings. Use :macro + Tab for snippets. Ctrl+Enter for a phrase suggestion (not AI)."
                        showGhost
                        transientHighlight={
                          abnormalHighlight
                            ? { needle: abnormalHighlight.needle, token: abnormalHighlight.token }
                            : null
                        }
                        enableDictationBreaks
                        onClinicalFocus={(f) => { if (f === "findings" || f === "impression") focusClinicalEditor(f); }}
                      />
                    )}
                    {ledgerHydrationWarning && (
                      <div
                        data-testid="ledger-hydration-warning"
                        className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900"
                      >
                        <span>{ledgerHydrationWarning}</span>
                        <button type="button" className="underline" onClick={() => useWorkspace.getState().dismissLedgerHydrationWarning()}>Dismiss</button>
                      </div>
                    )}
                    {ownershipReviewWarnings.length > 0 && (
                      <div
                        data-testid="unowned-sibling-warning"
                        className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1 text-[10px] text-amber-950"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{ownershipReviewWarnings[0]?.hint}</span>
                          <button type="button" className="underline" onClick={() => useWorkspace.getState().dismissOwnershipReview()}>Dismiss</button>
                        </div>
                        <p className="mt-0.5 text-amber-900/80">Kept as written — not deleted. Nearby sentence may now conflict.</p>
                        <ul className={`mt-1 space-y-0.5 ${ownershipReviewWarnings.length > 2 ? "max-h-16 overflow-y-auto" : ""}`}>
                          {ownershipReviewWarnings.map((w, i) => (
                            <li key={`${w.token}-${i}`} data-testid={`unowned-sibling-warning-${i}`}>
                              <span className="font-semibold">“{w.token}”</span>
                              {" — "}
                              <span>{w.sentence}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="hidden" aria-hidden="true"><OwnershipTracePanel /></div>

                    {/* Retired inline drawer surface; Reporting Tools is authoritative. */}
                    {false && (
                    <div>
                      <FindingsToolTabs
                        active={activeFindingsTool}
                        onSelect={selectFindingsTool}
                        badges={{
                          quickAdd: selectedQuickIds.size || null,
                          structured: formatHasStructuredFields(studySetup.selectedTemplate?.sectionsJson) ? "●" : null,
                        }}
                        unavailable={{
                          structured: !formatHasStructuredFields(studySetup.selectedTemplate?.sectionsJson),
                        }}
                      />

                      {/* Findings Quick Select — the full existing tile set,
                          scoped to the region chosen in the Region section */}
                      <FindingsToolDrawer id="quickSelect" active={activeFindingsTool === "quickSelect"}>
                        <FindingsAnatomyChips
                          findings={catalogQuickFindings}
                          selectedStudyTabId={studySetup.selectedStudyTabId}
                          selectedStudyTabName={studySetup.matchedStudyRegion}
                          activeAnatomy={activeFindingsAnatomy}
                          onAnatomyChange={setActiveFindingsAnatomy}
                          disabled={contentLocked}
                          sticky
                        />
                        <QuickSelectStrip
                          field="findings"
                          bodyPart={studySetup.matchedStudyRegion}
                          anatomyFilter={activeFindingsAnatomy}
                          disabled={contentLocked}
                          onToggle={handleQuickToggle}
                          onStructuredPick={(b) => studySetup.handleFindingClick(b, selectedQuickIds, handleQuickToggle)}
                          onAfterPick={() => { feedbackAfterAbnormalApply(); }}
                        />
                      </FindingsToolDrawer>

                      {/* Quick Add / Clinic Quick Select — region-aware from the
                          Region section; cross-region access via "Change / all regions" */}
                      <FindingsToolDrawer id="quickAdd" active={activeFindingsTool === "quickAdd"}>
                        <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/40 via-white to-orange-50/30 p-2.5 shadow-sm shadow-amber-100/50" data-testid="clinic-quick-select">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-amber-500 to-orange-600 text-[10px] font-black text-white shadow-sm">Q</span>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
                              Clinic Quick Select{studySetup.matchedStudyRegion ? ` — ${studySetup.matchedStudyRegion}` : ""}
                            </div>
                          </div>
                          <QuickFindingsPanel
                            selectedIds={selectedQuickIds}
                            blockedIds={blockedQuickFindingIds}
                            onToggle={handleQuickToggle}
                            onFindingClick={(f) => studySetup.handleFindingClick(f, selectedQuickIds, handleQuickToggle)}
                            onEditBeforeInsert={handleEditBeforeInsert}
                            side={quickSide}
                            onSideChange={setQuickSide}
                            disabled={contentLocked}
                            initialStudyHint={studySetup.studyHint || null}
                            selectedRegions={studySetup.studyRegions}
                            onRegionToggle={studySetup.handleRegionToggle}
                            compactRegions
                            isAdmin={isOwner}
                            activeProtocolId={studySetup.activeProtocol?.id ?? null}
                            onProtocolChange={studySetup.requestProtocolChange}
                            onChecklistChange={studySetup.handleChecklistChange}
                            onMeasurement={(template, value) => appendFindings(template.replace(/\{value\}/gi, value).replace(/\{val\}/gi, value))}
                            onInsertNormals={(text) => appendFindings(text)}
                            onAcceptLearnedSuggestion={(text) => {
                              useWorkspace.getState().mergeField("recommendation", text, "quick-findings");
                            }}
                            onFindingsLoaded={(findings) => {
                              quickFindingTemplatesRef.current = findings;
                              setComposerQuickFindings(findings);
                            }}
                            externalSearch={qsExternalSearch}
                            selectedStudyTabId={studySetup.selectedStudyTabId}
                            selectedStudyTabName={studySetup.matchedStudyRegion}
                            clinicalHistoryText={clinicalHistoryText}
                          />
                        </div>
                      </FindingsToolDrawer>

                      {/* Structured format (P1) — level-based / repeating groups */}
                      <FindingsToolDrawer id="structured" active={activeFindingsTool === "structured"}>
                        <StructuredFormatPanel
                          sectionsJson={studySetup.selectedTemplate?.sectionsJson}
                          values={structuredValues}
                          disabled={contentLocked}
                          onValuesChange={(next) => {
                            structuredTouchedRef.current = true;
                            setStructuredValues(next);
                            scheduleStructuredDraftSave();
                          }}
                          onLoadAllNormals={() => {
                            structuredTouchedRef.current = true;
                            const doc = adaptSectionsJson(studySetup.selectedTemplate?.sectionsJson);
                            setStructuredValues({});
                            setFindingsMap(allNormalFindingsMap(doc));
                            setUseStructured(true);
                            scheduleStructuredDraftSave();
                          }}
                          onAcceptImpression={acceptStructuredImpressionCandidate}
                        />
                        {!formatHasStructuredFields(studySetup.selectedTemplate?.sectionsJson) && (
                          <p className="px-1 py-2 text-[11px] text-muted-foreground">
                            No structured format for this template. Pick a template in
                            {" "}
                            <button type="button" className="underline underline-offset-2" onClick={() => setActiveReportSection("region")}>
                              Region / Study / Report Format
                            </button>
                            .
                          </p>
                        )}
                      </FindingsToolDrawer>

                      {/* Suggestions — prior-interval sentences, pending viewer
                          measurements, OB dashboard and the USG/CT Companion */}
                      <FindingsToolDrawer id="suggestions" active={activeFindingsTool === "suggestions"}>
                        <div className="space-y-2" data-testid="findings-suggestions">
                          {!isLocked && workflow.currentRow?.patientId && (
                            <PriorComparisonToolbar
                              patientId={workflow.currentRow!.patientId ?? undefined}
                              excludeStudyId={workflow.currentRow?.studyId ?? studyId ?? undefined}
                              modality={workflow.currentRow!.modality ?? ""}
                              studyDescription={workflow.currentRow!.studyDescription ?? ""}
                              comparisonMissing={false}
                              disabled={contentLocked}
                              onInsertFindings={appendFindings}
                              onOpenPriorTab={() => rightPanelRef.current?.expand()}
                            />
                          )}
                          {!isLocked && workflow.currentRow?.studyInstanceUID && (
                            <ViewerMeasurementsBanner
                              studyInstanceUID={workflow.currentRow!.studyInstanceUID!}
                              disabled={contentLocked}
                              onInsertAll={(lines) => {
                                for (const line of lines) appendFindings(line);
                              }}
                              onOpenMeasureTab={() => openLegacyTab("measurements")}
                            />
                          )}
                          {isUltrasound && (
                            <ObDashboardStrip
                              studyId={studyId ?? (workflow.currentRow as { studyId?: number } | null)?.studyId}
                              onApplyToReport={(text) => appendFindings(text)}
                            />
                          )}
                          {companionEligible && workflow.currentRow?.studyInstanceUID && (
                            <ModuleErrorBoundary resetKey={String(workflow.currentRow!.studyInstanceUID)}>
                              <UsgCompanionPanel
                                studyInstanceUID={workflow.currentRow!.studyInstanceUID ?? ""}
                                studyId={studyId ?? undefined}
                                patientId={workflow.currentRow!.patientId ?? undefined}
                                disabled={contentLocked}
                                templateSelected={studySetup.selectedTemplateId != null}
                                protocolSelected={!!studySetup.activeProtocol}
                                historyPresent={clinicalHistoryText.trim().length > 0}
                                quickFindingsSelected={selectedQuickIds.size > 0}
                                copilotClear={true}
                                userEdited={isDirty || !!lastSavedAt}
                                reportSaved={!!lastSavedAt}
                                reportFinalized={isFinalized || workflow.currentRow!.status === "REPORT_FINAL"}
                                currentTechnique={techniqueText}
                                currentFindings={findingsText}
                                currentImpression={impressionText.split("\n").filter(Boolean)}
                                currentRecommendation={recommendationText}
                                protocolTechnique={studySetup.activeProtocol?.techniqueText ?? null}
                                protocolNormals={studySetup.activeProtocol?.normalText ?? null}
                                protocolRecommendation={studySetup.activeProtocol?.recommendationText ?? null}
                                selectedFindingIds={[...selectedQuickIds]}
                                region={studySetup.matchedStudyRegion}
                                checklistRemaining={studySetup.activeProtocol ? studySetup.checklistRemaining : []}
                                autoPopulatedBlocks={studySetup.companionLedger}
                                onAutoPopulate={studySetup.handleCompanionAutoPopulate}
                                onApplyProtocol={
                                  studySetup.availableProtocols.some((p) => p.isDefault)
                                    ? () => {
                                        const d = studySetup.availableProtocols.find((p) => p.isDefault);
                                        if (d) studySetup.requestProtocolChange(d);
                                      }
                                    : undefined
                                }
                                onSuggestHistory={
                                  clinicalHistoryChips.some((c) => c.studyType === studySetup.matchedStudyRegion)
                                    ? () => {
                                        if (contentLocked) return;
                                        const state = useWorkspace.getState();
                                        const region = studySetup.matchedStudyRegion;
                                        state.setField(
                                          "clinicalHistory",
                                          clinicalHistoryChips
                                            .filter((c) => c.studyType === region)
                                            .reduce(
                                              (acc, chip) => (hasPhrase(acc, chip.insertedText) ? acc : appendClinicalPhrase(acc, chip.insertedText)),
                                              state.clinicalHistoryText,
                                            ),
                                        );
                                      }
                                    : undefined
                                }
                                onOpenTab={(tab) => {
                                  if (tab === "measurements" || tab === "measure") openLegacyTab("measurements");
                                  else if (tab === "templates" || tab === "library") openLegacyTab("templates");
                                  else if (tab === "copilot") openLegacyTab("copilot");
                                  else if (tab === "prior") rightPanelRef.current?.expand();
                                  else openLegacyTab("links");
                                }}
                              />
                            </ModuleErrorBoundary>
                          )}
                        </div>
                      </FindingsToolDrawer>
                    </div>
                    )}
                    </ReportAccordionSection>

                    {/* 7. IMPRESSION — Quick Select + editor + Generate + dictation */}
                    <ReportAccordionSection
                      {...accordionProps("impression")}
                      emphasis="primary"
                      continuous={
                        // Same cockpit, mirrored for Impression (see Findings).
                        continuousPrimarySections
                          && (activeReportSection == null
                            || activeReportSection === "findings"
                            || activeReportSection === "impression")
                      }
                      onActivate={() => focusClinicalEditor("impression")}
                      onBodyActivate={() => focusClinicalEditor("impression")}
                    >
                      <ImpressionWarningStrip
                        showStale={impressionNeedsRefresh && impressionManuallyEdited}
                        warnings={impressionContradictionWarnings}
                        disabled={contentLocked}
                        onRefresh={() => useWorkspace.getState().refreshImpressionFromLedger()}
                        // Phase 3, item D — the stale banner previews the derived
                        // Conclusion and asks: Accept update, or Keep my edit.
                        // Both doors are the store's own: the read-only
                        // previewImpressionFromLedger, and markImpressionReviewed,
                        // which records the keep against the clinical content so
                        // the banner re-arms only when Findings change again.
                        onPreview={() => useWorkspace.getState().previewImpressionFromLedger()}
                        onKeepEdit={() => useWorkspace.getState().markImpressionReviewed()}
                      />
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Impression</span>
                          {!contentLocked && (
                            <div className="flex items-center gap-2">
                              {impressionNeedsRefresh && (
                                <div className="flex items-center gap-1.5" data-testid="impression-needs-refresh">
                                  <span
                                    className="text-[10px] font-medium text-amber-800"
                                    title="Findings changed; linked impression contribution may be stale"
                                  >
                                    ⚠ Impression needs refresh
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-6 border-amber-300 bg-amber-50 text-[10px] text-amber-900 hover:bg-amber-100"
                                    onClick={handleRefreshImpressionFromFindings}
                                    data-testid="refresh-impression-from-finding"
                                  >
                                    Refresh from Finding
                                  </Button>
                                </div>
                              )}
                              {!impressionNeedsRefresh && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[10px]"
                                  onClick={handleGenerateLocalImpression}
                                  data-testid="generate-local-impression"
                                  title="Generate impression from remaining abnormal findings"
                                >
                                  <ListChecks size={11} className="mr-1" /> Generate Impression
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        {!contentLocked && (
                          <QuickSelectStrip
                            field="impression"
                            bodyPart={studySetup.matchedStudyRegion}
                            compact
                            disabled={contentLocked}
                            onToggle={handleQuickToggle}
                            onStructuredPick={(b) => studySetup.handleFindingClick(b, selectedQuickIds, handleQuickToggle)}
                            onAfterPick={() => { void saveDraft({ silent: true }); }}
                          />
                        )}
                        {/* Few-clicks — each observation's own impression sentence,
                            one click to insert / one to remove. Sourced from the
                            observation ledger (collectPathologyImpressionShortcuts),
                            so a chip never invents clinical text; toggling OFF is a
                            block removal, the same primitive the recommendation
                            row uses, so the derived-impression refresh and the
                            protected-provenance rules keep applying to what is left. */}
                        {impressionShortcutChips.length > 0 && !contentLocked && (
                          <div className="flex flex-wrap gap-1" data-testid="impression-chips">
                            {impressionShortcutChips.map((chip, i) => {
                              const active = impressionText.includes(chip.trim());
                              return (
                                <button
                                  key={`${i}-${chip.slice(0, 24)}`}
                                  type="button"
                                  onClick={() => {
                                    const state = useWorkspace.getState();
                                    const cur = state.impressionText;
                                    const trimmed = chip.trim();
                                    if (!trimmed) return;
                                    if (cur.includes(trimmed)) {
                                      state.setField("impression", removeBlock(cur, trimmed));
                                    } else {
                                      state.mergeField("impression", trimmed, "quick-findings");
                                    }
                                  }}
                                  title={chip}
                                  aria-pressed={active}
                                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shadow-sm transition-all max-w-[14rem] truncate ${
                                    active
                                      ? "bg-gradient-to-br from-indigo-500 to-sky-600 text-white border-indigo-600 shadow-indigo-300/40"
                                      : "bg-gradient-to-b from-indigo-50 to-sky-50/70 text-indigo-900 border-indigo-200 hover:border-indigo-400 hover:shadow-md hover:-translate-y-px"
                                  }`}
                                >
                                  {chip.length > 42 ? `${chip.slice(0, 40)}…` : chip}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <FindingsEditor field="impression" label="" minHeight="40vh" fillHeight placeholder="Impression. Ctrl+I for AI impression." showGhost
                        enableDictationBreaks
                        onClinicalFocus={(f) => { if (f === "findings" || f === "impression") focusClinicalEditor(f); }}
                      />
                      </div>
                      {!contentLocked && (
                        <FieldCareMic voice={voiceSession} target="impression" />
                      )}
                    </div>
                    {formatHasStructuredFields(studySetup.selectedTemplate?.sectionsJson) && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Structured impression candidates live in{" "}
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => {
                            openReportingTools("structured");
                          }}
                        >
                          Reporting Tools → Structured
                        </button>
                        {" "}(Accept / Edit / Ignore).
                      </p>
                    )}
                    </ReportAccordionSection>

                    {/* 8. RECOMMENDATION — Quick Select chips + editor + dictation,
                         with the Critical Finding control at final review. */}
                    <ReportAccordionSection {...accordionProps("recommendation")}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1.5">
                        {!contentLocked && (
                          <QuickSelectStrip
                            field="recommendation"
                            bodyPart={studySetup.matchedStudyRegion}
                            compact
                            disabled={contentLocked}
                            onToggle={handleQuickToggle}
                            onStructuredPick={(b) => studySetup.handleFindingClick(b, selectedQuickIds, handleQuickToggle)}
                            onAfterPick={() => { void saveDraft({ silent: true }); }}
                          />
                        )}
                        {recommendationChips.length > 0 && !contentLocked && (
                          <div className="flex flex-wrap gap-1" data-testid="recommendation-chips">
                            {recommendationChips.map((chip, i) => {
                              const active = recommendationChipActive(recommendationText, chip);
                              return (
                                <button
                                  key={`${i}-${chip.slice(0, 24)}`}
                                  type="button"
                                  onClick={() => {
                                    const state = useWorkspace.getState();
                                    const cur = state.recommendationText;
                                    const trimmed = chip.trim();
                                    if (!trimmed) return;
                                    const aliases = RECOMMENDATION_CHIP_ALIASES[trimmed] ?? [];
                                    const present = cur.includes(trimmed) || aliases.some((a) => cur.includes(a));
                                    if (present) {
                                      state.setField("recommendation", removeRecommendationChip(cur, chip));
                                    } else {
                                      state.mergeField("recommendation", trimmed, "quick-findings");
                                    }
                                  }}
                                  title={chip}
                                  aria-pressed={active}
                                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shadow-sm transition-all max-w-[14rem] truncate ${
                                    active
                                      ? "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white border-violet-600 shadow-violet-300/40"
                                      : "bg-gradient-to-b from-violet-50 to-fuchsia-50/70 text-violet-900 border-violet-200 hover:border-violet-400 hover:shadow-md hover:-translate-y-px"
                                  }`}
                                >
                                  {chip.length > 42 ? `${chip.slice(0, 40)}…` : chip}
                                </button>
                              );
                            })}
                            {recommendationText.trim() && (
                              <button
                                type="button"
                                className="text-[10px] text-muted-foreground underline px-1"
                                onClick={() => useWorkspace.getState().setField("recommendation", "")}
                                title="Clear the Recommendation field"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        )}
                        <FindingsEditor field="recommendation" label="Recommendation" minHeight="60px" placeholder="Follow-up, referral..." showGhost />
                      </div>
                      {!contentLocked && (
                        <FieldCareMic voice={voiceSession} target="recommendation" />
                      )}
                    </div>

                    {/* Critical finding mark + communication checklist (legacy).
                        Part of the optional critical-result COMMUNICATION
                        workflow (ff_radiology_critical_result_comms, default
                        OFF). This panel is the ONLY place isCritical,
                        criticalNote and checklistComm can be set, so hiding it
                        is precisely what would make the pre-sign
                        acknowledgement block unsatisfiable — which is why
                        useStudyFinalize withholds the detector's hits from that
                        block whenever this panel is hidden. The DETECTOR itself
                        is unaffected either way. */}
                    {criticalCommsEnabled() && (
                    <div className="flex flex-col gap-2 border rounded-md p-3 bg-red-50/40 border-red-100" data-testid="critical-finding-panel">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="critical"
                          checked={isCritical}
                          onCheckedChange={setIsCritical}
                          disabled={contentLocked}
                        />
                        <Label htmlFor="critical" className="text-sm font-semibold text-red-700 flex items-center gap-1 cursor-pointer">
                          <AlertTriangle size={13} /> Mark Critical Finding
                        </Label>
                      </div>
                      {isCritical && (
                        <>
                          <Textarea
                            value={criticalNote}
                            onChange={(e) => setCriticalNote(e.target.value)}
                            placeholder="Describe critical finding (e.g. acute infarct, cord compression)..."
                            className="min-h-[50px] text-sm resize-none"
                            disabled={contentLocked}
                          />
                          <div className="flex flex-col gap-1.5 pt-1 border-t border-red-100">
                            <span className="text-[10px] font-semibold text-red-700 uppercase tracking-wide">Communication Checklist</span>
                            {([
                              ["phoned", "Telephoned Doctor"],
                              ["annotated", "Annotated in PACS"],
                              ["dispatched", "Dispatched Alert"],
                            ] as const).map(([key, label]) => (
                              <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                                <Checkbox
                                  checked={checklistComm[key]}
                                  onCheckedChange={(v) => setChecklistComm((prev) => ({ ...prev, [key]: !!v }))}
                                  disabled={contentLocked}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    )}
                    </ReportAccordionSection>

                    {/* 9. REPORT / LAYOUT / EXPORT — Classic/Premium, preview,
                         Enlarge, Word, PDF, print controls (unchanged renderer). */}
                    <ReportAccordionSection {...accordionProps("report")}>
                      {isMriLumbarReportingContext({
                        modality: workflow.currentRow?.modality,
                        region: studySetup.matchedStudyRegion,
                        family: studySetup.studyContext?.family,
                        spineSegment: studySetup.studyContext?.spineSegment,
                      }) && (
                        <CoverageCockpit
                          marks={coverageMarks.length > 0 ? coverageMarks : defaultCoverageMarks()}
                          disabled={contentLocked}
                          onJump={(key) => {
                            useWorkspace.getState().touchCoverageViewed(key);
                            document.getElementById(`r2-region-${key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                          }}
                          onMarkReviewed={(key) => useWorkspace.getState().setCoverageMark(key, "reviewed")}
                          onWaive={(key, reason) => useWorkspace.getState().setCoverageMark(key, "waived", reason)}
                        />
                      )}
                    {studyId ? <div className="mb-2"><ElectronicFilmPanel studyId={studyId} /></div> : null}
                    <ReportExportPanel
                      draftId={draftId ?? null}
                      linkedReportId={linkedReportId}
                      previewHtml={previewHtml}
                      reportLayout={reportLayout}
                      clinicActiveLayout={presentationTemplates?.active?.standard}
                      onLayoutChange={setPreviewLayoutOverride}
                      headingCase={headingCase}
                      onHeadingCaseChange={setHeadingCase}
                      sectionSpacing={sectionSpacing}
                      onSectionSpacingChange={setSectionSpacing}
                      impressionStyle={impressionStyle}
                      onImpressionStyleChange={setImpressionStyle}
                      onExportWord={handleExportWord}
                      onExportPdf={handleExportPdf}
                      onPrintLikeFinal={handlePrintLikeFinal}
                      onEditSection={focusReportField}
                      exportingWord={exportingWord}
                      exportingPdf={exportingPdf}
                      printingLikeFinal={printingLikeFinal}
                      disabled={false}
                      imageRefs={imageRefs}
                      frozenKeyImages={frozenKeyImages}
                      dicomWebBase={BROWSER_DICOMWEB_BASE}
                      showLetterpadHeader={showLetterpadHeader}
                      onShowLetterpadHeaderChange={setShowLetterpadHeader}
                      printFormat={printFormat}
                      printFormatLocked={printFormatLocked}
                      onPrintFormatStep={stepPrintFormat}
                      livePrintBodyHtml={livePrintBodyHtml}
                      findingsText={findingsText}
                      impressionText={impressionText}
                      findingsProvenance={findingsProvenance}
                      impressionProvenance={impressionProvenance}
                      demography={{
                        patientName: canonicalDemography.patientName,
                        age: canonicalDemography.age,
                        sex: canonicalDemography.sex,
                        referringDoctor: canonicalDemography.referringDoctor,
                        studyDate: canonicalDemography.studyDate,
                        // The letterpad patch rebuilds the whole demography
                        // table — without the identifiers it drops the
                        // UHID/ACCESSION row the server HTML (and the durable
                        // PDF) prints, and the on-screen preview stops
                        // matching what Print produces.
                        uhid: canonicalDemography.uhid,
                        patientId: canonicalDemography.patientId,
                        accessionNumber: canonicalDemography.accessionNumber,
                      }}
                      onEnsureDraftSaved={() => saveDraft({ silent: true })}
                    />
                    </ReportAccordionSection>
                  </div>
                  <ReportingStickyActionBar
                    autoSaveStatus={autoSaveStatus}
                    lastSavedAt={lastSavedAt}
                    isDirty={isDirty}
                    isOnline={isOnline}
                    hasOfflineCopy={Boolean(draftBackup.peek() || draftBackup.restoreAvailable)}
                    canUndoLastAbnormal={undoLastAbnormalEnabled}
                    onUndoLastAbnormal={handleUndoLastAbnormal}
                    canUndoStep={undoStepEnabled}
                    canRedoStep={redoStepEnabled}
                    onUndoStep={handleUndoStep}
                    onRedoStep={handleRedoStep}
                    onSave={() => { void saveDraft(); }}
                    onFinalize={finalizeReport}
                    onNextStudy={goNextStudy}
                    finalizeDisabled={!studyId || isLocked || (!allowEditSigned && (isFinalized || workflow.currentRow?.status === "REPORT_FINAL"))}
                    finalizeLabel={finalizeActionLabel({
                      allowEditSigned,
                      isFinalized,
                      studyFinal: signedReport.studyFinal,
                      signatureState: signedReport.state,
                    })}
                    saveDisabled={!isOnline || isLocked || (isFinalized && !allowEditSigned)}
                  />
                </div>
                </div>
              </ResizablePanel>

    </>
  );
}
