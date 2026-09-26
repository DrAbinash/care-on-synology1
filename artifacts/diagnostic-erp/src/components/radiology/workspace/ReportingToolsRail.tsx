/**
 * ReportingToolsRail — Phase 4 JSX extraction (behavior unchanged).
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
                              <BrainMeasuresStrip
                                disabled={isLocked || isFinalized}
                                region={studySetup.matchedStudyRegion ?? "Brain"}
                              />
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
