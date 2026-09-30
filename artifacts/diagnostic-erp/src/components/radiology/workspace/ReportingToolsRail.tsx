/**
 * ReportingToolsRail — Phase 4 JSX extraction (behavior unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck — Phase 4 vm bag; domain types live in clinical UI hook.
import type { RadiologyWorkspaceVm } from "./types";
import {
  ResizableHandle, ResizablePanel,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import PrintImagePicker from "@/components/radiology/PrintImagePicker";
import ReportImagePicker from "@/components/radiology/ReportImagePicker";
import ReportImagePanel from "@/components/radiology/ReportImagePanel";
import ComparisonPanel from "@/components/radiology/ComparisonPanel";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
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
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";
import {
  isMriCervicalReportingContext,
  isMriDorsalReportingContext,
} from "@/lib/mriSpineCanvasRegions";
import { isBrainMeasuresReportingContext, isMriBrainReportingContext } from "@/lib/reportingStudyContext";
import { buildLumbarLevelApplyBundle, deriveCanvasNarrativeState, ledgerSeverityContradiction, structuredCanalApContradiction } from "@/lib/mriLumbarLevelState";
import { buildCervicalLevelApplyBundle } from "@/lib/mriCervicalLevelState";
import { buildDorsalLevelApplyBundle } from "@/lib/mriDorsalLevelState";
import { MriLumbarSubMasterPanel } from "@/components/radiology/reporting-canvas/MriLumbarSubMasterPanel";
import { SpineScreeningPanel } from "@/components/radiology/reporting-canvas/SpineScreeningPanel";
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
import LegacyBox, { type LegacyBoxTab } from "@/components/radiology/LegacyBox";
import { ReportComposerAssistant } from "@/components/radiology/ReportComposerAssistant";
import {
  ReportingToolsPanel,
  type QuickInsertSource,
  type ReportingToolsTab,
} from "@/components/radiology/ReportingToolsPanel";
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
import FindingsAnatomyChips from "@/components/radiology/FindingsAnatomyChips";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { useWorkspace, formatSignOff, lookupProfile, EMPTY_FIELD_PROVENANCE, type WorkspaceStore } from "@/lib/zai-workspace/store";
import { CopilotRail } from "@/components/radiology/zai-workspace/copilot-rail";
import { PersonalTemplateRail } from "@/components/radiology/zai-workspace/personal-template-rail";
import { ReportFormatPicker } from "@/components/radiology/zai-workspace/report-format-picker";
import { QuickSelectStrip } from "@/components/radiology/zai-workspace/quick-select-strip";
import { ChocolateBoxMacros } from "@/components/radiology/zai-workspace/chocolate-box-macros";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import {
  Lock, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2, Link2,
} from "lucide-react";


export function ReportingToolsRail({ vm }: { vm: RadiologyWorkspaceVm }) {
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
    bodyFontSize,
    bootstrapAppliedThisOpen,
    canShowVerify,
    canUndoStartReport,
    canVerifyRef,
    canalApByLevel,
    canonicalDemography,
    captureBusy,
    captureSavedDraftId,
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
    setBodyFontSize,
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
              <ResizableHandle />
              {/* ONE progressive-disclosure Reporting Tools surface. */}
              <ResizablePanel
                defaultSize={3}
                minSize={22}
                maxSize={48}
                collapsible
                collapsedSize={3}
                ref={rightPanelRef}
                onCollapse={() => setRightCollapsed(true)}
                onExpand={() => setRightCollapsed(false)}
              >
                <div className="h-full min-h-0">
                  {rightCollapsed ? (
                    <button
                      type="button"
                      className="flex h-full w-full flex-col items-center gap-2 py-3 text-emerald-600 hover:bg-emerald-50 transition-colors"
                      onClick={() => openReportingTools(reportingToolsTab)}
                      title="Open Reporting Tools"
                      data-testid="right-panel-expand"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                      <span className="text-[9px] font-semibold tracking-wider uppercase text-emerald-700" style={{ writingMode: "vertical-rl" }}>
                        Tools
                      </span>
                    </button>
                  ) : (
                    <ReportingToolsPanel
                      activeTab={reportingToolsTab}
                      onTabChange={setReportingToolsTab}
                      quickSource={quickInsertSource}
                      onQuickSourceChange={setQuickInsertSource}
                      onClose={() => rightPanelRef.current?.collapse()}
                      disabled={isLocked || isFinalized}
                      panes={{
                        "quick-insert": (
                          <div className="space-y-2" data-testid="quick-insert">
                            {quickInsertSource === "quick-select" ? (
                              <>
                                <FindingsAnatomyChips
                                  findings={catalogQuickFindings}
                                  selectedStudyTabId={studySetup.selectedStudyTabId}
                                  selectedStudyTabName={studySetup.matchedStudyRegion}
                                  activeAnatomy={activeFindingsAnatomy}
                                  onAnatomyChange={setActiveFindingsAnatomy}
                                  disabled={isLocked || isFinalized}
                                  sticky
                                />
                                <QuickSelectStrip
                                  field="findings"
                                  bodyPart={studySetup.matchedStudyRegion}
                                  anatomyFilter={activeFindingsAnatomy}
                                  onAfterPick={() => feedbackAfterAbnormalApply()}
                                />
                              </>
                            ) : null}
                            {quickInsertSource === "quick-add" ? (
                              <QuickFindingsPanel
                                selectedIds={selectedQuickIds}
                                blockedIds={blockedQuickFindingIds}
                                onToggle={handleQuickToggle}
                                onFindingClick={(f) => studySetup.handleFindingClick(f, selectedQuickIds, handleQuickToggle)}
                                onEditBeforeInsert={handleEditBeforeInsert}
                                side={quickSide}
                                onSideChange={setQuickSide}
                                disabled={isLocked || isFinalized}
                                initialStudyHint={studySetup.studyHint || null}
                                selectedRegions={studySetup.studyRegions}
                                onRegionToggle={studySetup.handleRegionToggle}
                                compactRegions
                                isAdmin={isOwner}
                                activeProtocolId={studySetup.activeProtocol?.id ?? null}
                                onProtocolChange={studySetup.requestProtocolChange}
                                onChecklistChange={studySetup.handleChecklistChange}
                                onMeasurement={(template, value) => appendFindings(template.replace(/\{value\}/gi, value).replace(/\{val\}/gi, value))}
                                onInsertNormals={appendFindings}
                                onAcceptLearnedSuggestion={(text) => useWorkspace.getState().mergeField("recommendation", text, "quick-findings")}
                                onFindingsLoaded={(findings) => {
                                  quickFindingTemplatesRef.current = findings;
                                  setComposerQuickFindings(findings);
                                }}
                                externalSearch={qsExternalSearch}
                                selectedStudyTabId={studySetup.selectedStudyTabId}
                                selectedStudyTabName={studySetup.matchedStudyRegion}
                              />
                            ) : null}
                            {quickInsertSource === "macros" ? (
                              <ChocolateBoxMacros
                                setKey={studySetup.chocolateBoxSet.key}
                                label={studySetup.chocolateBoxSet.label}
                                disabled={isLocked || isFinalized}
                                onInsert={studySetup.applyChocolateTile}
                                onRemoveBundle={(bundleId) => useWorkspace.getState().removeMacroBundle(bundleId)}
                              />
                            ) : null}
                            {quickInsertSource === "snippets" ? (
                              <PersonalTemplateRail
                                collapsed={false}
                                onToggleCollapsed={() => rightPanelRef.current?.collapse()}
                                templates={personalTemplates}
                                onTemplatesChange={setPersonalTemplates}
                                activeTarget={lastClinicalTarget}
                                getFieldText={(target) => target === "findings"
                                  ? useWorkspace.getState().findingsText
                                  : useWorkspace.getState().impressionText}
                                setFieldText={(target, text) => {
                                  useWorkspace.getState().setField(target, text);
                                  focusClinicalEditor(target);
                                }}
                                studyContext={studySetup.studyContext}
                                disabled={isLocked || isFinalized}
                              />
                            ) : null}
                            {quickInsertSource === "composer" ? (
                              <FindingComposer
                                region={composerRegion}
                                quickFindings={composerQuickFindings.length ? composerQuickFindings : quickFindingTemplatesRef.current}
                                draft={composerDraft}
                                onDraftChange={(d) => {
                                  setComposerDraft(d);
                                  if (!d.editingId) setComposerBanner(null);
                                }}
                                disabled={isLocked || isFinalized}
                                banner={composerBanner}
                                onApplied={(status) => {
                                  if (status === "applied") {
                                    setComposerBanner(null);
                                    feedbackAfterAbnormalApply();
                                  }
                                  if (status === "pending") {
                                    toast({ title: "Confirm replacement", description: "Same-slot finding needs confirmation." });
                                  }
                                }}
                              />
                            ) : null}
                          </div>
                        ),
                        structured: (
                          <div className="space-y-3">
                            <StructuredFormatPanel
                              sectionsJson={studySetup.selectedTemplate?.sectionsJson}
                              values={structuredValues}
                              disabled={isLocked || isFinalized}
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
                            {isBrainMeasuresReportingContext({
                              modality: workflow.currentRow?.modality,
                              region: studySetup.matchedStudyRegion,
                              family: studySetup.studyContext?.family,
                              studyDescription: workflow.currentRow?.studyDescription ?? null,
                            }) ? (
                              <>
                                {isMriBrainReportingContext({
                                  modality: workflow.currentRow?.modality,
                                  region: studySetup.matchedStudyRegion,
                                  family: studySetup.studyContext?.family,
                                  studyDescription: workflow.currentRow?.studyDescription ?? null,
                                }) ? (
                                  <MriBrainCanvas
                                    disabled={isLocked || isFinalized}
                                    region={studySetup.matchedStudyRegion ?? "Brain"}
                                  />
                                ) : null}
                                <BrainMeasuresStrip
                                  disabled={isLocked || isFinalized}
                                  region={studySetup.matchedStudyRegion ?? "Brain"}
                                />
                              </>
                            ) : null}
                            {isMriLumbarReportingContext({
                              modality: workflow.currentRow?.modality,
                              region: studySetup.matchedStudyRegion,
                              family: studySetup.studyContext?.family,
                              spineSegment: studySetup.studyContext?.spineSegment,
                              protocolName: studySetup.activeProtocol?.name ?? null,
                              studyDescription: workflow.currentRow?.studyDescription ?? null,
                            }) ? (
                              <>
                                <MriLumbarCanvas
                                  patches={appliedPathologyPatches}
                                  findingsText={findingsText}
                                  disabled={isLocked || isFinalized}
                                  canalApByLevel={canalApByLevel}
                                  onFocusRegion={(key) => useWorkspace.getState().touchCoverageViewed(key)}
                                  onApplyLevel={(level, regionKey, sel) => {
                                    const { bundleId, observations } = buildLumbarLevelApplyBundle({
                                      level,
                                      sel,
                                      region: studySetup.matchedStudyRegion ?? "LS Spine",
                                    });
                                    if (observations.length > 0) {
                                      useWorkspace.getState().applyMacroBundle({ bundleId, observations });
                                      useWorkspace.getState().setCoverageMark(regionKey, "partial");
                                    }
                                  }}
                                  onInsertRegionPhrase={(regionKey, phrase, concept) => {
                                    useWorkspace.getState().applyPathologyOverlay({
                                      id: `r2-region-${regionKey}-${concept}`,
                                      incoming: { findings: phrase },
                                      templates: { findings: phrase },
                                      ownership: { anatomicalSection: regionKey, conflictGroup: concept, concept },
                                      source: "structured-template",
                                      region: studySetup.matchedStudyRegion ?? "LS Spine",
                                      concept,
                                      label: `${regionKey} ${concept}`,
                                      findingsText: phrase,
                                    });
                                  }}
                                />
                                <MriLumbarSubMasterPanel
                                  disabled={isLocked || isFinalized}
                                  ledgerRegion={studySetup.matchedStudyRegion ?? "LS Spine"}
                                />
                                <SpineApCanalMeasurements segment="lumbar" disabled={isLocked || isFinalized} />
                              </>
                            ) : null}
                            {isMriCervicalReportingContext({
                              modality: workflow.currentRow?.modality,
                              region: studySetup.matchedStudyRegion,
                              family: studySetup.studyContext?.family,
                              spineSegment: studySetup.studyContext?.spineSegment,
                              protocolName: studySetup.activeProtocol?.name ?? null,
                              studyDescription: workflow.currentRow?.studyDescription ?? null,
                            }) ? (
                              <>
                                <MriCervicalCanvas
                                  patches={appliedPathologyPatches}
                                  findingsText={findingsText}
                                  disabled={isLocked || isFinalized}
                                  canalApByLevel={canalApByLevel}
                                  onFocusRegion={(key) => useWorkspace.getState().touchCoverageViewed(key)}
                                  onApplyLevel={(level, regionKey, sel) => {
                                    const { bundleId, observations } = buildCervicalLevelApplyBundle({
                                      level,
                                      sel,
                                      region: studySetup.matchedStudyRegion ?? "Cervical Spine",
                                    });
                                    if (observations.length > 0) {
                                      useWorkspace.getState().applyMacroBundle({ bundleId, observations });
                                      useWorkspace.getState().setCoverageMark(regionKey, "partial");
                                    }
                                  }}
                                  onInsertRegionPhrase={(regionKey, phrase, concept) => {
                                    useWorkspace.getState().applyPathologyOverlay({
                                      id: `r2-cerv-region-${regionKey}-${concept}`,
                                      incoming: { findings: phrase },
                                      templates: { findings: phrase },
                                      ownership: { anatomicalSection: regionKey, conflictGroup: concept, concept },
                                      source: "structured-template",
                                      region: studySetup.matchedStudyRegion ?? "Cervical Spine",
                                      concept,
                                      label: `${regionKey} ${concept}`,
                                      findingsText: phrase,
                                    });
                                  }}
                                />
                                <SpineApCanalMeasurements segment="cervical" disabled={isLocked || isFinalized} />
                              </>
                            ) : null}
                            {isMriDorsalReportingContext({
                              modality: workflow.currentRow?.modality,
                              region: studySetup.matchedStudyRegion,
                              family: studySetup.studyContext?.family,
                              spineSegment: studySetup.studyContext?.spineSegment,
                              protocolName: studySetup.activeProtocol?.name ?? null,
                              studyDescription: workflow.currentRow?.studyDescription ?? null,
                            }) ? (
                              <MriDorsalCanvas
                                patches={appliedPathologyPatches}
                                findingsText={findingsText}
                                disabled={isLocked || isFinalized}
                                onFocusRegion={(key) => useWorkspace.getState().touchCoverageViewed(key)}
                                onApplyLevel={(level, regionKey, sel) => {
                                  const { bundleId, observations } = buildDorsalLevelApplyBundle({
                                    level,
                                    sel,
                                    region: studySetup.matchedStudyRegion ?? "Dorsal Spine",
                                  });
                                  if (observations.length > 0) {
                                    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
                                    useWorkspace.getState().setCoverageMark(regionKey, "partial");
                                  }
                                }}
                                onInsertRegionPhrase={(regionKey, phrase, concept) => {
                                  useWorkspace.getState().applyPathologyOverlay({
                                    id: `r2-dors-region-${regionKey}-${concept}`,
                                    incoming: { findings: phrase },
                                    templates: { findings: phrase },
                                    ownership: { anatomicalSection: regionKey, conflictGroup: concept, concept },
                                    source: "structured-template",
                                    region: studySetup.matchedStudyRegion ?? "Dorsal Spine",
                                    concept,
                                    label: `${regionKey} ${concept}`,
                                    findingsText: phrase,
                                  });
                                }}
                              />
                            ) : null}
                            {studySetup.studyContext?.family === "spine" ? (
                              <SpineScreeningPanel
                                disabled={isLocked || isFinalized}
                                ledgerRegion={studySetup.matchedStudyRegion ?? "LS Spine"}
                                billed={{
                                  name: studySetup.testName ?? null,
                                  studyDescription: workflow.currentRow?.studyDescription ?? null,
                                  protocolName: studySetup.activeProtocol?.name ?? null,
                                  reportTitle: studySetup.selectedTemplate?.name ?? null,
                                }}
                              />
                            ) : null}
                            <ObservationLedgerPanel
                              patches={appliedPathologyPatches}
                              findingsText={findingsText}
                              selectedId={selectedObservationId}
                              keyImageCounts={keyImageCounts}
                              measurementChips={measurementChips}
                              impressionDisabled={isLocked || isFinalized}
                              onSelect={(id) => useWorkspace.getState().setSelectedObservationId(id)}
                              onEdit={openComposerForObservation}
                              onOpenKeyImages={(id) => {
                                setKeyImageFilterObsId(id);
                                useWorkspace.getState().setSelectedObservationId(id);
                              }}
                              onJumpToMeasurement={() => openReportingTools("measurements")}
                              onToggleImpression={(id, include) => {
                                useWorkspace.getState().setObservationImpressionParticipation(id, include);
                              }}
                            />
                          </div>
                        ),
                        measurements: (
                          <div className="space-y-3">
                            {workflow.currentRow?.studyInstanceUID ? (
                              <ViewerMeasurementsBanner
                                studyInstanceUID={workflow.currentRow.studyInstanceUID}
                                disabled={isLocked || isFinalized}
                                onInsertAll={(lines) => lines.forEach(appendFindings)}
                                onOpenMeasureTab={() => setReportingToolsTab("measurements")}
                              />
                            ) : null}
                            {isMriLumbarReportingContext({
                              modality: workflow.currentRow?.modality,
                              region: studySetup.matchedStudyRegion,
                              family: studySetup.studyContext?.family,
                              spineSegment: studySetup.studyContext?.spineSegment,
                            }) ? <SpineApCanalMeasurements segment="lumbar" disabled={isLocked || isFinalized} /> : null}
                            {draftId ? (
                              <>
                                <ReportImagePicker
                                  draftId={draftId}
                                  studyId={studyId ?? null}
                                  studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                                  disabled={isLocked || isFinalized}
                                  onEnsureDraft={isLocked ? undefined : () => saveDraft({ silent: true })}
                                  hideSelectedList
                                />
                                <ReportImagePanel
                                  draftId={draftId}
                                  dicomWebBase={BROWSER_DICOMWEB_BASE}
                                  disabled={isLocked || isFinalized}
                                  layout="stack"
                                />
                                <PrintImagePicker
                                  studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                                  disabled={isLocked || isFinalized}
                                />
                              </>
                            ) : <p className="text-xs text-muted-foreground">Save a draft to manage report images.</p>}
                          </div>
                        ),
                        priors: workflow.currentRow ? (
                          <div className="space-y-3">
                            <PriorComparisonToolbar
                              patientId={workflow.currentRow.patientId ?? 0}
                              excludeStudyId={studyId ?? undefined}
                              modality={workflow.currentRow.modality ?? ""}
                              studyDescription={workflow.currentRow.studyDescription ?? ""}
                              comparisonMissing={false}
                              disabled={isLocked || isFinalized}
                              onInsertFindings={appendFindings}
                              onOpenPriorTab={() => setReportingToolsTab("priors")}
                            />
                            <ComparisonPanel
                              patientId={workflow.currentRow.patientId ?? undefined}
                              excludeStudyId={studyId ?? undefined}
                              currentModality={workflow.currentRow.modality ?? ""}
                              currentStudyDescription={workflow.currentRow.studyDescription ?? ""}
                              currentFindings={findingsText}
                              onInsertFindings={appendFindings}
                              onInsertImpression={(text) => useWorkspace.getState().mergeField("impression", text, "template")}
                              onSelectPrior={(prior) => {
                                if (prior?.dateIso) appendFindings(`Compared with prior study dated ${String(prior.dateIso).slice(0, 10)}.`);
                              }}
                            />
                            <ModuleErrorBoundary>
                              <FollowUpPanel
                                patientId={workflow.currentRow.patientId ?? null}
                                currentFindings={findingsText}
                                onCopyFindings={(text) => useWorkspace.getState().setField("findings", text)}
                                onCopyImpression={(lines) => useWorkspace.getState().setField("impression", lines.join("\n"))}
                              />
                            </ModuleErrorBoundary>
                            {isUltrasound ? (
                              <ObDashboardStrip
                                studyId={studyId ?? workflow.currentRow.studyId}
                                onApplyToReport={appendFindings}
                              />
                            ) : null}
                            {companionEligible && workflow.currentRow.studyInstanceUID ? (
                              <ModuleErrorBoundary resetKey={String(workflow.currentRow.studyInstanceUID)}>
                                <UsgCompanionPanel
                                  studyInstanceUID={workflow.currentRow.studyInstanceUID}
                                  studyId={studyId ?? undefined}
                                  patientId={workflow.currentRow.patientId ?? undefined}
                                  disabled={isLocked || isFinalized}
                                  templateSelected={studySetup.selectedTemplateId != null}
                                  protocolSelected={!!studySetup.activeProtocol}
                                  historyPresent={clinicalHistoryText.trim().length > 0}
                                  quickFindingsSelected={selectedQuickIds.size > 0}
                                  copilotClear
                                  userEdited={isDirty || !!lastSavedAt}
                                  reportSaved={!!lastSavedAt}
                                  reportFinalized={isFinalized || workflow.currentRow.status === "REPORT_FINAL"}
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
                                  onOpenTab={(tab) => {
                                    if (tab === "measurements" || tab === "measure") openReportingTools("measurements");
                                    else if (tab === "templates" || tab === "library") openReportingTools("templates");
                                    else if (tab === "copilot") openReportingTools("ai");
                                    else if (tab === "prior") openReportingTools("priors");
                                    else openReportingTools("more");
                                  }}
                                />
                              </ModuleErrorBoundary>
                            ) : null}
                          </div>
                        ) : null,
                        templates: (
                          <div className="space-y-2 text-xs">
                            <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
                              Full Report is selected and applied from the Starting Canvas above the clinical editors.
                            </p>
                            <details className="rounded border border-border p-2">
                              <summary className="cursor-pointer font-semibold">Advanced format merge</summary>
                              <div className="mt-2"><ReportFormatPicker /></div>
                            </details>
                          </div>
                        ),
                        ai: (
                          <ModuleErrorBoundary resetKey={`ai-tools-${workflow.currentRow?.studyInstanceUID ?? studyId ?? "none"}`}>
                          <div className="space-y-3">
                          <CopilotRail
                            spinalStudyId={workflow.currentRow?.studyId ?? studyId ?? null}
                            draftId={draftId ?? null}
                            patientId={workflow.currentRow?.patientId ?? null}
                            worklistId={studyId ?? null}
                            studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                            regionHint={studySetup.matchedStudyRegion}
                            measureDisabled={isLocked || isFinalized}
                            aiDraftStudyInstanceUid={workflow.currentRow?.studyInstanceUID ?? null}
                            aiDraftModality={workflow.currentRow?.modality ?? null}
                            onStageAiProposal={stageAiProposal}
                            hideReportFormats
                          />
                          {stagedAiProposals.length > 0 ? (
                            <div className="flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-[11px]">
                              <span className="flex-1">{stagedAiProposals.length} proposal(s) staged</span>
                              <Button size="sm" className="h-6 text-[10px]" onClick={() => void applyStagedAiProposals()}>Apply</Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setStagedAiProposals([])}>Discard</Button>
                            </div>
                          ) : null}
                          <ReportComposerAssistant
                            job={reportComposer.job}
                            busy={reportComposer.busy}
                            reviewOpen={reportComposer.reviewOpen}
                            showAiChanges={reportComposer.showAiChanges}
                            isFinalized={isFinalized}
                            minimized={false}
                            onMinimizedChange={() => undefined}
                            aiMode={composerAiMode}
                            onAiModeChange={setComposerAiMode}
                            primaryRegionLabel={composerPrimaryRegionLabel}
                            selectedKeyImageCount={composerSelectedKeyImages.length}
                            sessionModelOptions={composerSessionModelOptions}
                            sessionModelValue={composerSessionModelKey}
                            onSessionModelChange={setComposerSessionModelKey}
                            onCompose={() => void reportComposer.composeFull()}
                            onImpression={() => void reportComposer.composeImpression()}
                            onToggleReview={reportComposer.setReviewOpen}
                            onToggleShowChanges={reportComposer.setShowAiChanges}
                            onAcceptChange={(id) => void reportComposer.acceptChange(id)}
                            onRejectChange={(id) => void reportComposer.rejectChange(id)}
                            onAcceptAll={() => void reportComposer.acceptAllPending()}
                            onRejectAll={() => void reportComposer.rejectAllPending()}
                            onApply={() => void reportComposer.applyAccepted()}
                            onDiscard={() => void reportComposer.discard()}
                            onRegenerate={() => void reportComposer.regenerate()}
                            microInstruction={microInstruction}
                            onMicroInstructionChange={setMicroInstruction}
                            onMicroSubmit={() => {
                              const instr = microInstruction.trim();
                              if (!instr) return;
                              const selection = window.getSelection()?.toString() ?? "";
                              void reportComposer.microEdit(
                                /translat/i.test(instr) ? "TRANSLATE" : /shorten/i.test(instr) ? "SHORTEN" : /expand/i.test(instr) ? "EXPAND" : "REPHRASE",
                                selection || useWorkspace.getState().findingsText.slice(0, 800),
                                "FINDINGS",
                                instr,
                              );
                              setMicroInstruction("");
                            }}
                          />
                          </div>
                          </ModuleErrorBoundary>
                        ),
                        more: (
                          <div className="space-y-3">
                          <ModuleErrorBoundary>
                            <LegacyBox
                              activeTab={legacyTab}
                              onTabChange={setLegacyTab}
                              worklistId={studyId ?? null}
                              studyId={studyId ?? null}
                              patientId={workflow.currentRow?.patientId ?? null}
                              orderId={(workflow.currentRow as { orderId?: number | null } | null)?.orderId ?? null}
                              draftId={draftId ?? null}
                              studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                              accessionNumber={workflow.currentRow?.accessionNumber ?? null}
                              modality={workflow.currentRow?.modality ?? null}
                              studyDescription={workflow.currentRow?.studyDescription ?? null}
                              bodyPart={(workflow.currentRow as { bodyPart?: string | null } | null)?.bodyPart ?? null}
                              region={studySetup.matchedStudyRegion}
                              findingsText={findingsText}
                              impressionText={impressionText}
                              recommendationText={recommendationText}
                              techniqueText={techniqueText}
                              clinicalHistoryText={clinicalHistoryText}
                              selectedFindingLabels={[]}
                              criticalMarked={isCritical}
                              criticalCommunicated={checklistComm.phoned}
                              isAdmin={isOwner}
                              disabled={isLocked || isFinalized}
                              currentUserId={myUserId}
                              onAppendFindings={appendFindings}
                              onAppendImpression={(text) => useWorkspace.getState().mergeField("impression", text, "template")}
                              onAppendRecommendation={(text) => useWorkspace.getState().mergeField("recommendation", text, "template")}
                              onSetFindings={(text) => useWorkspace.getState().setField("findings", text)}
                              onSetImpression={(text) => useWorkspace.getState().setField("impression", text)}
                              onSetTechnique={(text) => useWorkspace.getState().setField("technique", text)}
                              onApplyReport={(r) => {
                                if (r.findingsText) useWorkspace.getState().mergeField("findings", r.findingsText, "template");
                                r.impressionLines?.forEach((line) => useWorkspace.getState().mergeField("impression", line, "template"));
                                if (r.technique) useWorkspace.getState().mergeField("technique", r.technique, "template");
                              }}
                              excludeTabs={["copilot", "print", "templates", "measurements", "ai"]}
                            />
                          </ModuleErrorBoundary>
                          </div>
                        ),
                      }}
                    />
                  )}
                </div>
              </ResizablePanel>

    </>
  );
}
