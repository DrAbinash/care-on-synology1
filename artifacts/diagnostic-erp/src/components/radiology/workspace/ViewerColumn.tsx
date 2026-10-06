/**
 * ViewerColumn — Phase 4 JSX extraction (behavior unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck — Phase 4 vm bag; domain types live in clinical UI hook.
import type { RadiologyWorkspaceVm } from "./types";
import {
  ResizableHandle, ResizablePanel,
} from "@/components/ui/resizable";
import { api } from "@/lib/fetchApi";
import EmbeddedWadoViewer, { type EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import PrintImagePicker from "@/components/radiology/PrintImagePicker";
import FrozenKeyImagesRail, {
  uploadFrozenKeyImage,
  useFrozenKeyImages,
  frozenKeyImagesQueryKey,
} from "@/components/radiology/FrozenKeyImagesRail";
import { buildObservationKeyImageCaption } from "@/lib/keyImageCaption";
import { viewportToAnchor } from "@/lib/observationAnchor";
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
  Lock, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2, Link2,
} from "lucide-react";


export function ViewerColumn({ vm }: { vm: RadiologyWorkspaceVm }) {
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
    isLoadingExistingDraft,
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
          {showEmbeddedViewer && (
            <>
              <ResizablePanel
                ref={viewerPanelRef}
                id="workspace-viewer"
                order={2}
                defaultSize={layoutMode === "viewerFocus" ? (isMobile ? 88 : 65) : 32}
                minSize={isMobile ? 45 : 22}
                maxSize={isMobile ? 92 : 72}
              >
                <div
                  className="flex h-full flex-col"
                  data-testid="embedded-viewer-column"
                  data-pane-focus="viewer"
                  onPointerDownCapture={(e) => {
                    if (shouldIgnorePaneFocusTarget(e.target)) return;
                    if (exclusiveReportSections || compactAccordion) {
                      enterViewerPaneFocus();
                    }
                  }}
                >
                  <div className={reportImagesOpen ? "hidden h-0 overflow-hidden" : "flex-1 min-h-0"}>
                    <EmbeddedWadoViewer
                      ref={embeddedViewerRef}
                      studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                      worklistId={workflow.currentRow?.id ?? studyId ?? null}
                      accessionNumber={workflow.currentRow?.accessionNumber ?? null}
                      patientName={canonicalDemography.patientName || workflow.currentRow?.patientName || study?.patient?.name || null}
                      columnExpanded={viewerColumnExpanded}
                      onColumnExpandedChange={setViewerColumnExpanded}
                      onViewportContextChange={(ctx) => {
                        useWorkspace.getState().setActiveAnchor(ctx ? viewportToAnchor(ctx) : null);
                      }}
                      captureBusy={captureBusy}
                      ohifAnnotatedCaptureBlocked={ohifUnavailable}
                      onRequestOhifAnnotatedCapture={
                        contentLocked || ohifUnavailable ? undefined : requestOhifAnnotatedCapture
                      }
                      onCaptureViewport={
                        contentLocked
                          ? undefined
                          : async (payload) => {
                              setCaptureBusy(true);
                              try {
                                let id = draftId;
                                if (!id) id = await ensureDraftOnce();
                                if (!id) {
                                  toast({ title: "Could not save draft", description: "Save a draft before capturing key images.", variant: "destructive" });
                                  return;
                                }
                                const selectedId = useWorkspace.getState().selectedObservationId;
                                const selectedPatch = selectedId
                                  ? useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === selectedId)
                                  : null;
                                const caption = selectedPatch
                                  ? buildObservationKeyImageCaption({
                                      level: selectedPatch.observation?.level,
                                      laterality: selectedPatch.observation?.laterality,
                                      concept: selectedPatch.observation?.concept,
                                      region: selectedPatch.observation?.region,
                                      lastRenderedFindings: selectedPatch.lastRendered.findings,
                                    })
                                  : (payload.context.seriesDescription
                                    ? `${payload.context.seriesDescription}${payload.context.frameNumber ? ` · Image ${payload.context.frameNumber}` : ""}`
                                    : "Key image (viewport capture)");

                                const fd = new FormData();
                                fd.append("image", payload.blob, "capture.jpg");
                                fd.append("draftId", String(id));
                                if (workflow.currentRow?.studyId ?? studyId) {
                                  fd.append("studyId", String(workflow.currentRow?.studyId ?? studyId));
                                }
                                if (workflow.currentRow?.patientId) {
                                  fd.append("patientId", String(workflow.currentRow.patientId));
                                }
                                fd.append("sourceType", "VIEWPORT_CAPTURE");
                                fd.append("caption", caption);
                                fd.append("captionManual", "false");
                                fd.append("includeInReport", "true");
                                if (selectedId) fd.append("observationId", selectedId);
                                if (payload.context.studyInstanceUID) fd.append("studyInstanceUID", payload.context.studyInstanceUID);
                                if (payload.context.seriesInstanceUID) fd.append("seriesInstanceUID", payload.context.seriesInstanceUID);
                                if (payload.context.sopInstanceUID) fd.append("sopInstanceUID", payload.context.sopInstanceUID);
                                if (payload.context.frameNumber != null) fd.append("frameNumber", String(payload.context.frameNumber));
                                if (payload.context.instanceNumber != null) fd.append("instanceNumber", String(payload.context.instanceNumber));
                                if (payload.context.seriesDescription) fd.append("seriesDescription", payload.context.seriesDescription);
                                if (payload.context.modality) fd.append("modality", payload.context.modality);
                                fd.append("viewer", payload.context.viewer || "frames");
                                fd.append("viewportSnapshotJson", payload.snapshotJson);
                                fd.append("capturedAt", new Date().toISOString());

                                await uploadFrozenKeyImage(fd);
                                void qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) });
                                toast({
                                  title: "Key image captured",
                                  description: selectedId
                                    ? "Attached to selected observation (Frames has no annotation overlays)."
                                    : "Saved as report-level evidence (Frames has no annotation overlays).",
                                });
                              } catch (e) {
                                toast({ title: "Capture failed", description: String(e), variant: "destructive" });
                              } finally {
                                setCaptureBusy(false);
                              }
                            }
                      }
                      onAddCurrentFrameToReport={
                        contentLocked
                          ? undefined
                          : async (ref) => {
                              let id = draftId;
                              if (!id) id = await ensureDraftOnce();
                              if (!id) {
                                toast({ title: "Could not save draft", description: "Save a draft before adding key images.", variant: "destructive" });
                                return;
                              }
                              try {
                                const { buildImageRefPayload, nextDisplayOrder } = await import("@/lib/reportImageRefs");
                                await api.post(
                                  "/api/radiology/report-generator/image-references",
                                  buildImageRefPayload({
                                    draftId: id,
                                    studyId: workflow.currentRow?.studyId ?? studyId ?? null,
                                    studyInstanceUID: ref.studyInstanceUID,
                                    seriesInstanceUID: ref.seriesInstanceUID,
                                    sopInstanceUID: ref.sopInstanceUID,
                                    frameNumber: ref.frameNumber,
                                    caption: "Key image (viewer)",
                                    displayOrder: nextDisplayOrder(imageRefs),
                                    isKeyImage: true,
                                  }),
                                );
                                void qc.invalidateQueries({ queryKey: ["report-image-references", id] });
                                toast({ title: "Added to report image rail" });
                              } catch (e) {
                                toast({ title: "Could not add image", description: String(e), variant: "destructive" });
                              }
                            }
                      }
                    />
                  </div>
                  {!viewerColumnExpanded && workflow.currentRow && (
                    <div className={reportImagesOpen ? "flex-1 min-h-0 overflow-hidden" : "border-t border-border shrink-0"}>
                      <FrozenKeyImagesRail
                        draftId={draftId ?? null}
                        disabled={contentLocked}
                        filterObservationId={keyImageFilterObsId}
                        observationLabels={observationLabels}
                        onFocusObservation={(id) => {
                          useWorkspace.getState().setSelectedObservationId(id);
                          setKeyImageFilterObsId(id);
                        }}
                        aiSelectedIds={aiSelectedKeyImageIds}
                        onAiSelectedIdsChange={setAiSelectedKeyImageIds}
                        captureBusy={captureBusy}
                        captureBlockedTitle={ohifUnavailable ? "OHIF not reachable for this study" : undefined}
                        onCaptureRequest={
                          contentLocked || ohifUnavailable
                            ? undefined
                            : () => { void requestFrozenKeyImageCapture(); }
                        }
                      />
                      {keyImageFilterObsId ? (
                        <div className="px-2 pb-1">
                          <button
                            type="button"
                            className="text-[10px] text-sky-700 underline"
                            onClick={() => setKeyImageFilterObsId(null)}
                          >
                            Clear key-image filter
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                  {false && !viewerColumnExpanded && workflow.currentRow && (
                    <div className="border-t border-border shrink-0">
                      <PrintImagePicker
                        studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                        disabled={contentLocked}
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}


    </>
  );
}
