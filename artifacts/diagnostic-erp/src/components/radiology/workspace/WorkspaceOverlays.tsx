/**
 * WorkspaceOverlays — Phase 4 JSX extraction (behavior unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck — Phase 4 vm bag; types live in clinical UI hook.
/**
 */

/**
 * RadiologyReportingWorkspace — the NEW modular workspace.
 * Replaces the old 7,886-line page (backed up as .legacy.tsx).
 *
 * This version wires ALL existing Care hooks and services:
 *   • useReportingWorkflow → queue, navigation, parked, history
 *   • useStudyLock → claim/heartbeat/release
 *   • useRadiologyDraftId → server-side draft persistence
 *   • useLocalDraftBackup → 30-snapshot localStorage autosave
 *   • useVoiceSession → 4-provider speech-to-text with grammar + safety
 *   • useFinalizeFlow → promise-based sign dialog
 *   • useCopilotLearning → learned-ignored suggestions
 *   • saveRadiologyDraft / finalizeRadiologyReport → save + sign + archive
 *   • studyLaunchService → OHIF viewer launch (AUTO LAN/Tailscale/Cloudflare/Public)
 *   • EmbeddedWadoViewer → embedded DICOM viewer with 3 enlarge modes
 *     (center-column vertical, fullscreen overlay, open in new tab)
 *   • PrintImagePicker / ReportImagePicker → DICOM image selection for print
 *   • ComparisonPanel → prior study comparison with sentence-level diff
 *   • FollowUpPanel → follow-up recommendations
 *   • validateReport / computeQualityScore → report validation
 *   • finalizeSafety / criticalResults → pre-finalize safety checks
 *   • draftRescue → pre-redirect save on 401
 *   • workspaceCommands → command dispatcher (single choke point)
 *   • copilotOrchestrator + 19 plug-in modules → advisory copilot
 *   • workspaceLayoutPrefs → per-radiologist layout mode + intentional
 *     Queue/Viewer/Report sizes (byMode); auto laptop focus resizes via
 *     ImperativePanelHandle only and does not overwrite byMode
 *   • readingSession → auto-advance toggle
 *   • PCPNDT gate → OB USG Form F compliance
 *   • MRI warm cache → prefetch
 *
 * NEW features from our design:
 *   1. Per-field Quick Select chocolate boxes (with pencil/edit/add tile)
 *   2. Report Formats with multicolor merge preview
 *   3. Snippet macros with variable substitution (:trigger + Tab)
 *   4. Write-time critical-finding interrupt + SLA timer
 *   5. Sign-off profile per modality
 *   6. Preload next study at 80% findings completion
 *   7. Stage-aware Copilot rail (Orient/Observe/Measure/Conclude/Verify)
 *   8. Inline ghost-text AI drafts (Tab to accept)
 *   9. Gutter lint marks (✕/△/◌)
 *  10. Zero-Click Read Loop (auto-advance after finalize)
 *  11. Command palette (Ctrl+K)
 *  12. Per-patient identity accent band
 *  13. Fatigue-aware session view (90-min 20-20-20)
 */

import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

// ─── Existing Care hooks (the wiring contract) ────────────────────────────────
import { useReportingWorkflow } from "@/hooks/useReportingWorkflow";
import { readingQueueShouldSearchOrthanc } from "@/lib/pacsWorklistQuery";
import { useStudyLock } from "@/hooks/useStudyLock";
import { useFinalizeFlow } from "@/hooks/useFinalizeFlow";
import { useLocalDraftBackup } from "@/hooks/useLocalDraftBackup";
import { useCopilotLearning } from "@/hooks/useCopilotLearning";
import { useCopilotPrefs } from "@/hooks/useCopilotPrefs";
import { useRadiologyDraftId, type RadiologyDraftRow } from "@/hooks/useRadiologyDraftId";
import { useRadiologyPalettePrefs } from "@/hooks/useRadiologyPalettePrefs";
import { useFindingsMacroRecents } from "@/hooks/useFindingsMacroRecents";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

// ─── Existing Care lib/services ────────────────────────────────────────────────
import { api } from "@/lib/fetchApi";
import { readStaffSession, normalizeRole, isOwnerRole, isFeatureEnabled } from "@/lib/staffSession";
import { saveRadiologyDraft, finalizeRadiologyReport } from "@/lib/radiologyReportLifecycle";
import { exportRadiologyReportToWord, safeFileNamePart } from "@/lib/radiologyReportWordExport";
import { exportRadiologyReportToPdf } from "@/lib/radiologyReportPdfExport";
import {
  buildLivePrintBodyHtml,
  finalizePrintPreviewHtml,
} from "@/lib/radiologyReportPrintLiveMerge";
import {
  canHydrateDraftForPatient,
  shouldCommitAutosave,
} from "@/lib/radiologyWorkspaceSafety";
import { activeStandardLetterhead, type PresentationTemplatesPayload } from "@/lib/careLetterpadChrome";
import {
  buildPreviewHtml,
  formatReportExportError,
  type ReportHeadingCase,
  type ReportSectionSpacing,
  type ReportImpressionStyle,
} from "@/lib/radiologyReportPreviewHtml";
import {
  mergeReportDemography,
  resolveDisplayAge,
  doctorCatalogLabels,
  type ReportDemography,
} from "@/lib/reportDemography";
import type { PrintClinic } from "@/lib/reportPdfGenerator";
import { loadPrintSettings, savePrintSettings } from "@/lib/reportPdfGenerator";
import {
  REPORT_LAYOUT_OPTIONS,
  type ReportLayoutKey,
  quickSelectLayoutKey,
  reportLayoutTemplateQuery,
} from "@/components/radiology/ReportLayoutQuickSelect";
import ReportExportPanel from "@/components/radiology/ReportExportPanel";
import { ElectronicFilmPanel } from "@/components/radiology/ElectronicFilmPanel";
import { validateReport, computeQualityScore } from "@/lib/reportValidator";
import { logParityInDev } from "@/lib/reportQualityShadow";
import { formatQualityAdvisoryForDialog } from "@/lib/reportQualityFinalize";
import { runFinalizeQualityEvaluation } from "@/lib/reportQualityFinalizeApi";
import { detectCriticalFindings } from "@/lib/criticalResults";
import { computeFinalizeSafety, formatFinalizeSafety, criticalFindingBlocksFinalize } from "@/lib/finalizeSafety";
import { retryWithBackoff, isTransientError, offlineBlockMessage } from "@/lib/reliability";
import {
  registerDraftRescueSaver, deregisterDraftRescueSaver,
  writeRescueDraft, readRescueDraft, clearRescueDraft,
} from "@/lib/draftRescue";
import {
  shouldOfferBackupRestore, normalizeImpressionLines,
  canVerifyReport,
} from "@/lib/workspaceReportState";
import { type DispatchResult } from "@/lib/workspaceCommands";
import { createEnsureDraftOnce, isMeaningfulReportEdit } from "@/lib/ensureDraftOnce";
import { leaveDirtyStudy, type LeaveChoice } from "@/lib/leaveDirtyStudy";
import { deriveStudyReadyStatus } from "@/lib/studyReadyStatus";
import {
  stageShadowProposal,
  materializeStagedProposals,
  type StagedAiProposal,
} from "@/lib/stagedAiProposals";
import {
  resolveReadingQueueModality,
  writeStoredReadingQueueModality,
  isReadingQueueModality,
  type ReadingQueueModality,
} from "@/lib/readingQueueModality";
import { loadReadingSession, toggleReadingSession, bumpSessionCompleted } from "@/lib/readingSession";
import {
  matchStudyCombination, buildCombination, combinationInserts,
} from "@/lib/studyCombinations";

// ─── Existing Care components ──────────────────────────────────────────────────
import EmbeddedWadoViewer, { type EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import PrintImagePicker from "@/components/radiology/PrintImagePicker";
import ReportImagePicker from "@/components/radiology/ReportImagePicker";
import ReportImagePanel from "@/components/radiology/ReportImagePanel";
import FrozenKeyImagesRail, {
  uploadFrozenKeyImage,
  useFrozenKeyImages,
  frozenKeyImagesQueryKey,
} from "@/components/radiology/FrozenKeyImagesRail";
import { buildObservationKeyImageCaption } from "@/lib/keyImageCaption";
import {
  extractCareViewerMeasurements,
  extractCareCanalApProvenance,
  formatMeasurementChip,
} from "@/lib/structuredViewerMeasurements";
import type { CanalApProvenanceMap } from "@/lib/spineCanalAp";
import ComparisonPanel from "@/components/radiology/ComparisonPanel";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import FinalizeSignDialog from "@/components/radiology/FinalizeSignDialog";
import VoiceCommandBar from "@/components/radiology/VoiceCommandBar";
import { useVoiceComposer } from "@/hooks/useVoiceComposer";
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
import { deriveStructuredObservations, computeStructuredRemovals } from "@/lib/structuredFormat/structuredObservations";
import PriorComparisonToolbar from "@/components/radiology/PriorComparisonToolbar";
import ViewerMeasurementsBanner from "@/components/radiology/ViewerMeasurementsBanner";
import { requestOhifNavigateToAnchor } from "@/lib/ohifViewerBridge";
import { viewportToAnchor } from "@/lib/observationAnchor";
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";
import {
  isMriCervicalReportingContext,
  isMriDorsalReportingContext,
} from "@/lib/mriSpineCanvasRegions";
import { isBrainMeasuresReportingContext } from "@/lib/reportingStudyContext";
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
  useFindingComposerDraft,
} from "@/components/radiology/reporting-canvas";
import {
  buildComposerCatalog,
  draftFromObservation,
  emptyComposerDraft,
  proposeComposerFromTranscript,
} from "@/lib/findingComposerModel";
import { defaultCoverageMarks } from "@/lib/coverageMarks";
import {
  canalApToPdfRows,
  canalSegmentFromSpine,
  resolveCanalSegment,
} from "@/lib/spineCanalAp";
import LegacyBox, { type LegacyBoxTab } from "@/components/radiology/LegacyBox";
import { PcpndtFormFFinalizeStep } from "@/components/radiology/PcpndtFormFFinalizeStep";
import { ReportComposerAssistant } from "@/components/radiology/ReportComposerAssistant";
import { useReportComposer } from "@/hooks/useReportComposer";
import {
  readAiAssistantMinimizedPreference,
  writeAiAssistantMinimizedPreference,
} from "@/lib/aiAssistantPrefs";
import {
  canUndoLastAbnormal,
  describeLastAbnormalForUndo,
  describeRestoredBaseline,
} from "@/lib/undoLastAbnormal";
import {
  readReportSectionCollapsePrefs,
  writeReportSectionCollapsePrefs,
  prefsAfterSectionActivate,
  sectionsRequiringReveal,
  isImpressionContradictionWarning,
  revealNeedKey,
  nextAutoRevealSection,
  type ReportSectionCollapsePrefs,
} from "@/lib/reportSectionCollapsePrefs";
import {
  ABNORMAL_HIGHLIGHT_MS,
  buildAbnormalHighlightFromPatch,
  clearHighlightIfStudyChanged,
  describeAbnormalReplacementToast,
  type AbnormalHighlightState,
} from "@/lib/abnormalSelectionFeedback";
import { ReportingStickyActionBar } from "@/components/radiology/ReportingStickyActionBar";
import {
  ReportingToolsPanel,
  type QuickInsertSource,
  type ReportingToolsTab,
} from "@/components/radiology/ReportingToolsPanel";
import { NormalBaselineBadge } from "@/components/radiology/NormalBaselineBadge";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import { WhatsAppReportShareDialog } from "@/components/radiology/WhatsAppReportShareDialog";
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import MriReadinessStrip from "@/components/radiology/MriReadinessStrip";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
import ReportingShortcutHelp from "@/components/radiology/ReportingShortcutHelp";
import StructuredFindingDialog from "@/components/radiology/StructuredFindingDialog";
import { ConnectedFindingsHighlightEditor } from "@/components/radiology/zai-workspace/ConnectedFindingsHighlightEditor";
import ReportDemographyCard from "@/components/radiology/ReportDemographyCard";
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import { StudyRegionReportFormatSection } from "@/components/radiology/StudyRegionReportFormatSection";
import { WholeReportFormatControl } from "@/components/radiology/WholeReportFormatControl";
import { MriAbnormalFormatStrip } from "@/components/radiology/MriAbnormalFormatStrip";
import { setFormatApplyBridge } from "@/lib/zai-workspace/formatApplyBridge";
import ClinicalHistoryChipStrip from "@/components/radiology/ClinicalHistoryChipStrip";
import TechniqueChoiceStrip from "@/components/radiology/TechniqueChoiceStrip";
import FindingsAnatomyStrip from "@/components/radiology/FindingsAnatomyStrip";
import FindingsAnatomyChips from "@/components/radiology/FindingsAnatomyChips";
import StudyLocalFindingEditDialog, {
  type StudyLocalTextOverride,
} from "@/components/radiology/StudyLocalFindingEditDialog";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { useReportingStudySetup } from "@/hooks/useReportingStudySetup";
import { useReportSectionChrome } from "@/hooks/radiology-workspace/useReportSectionChrome";
import { useWorkspaceLayout } from "@/hooks/radiology-workspace/useWorkspaceLayout";
import { useVoiceReporting } from "@/hooks/radiology-workspace/useVoiceReporting";
import { useDraftPersistence } from "@/hooks/radiology-workspace/useDraftPersistence";
import { useStudyFinalize } from "@/hooks/radiology-workspace/useStudyFinalize";
import { useWorkspaceExportShare } from "@/hooks/radiology-workspace/useWorkspaceExportShare";
import { useWorkspaceCommands } from "@/hooks/radiology-workspace/useWorkspaceCommands";
import { useOhifViewerBridge } from "@/hooks/radiology-workspace/useOhifViewerBridge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_RECOMMENDATION_CHIPS,
  RECOMMENDATION_CHIP_ALIASES,
  recommendationChipActive,
  removeRecommendationChip,
} from "@/lib/recommendationChips";
import { findingsMapToText } from "@/lib/findingsMapText";
import {
  matchQuickFindingBySpokenTerm,
  resolveQuickFindingFromSpeech,
} from "@/lib/resolveQuickFindingFromSpeech";
import { trackWorkspaceEvent } from "@/lib/reportingTelemetry";
import { type PathologyIncoming } from "@/lib/pathologyPatch";
import { selectedQuickFindingIds } from "@/lib/observationSlot";
import { collectCompositionFinalizeGate, extractCareObservationLedger, patchFindingsContributionBlocked } from "@/lib/observationLedger";
import {
  provenanceMapToSegments,
  provenanceVisualKind,
  type InsertSource,
} from "@/lib/reportFieldMerge";
import { generateLocalImpression } from "@/lib/generateLocalImpression";
import {
  collectPathologyRecommendationChips,
  mergeRecommendationChipLists,
} from "@/lib/impressionRecommendationWiring";
import { hasPhrase, appendClinicalPhrase, removeClinicalPhrase } from "@/lib/clinicalHistoryText";
import type { Side } from "@/lib/sideSwap";
import { applySide } from "@/lib/sideSwap";
import {
  loadWorkspaceLayoutPrefs, saveWorkspaceLayoutPrefs,
  shouldShowEmbeddedViewer, fallbackModeWhenPopupBlocked,
  resolveLayoutModeForModality, withModalityLayoutMode,
  resolveViewerReportPcts, clampLeftPct, clampReportPct, clampViewerPct,
  LEFT_COLLAPSED_PCT,
  type WorkspaceLayoutMode,
} from "@/lib/workspaceLayoutPrefs";
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
import { useConstrainedReportingViewport } from "@/hooks/useConstrainedReportingViewport";
import { isUltrasoundModality, isObstetricUsgStudy } from "@/lib/usgModality";
import { prefetchMriStudies, prefetchNextMriStudy } from "@/lib/mriStudyPrefetch";
import { prefetchNextStudyReportShell } from "@/lib/nextStudyReportPrefetch";
import { mriWarmTargetsFromRows } from "@/lib/mriWarmScope";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import type { ReportImageRef } from "@/lib/reportImageRefs";
import { daysAgoISO, todayISO } from "@/lib/dateRangePresets";

// ─── New Z.ai workspace components ─────────────────────────────────────────────
import { useWorkspace, formatSignOff, lookupProfile, EMPTY_FIELD_PROVENANCE, type WorkspaceStore } from "@/lib/zai-workspace/store";
import {
  useDebouncedWorkspaceClinicalTexts,
} from "@/lib/zai-workspace/workspaceClinicalTexts";
import { getFindingsCompletionPct, runLintRules, shouldPreloadNext } from "@/lib/zai-workspace/types";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import { WorklistStrip, type ReadingQueueDatePreset, type ReadingQueueSort } from "@/components/radiology/zai-workspace/worklist-strip";
import { CopilotRail } from "@/components/radiology/zai-workspace/copilot-rail";
import { FindingsEditor } from "@/components/radiology/zai-workspace/findings-editor";
import { PersonalTemplateRail } from "@/components/radiology/zai-workspace/personal-template-rail";
import { ReportFormatPicker } from "@/components/radiology/zai-workspace/report-format-picker";
import {
  readPersonalReportTemplates,
  type PersonalReportTemplate,
  type PersonalTemplateTarget,
} from "@/lib/personalReportTemplates";
import { QuickSelectStrip } from "@/components/radiology/zai-workspace/quick-select-strip";
import {
  FindingsToolDrawer,
  FindingsToolTabs,
  ReportAccordionSection,
} from "@/components/radiology/zai-workspace/report-section-accordion";
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
import { ImpressionWarningStrip } from "@/components/radiology/reporting-canvas/ImpressionWarningStrip";
import { LinkStudyDialog } from "@/components/radiology/LinkStudyDialog";
import { MultiStudyFindingsEditors } from "@/components/radiology/zai-workspace/multi-study-findings-editor";
import { impressionProvenanceIsRadiologistManual } from "@/lib/impressionProvenance";
import {
  canForceReleaseStudyLock,
  canTrialEditSignedReport,
  defaultReadingQueueDatePreset,
  visibleTabRefetchInterval,
} from "@/lib/workspaceGuards";
import {
  extractLinkedStudyFromStructuredJson,
  findingsSectionFromStudy,
  linkedStudyPayload,
} from "@/lib/multiStudyReport";
import { useIsTabVisible } from "@/hooks/useIsTabVisible";
import { InterruptChannelCard } from "@/components/radiology/zai-workspace/interrupt-card";
import { QuickSelectEditor } from "@/components/radiology/zai-workspace/quick-select-editor";
import { MergePreviewDialog } from "@/components/radiology/zai-workspace/merge-preview-dialog";
import { OwnershipTracePanel } from "@/components/radiology/zai-workspace/ownership-trace-panel";
import { ConfirmOverwriteDialog } from "@/components/radiology/zai-workspace/confirm-overwrite-dialog";
import { SaveAsFormatDialog } from "@/components/radiology/zai-workspace/save-as-format-dialog";
import { editorHasMeaningfulReportText, resolvePrintedReportTitle } from "@/lib/zai-workspace/fullReportFormat";
import {
  buildCareReportFormatIdentity,
  extractCareReportFormatIdentity,
  resolveNormalBootstrapFormat,
} from "@/lib/zai-workspace/normalBootstrap";
import { reportFormatRevision } from "@/lib/zai-workspace/fullReportBaseline";
import { reconstructStartingCanvasBaseline } from "@/lib/zai-workspace/startingCanvasHighlight";
import { ChocolateBoxMacros } from "@/components/radiology/zai-workspace/chocolate-box-macros";
import { MacroEditorDialog } from "@/components/radiology/zai-workspace/macro-editor-dialog";
import { MacroPromptPopover } from "@/components/radiology/zai-workspace/macro-prompt-popover";
import { CriticalSlaTimer } from "@/components/radiology/zai-workspace/critical-sla-timer";
import { CommandPalette as ZaiCommandPalette } from "@/components/radiology/zai-workspace/command-palette";

// ─── Copilot plug-in modules (side-effect imports — register all 19) ──────────

import {
  Lock, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2, Link2,
} from "lucide-react";

/** Stable empty catalog — avoid `?? []` props that retrigger anatomy effects every render. */
const EMPTY_QUICK_FINDINGS: QuickFinding[] = [];


import type { RadiologyWorkspaceVm } from "./types";

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
      <ZaiCommandPalette />
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
      <InterruptChannelCard />
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
          <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 via-emerald-600 to-emerald-700 px-4 py-2 text-white shadow-2xl shadow-emerald-500/40 ring-2 ring-emerald-300/50">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-sm font-semibold">
              {allowEditSigned ? "Trial edit unlocked" : "Report signed & delivered"}
            </span>
            {!allowEditSigned && canTrialEditSignedReport(isOwner, role) && (
              <button
                type="button"
                className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-white/30"
                data-testid="trial-edit-signed-report"
                title="Unlock editors to fix this signed report (trial)"
                onClick={() => {
                  setAllowEditSigned(true);
                  useWorkspace.setState({ isFinalized: false });
                  toast({
                    title: "Editing unlocked",
                    description: "Trial mode — edit, save draft, and re-finalize when ready.",
                  });
                }}
              >
                Edit report
              </button>
            )}
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
          <div className="text-xs font-semibold text-amber-800">Unsaved draft found</div>
          <div className="text-[10px] text-amber-700 mt-1">A local backup is newer than the server draft.</div>
          <div className="flex gap-1.5 mt-2">
            <Button size="sm" className="h-6 text-[10px]" onClick={() => { const r = draftBackup.peek(); if (r) useWorkspace.getState().setEditorContent({ findings: r.rawFindings ?? "", impression: normalizeImpressionLines(r.impression).join("\n"), recommendation: r.recommendation ?? "", technique: r.technique ?? "", clinicalHistory: r.clinicalHistory ?? "" }); }}>Restore</Button>
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
                procedureDate: new Date().toISOString().slice(0, 10),
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
