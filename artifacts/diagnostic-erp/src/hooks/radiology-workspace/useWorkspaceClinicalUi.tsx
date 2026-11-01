/**
 * Clinical UI orchestration for RadiologyReportingWorkspace.
 * Phase 4 — composition root for domain hooks + view bindings.
 * Domain hooks are invoked here in the preserved page order.
 */

/**
 * RadiologyReportingWorkspace — the NEW modular workspace.
 * Replaces the old 7,886-line page (snapshot retained in git history).
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
import { regionIdentityConflictMessage } from "@/lib/regionTransition";
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
import { resolveOpenStudyIdentity } from "@/lib/openStudyIdentity";
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
  canVerifyReport, radiologyReportBackupKey,
} from "@/lib/workspaceReportState";
import { type DispatchResult } from "@/lib/workspaceCommands";
import { createEnsureDraftOnce, isMeaningfulReportEdit } from "@/lib/ensureDraftOnce";
import { leaveDirtyStudy, type LeaveChoice } from "@/lib/leaveDirtyStudy";
import { deriveStudyReadyStatus } from "@/lib/studyReadyStatus";
import {
  stageShadowProposal,
  materializeStagedProposals,
  proposalAddsNothing,
  type StagedAiProposal,
} from "@/lib/stagedAiProposals";
import { pendingReportInserts, unfitReportInserts, type AiReportDraftRow } from "@/lib/aiDraftBinding";
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
import { useSmartDictation } from "@/hooks/useSmartDictation";
import { smartDictationSupportedForStudy } from "@/lib/voiceReportComposer/smartDictationSession";
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
  isMriDorsoLumbarReportingContext,
} from "@/lib/mriSpineCanvasRegions";
import {
  isBrainMeasuresReportingContext,
  isMriBrainReportingContext,
  isXrayCervicalReportingContext,
  isXrayChestReportingContext,
  isXrayLsReportingContext,
} from "@/lib/reportingStudyContext";
import {
  cervicalImpressionOrderWarnings,
  cervicalTextContradictions,
  cervicalUnvisualizedLevelClaims,
} from "@/lib/xrayCervicalContradictions";
import { parseXrayCervicalViews } from "@/lib/xrayCervicalViews";
import { dorsoLumbarTextContradictions } from "@/lib/mriDorsoLumbarValidation";
import { isDorsoLumbarDedicated } from "@/lib/mriDorsoLumbarCatalog";
import {
  lsImpressionOrderWarnings,
  lsTextContradictions,
} from "@/lib/xrayLsContradictions";
import { parseXrayLsViews } from "@/lib/xrayLsViews";
import { parseLsNumberingFromText } from "@/lib/xrayLsNumbering";
import { buildLumbarLevelApplyBundle, deriveCanvasNarrativeState, ledgerSeverityContradiction, structuredCanalApContradiction } from "@/lib/mriLumbarLevelState";
import { brainTextContradictions } from "@/lib/mriBrainContradictions";
import {
  brainVascularContradictions,
  vascularIsScreeningOnly,
} from "@/lib/mriBrainVascularValidation";
import { orderBrainVascularImpressionLines } from "@/lib/mriBrainVascularImpression";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { chestTextContradictions } from "@/lib/xrayChestContradictions";
import { parseXrayChestViews } from "@/lib/xrayChestViews";
import { buildCervicalLevelApplyBundle } from "@/lib/mriCervicalLevelState";
import { buildDorsalLevelApplyBundle } from "@/lib/mriDorsalLevelState";
import { lumbarTextContradictions, dorsalTextContradictions } from "@/lib/mriSpineContradictions";
import { dorsalObservationReviewWarnings, isDefaultDorsalNumbering } from "@/lib/mriDorsalNumbering";
import { screeningTextContradictions } from "@/lib/mriSpineScreening";
import {
  SPINE_SEQUENCE_KEYS,
  deriveSpineSequencesAvailable,
  type SpineSequencesAvailable,
} from "@/lib/mriSpineSequences";
import { isNonStandardNumbering } from "@/lib/mriSpineNumbering";
import { billingRolesMayApply, resolveScreeningRoles } from "@/lib/mriSpineScreeningRoles";
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
import { clinicalHistoryRefusal } from "@/lib/reportingWorkspaceShortcuts";
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
import { useTriggerAiImpression } from "@/hooks/radiology-workspace/useTriggerAiImpression";
import { useAccordionPropsBuilder } from "@/hooks/radiology-workspace/useAccordionPropsBuilder";
import { useAbnormalPatternSuggestions } from "@/hooks/radiology-workspace/useAbnormalPatternSuggestions";
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
import { contributionProtected, selectedQuickFindingIds } from "@/lib/observationSlot";
import { quickFindingClickRoute, quickFindingCrossSectionClash, quickFindingPatch, quickFindingRowBelongsTo, type QuickToggleOutcome } from "@/lib/zai-workspace/quickSelectTilePayload";
import type { QuickSelectParameterValues } from "@/lib/zai-workspace/quickSelectParameterContract";
import { collectCompositionFinalizeGate, extractCareObservationLedger, patchFindingsContributionBlocked } from "@/lib/observationLedger";
import type { TemplateStudyCompatibilityInput } from "@/lib/templateStudyCompatibility";
import {
  provenanceMapToSegments,
  provenanceVisualKind,
  type InsertSource,
} from "@/lib/reportFieldMerge";
import { generateLocalImpression } from "@/lib/generateLocalImpression";
import {
  collectPathologyRecommendationChips,
  collectPathologyImpressionShortcuts,
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
  CONTINUOUS_PRIMARY_MIN_HEIGHT_PX,
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
  INSTANT_REPORT_DEBOUNCE_MS,
  readInstantReportEnabled,
  writeInstantReportEnabled,
} from "@/lib/zai-workspace/instantReport";
import {
  useDebouncedWorkspaceClinicalTexts,
} from "@/lib/zai-workspace/workspaceClinicalTexts";
import { useKeyedDebouncedValue } from "@/hooks/useDebouncedValue";
import { getFindingsCompletionPct, runLintRules, shouldPreloadNext, studyPriorityRank } from "@/lib/zai-workspace/types";
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
import { MergePreviewDialog } from "@/components/radiology/zai-workspace/merge-preview-dialog";
import { OwnershipTracePanel } from "@/components/radiology/zai-workspace/ownership-trace-panel";
import { ConfirmOverwriteDialog } from "@/components/radiology/zai-workspace/confirm-overwrite-dialog";
import { SaveAsFormatDialog } from "@/components/radiology/zai-workspace/save-as-format-dialog";
import { reportBodyAllowsNormalBootstrap, resolveCanonicalStudyTitle, resolvePrintedReportTitle } from "@/lib/zai-workspace/fullReportFormat";
import {
  billedNameFromWorklistRow,
  billedStudyContextForNormal,
  buildCareReportFormatIdentity,
  extractCareReportFormatIdentity,
  quickNormalOutcomeMessage,
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
import "@/lib/copilotAiModule";
import "@/lib/copilotComparisonModule";
import "@/lib/copilotMeasurementModule";
import "@/lib/copilotUsgAbdomenModule";
import "@/lib/copilotUsgObstetricModule";
import "@/lib/copilotUsgThyroidModule";
import "@/lib/copilotUsgBreastModule";
import "@/lib/copilotUsgScrotumModule";
import "@/lib/copilotUsgDopplerModule";
import "@/lib/copilotUsgKidneyModule";
import "@/lib/copilotUsgLiverModule";
import "@/lib/copilotUsgGallbladderModule";
import "@/lib/copilotUsgPelvisModule";
import "@/lib/copilotUsgTvsModule";
import "@/lib/copilotUsgGrowthModule";
import "@/lib/copilotUsgAnomalyModule";
import "@/lib/copilotCriticalModule";
import "@/lib/copilotRecommendationModule";
import "@/lib/copilotUsgCompanionModule";

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

/**
 * What the instant report watches: the Findings the radiologist sees and the ledger
 * rows behind them. Deliberately not the Impression or the Technique — a hand-written
 * Conclusion must not be the thing that triggers a rebuild, and the store already
 * holds for exactly that case, so watching it would only make the banner flicker.
 */
function instantReportSignature(s: WorkspaceStore): string {
  return `${s.findingsText}\u0000${s.appliedPathologyPatches
    .map((p) => `${p.id}:${p.stale ? 1 : 0}:${p.templates.findings ?? ""}`)
    .join("\u0001")}`;
}


export function useWorkspaceClinicalUi({ studyId }: { studyId?: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { widthPx: viewportWidthPx } = useConstrainedReportingViewport();
  // FEW-CLICKS (pass 2): the continuous Findings+Impression cockpit needs to
  // know the viewport is TALL enough to seat two editors — width alone can't
  // answer that. Same listener pattern as the width, kept here beside it.
  const [viewportHeightPx, setViewportHeightPx] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : CONTINUOUS_PRIMARY_MIN_HEIGHT_PX,
  );
  useEffect(() => {
    const sync = () => setViewportHeightPx(window.innerHeight);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const isOnline = useOnlineStatus();
  const qc = useQueryClient();

  // Panel refs + layout focus live in useWorkspaceLayout (Phase 2).
  // Draft hydrate marker lifted for useReportingStudySetup call order (Phase 3).
  const [draftHydratedStudyId, setDraftHydratedStudyId] = useState<number | null>(null);
  const setLastSavedAtRef = useRef<(d: Date | null) => void>(() => {});
  const [appliedNormalFormatName, setAppliedNormalFormatName] = useState<string | null>(null);
  const [normalSkipReason, setNormalSkipReason] = useState<string | null>(null);
  const [bootstrapAppliedThisOpen, setBootstrapAppliedThisOpen] = useState(false);
  const [stagedAiProposals, setStagedAiProposals] = useState<StagedAiProposal[]>([]);
  const [linkStudyOpen, setLinkStudyOpen] = useState(false);
  // ohifUnavailable owned by useOhifViewerBridge (Phase 4)
  const commandDispatcherRef = useRef<{ dispatch: (cmd: string) => DispatchResult } | null>(null);
  const canVerifyRef = useRef(false);
  const verifyActionRef = useRef<(() => void) | null>(null);
  // Few-clicks — Ctrl+P's print action, late-bound from useWorkspaceExportShare
  // (same ref pattern as verifyActionRef: the dispatcher stays stable while the
  // print callback identity moves with its hook).
  const printActionRef = useRef<(() => void) | null>(null);
  // linkedReportIdRef late-bound by useWorkspaceExportShare; early shell for reportComposer.
  const linkedReportIdRef = useRef<number | null>(null);
  const openLegacyTabRef = useRef<(tab: LegacyBoxTab) => void>(() => {});
  const openReportingToolsRef = useRef<(
    tab: ReportingToolsTab,
    source?: QuickInsertSource,
  ) => void>(() => {});
  const [legacyTab, setLegacyTab] = useState<LegacyBoxTab | null>(null);
  const [reportingToolsTab, setReportingToolsTab] =
    useState<ReportingToolsTab>("quick-insert");
  const [quickInsertSource, setQuickInsertSource] =
    useState<QuickInsertSource>("quick-select");
  const [whatsappShareOpen, setWhatsappShareOpen] = useState(false);
  const [headingCase, setHeadingCase] = useState<ReportHeadingCase>("all_caps");
  const [sectionSpacing, setSectionSpacing] = useState<ReportSectionSpacing>("spaced");
  const [impressionStyle, setImpressionStyle] = useState<ReportImpressionStyle>("bulleted");
  const [showLetterpadHeader, setShowLetterpadHeader] = useState(true);
  const [allowEditSigned, setAllowEditSigned] = useState(false);

  // Sync report preferences from server (heading case, spacing, impression, header toggle).
  // The server is the source of truth; local state is the working copy for the session.
  const [previewLayoutOverride, setPreviewLayoutOverride] = useState<ReportLayoutKey | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [confirmImpressionReplace, setConfirmImpressionReplace] = useState(false);
  const [sendHopeBusy, setSendHopeBusy] = useState(false);
  // Radiologist-local demography overrides — never written to patient master.
  const [demographyOverrides, setDemographyOverrides] = useState<Partial<ReportDemography>>({});

  // ─── Main-pane progressive disclosure (Phase 2 hook) ─────────────────────
  const {
    sectionCollapsePrefs, setSectionCollapsePrefs,
    activeReportSection, setActiveReportSection,
    studyDetailsOpen, setStudyDetailsOpen,
    startingCanvasExpanded, setStartingCanvasExpanded,
    lastClinicalTarget, setLastClinicalTarget,
    activeFindingsTool, activeFindingsAnatomy, setActiveFindingsAnatomy,
    sectionWithCaret,
    activateReportSection, selectFindingsTool,
    focusClinicalEditor, focusReportField,
    enterReportingFocusModeRef, enterClinicalEditorFocusRef, exclusiveReportSectionsRef,
  } = useReportSectionChrome();
  const [abnormalHighlight, setAbnormalHighlight] = useState<AbnormalHighlightState | null>(null);
  // Mouse-first personal macro templates (local workstation library).
  const [personalTemplates, setPersonalTemplates] = useState<PersonalReportTemplate[]>(() =>
    readPersonalReportTemplates(typeof window !== "undefined" ? window.localStorage : null),
  );
  const [templateRailCollapsed, setTemplateRailCollapsed] = useState(false);

  // Structured Normal/Abnormal section cards (legacy parity)
  const [useStructured, setUseStructured] = useState(false);
  const [findingsMap, setFindingsMap] = useState<Record<string, { normal: boolean; text: string }>>({});
  const startReportUndoRef = useRef<{
    technique: string;
    findings: string;
    impression: string;
    recommendation: string;
    clinicalHistory: string;
    findingsMap: Record<string, { normal: boolean; text: string }>;
    useStructured: boolean;
    selectedTemplateId: number | null;
  } | null>(null);
  const [canUndoStartReport, setCanUndoStartReport] = useState(false);
  const pendingStructuredPopulateRef = useRef(false);
  /** Normal auto-bootstrap decision marker — one decision per studyId, ever. */
  const normalBootstrapDoneRef = useRef<number | null>(null);
  const [structuredValues, setStructuredValues] = useState<StructuredValues>({});
  const structuredTouchedRef = useRef(false);
  const structuredFormatDrivingRef = useRef(false);
  /** The exact findingsMap object the structured generator last produced.
   *  Reference identity is the sync gate: the generator's own snapshot must
   *  not be flattened back over the merged findings text, but every LATER
   *  findingsMap write (a card toggle, a restore, Load-all-normals) is a
   *  clinician edit and MUST sync. The old sticky boolean never reset after
   *  the first structured Generate, so card edits silently stopped syncing
   *  — and stopped marking the report dirty — for the rest of the session. */
  const generatedFindingsMapRef = useRef<Record<string, { normal: boolean; text: string }> | null>(null);
  const lastStructuredFindingsLinesRef = useRef<Record<string, string>>({});
  const [queueModality, setQueueModality] = useState<ReadingQueueModality>(() => {
    const resolved = resolveReadingQueueModality({
      search: typeof window !== "undefined" ? window.location.search : "",
      storage: typeof window !== "undefined" ? window.localStorage : null,
      fallback: "MR",
    });
    return resolved.modality;
  });
  const modalityDeepLinkAppliedRef = useRef(false);
  const [datePreset, setDatePreset] = useState<ReadingQueueDatePreset>(() => {
    try {
      const stored = localStorage.getItem("care_reading_queue_date");
      if (stored === "today" || stored === "yesterday" || stored === "all" || stored === "today-yesterday") return stored;
      return defaultReadingQueueDatePreset(stored);
    } catch { /* ignore */ }
    return defaultReadingQueueDatePreset(null);
  });
  const [queueSort, setQueueSort] = useState<ReadingQueueSort>(() => {
    try {
      const stored = localStorage.getItem("care_reading_queue_sort");
      if (stored === "queue" || stored === "name-az") return stored;
    } catch { /* ignore */ }
    return "queue";
  });
  const [patientJumpFilter, setPatientJumpFilter] = useState("");
  const queueDateRange = useMemo(() => {
    if (datePreset === "today") return { from: todayISO(), to: todayISO() };
    if (datePreset === "yesterday") return { from: daysAgoISO(1), to: daysAgoISO(1) };
    if (datePreset === "today-yesterday") return { from: daysAgoISO(1), to: todayISO() };
    return { from: "", to: "" };
  }, [datePreset]);

  // ─── Session ──────────────────────────────────────────────────────────────
  // Re-read every 5 min so a refreshed token / role change is picked up without full reload.
  const session = useMemo(() => readStaffSession(), []);
  const [sessionTick, setSessionTick] = useState(0);
  const isTabVisible = useIsTabVisible();
  useEffect(() => {
    if (!isTabVisible) return;
    const id = setInterval(() => setSessionTick(t => t + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, [isTabVisible]);
  const sessionFresh = useMemo(() => { void sessionTick; return readStaffSession(); }, [sessionTick]);
  const myUserId = sessionFresh?.user?.id ? Number(sessionFresh.user.id) : null;
  const myName = sessionFresh?.user?.name ?? null;
  const role = normalizeRole(sessionFresh?.user?.role ?? "");
  const isOwner = isOwnerRole(sessionFresh);

  // ─── Z.ai workspace store (new features) ──────────────────────────────────
  // NOTE: use `useWorkspace.getState()` inside callbacks; never subscribe without a selector.
  const studies = useWorkspace((s: WorkspaceStore) => s.studies);
  const activeStudyId = useWorkspace((s: WorkspaceStore) => s.activeStudyId);
  const selectStudy = useWorkspace((s: WorkspaceStore) => s.selectStudy);
  const setStudies = useWorkspace((s: WorkspaceStore) => s.setStudies);
  // Clinical body texts: FindingsEditor / ConnectedFindingsHighlightEditor
  // subscribe locally. The shell uses a debounced mirror so typing does not
  // re-render worklist + viewer + copilot on every keystroke. Persistence
  // paths must call readWorkspaceClinicalTexts() — never this mirror alone.
  const {
    findingsText,
    impressionText,
    recommendationText,
    techniqueText,
    clinicalHistoryText,
    findingsProvenance,
    impressionProvenance,
    techniqueProvenance,
  } = useDebouncedWorkspaceClinicalTexts(300);
  // The export hook's print-body memo pairs the structured map with that
  // 300 ms-debounced text mirror; feeding it the LIVE map made every card
  // click recompute the print body instantly with a mixed-staleness pair
  // (fresh map + up-to-300 ms-old text), so the in-sync guard flapped to the
  // raw-text branch and the preview query churned on each card edit. The map
  // and the useStructured flag enter the SAME 300 ms pipeline as the texts —
  // keyed on the open study so a switch adopts the next study's values
  // immediately, exactly like the mirror's own study-switch flush. The editor
  // cards keep rendering from the live values; only the print path debounces.
  const studyMirrorKey = String(studyId ?? "");
  const debouncedFindingsMap = useKeyedDebouncedValue(findingsMap, studyMirrorKey, 300);
  const debouncedUseStructured = useKeyedDebouncedValue(useStructured, studyMirrorKey, 300);
  const impressionNeedsRefresh = useWorkspace((s: WorkspaceStore) => s.impressionNeedsRefresh);
  // MRI Lumbar V3: the spine platform's own store slices (single source — the
  // panels render these and the validators read the same values).
  const lumbarNumbering = useWorkspace((s: WorkspaceStore) => s.lumbarNumbering);
  const dorsalNumbering = useWorkspace((s: WorkspaceStore) => s.dorsalNumbering);
  const spineSequencesAvailable = useWorkspace((s: WorkspaceStore) => s.sequencesAvailable);
  const spineScreening = useWorkspace((s: WorkspaceStore) => s.screening);
  const dorsoLumbarNumbering = useWorkspace((s: WorkspaceStore) => s.dorsoLumbarNumbering);
  const studyComposition = useWorkspace((s: WorkspaceStore) => s.studyComposition);
  const impressionOrderFrozen = useWorkspace((s: WorkspaceStore) => s.impressionOrderFrozen);
  const ownershipReviewWarnings = useWorkspace((s: WorkspaceStore) => s.ownershipReviewWarnings);
  const ledgerHydrationWarning = useWorkspace((s: WorkspaceStore) => s.ledgerHydrationWarning);
  const appliedPathologyPatches = useWorkspace((s: WorkspaceStore) => s.appliedPathologyPatches);
  const vascularTechnique = useWorkspace((s: WorkspaceStore) => s.vascularTechnique);
  const lastPatchSnapshot = useWorkspace((s: WorkspaceStore) => s.lastPatchSnapshot);
  const activeAnchor = useWorkspace((s: WorkspaceStore) => s.activeAnchor);
  const selectedObservationId = useWorkspace((s: WorkspaceStore) => s.selectedObservationId);
  const coverageMarks = useWorkspace((s: WorkspaceStore) => s.coverageMarks);
  const appliedFormatReportTitle = useWorkspace((s: WorkspaceStore) => s.appliedFormatReportTitle);
  const appliedFormatName = useWorkspace((s: WorkspaceStore) => s.appliedFormatName);
  const reportFormatCount = useWorkspace((s: WorkspaceStore) => s.reportFormats.length);
  const isFinalized = useWorkspace((s: WorkspaceStore) => s.isFinalized);
  const linkedStudy = useWorkspace((s: WorkspaceStore) => s.linkedStudy);
  const primaryFindingsSection = useWorkspace((s: WorkspaceStore) => s.primaryFindingsSection);
  const isDirty = useWorkspace((s: WorkspaceStore) => s.isDirty);
  const preloadTriggered = useWorkspace((s: WorkspaceStore) => s.preloadTriggered);
  const criticalSlaStartedAt = useWorkspace((s: WorkspaceStore) => s.criticalSlaStartedAt);
  const completedCount = useWorkspace((s: WorkspaceStore) => s.completedStudyIds.size);
  const sessionStartedAt = useWorkspace((s: WorkspaceStore) => s.sessionStartedAt);
  const fatigueCardDismissed = useWorkspace((s: WorkspaceStore) => s.fatigueCardDismissed);

  // ─── Existing Care hooks (the wiring contract) ─────────────────────────────
  // 1. Workflow (queue, navigation, parked, history)
  // Orthanc C-FIND on every 30s poll made the left Reading Queue feel stuck.
  // Routine date presets browse Postgres only. Orthanc turns on only when the
  // radiologist types a patient/accession jump search (archive lookup).
  const workflow = useReportingWorkflow(studyId, {
    myUserId,
    myName,
    modalityFilter: queueModality,
    dateFrom: queueDateRange.from,
    dateTo: queueDateRange.to,
    search: patientJumpFilter,
    searchOrthanc: readingQueueShouldSearchOrthanc({
      datePreset,
      search: patientJumpFilter,
    }),
  });

  // Honour ?modality= deep links once: persist normalized choice + refresh queue.
  useEffect(() => {
    if (modalityDeepLinkAppliedRef.current) return;
    modalityDeepLinkAppliedRef.current = true;
    const resolved = resolveReadingQueueModality({
      search: window.location.search,
      storage: window.localStorage,
      fallback: "MR",
    });
    if (!resolved.fromDeepLink) return;
    setQueueModality(resolved.modality);
    writeStoredReadingQueueModality(window.localStorage, resolved.modality);
    workflow.refreshQueue();
  }, [workflow]);

  // ─── Per-study detail: authoritative signed status + canonical demography ──
  // Heavy dicomMetadata is omitted from the polled queue list, so this is the
  // only per-study fetch that carries both. It used to be declared 1,500 lines
  // further down, after every lock decision below, and typed as
  // `{ dicomMetadata?, age? }` — which threw away the `status` the server
  // already returns (`pacsWorklistDetailFields.ts:22`) and left the locks
  // reading `workflow.currentRow.status` instead.
  //
  // That queue row is not a safe source for a signed-state lock: the queue query
  // is keyed on the filter, not on `studyId`, it polls every 30 s with
  // `placeholderData: (prev) => prev`, and it is null for any study outside the
  // currently fetched filter. A report signed elsewhere (command center,
  // report list, another workstation) therefore left this workspace editable
  // until the poll happened to bring the row back. This query is keyed on
  // `studyId` and refetches on study change, so it is the canonical source.
  const worklistDetailQ = useQuery<{
    id?: number;
    status?: string | null;
    dicomMetadata?: string | Record<string, unknown> | null;
    age?: string | null;
    sex?: string | null;
    studyDate?: string | null;
    studyDescription?: string | null;
    referringDoctor?: string | null;
    studyId?: number | null;
    patientId?: number | null;
    /** The patients-master UHID, joined server-side through `patientId`. */
    uhid?: string | null;
    patientName?: string | null;
    accessionNumber?: string | null;
    studyInstanceUID?: string | null;
    modality?: string | null;
    // Billed catalogue test behind the linked study (server joins it on the
    // by-id read) — the queue row is null whenever the open study falls
    // outside the reading-queue filter, and the billed-test hint keeps its
    // precedence over the DICOM description wherever the report is opened.
    testId?: number | null;
    testName?: string | null;
    billedTestName?: string | null;
  }>({
    queryKey: ["pacs-worklist-detail", studyId],
    queryFn: () => api.get(`/api/radiology/pacs-worklist/${studyId}`),
    enabled: Number.isFinite(studyId) && (studyId as number) > 0,
    staleTime: 60_000,
    retry: false,
  });
  /**
   * Signed per the database for THIS study. Falls back to the queue row only
   * while the detail query is in flight, so a lock is never briefly lifted on
   * mount. `DELIVERED` counts as signed: it is downstream of REPORT_FINAL and
   * the queue-based lock already treated it as closed for locking purposes.
   */
  const authoritativeStatus = worklistDetailQ.data?.status ?? workflow.currentRow?.status ?? null;
  const studyIsSignedElsewhere = authoritativeStatus === "REPORT_FINAL" || authoritativeStatus === "DELIVERED";

  /**
   * Which study this report is about — for the viewer, the image rail and every
   * image attachment. The queue row answers to the reading-queue FILTER (modality,
   * date preset) and is null for a report opened by link, so identity comes from
   * the same by-id read that decides the lock and the signed status above.
   * Navigation (Prev/Next/position) still walks the filtered queue; only identity
   * is separated here.
   */
  const reportIdentity = useMemo(
    () => resolveOpenStudyIdentity({
      studyId,
      detail: worklistDetailQ.data,
      queueRow: workflow.currentRow,
    }),
    [studyId, worklistDetailQ.data, workflow.currentRow],
  );

  // 2. Study lock (claim/heartbeat/release)
  //
  // P0-2 — gated on the study, never on the reading-queue row. `currentRow` is a
  // row of the FILTERED queue (modality preset, date preset, assignment scope),
  // so it is null for a report opened by link, from the Study Queue Report
  // button, or under a filter that excludes its modality. Gating the lock on it
  // meant such a study never claimed or heartbeated at all — measured in the
  // browser audit on worklist 622 opened with `?modality=CT`: a 97.6-second
  // observation produced zero lock traffic for it while the in-filter study
  // heartbeated, and the two consoles then both answered 200 and the second
  // erased the first. The identity that decides this is the by-id worklist read
  // (`worklistDetailQ`, the same authority `reportIdentity` and
  // `authoritativeStatus` above already use), which survives the filter.
  const studyLock = useStudyLock(studyId, {
    enabled: Boolean(
      reportIdentity
      && (allowEditSigned || !studyIsSignedElsewhere),
    ) as any,
  });
  const isLocked = studyLock.status === "locked-by-other";
  const lockLost = studyLock.status === "expired-lost" || studyLock.status === "connection-lost";
  /** Trial-phase unlock: edit a signed report in place (editors + draft save). */
  const signedContentLocked = (isFinalized || studyIsSignedElsewhere) && !allowEditSigned;
  const contentLocked = isLocked || signedContentLocked;

  // 3. Draft ID (server-side persistence)
  const {
    draftId,
    existingDraft,
    captureSavedDraft,
    isLoadingExistingDraft,
    draftReadPending,
    draftReadSucceeded,
    existingDraftError,
    refetchExistingDraft,
  } = useRadiologyDraftId(studyId ?? null);

  // 4. Local draft backup (30-snapshot localStorage)
  const draftBackup = useLocalDraftBackup({
    storageKey: radiologyReportBackupKey(studyId),
    snapshot: {
      at: Date.now(),
      clinicalHistory: clinicalHistoryText,
      technique: techniqueText,
      rawFindings: findingsText,
      impression: [impressionText],
      recommendation: recommendationText,
    },
    enabled: allowEditSigned || !studyIsSignedElsewhere,
    // Structured cards are unsaved work too: they ride in `extra` so the
    // backup captures the cards and the mode flag that made them the report,
    // and Restore reopens the workspace exactly as it was — cards, not just
    // prose. `undefined` values are dropped by JSON.stringify, so a
    // non-structured session writes the exact legacy envelope.
    extra: {
      findingsSections: useStructured ? findingsMap : undefined,
      useStructured: useStructured || undefined,
    },
  });

  // 5. Finalize flow (promise-based sign dialog)
  const finalizeFlow = useFinalizeFlow();

  // ─── Layout prefs / panel focus (Phase 2 hook) ───────────────────────────
  const {
    embeddedViewerRef, leftPanelRef, rightPanelRef, templatePanelRef,
    viewerPanelRef, reportPanelRef, paneManualOverrideRef,
    layoutPrefs, setLayoutPrefs, layoutMode, showEmbeddedViewer,
    exclusiveReportSections, continuousPrimarySections, compactAccordion, setLayoutMode,
    viewerColumnExpanded, setViewerColumnExpanded,
    reportImagesOpen, setReportImagesOpen,
    leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed,
    captureBusy, setCaptureBusy, keyImageFilterObsId, setKeyImageFilterObsId,
    viewerFocusMode, setViewerFocus,
    enterReportingFocusMode, enterClinicalEditorFocus, enterViewerPaneFocus,
    handleOuterPanelLayout,
  } = useWorkspaceLayout({
    myUserId,
    studyId,
    modality: workflow.currentRow?.modality,
    viewportWidthPx,
    viewportHeightPx,
    enterReportingFocusModeRef,
    enterClinicalEditorFocusRef,
    exclusiveReportSectionsRef,
  });

  // ─── Report preferences sync (server → local state) ───────────────────────
  // Fetch once on mount; headingCase, sectionSpacing, impressionStyle, and
  // showLetterpadHeader are kept in sync with the server row.
  const prefsSyncedRef = useRef(false);
  useQuery({
    queryKey: ["report-prefs-sync"],
    queryFn: async () => {
      const prefs = await api.get("/api/radiology/report-generator/preferences") as Record<string, unknown>;
      if (!prefs) return null;
      if (prefs.headingCase) setHeadingCase(prefs.headingCase as ReportHeadingCase);
      if (prefs.sectionSpacing) setSectionSpacing(prefs.sectionSpacing as ReportSectionSpacing);
      if (prefs.impressionStyle) setImpressionStyle(prefs.impressionStyle as ReportImpressionStyle);
      if (typeof prefs.showLetterpadHeader === "boolean") setShowLetterpadHeader(prefs.showLetterpadHeader);
      return prefs;
    },
    staleTime: 60_000,
    enabled: !prefsSyncedRef.current,
  });
  useEffect(() => { prefsSyncedRef.current = true; }, []);

  // Persist showLetterpadHeader toggle to server (debounced)
  // Send only the changed field; the server's PreferencesSchema requires
  // all fields, but the PUT handler merges with existing row via .set().
  // We send a partial PATCH-style payload — the route's Zod schema has
  // .default() on every field so omitted fields fall through to defaults.
  // However the PUT handler overwrites all fields, so we must send the full
  // set. Read current prefs first, then merge.
  const headerToggleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!prefsSyncedRef.current) return; // don't persist before first sync
    clearTimeout(headerToggleTimerRef.current);
    headerToggleTimerRef.current = setTimeout(async () => {
      try {
        // Fetch current full prefs, merge the toggle, PUT back
        const current = await api.get("/api/radiology/report-generator/preferences") as Record<string, unknown> | null;
        await api.put("/api/radiology/report-generator/preferences", {
          ...current,
          showLetterpadHeader,
        });
      } catch { /* non-fatal */ }
    }, 500);
    return () => clearTimeout(headerToggleTimerRef.current);
  }, [showLetterpadHeader]);
  const quickFindingTemplatesRef = useRef<QuickFinding[]>([]);
  const studyTextOverridesRef = useRef<Map<number, StudyLocalTextOverride>>(new Map());
  const [studyLocalEdit, setStudyLocalEdit] = useState<QuickFinding | null>(null);
  const selectedQuickIdsRef = useRef<Set<number>>(new Set());
  const handleQuickToggleRef = useRef<(finding: QuickFinding, nowSelected: boolean) => void>(() => {});
  /** V-04 post-confirm catalog apply — same fn as Quick Select, distinct ref. */
  const applyCatalogAfterConfirmRef = useRef<(finding: QuickFinding, nowSelected: boolean) => void>(() => {});
  // ─── Voice session (Phase 2 hook — A2/V-04) ──────────────────────────────
  const {
    pacsSettingsRows,
    autoCollapseQueueOnStudyOpen,
    voiceSettings,
    voiceCapabilities,
    voiceSession,
    focusVoiceBar,
    qsExternalSearch,
    setQsExternalSearch,
    voiceParkReasonRef,
    voiceComposerComposeRef,
  } = useVoiceReporting({
    studyId,
    allowEditSigned,
    useStructured,
    isFinalized,
    studyLockStatus: studyLock.status,
    worklistStatus: workflow.currentRow?.status,
    focusReportField,
    embeddedViewerRef,
    rightPanelRef,
    commandDispatcherRef,
    canVerifyRef,
    openLegacyTabRef,
    quickFindingTemplatesRef,
    selectedQuickIdsRef,
    handleQuickToggleRef,
    applyCatalogAfterConfirmRef,
  });

  // 7. Copilot learning + prefs
  const { prefs: copilotPrefs } = useCopilotPrefs();
  const copilotLearning = useCopilotLearning(copilotPrefs.learning);

  // 8. Palette prefs + macro recents
  const { recent: paletteRecent, favourites: paletteFavourites, markRecent: markPaletteRecent, toggleFav: togglePaletteFavourite } = useRadiologyPalettePrefs();
  const { recent: macroRecentIds, markRecent: markMacroRecent } = useFindingsMacroRecents();

  // 9. Reading session (auto-advance toggle)
  const [readingSession, setReadingSession] = useState(() => loadReadingSession());

  // Legacy clinic Quick Select + critical checklist
  const [selectedQuickIds, setSelectedQuickIds] = useState<Set<number>>(() => new Set());
  /**
   * The Clinic Quick Select panel's side row. Starts UNANSWERED.
   *
   * It used to start "left", measured on a fresh synthetic study in the browser:
   * the panel opened with Left lit and nobody had touched it. That value is not
   * cosmetic — `handleQuickToggle` passes it as the resolved side for every box
   * clicked from the panel and from voice, so tile #397 "Renal calculus"
   * (`properties:"side"`, no dialog questions) wrote "Echogenic renal calculus in
   * the LEFT kidney with posterior acoustic shadowing." into Findings and "Renal
   * calculus in the left kidney." into the Impression for a stone that had never
   * been laterised. #414 "Hip effusion" and #464 "Spiculated mass" are the same
   * shape.
   *
   * The Quick Select strip already refused this (`useState<Side | "">("")`,
   * quick-select-strip.tsx:297) and the store's parameter contract enforces it at
   * the shared boundary — `unresolvedQuickSelectParameters` returns "side" and
   * `applyPathologyOverlay` answers "refused" with a toast that says what to
   * choose. Emptying this default makes the panel and voice obey the same rule
   * instead of quietly supplying the guess the boundary exists to reject.
   */
  const [quickSide, setQuickSide] = useState<Side | "">("");
  const lastQuickRenderedRef = useRef<Map<number, PathologyIncoming>>(new Map());
  const quickSideMountedRef = useRef(false);
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [checklistComm, setChecklistComm] = useState({ phoned: false, annotated: false, dispatched: false });

  // Auto-link toast when worklist entry was auto-linked to a billed study
  const { data: workspaceEntry } = useQuery<{
    autoLinkMeta?: { reason?: string; studyId?: number; matchScore?: number };
  }>({
    queryKey: ["workspace-entry", studyId],
    queryFn: () => api.get(`/api/internal/radiology/worklist/${studyId}`),
    enabled: !!studyId,
  });
  const autoLinkNotifiedRef = useRef<number | null>(null);
  useEffect(() => {
    const meta = workspaceEntry?.autoLinkMeta;
    if (!meta || !studyId) return;
    if (meta.reason !== "auto-linked to billed study") return;
    if (autoLinkNotifiedRef.current === studyId) return;
    autoLinkNotifiedRef.current = studyId;
    toast({
      title: "Billed study linked",
      description: `Auto-linked to study #${meta.studyId}${meta.matchScore ? ` (${meta.matchScore} match)` : ""}.`,
    });
  }, [workspaceEntry?.autoLinkMeta, studyId, toast]);

  // Arrival + wrong-patient cross-check (queue identity at transition vs loaded row).
  useEffect(() => {
    const row = workflow.currentRow;
    if (!row?.id) return;
    const expectation = workflow.markArrived(row.id);
    if (
      expectation && expectation.patientId != null
      && row.patientId != null
      && expectation.patientId !== row.patientId
    ) {
      toast({
        title: "Patient identity mismatch",
        description: `The queue listed patient #${expectation.patientId} for this study, but the loaded study belongs to patient #${row.patientId}. Verify the patient before reporting.`,
        variant: "destructive",
      });
    }
  }, [workflow.currentRow?.id, workflow.currentRow?.patientId, workflow, toast]);

  // Keep findingsText in sync when structured cards drive the report.
  // The ONLY suppressed update is the generator's own snapshot (reference
  // equality — see generatedFindingsMapRef): its lines were just merged into
  // findingsText with ledger semantics, and flattening the map over them
  // would discard any non-card content the merge preserved. Every other
  // findingsMap change — card toggles, abnormal text, section removal,
  // Load-all-normals, backup restore — flattens into the findings body via
  // setField, which marks the report dirty so navigation warns.
  useEffect(() => {
    if (!useStructured) return;
    if (findingsMap === generatedFindingsMapRef.current) return;
    const text = findingsMapToText(findingsMap);
    if (useWorkspace.getState().findingsText === text) return;
    useWorkspace.getState().setField("findings", text);
  }, [findingsMap, useStructured]);

  // DICOM → protocol / technique / test-name auto-select (legacy chain)
  const studySetupSetters = useMemo(() => ({
    setTechnique: (next: string | ((prev: string) => string)) => {
      const cur = useWorkspace.getState().techniqueText;
      useWorkspace.getState().setField("technique", typeof next === "function" ? next(cur) : next);
    },
    setFindings: (next: string | ((prev: string) => string)) => {
      const cur = useWorkspace.getState().findingsText;
      useWorkspace.getState().setField("findings", typeof next === "function" ? next(cur) : next);
    },
    setImpression: (next: string | ((prev: string) => string)) => {
      const cur = useWorkspace.getState().impressionText;
      useWorkspace.getState().setField("impression", typeof next === "function" ? next(cur) : next);
    },
    setRecommendation: (next: string | ((prev: string) => string)) => {
      const cur = useWorkspace.getState().recommendationText;
      useWorkspace.getState().setField("recommendation", typeof next === "function" ? next(cur) : next);
    },
    setClinicalHistory: (next: string | ((prev: string) => string)) => {
      const cur = useWorkspace.getState().clinicalHistoryText;
      useWorkspace.getState().setField("clinicalHistory", typeof next === "function" ? next(cur) : next);
    },
    mergeTechnique: (incoming: string, source: InsertSource) => {
      useWorkspace.getState().mergeField("technique", incoming, source);
    },
    mergeFindings: (incoming: string, source: InsertSource) => {
      useWorkspace.getState().mergeField("findings", incoming, source);
    },
    mergeImpression: (incoming: string, source: InsertSource) => {
      useWorkspace.getState().mergeField("impression", incoming, source);
    },
    mergeRecommendation: (incoming: string, source: InsertSource) => {
      useWorkspace.getState().mergeField("recommendation", incoming, source);
    },
    setTechniqueIfEmpty: (text: string, source: InsertSource) => {
      useWorkspace.getState().setFieldIfEmpty("technique", text, source);
    },
    setFindingsIfEmpty: (text: string, source: InsertSource) => {
      useWorkspace.getState().setFieldIfEmpty("findings", text, source);
    },
    setImpressionIfEmpty: (text: string, source: InsertSource) => {
      useWorkspace.getState().setFieldIfEmpty("impression", text, source);
    },
    setRecommendationIfEmpty: (text: string, source: InsertSource) => {
      useWorkspace.getState().setFieldIfEmpty("recommendation", text, source);
    },
    replaceTechnique: (text: string, source: InsertSource) => {
      useWorkspace.getState().replaceField("technique", text, source);
    },
    replaceFindings: (text: string, source: InsertSource) => {
      useWorkspace.getState().replaceField("findings", text, source);
    },
    replaceImpression: (text: string, source: InsertSource) => {
      useWorkspace.getState().replaceField("impression", text, source);
    },
    replaceRecommendation: (text: string, source: InsertSource) => {
      useWorkspace.getState().replaceField("recommendation", text, source);
    },
    stampApprovedNormal: (b: { name: string; findings: string; impression: string }) => {
      useWorkspace.getState().stampTemplateApprovedNormal(b);
    },
    readFields: () => {
      const s = useWorkspace.getState();
      return {
        technique: s.techniqueText,
        findings: s.findingsText,
        impression: s.impressionText,
        recommendation: s.recommendationText,
        clinicalHistory: s.clinicalHistoryText,
      };
    },
    readTechniqueProvenance: () => useWorkspace.getState().fieldProvenance.technique ?? EMPTY_FIELD_PROVENANCE,
  }), []);

  const studySetup = useReportingStudySetup({
    studyId,
    // Study context must survive the reading-queue filter. The queue row is
    // null whenever the open study falls outside it (a CT/US/XR study under the
    // default MR queue filter, any deep link, a filter change mid-report), and
    // the whole context layer — region resolution, Quick Select tiles,
    // protocols, normal formats — used to die with it. The by-id worklist
    // detail read (same authority the lock and signed status use) fills the
    // identity-shaped gap while the queue row is absent; the queue row still
    // wins when present so the billed > DICOM hint precedence is unchanged.
    modality: workflow.currentRow?.modality ?? worklistDetailQ.data?.modality ?? null,
    studyDescription: workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription ?? null,
    billedTestName:
      workflow.currentRow?.testName
      || workflow.currentRow?.billedTestName
      || worklistDetailQ.data?.testName
      || worklistDetailQ.data?.billedTestName
      || null,
    bodyPart: (workflow.currentRow as { bodyPart?: string | null } | null)?.bodyPart,
    isLoadingExistingDraft,
    draftHydrated: !!studyId && draftHydratedStudyId === studyId,
    existingDraft,
    disabled: studyLock.status === "locked-by-other",
    setters: studySetupSetters,
    techniqueText,
    techniqueProvenance,
    onToast: (opts) => toast({ title: opts.title, description: opts.description, variant: opts.variant }),
  });

  // Late-bound openStudy for draft leave navigation (assigned below).
  const openStudyRef = useRef<(id: string | number) => void>(() => {});

  const onStudySwitchPageReset = useCallback(() => {
    setFindingsMap({});
    setUseStructured(false);
    startReportUndoRef.current = null;
    setCanUndoStartReport(false);
    setStructuredValues({});
    setAppliedNormalFormatName(null);
    setNormalSkipReason(null);
    setBootstrapAppliedThisOpen(false);
    setStagedAiProposals([]);
    structuredTouchedRef.current = false;
    structuredFormatDrivingRef.current = false;
    lastStructuredFindingsLinesRef.current = {};
    setSelectedQuickIds(new Set());
    setActiveFindingsAnatomy(null);
    setIsCritical(false);
    setCriticalNote("");
    setChecklistComm({ phoned: false, annotated: false, dispatched: false });
    // Radiologist-local demographic corrections belong to the study they were typed
    // on. They are component state, so the store-side studyTransitionReset() cannot
    // reach them, and they outrank the ERP row, the DICOM tags and the patient master
    // in mergeReportDemography — left mounted they print the previous patient's name
    // and age on this one's header, preview, Word export and PDF.
    //
    // Cleared here rather than in openStudy() because this reset is keyed on the ROUTE
    // study id: a deep link or a browser Back switches the study without ever calling
    // openStudy(). Same reason A-02 moved activeStudyId into this transition.
    setDemographyOverrides({});
  }, [setActiveFindingsAnatomy]);

  // ─── Draft persistence / hydrate / leave / autosave (Phase 3) ─────────────
  const {
    saveDraft,
    conflictLatchedStudyId,
    conflictLatchReason,
    ensureDraftOnce,
    autoSaveStatus,
    lastSavedAt,
    setLastSavedAt,
    restoredDraftForStudyRef,
    leaveDialogOpen,
    resolveLeaveChoice,
    goNextStudy,
    goPrevStudy,
    openStudyGuarded,
    saveDraftRef,
    draftIdRef,
    saveGenerationRef,
    leavePromptReasonRef,
    leaveResolverRef,
    setLeaveDialogOpen,
  } = useDraftPersistence({
    studyId,
    draftId,
    isOnline,
    isDirty,
    isFinalized,
    // The signed half of `contentLocked`, passed composed so that the two
    // expressions cannot drift apart. `isFinalized` alone is not enough: it is
    // written only by `completeFinalize`, so a study signed on another
    // workstation — or signed here and then reopened — leaves it false while
    // `assertDraftWritable` still answers 409 REPORT_LOCKED.
    signedContentLocked,
    // Same gate as draftBackup.enabled above — the rescue flush writes that
    // hook's key, so it must obey that hook's rule about what may be copied to
    // a shared workstation. isFinalized alone is narrower: a report signed in
    // ANOTHER session leaves it false.
    backupEnabled: allowEditSigned || !studyIsSignedElsewhere,
    isMobile,
    useStructured,
    findingsMap,
    structuredValues,
    studySetup,
    workflow,
    // The by-id detail read's patientId — survives the reading-queue filter the
    // same way the demography/study-context fields above do, so drafts hydrate
    // (and save with identity) for studies the filtered queue excludes.
    detailPatientId: worklistDetailQ.data?.patientId ?? null,
    existingDraft,
    isLoadingExistingDraft,
    draftReadSucceeded,
    captureSavedDraft,
    refetchExistingDraft,
    toast,
    openStudy: (id) => openStudyRef.current(id),
    onStudySwitchPageReset,
    setStructuredValues,
    setSelectedQuickIds,
    structuredTouchedRef,
    findingsText,
    impressionText,
    techniqueText,
    recommendationText,
    clinicalHistoryText,
    draftHydratedStudyId,
    setDraftHydratedStudyId,
    // PR #1171 — the demography corrections round-trip through this hook:
    // saved on every draft save, restored on reopen. Still radiologist-local
    // component state (the study-isolation reset keeps clearing it on study
    // switch); only the persistence plumbing is new.
    demographyOverrides,
    setDemographyOverrides,
  });
  setLastSavedAtRef.current = setLastSavedAt;

  const composerRegion = studySetup.matchedStudyRegion ?? studySetup.studyRegions[0] ?? "LS Spine";
  const [composerDraft, setComposerDraft] = useFindingComposerDraft(composerRegion);
  const [composerBanner, setComposerBanner] = useState<string | null>(null);
  const [composerQuickFindings, setComposerQuickFindings] = useState<QuickFinding[]>([]);

  const openComposerForObservation = useCallback((observationId: string) => {
    const patch = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === observationId);
    if (!patch) return;
    const catalog = buildComposerCatalog(
      composerQuickFindings.length ? composerQuickFindings : quickFindingTemplatesRef.current,
      composerRegion,
    );
    setComposerDraft(draftFromObservation(patch, catalog, composerRegion));
    setComposerBanner(null);
    useWorkspace.getState().setSelectedObservationId(observationId);
    activateReportSection("findings");
  }, [composerQuickFindings, composerRegion, activateReportSection]);

  // Whole-report format apply bridge: region sync + autosave generation bump.
  // Format apply never mutates DICOM/ERP identity — only CARE reporting region.
  useEffect(() => {
    setFormatApplyBridge({
      availableRegions: () => studySetup.availableRegions,
      currentRegion: () => studySetup.matchedStudyRegion,
      applyReportingRegion: (regionName) => {
        studySetup.selectPrimaryRegion(regionName);
      },
      invalidatePendingAutosave: () => {
        // Bump generation so any in-flight silent save from pre-format text is discarded.
        // The autosave effect also clears/reschedules when technique/findings deps change.
        saveGenerationRef.current += 1;
      },
    });
    return () => setFormatApplyBridge(null);
  }, [
    studySetup.availableRegions,
    studySetup.matchedStudyRegion,
    studySetup.selectPrimaryRegion,
  ]);


  const { data: composerConfig } = useQuery<{ enabled: boolean; composerModel?: string }>({
    queryKey: ["voice-composer-config"],
    queryFn: () => api.get("/api/radiology/voice-report-composer/config"),
    staleTime: 60_000,
  });

  const protectedQuickLabels = useMemo(() => {
    const ids = selectedQuickIds;
    return quickFindingTemplatesRef.current
      .filter((f) => ids.has(f.id))
      .map((f) => f.label);
  }, [selectedQuickIds]);

  const voiceComposer = useVoiceComposer({
    enabled: composerConfig?.enabled ?? false,
    // Detail-first fallback, like every other identity consumer in this hook:
    // a deep-linked study whose queue row is filtered out still composes with
    // its real modality and exam title.
    modality: workflow.currentRow?.modality ?? worklistDetailQ.data?.modality ?? undefined,
    region: studySetup.matchedStudyRegion ?? studySetup.studyRegions[0],
    reportTitle: workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription ?? undefined,
    protectedQuickFindingLabels: protectedQuickLabels,
  });

  voiceComposerComposeRef.current = async (text, genImp) => {
    await voiceComposer.compose(text, genImp);
  };

  // ── Smart Dictation (Task 15 Part E) — ChatGPT-style multi-turn sessions ──
  // Gated to the six owner-approved MRI examinations. When the composer is
  // disabled the button simply does not appear (dictation stays on the raw
  // transcript path), and inside USG/CT/XR studies it never appears at all.
  const composerRegionForSmart =
    studySetup.matchedStudyRegion ?? studySetup.studyRegions[0] ?? "";
  const smartDictationEligible =
    (composerConfig?.enabled ?? false)
    && smartDictationSupportedForStudy(
      composerRegionForSmart,
      workflow.currentRow?.modality ?? worklistDetailQ.data?.modality,
    );
  const [smartDictationOpen, setSmartDictationOpen] = useState(false);
  const smartDictation = useSmartDictation({
    // C1 — the route id, not the store mirror: staged words and Apply are bound
    // to the study this page was opened for.
    studyId,
    enabled: smartDictationEligible,
    // Same detail-first fallback as the voice composer above.
    modality: workflow.currentRow?.modality ?? worklistDetailQ.data?.modality ?? undefined,
    region: composerRegionForSmart,
    reportTitle: workflow.currentRow?.studyDescription ?? worklistDetailQ.data?.studyDescription ?? undefined,
    protectedQuickFindingLabels: protectedQuickLabels,
  });

  // Voice session routing: while the Smart Dictation panel is open, a completed
  // dictation-mode capture feeds the smart session instead of the one-turn
  // composer — the mic and the typed box are the same conversation.
  const smartDictationOpenRef = useRef(false);
  smartDictationOpenRef.current = smartDictationOpen;

  useEffect(() => {
    const pending = voiceSession.pending;
    if (!composerConfig?.enabled || !pending?.editableText) return;
    const intent = pending.parse.intent;
    if (intent?.type !== "dictate" || intent.target !== "findings") return;
    if (smartDictationOpenRef.current && smartDictationEligible) {
      // Hybrid v1 (2026-10-23): a completed capture STAGES on the panel — the
      // words show instantly and the 14B model runs ONCE, when the radiologist
      // presses Compose, instead of once per utterance.
      smartDictation.stageDictation(pending.editableText);
      voiceSession.cancel();
      return;
    }
    if (voiceComposer.preview?.transcript === pending.editableText) return;
    void voiceComposer.compose(pending.editableText);
  }, [
    composerConfig?.enabled,
    voiceSession.pending?.editableText,
    voiceSession.pending?.parse.intent,
    voiceComposer.preview?.transcript,
  ]);

  const applyVoiceComposerWithUndo = useCallback((force?: boolean) => {
    const applied = voiceComposer.applyPreview(force ?? voiceComposer.preview?.hasConflicts ?? false);
    if (applied) {
      voiceSession.cancel();
    }
    return applied;
  }, [voiceComposer, voiceSession]);

  const insertRawDictation = useCallback(() => {
    if (contentLocked) return; // signed/finalized reports are never silently edited
    const text = voiceComposer.preview?.transcript ?? voiceSession.pending?.editableText ?? "";
    if (!text.trim()) return;
    useWorkspace.getState().mergeField("findings", text, "radiologist-voice");
    voiceComposer.discardPreview();
    voiceSession.cancel();
  }, [contentLocked, voiceComposer, voiceSession]);

  const dictationTranscript = useCallback(() => {
    return (
      voiceComposer.preview?.transcript
      ?? voiceSession.pending?.editableText
      ?? ""
    ).trim();
  }, [voiceComposer.preview?.transcript, voiceSession.pending?.editableText]);

  const dictateAddAsNote = useCallback(() => {
    if (contentLocked) return;
    const text = dictationTranscript();
    if (!text) return;
    useWorkspace.getState().mergeField("findings", text, "radiologist-voice");
    voiceComposer.discardPreview();
    voiceSession.cancel();
    setComposerBanner(null);
  }, [contentLocked, dictationTranscript, voiceComposer, voiceSession]);

  const dictateAddAsFinding = useCallback(() => {
    if (contentLocked) return;
    const text = dictationTranscript();
    if (!text) return;
    const catalog = buildComposerCatalog(
      composerQuickFindings.length ? composerQuickFindings : quickFindingTemplatesRef.current,
      composerRegion,
    );
    const proposal = proposeComposerFromTranscript(text, catalog, composerRegion);
    if (proposal.confidence === "high" && proposal.catalogKey) {
      setComposerDraft({
        ...emptyComposerDraft(composerRegion),
        ...proposal.draft,
        catalogKey: proposal.catalogKey,
        region: composerRegion,
        editingId: null,
        sourceTranscript: text,
      });
      setComposerBanner("From dictation — review in the composer, then Add Finding. Not committed yet.");
    } else {
      setComposerDraft(emptyComposerDraft(composerRegion));
      setComposerBanner("Dictation could not be mapped confidently — use Add as Note, or pick a finding in the composer.");
    }
    activateReportSection("findings");
  }, [
    contentLocked, dictationTranscript, composerQuickFindings, composerRegion, activateReportSection,
  ]);

  // Changing the live transcript must not leave a stale structured proposal ready to commit.
  const liveDictationText = (
    voiceComposer.preview?.transcript
    ?? voiceSession.pending?.editableText
    ?? ""
  ).trim();
  useEffect(() => {
    const stamped = (composerDraft.sourceTranscript ?? "").trim();
    if (!stamped) return;
    if (liveDictationText === stamped) return;
    setComposerDraft(emptyComposerDraft(composerRegion));
    setComposerBanner("Dictation changed — structured proposal cleared. Re-run Add as Finding if needed.");
  }, [liveDictationText, composerDraft.sourceTranscript, composerRegion]);

  const [microInstruction, setMicroInstruction] = useState("");
  const [aiAssistantMinimized, setAiAssistantMinimized] = useState(() =>
    readAiAssistantMinimizedPreference(typeof window !== "undefined" ? window.localStorage : null),
  );
  /** Background composer drafting mode — default TEXT_ONLY; never silently SELECTED_IMAGES. */
  const [composerAiMode, setComposerAiMode] = useState<"TEXT_ONLY" | "SELECTED_IMAGES">("TEXT_ONLY");
  /** Session-only AI provider/model override (workspace A/B). Does not mutate Settings. */
  const [composerSessionModelKey, setComposerSessionModelKey] = useState("");
  /** Session AI selection of frozen key-image IDs (independent of includeInReport). */
  const [aiSelectedKeyImageIds, setAiSelectedKeyImageIds] = useState<number[]>([]);
  const persistAiAssistantMinimized = (minimized: boolean) => {
    setAiAssistantMinimized(minimized);
    writeAiAssistantMinimizedPreference(
      typeof window !== "undefined" ? window.localStorage : null,
      minimized,
    );
  };

  // Clear AI image selection + reset mode when study/draft switches (wrong-patient guard).
  useEffect(() => {
    setAiSelectedKeyImageIds([]);
    setComposerAiMode("TEXT_ONLY");
    setComposerSessionModelKey("");
    setAbnormalHighlight((h) => clearHighlightIfStudyChanged(h, studyId != null ? String(studyId) : null));
  }, [studyId, draftId]);

  const { data: aiProviderSettingsForComposer } = useQuery<{
    providers: Record<
      string,
      {
        provider: string;
        isEnabled: boolean;
        defaultModel: string | null;
        label: string;
        displayName?: string | null;
        execution?: string;
      }
    >;
  }>({
    queryKey: ["ai-reporting-settings-composer-models"],
    queryFn: () => api.get("/api/ai-reporting/settings"),
    staleTime: 60_000,
  });

  const composerSessionModelOptions = useMemo(() => {
    const providers = aiProviderSettingsForComposer?.providers ?? {};
    const opts: Array<{ value: string; label: string; provider: string; model: string }> = [];
    for (const p of Object.values(providers)) {
      if (!p.isEnabled) continue;
      const model = (p.defaultModel ?? "").trim();
      if (!model) continue;
      const exec = p.execution === "LOCAL" || p.provider === "ollama" || p.provider === "local_openai_compatible"
        ? "Local"
        : "Cloud";
      const display =
        (p.displayName ?? "").trim() ||
        `${p.label} · ${model}`;
      opts.push({
        value: `${p.provider}::${model}`,
        label: `${display} (${exec})`,
        provider: p.provider,
        model,
      });
    }
    return opts;
  }, [aiProviderSettingsForComposer]);

  const composerSessionResolved = useMemo(() => {
    if (!composerSessionModelKey.trim()) return { provider: null as string | null, model: null as string | null };
    const hit = composerSessionModelOptions.find((o) => o.value === composerSessionModelKey);
    if (!hit) return { provider: null, model: null };
    return { provider: hit.provider, model: hit.model };
  }, [composerSessionModelKey, composerSessionModelOptions]);

  const handleUndoLastAbnormal = useCallback(() => {
    const ws = useWorkspace.getState();
    const state = {
      lastPatchSnapshot: ws.lastPatchSnapshot,
      appliedPathologyPatches: ws.appliedPathologyPatches,
      isFinalized: ws.isFinalized,
    };
    if (!canUndoLastAbnormal(state, { locked: isLocked })) return;
    const restored = describeRestoredBaseline(state);
    const label = describeLastAbnormalForUndo(state);
    const ok = ws.undoLastPatch();
    if (ok) {
      toast({
        title: "Abnormal undone",
        description: `Restored: ${restored || label}`,
        duration: 2800,
      });
    }
  }, [isLocked, toast]);

  const feedbackAfterAbnormalApply = useCallback(() => {
    const patches = useWorkspace.getState().appliedPathologyPatches;
    const last = [...patches].reverse().find((p) => !isSystemNormalPatch(p) && !p.stale);
    if (!last) {
      void saveDraftRef.current?.({ silent: true });
      return;
    }
    const sid = studyId != null ? String(studyId) : null;
    setAbnormalHighlight((prev) => buildAbnormalHighlightFromPatch(last, sid, prev?.token ?? 0));
    const msg = describeAbnormalReplacementToast(last);
    if (msg) {
      toast({ title: msg, duration: 2200 });
    }
    window.setTimeout(() => {
      setAbnormalHighlight((h) => (h && h.studyId === sid ? null : h));
    }, ABNORMAL_HIGHLIGHT_MS);
    void saveDraftRef.current?.({ silent: true });
  }, [studyId, toast]);

  // ─── Background AI Report Composer — canonical study context ────────────
  // The composer MUST receive the SAME canonical study identity the workspace
  // already resolved centrally through ReportingStudyContext. We never re-parse
  // DICOM strings or invent context. Sources:
  //   modality     ← workflow.currentRow.modality (also stored on ctx.modality)
  //   region       ← studySetup.studyContext.region (canonical primary region)
  //   regions      ← studySetup.studyContext.regions (multi-region + screening)
  //   bodyPart     ← studySetup.studyContext.bodyPart (BRAIN / SPINE_CERVICAL / …)
  //   family       ← studySetup.studyContext.family ("brain"|"spine"|…)
  //   spineSegment ← studySetup.studyContext.spineSegment
  //   protocol     ← studySetup.studyContext.protocolName (resolved from
  //                  activeProtocol.name) — never inferred from StudyDescription
  //   reportTitle  ← resolvePrintedReportTitle(appliedFormatReportTitle, fallback)
  //                  — the PRINTED heading, not the library/display format name
  //   studyType    ← workflow.currentRow.studyDescription (DICOM provenance,
  //                  secondary descriptive context only)
  const composerCtx = studySetup.studyContext;
  const composerReportTitle = resolvePrintedReportTitle(
    appliedFormatReportTitle,
    studySetup.testName
      ?? workflow.currentRow?.studyDescription
      ?? "",
  );
  const composerPrimaryRegionLabel = useMemo(() => {
    const family = (composerCtx.family ?? "").toLowerCase();
    const segment = (composerCtx.spineSegment ?? "").toLowerCase();
    if (family === "brain") return "MRI Brain";
    if (family === "spine") {
      if (segment === "cervical") return "MRI Cervical Spine";
      if (segment === "dorsal") return "MRI Dorsal Spine";
      if (segment === "lumbar") return "MRI Lumbosacral Spine";
      // A Dorso-Lumbar booking is its own examination; naming it "MRI Spine"
      // would hand the composer a region no study was billed for.
      if (segment === "dorsolumbar") return "MRI Dorso-Lumbar Spine";
      return "MRI Spine";
    }
    return (
      composerCtx.region
      ?? studySetup.matchedStudyRegion
      ?? studySetup.studyRegions[0]
      ?? "Unknown region"
    );
  }, [composerCtx.family, composerCtx.spineSegment, composerCtx.region, studySetup.matchedStudyRegion, studySetup.studyRegions]);

  // Same query key as the rail — React Query dedupes. Used to build AI-selected
  // key-image refs (IDs + safe metadata only; never base64).
  const composerKeyImagesQ = useFrozenKeyImages(draftId);
  const composerSelectedKeyImages = useMemo(() => {
    const items = composerKeyImagesQ.data?.items ?? [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return aiSelectedKeyImageIds
      .map((id) => byId.get(id))
      .filter((img): img is NonNullable<typeof img> => !!img)
      .map((img) => ({
        keyImageId: img.id,
        observationId: img.observationId ?? null,
        seriesInstanceUid: img.seriesInstanceUid ?? null,
        sopInstanceUid: img.sopInstanceUid ?? null,
        frameNumber: img.frameNumber ?? null,
        seriesDescription: img.seriesDescription ?? null,
        caption: img.caption ?? "",
      }));
  }, [aiSelectedKeyImageIds, composerKeyImagesQ.data?.items]);

  // Drop stale AI IDs that no longer exist on the draft (deleted images).
  useEffect(() => {
    const items = composerKeyImagesQ.data?.items;
    if (!items) return;
    const live = new Set(items.map((i) => i.id));
    setAiSelectedKeyImageIds((prev) => {
      const next = prev.filter((id) => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [composerKeyImagesQ.data?.items]);

  const reportComposer = useReportComposer({
    worklistId: studyId ?? null,
    studyId: workflow.currentRow?.studyId ?? null,
    reportId: linkedReportIdRef.current,
    modality: composerCtx.modality ?? workflow.currentRow?.modality ?? undefined,
    region: composerCtx.region ?? studySetup.matchedStudyRegion ?? studySetup.studyRegions[0],
    regions: composerCtx.regions,
    bodyPart: composerCtx.bodyPart ?? undefined,
    family: composerCtx.family,
    spineSegment: composerCtx.spineSegment ?? undefined,
    studyType: workflow.currentRow?.studyDescription ?? undefined,
    protocol: composerCtx.protocolName ?? undefined,
    reportTitle: composerReportTitle || undefined,
    isFinalized,
    aiMode: composerAiMode,
    selectedKeyImages: composerSelectedKeyImages,
    primaryRegionLabel: composerPrimaryRegionLabel,
    sessionProvider: composerSessionResolved.provider,
    sessionModel: composerSessionResolved.model,
    // One source of truth: the panel's instruction box is part of the frozen input for both
    // the preview and the generation request, so they cannot diverge on it.
    instruction: microInstruction,
    // The composer's Apply persistence step goes through the workspace's own
    // awaited draft save — the same canonical writer the Save button, the
    // autosave and Finalize use — never a second one. Silent because the Apply
    // result is what the radiologist needs to hear about, twice would be noise.
    persistAccepted: (tag) => saveDraft({ composer: tag, silent: true }),
  });

  // ─── Finalize gauntlet (Phase 3) ───────────────────────────────────────────
  // canonicalDemography is assembled further down this hook body, so finalize
  // reaches it through a ref rather than a captured value: the quality rules
  // that need patient sex/age must see the demography as it stands at sign-off.
  const canonicalDemographyRef = useRef<ReportDemography | null>(null);
  const getCanonicalDemography = useCallback(
    () => canonicalDemographyRef.current,
    [],
  );

  // The template question is reached the same way, for the same two reasons: the
  // gauntlet judges the template as it stands when Finalize is pressed, and a
  // stable getter keeps this out of the finalize callback's dependency churn.
  // Null when no template is chosen — there is then nothing to be incompatible.
  const templateCompatibilityRef = useRef<TemplateStudyCompatibilityInput | null>(null);
  templateCompatibilityRef.current = studySetup.selectedTemplate
    ? {
        templateMismatch: studySetup.templateMismatch,
        studyRegions: studySetup.studyRegions,
        templateBodyPart: studySetup.selectedTemplate.bodyPart ?? null,
        templateName: studySetup.selectedTemplate.templateName ?? null,
        templateStudyType: studySetup.selectedTemplate.studyType ?? null,
      }
    : null;
  const getTemplateCompatibility = useCallback(
    () => templateCompatibilityRef.current,
    [],
  );

  const {
    finalizeReport,
    unlinkedClose,
    closingUnlinked,
    closeStudyWithoutImages,
    formFFinalizeOpen,
    setFormFFinalizeOpen,
    aiFinalizeGate,
    setAiFinalizeGate,
    formFContinueFinalizeRef,
    pcpndtBlockedRef,
    aiFinalizeBypassRef,
  } = useStudyFinalize({
    studyId,
    draftId,
    isOnline,
    checklistPercent: studySetup.checklistPercent,
    saveDraft,
    conflictLatchedStudyId,
    conflictLatchReason,
    finalizeFlow,
    draftBackup,
    qc,
    toast,
    isCritical,
    criticalNote,
    checklistComm,
    session,
    sessionFresh,
    reportComposer,
    workflow,
    goNextStudy,
    setReadingSession,
    getDemography: getCanonicalDemography,
    getTemplateCompatibility,
    // Same four values useWorkspaceExportShare feeds buildLivePrintBodyHtml, so
    // the signed body and the pre-sign print preview cannot drift apart.
    presentation: { headingCase, impressionStyle, useStructured, findingsMap },
    // The stored patient_reports.title follows the SAME precedence as the
    // preview and the print route (resolveCanonicalStudyTitle): the billed
    // catalogue name, then the DICOM description, then the applied format's
    // own title. Blank-safe: an EMPTY string falls through to the next
    // authority instead of short-circuiting the chain.
    titleFallback: resolveCanonicalStudyTitle({
      billedName:
        worklistDetailQ.data?.testName?.trim()
        || worklistDetailQ.data?.billedTestName?.trim()
        || workflow.currentRow?.testName?.trim()
        || workflow.currentRow?.billedTestName?.trim()
        || null,
      dicomDescription:
        worklistDetailQ.data?.studyDescription?.trim()
        || workflow.currentRow?.studyDescription?.trim()
        || null,
      formatTitle: appliedFormatReportTitle?.trim() || null,
    }) || null,
  });

  const acceptStructuredImpressionCandidate = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    useWorkspace.getState().mergeField("impression", trimmed, "structured-template-candidate");
  }, []);

  const applyStructuredGeneration = useCallback((values: StructuredValues) => {
    const tpl = studySetup.selectedTemplate;
    if (!tpl || !formatHasStructuredFields(tpl.sectionsJson)) return;
    structuredFormatDrivingRef.current = true;
    const doc = adaptSectionsJson(tpl.sectionsJson);
    const gen = generateFromValues(doc, values);
    setFindingsMap(gen.findingsMap);
    generatedFindingsMapRef.current = gen.findingsMap;
    setUseStructured(true);

    const nextLines = labeledLinesFromMap(gen.findingsMap);
    const ws = useWorkspace.getState();
    const plan = planStructuredFindingsUpdate(
      ws.findingsText,
      lastStructuredFindingsLinesRef.current,
      nextLines,
    );
    const strippedF = stripExactChunks(ws.findingsText, plan.strip);
    if (strippedF !== ws.findingsText) ws.setField("findings", strippedF);
    for (const line of plan.merge) {
      ws.mergeField("findings", line, "structured-template");
    }
    lastStructuredFindingsLinesRef.current = plan.nextTracked;

    if (gen.techniqueText.trim()) ws.mergeField("technique", gen.techniqueText, "structured-template");
    if (gen.recommendationText.trim()) ws.mergeField("recommendation", gen.recommendationText, "structured-template");

    // ─── Structured Reporting → Canonical Observation Ledger ─────────────
    // PR #658 final convergence: structured format selections with
    // canonicalKey now produce canonical observations via the EXISTING
    // applyMacroBundle path. This closes the "Structured Reporting →
    // Ledger changes: NONE" gap.
    //
    // Only ABNORMAL selections produce observations. Normal baseline text
    // remains the responsibility of the Full Report Format (§5).
    //
    // The structured format continues to generate narrative text via the
    // existing generateFromValues() path above — this adapter ONLY creates
    // the canonical observation entries that the AI Composer and Impression
    // refresh need.
    //
    // The previous structured-template observations are NOT removed here —
    // applyMacroBundle's same-slot replacement engine handles that: when
    // the same canonicalKey + level + laterality is re-applied, the old
    // observation is replaced by the new one (same-slot replacement).
    // When a toggle is turned OFF, the observation is not emitted, and the
    // existing observation remains in the ledger until the radiologist
    // explicitly removes it via Quick Select deselect / removeObservation.
    // This is intentional — the structured format drives ADDITIONS, not
    // removals. Removal semantics are owned by the observation ledger.
    const region = studySetup.studyContext.region ?? "LS Spine";
    const structuredPatches = deriveStructuredObservations(doc, values, region);

    // P0-C: Structured toggle-off → ledger removal.
    // Ownership is scoped by EXPLICIT region + stable template identity
    // (structuredOwnerKey). This prevents:
    //   - Cross-region deletion (Brain apply can't remove LS Spine observations)
    //   - Cross-template deletion (template A toggle-off can't remove template B)
    //   - Deletion of QS/Voice/Macro observations (different source)
    //   - Deletion of protected/manual observations
    // The structuredOwnerKey is stable across toggle cycles — it uses the
    // template ID, NOT a timestamp. This ensures that toggle-off correctly
    // matches observations created by toggle-on of the SAME template.
    const structuredOwnerKey = `structured-template-${tpl.id ?? "format"}`;
    const removalIds = computeStructuredRemovals(
      ws.appliedPathologyPatches.map((p) => ({
        id: p.id,
        source: p.source,
        protected: p.protected,
        region: p.observation?.region,
        bundleId: p.observation?.bundleId,
      })),
      structuredPatches,
      region,
      structuredOwnerKey,
    );
    for (const id of removalIds) {
      ws.removeObservation(id);
    }

    if (structuredPatches.length > 0) {
      ws.applyMacroBundle({
        bundleId: structuredOwnerKey,
        observations: structuredPatches.map((p) => ({
          incoming: { findings: p.findingsText, impression: p.impressionText },
          templates: { findings: p.findingsText, impression: p.impressionText },
          ownership: {
            conflictGroup: p.conflictGroup,
            concept: p.concept,
          },
          source: "structured-template",
          region: p.region,
          concept: p.concept,
          level: p.level,
          laterality: p.laterality,
          severity: p.severity,
          findingsText: p.findingsText,
          supportsLaterality: Boolean(p.laterality),
          properties: p.laterality ? "side" : undefined,
          id: `structured-${p.region}-${p.concept}-${p.level ?? ""}-${p.laterality ?? ""}`,
        })),
      });
    }
  }, [studySetup.selectedTemplate, studySetup.studyContext.region]);

  const scheduleStructuredApply = useDebouncedCallback((values: StructuredValues) => {
    applyStructuredGeneration(values);
  }, 100);

  const scheduleStructuredDraftSave = useDebouncedCallback(() => {
    void saveDraftRef.current({ silent: true });
  }, 500);

  useEffect(() => {
    if (!structuredTouchedRef.current) return;
    if (!formatHasStructuredFields(studySetup.selectedTemplate?.sectionsJson)) return;
    scheduleStructuredApply(structuredValues);
  }, [structuredValues, studySetup.selectedTemplate, scheduleStructuredApply]);

  const clinicalHistoryChips = useMemo(
    () => (studySetup.quickSelectData?.clinicalHistory ?? [])
      .filter((c) => c.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayLabel.localeCompare(b.displayLabel)),
    [studySetup.quickSelectData],
  );

  const clinicalHistoryStudyTabs = useMemo(
    () => (studySetup.quickSelectData?.tabs ?? [])
      .filter((t) => t.isActive)
      .map((t) => ({ id: t.id, name: t.name })),
    [studySetup.quickSelectData],
  );

  const selectedClinicalHistoryTab = useMemo(() => {
    const name = studySetup.matchedStudyRegion;
    if (!name) return null;
    return clinicalHistoryStudyTabs.find((t) => t.name === name) ?? null;
  }, [clinicalHistoryStudyTabs, studySetup.matchedStudyRegion]);


  const recommendationChips = useMemo<string[]>(() => {
    const raw = pacsSettingsRows?.find((r) => r.key === "report_recommendation_chips")?.value;
    let base = DEFAULT_RECOMMENDATION_CHIPS;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const chips = parsed.map((x) => String(x).trim()).filter(Boolean);
          if (chips.length > 0) base = chips;
        }
      } catch { /* fall back */ }
    }
    const pathology = collectPathologyRecommendationChips(appliedPathologyPatches);
    return mergeRecommendationChipLists(base, pathology);
  }, [pacsSettingsRows, appliedPathologyPatches]);

  // Few-clicks — the impression twin of the recommendation chip row: every
  // observation's own canned impression sentence, one click from the editor
  // instead of hand-typed. Sourced from the same observation ledger the
  // derived impression composes from, so a chip never invents clinical text.
  const impressionShortcutChips = useMemo<string[]>(
    () => collectPathologyImpressionShortcuts(appliedPathologyPatches),
    [appliedPathologyPatches],
  );

  const blockedQuickFindingIds = useMemo(
    () => new Set(
      appliedPathologyPatches
        .filter((p) => patchFindingsContributionBlocked(p, findingsText))
        .map((p) => /^qf-(\d+)$/.exec(p.id))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => Number(m[1])),
    ),
    [appliedPathologyPatches, findingsText],
  );

  const catalogQuickFindings = studySetup.quickSelectData?.findings ?? EMPTY_QUICK_FINDINGS;

  const {
    patternSuggestions,
    applyPattern,
    dismissPattern,
    appliedPatternMarkers,
    patternUsageCounts,
    abnormalPatternSuggestionsEnabled,
  } = useAbnormalPatternSuggestions({
    region: studySetup.matchedStudyRegion ?? studySetup.studyRegions[0] ?? "",
    modality: workflow.currentRow?.modality ?? "",
    protocolName: studySetup.activeProtocol?.name ?? null,
    selectedChipLabels: protectedQuickLabels,
    clinicalHistory: clinicalHistoryText,
    findingsText,
    appliedPathologyPatches,
    learnedIgnored: copilotLearning.learnedIgnored,
    recordIgnored: copilotLearning.record,
    studyId: studyId ?? null,
  });

  const reportNeedsStart = useMemo(() => {
    const region = studySetup.matchedStudyRegion ?? studySetup.studyRegions[0];
    if (!region) return false;
    // A complete Full Report Format baseline is already present — the amber
    // Start-Report banner must not nag over a ready-to-review normal report.
    if (appliedFormatName && techniqueText.trim() && findingsText.trim()) return false;
    const findingsEmpty = useStructured
      ? Object.values(findingsMap).every((v) => !v.text.trim() || v.normal)
      : !findingsText.trim();
    const noWork = !techniqueText.trim() && findingsEmpty && !impressionText.trim();
    return noWork
      || studySetup.templateMismatch
      || (!studySetup.activeProtocol && studySetup.availableProtocols.length > 0);
  }, [
    studySetup.matchedStudyRegion, studySetup.studyRegions, useStructured, findingsMap,
    findingsText, techniqueText, impressionText, studySetup.templateMismatch,
    studySetup.activeProtocol, studySetup.availableProtocols.length, appliedFormatName,
  ]);

  /**
   * The one-click Start Report, and the workspace's only whole-report generator.
   *
   * It used to fill the four prose fields from the structured template with
   * `setFindings`/`setImpression`/`setRecommendation`. That deleted whatever the
   * radiologist had already selected or dictated, and wrote
   * "Please correlate with clinical findings." into every report whether anyone
   * meant it or not. It now does the two halves separately:
   *
   *  1. `startReportSetup` — which protocol and template belong to this study.
   *     Setup only: it merges technique and never touches the prose.
   *  2. `generateProfessionalReport` — merges the examination's approved normal
   *     against the text that is already there and replays the observation
   *     ledger, so a selected abnormality retires its own contradictory normal
   *     sentence instead of sitting beside it.
   *
   * There is deliberately no second undo snapshot. The action pushes one clinical
   * undo frame that restores the prose AND the ledger together, and the Starting
   * Canvas header already offers it (`undo-full-report`). Restoring the four text
   * fields by hand — what the old bootstrap did — leaves the ledger holding the
   * baseline observations the text no longer mentions.
   */
  const handleStartReport = useCallback(() => {
    if (contentLocked) return;
    const ctx = billedStudyContextForNormal(
      studySetup.studyContext,
      billedNameFromWorklistRow(workflow.currentRow, worklistDetailQ.data),
    );
    // Checked before the setup half, not only inside the generator: `startReportSetup`
    // writes this region's Technique, so a refusal after it would still have left an
    // acquisition paragraph for the examination this report no longer describes.
    const regionConflict = regionIdentityConflictMessage({
      source: ctx.source,
      regions: ctx.regions.length ? ctx.regions : [ctx.region],
      records: useWorkspace.getState().regionTransitions,
    });
    if (regionConflict) {
      toast({ variant: "destructive", title: "Nothing generated", description: regionConflict });
      return;
    }
    studySetup.startReportSetup();
    const outcome = useWorkspace.getState().generateProfessionalReport(ctx);
    if (outcome.status === "generated") {
      toast({
        title: "Professional report generated",
        description: outcome.observationsNeedingReview > 0
          ? `${outcome.formatName} — ${outcome.observationsNeedingReview} finding(s) need your review.`
          : `${outcome.formatName} — review, then save or print.`,
      });
      return;
    }
    // A refusal is not a silent failure: nothing on the report changed, and the
    // reason names the step the radiologist has to take next.
    toast({ variant: "destructive", title: "Nothing generated", description: outcome.reason });
  }, [contentLocked, studySetup, toast, workflow.currentRow]);

  const undoStartReport = useCallback(() => {
    const snap = startReportUndoRef.current;
    if (!snap) return;
    useWorkspace.getState().setEditorContent({
      findings: snap.findings,
      impression: snap.impression,
      recommendation: snap.recommendation,
      technique: snap.technique,
      clinicalHistory: snap.clinicalHistory,
    });
    setFindingsMap(snap.findingsMap);
    setUseStructured(snap.useStructured);
    if (snap.selectedTemplateId != null) studySetup.selectTemplateManual(snap.selectedTemplateId);
    startReportUndoRef.current = null;
    setCanUndoStartReport(false);
    if (bootstrapAppliedThisOpen) {
      setAppliedNormalFormatName(null);
      setBootstrapAppliedThisOpen(false);
      // Clear applied format banner when undoing auto-bootstrap only.
      useWorkspace.setState({ appliedFormatName: null, appliedFormatReportTitle: null });
    }
    toast({ title: bootstrapAppliedThisOpen ? "Normal bootstrap undone" : "Start report undone" });
  }, [studySetup, toast, bootstrapAppliedThisOpen]);

  /**
   * MODE A — the instant report.
   *
   * `reportComposerAutoCompose` was stored by the AI settings page and read by no
   * behaviour at all, so the deterministic whole-report build waited on a button.
   * This runs that same engine once the inputs settle. The decision itself is not
   * here: it is `composeInstantReport` in the store, which refuses to build over a
   * hand-written Conclusion, over a normal the clinic has not approved for this
   * examination, or at all on a locked report. No provider, no request, no model.
   *
   * The signature is what makes the debounce a settle rather than a keystroke
   * trigger: "L4-L5" is four changes, and the report should be written after the
   * last one. It is re-stamped AFTER the call, not before, because the engine's own
   * write moves the signature — stamping it beforehand would leave every composition
   * scheduling the next one forever.
   *
   * Deliberately placed after `undoStartReport` rather than beside `handleStartReport`:
   * `regionTransitionReload.test.ts` windows the source between those two definitions
   * to prove the press computes ONE study context for both its checks and its write.
   * A second `billedStudyContextForNormal` inside that window would satisfy this
   * effect and break that contract — and the contract is the one that matters.
   */
  const instantReportHold = useWorkspace((s: WorkspaceStore) => s.instantReportHold);
  const [instantReportOn, setInstantReportOn] = useState(readInstantReportEnabled);
  const instantReportSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!instantReportOn) return;
    const state = useWorkspace.getState();
    // Nothing to compose onto before a study is open, and nothing honest to decide
    // with while the format library is still arriving: composing then would refuse
    // for "no normal format", and the canvas would show a reason that is a lie.
    if (!state.activeStudyId || state.reportFormats.length === 0) return;
    const signature = instantReportSignature(state);
    if (instantReportSignatureRef.current === signature) return;
    const timer = setTimeout(() => {
      const live = useWorkspace.getState();
      if (instantReportSignature(live) !== signature) return;
      const ctx = billedStudyContextForNormal(
        studySetup.studyContext,
        billedNameFromWorklistRow(workflow.currentRow, worklistDetailQ.data),
      );
      live.composeInstantReport(ctx, contentLocked);
      instantReportSignatureRef.current = instantReportSignature(useWorkspace.getState());
    }, INSTANT_REPORT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    instantReportOn, appliedPathologyPatches, findingsText, contentLocked,
    studySetup, workflow.currentRow, reportFormatCount, isFinalized,
  ]);

  const setInstantReportEnabled = useCallback((next: boolean) => {
    writeInstantReportEnabled(next);
    setInstantReportOn(next);
    if (next) {
      // Switching it back on is a fresh request to build the report, so it answers
      // itself now instead of waiting for the radiologist's next keystroke.
      instantReportSignatureRef.current = null;
    } else {
      // And switching it off retires the reason it gave last time: a banner about an
      // engine that is no longer running is a defect wearing a diagnostic's clothes.
      useWorkspace.getState().setInstantReportHold(null);
    }
  }, []);

  const studyReadyStatus = useMemo(() => {
    if (!studyId || draftHydratedStudyId !== studyId) {
      return { kind: "quiet" as const, label: "", canUndo: false };
    }
    return deriveStudyReadyStatus({
      restoredDraft: restoredDraftForStudyRef.current === studyId,
      appliedNormalFormat: bootstrapAppliedThisOpen && !!appliedNormalFormatName,
      normalFormatName: appliedNormalFormatName,
      protocolLoaded: !!studySetup.activeProtocol,
      protocolName: studySetup.activeProtocol?.name ?? null,
      emptyNeedsStart: reportNeedsStart && !bootstrapAppliedThisOpen,
      normalSkipReason,
    });
  }, [
    studyId,
    draftHydratedStudyId,
    bootstrapAppliedThisOpen,
    appliedNormalFormatName,
    normalSkipReason,
    studySetup.activeProtocol,
    reportNeedsStart,
  ]);

  const handleGenerateLocalImpression = useCallback(() => {
    if (contentLocked) return;
    const store = useWorkspace.getState();
    if (store.appliedPathologyPatches.length > 0) {
      store.refreshImpressionFromLedger();
      toast({ title: "Impression refreshed", description: "From active observations and remaining abnormal findings." });
      return;
    }
    const lines = generateLocalImpression(
      store.findingsText || (useStructured ? findingsMapToText(findingsMap) : ""),
      useStructured ? findingsMap : undefined,
    );
    if (lines.length === 0) {
      toast({ title: "No findings to summarize", description: "Add findings first.", variant: "destructive" });
      return;
    }
    if (store.impressionText.trim()) {
      setConfirmImpressionReplace(true);
      return;
    }
    store.setField("impression", lines.join("\n"));
    toast({ title: "Impression generated", description: `${lines.length} point${lines.length > 1 ? "s" : ""} from findings` });
  }, [contentLocked, useStructured, findingsMap, toast]);

  const handleRefreshImpressionFromFindings = useCallback(() => {
    if (contentLocked) return;
    const store = useWorkspace.getState();
    if (store.appliedPathologyPatches.length > 0) {
      store.refreshImpressionFromLedger();
      toast({ title: "Impression refreshed from findings" });
      return;
    }
    handleGenerateLocalImpression();
  }, [contentLocked, handleGenerateLocalImpression, toast]);

  // Confirmed: replace impression
  const confirmedReplaceImpression = useCallback(() => {
    setConfirmImpressionReplace(false);
    const store = useWorkspace.getState();
    const lines = generateLocalImpression(
      store.findingsText || (useStructured ? findingsMapToText(findingsMap) : ""),
      useStructured ? findingsMap : undefined,
    );
    store.setField("impression", lines.join("\n"));
    toast({ title: "Impression generated", description: `${lines.length} point${lines.length > 1 ? "s" : ""} from findings` });
  }, [useStructured, findingsMap, toast]);

  // After Load-correct-template, populate Normal/Abnormal cards from the new template
  useEffect(() => {
    if (!pendingStructuredPopulateRef.current) return;
    if (studySetup.templateFindingsSections.length === 0) return;
    pendingStructuredPopulateRef.current = false;
    const map: Record<string, { normal: boolean; text: string }> = {};
    for (const s of studySetup.templateFindingsSections) {
      map[s.label] = { normal: true, text: s.normal };
    }
    setFindingsMap(map);
    setUseStructured(true);
  }, [studySetup.templateFindingsSections, studySetup.selectedTemplateId]);

  const openStudy = useCallback((id: string | number) => {
    const sid = String(id);
    selectStudy(sid);
    navigate(`/radiology/reporting-workspace/${sid}`);
    // Old workspace: collapse the left queue after a patient is chosen so the
    // viewer/editor reclaim width. Clinic setting can keep the queue open.
    if (autoCollapseQueueOnStudyOpen) {
      requestAnimationFrame(() => leftPanelRef.current?.collapse());
    }
    // Clear study-scoped UI state (Quick Select / critical checklist)
    setSelectedQuickIds(new Set());
    setIsCritical(false);
    setCriticalNote("");
    setChecklistComm({ phoned: false, annotated: false, dispatched: false });
    setLastSavedAtRef.current(null);
    setAllowEditSigned(false);
  }, [selectStudy, navigate, autoCollapseQueueOnStudyOpen]);
  openStudyRef.current = openStudy;

  const persistQueueModality = useCallback((value: string) => {
    const next = isReadingQueueModality(value) ? value : "MR";
    setQueueModality(next);
    writeStoredReadingQueueModality(
      typeof window !== "undefined" ? window.localStorage : null,
      next,
    );
  }, []);

  const persistDatePreset = useCallback((value: ReadingQueueDatePreset) => {
    setDatePreset(value);
    try { localStorage.setItem("care_reading_queue_date", value); } catch { /* ignore */ }
  }, []);

  const persistQueueSort = useCallback((value: ReadingQueueSort) => {
    setQueueSort(value);
    try { localStorage.setItem("care_reading_queue_sort", value); } catch { /* ignore */ }
  }, []);

  /**
   * Clinic Quick Select — pathology patches over the whole report (ownership +
   * laterality).
   *
   * One writer for every surface that can click a box: the Clinic Quick Select
   * panel, the voice path, the structured-details dialog and the section strips.
   * That is what makes a box clinically equal whichever of them it was clicked
   * from — the ledger row, the owned sections, the chip state, the undo frame and
   * the last-rendered copy are all written here and nowhere else.
   *
   * `params` is the strip's own side/severity choice. Omitting it is not the same
   * as passing an empty object: a caller that has no parameter UI of its own
   * (the panel, voice) inherits the workspace's global side selector, which is
   * the behaviour those callers have always had. A caller that DOES have one
   * passes what it holds, including an empty side — because there is no default
   * side here, and a box that asks for one must refuse rather than guess.
   *
   * The return is the overlay's own verdict, so a clicker can tell a write that
   * landed from one that was refused and stop rewarding the refusal.
   */
  const handleQuickToggle = useCallback((
    finding: QuickFinding,
    nowSelected: boolean,
    params?: QuickSelectParameterValues,
  ): QuickToggleOutcome => {
    const state = useWorkspace.getState();
    const chosen = params ?? { side: quickSide };
    const patch = quickFindingPatch(finding, {
      region: studySetup.matchedStudyRegion ?? finding.studyType,
      studyType: finding.studyType,
    }, chosen);
    const route = quickFindingClickRoute(patch);
    if (route.clinicalHistory) {
      // A clinical-history box writes a section the body patch has no key for. It
      // contributes through the Clinical History toggle the chips already use,
      // whose state is the section's own text — there is no ledger row to
      // withdraw and nothing for `removeObservation` to find. A box that ALSO
      // declares a body sentence falls through and writes that too: dropping it
      // would lose a sentence the radiologist clicked for.
      const verdict = state.toggleClinicalHistoryContribution(
        route.clinicalHistory, nowSelected, chosen.side,
      );
      if (!route.writesBody) return verdict;
    }
    if (nowSelected) {
      const clash = quickFindingCrossSectionClash(state.appliedPathologyPatches, patch);
      if (clash) {
        // The wording is on the page from a row this box cannot reach — the strip
        // that wrote it is gone and its `qs-` id names no database box. Writing it
        // again would print the same clinical sentence twice, in two sections, so
        // nothing is written and the radiologist is told where it already sits.
        const name = clash.section.charAt(0).toUpperCase() + clash.section.slice(1);
        toast({
          title: "Already in the report",
          description:
            `"${clash.sentence}" is already in ${name}, from a Quick Select choice saved before this catalogue. `
            + "Edit or delete it in " + name + " — clicking this box again would only repeat it.",
          duration: 8000,
        });
        return "refused";
      }
      const patchId = patch.id!;
      const outcome = state.applyPathologyOverlay(patch);
      const applied = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === patchId);
      if (applied) lastQuickRenderedRef.current.set(finding.id, applied.lastRendered);
      const ids = selectedQuickFindingIds(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id));
      setSelectedQuickIds(new Set(ids));
      for (const id of lastQuickRenderedRef.current.keys()) {
        if (!ids.includes(id)) lastQuickRenderedRef.current.delete(id);
      }
      return outcome;
    } else {
      // Every row this box owns, not only the one for the side now chosen. The
      // chip reads as applied when ANY side of the box is on the page, so a
      // deselect that removed only the current side would leave the chip lit and
      // the other side's sentence printed with no control left to withdraw it —
      // the exact defect the sided row id was introduced to close. One undo frame
      // for the whole click: the first removal snapshots the pre-click report and
      // the rest fold into it.
      const owned = useWorkspace.getState().appliedPathologyPatches
        .filter((p) => quickFindingRowBelongsTo(p.id, finding.id))
        .map((p) => p.id);
      const outcomes = owned.map((id, i) =>
        state.removeObservation(id, i > 0 ? { skipUndoSnapshot: true } : undefined));
      lastQuickRenderedRef.current.delete(finding.id);
      const ids = selectedQuickFindingIds(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id));
      setSelectedQuickIds(new Set(ids));
      if (outcomes.includes("preserved-manual")) {
        toast({
          title: "Selection cleared",
          description: "Edited clinical text was kept.",
        });
      }
      return "removed";
    }
  }, [quickSide, toast, studySetup.matchedStudyRegion]);
  handleQuickToggleRef.current = handleQuickToggle;
  applyCatalogAfterConfirmRef.current = handleQuickToggle;
  selectedQuickIdsRef.current = selectedQuickIds;

  useEffect(() => {
    if (!quickSideMountedRef.current) {
      quickSideMountedRef.current = true;
      return;
    }
    // Nothing has been chosen yet, so there is no answer to re-apply. Running on
    // the empty value would rewrite every sided row's ledger laterality to ""
    // (`relateralizePatches` stamps `laterality: side` on each patch it touches)
    // while leaving the sentences on the page alone — a ledger that disagrees
    // with the report.
    if (!quickSide) return;
    useWorkspace.getState().relateralizePatches(quickSide);
    for (const [id, prev] of lastQuickRenderedRef.current) {
      lastQuickRenderedRef.current.set(id, {
        findings: prev.findings ? applySide(prev.findings, quickSide) : prev.findings,
        impression: prev.impression ? applySide(prev.impression, quickSide) : prev.impression,
        technique: prev.technique,
        recommendation: prev.recommendation,
      });
    }
  }, [quickSide]);

  const handleEditBeforeInsert = useCallback((finding: QuickFinding) => {
    if (contentLocked) return;
    setStudyLocalEdit(finding);
  }, [contentLocked]);

  const applyStudyLocalEdit = useCallback((override: StudyLocalTextOverride) => {
    const f = studyLocalEdit;
    if (!f) return;
    studyTextOverridesRef.current.set(f.id, override);
    setStudyLocalEdit(null);
    const patched: QuickFinding = {
      ...f,
      findingText: override.finding,
      impressionText: override.impression,
      techniqueText: override.technique,
      recommendationText: override.recommendation,
    };
    if (!selectedQuickIds.has(f.id)) {
      handleQuickToggle(patched, true);
    } else {
      handleQuickToggle(f, false);
      handleQuickToggle(patched, true);
    }
  }, [studyLocalEdit, selectedQuickIds, handleQuickToggle]);

  const appendFindings = useCallback((text: string) => {
    useWorkspace.getState().mergeField("findings", text, "companion");
  }, []);

  const jumpQueue = useMemo(() => {
    const q = patientJumpFilter.trim().toLowerCase();
    if (!q) return studies;
    // Server search (workflow) already filters when patientJumpFilter is set;
    // keep a light client pass for nested Study shape / stale rows.
    return studies.filter((s: Study) => {
      const patient = s.patient?.name ?? "";
      const hay = `${patient} ${s.modality ?? ""} ${s.accession ?? ""} ${s.studyDescription ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [studies, patientJumpFilter]);

  // ─── Sync workflow queue into Z.ai store (single ingress — no raw pacs dump) ─
  // useReportingWorkflow already owns the shared "radiology-pacs-worklist" query.
  // A second direct fetch used to overwrite nested `patient` with flat API rows
  // and crash WorklistStrip on `s.patient.id` a few seconds after load.
  //
  // Always include currentRow even when it falls outside modality/date scope —
  // otherwise Orient → Full Report Formats sticks on "Select a study" while the
  // editor still shows the open patient (currentRow comes from fullQueue).
  useEffect(() => {
    const q = workflow.queue ?? [];
    const current = workflow.currentRow;
    if (current && !q.some((s) => Number(s.id) === Number(current.id))) {
      setStudies([current, ...q]);
    } else {
      setStudies(q);
    }
  }, [workflow.queue, workflow.currentRow, setStudies]);

  // Server-backed whole-report formats + chocolate macros (migrate localStorage once).
  // Abnormal-pattern library hydrates in the same mount (seeds until pacs rows arrive).
  useEffect(() => {
    void useWorkspace.getState().hydrateContentLibraries();
    useWorkspace.getState().hydrateAbnormalPatternLibrary(null);
  }, []);

  useEffect(() => {
    useWorkspace.getState().hydrateAbnormalPatternLibrary(pacsSettingsRows ?? null);
  }, [pacsSettingsRows]);

  // ─── A-02: the DICOM UID follows the authoritative route study, never ahead of it ─
  // The route `studyId` is the canonical active reporting study, and
  // `useDraftPersistence` now assigns `activeStudyId` inside the SAME setState as the
  // clinical reset, so identity and content can no longer move separately. The separate
  // mirror effect that used to live above this one is deleted: it bailed with
  // `if (!studies.some(s => s.id === sid)) return;`, so a study that had not yet landed
  // in the scoped queue left the PREVIOUS study authoritative while the screen showed
  // the new one — and because `recomputeCopilot` stamped items from that same lagging
  // value, #840's insert guard compared a value against itself and could never fire.
  //
  // `workflow.currentRow` is derived strictly from the route id
  // (`useReportingWorkflow.ts:234-238` — fullQueue/queue.find(id === currentStudyId)),
  // so a non-null row IS the open study. That is still asserted explicitly below rather
  // than trusted, because the entire point of this change is that a UID must never be
  // attributed to a study it was not read from. When the row is not loaded yet the UID is
  // left null — genuinely unknown — instead of retaining the previous study's UID.
  //
  // `studyId` is in the dependency list on purpose: the reset effect has just nulled the
  // UID, and if this study's row was ALREADY loaded (navigating Back to a previously
  // opened study) the UID value would not have changed and this effect would otherwise
  // never re-run, stripping the new study of its UID for the whole session.
  useEffect(() => {
    const row = workflow.currentRow;
    const ownsRow = Boolean(row) && Number(row?.id) === Number(studyId);
    const uid = ownsRow ? (row?.studyInstanceUID ?? null) : null;
    const prev = useWorkspace.getState().activeStudyInstanceUID;
    if (prev === uid) return;
    useWorkspace.setState({
      activeStudyInstanceUID: uid,
      activeAnchor: null,
    });
  }, [studyId, workflow.currentRow?.id, workflow.currentRow?.studyInstanceUID]);

  // ─── Auto-open first study when the workspace has no URL study ─────────────
  useEffect(() => {
    if (studyId) return;
    if (studies.length === 0 || activeStudyId) return;
    // One ranking authority (#1167): the shared rank mirrors the server's
    // triage doctrine (stat > emergency > urgent > vip > routine). The private
    // map here had no emergency tier and tied vip with urgent, so the first
    // study the workspace auto-opened could be a routine while an emergency
    // waited in the queue.
    const sorted = [...studies].sort(
      (a: Study, b: Study) => (studyPriorityRank(a.priority) - studyPriorityRank(b.priority)) || (a.tatMinutes - b.tatMinutes),
    );
    if (sorted[0]) openStudy(sorted[0].id);
  }, [studies, activeStudyId, studyId, openStudy]);

  // ─── The Templates screen's rows ARE the Normal Formats ────────────────────
  // The auto-bootstrap and Quick Normal read the format library, which until now
  // was its own hard-coded system, so wording edited on the Templates screen
  // could never change what printed. Every complete normal row becomes a format
  // here and shadows the built-in copy of the same examination.
  useEffect(() => {
    if (!studySetup.templatesLoaded) return;
    useWorkspace.getState().ingestStructuredNormalFormats(studySetup.templates);
  }, [studySetup.templates, studySetup.templatesLoaded]);

  // ─── Normal auto-bootstrap (usg-reports concept; ONE-TIME, new report) ──
  //
  // OPEN STUDY → appropriate COMPLETE NORMAL REPORT already present.
  // Applies the single high-confidence complete-normal Full Report Format via
  // the ordinary applyFormatById path — byte-identical to a radiologist
  // clicking that format (same overwrite analysis, region bridge, autosave
  // generation bump, usage counter). Protocol / template autofill that landed
  // first is replaced, so technique, findings, impression, and recommendation
  // stay one document for the billed exam. Never fires when a server draft
  // exists, when the radiologist (or a finding, or an AI draft) already owns
  // text, when a local backup snapshot holds prior work, when the study is
  // locked/finalized, or when identity is ambiguous.
  useEffect(() => {
    if (!studyId) return;
    if (draftHydratedStudyId !== studyId) return; // hydration settled for THIS study
    if (existingDraft) return; // saved report — never re-bootstrap
    if (contentLocked) return; // locked-by-other / finalized / signed
    if (normalBootstrapDoneRef.current === studyId) return; // one decision per study
    // The Normal Format for this exam may still be arriving from the Templates
    // screen. Deciding before it lands would commit to the built-in wording and
    // never revisit, which is the failure this change exists to remove.
    if (!studySetup.templatesLoaded) return;
    const state = useWorkspace.getState();
    if (!reportBodyAllowsNormalBootstrap({
      technique: state.techniqueText,
      findings: state.findingsText,
      impression: state.impressionText,
      recommendation: state.recommendationText,
      fieldProvenance: state.fieldProvenance,
    })) return; // a finding, dictated text, or an AI draft already owns the report
    const backup = draftBackup.peek();
    if (
      backup
      && (
        String(backup.rawFindings ?? "").trim()
        || String(backup.technique ?? "").trim()
        || (Array.isArray(backup.impression) ? backup.impression.join("").trim() : "")
      )
    ) return; // prior local work for this study — offer the restore banner instead
    // The billed exam name is part of the exam's identity, not a label: an MRI
    // booked in DICOM as "MR BRAIN" but billed "MRI Brain with contrast" must not
    // auto-open the plain technique. Quick Normal already reads it this way, and
    // the two paths have to pick the same report.
    const ctx = billedStudyContextForNormal(
      studySetup.studyContext,
      billedNameFromWorklistRow(workflow.currentRow, worklistDetailQ.data),
    );
    const decision = resolveNormalBootstrapFormat({
      ctx,
      formats: state.reportFormats,
      // The auto-open must not undo what the radiologist recorded: a report moved
      // to one segment opens with a format that documents that segment, not with
      // the booked examination's whole-spine screening template.
      records: state.regionTransitions,
    });
    if (decision == null) return; // identity / library unresolved yet — may retry
    normalBootstrapDoneRef.current = studyId; // decision made — never again this study
    if (decision.status !== "apply") {
      // Same words the button gives, on the strip that is already there — so a blank
      // page is never just a blank page.
      const why = quickNormalOutcomeMessage(decision);
      setNormalSkipReason(`${why.title} — ${why.description}`);
      console.debug("[radiology-workspace] normal bootstrap skipped:", decision.reason);
      return;
    }
    // Capture undo snapshot BEFORE auto-mutation (same shape as Start Report).
    const fields = studySetupSetters.readFields();
    startReportUndoRef.current = {
      ...fields,
      findingsMap: { ...findingsMap },
      useStructured,
      selectedTemplateId: studySetup.selectedTemplateId,
    };
    // `automatic` because nobody pressed anything: the study's region came from the
    // billed code, and letting the format that opened itself write a region override
    // would make the report claim the radiologist chose it.
    state.applyFormatById(decision.format.id, { regionChoice: "automatic" });
    // The complete normal report is the visible narrative baseline (the
    // structured-template cards remain available via the template picker).
    setUseStructured(false);
    setAppliedNormalFormatName(decision.format.name || "Normal format");
    setNormalSkipReason(null);
    setBootstrapAppliedThisOpen(true);
    setCanUndoStartReport(true);
    toast({
      title: "Normal report ready",
      description: "Review images, record deviations, finalize.",
      duration: 2500,
    });
  }, [
    studyId, draftHydratedStudyId, existingDraft, contentLocked, draftBackup,
    studySetup.studyContext, studySetup.selectedTemplateId, studySetupSetters,
    findingsMap, useStructured, toast, setUseStructured, reportFormatCount,
    studySetup.templatesLoaded, studySetup.templates,
    workflow.currentRow?.testName, workflow.currentRow?.billedTestName,
    workflow.currentRow?.studyDescription,
  ]);

  // ─── Few-clicks — land the caret in Findings when a fresh study opens ──────
  // Typists paid one click per study just to enter text into the field the
  // report starts in. Fired once per study, after the draft hydrates (so a
  // reopened draft is the text being focused beside, not a blank), and never
  // when the study is locked (nothing to type) or when somebody — a text
  // field or the OHIF iframe — already owns focus.
  const autoFocusedFindingsStudyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!studyId) return;
    if (draftHydratedStudyId !== studyId) return; // hydration settled for THIS study
    if (contentLocked) return; // signed / locked-by-other — nothing to type
    if (autoFocusedFindingsStudyRef.current === studyId) return; // once per study
    autoFocusedFindingsStudyRef.current = studyId;
    const active = document.activeElement;
    if (active instanceof HTMLIFrameElement) return; // the viewer has the radiologist
    if (
      active instanceof HTMLElement
      && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
    ) return; // already typing somewhere useful
    focusReportField("findings");
  }, [studyId, draftHydratedStudyId, contentLocked, focusReportField]);

  // ─── Preload next study at 80% findings completion ──────────────────────────
  useEffect(() => {
    if (!preloadTriggered || !activeStudyId) return;
    const completedSet = useWorkspace.getState().completedStudyIds;
    const remaining = studies.filter((s: Study) => !completedSet.has(s.id) && s.id !== activeStudyId);
    // Same shared rank as the auto-open (#1167): the preloader decides which
    // study gets its priors fetched, its measurements read and the AI model
    // warmed — an emergency ranked as routine meant the study that most
    // needed to open fast opened cold, while a routine got the warm-up.
    remaining.sort((a: Study, b: Study) => (studyPriorityRank(a.priority) - studyPriorityRank(b.priority)) || (a.tatMinutes - b.tatMinutes));
    const next = remaining[0];
    if (next) {
      useWorkspace.getState().setNextStudy(next.id);
      const patientId = next.patient?.id;
      const priorUrl = patientId && patientId !== "0"
        ? `/api/radiology-copilot/prior-studies?patientId=${encodeURIComponent(patientId)}`
        : null;
      Promise.allSettled([
        priorUrl ? api.get(priorUrl) : Promise.resolve(null),
        api.get(`/api/radiology/report-generator/measurements?studyId=${encodeURIComponent(next.id)}`),
        next.studyInstanceUID
          // Warm-up only: this exists to pull the model into memory before the
          // radiologist reaches the next study. It carries no findings, and its
          // result is discarded, so it must not leave a stored AI draft behind
          // for that study — `warmUpOnly` tells the server exactly that.
          ? api.post("/api/ai-reporting/draft", { studyInstanceUID: next.studyInstanceUID, modality: next.modality, warmUpOnly: true })
          : Promise.resolve(null),
      ]).then(() => useWorkspace.getState().markNextStudyPreloaded());
    }
  }, [preloadTriggered, studies, activeStudyId]);

  const stageAiProposal = useCallback(
    (proposal: { findingKey: string; text: string; draftId?: number | string | null }) => {
      setStagedAiProposals((prev) =>
        stageShadowProposal(prev, {
          findingKey: proposal.findingKey,
          text: proposal.text,
          draftId: proposal.draftId,
          source: "shadow_ai",
        }),
      );
    },
    [],
  );

  /**
   * Apply is the one write this queue has. It goes through the store's accepted-AI
   * boundary (`applyAiComposerAccepted`, which refuses a signed report and records
   * `ai-draft` provenance) and then through the SAME awaited draft save the Save
   * button, the autosave and Finalize use — so "added to the report" is a claim about
   * a server row, not about the browser's memory. `ensureDraftOnce` alone was not
   * that: it only guarantees a draft id exists, which left the merged text waiting
   * for the 30-second autosave, and a radiologist who closed the tab inside that
   * window lost the sentence while the queue said it had been applied.
   */
  const applyStagedAiProposals = useCallback(async () => {
    const staged = stagedAiProposals;
    if (staged.length === 0) return;
    const state = useWorkspace.getState();
    const nextFindings = materializeStagedProposals(state.findingsText, staged);
    if (nextFindings === state.findingsText) {
      // Nothing to add is not a failure. Clearing the queue here is what stops a
      // sentence that is already in the report from being offered again forever.
      setStagedAiProposals([]);
      toast({
        title: "Already in the report",
        description: "Nothing was added — this report already says it.",
        duration: 6000,
      });
      return;
    }
    const outcome = state.applyAiComposerAccepted({
      findings: nextFindings,
      impression: state.impressionText,
      recommendation: state.recommendationText,
    });
    if (outcome === "blocked") {
      // The queue is kept: the sentence is still wanted, this report simply cannot be
      // written. Clearing it would throw the clinician's Accept away.
      toast({
        title: "This report is signed",
        description: "Nothing was changed. The signature has to be withdrawn in Report Hub before AI text can be added.",
        variant: "destructive",
        duration: 10000,
      });
      return;
    }
    await ensureDraftOnce();
    const savedId = await saveDraft({ silent: true });
    if (savedId == null) {
      // The text is in the editor and marked dirty, so the autosave will still try —
      // but Apply has not succeeded, and saying otherwise is how a clinician closes a
      // tab believing a sentence is saved when it is not.
      toast({
        title: "Could not save the report",
        description: "The accepted text is still in the Findings editor, so nothing is lost. Save again, or check the connection first.",
        variant: "destructive",
        duration: 10000,
      });
      return;
    }
    setStagedAiProposals([]);
    toast({
      title: "Added to the report",
      description: "The accepted AI text is now in this study's Findings and saved.",
      duration: 6000,
    });
  }, [stagedAiProposals, ensureDraftOnce, saveDraft, toast]);

  /**
   * The reporting workspace's own queue of AI drafts this clinician sent from
   * anywhere — including the image viewer's AI drawer, which has no report body of
   * its own to write and never should have. `POST /api/ai-reporting/insert-to-report`
   * marks a saved draft `status='inserted'`, which means "queued for this study's
   * report", and this is where it becomes visible: staged, reviewable, and applied
   * only by the line above.
   *
   * Four things decide whether a row is offered:
   *  - it is read for the UID of the row the workspace is standing on, re-checked
   *    against the store's own mirror before staging, so a slow response for Patient
   *    A cannot land in Patient B's queue;
   *  - a sentence the report already contains is not offered again, which is what
   *    makes Apply safe to press twice and a queued row safe to leave queued;
   *  - text that reads as the model talking rather than as report writing is not
   *    offered at all, and the clinician is told that rather than left with a draft
   *    that silently never arrives (`unfitReportInserts`);
   *  - a failed read offers nothing silently, because this study having no reachable
   *    AI queue is the ordinary case, not an event worth interrupting a report for.
   */
  useEffect(() => {
    const row = workflow.currentRow;
    const ownsRow = Boolean(row) && Number(row?.id) === Number(studyId);
    const uid = ownsRow ? (row?.studyInstanceUID ?? null) : null;
    if (!uid) return;
    let alive = true;
    void api
      .get<AiReportDraftRow[]>(`/api/ai-reporting/drafts/${encodeURIComponent(uid)}`)
      .then((rows) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return;
        if (useWorkspace.getState().activeStudyInstanceUID !== uid) return;
        const live = useWorkspace.getState();
        const queue = pendingReportInserts(rows).filter(
          (p) => !proposalAddsNothing(live.findingsText, p.text),
        );
        for (const p of queue) {
          stageAiProposal({ findingKey: p.findingKey, text: p.text, draftId: p.draftId });
        }
        // A draft withheld on shape is a refusal the clinician asked for by pressing the
        // button, so it has to arrive as one. The door refuses such a send now, but a row
        // stamped `inserted` before that guard existed still sits in this study's history,
        // and dropping it in silence would leave a saved draft that appears to be queued
        // and never shows up. Named by count and by shape only — no draft text, no patient.
        const withheld = unfitReportInserts(rows);
        if (withheld.length > 0) {
          toast({
            title: withheld.length === 1
              ? "1 saved AI draft is not report text"
              : `${withheld.length} saved AI drafts are not report text`,
            description:
              "It reads as the model talking about the report — a preamble, Markdown, or structured output — "
              + "so it was left out of the review queue and nothing was written. Open Saved Drafts in the AI "
              + "assistant, keep only the sentences you want as findings, and send it again.",
            variant: "destructive",
            duration: 14000,
          });
        }
        // The one control that accepts a queued sentence is the "N proposal(s) staged /
        // Apply" bar, and it lives on the rail's AI tab — which is not the tab the rail
        // opens on (`quick-insert`). So a clinician sent here from the viewer's drawer
        // would land on a report with their text queued and no sign of it. This only
        // fires when something is genuinely waiting to be reviewed, which is the moment
        // they asked for by pressing the button.
        if (queue.length > 0) openReportingToolsRef.current("ai");
      })
      .catch(() => { /* nothing queued for this study */ });
    return () => { alive = false; };
  }, [studyId, workflow.currentRow?.id, workflow.currentRow?.studyInstanceUID, stageAiProposal, toast]);

  // ─── AI auto-impression (Ctrl+I) — before commands so keyboard can close over it ─
  const { triggerAiImpression } = useTriggerAiImpression({
    studyInstanceUID: workflow.currentRow?.studyInstanceUID,
    modality: workflow.currentRow?.modality,
  });

  // ─── Command dispatcher + keyboard (Phase 4 hook) ─────────────────────────
  const { commandDispatcher: _commandDispatcher, handleFrictionlessSaveAndNext: _handleFrictionlessSaveAndNext } = useWorkspaceCommands({
    commandDispatcherRef,
    saveDraft,
    finalizeReport,
    workflow,
    studyId,
    goNextStudy,
    goPrevStudy,
    focusReportField,
    enterReportingFocusMode,
    setLayoutMode,
    openReportingToolsRef,
    verifyActionRef,
    printActionRef,
    rightPanelRef,
    leftPanelRef,
    contentLocked,
    toast,
    leftCollapsed,
    rightCollapsed,
    showEmbeddedViewer,
    setReportingToolsTab,
    voiceSession,
    voiceSettings,
    focusVoiceBar,
    handleUndoLastAbnormal,
    activateReportSection,
    exclusiveReportSectionsRef,
    enterReportingFocusModeRef,
    triggerAiImpression,
    setShortcutHelpOpen,
  });



  const frozenKeyImagesQ = useFrozenKeyImages(draftId);
  const frozenKeyImages = frozenKeyImagesQ.data?.items ?? [];
  const keyImageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const img of frozenKeyImages) {
      if (!img.observationId) continue;
      counts[img.observationId] = (counts[img.observationId] ?? 0) + 1;
    }
    return counts;
  }, [frozenKeyImages]);
  const structuredViewerMeasurements = useWorkspace((s: WorkspaceStore) => s.structuredViewerMeasurements);
  const measurementChips = useMemo(() => {
    const chips: Record<string, string> = {};
    for (const m of structuredViewerMeasurements.items) {
      if (!m.observationId) continue;
      const chip = formatMeasurementChip(m);
      if (!chip) continue;
      // Prefer newest / last-written chip per observation
      chips[m.observationId] = chip;
    }
    return chips;
  }, [structuredViewerMeasurements]);
  const observationLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const p of appliedPathologyPatches) {
      const obs = p.observation;
      labels[p.id] = [obs?.level, obs?.laterality, obs?.concept].filter(Boolean).join(" ") || p.id;
    }
    return labels;
  }, [appliedPathologyPatches]);

  // The booked examination on its own, without the applied format's title
  // overriding it. A clinic's format names the region the report documents, so
  // the PDF's heading can be narrower than what was booked — and the sentence
  // that explains the difference has to be asked for with the booked name.
  //
  // This is the billed catalogue name, the same identity the server's print route
  // builds its heading from (`tests.name` → worklist StudyDescription), and
  // deliberately not `studySetup.testName`: that composite falls back to the
  // selected template's name, and a template named for the region being reported
  // would make booked and documented agree, which the shared rule reads as
  // "nothing to explain" — the sentence would silently disappear again.
  const bookedStudyNameForExport =
    workflow.currentRow?.testName
    || workflow.currentRow?.billedTestName
    || workflow.currentRow?.studyDescription
    || worklistDetailQ.data?.testName
    || worklistDetailQ.data?.billedTestName
    || worklistDetailQ.data?.studyDescription
    || null;

  const studyNameForExport = resolveCanonicalStudyTitle({
    // ONE precedence for every door (see resolveCanonicalStudyTitle): the
    // billed examination first, the DICOM description second, the applied
    // format's title last. The preview used to draw the format title while
    // the signed artifact stored the DICOM description and the print route
    // printed the billed name — one study, three headings.
    billedName: bookedStudyNameForExport,
    dicomDescription: worklistDetailQ.data?.studyDescription
      ?? workflow.currentRow?.studyDescription
      ?? null,
    formatTitle: appliedFormatReportTitle,
  }) || "Radiology Report";

  // ─── Canonical report demography (ERP > DICOM > manual override) ─────────
  // `worklistDetailQ` is declared with the study-lock section above, because the
  // lock needs its `status`; `canonicalDemography` below still consumes it.

  // The by-id detail read is keyed on the open study, so its patientId
  // survives the reading-queue filter that can hide the queue row (deep
  // link, filter change, other-modality study). Keying the master fetch on
  // the queue row alone made a deep-linked study print the stale DICOM age
  // tag — the exact master-precedence rule below exists to beat.
  const masterPatientId =
    worklistDetailQ.data?.patientId ?? workflow.currentRow?.patientId ?? null;
  const patientMasterQ = useQuery<{
    dateOfBirth?: string | null;
    ageValue?: number | null;
    ageUnit?: string | null;
    gender?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }>({
    queryKey: ["patient-master", masterPatientId],
    queryFn: () => api.get(`/api/patients/${masterPatientId}`),
    enabled: !!masterPatientId,
    staleTime: 60_000,
    retry: false,
  });

  const doctorsCatalogQ = useQuery<{ name: string; degree?: string | null }[]>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get<{ doctors: { name: string; degree?: string | null }[] }>("/api/doctors").then((d) => d.doctors ?? []),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const signOffProfiles = useWorkspace((s: WorkspaceStore) => s.signOffProfiles);
  const signerLine = useMemo(() => {
    const modality = (workflow.currentRow?.modality ?? "CT") as import("@/lib/zai-workspace/types").Modality;
    const profile = lookupProfile(signOffProfiles, modality);
    return profile ? formatSignOff(profile) : "";
  }, [signOffProfiles, workflow.currentRow?.modality]);

  const canonicalDemography = useMemo(() => {
    const row = workflow.currentRow as Record<string, unknown> | null | undefined;
    const detail = worklistDetailQ.data ?? null;
    const master = patientMasterQ.data ?? null;
    const detailMeta = worklistDetailQ.data?.dicomMetadata;
    let dicomMeta: Record<string, unknown> = {};
    if (detailMeta && typeof detailMeta === "object") {
      dicomMeta = detailMeta as Record<string, unknown>;
    } else if (typeof detailMeta === "string" && detailMeta.trim()) {
      try { dicomMeta = JSON.parse(detailMeta) as Record<string, unknown>; } catch { /* ignore */ }
    } else if (row?.dicomMetadata && typeof row.dicomMetadata === "object") {
      dicomMeta = row.dicomMetadata as Record<string, unknown>;
    }
    // The day the age below is evaluated on: the same two sources, in the same
    // order, as the `studyDate` this card prints. Without it the card aged the
    // patient from today's clock, so reopening a study scanned last year printed
    // an age a year older than the examination it was describing.
    const examinationDate = String(detail?.studyDate ?? row?.studyDate ?? "").trim() || null;
    const erpAge = resolveDisplayAge(
      { age: row?.age ?? worklistDetailQ.data?.age, patientAge: row?.patientAge },
      master,
      dicomMeta.PatientAge != null ? String(dicomMeta.PatientAge) : null,
      examinationDate,
    );
    const merged = mergeReportDemography({
      // The by-id detail read is keyed on the open study, so it is always this
      // study; `workflow.currentRow` is a row of the *filtered* queue and is
      // absent the moment a filter excludes the open report. Reading identity
      // off the queue alone printed a report with no patient name and no date.
      erp: {
        patientName: detail?.patientName ?? row?.patientName,
        age: erpAge,
        // Blank-safe chain: the worklist row stores "" for a blank DICOM
        // PatientSex, and a ?? chain would stop there, never reaching the
        // patient master's registered gender.
        sex: [detail?.sex, row?.sex, master?.gender]
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .find(Boolean) ?? "",
        patientId: detail?.patientId ?? row?.patientId,
        // The by-id read carries the UHID too, so a queue filter that hides the
        // open study cannot drop the identifier from the printed report.
        uhid: detail?.uhid ?? row?.uhid,
        accessionNumber: detail?.accessionNumber ?? row?.accessionNumber,
        // The billed test name is the fallback the demography merge ALREADY
        // supports (erp.testName in reportDemography) — without it, a blank
        // DICOM description printed "Study: —" on the card while the report
        // heading named the billed examination.
        testName: detail?.testName ?? detail?.billedTestName ?? row?.testName ?? row?.billedTestName ?? null,
        studyDescription: detail?.studyDescription ?? row?.studyDescription,
        studyDate: detail?.studyDate ?? row?.studyDate,
        referringDoctor: detail?.referringDoctor ?? row?.referringDoctor,
        dateOfBirth: master?.dateOfBirth,
      },
      dicom: dicomMeta,
      overrides: demographyOverrides,
      referringDoctorCatalog: doctorCatalogLabels(doctorsCatalogQ.data ?? []),
    });
    return merged;
  }, [workflow.currentRow, patientMasterQ.data, worklistDetailQ.data, demographyOverrides, doctorsCatalogQ.data]);

  useEffect(() => {
    canonicalDemographyRef.current = canonicalDemography;
  }, [canonicalDemography]);

  // ─── Export / share / verify (Phase 3) ─────────────────────────────────────
  const {
    exportingWord,
    exportingPdf,
    printingLikeFinal,
    presentationTemplates,
    clinicSettings,
    imageRefs,
    reportLayout,
    livePrintBodyHtml,
    previewHtml,
    handleExportWord,
    handleExportPdf,
    handlePrintLikeFinal,
    confirmedPrintLikeFinal,
    printCriticalNudge,
    setPrintCriticalNudge,
    handleSaveTeachingCase,
    handleShare,
    linkedReportId,
    signedReport,
    verifyGate,
    canShowVerify,
    handleVerifyReport,
    confirmedVerifyReport,
    confirmVerify,
    setConfirmVerify,
    verifyBusy,
    printFormat,
    printFormatLocked,
    stepPrintFormat,
  } = useWorkspaceExportShare({
    studyId,
    draftId,
    previewLayoutOverride,
    saveDraft,
    ensureDraftOnce,
    dirty: isDirty,
    contentLocked: signedContentLocked,
    checklistComm,
    toast,
    qc,
    workflow,
    existingDraft,
    canonicalDemography,
    studyNameForExport,
    bookedStudyNameForExport,
    clinicalHistoryText,
    techniqueText,
    findingsText,
    impressionText,
    recommendationText,
    useStructured: debouncedUseStructured,
    findingsMap: debouncedFindingsMap,
    impressionStyle,
    headingCase,
    sectionSpacing,
    showLetterpadHeader,
    signerLine,
    findingsProvenance,
    impressionProvenance,
    frozenKeyImages,
    doctorsCatalog: doctorsCatalogQ.data ?? [],
    session,
    sessionFresh,
    canVerifyRef,
    verifyActionRef,
    linkedReportIdRef,
    setWhatsappShareOpen,
  });

  // Few-clicks — Ctrl+P dispatches to the same print-like-final the top-bar
  // Print button runs (handlePrintLikeFinal owns its own guards: the
  // critical-comms nudge, save-before-print, signed-study passthrough).
  printActionRef.current = () => { void handlePrintLikeFinal(); };

  // ─── OHIF viewer bridge (Phase 4 hook) ─────────────────────────────────────
  const {
    ohifUnavailable,
    canalApByLevel,
    requestOhifAnnotatedCapture,
    requestFrozenKeyImageCapture,
    addCurrentOhifImageToReport,
    attachDisplayedImageRef,
    ohifImageAdding,
    ohifTargetOriginRef,
  } = useOhifViewerBridge({
    studyId,
    draftId,
    isLocked,
    isFinalized,
    captureBusy,
    showEmbeddedViewer,
    layoutMode,
    embeddedViewerRef,
    toast,
    ensureDraftOnce,
    reportIdentity,
    imageRefs,
    frozenKeyImagesQ,
    appliedPathologyPatches,
  });



  const openReportingTools = useCallback((
    tab: ReportingToolsTab,
    source?: QuickInsertSource,
  ) => {
    setReportingToolsTab(tab);
    if (source) setQuickInsertSource(source);
    rightPanelRef.current?.expand();
  }, []);
  openReportingToolsRef.current = openReportingTools;

  const openLegacyTab = useCallback((tab: LegacyBoxTab) => {
    setLegacyTab(tab);
    setReportingToolsTab("more");
    rightPanelRef.current?.expand();
  }, []);
  openLegacyTabRef.current = openLegacyTab;

  // ─── Few-clicks — the deep-link intents the worklist buttons already promise ──
  // "Review AI draft in Reporting Workspace" navigates with ?ai=1 and "Print
  // UI" with ?tab=print (reportingWorkspacePath builds both), but nothing ever
  // consumed them: the radiologist landed on the default Findings view and had
  // to open the AI rail / print tab by hand. Same one-shot pattern as ?focus=1
  // — read, act, strip the param (a reload or a later navigation is a fresh
  // ask, and a manual panel close mid-session is never overridden).
  useEffect(() => {
    if (!studyId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("ai") !== "1" && params.get("tab") !== "print") return;
    if (params.get("ai") === "1") {
      // The AI review surface: the rail tab the queued-proposal "Apply" bar
      // lives on — the same tab the queue effect opens when a proposal waits.
      openReportingToolsRef.current("ai");
    } else if (params.get("tab") === "print") {
      openLegacyTabRef.current("print");
    }
    params.delete("ai");
    params.delete("tab");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
  }, [studyId]);

  // ─── PCPNDT gate (OB USG Form F check) ──────────────────────────────────────
  const modalityRaw = workflow.currentRow?.modality ?? "";
  const isUltrasound = isUltrasoundModality(modalityRaw);
  const isCtModality = modalityRaw.trim().toUpperCase().startsWith("CT");
  const isMriModality = modalityRaw.trim().toUpperCase().startsWith("MR");
  const companionEligible = isUltrasound || isCtModality;
  // Matched DICOM region (tab name) — not raw bodyPart
  const studyRegion = studySetup.matchedStudyRegion
    ?? (workflow.currentRow as { bodyPart?: string | null } | null)?.bodyPart
    ?? workflow.currentRow?.studyDescription
    ?? null;
  const qualityScore = useMemo(
    () => computeQualityScore({
      findings: findingsText,
      impression: [impressionText],
      technique: techniqueText,
      checklistPercent: studySetup.checklistPercent,
    } as any),
    [findingsText, impressionText, techniqueText, studySetup.checklistPercent],
  );

  const isObUsg = isObstetricUsgStudy(modalityRaw, workflow.currentRow?.studyDescription ?? "");
  const { data: pcpndtCompliance } = useQuery<{ compliant: boolean; errors?: string[]; missing?: string[]; formFId?: number | null }>({
    queryKey: ["pcpndt-compliance", workflow.currentRow?.patientId],
    queryFn: () => api.get(`/api/patient-reports/pcpndt-compliance/${workflow.currentRow!.patientId}`),
    enabled: !!workflow.currentRow?.patientId && isObUsg,
    refetchInterval: visibleTabRefetchInterval(isTabVisible, 30000),
  });
  const pcpndtBlocked = isObUsg && pcpndtCompliance?.compliant !== true;
  pcpndtBlockedRef.current = pcpndtBlocked;
  const pcpndtMissing = pcpndtCompliance?.errors ?? pcpndtCompliance?.missing ?? [];

  // Warm MRI DICOMweb for Today & Yesterday MR studies (not the whole "All dates" queue).
  const mriWarmBrowserTargets = useMemo(
    () => mriWarmTargetsFromRows(workflow.fullQueue ?? workflow.queue ?? [], BROWSER_DICOMWEB_BASE),
    [workflow.fullQueue, workflow.queue],
  );

  const { data: mriWarmStatus } = useQuery<{
    running?: boolean;
    lastWarmed?: number;
    candidates?: number;
    pausedForPeakHours?: boolean;
    orthancReachable?: boolean | null;
    lastRunAt?: string | null;
  }>({
    queryKey: ["mri-warm-cache-status"],
    queryFn: () => api.get("/api/radiology/mri-warm-cache/status"),
    refetchInterval: visibleTabRefetchInterval(isTabVisible, 30_000),
    staleTime: 15_000,
  });

  const warmMriTodayYesterday = useMutation({
    mutationFn: () => api.post("/api/radiology/mri-warm-cache/run", { force: true, mode: "today_yesterday" }),
    onSuccess: () => {
      prefetchMriStudies(mriWarmBrowserTargets);
      void qc.invalidateQueries({ queryKey: ["mri-warm-cache-status"] });
      toast({
        title: "MRI warm started",
        description: "Today & Yesterday MR studies are loading into Orthanc / DICOMweb cache.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "MRI warm failed", description: err.message, variant: "destructive" });
    },
  });

  const mriWarmCountLabel = useMemo(() => {
    const n = mriWarmBrowserTargets.length;
    if (n === 0) return null;
    return `${n} MR`;
  }, [mriWarmBrowserTargets.length]);

  useEffect(() => {
    if (mriWarmBrowserTargets.length === 0) {
      if (workflow.currentRow?.studyInstanceUID && isMriModality) {
        prefetchMriStudies([{ studyInstanceUID: workflow.currentRow.studyInstanceUID, dicomWebBaseUrl: BROWSER_DICOMWEB_BASE }]);
      }
      return;
    }
    prefetchMriStudies(mriWarmBrowserTargets);
  }, [mriWarmBrowserTargets, workflow.currentRow?.studyInstanceUID, isMriModality]);

  useEffect(() => {
    if (!studyId) return;
    const idx = (workflow.queue ?? []).findIndex((s: { id: number }) => s.id === studyId);
    if (idx < 0) return;
    const next = workflow.queue[idx + 1] as { studyInstanceUID?: string | null; modality?: string | null } | undefined;
    if (!next?.studyInstanceUID) return;
    const m = (next.modality ?? "").trim().toUpperCase();
    if (m === "MR" || m.startsWith("MR")) {
      prefetchNextMriStudy({ studyInstanceUID: next.studyInstanceUID, dicomWebBaseUrl: BROWSER_DICOMWEB_BASE });
    }
  }, [workflow.queue, studyId]);

  // Prefetch next study report shell as soon as current study is open (not only at 80%).
  useEffect(() => {
    if (!studyId) return;
    const next = workflow.peekNext();
    if (!next || Number(next.id) === Number(studyId)) return;
    useWorkspace.getState().setNextStudy(String(next.id));
    void prefetchNextStudyReportShell({
      id: next.id,
      patientId: next.patientId,
      studyInstanceUID: next.studyInstanceUID ?? null,
      modality: next.modality,
    }).then(() => {
      useWorkspace.getState().markNextStudyPreloaded();
    });
  }, [studyId, workflow.queue, workflow.peekNext]);

  // Report Focus / open study: Reading Queue collapsed by default — Q expands it.
  // Clinic setting auto_collapse_queue_on_study_open (default true) can keep it open.
  useEffect(() => {
    if (!studyId) return;
    if (!autoCollapseQueueOnStudyOpen) return;
    requestAnimationFrame(() => leftPanelRef.current?.collapse());
  }, [studyId, autoCollapseQueueOnStudyOpen]);

  useEffect(() => {
    if (layoutMode !== "reportFocus") return;
    if (!autoCollapseQueueOnStudyOpen) return;
    requestAnimationFrame(() => leftPanelRef.current?.collapse());
  }, [layoutMode, autoCollapseQueueOnStudyOpen]);


  // Dual Screen: open Legacy Open Study (popup viewer). Fall back to Split if blocked.
  useEffect(() => {
    if (layoutMode !== "dualScreen") return;
    openLegacyTab("open-study");
  }, [layoutMode, studyId, openLegacyTab]);

  // ─── Compute derived state ──────────────────────────────────────────────────
  const study = studies.find((s: Study) => s.id === activeStudyId);
  const sessionMin = Math.floor((Date.now() - sessionStartedAt) / 60000);
  const showFatigue = sessionMin >= 90 && sessionMin % 90 < 2 && !fatigueCardDismissed;
  const findingsPct = study ? getFindingsCompletionPct(findingsText, study.modality) : 0;

  // ─── Accordion header props (Phase 5a hook) ────────────────────────────────
  const {
    accordionProps,
    sectionMeta,
    sectionStatus,
    referringDoctorName,
    findingsAssistedCount,
    findingsLintCount,
    reportLayoutLabel,
  } = useAccordionPropsBuilder({
    canonicalDemography,
    findingsText,
    findingsProvenance,
    findingsMap,
    useStructured,
    studyModality: study?.modality,
    studySex: study?.patient?.sex,
    reportLayout,
    studyRegions: studySetup.studyRegions ?? [],
    activeProtocolName: studySetup.activeProtocol?.name ?? null,
    testName: studySetup.testName,
    templateMismatch: studySetup.templateMismatch,
    clinicalHistoryText,
    techniqueText,
    impressionText,
    recommendationText,
    isCritical,
    hasPatient: !!workflow.currentRow,
    draftId,
    activeReportSection,
    activateReportSection,
    enterClinicalEditorFocus,
    enterReportingFocusMode,
    exclusiveReportSections,
    compactAccordion,
  });

  const brainSequenceContext = useMemo(
    () => parseBrainSequences(techniqueText),
    [techniqueText],
  );
  const mriBrainReportingOpts = {
    modality: workflow.currentRow?.modality,
    region: studyRegion,
    family: studySetup.studyContext?.family,
    studyDescription: workflow.currentRow?.studyDescription,
  };
  // MRI Lumbar V3 §40/§43 — the spine validators run for spine studies only, so
  // a brain/MSK report is never warned about lumbar level naming.
  const spineFamily = studySetup.studyContext?.family === "spine";
  const spineLumbarContext = isMriLumbarReportingContext({
    modality: workflow.currentRow?.modality,
    region: studyRegion,
    family: studySetup.studyContext?.family,
    spineSegment: studySetup.studyContext?.spineSegment,
    protocolName: studySetup.activeProtocol?.name ?? null,
    studyDescription: workflow.currentRow?.studyDescription ?? null,
  });
  // Level naming matters whenever LS detail is in play: the LS canvas, a
  // transitional-numbering scheme, or LS screening contributing prose.
  const spineLsLevelNamingActive = spineLumbarContext
    || isNonStandardNumbering(lumbarNumbering)
    || spineScreening.ls.performed;

  // MRI Dorsal V3 §33 — the thoracic validator adds the cord / conus / coverage
  // rules, which are not the lumbar list with different letters: in thoracic
  // reporting the safety question is acquired coverage, not a transitional
  // vertebra, and the structure at risk is the cord.
  const spineDorsalContext = isMriDorsalReportingContext({
    modality: workflow.currentRow?.modality,
    region: studyRegion,
    family: studySetup.studyContext?.family,
    spineSegment: studySetup.studyContext?.spineSegment,
    protocolName: studySetup.activeProtocol?.name ?? null,
    studyDescription: workflow.currentRow?.studyDescription ?? null,
  });
  const spineDorsalValidationActive = spineDorsalContext
    || spineScreening.dorsal.performed
    || !isDefaultDorsalNumbering(dorsalNumbering);

  // Dorso-Lumbar V3 §27 — a dedicated two-region study has its own safety
  // questions: coverage that must support a conus or cauda sentence, one junction
  // identity, and a composition that must not be worded as two screenings. It
  // runs alongside the dorsal/lumbar validators rather than replacing them,
  // because both halves of the spine are still being reported.
  const spineDorsoLumbarContext = isMriDorsoLumbarReportingContext({
    modality: workflow.currentRow?.modality,
    region: studyRegion,
    family: studySetup.studyContext?.family,
    spineSegment: studySetup.studyContext?.spineSegment,
    protocolName: studySetup.activeProtocol?.name ?? null,
    studyDescription: workflow.currentRow?.studyDescription ?? null,
  });
  const spineDorsoLumbarValidationActive = spineDorsoLumbarContext
    || isDorsoLumbarDedicated(studyComposition);

  const impressionContradictionWarnings = useMemo(() => [
    ...structuredCanalApContradiction(appliedPathologyPatches),
    ...ledgerSeverityContradiction(appliedPathologyPatches, impressionText),
    ...(spineLsLevelNamingActive
      ? lumbarTextContradictions({
          findingsText,
          impressionText,
          sequences: spineSequencesAvailable,
          numbering: lumbarNumbering,
        })
      : []),
    ...(spineDorsalValidationActive
      ? dorsalTextContradictions({
          findingsText,
          impressionText,
          sequences: spineSequencesAvailable,
          numbering: dorsalNumbering,
        })
      : []),
    // §4: a coverage change must surface the observations it strands, never
    // renumber them quietly.
    ...(spineDorsalValidationActive
      ? dorsalObservationReviewWarnings(appliedPathologyPatches, dorsalNumbering)
      : []),
    ...(spineDorsoLumbarValidationActive
      ? dorsoLumbarTextContradictions({
          findingsText,
          impressionText,
          state: dorsoLumbarNumbering,
          sequences: spineSequencesAvailable,
          composition: studyComposition,
          roles: {
            cervical: spineScreening.cervical.role,
            dorsal: spineScreening.dorsal.role,
            ls: spineScreening.ls.role,
          },
          patches: appliedPathologyPatches,
        })
      : []),
    ...(spineFamily
      ? screeningTextContradictions({
          findingsText,
          impressionText,
          state: spineScreening,
        })
      : []),
    ...(isMriBrainReportingContext(mriBrainReportingOpts)
      ? [
          ...brainTextContradictions({
            findingsText,
            impressionText,
            seq: brainSequenceContext,
          }),
          // §19's vascular bullets are about the SAME vessel, which a whole-report regex
          // cannot express, and about wording the recorded acquisition never earned.
          ...brainVascularContradictions({
            findingsText,
            impressionText,
            technique: vascularTechnique,
            brain: brainSequenceContext,
            screeningOnly: vascularIsScreeningOnly(
              appliedPathologyPatches.map((p) => p.observation?.concept),
            ),
          }),
        ]
      : []),
    ...(isXrayChestReportingContext({
      modality: workflow.currentRow?.modality,
      region: studyRegion,
      family: studySetup.studyContext?.family,
      studyDescription: workflow.currentRow?.studyDescription,
    })
      ? chestTextContradictions({
          findingsText,
          impressionText,
          viewCtx: parseXrayChestViews(techniqueText),
        })
      : []),
    ...(isXrayCervicalReportingContext({
      modality: workflow.currentRow?.modality,
      region: studyRegion,
      family: studySetup.studyContext?.family,
      studyDescription: workflow.currentRow?.studyDescription,
    })
      ? (() => {
          const cervicalCtx = parseXrayCervicalViews(techniqueText);
          const body = `${findingsText}\n${impressionText}`;
          return [
            ...cervicalTextContradictions({
              findingsText,
              impressionText,
              viewCtx: cervicalCtx,
            }),
            ...cervicalUnvisualizedLevelClaims(body, cervicalCtx),
            ...cervicalImpressionOrderWarnings(
              impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
            ),
          ];
        })()
      : []),
    ...(isXrayLsReportingContext({
      modality: workflow.currentRow?.modality,
      region: studyRegion,
      family: studySetup.studyContext?.family,
      studyDescription: workflow.currentRow?.studyDescription,
    })
      ? (() => {
          // Numbering is read back out of the report itself: the basis is the
          // licence to name a level, and a reopened study must be validated
          // against the basis it was written with (spec §4, §18).
          const lsCtx = parseXrayLsViews(techniqueText);
          const lsNumbering = parseLsNumberingFromText(`${findingsText}\n${impressionText}`);
          return [
            ...lsTextContradictions({
              findingsText,
              impressionText,
              viewCtx: lsCtx,
              numbering: lsNumbering,
            }),
            ...lsImpressionOrderWarnings(
              impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
            ),
          ];
        })()
      : []),
    ...validateReport({
      findings: findingsText,
      impression: impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
    }).filter(isImpressionContradictionWarning),
  ], [
    appliedPathologyPatches,
    brainSequenceContext,
    impressionText,
    findingsText,
    techniqueText,
    studyRegion,
    studySetup.studyContext?.family,
    studySetup.studyContext?.spineSegment,
    studySetup.activeProtocol?.name,
    vascularTechnique,
    workflow.currentRow?.modality,
    workflow.currentRow?.studyDescription,
    spineLsLevelNamingActive,
    spineDorsalValidationActive,
    spineDorsoLumbarValidationActive,
    spineFamily,
    spineSequencesAvailable,
    studyComposition,
    lumbarNumbering,
    dorsalNumbering,
    dorsoLumbarNumbering,
    spineScreening,
  ]);

  const impressionManuallyEdited = impressionProvenanceIsRadiologistManual(impressionProvenance);
  // Auto-derived impressions refresh themselves. The stale banner is only for
  // a radiologist-manual impression the user must review.
  useEffect(() => {
    if (!impressionNeedsRefresh) return;
    const live = useWorkspace.getState().fieldProvenance.impression;
    if (impressionProvenanceIsRadiologistManual(live)) return;
    useWorkspace.getState().refreshImpressionFromLedger({ automatic: true });
    // §37: spine impressions are re-sorted by clinical priority, but a hand
    // -built Impression (impressionOrderFrozen) is left exactly as written.
    if (spineFamily) useWorkspace.getState().orderImpressionByPriority();
    // §18: a derived vascular impression leads with the abnormality that matters
    // clinically, not with the order the tiles happened to be clicked.
    if (!isMriBrainReportingContext(mriBrainReportingOpts)) return;
    const state = useWorkspace.getState();
    const derived = state.impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    // A line the radiologist wrote by hand keeps its position: a mixed impression is left
    // exactly as they arranged it (§18, and the CARE provenance model).
    state.orderImpressionByPriority(
      orderBrainVascularImpressionLines(derived, {
        protectedLine: (line) => contributionProtected(line, state.fieldProvenance.impression),
      }),
    );
  // `findingsText` is a dependency because a refusal leaves the flag armed rather
  // than clearing it: the next sentence typed has to be looked at again, or an
  // abnormality dictated after one CARE cannot name would never reach the
  // Conclusion on its own. The body still opens with `if (!impressionNeedsRefresh)
  // return`, so an edit that arms nothing costs nothing.
  }, [impressionNeedsRefresh, findingsText, spineFamily]);

  // §23: on study open (and when the billed exam / protocol changes) propose
  // each spine region's role from the catalog. Billing never asserts a sequence,
  // and never walks back a role the radiologist stated — including on reopen,
  // where this effect runs again after the draft has been hydrated.
  // Dorso-Lumbar spec §24: the same catalog answer also states what the
  // examination *is*, so the composition is initialised beside the roles — and a
  // radiologist's manual statement is never walked back.
  useEffect(() => {
    if (!spineFamily) return;
    const ws = useWorkspace.getState();
    const resolved = resolveScreeningRoles({
      name: studySetup.testName ?? null,
      studyDescription: workflow.currentRow?.studyDescription ?? null,
      protocolName: studySetup.activeProtocol?.name ?? null,
      reportTitle: ws.appliedFormatName ?? null,
    });
    if (billingRolesMayApply(ws.screeningRolesOverridden)) {
      ws.replaceScreeningRoles(resolved.roles);
    }
    if (!ws.studyCompositionOverridden && resolved.composition && resolved.provenance) {
      ws.setStudyComposition(resolved.composition, resolved.provenance);
    }
  }, [spineFamily, studySetup.testName, studySetup.activeProtocol?.name, workflow.currentRow?.studyDescription]);

  // §35: coverage is derived from the recorded technique/description, and a
  // radiologist override in the canvas is never re-derived away.
  const spineCoverageKey = `${activeStudyId ?? ""}|${techniqueText}|${workflow.currentRow?.studyDescription ?? ""}`;
  const spineDeriveRef = useRef<{ key: string; seq: SpineSequencesAvailable | null }>({ key: "", seq: null });
  useEffect(() => {
    if (!spineFamily) return;
    const ws = useWorkspace.getState();
    const derived = deriveSpineSequencesAvailable({
      techniqueText,
      studyDescription: workflow.currentRow?.studyDescription ?? null,
      protocolName: studySetup.activeProtocol?.name ?? null,
      reportTitle: ws.appliedFormatName ?? null,
    });
    const prev = spineDeriveRef.current;
    const studyChanged = prev.key.split("|")[0] !== spineCoverageKey.split("|")[0];
    const untouched = studyChanged
      || !prev.seq
      || SPINE_SEQUENCE_KEYS.every((k) => ws.sequencesAvailable[k] === (prev.seq as SpineSequencesAvailable)[k]);
    if (untouched) ws.replaceSequencesAvailable(derived);
    spineDeriveRef.current = {
      key: spineCoverageKey,
      seq: untouched ? derived : prev.seq,
    };
  }, [spineFamily, spineCoverageKey, techniqueText, workflow.currentRow?.studyDescription, studySetup.activeProtocol?.name]);

  // Auto-reveal sections that carry NEW validation / stale warnings so collapse
  // never hides a blocker on first appearance. Edge-triggered: once a need set
  // has been revealed, the radiologist may open any other section (or collapse
  // everything) — collapsedWarning keeps the blocker discoverable without
  // fighting progressive accordion clicks.
  const autoRevealKeyRef = useRef("");
  const activeReportSectionRef = useRef(activeReportSection);
  activeReportSectionRef.current = activeReportSection;
  useEffect(() => {
    const need = sectionsRequiringReveal({
      impressionNeedsRefresh,
      impressionHasContradiction: impressionContradictionWarnings.length > 0,
      recommendationCritical: isCritical,
    });
    const key = revealNeedKey(need);
    if (!key) {
      autoRevealKeyRef.current = "";
      return;
    }
    const target = nextAutoRevealSection({
      need,
      currentActive: activeReportSectionRef.current,
      alreadyRevealedKey: autoRevealKeyRef.current,
      sectionWithCaret,
    });
    if (!target) {
      // A need that was already revealed, or one the radiologist is already
      // looking at, is handled: revealing it again would fight their clicks. A
      // need suppressed only because the caret is in the section that would
      // close is NOT handled — it stays pending so this same effect reveals it
      // the moment the caret leaves, and no stale Impression hides silently.
      const caretIsEditingTheOpenSection =
        !!sectionWithCaret && sectionWithCaret === activeReportSectionRef.current && !need.includes(sectionWithCaret);
      if (!caretIsEditingTheOpenSection) autoRevealKeyRef.current = key;
      return;
    }

    autoRevealKeyRef.current = key;
    setActiveReportSection(target);
  }, [impressionNeedsRefresh, impressionContradictionWarnings.length, isCritical, sectionWithCaret]);

  // Clinical history needs BOTH directions visible, not just reachable. `canUndoLastAbnormal` above is
  // a narrower gate — it asks whether the last thing worth stepping back over is an abnormality — so a
  // step that restores a format application, a deselection or hand-typed text had no control at all.
  // The two stack lengths are the honest enabled-state, and the lock half of it is `contentLocked`:
  // the same authority every other clinical control reads, so a report signed in another session does
  // not offer a step the store is going to refuse.
  const patchUndoDepth = useWorkspace((s: WorkspaceStore) => s.patchUndoStack.length);
  const patchRedoDepth = useWorkspace((s: WorkspaceStore) => s.patchRedoStack.length);
  const undoStepEnabled = patchUndoDepth > 0 && !contentLocked;
  const redoStepEnabled = patchRedoDepth > 0 && !contentLocked;

  /**
   * One step back or one step forward, through the same two guards the keystroke uses. Success needs
   * no toast — the report text visibly changes. Refusal must never be silent, and the reason comes from
   * the frame that is still on the stack, read before the store is asked.
   */
  const runClinicalHistoryStep = useCallback((direction: "undo" | "redo") => {
    const ws = useWorkspace.getState();
    const stack = direction === "undo" ? ws.patchUndoStack : ws.patchRedoStack;
    const frame = stack[stack.length - 1] ?? null;
    const refusal = clinicalHistoryRefusal(
      direction,
      direction === "undo" ? ws.undoLastPatch() : ws.redoLastPatch(),
      frame,
      { activeStudyId: ws.activeStudyId, isFinalized: ws.isFinalized },
    );
    if (refusal) toast({ ...refusal, variant: "destructive", duration: 8000 });
  }, [toast]);

  const undoLastAbnormalEnabled = canUndoLastAbnormal({
    lastPatchSnapshot,
    appliedPathologyPatches,
    isFinalized,
  }, { locked: isLocked });

  // ─── Auto-collapse panels on mobile + give OHIF room to breathe ──────────
  useEffect(() => {
    if (!isMobile) return;
    leftPanelRef.current?.collapse();
    rightPanelRef.current?.collapse();
    if (!showEmbeddedViewer) return;
    // Promote Split → Viewer+ once so OHIF owns the band; then phone-bias resize.
    if (layoutMode === "split") {
      setLayoutMode("viewerFocus", { reenableAutoFocus: true });
      return;
    }
    if (layoutMode !== "viewerFocus") return;
    const pct = outerPanelPercents({
      bias: "viewer",
      queueCollapsed: true,
      phone: true,
    });
    requestAnimationFrame(() => {
      viewerPanelRef.current?.resize(pct.viewer);
      reportPanelRef.current?.resize(pct.report);
    });
  }, [isMobile, showEmbeddedViewer, layoutMode, setLayoutMode]);

  const vm = {
    _commandDispatcher,
    _handleFrictionlessSaveAndNext,
    abnormalHighlight,
    abnormalPatternSuggestionsEnabled,
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
    appliedPatternMarkers,
    applyCatalogAfterConfirmRef,
    applyStagedAiProposals,
    applyStructuredGeneration,
    applyStudyLocalEdit,
    applyPattern,
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
    dismissPattern,
    doctorsCatalogQ,
    draftBackup,
    draftHydratedStudyId,
    draftId,
    draftIdRef,
    draftReadPending,
    existingDraftError,
    refetchExistingDraft,
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
    unlinkedClose,
    closingUnlinked,
    closeStudyWithoutImages,
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
    patternSuggestions,
    patternUsageCounts,
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
    printCriticalNudge,
    printFormat,
    printFormatLocked,
    stepPrintFormat,
    setPrintCriticalNudge,
    confirmedPrintLikeFinal,
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
    reportIdentity,
    reportImagesOpen,
    reportLayout,
    reportLayoutLabel,
    reportNeedsStart,
    reportPanelRef,
    reportingToolsTab,
    requestFrozenKeyImageCapture,
    requestOhifAnnotatedCapture,
    addCurrentOhifImageToReport,
    attachDisplayedImageRef,
    ohifImageAdding,
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
    undoLastAbnormalEnabled,    undoStepEnabled,
    redoStepEnabled,
    handleUndoStep: () => runClinicalHistoryStep("undo"),
    handleRedoStep: () => runClinicalHistoryStep("redo"),
    undoStartReport,
    useStructured,
    verifyActionRef,
    verifyBusy,
    verifyGate,
    viewerColumnExpanded,
    viewerFocusMode,
    viewerPanelRef,
    viewportWidthPx,
    continuousPrimarySections,
    voiceCapabilities,
    smartDictation,
    smartDictationEligible,
    smartDictationOpen,
    setSmartDictationOpen,
    smartDictationRegion: composerRegionForSmart,
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
  };
  return vm;
}
