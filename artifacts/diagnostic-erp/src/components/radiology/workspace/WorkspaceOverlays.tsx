/**
 * WorkspaceOverlays — Phase 4 JSX extraction (behavior unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck — Phase 4 vm bag; domain types live in clinical UI hook.
import type { RadiologyWorkspaceVm } from "./types";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/fetchApi";
import { getClinicDateIst } from "@/lib/careTime";
import {
  shouldOfferBackupRestore, normalizeImpressionLines,
  canVerifyReport,
} from "@/lib/workspaceReportState";
import FinalizeSignDialog from "@/components/radiology/FinalizeSignDialog";
import { PcpndtFormFFinalizeStep } from "@/components/radiology/PcpndtFormFFinalizeStep";
import { ReportComposerAssistant } from "@/components/radiology/ReportComposerAssistant";
import { WhatsAppReportShareDialog } from "@/components/radiology/WhatsAppReportShareDialog";
import ReportingShortcutHelp from "@/components/radiology/ReportingShortcutHelp";
import StructuredFindingDialog from "@/components/radiology/StructuredFindingDialog";
import StudyLocalFindingEditDialog, {
  type StudyLocalTextOverride,
} from "@/components/radiology/StudyLocalFindingEditDialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useWorkspace, formatSignOff, lookupProfile, EMPTY_FIELD_PROVENANCE, type WorkspaceStore } from "@/lib/zai-workspace/store";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import { CopilotRail } from "@/components/radiology/zai-workspace/copilot-rail";
import { LinkStudyDialog } from "@/components/radiology/LinkStudyDialog";
import {
  canForceReleaseStudyLock,
  defaultReadingQueueDatePreset,
  visibleTabRefetchInterval,
} from "@/lib/workspaceGuards";
import {
  extractLinkedStudyFromStructuredJson,
  findingsSectionFromStudy,
  linkedStudyPayload,
} from "@/lib/multiStudyReport";
import { InterruptChannelCard } from "@/components/radiology/zai-workspace/interrupt-card";
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import { QuickSelectEditor } from "@/components/radiology/zai-workspace/quick-select-editor";
import { MergePreviewDialog } from "@/components/radiology/zai-workspace/merge-preview-dialog";
import { ConfirmOverwriteDialog } from "@/components/radiology/zai-workspace/confirm-overwrite-dialog";
import { SaveAsFormatDialog } from "@/components/radiology/zai-workspace/save-as-format-dialog";
import { MacroEditorDialog } from "@/components/radiology/zai-workspace/macro-editor-dialog";
import { MacroPromptPopover } from "@/components/radiology/zai-workspace/macro-prompt-popover";
import { CommandPalette as ZaiCommandPalette } from "@/components/radiology/zai-workspace/command-palette";
import {
  Lock, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2, Link2,
} from "lucide-react";


export function WorkspaceOverlays({ vm }: { vm: RadiologyWorkspaceVm }) {
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
      <WhatsAppReportShareDialog
        open={whatsappShareOpen}
        onOpenChange={setWhatsappShareOpen}
        reportId={linkedReportId}
        fallbackPhone={(workflow.currentRow as { patientPhone?: string | null } | null)?.patientPhone ?? study?.patient?.phone ?? null}
        fallbackPatientName={workflow.currentRow?.patientName ?? study?.patient?.name ?? null}
        canVerify={canShowVerify}
        verifierName={session?.user?.name ?? null}
        onSent={() => {
          void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
        }}
      />
      {/* AI Draft lives in Orient (CopilotRail) — not a floating overlay */}
      {/* Background text Report Composer — assistant artifact until Apply */}
      {false && (
      <div
        className={`fixed bottom-4 left-4 z-40 shadow-lg pointer-events-auto ${
          aiAssistantMinimized
            ? "w-auto max-w-[calc(100vw-2rem)]"
            : "w-[min(520px,calc(100vw-2rem))]"
        }`}
      >
        {stagedAiProposals.length > 0 && (
          <div
            className="mb-2 flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] text-indigo-950"
            data-testid="staged-ai-proposals-bar"
          >
            <span className="flex-1 min-w-0 truncate">
              {stagedAiProposals.length} AI proposal{stagedAiProposals.length === 1 ? "" : "s"} staged
            </span>
            <Button
              type="button"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => void applyStagedAiProposals()}
              data-testid="staged-ai-apply"
            >
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-[10px]"
              onClick={() => setStagedAiProposals([])}
              data-testid="staged-ai-discard"
            >
              Discard
            </Button>
          </div>
        )}
        <ReportComposerAssistant
          job={reportComposer.job}
          busy={reportComposer.busy}
          reviewOpen={reportComposer.reviewOpen}
          showAiChanges={reportComposer.showAiChanges}
          isFinalized={isFinalized}
          minimized={aiAssistantMinimized}
          onMinimizedChange={persistAiAssistantMinimized}
          aiMode={composerAiMode}
          onAiModeChange={setComposerAiMode}
          primaryRegionLabel={composerPrimaryRegionLabel}
          selectedKeyImageCount={composerSelectedKeyImages.length}
          inputPreview={reportComposer.inputPreview}
          onPreview={() => void reportComposer.previewInput()}
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
            const sel = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";
            void reportComposer.microEdit(
              /translat/i.test(instr) ? "TRANSLATE" : /shorten/i.test(instr) ? "SHORTEN" : /expand/i.test(instr) ? "EXPAND" : "REPHRASE",
              sel || useWorkspace.getState().findingsText.slice(0, 800),
              "FINDINGS",
              instr,
            );
            setMicroInstruction("");
          }}
        />
        {aiFinalizeGate === "pending" && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] space-y-1.5" data-testid="ai-finalize-gate">
            <p className="font-semibold text-amber-950">AI suggestions remain unreviewed.</p>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" className="h-7 text-[10px]" onClick={() => { reportComposer.setReviewOpen(true); }}>
                Review
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                onClick={() => {
                  void (async () => {
                    await reportComposer.rejectAllPending();
                    aiFinalizeBypassRef.current = true;
                    setAiFinalizeGate("idle");
                    void finalizeReport();
                  })();
                }}
              >
                Reject remaining and continue
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setAiFinalizeGate("idle")}>
                Cancel finalize
              </Button>
            </div>
          </div>
        )}
      </div>
      )}
      {aiFinalizeGate === "pending" ? (
        <div className="fixed bottom-14 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50 p-3 text-[11px] shadow-xl" data-testid="ai-finalize-gate">
          <p className="font-semibold text-amber-950">AI suggestions remain unreviewed.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button type="button" size="sm" className="h-7 text-[10px]" onClick={() => { openReportingTools("ai"); reportComposer.setReviewOpen(true); }}>
              Review in Reporting Tools
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              onClick={() => {
                void (async () => {
                  await reportComposer.rejectAllPending();
                  aiFinalizeBypassRef.current = true;
                  setAiFinalizeGate("idle");
                  void finalizeReport();
                })();
              }}
            >
              Reject remaining and continue
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setAiFinalizeGate("idle")}>
              Cancel finalize
            </Button>
          </div>
        </div>
      ) : null}
      <ZaiCommandPalette
        onPrintReport={() => void handlePrintLikeFinal()}
        onFinalize={() => void finalizeReport()}
        // A-03 — the palette's Navigate commands run the workspace dispatcher, exactly
        // like ⌃↵ / N / Ctrl+Shift+P do, so a palette click and a keystroke cannot put
        // the workspace into two different study states.
        onNextStudy={() => _commandDispatcher?.next?.()}
        onParkStudy={() => _commandDispatcher?.park?.()}
      />
      <LinkStudyDialog
        open={linkStudyOpen}
        onOpenChange={setLinkStudyOpen}
        currentStudyId={studyId ?? null}
        currentPatientId={workflow.currentRow?.patientId ?? null}
        queue={workflow.fullQueue ?? []}
        linkedStudyId={linkedStudy?.studyId ?? null}
        onUnlink={() => useWorkspace.getState().clearLinkedStudy()}
        onSelect={(row) => {
          if (!studyId) return;
          const primary = findingsSectionFromStudy({
            studyId,
            modality: workflow.currentRow?.modality,
            studyDescription: workflow.currentRow?.studyDescription,
            region: studySetup.matchedStudyRegion,
            accessionNumber: workflow.currentRow?.accessionNumber,
            studyInstanceUID: workflow.currentRow?.studyInstanceUID,
          });
          const linked = findingsSectionFromStudy({
            studyId: row.id,
            modality: row.modality,
            studyDescription: row.studyDescription,
            accessionNumber: row.accessionNumber,
            studyInstanceUID: row.studyInstanceUID,
          });
          useWorkspace.getState().setLinkedStudies(primary, linked);
          toast({ title: "Study linked", description: `${primary.title} and ${linked.title} share this report.` });
        }}
      />
      <FinalizeSignDialog
        open={finalizeFlow.open}
        input={finalizeFlow.input}
        onResolve={finalizeFlow.resolve}
        onCancel={finalizeFlow.cancel}
      />
      {/* The interrupt card is the critical-result COMMUNICATION workflow's
          popup. store.recomputeCopilot is the only producer of a
          kind:"interrupt" notification and already refuses to push one when
          ff_radiology_critical_result_comms is off; this gate also covers a
          card that was on screen when an admin turned the flag off. */}
      {criticalCommsEnabled() && <InterruptChannelCard />}
      <QuickSelectEditor />

      {studyLocalEdit && (
        <StudyLocalFindingEditDialog
          finding={studyLocalEdit}
          initial={studyTextOverridesRef.current.get(studyLocalEdit.id) ?? null}
          onApply={applyStudyLocalEdit}
          onCancel={() => setStudyLocalEdit(null)}
        />
      )}
      <MergePreviewDialog />
      <ConfirmOverwriteDialog />
      <SaveAsFormatDialog />
      <MacroEditorDialog />
      <MacroPromptPopover />
      <ReportingShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      {studySetup.structuredDialog && (
        <StructuredFindingDialog
          finding={studySetup.structuredDialog.finding}
          initialValues={studySetup.structuredDialogInitial(studySetup.structuredDialog)}
          editing={studySetup.structuredDialog.editing}
          onApply={(values) => studySetup.applyStructuredDialog(values, selectedQuickIds, handleQuickToggle)}
          onRemove={() => studySetup.removeStructuredFinding(studySetup.structuredDialog!.finding, selectedQuickIds, handleQuickToggle)}
          onCancel={() => studySetup.setStructuredDialog(null)}
        />
      )}

      {/* ─── Zero-Click Read Loop success toast ─── */}
      {(isFinalized || workflow.currentRow?.status === "REPORT_FINAL") && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-30 animate-in slide-in-from-bottom-2">
          <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-white shadow-2xl ring-2 ${
            linkedReportId
              ? "bg-gradient-to-r from-emerald-500 via-emerald-600 to-emerald-700 shadow-emerald-500/40 ring-emerald-300/50"
              // Green here would celebrate a study that has no report behind it.
              : "bg-gradient-to-r from-rose-500 via-rose-600 to-rose-700 shadow-rose-500/40 ring-rose-300/50"
          }`}>
            <ShieldCheck className="h-4 w-4" />
            <span className="text-sm font-semibold">
              {linkedReportId ? "Report signed" : "Study marked final — NO report exists"}
            </span>
            {/* No "Edit report" button here. Unlocking the editors on a signed
                study promised a trial mode in which the text could be edited,
                saved and signed again, and the server refuses all three: the
                draft write is rejected with REPORT_LOCKED, and re-finalize
                returns the existing row untouched. The radiologist retyped the
                report, saw the editors open, and signed again into a document
                that never changed. A signed report's text is locked until a
                real correction path exists; say that instead of offering one
                that fails. */}
            <span
              className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white/90"
              data-testid="signed-report-lock"
              title="The signed text is locked. Nothing typed here can change it."
            >
              Locked — corrections need an administrator
            </span>
            {readingSession.enabled && !allowEditSigned && <><span className="text-[10px] opacity-80">· auto-advancing...</span>
            <ChevronRight className="h-4 w-4 animate-pulse" /></>}
          </div>
        </div>
      )}

      {/* ─── Fatigue-aware session view ─── */}
      {showFatigue && (
        <div className="fixed bottom-16 right-4 z-30 w-72 animate-in slide-in-from-bottom-2">
          <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 shadow-xl">
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-sky-600 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-sky-800">Reading session: {Math.floor(sessionMin / 60)}h {sessionMin % 60}min</div>
                <div className="text-[11px] text-sky-700 mt-0.5">You've been signing for 90 min. Consider the 20-20-20 rule.</div>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" className="h-6 text-[10px] bg-sky-600 hover:bg-sky-700" onClick={() => useWorkspace.getState().dismissFatigueCard()}>
                    <Sparkles className="h-2.5 w-2.5 mr-1" /> Break
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] border-sky-300 text-sky-700" onClick={() => useWorkspace.getState().dismissFatigueCard()}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Draft restore banner ─── */}
      {draftBackup.restoreAvailable && shouldOfferBackupRestore(
        draftBackup.peek(),
        existingDraft?.updatedAt ?? null,
        {
          clinicalHistory: clinicalHistoryText,
          rawFindings: findingsText,
          impression: impressionText,
          recommendation: recommendationText,
        },
      ) && (
        <div className="fixed top-4 right-4 z-30 w-80 rounded-lg border border-amber-300 bg-amber-50 p-3 shadow-xl">
          <div className="text-xs font-semibold text-amber-800">
            {contentLocked ? "Local backup for a signed report" : "Unsaved draft found"}
          </div>
          <div className="text-[10px] text-amber-700 mt-1">
            {contentLocked
              ? "This report is signed, so the backup cannot be restored into it. Discard removes it from this workstation."
              : "A local backup is newer than the server draft."}
          </div>
          <div className="flex gap-1.5 mt-2">
            {/* Restore writes through setEditorContent, which the signed-report
                boundary exempts because it is also how a signed report's own text
                reaches the editor on open — so no refusal would fire here, for a
                report signed in this session or in another one. The banner still
                shows when locked: useStudyFinalize clears the backup after
                signing, but a report signed on another workstation never runs
                that, and Discard is the only path left that removes it. */}
            {!contentLocked && (
              <Button size="sm" className="h-6 text-[10px]" onClick={() => { const r = draftBackup.peek(); if (r) useWorkspace.getState().setEditorContent({ findings: r.rawFindings ?? "", impression: normalizeImpressionLines(r.impression).join("\n"), recommendation: r.recommendation ?? "", technique: r.technique ?? "", clinicalHistory: r.clinicalHistory ?? "" }); }}>Restore</Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => draftBackup.discard()}>Discard</Button>
          </div>
        </div>
      )}

      {/* ─── PCPNDT Form F (in-flow finalize step) ─── */}
      <AlertDialog open={formFFinalizeOpen} onOpenChange={(open) => {
        setFormFFinalizeOpen(open);
        if (!open) formFContinueFinalizeRef.current = false;
      }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>PCPNDT Form F</AlertDialogTitle>
            <AlertDialogDescription>
              Complete Form F for this obstetric ultrasound, then continue finalize. Cancel keeps your report work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {workflow.currentRow?.patientId != null && (
            <PcpndtFormFFinalizeStep
              prefill={{
                patientId: Number(workflow.currentRow.patientId),
                patientName: workflow.currentRow.patientName ?? canonicalDemography?.patientName ?? "Patient",
                age: canonicalDemography?.age != null ? String(canonicalDemography.age) : "",
                address: (workflow.currentRow as { patientAddress?: string }).patientAddress ?? "",
                husbandFatherName: "",
                centreName: (clinicSettings as { name?: string } | undefined)?.name,
                registrationNo: (clinicSettings as { pcpndtRegistrationNo?: string } | undefined)?.pcpndtRegistrationNo,
                doctorName: sessionFresh?.user?.name ?? session?.user?.name ?? "",
                procedure: workflow.currentRow.studyDescription ?? "Obstetric Ultrasound",
                // Stage 1A: prefill default only — the CARE business date, never
                // the workstation clock. A date already carried by the study
                // arrives through `prefill` above and wins over this.
                procedureDate: getClinicDateIst() ?? "",
                referredBy: canonicalDemography.referringDoctor || (workflow.currentRow as { referringDoctor?: string }).referringDoctor || "Self",
                fetalUsgStudyId: Number(workflow.currentRow.id),
              }}
              missing={pcpndtMissing}
              onCancel={() => {
                formFContinueFinalizeRef.current = false;
                setFormFFinalizeOpen(false);
              }}
              onSaved={async () => {
                await qc.invalidateQueries({ queryKey: ["pcpndt-compliance", workflow.currentRow?.patientId] });
                // Re-fetch to confirm compliant before continuing
                try {
                  const fresh = await api.get<{ compliant?: boolean }>(`/api/patient-reports/pcpndt-compliance/${workflow.currentRow!.patientId}`);
                  if (fresh?.compliant !== true) {
                    toast({ title: "Form F saved but still incomplete", description: "Review required fields, then try finalize again.", variant: "destructive" });
                    return;
                  }
                } catch {
                  toast({ title: "Could not verify Form F", description: "Finalize will not proceed until compliance is confirmed.", variant: "destructive" });
                  return;
                }
                formFContinueFinalizeRef.current = true;
                setFormFFinalizeOpen(false);
                void finalizeReport();
              }}
            />
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Confirm: Replace Impression ─── */}
      <AlertDialog open={confirmImpressionReplace} onOpenChange={setConfirmImpressionReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace impression?</AlertDialogTitle>
            <AlertDialogDescription>The current impression text will be replaced with a summary generated from your findings.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmedReplaceImpression}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Confirm: Verify / Countersign ─── */}
      <AlertDialog open={confirmVerify} onOpenChange={setConfirmVerify}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verify (countersign) report?</AlertDialogTitle>
            <AlertDialogDescription>This records you as the verifying radiologist: {sessionFresh?.user?.name ?? "current user"}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmedVerifyReport()}>Verify</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Unified leave: Save & leave / Discard / Stay ─── */}
      <AlertDialog
        open={leaveDialogOpen}
        onOpenChange={(open) => {
          if (!open && leaveResolverRef.current) {
            resolveLeaveChoice("stay");
          } else {
            setLeaveDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent data-testid="leave-dirty-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              {leavePromptReasonRef.current}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => resolveLeaveChoice("stay")}>
              Stay
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => resolveLeaveChoice("discard")}
              data-testid="leave-discard"
            >
              Discard
            </Button>
            <AlertDialogAction
              onClick={() => resolveLeaveChoice("save_and_leave")}
              data-testid="leave-save"
            >
              Save & leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
