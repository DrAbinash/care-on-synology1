/**
 * WorkspaceTopBar — Phase 4 JSX extraction (behavior unchanged).
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
          {criticalSlaStartedAt && <CriticalSlaTimer />}
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
