/**
 * WorkspaceTopBar — Phase 4 JSX extraction (behavior unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck — Phase 4 vm bag; domain types live in clinical UI hook.
import type { RadiologyWorkspaceVm } from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/fetchApi";
import VoiceCommandBar from "@/components/radiology/VoiceCommandBar";
import SmartDictationPanel from "@/components/radiology/SmartDictationPanel";
import { Input } from "@/components/ui/input";
import { useWorkspace, formatSignOff, lookupProfile, EMPTY_FIELD_PROVENANCE, type WorkspaceStore } from "@/lib/zai-workspace/store";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import {
  REPORT_SECTIONS,
  countAssisted,
  nextActiveSection,
  nextFindingsTool,
  sectionStatuses,
  summarizeDemography,
  summarizeFieldText,
  summarizeFindings,
  summarizeImpression,
  summarizeRecommendation,
  summarizeRefDoctor,
  summarizeRegion,
  summarizeReport,
  summarizeTechnique,
  type FindingsToolId,
  type ReportSectionId,
} from "@/lib/reportSectionAccordion";
import {
  canForceReleaseStudyLock,
  canTrialEditSignedReport,
  defaultReadingQueueDatePreset,
  visibleTabRefetchInterval,
} from "@/lib/workspaceGuards";
import { canPrintLikeFinal } from "@/components/radiology/ReportExportPanel";
import { CriticalSlaTimer } from "@/components/radiology/zai-workspace/critical-sla-timer";
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import {
  Lock, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save, Printer, RefreshCw,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2, Link2,
} from "lucide-react";


export function WorkspaceTopBar({ vm }: { vm: RadiologyWorkspaceVm }) {
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
    smartDictation,
    smartDictationEligible,
    smartDictationOpen,
    setSmartDictationOpen,
    smartDictationRegion,
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
      {/* ─── Top chrome ─── */}
      <header className="flex items-center gap-4 border-b border-emerald-200/60 px-4 py-2.5 bg-gradient-to-r from-emerald-50/80 via-card to-card shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-700 shadow-md shadow-emerald-500/30 ring-1 ring-emerald-300/50">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-xs font-bold leading-none bg-gradient-to-r from-emerald-700 to-emerald-600 bg-clip-text text-transparent">Z.ai RadReporting</div>
            <div className="text-[9px] text-emerald-600/70 leading-none mt-0.5 font-medium">World's best reporting workspace</div>
          </div>
        </div>
        <div className="h-5 w-px bg-border mx-1" />
        {/* Layout modes — Report / Split / Viewer (legacy) */}
        <div className="flex items-center rounded-md border border-emerald-200 overflow-hidden text-[10px] shadow-sm" data-testid="layout-mode-selector">
          {([
            { mode: "reportFocus" as const, label: "Report", icon: <Maximize2 className="h-3 w-3" />, title: "Report Focus — hide viewer" },
            { mode: "split" as const, label: "OHIF", icon: <Columns2 className="h-3 w-3" />, title: "OHIF / WADO images + editor" },
            { mode: "viewerFocus" as const, label: "Viewer+", icon: <Monitor className="h-3 w-3" />, title: "Larger embedded WADO / OHIF viewer" },
            { mode: "dualScreen" as const, label: "Dual", icon: <AppWindow className="h-3 w-3" />, title: "Dual Screen — Open Study popup + full editor" },
          ]).map((m) => (
            <button
              key={m.mode}
              type="button"
              title={m.title}
              onClick={() => setLayoutMode(m.mode, { reenableAutoFocus: true })}
              className={`inline-flex items-center gap-1 px-2 py-1.5 border-r last:border-r-0 border-emerald-200/60 transition-colors ${layoutMode === m.mode ? "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm" : "hover:bg-emerald-50 text-foreground"}`}
              aria-pressed={layoutMode === m.mode}
            >
              {m.icon}{m.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={goPrevStudy} title="Previous (history)">
          <ChevronLeft className="h-3.5 w-3.5 mr-0.5" /> Prev
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={goNextStudy} title="Next study">
          Next <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </Button>
        {isDirty && (
          <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-800 border-amber-200" data-testid="dirty-badge">
            Unsaved
          </Badge>
        )}
        {lastSavedAt && !isDirty && (
          <span className="text-[9px] text-muted-foreground" title={lastSavedAt.toLocaleString()}>
            Saved {lastSavedAt.toLocaleTimeString()}
          </span>
        )}
        <div className="h-5 w-px bg-border mx-2" />
        {/* Searchable patient jump (ported from legacy chrome) */}
        <div className="flex items-center gap-1.5 shrink-0 mx-1" data-testid="compact-patient-picker">
          <Input
            value={patientJumpFilter}
            onChange={(e) => setPatientJumpFilter(e.target.value)}
            placeholder="Search patient…"
            className="h-7 w-36 text-[10px] px-2"
            data-testid="queue-patient-filter"
          />
          <select
            className="h-7 min-w-[9rem] max-w-[16rem] text-[10px] border rounded-md px-1.5 bg-background"
            value=""
            data-testid="queue-jump"
            aria-label="Select patient"
            onChange={(e) => {
              const id = e.target.value;
              if (id) openStudyGuarded(id);
              setPatientJumpFilter("");
            }}
          >
            <option value="">
              {study?.patient?.name
                ? `${study.patient.name.slice(0, 28)}${study.patient.name.length > 28 ? "…" : ""}`
                : `Patients (${jumpQueue.length})`}
            </option>
            {jumpQueue.map((s: Study) => (
              <option key={s.id} value={s.id}>
                {s.patient?.name ?? "Unknown"} · {s.modality} · {s.accession}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title={leftCollapsed ? "Expand Reading Queue (Q)" : "Collapse Reading Queue (Q)"}
          data-testid="toggle-left-panel"
          onClick={() => (leftCollapsed ? leftPanelRef.current?.expand() : leftPanelRef.current?.collapse())}
        >
          {leftCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          variant={rightCollapsed ? "outline" : "secondary"}
          className="h-7 px-2 text-xs"
          title={rightCollapsed ? "Open Reporting Tools" : "Close Reporting Tools"}
          data-testid="toggle-right-panel"
          onClick={() => {
            if (rightCollapsed) openReportingTools(reportingToolsTab);
            else rightPanelRef.current?.collapse();
          }}
        >
          {rightCollapsed ? <PanelRightOpen className="mr-1 h-3.5 w-3.5" /> : <PanelRightClose className="mr-1 h-3.5 w-3.5" />}
          Reporting Tools
        </Button>
        <div className="h-5 w-px bg-border mx-1" />
        {study && (
          <div className="flex items-center gap-2 min-w-0 flex-1 px-2">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: study.modality === "MR" ? "oklch(0.55 0.18 280)" : study.modality === "CT" ? "oklch(0.55 0.18 220)" : study.modality === "US" ? "oklch(0.6 0.15 180)" : "oklch(0.6 0.12 60)" }}>
              {study.modality}
            </span>
            <span className="text-xs font-semibold truncate">{studyNameForExport}</span>
            {studySetup.activeProtocol && (
              <Badge variant="outline" className="text-[9px] shrink-0" title="Auto-selected protocol from DICOM">
                {studySetup.activeProtocol.name}
              </Badge>
            )}
            {studySetup.studyRegions.length > 0 && (
              <span className="text-[9px] text-muted-foreground shrink-0" title="Selected study regions">
                · {studySetup.studyRegions.join(" + ")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground truncate">
              · {canonicalDemography.patientName || study.patient?.name || "Unknown"}
              {canonicalDemography.age
                ? ` (${canonicalDemography.age}${canonicalDemography.sex ? `/${canonicalDemography.sex}` : ""})`
                : canonicalDemography.sex
                  ? ` (${canonicalDemography.sex})`
                  : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant={linkedStudy ? "secondary" : "outline"}
              className="h-6 px-2 text-[10px] shrink-0"
              data-testid="link-study-button"
              title={linkedStudy ? `Linked: ${linkedStudy.title}` : "Link a second study into this report"}
              onClick={() => setLinkStudyOpen(true)}
            >
              <Link2 className="h-3 w-3 mr-1" />
              {linkedStudy ? linkedStudy.title : "Link Study"}
            </Button>
            {findingsPct > 0 && (
              <span className={`text-[9px] font-mono px-1 rounded ${findingsPct >= 80 ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                title="Findings completion (preload fires at 80%)">{findingsPct}%</span>
            )}
            {/* Report flow progress dots — Technique → Findings → Impression → Recommendation */}
            {(techniqueText.trim() || findingsText.trim() || impressionText.trim() || recommendationText.trim()) && (
              <div className="flex items-center gap-0.5 ml-1" title="Report section progress">
                {([['T', techniqueText], ['F', findingsText], ['I', impressionText], ['R', recommendationText]] as const).map(([l, v], i) => (
                  <span key={l} className={`w-1.5 h-1.5 rounded-full ${v.trim() ? "bg-emerald-500" : "bg-muted-foreground/25"}`} title={`${l === 'T' ? 'Technique' : l === 'F' ? 'Findings' : l === 'I' ? 'Impression' : 'Recommendation'}${v.trim() ? ' ✓' : ' —'}`} />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {/* Smart Dictation — six MRI examinations only (Task 15 Part E) */}
          {smartDictationEligible && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px] gap-1 shrink-0"
              data-testid="smart-dictation-launch"
              onClick={() => setSmartDictationOpen(true)}
              title={`Smart Dictation (${smartDictationRegion ?? ""}) — dictate multiple findings, one consolidated preview, apply everything, then correct conversationally`}
            >
              <Sparkles size={12} className="text-violet-500" />
              Smart Dictation
              {smartDictation.pendingCount > 0 && (
                <span className="ml-0.5 rounded-full bg-violet-100 text-violet-700 px-1.5 text-[9px] font-semibold" data-testid="smart-dictation-pending-badge">
                  {smartDictation.pendingCount}
                </span>
              )}
            </Button>
          )}
          {smartDictationEligible && (
            <SmartDictationPanel
              vm={smartDictation}
              open={smartDictationOpen}
              onOpenChange={setSmartDictationOpen}
              studyRegion={smartDictationRegion}
              examLabel={workflow.currentRow?.studyDescription ?? "MRI"}
              micSupported={voiceSession.enabled && voiceSession.uiState !== "unsupported"}
              micListening={voiceSession.capturing}
              onMicToggle={() => {
                // The panel mic IS the workspace voice session in dictation
                // mode — a completed capture routes into the smart session
                // (the VM routing effect picks it up while the panel is open).
                if (!voiceSession.enabled) return;
                if (voiceSession.mode !== "dictation") voiceSession.setMode("dictation");
                if (voiceSession.dictationTarget !== "findings") {
                  voiceSession.setDictationTarget("findings");
                }
                voiceSession.toggleListening();
              }}
            />
          )}
          {/* The SLA clock is part of the optional critical-result COMMUNICATION
              workflow. The store already refuses to start it when
              ff_radiology_critical_result_comms is off; this second gate covers
              a clock that was started while the flag was on and is still
              running when an admin turns the flag off mid-session. */}
          {criticalCommsEnabled() && criticalSlaStartedAt && <CriticalSlaTimer />}
          <div className="flex items-center gap-1 text-[10px] text-emerald-700/80 px-2 py-1 rounded bg-emerald-50/70 border border-emerald-200/60">
            <Activity className="h-3 w-3" />
            <span className="font-mono">{Math.floor(sessionMin / 60)}h {sessionMin % 60}m</span>
            <span className="text-emerald-400/60">·</span>
            <span className="text-emerald-600 font-semibold">{completedCount} signed</span>
          </div>
          {/* Existing VoiceCommandBar */}
          {voiceSession.enabled && (
            <VoiceCommandBar
              voice={voiceSession}
              embedded
              composerPreview={voiceComposer.preview}
              composerComposing={voiceComposer.composing}
              composerError={voiceComposer.error}
              phraseFallbackAvailable={voiceComposer.phraseFallbackAvailable}
              onComposerApply={applyVoiceComposerWithUndo}
              onComposerDiscard={voiceComposer.discardPreview}
              onComposerPhraseFallback={() => void voiceComposer.requestPhraseFallback()}
              onComposerEditRaw={insertRawDictation}
              onAddAsFinding={dictateAddAsFinding}
              onAddAsNote={dictateAddAsNote}
            />
          )}
          {/* Save button */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void saveDraft()} disabled={!isOnline}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          {/* Paper. The same action as the one in Layout / Export, placed where it is
              reachable the moment he decides he is done reading — which is usually
              while the findings section is still the open one. */}
          {canPrintLikeFinal({ onPrintLikeFinal: handlePrintLikeFinal, linkedReportId }) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => void handlePrintLikeFinal()}
              disabled={!isOnline || printingLikeFinal}
              title="Print the report on the final layout — saves it first, no DRAFT watermark"
              data-testid="btn-workspace-print"
            >
              {printingLikeFinal ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Printer className="h-3.5 w-3.5 mr-1" />}
              Print
            </Button>
          )}
          {/* WhatsApp share */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-emerald-700"
            onClick={handleShare}
            title="Share report PDF via WhatsApp"
            data-testid="btn-workspace-whatsapp-share"
          >
            <MessageCircle className="h-3.5 w-3.5 mr-1" /> Share
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            data-testid="send-report-to-hope"
            title="Send signed report to Hope ERP"
            disabled={!studyId || sendHopeBusy}
            onClick={() => {
              void (async () => {
                setSendHopeBusy(true);
                try {
                  const reportId = linkedReportIdRef.current;
                  const r = await api.post<{
                    ok?: boolean;
                    alreadySent?: boolean;
                    error?: string;
                    code?: string;
                  }>("/api/internal/radiology/send-report-to-hope", {
                    reportId: reportId ?? undefined,
                    worklistId: studyId,
                  });
                  if (!r?.ok) {
                    toast({
                      title: "Could not send to Hope",
                      description: r?.error ?? "Link a Hope referral or finalize the report first.",
                      variant: "destructive",
                    });
                    return;
                  }
                  toast({
                    title: r.alreadySent ? "Already on Hope" : "Sent to Hope",
                    description: "Report appears under Hope investigations for this patient.",
                  });
                } catch (err) {
                  toast({
                    title: "Could not send to Hope",
                    description: err instanceof Error ? err.message : "Unknown error",
                    variant: "destructive",
                  });
                } finally {
                  setSendHopeBusy(false);
                }
              })();
            }}
          >
            <Hospital className="h-3.5 w-3.5 mr-1" />
            {sendHopeBusy ? "Sending…" : "Hope"}
          </Button>
          {/* Teaching case */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleSaveTeachingCase}>
            <Eye className="h-3.5 w-3.5 mr-1" /> Teaching
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcutHelpOpen(true)}
          >
            <Keyboard className="h-3.5 w-3.5 mr-1" /> ?
          </Button>
          {/* New voice bar */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              focusVoiceBar();
              if (voiceSession.enabled) voiceSession.toggleListening();
            }}
            title="Focus Care voice bar / toggle listen (Ctrl+Shift+V)"
          >
            <Brain className="h-3.5 w-3.5 mr-1" /> Voice
          </Button>
          {/* Command palette */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => useWorkspace.getState().toggleCommandPalette()}>
            <Sparkles className="h-3.5 w-3.5 mr-1" /> ⌘K
          </Button>
          {/* Park */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { if (studyId) (workflow as any).park(studyId, ""); }} title="Park (P)">
            <Pause className="h-3.5 w-3.5 mr-1" /> Park
          </Button>
          {/* Verify / countersign (legacy) */}
          {canShowVerify && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs border-indigo-300 text-indigo-800"
              disabled={verifyBusy}
              onClick={() => void handleVerifyReport()}
              data-testid="verify-report"
              title={verifyGate.reason ?? "Countersign / verify"}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              {verifyBusy ? "Verifying…" : "Verify"}
            </Button>
          )}
          {/* Section progress indicator — reuses sectionStatus computed above */}
          {(() => {
            const keySections: ReportSectionId[] = ["history", "technique", "findings", "impression"];
            const doneCount = keySections.filter(s => sectionStatus[s] === "done").length;
            const totalCount = keySections.length;
            const pct = Math.round((doneCount / totalCount) * 100);
            const barColor = pct === 100 ? "bg-emerald-500" : pct >= 60 ? "bg-emerald-400" : pct >= 30 ? "bg-amber-400" : "bg-slate-300";
            return (
              <div className="flex items-center gap-1.5 mr-1" title={`${doneCount}/${totalCount} sections filled (${pct}%)`}>
                <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className={`h-full rounded-full ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[9px] font-mono text-muted-foreground w-6 text-right">{pct}</span>
              </div>
            );
          })()}
        </div>
      </header>

      {/* ─── Lock status bar ─── */}
      {isLocked && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          <Lock className="h-3 w-3" />
          Study locked by {studyLock.ownerName}. Expires {studyLock.expiresAt ? new Date(studyLock.expiresAt).toLocaleTimeString() : "soon"}.
          {canForceReleaseStudyLock(isOwner, role, studyLock.ownerId, myUserId) && (
            <Button size="sm" variant="outline" className="h-5 text-[10px] ml-auto" onClick={() => studyLock.forceRelease(String(studyId))}>
              Force release
            </Button>
          )}
        </div>
      )}
      {lockLost && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          <AlertTriangle className="h-3 w-3" />
          Lock lost — connection issue. Your changes may not be saved. <Button size="sm" variant="outline" className="h-5 text-[10px] ml-auto" onClick={() => studyLock.claim()}>Reclaim</Button>
        </div>
      )}
      {/* PCPNDT gate warning */}
      {isObUsg && pcpndtCompliance && !pcpndtCompliance.compliant && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-950">
          <AlertTriangle className="h-3 w-3" />
          Form F required{pcpndtMissing.length ? `: ${pcpndtMissing.join(", ")}` : ""}. Finalize opens Form F in-flow — Legacy Box remains a fallback.
          <Button size="sm" variant="outline" className="h-5 text-[10px] ml-auto" onClick={() => setFormFFinalizeOpen(true)}>
            Open Form F
          </Button>
        </div>
      )}
      {isObUsg && pcpndtCompliance?.compliant === true && (
        <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-emerald-50 to-emerald-100/60 border-b border-emerald-200 text-[11px] text-emerald-800 font-medium">
          <ShieldCheck className="h-3 w-3" /> Form F complete
        </div>
      )}


    </>
  );
}
