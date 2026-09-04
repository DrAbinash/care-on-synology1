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
 *   • workspaceLayoutPrefs → per-radiologist panel sizes
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
import { useStudyLock } from "@/hooks/useStudyLock";
import { useFinalizeFlow } from "@/hooks/useFinalizeFlow";
import { useLocalDraftBackup } from "@/hooks/useLocalDraftBackup";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { useCopilotLearning } from "@/hooks/useCopilotLearning";
import { useCopilotPrefs } from "@/hooks/useCopilotPrefs";
import { useRadiologyDraftId, type RadiologyDraftRow } from "@/hooks/useRadiologyDraftId";
import { useRadiologyPalettePrefs } from "@/hooks/useRadiologyPalettePrefs";
import { useFindingsMacroRecents } from "@/hooks/useFindingsMacroRecents";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

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
  shouldApplyAsyncStudyResult,
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
  canVerifyReport, matchWorkspaceShortcut,
} from "@/lib/workspaceReportState";
import { createCommandDispatcher, type DispatchResult } from "@/lib/workspaceCommands";
import { loadReadingSession, toggleReadingSession, bumpSessionCompleted } from "@/lib/readingSession";
import {
  parseVoiceSettings, parseVoiceUserPrefs, mergeVoiceSettings,
  fetchTranscribeCapabilities, type TranscribeCapabilities,
} from "@/lib/voiceTranscription";
import { voiceKeyAction } from "@/lib/voiceSessionState";
import {
  normalizeDictationText, describeIntent,
  type ParsedVoiceCommand, type ViewerOp,
} from "@/lib/voiceCommandGrammar";
import type { VoiceExecutionResult } from "@/hooks/useVoiceSession";
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
import { buildObservationKeyImageCaption, maybeRefreshCaption } from "@/lib/keyImageCaption";
import {
  removeStructuredMeasurementByAnnotation,
  extractCareViewerMeasurements,
  extractCareCanalApProvenance,
  structuredFromViewerRow,
  formatMeasurementChip,
  annotationIdFromCoordinates,
  classifyViewerRowIngestMode,
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
import { useViewerMeasurements } from "@/components/radiology/ViewerMeasurementsPanel";
import { formatViewerMeasurementLabel } from "@/lib/formatViewerMeasurementLine";
import { subscribeCareOhifBridge, captureResultToBlob, requestOhifNavigateToAnchor, requestOhifViewportCapture, deriveOhifAllowedOrigins, resolveOhifTargetOrigin } from "@/lib/ohifViewerBridge";
import { viewportToAnchor } from "@/lib/observationAnchor";
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";
import {
  isMriCervicalReportingContext,
  isMriDorsalReportingContext,
} from "@/lib/mriSpineCanvasRegions";
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
  ContradictionBanner,
  ImpressionStaleBanner,
  SpineApCanalMeasurements,
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
  discLevelFromLabel,
  parseCanalApNumber,
  resolveCanalSegment,
} from "@/lib/spineCanalAp";
import LegacyBox, { type LegacyBoxTab } from "@/components/radiology/LegacyBox";
import { impressionMatchesStudyContext } from "@/lib/aiDraftStudyContext";
import { AiDraftPanel } from "@/components/ai/AiDraftPanel";
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
  type ReportSectionCollapsePrefs,
} from "@/lib/reportSectionCollapsePrefs";
import {
  ABNORMAL_HIGHLIGHT_MS,
  buildAbnormalHighlightFromPatch,
  clearHighlightIfStudyChanged,
  describeAbnormalReplacementToast,
  type AbnormalHighlightState,
} from "@/lib/abnormalSelectionFeedback";
import {
  shouldHandleAltUndoAbnormal,
  shouldHandleFinalizeShortcut,
  isAiInstructionTextarea,
} from "@/lib/reportingWorkspaceShortcuts";
import { ReportingStickyActionBar } from "@/components/radiology/ReportingStickyActionBar";
import { NormalBaselineBadge } from "@/components/radiology/NormalBaselineBadge";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import { WhatsAppReportShareDialog } from "@/components/radiology/WhatsAppReportShareDialog";
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import MriReadinessStrip from "@/components/radiology/MriReadinessStrip";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
import ReportingShortcutHelp from "@/components/radiology/ReportingShortcutHelp";
import StructuredFindingDialog from "@/components/radiology/StructuredFindingDialog";
import { FindingsHighlightEditor } from "@/components/FindingsHighlightEditor";
import ReportDemographyCard from "@/components/radiology/ReportDemographyCard";
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import { StudyRegionReportFormatSection } from "@/components/radiology/StudyRegionReportFormatSection";
import { WholeReportFormatControl } from "@/components/radiology/WholeReportFormatControl";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { removeBlock } from "@/lib/quickFindingsMerge";
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
  shouldShowEmbeddedViewer, fallbackModeWhenPopupBlocked, type WorkspaceLayoutMode,
} from "@/lib/workspaceLayoutPrefs";
import { isUltrasoundModality, isObstetricUsgStudy } from "@/lib/usgModality";
import { prefetchMriStudies, prefetchNextMriStudy } from "@/lib/mriStudyPrefetch";
import { mriWarmTargetsFromRows } from "@/lib/mriWarmScope";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import type { ReportImageRef } from "@/lib/reportImageRefs";
import { daysAgoISO, todayISO } from "@/lib/dateRangePresets";

// ─── New Z.ai workspace components ─────────────────────────────────────────────
import { useWorkspace, formatSignOff, lookupProfile, EMPTY_FIELD_PROVENANCE, type WorkspaceStore } from "@/lib/zai-workspace/store";
import { getFindingsCompletionPct, runLintRules, shouldPreloadNext } from "@/lib/zai-workspace/types";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import { WorklistStrip, type ReadingQueueDatePreset, type ReadingQueueSort } from "@/components/radiology/zai-workspace/worklist-strip";
import { CopilotRail } from "@/components/radiology/zai-workspace/copilot-rail";
import { FindingsEditor } from "@/components/radiology/zai-workspace/findings-editor";
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
  sectionForAltDigit,
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
  Lock, AlertTriangle, ChevronLeft, ChevronRight, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  CheckCircle2, Save,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus, Undo2,
} from "lucide-react";

/** Default Recommendation chips when `report_recommendation_chips` is unset. */
const DEFAULT_RECOMMENDATION_CHIPS: string[] = [
  "Clinical correlation is recommended.",
  "Correlation with previous imaging is advised.",
  "Follow-up imaging is advised as clinically indicated.",
  "Contrast-enhanced study is suggested for further characterisation.",
  "MRI is advised for further evaluation.",
  "Specialist / surgical consultation is recommended.",
  "No further imaging is required at present.",
];

/** Stable empty catalog — avoid `?? []` props that retrigger anatomy effects every render. */
const EMPTY_QUICK_FINDINGS: QuickFinding[] = [];

const RECOMMENDATION_CHIP_ALIASES: Record<string, string[]> = {
  "Clinical correlation is recommended.": [
    "Please correlate with clinical and laboratory findings.",
    "Please correlate with clinical findings.",
    "Clinical correlation advised.",
    "Clinical correlation is advised.",
  ],
  "Follow-up imaging is advised as clinically indicated.": [
    "Follow-up imaging is recommended as clinically indicated.",
    "Follow up imaging is advised as clinically indicated.",
  ],
};

function removeRecommendationChip(existing: string, chip: string): string {
  const trimmed = chip.trim();
  if (!trimmed) return existing;
  const aliases = RECOMMENDATION_CHIP_ALIASES[trimmed] ?? [];
  let next = removeBlock(existing, trimmed);
  for (const a of aliases) next = removeBlock(next, a);
  return next;
}

function recommendationChipActive(existing: string, chip: string): boolean {
  const trimmed = chip.trim();
  if (!trimmed) return false;
  if (existing.includes(trimmed)) return true;
  return (RECOMMENDATION_CHIP_ALIASES[trimmed] ?? []).some((a) => existing.includes(a));
}

function findingsMapToText(map: Record<string, { normal: boolean; text: string }>): string {
  return Object.entries(map)
    .filter(([, v]) => v.text.trim())
    .map(([label, v]) => `${label}: ${v.text}`)
    .join("\n\n");
}

interface Props { studyId?: number; }

export default function RadiologyReportingWorkspace({ studyId }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isOnline = useOnlineStatus();
  const qc = useQueryClient();

  // Refs declared early — voice/viewer callbacks close over these.
  const embeddedViewerRef = useRef<EmbeddedViewerHandle>(null);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const hydratedDraftForStudyRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const studyIdRef = useRef<number | undefined>(undefined);
  const [draftHydratedStudyId, setDraftHydratedStudyId] = useState<number | null>(null);
  const commandDispatcherRef = useRef<{ dispatch: (cmd: string) => DispatchResult } | null>(null);
  const canVerifyRef = useRef(false);
  const verifyActionRef = useRef<(() => void) | null>(null);
  const pcpndtBlockedRef = useRef(false);
  const linkedReportIdRef = useRef<number | null>(null);
  const openLegacyTabRef = useRef<(tab: LegacyBoxTab) => void>(() => {});
  const [legacyTab, setLegacyTab] = useState<LegacyBoxTab | null>(null);
  const [whatsappShareOpen, setWhatsappShareOpen] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printingLikeFinal, setPrintingLikeFinal] = useState(false);
  const [headingCase, setHeadingCase] = useState<ReportHeadingCase>("all_caps");
  const [sectionSpacing, setSectionSpacing] = useState<ReportSectionSpacing>("spaced");
  const [impressionStyle, setImpressionStyle] = useState<ReportImpressionStyle>("bulleted");
  const [showLetterpadHeader, setShowLetterpadHeader] = useState(true);
  const [bodyFontSize, setBodyFontSize] = useState<"small" | "medium" | "large">(() => {
    try {
      const raw = localStorage.getItem("radiology_print_settings");
      if (!raw) return "medium";
      const parsed = JSON.parse(raw) as { fontSize?: string };
      if (parsed.fontSize === "small" || parsed.fontSize === "medium" || parsed.fontSize === "large") {
        return parsed.fontSize;
      }
    } catch { /* ignore */ }
    return "medium";
  });
  const [allowEditSigned, setAllowEditSigned] = useState(false);

  // Sync report preferences from server (heading case, spacing, impression, header toggle).
  // The server is the source of truth; local state is the working copy for the session.
  const [previewLayoutOverride, setPreviewLayoutOverride] = useState<ReportLayoutKey | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [confirmImpressionReplace, setConfirmImpressionReplace] = useState(false);
  const [confirmVerify, setConfirmVerify] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [sendHopeBusy, setSendHopeBusy] = useState(false);
  // Radiologist-local demography overrides — never written to patient master.
  const [demographyOverrides, setDemographyOverrides] = useState<Partial<ReportDemography>>({});

  // ─── Main-pane progressive disclosure ─────────────────────────────────────
  // One major report section is expanded at a time; every other section stays
  // MOUNTED but hidden (see report-section-accordion.tsx) so no editor, drawer
  // or panel loses state and no effect re-inserts text on expand.
  // `activeFindingsTool` is the nested Findings assistance drawer and is
  // deliberately independent of the major accordion.
  const [sectionCollapsePrefs, setSectionCollapsePrefs] = useState<ReportSectionCollapsePrefs>(() =>
    readReportSectionCollapsePrefs(typeof window !== "undefined" ? window.localStorage : null),
  );
  const [activeReportSection, setActiveReportSection] = useState<ReportSectionId | null>(
    () => sectionCollapsePrefs.preferredActive || "findings",
  );
  const [activeFindingsTool, setActiveFindingsTool] = useState<FindingsToolId | null>(null);
  /** Shared anatomy chip selection — filters clinic tiles + Quick Select wall. */
  const [activeFindingsAnatomy, setActiveFindingsAnatomy] = useState<string | null>(null);
  const [abnormalHighlight, setAbnormalHighlight] = useState<AbnormalHighlightState | null>(null);
  const activateReportSection = useCallback((id: ReportSectionId) => {
    setActiveReportSection((cur) => {
      const next = nextActiveSection(cur, id);
      const prefs = prefsAfterSectionActivate(sectionCollapsePrefs, next, cur);
      setSectionCollapsePrefs(prefs);
      writeReportSectionCollapsePrefs(
        typeof window !== "undefined" ? window.localStorage : null,
        prefs,
      );
      return next;
    });
  }, [sectionCollapsePrefs]);
  const selectFindingsTool = useCallback((id: FindingsToolId) => {
    setActiveFindingsTool((cur) => nextFindingsTool(cur, id));
  }, []);

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
  const lastStructuredFindingsLinesRef = useRef<Record<string, string>>({});
  const saveDraftRef = useRef<(opts?: { silent?: boolean }) => Promise<number | null>>(async () => null);

  const [queueModality, setQueueModality] = useState(() => {
    try { return localStorage.getItem("care_reading_queue_modality") || "MR"; } catch { return "MR"; }
  });
  const [datePreset, setDatePreset] = useState<ReadingQueueDatePreset>(() => {
    try {
      const stored = localStorage.getItem("care_reading_queue_date");
      if (stored === "today" || stored === "yesterday" || stored === "all" || stored === "today-yesterday") return stored;
    } catch { /* ignore */ }
    return "today-yesterday";
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
  useEffect(() => {
    const id = setInterval(() => setSessionTick(t => t + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
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
  const findingsText = useWorkspace((s: WorkspaceStore) => s.findingsText);
  const impressionText = useWorkspace((s: WorkspaceStore) => s.impressionText);
  const impressionNeedsRefresh = useWorkspace((s: WorkspaceStore) => s.impressionNeedsRefresh);
  const ownershipReviewWarnings = useWorkspace((s: WorkspaceStore) => s.ownershipReviewWarnings);
  const ledgerHydrationWarning = useWorkspace((s: WorkspaceStore) => s.ledgerHydrationWarning);
  const appliedPathologyPatches = useWorkspace((s: WorkspaceStore) => s.appliedPathologyPatches);
  const lastPatchSnapshot = useWorkspace((s: WorkspaceStore) => s.lastPatchSnapshot);
  const activeAnchor = useWorkspace((s: WorkspaceStore) => s.activeAnchor);
  const selectedObservationId = useWorkspace((s: WorkspaceStore) => s.selectedObservationId);
  const coverageMarks = useWorkspace((s: WorkspaceStore) => s.coverageMarks);
  const workspaceMeasurements = useWorkspace((s: WorkspaceStore) => s.measurements);
  const recommendationText = useWorkspace((s: WorkspaceStore) => s.recommendationText);
  const techniqueText = useWorkspace((s: WorkspaceStore) => s.techniqueText);
  const clinicalHistoryText = useWorkspace((s: WorkspaceStore) => s.clinicalHistoryText);
  const appliedFormatReportTitle = useWorkspace((s: WorkspaceStore) => s.appliedFormatReportTitle);
  const appliedFormatName = useWorkspace((s: WorkspaceStore) => s.appliedFormatName);
  // Read-only: drives the collapsed Findings summary's "N assisted" count.
  const findingsProvenance = useWorkspace((s: WorkspaceStore) => s.fieldProvenance.findings);
  const impressionProvenance = useWorkspace((s: WorkspaceStore) => s.fieldProvenance.impression);
  const techniqueProvenance = useWorkspace((s: WorkspaceStore) => s.fieldProvenance.technique ?? EMPTY_FIELD_PROVENANCE);
  const isFinalized = useWorkspace((s: WorkspaceStore) => s.isFinalized);
  const isDirty = useWorkspace((s: WorkspaceStore) => s.isDirty);
  const preloadTriggered = useWorkspace((s: WorkspaceStore) => s.preloadTriggered);
  const criticalSlaStartedAt = useWorkspace((s: WorkspaceStore) => s.criticalSlaStartedAt);
  const completedCount = useWorkspace((s: WorkspaceStore) => s.completedStudyIds.size);
  const sessionStartedAt = useWorkspace((s: WorkspaceStore) => s.sessionStartedAt);

  // ─── Existing Care hooks (the wiring contract) ─────────────────────────────
  // 1. Workflow (queue, navigation, parked, history)
  const workflow = useReportingWorkflow(studyId, {
    myUserId,
    myName,
    modalityFilter: queueModality,
    dateFrom: queueDateRange.from,
    dateTo: queueDateRange.to,
    search: patientJumpFilter,
    searchOrthanc: true,
  });

  // 2. Study lock (claim/heartbeat/release)
  const studyLock = useStudyLock(studyId, {
    enabled: Boolean(
      workflow.currentRow
      && (
        allowEditSigned
        || (workflow.currentRow.status !== "REPORT_FINAL" && workflow.currentRow.status !== "DELIVERED")
      ),
    ) as any,
  });
  const isLocked = studyLock.status === "locked-by-other";
  const lockLost = studyLock.status === "expired-lost" || studyLock.status === "connection-lost";
  /** Trial-phase unlock: edit a signed report in place (editors + draft save). */
  const contentLocked =
    isLocked
    || ((isFinalized || workflow.currentRow?.status === "REPORT_FINAL") && !allowEditSigned);

  // 3. Draft ID (server-side persistence)
  const { draftId, existingDraft, captureSavedDraftId, isLoadingExistingDraft } = useRadiologyDraftId(studyId ?? null);

  // 4. Local draft backup (30-snapshot localStorage)
  const draftBackup = useLocalDraftBackup({
    storageKey: `radiology_report_backup_${studyId ?? "new"}`,
    snapshot: {
      at: Date.now(),
      clinicalHistory: clinicalHistoryText,
      technique: techniqueText,
      rawFindings: findingsText,
      impression: [impressionText],
      recommendation: recommendationText,
    },
    enabled: allowEditSigned || workflow.currentRow?.status !== "REPORT_FINAL",
  });

  // 5. Finalize flow (promise-based sign dialog)
  const finalizeFlow = useFinalizeFlow();

  // 6. Voice session — Care pipeline (prefs + grammar + safety + multi-provider)
  const { data: pacsSettingsRows } = useQuery<Array<{ id: number; key: string; value: string | null; category: string }>>({
    queryKey: ["pacs-settings"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
    staleTime: 5 * 60_000,
  });
  const clinicVoiceSettings = useMemo(() => parseVoiceSettings(pacsSettingsRows), [pacsSettingsRows]);
  const { data: voiceUserPrefsRaw } = useQuery<unknown>({
    queryKey: ["voice-user-preferences"],
    queryFn: () => api.get("/api/radiology/report-generator/voice-preferences"),
    enabled: clinicVoiceSettings.enabled,
    staleTime: 5 * 60_000,
  });
  const voiceSettings = useMemo(
    () => mergeVoiceSettings(clinicVoiceSettings, voiceUserPrefsRaw ? parseVoiceUserPrefs(voiceUserPrefsRaw) : null),
    [clinicVoiceSettings, voiceUserPrefsRaw],
  );
  const { data: voiceCapabilities = { server: false, local: false } } = useQuery<TranscribeCapabilities>({
    queryKey: ["voice-transcribe-status"],
    queryFn: fetchTranscribeCapabilities,
    enabled: voiceSettings.enabled,
    staleTime: 5 * 60_000,
  });

  const [qsExternalSearch, setQsExternalSearch] = useState<{ seq: number; term: string } | null>(null);

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
  const voiceParkReasonRef = useRef<string | null>(null);

  const focusReportField = useCallback((field: "findings" | "impression" | "technique" | "clinicalHistory" | "recommendation") => {
    const sectionByField: Record<typeof field, ReportSectionId> = {
      clinicalHistory: "history",
      technique: "technique",
      findings: "findings",
      impression: "impression",
      recommendation: "recommendation",
    };
    activateReportSection(sectionByField[field]);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-report-field="${field}"] textarea`) as HTMLTextAreaElement | null;
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }, [activateReportSection]);

  const voiceComposerComposeRef = useRef<(text: string, genImp?: boolean) => Promise<void>>(async () => {});

  const executeVoiceCommand = useCallback((parse: ParsedVoiceCommand): VoiceExecutionResult => {
    const intent = parse.intent;
    if (!intent) return { ok: false, message: "Nothing to execute" };

    if (intent.type === "cancel") return { ok: true, message: "Cancelled" };
    if (intent.type === "confirm") return { ok: false, message: "Nothing to confirm" };
    if (intent.type === "handsfree") return { ok: false, message: "Hands-free is controlled from the voice bar" };
    if (intent.type === "viewer-unsupported") {
      return { ok: false, message: `The embedded viewer does not support ${intent.capability}` };
    }

    if (intent.type === "dictate") {
      const state = useWorkspace.getState();
      if (state.isFinalized && !allowEditSigned) {
        return { ok: false, message: "Report is finalized — read-only" };
      }
      if (studyLock.status === "locked-by-other") {
        return { ok: false, message: "Study is locked by another user — read-only" };
      }
      const text = normalizeDictationText(intent.text, { autoPunctuation: voiceSettings.autoPunctuation });
      if (!text) return { ok: false, message: "Nothing to insert" };
      const mode = intent.mode;
      const voiceSource = "radiologist-voice" as const;
      if (intent.target === "findings") {
        const prev = state.findingsText;
        if (mode === "replace") {
          state.replaceField("findings", text, voiceSource);
        } else {
          state.mergeField("findings", text, voiceSource);
        }
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} findings`,
          undo: () => useWorkspace.getState().setField("findings", prev),
          undoLabel: "findings edit",
        };
      }
      if (intent.target === "impression") {
        const prev = state.impressionText;
        if (mode === "replace") {
          state.replaceField("impression", text, voiceSource);
        } else {
          state.mergeField("impression", text, voiceSource);
        }
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} impression`,
          undo: () => useWorkspace.getState().setField("impression", prev),
          undoLabel: "impression edit",
        };
      }
      if (intent.target === "recommendation") {
        const prev = state.recommendationText;
        if (mode === "replace") {
          state.replaceField("recommendation", text, voiceSource);
        } else {
          state.mergeField("recommendation", text, voiceSource);
        }
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} recommendation`,
          undo: () => useWorkspace.getState().setField("recommendation", prev),
          undoLabel: "recommendation edit",
        };
      }
      if (intent.target === "technique") {
        const prev = state.techniqueText;
        if (mode === "replace") {
          state.replaceField("technique", text, voiceSource);
        } else {
          state.mergeField("technique", text, voiceSource);
        }
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} technique`,
          undo: () => useWorkspace.getState().setField("technique", prev),
          undoLabel: "technique edit",
        };
      }
      const prev = state.clinicalHistoryText;
      if (mode === "replace") {
        state.replaceField("clinicalHistory", text, voiceSource);
      } else {
        state.mergeField("clinicalHistory", text, voiceSource);
      }
      return {
        ok: true,
        message: `${mode === "replace" ? "Replaced" : "Appended to"} clinical history`,
        undo: () => useWorkspace.getState().setField("clinicalHistory", prev),
        undoLabel: "history edit",
      };
    }

    if (intent.type === "workflow") {
      if (intent.command === "generate-impression") {
        void voiceComposerComposeRef.current("generate impression", true);
        return { ok: true, message: "Composing impression preview…" };
      }
      if (intent.command === "park") voiceParkReasonRef.current = intent.reason ?? "";
      if (intent.command === "focus-findings") {
        focusReportField("findings");
        return { ok: true, message: describeIntent(intent) };
      }
      if (intent.command === "focus-impression") {
        focusReportField("impression");
        return { ok: true, message: describeIntent(intent) };
      }
      const res = commandDispatcherRef.current?.dispatch(intent.command);
      if (intent.command === "park") voiceParkReasonRef.current = null;
      if (!res) return { ok: false, message: "Command dispatcher unavailable" };
      return res.executed
        ? { ok: true, message: describeIntent(intent) }
        : { ok: false, message: `Command not available (${res.reason ?? "unknown"})` };
    }

    if (intent.type === "viewer") {
      const h = embeddedViewerRef.current;
      if (!h) return { ok: false, message: "Embedded viewer is not open for this study" };
      const ops: Record<ViewerOp, () => void> = {
        "next-image": () => h.nextFrame(),
        "previous-image": () => h.prevFrame(),
        "zoom-in": () => h.zoomIn(),
        "zoom-out": () => h.zoomOut(),
        "reset-view": () => h.resetView(),
      };
      ops[intent.op]();
      return { ok: true, message: describeIntent(intent) };
    }

    if (intent.type === "quick-select") {
      if (intent.action === "search") {
        setQsExternalSearch((prev) => ({ seq: (prev?.seq ?? 0) + 1, term: intent.term }));
        openLegacyTabRef.current("library");
        rightPanelRef.current?.expand();
        return { ok: true, message: `Searching quick findings for “${intent.term}”` };
      }
      const templates = quickFindingTemplatesRef.current;
      if (!templates.length) {
        return { ok: false, message: "Quick findings are not loaded yet — open Clinic Quick Select once" };
      }
      const norm = intent.term.trim().toLowerCase();
      const selected = selectedQuickIdsRef.current;
      const pool = intent.action === "remove" ? templates.filter((f) => selected.has(f.id)) : templates;
      let matches = pool.filter((f) => f.label.trim().toLowerCase() === norm);
      if (matches.length === 0) matches = pool.filter((f) => f.label.toLowerCase().includes(norm));
      if (matches.length === 0) {
        return {
          ok: false,
          message: intent.action === "remove"
            ? `No selected finding matches “${intent.term}”`
            : `No quick finding matches “${intent.term}”`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          message: `Multiple findings match “${intent.term}”: ${matches.slice(0, 3).map((f) => f.label).join(" · ")} — say the full name`,
        };
      }
      const f = matches[0];
      const nowSelected = intent.action === "select";
      if (nowSelected && selected.has(f.id)) return { ok: true, message: `“${f.label}” is already selected` };
      handleQuickToggleRef.current(f, nowSelected);
      return {
        ok: true,
        message: `${nowSelected ? "Selected" : "Removed"} “${f.label}”`,
        undo: () => handleQuickToggleRef.current(f, !nowSelected),
        undoLabel: `quick finding ${nowSelected ? "selection" : "removal"}`,
      };
    }

    if (intent.type === "quick-modifier") {
      return {
        ok: false,
        message: "Quick modifiers need a selected structured finding — use Clinic Quick Select chips first",
      };
    }

    if (intent.type === "combination") {
      const combo = matchStudyCombination(intent.term);
      if (!combo) return { ok: false, message: `No study combination matches “${intent.term}”` };
      const assembled = buildCombination(combo.templateIds);
      if (!assembled) return { ok: false, message: `Could not assemble “${combo.label}”` };
      const inserts = combinationInserts(assembled);
      const state = useWorkspace.getState();
      const prev = {
        findings: state.findingsText,
        impression: state.impressionText,
        technique: state.techniqueText,
        recommendation: state.recommendationText,
      };
      if (inserts.technique) state.mergeField("technique", inserts.technique, "protocol");
      for (const block of inserts.findingsBlocks) {
        const text = `${block.heading}\n${block.text}`.trim();
        useWorkspace.getState().mergeField("findings", text, "protocol");
      }
      for (const line of inserts.impression) {
        useWorkspace.getState().mergeField("impression", line, "protocol");
      }
      if (inserts.recommendation) {
        useWorkspace.getState().mergeField("recommendation", inserts.recommendation, "protocol");
      }
      return {
        ok: true,
        message: `Applied ${combo.label}`,
        undo: () => {
          const s = useWorkspace.getState();
          s.setField("findings", prev.findings);
          s.setField("impression", prev.impression);
          s.setField("technique", prev.technique);
          s.setField("recommendation", prev.recommendation);
        },
        undoLabel: "combination insert",
      };
    }

    return { ok: false, message: "Unrecognized voice intent" };
  }, [voiceSettings.autoPunctuation, focusReportField, allowEditSigned, studyLock.status]);

  const voiceSession = useVoiceSession({
    studyId: studyId ?? undefined,
    settings: voiceSettings,
    capabilities: voiceCapabilities,
    getContext: () => ({
      studyId: studyId ?? null,
      dirty: useWorkspace.getState().isDirty,
      // Voice safety treats isLocked as read-only for dictate/finalize — include finalized.
      isLocked: studyLock.status === "locked-by-other" || isFinalized
        || (workflow.currentRow?.status === "REPORT_FINAL" && !allowEditSigned),
      lockedByOther: studyLock.status === "locked-by-other",
      lockLost: studyLock.status === "expired-lost" || studyLock.status === "connection-lost",
      canVerify: canVerifyRef.current,
      structuredFindings: false,
      viewerAvailable: embeddedViewerRef.current != null,
      confirmationPolicy: voiceSettings.confirmationPolicy,
    }),
    execute: executeVoiceCommand,
    // Deterministic normalization only — do not send dictation to an AI rewrite model.
    onAudit: (commandType, outcome) => {
      api.post("/api/radiology/voice-command-audit", { commandType, studyId, outcome }).catch((err) => console.warn("[VoiceAudit] Failed:", err));
    },
  });

  const focusVoiceBar = useCallback(() => {
    document.querySelector("[data-testid='voice-command-bar']")?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, []);

  // 7. Copilot learning + prefs
  const { prefs: copilotPrefs } = useCopilotPrefs();
  const copilotLearning = useCopilotLearning(copilotPrefs.learning);

  // 8. Palette prefs + macro recents
  const { recent: paletteRecent, favourites: paletteFavourites, markRecent: markPaletteRecent, toggleFav: togglePaletteFavourite } = useRadiologyPalettePrefs();
  const { recent: macroRecentIds, markRecent: markMacroRecent } = useFindingsMacroRecents();

  // 9. Reading session (auto-advance toggle)
  const [readingSession, setReadingSession] = useState(() => loadReadingSession());

  // 10. Layout prefs (Report / Split / Viewer) — ported from legacy
  const [layoutPrefs, setLayoutPrefs] = useState(() => loadWorkspaceLayoutPrefs(myUserId));
  const layoutMode = layoutPrefs.mode;
  const showEmbeddedViewer = shouldShowEmbeddedViewer(layoutMode);
  const setLayoutMode = useCallback((mode: WorkspaceLayoutMode) => {
    setLayoutPrefs((prev) => {
      const next = { ...prev, mode };
      saveWorkspaceLayoutPrefs(myUserId, next);
      return next;
    });
    if (mode === "reportFocus") setViewerColumnExpanded(false);
  }, [myUserId]);

  // Legacy clinic Quick Select + critical checklist
  const [selectedQuickIds, setSelectedQuickIds] = useState<Set<number>>(() => new Set());
  const [quickSide, setQuickSide] = useState<Side>("left");
  const lastQuickRenderedRef = useRef<Map<number, PathologyIncoming>>(new Map());
  const quickSideMountedRef = useRef(false);
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [checklistComm, setChecklistComm] = useState({ phoned: false, annotated: false, dispatched: false });
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Viewer vertical enlarge (center column only) + left worklist collapse
  const [viewerColumnExpanded, setViewerColumnExpanded] = useState(false);
  const [reportImagesOpen, setReportImagesOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [keyImageFilterObsId, setKeyImageFilterObsId] = useState<string | null>(null);

  // Viewer focus — collapse app sidebar via Layout; sticky while writing
  const [viewerFocusMode, setViewerFocusMode] = useState(false);
  const viewerFocusRef = useRef(false);
  const setViewerFocus = useCallback((on: boolean) => {
    if (viewerFocusRef.current === on) return;
    viewerFocusRef.current = on;
    setViewerFocusMode(on);
    try { window.dispatchEvent(new CustomEvent("care:viewer-focus", { detail: on })); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (!showEmbeddedViewer) {
      setViewerFocus(false);
      setViewerColumnExpanded(false);
    }
  }, [showEmbeddedViewer, setViewerFocus]);

  useEffect(() => {
    if (showEmbeddedViewer) setViewerFocus(true);
  }, [showEmbeddedViewer, setViewerFocus]);

  useEffect(() => () => {
    if (viewerFocusRef.current) {
      try { window.dispatchEvent(new CustomEvent("care:viewer-focus", { detail: false })); } catch { /* noop */ }
    }
  }, []);

  const enterReportingFocusMode = useCallback(() => {
    leftPanelRef.current?.collapse();
    rightPanelRef.current?.collapse();
    setViewerFocus(true);
    if (!shouldShowEmbeddedViewer(layoutMode)) setLayoutMode("split");
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
  }, [layoutMode, setLayoutMode, setViewerFocus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") !== "1") return;
    enterReportingFocusMode();
    params.delete("focus");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
  }, [studyId, enterReportingFocusMode]);

  // Clicking inside the OHIF iframe does not bubble to React. Window blur +
  // activeElement === the embed is the same "I am looking at images" signal
  // as clicking the viewer chrome.
  useEffect(() => {
    const onBlur = () => {
      requestAnimationFrame(() => {
        const ae = document.activeElement;
        if (ae instanceof HTMLIFrameElement && ae.getAttribute("data-testid") === "ohif-embed") {
          enterReportingFocusMode();
        }
      });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [enterReportingFocusMode]);

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
    return () => {
      try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: false })); } catch { /* noop */ }
    };
  }, []);

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

  // Reset patient-specific editor state when switching studies
  useEffect(() => {
    saveGenerationRef.current += 1;
    studyIdRef.current = studyId;
    setFindingsMap({});
    setUseStructured(false);
    startReportUndoRef.current = null;
    setCanUndoStartReport(false);
    setStructuredValues({});
    structuredTouchedRef.current = false;
    structuredFormatDrivingRef.current = false;
    lastStructuredFindingsLinesRef.current = {};
    setSelectedQuickIds(new Set());
    setActiveFindingsAnatomy(null);
    setIsCritical(false);
    setCriticalNote("");
    setChecklistComm({ phoned: false, annotated: false, dispatched: false });
    // Clear zustand editor unconditionally — worklist navigate() does not call
    // selectStudy, so Patient A text must not linger on Patient B.
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      isDirty: false,
      isFinalized: false,
      isFinalizing: false,
      ghostText: null,
      ghostTextTarget: null,
    });
    // Draft identity resets inside useRadiologyDraftId on studyId change —
    // do not call captureSavedDraftId(null) here (that pattern caused React #185).
  }, [studyId]);

  // Keep findingsText in sync when structured cards drive the report
  useEffect(() => {
    if (!useStructured) return;
    if (structuredFormatDrivingRef.current) return;
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
    modality: workflow.currentRow?.modality,
    studyDescription: workflow.currentRow?.studyDescription,
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
    modality: workflow.currentRow?.modality,
    region: studySetup.matchedStudyRegion ?? studySetup.studyRegions[0],
    reportTitle: workflow.currentRow?.studyDescription ?? undefined,
    protectedQuickFindingLabels: protectedQuickLabels,
  });

  voiceComposerComposeRef.current = async (text, genImp) => {
    await voiceComposer.compose(text, genImp);
  };

  useEffect(() => {
    const pending = voiceSession.pending;
    if (!composerConfig?.enabled || !pending?.editableText) return;
    const intent = pending.parse.intent;
    if (intent?.type !== "dictate" || intent.target !== "findings") return;
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
    const text = voiceComposer.preview?.transcript ?? voiceSession.pending?.editableText ?? "";
    if (!text.trim()) return;
    useWorkspace.getState().mergeField("findings", text, "radiologist-voice");
    voiceComposer.discardPreview();
    voiceSession.cancel();
  }, [voiceComposer, voiceSession]);

  const dictationTranscript = useCallback(() => {
    return (
      voiceComposer.preview?.transcript
      ?? voiceSession.pending?.editableText
      ?? ""
    ).trim();
  }, [voiceComposer.preview?.transcript, voiceSession.pending?.editableText]);

  const dictateAddAsNote = useCallback(() => {
    if (isLocked || isFinalized) return;
    const text = dictationTranscript();
    if (!text) return;
    useWorkspace.getState().mergeField("findings", text, "radiologist-voice");
    voiceComposer.discardPreview();
    voiceSession.cancel();
    setComposerBanner(null);
  }, [dictationTranscript, isLocked, isFinalized, voiceComposer, voiceSession]);

  const dictateAddAsFinding = useCallback(() => {
    if (isLocked || isFinalized) return;
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
    dictationTranscript, isLocked, isFinalized, composerQuickFindings, composerRegion, activateReportSection,
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
  const [aiFinalizeGate, setAiFinalizeGate] = useState<"idle" | "pending">("idle");
  const [aiAssistantMinimized, setAiAssistantMinimized] = useState(() =>
    readAiAssistantMinimizedPreference(typeof window !== "undefined" ? window.localStorage : null),
  );
  /** Background composer drafting mode — default TEXT_ONLY; never silently SELECTED_IMAGES. */
  const [composerAiMode, setComposerAiMode] = useState<"TEXT_ONLY" | "SELECTED_IMAGES">("TEXT_ONLY");
  /** Session AI selection of frozen key-image IDs (independent of includeInReport). */
  const [aiSelectedKeyImageIds, setAiSelectedKeyImageIds] = useState<number[]>([]);
  const persistAiAssistantMinimized = (minimized: boolean) => {
    setAiAssistantMinimized(minimized);
    writeAiAssistantMinimizedPreference(
      typeof window !== "undefined" ? window.localStorage : null,
      minimized,
    );
  };
  const aiFinalizeBypassRef = useRef(false);

  // Clear AI image selection + reset mode when study/draft switches (wrong-patient guard).
  useEffect(() => {
    setAiSelectedKeyImageIds([]);
    setComposerAiMode("TEXT_ONLY");
    setAbnormalHighlight((h) => clearHighlightIfStudyChanged(h, studyId != null ? String(studyId) : null));
  }, [studyId, draftId]);

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

  const handleStartReport = useCallback(() => {
    if (contentLocked) return;
    const fields = studySetupSetters.readFields();
    startReportUndoRef.current = {
      ...fields,
      findingsMap: { ...findingsMap },
      useStructured,
      selectedTemplateId: studySetup.selectedTemplateId,
    };
    const result = studySetup.startReportBootstrap();
    if (!result) {
      startReportUndoRef.current = null;
      return;
    }
    if (Object.keys(result.sectionMap).length > 0) {
      setFindingsMap(result.sectionMap);
      setUseStructured(true);
    } else {
      setUseStructured(false);
    }
    setCanUndoStartReport(true);
  }, [
    contentLocked, studySetupSetters, findingsMap, useStructured, studySetup,
  ]);

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
    toast({ title: "Start report undone" });
  }, [studySetup, toast]);

  const handleGenerateLocalImpression = useCallback(() => {
    if (contentLocked) return;
    const store = useWorkspace.getState();
    if (store.appliedPathologyPatches.length > 0) {
      store.refreshImpressionFromLedger();
      toast({ title: "Impression refreshed", description: "From active observations and remaining abnormal findings." });
      return;
    }
    const lines = generateLocalImpression(
      findingsText || (useStructured ? findingsMapToText(findingsMap) : ""),
      useStructured ? findingsMap : undefined,
    );
    if (lines.length === 0) {
      toast({ title: "No findings to summarize", description: "Add findings first.", variant: "destructive" });
      return;
    }
    if (impressionText.trim()) {
      setConfirmImpressionReplace(true);
      return;
    }
    useWorkspace.getState().setField("impression", lines.join("\n"));
    toast({ title: "Impression generated", description: `${lines.length} point${lines.length > 1 ? "s" : ""} from findings` });
  }, [contentLocked, useStructured, findingsMap, findingsText, impressionText, toast]);

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
    const lines = generateLocalImpression(
      findingsText || (useStructured ? findingsMapToText(findingsMap) : ""),
      useStructured ? findingsMap : undefined,
    );
    useWorkspace.getState().setField("impression", lines.join("\n"));
    toast({ title: "Impression generated", description: `${lines.length} point${lines.length > 1 ? "s" : ""} from findings` });
  }, [useStructured, findingsMap, findingsText, toast]);

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
    // viewer/editor reclaim width.
    requestAnimationFrame(() => leftPanelRef.current?.collapse());
    // Clear study-scoped UI state (Quick Select / critical checklist)
    setSelectedQuickIds(new Set());
    setIsCritical(false);
    setCriticalNote("");
    setChecklistComm({ phoned: false, annotated: false, dispatched: false });
    setLastSavedAt(null);
    setAllowEditSigned(false);
  }, [selectStudy, navigate]);

  const goNextStudy = useCallback(() => {
    const next = workflow.peekNext();
    if (!next) { toast({ title: "End of queue" }); return; }
    workflow.beginTransition(studyId, next);
    openStudy(next.id);
  }, [workflow, studyId, openStudy, toast]);

  const goPrevStudy = useCallback(() => {
    const prevId = workflow.beginPreviousTransition(studyId);
    if (prevId == null) { toast({ title: "No previous study in history" }); return; }
    openStudy(prevId);
  }, [workflow, studyId, openStudy, toast]);

  const persistQueueModality = useCallback((value: string) => {
    setQueueModality(value);
    try { localStorage.setItem("care_reading_queue_modality", value); } catch { /* ignore */ }
  }, []);

  const persistDatePreset = useCallback((value: ReadingQueueDatePreset) => {
    setDatePreset(value);
    try { localStorage.setItem("care_reading_queue_date", value); } catch { /* ignore */ }
  }, []);

  const persistQueueSort = useCallback((value: ReadingQueueSort) => {
    setQueueSort(value);
    try { localStorage.setItem("care_reading_queue_sort", value); } catch { /* ignore */ }
  }, []);

  /** Clinic Quick Select — pathology patches over the whole report (ownership + laterality). */
  const handleQuickToggle = useCallback((finding: QuickFinding, nowSelected: boolean) => {
    const state = useWorkspace.getState();
    const patchId = `qf-${finding.id}`;
    if (nowSelected) {
      const templates: PathologyIncoming = {
        findings: finding.findingText,
        impression: finding.impressionText,
        technique: finding.techniqueText,
        recommendation: finding.recommendationText,
      };
      const ownership = {
        anatomicalSection: finding.anatomicalSection,
        conflictGroup: finding.conflictGroup,
        baselineReplaces: finding.baselineReplaces,
      };
      state.applyPathologyOverlay({
        incoming: templates,
        templates,
        ownership,
        source: "quick-findings",
        side: quickSide,
        id: patchId,
        region: studySetup.matchedStudyRegion ?? finding.studyType,
        label: finding.label,
        catalogId: finding.id,
        properties: finding.properties,
        findingsText: finding.findingText,
      });
      const applied = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === patchId);
      if (applied) lastQuickRenderedRef.current.set(finding.id, applied.lastRendered);
      const ids = selectedQuickFindingIds(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id));
      setSelectedQuickIds(new Set(ids));
      for (const id of lastQuickRenderedRef.current.keys()) {
        if (!ids.includes(id)) lastQuickRenderedRef.current.delete(id);
      }
    } else {
      const outcome = state.removeObservation(patchId);
      lastQuickRenderedRef.current.delete(finding.id);
      const ids = selectedQuickFindingIds(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id));
      setSelectedQuickIds(new Set(ids));
      if (outcome === "preserved-manual") {
        toast({
          title: "Selection cleared",
          description: "Edited clinical text was kept.",
        });
      }
    }
  }, [quickSide, toast, studySetup.matchedStudyRegion]);
  handleQuickToggleRef.current = handleQuickToggle;
  selectedQuickIdsRef.current = selectedQuickIds;

  useEffect(() => {
    if (!quickSideMountedRef.current) {
      quickSideMountedRef.current = true;
      return;
    }
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
    if (isLocked || isFinalized) return;
    setStudyLocalEdit(finding);
  }, [isLocked, isFinalized]);

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
  useEffect(() => {
    void useWorkspace.getState().hydrateContentLibraries();
  }, []);

  // Keep zustand activeStudyId aligned with the URL study.
  // Do NOT call selectStudy() here — it wipes editor text / reportingContext and
  // races draft hydration. The studyId effect above already clears fields.
  useEffect(() => {
    if (!studyId) return;
    const sid = String(studyId);
    if (activeStudyId === sid) return;
    if (!studies.some((s: Study) => s.id === sid)) return;
    useWorkspace.setState({ activeStudyId: sid, railStage: "orient" });
  }, [studyId, studies, activeStudyId]);

  // Bind activeAnchor rejection to the open study's DICOM UID (study-switch safety).
  useEffect(() => {
    const uid = workflow.currentRow?.studyInstanceUID ?? null;
    const prev = useWorkspace.getState().activeStudyInstanceUID;
    if (prev === uid) return;
    useWorkspace.setState({
      activeStudyInstanceUID: uid,
      activeAnchor: null,
    });
  }, [workflow.currentRow?.studyInstanceUID]);

  // ─── Auto-open first study when the workspace has no URL study ─────────────
  useEffect(() => {
    if (studyId) return;
    if (studies.length === 0 || activeStudyId) return;
    const pr: Record<string, number> = { stat: 0, urgent: 1, routine: 2, vip: 1 };
    const sorted = [...studies].sort(
      (a: Study, b: Study) => ((pr[a.priority] ?? 2) - (pr[b.priority] ?? 2)) || (a.tatMinutes - b.tatMinutes),
    );
    if (sorted[0]) openStudy(sorted[0].id);
  }, [studies, activeStudyId, studyId, openStudy]);

  // Reset hydrate marker when studyId changes (must run before the hydrate effect).
  useEffect(() => {
    hydratedDraftForStudyRef.current = null;
    setDraftHydratedStudyId(null);
  }, [studyId]);

  // ─── Hydrate editor when study changes ──────────────────────────────────────
  useEffect(() => {
    if (!studyId) return;
    if (isLoadingExistingDraft) return;
    if (hydratedDraftForStudyRef.current === studyId) return;

    if (existingDraft) {
      const rowPatientId = workflow.currentRow?.patientId ?? null;
      // Wait for worklist patient before deciding — do not mark hydrated yet.
      if (existingDraft.patientId != null && rowPatientId == null) return;
      if (!canHydrateDraftForPatient(existingDraft.patientId, rowPatientId)) {
        console.warn("[radiology-workspace] refusing to hydrate draft for a different patient");
        hydratedDraftForStudyRef.current = studyId;
        setDraftHydratedStudyId(studyId);
        useWorkspace.setState({
          findingsText: "",
          impressionText: "",
          recommendationText: "",
          techniqueText: "",
          clinicalHistoryText: "",
          fieldProvenance: {},
          isDirty: false,
        });
        return;
      }
      hydratedDraftForStudyRef.current = studyId;
      setDraftHydratedStudyId(studyId);
      const draft = existingDraft as RadiologyDraftRow & {
        findings?: string | null;
        technique?: string | null;
      };
      // Normalize: API may return impression/recommendation as string[] or string
      const normStr = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
      useWorkspace.getState().setEditorContent({
        findings: normStr(draft.findings ?? draft.rawFindings),
        impression: normalizeImpressionLines(draft.impression).join("\n"),
        recommendation: normStr(draft.recommendation),
        technique: normStr(draft.technique),
        clinicalHistory: normStr(draft.clinicalHistory) || (workflow.currentRow as any)?.clinicalHistory || "",
      });
      const restored = extractCareStructuredFormatState(draft.structuredJson);
      if (restored?.values) {
        structuredTouchedRef.current = true;
        setStructuredValues(restored.values);
      }
      const ledger = extractCareObservationLedger(draft.structuredJson);
      const hydrated = useWorkspace.getState().hydrateObservationLedger(ledger);
      const restoredMs = extractCareViewerMeasurements(draft.structuredJson);
      if (restoredMs) {
        useWorkspace.getState().setStructuredViewerMeasurements(restoredMs);
      }
      const restoredCanal = extractCareCanalApProvenance(draft.structuredJson);
      if (restoredCanal) {
        useWorkspace.getState().setCanalApProvenance(restoredCanal as CanalApProvenanceMap);
      }
      const ids = selectedQuickFindingIds(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id));
      setSelectedQuickIds(new Set(ids));
      // Restore the persisted baseline format identity (banner / canvas state).
      // Content-level restore above is authoritative; this only recovers the
      // "applied format" label so save → close → reopen keeps its baseline.
      const formatIdentity = extractCareReportFormatIdentity(draft.structuredJson);
      if (formatIdentity?.name) {
        useWorkspace.setState({
          appliedFormatName: formatIdentity.name,
          appliedFormatReportTitle: formatIdentity.reportTitle ?? null,
        });
      } else if (useWorkspace.getState().appliedFormatName) {
        useWorkspace.setState({ appliedFormatName: null, appliedFormatReportTitle: null });
      }
      if (hydrated.warning) {
        toast({
          title: "Opened as narrative-only",
          description: hydrated.warning,
        });
      }
      return;
    }

    // No server draft — mark hydrated so protocol/template auto-select can run,
    // then optionally fill from AI draft (fill-empty only after auto setup).
    hydratedDraftForStudyRef.current = studyId;
    setDraftHydratedStudyId(studyId);
    const row = workflow.currentRow;
    const requestedStudyId = studyId;
    if (row) {
      api.post<{
        findings?: string;
        draft?: string;
        impression?: string;
        recommendation?: string;
        technique?: string;
      }>("/api/ai-reporting/draft", {
        studyInstanceUID: row.studyInstanceUID,
        worklistId: (row as { worklistId?: number }).worklistId ?? (row as { id?: number }).id,
        modality: row.modality,
        studyDescription: row.studyDescription,
        clinicalHistory: (row as { clinicalHistory?: string }).clinicalHistory,
      }).then((draft: any) => {
        if (!shouldApplyAsyncStudyResult(requestedStudyId, studyIdRef.current)) return;
        if (!draft || typeof draft !== "object") return;
        const state = useWorkspace.getState();
        const normStr = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
        // API historically returned `draft` for findings; accept both keys.
        const findings = normStr(draft.findings ?? draft.draft);
        const impressionText = normalizeImpressionLines(draft.impression).join("\n");
        const studyCtx = { modality: row.modality, studyDescription: row.studyDescription };
        // Fill-empty only so auto protocol/template win when AI is empty.
        if (!state.findingsText.trim() && findings) state.setFieldIfEmpty("findings", findings, "ai-draft");
        if (
          !state.impressionText.trim()
          && impressionText
          && impressionMatchesStudyContext(impressionText, studyCtx)
        ) {
          state.setFieldIfEmpty("impression", impressionText, "ai-draft");
        }
        if (!state.recommendationText.trim() && normStr(draft.recommendation)) state.setFieldIfEmpty("recommendation", normStr(draft.recommendation), "ai-draft");
        if (!state.techniqueText.trim() && normStr(draft.technique)) state.setFieldIfEmpty("technique", normStr(draft.technique), "ai-draft");
        if (!state.clinicalHistoryText.trim()) state.setField("clinicalHistory", (row as any).clinicalHistory ?? "");
      }).catch(() => {
        if (!shouldApplyAsyncStudyResult(requestedStudyId, studyIdRef.current)) return;
        // AI draft unavailable — still set clinical history from worklist
        const state = useWorkspace.getState();
        if (!state.clinicalHistoryText.trim()) {
          state.setField("clinicalHistory", (row as any).clinicalHistory ?? "");
        }
        // One-time toast so the radiologist knows AI was expected but failed.
        // Skip when the normal bootstrap already provided a complete report.
        const hasBaseline = editorHasMeaningfulReportText({
          technique: state.techniqueText,
          findings: state.findingsText,
          impression: state.impressionText,
          recommendation: state.recommendationText,
        });
        const shown = sessionStorage.getItem(`ai-draft-err-${studyId}`);
        if (!shown && !hasBaseline) {
          toast({ title: "AI draft unavailable", description: "Report will start blank — use Start Report or type manually.", duration: 3000 });
          sessionStorage.setItem(`ai-draft-err-${studyId}`, "1");
        }
      });
    }
  }, [studyId, existingDraft, isLoadingExistingDraft, workflow.currentRow?.patientId, workflow.currentRow, toast]);

  // ─── Normal auto-bootstrap (usg-reports concept; ONE-TIME, new+empty only) ──
  //
  // OPEN STUDY → appropriate COMPLETE NORMAL REPORT already present.
  // Applies the single high-confidence complete-normal Full Report Format via
  // the ordinary applyFormatById path — byte-identical to a radiologist
  // clicking that format (same overwrite analysis, region bridge, autosave
  // generation bump, usage counter). Never fires when a server draft exists,
  // when any meaningful report content exists, when a local backup snapshot
  // holds prior work, when the study is locked/finalized, or when identity is
  // ambiguous — the manual Start Report / format picker path stays intact.
  // Abnormal deviations afterwards flow through the canonical observation
  // ledger exactly as with a manually applied format.
  useEffect(() => {
    if (!studyId) return;
    if (draftHydratedStudyId !== studyId) return; // hydration settled for THIS study
    if (existingDraft) return; // saved report — never re-bootstrap
    if (contentLocked) return; // locked-by-other / finalized / signed
    if (normalBootstrapDoneRef.current === studyId) return; // one decision per study
    const state = useWorkspace.getState();
    if (editorHasMeaningfulReportText({
      technique: state.techniqueText,
      findings: state.findingsText,
      impression: state.impressionText,
      recommendation: state.recommendationText,
    })) return; // genuinely NEW EMPTY report only (clinicalHistory is not report body)
    const backup = draftBackup.peek();
    if (
      backup
      && (
        String(backup.rawFindings ?? "").trim()
        || String(backup.technique ?? "").trim()
        || (Array.isArray(backup.impression) ? backup.impression.join("").trim() : "")
      )
    ) return; // prior local work for this study — offer the restore banner instead
    const ctx = studySetup.studyContext;
    const decision = resolveNormalBootstrapFormat({
      ctx,
      formats: state.reportFormats,
    });
    if (decision == null) return; // identity / library unresolved yet — may retry
    normalBootstrapDoneRef.current = studyId; // decision made — never again this study
    if (decision.status !== "apply") {
      console.debug("[radiology-workspace] normal bootstrap skipped:", decision.reason);
      return;
    }
    state.applyFormatById(decision.format.id);
    // The complete normal report is the visible narrative baseline (the
    // structured-template cards remain available via the template picker).
    setUseStructured(false);
    toast({
      title: "Normal report ready",
      description: `${decision.basis} — review images, record deviations, finalize.`,
      duration: 4000,
    });
  }, [studyId, draftHydratedStudyId, existingDraft, contentLocked, draftBackup, studySetup.studyContext, toast, setUseStructured]);

  // ─── Draft rescue registration (pre-redirect save on 401) ──────────────────
  useEffect(() => {
    registerDraftRescueSaver(() => {
      writeRescueDraft({
        at: Date.now(),
        studyId: studyId ?? null,
        clinicalHistory: clinicalHistoryText,
        technique: techniqueText,
        rawFindings: findingsText,
        impression: [impressionText],
        recommendation: recommendationText,
      } as any);
    });
    return () => deregisterDraftRescueSaver();
  }, [studyId, clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText]);

  // ─── Preload next study at 80% findings completion ──────────────────────────
  useEffect(() => {
    if (!preloadTriggered || !activeStudyId) return;
    const completedSet = useWorkspace.getState().completedStudyIds;
    const remaining = studies.filter((s: Study) => !completedSet.has(s.id) && s.id !== activeStudyId);
    const pr: Record<string, number> = { stat: 0, urgent: 1, routine: 2, vip: 1 };
    remaining.sort((a: Study, b: Study) => (pr[a.priority] - pr[b.priority]) || (a.tatMinutes - b.tatMinutes));
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
          ? api.post("/api/ai-reporting/draft", { studyInstanceUID: next.studyInstanceUID, modality: next.modality })
          : Promise.resolve(null),
      ]).then(() => useWorkspace.getState().markNextStudyPreloaded());
    }
  }, [preloadTriggered, studies, activeStudyId]);

  // ─── Save draft (server-side) — returns draft id so Report Images can auto-ensure ─
  const saveDraft = useCallback(async (opts?: { silent?: boolean }): Promise<number | null> => {
    if (!studyId) return null;
    const capturedStudyId = studyId;
    const capturedGeneration = saveGenerationRef.current;
    const capturedPatientId = workflow.currentRow?.patientId ?? null;
    const offlineMsg = offlineBlockMessage(isOnline, "save");
    if (offlineMsg) {
      setAutoSaveStatus("error");
      toast({ title: "Offline", description: offlineMsg, variant: "destructive" });
      return null;
    }
    setAutoSaveStatus("saving");
    try {
      const res = await retryWithBackoff(
        () => saveRadiologyDraft<{ success?: boolean; draft?: { id: number }; id?: number }>({
          id: draftId ?? undefined,
          studyId: capturedStudyId,
          worklistId: capturedStudyId,
          patientId: capturedPatientId,
          clinicalHistory: clinicalHistoryText,
          technique: techniqueText,
          rawFindings: findingsText,
          impression: [impressionText],
          recommendation: recommendationText,
          findingsSections: useStructured ? findingsMap : undefined,
          structuredFormatState: structuredTouchedRef.current && studySetup.selectedTemplate && formatHasStructuredFields(studySetup.selectedTemplate.sectionsJson)
            ? toDraftFormatState({
              formatId: studySetup.selectedTemplate.id,
              formatVersion: studySetup.selectedTemplate.formatVersion ?? 1,
              values: structuredValues,
            })
            : undefined,
          observationLedger: useWorkspace.getState().serializeObservationLedger(),
          viewerMeasurements: (() => {
            const s = useWorkspace.getState().structuredViewerMeasurements;
            // Harden: bound payload size for draft structured_json.
            if (!s?.items || s.items.length <= 400) return s;
            return { ...s, items: s.items.slice(-400) };
          })(),
          canalApProvenance: useWorkspace.getState().canalApProvenance,
          // Baseline format identity — survives save → close → reopen so the
          // applied-format banner stays and the bootstrap never re-fires.
          reportFormatIdentity: (() => {
            const ws = useWorkspace.getState();
            return ws.appliedFormatName
              ? buildCareReportFormatIdentity({
                name: ws.appliedFormatName,
                reportTitle: ws.appliedFormatReportTitle,
              })
              : undefined;
          })(),
        } as any),
        { shouldRetry: isTransientError },
      );
      if (!shouldCommitAutosave(capturedStudyId, studyIdRef.current, capturedGeneration, saveGenerationRef.current)) {
        return null;
      }
      const id = res?.draft?.id ?? res?.id ?? null;
      if (id) captureSavedDraftId(id);
      setLastSavedAt(new Date());
      setAutoSaveStatus("saved");
      if (!opts?.silent) toast({ title: "Draft saved", duration: 1500 });
      return id;
    } catch (err) {
      setAutoSaveStatus("error");
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
      return null;
    }
  }, [studyId, draftId, clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText, isOnline, captureSavedDraftId, toast, useStructured, findingsMap, structuredValues, studySetup.selectedTemplate, workflow.currentRow?.patientId]);
  saveDraftRef.current = saveDraft;

  // ─── Finalize (sign + archive + notify) ─────────────────────────────────────
  const finalizeReport = useCallback(async () => {
    if (!studyId || !workflow.currentRow) return;
    const offlineMsg = offlineBlockMessage(isOnline, "finalize");
    if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return; }

    // 0. Session guard — never finalize without a valid user identity
    if (!sessionFresh?.user?.name) {
      toast({ title: "Session expired", description: "Reload the page to sign in before finalizing.", variant: "destructive" });
      return;
    }

    // Guard 10: pending AI proposals must never silently finalize
    const pendingAi = reportComposer.job?.trackedChanges?.filter((c) => c.reviewState === "PENDING") ?? [];
    if (
      !aiFinalizeBypassRef.current &&
      pendingAi.length > 0 &&
      reportComposer.job &&
      ["READY", "STALE_READY"].includes(reportComposer.job.status)
    ) {
      setAiFinalizeGate("pending");
      toast({
        title: "AI suggestions remain unreviewed",
        description: `${pendingAi.length} AI change(s) pending. Review, or Reject remaining and continue.`,
        variant: "destructive",
      });
      reportComposer.setReviewOpen(true);
      return;
    }
    aiFinalizeBypassRef.current = false;
    setAiFinalizeGate("idle");

    // 1. Save dirty state first (capture draft id for quality + validate-draft)
    let effectiveDraftId = draftId;
    if (useWorkspace.getState().isDirty) {
      const savedId = await saveDraft();
      if (savedId) effectiveDraftId = savedId;
    }

    // 1b. PCPNDT Form F gate (obstetric USG) — same rule as legacy
    if (pcpndtBlockedRef.current) {
      toast({
        title: "Finalize blocked — PCPNDT Form F required",
        description:
          "This is an obstetric/fetal ultrasound and the patient's PCPNDT Form F is missing or incomplete. Use Legacy Box → Measure → Review & Map to Form F, then finalize again.",
        variant: "destructive",
      });
      return;
    }

    // 2. Validate (local + server validate-draft when available)
    const validationIssues = validateReport({
      findings: findingsText,
      impression: [impressionText],
      technique: techniqueText,
    } as any);
    if (effectiveDraftId) {
      try {
        const serverVal = await api.post<{
          structured?: { errors?: unknown[]; warnings?: string[]; skipReasons?: string[] };
        }>("/api/radiology/report-generator/validate-draft", { draftId: effectiveDraftId });
        const errs = serverVal?.structured?.errors ?? [];
        const warns = serverVal?.structured?.warnings ?? [];
        const skips = serverVal?.structured?.skipReasons ?? [];
        for (const e of errs) validationIssues.push(typeof e === "string" ? e : JSON.stringify(e));
        for (const w of warns) validationIssues.push(w);
        for (const s of skips) validationIssues.push(s);
      } catch { /* non-fatal — local validation still applies */ }
    }

    // 3b. Canonical report-quality evaluation (persisted, drives finalize dialog)
    let qualityGate: Awaited<ReturnType<typeof runFinalizeQualityEvaluation>> | null = null;
    try {
      qualityGate = await runFinalizeQualityEvaluation({
        draftId: effectiveDraftId,
        modality: workflow.currentRow.modality,
        studyDescription: workflow.currentRow.studyDescription,
        clinicalHistory: clinicalHistoryText,
        technique: techniqueText,
        findings: findingsText,
        impression: impressionText,
        recommendation: recommendationText,
        checklistPercent: studySetup.checklistPercent,
      });
    } catch (err) {
      toast({
        title: "Quality check skipped",
        description: err instanceof Error ? err.message : "Could not run report quality evaluation — continuing.",
      });
    }

    const qualityAdvisory = qualityGate ? formatQualityAdvisoryForDialog(qualityGate) : "";

    // 4. Critical findings check (auto-detect + manual mark/comms from legacy)
    const criticalHits = detectCriticalFindings(findingsText, [impressionText]);
    const criticalMarked = isCritical || criticalHits.length > 0;
    const criticalCommunicated = checklistComm.phoned;
    const safetyIssues = computeFinalizeSafety({
      checklistActive: false,
      checklistPercent: 100,
      criticalHits: criticalHits.map(h => ({ label: h.label })),
      criticalMarked,
      criticalCommunicated,
    });

    // 5. Get signatures
    // Prefer Dr. Sugandha when several signatures exist — she is the clinic radiologist.
    const signaturesRaw = await api.get<{ id: number; name: string }[]>("/api/signatures");
    const signatures = [...signaturesRaw].sort((a, b) => {
      const as = /sugandha/i.test(a.name) ? 0 : 1;
      const bs = /sugandha/i.test(b.name) ? 0 : 1;
      return as - bs;
    });

    const latest = useWorkspace.getState();
    const siblingHits = collectCompositionFinalizeGate({
      impressionNeedsRefresh: latest.impressionNeedsRefresh,
      findings: latest.findingsText,
      patches: latest.appliedPathologyPatches.map((p) => ({
        id: p.id,
        observation: p.observation as never,
        templates: p.templates,
        lastRendered: p.lastRendered,
        replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
        source: p.source,
        protected: Boolean(p.protected),
        stale: p.stale,
      })),
    });

    // 6. Prompt via finalize flow (quality gate + critical ack + signer + composition gate)
    const result = await finalizeFlow.promptFinalize({
      identity: `${workflow.currentRow.patientName} — ${workflow.currentRow.studyDescription}`,
      validationSummary: (validationIssues.join("; ") + qualityAdvisory) as string,
      warningBlock: safetyIssues.filter(i => i.severity === "warn").map(i => i.message).join("; "),
      safetyBlock: formatFinalizeSafety(safetyIssues),
      unbilledNote: "",
      signatures: signatures,
      qualityGate,
      criticalRequiresAck: criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: criticalHits.map(h => ({ label: h.label })),
        criticalMarked,
        criticalCommunicated,
      }),
      criticalSummary: [
        ...criticalHits.map(h => h.label),
        ...(isCritical && criticalNote ? [criticalNote] : []),
      ].filter(Boolean).join(", "),
      compositionImpressionNeedsRefresh: latest.impressionNeedsRefresh,
      compositionSiblingWarnings: siblingHits.siblingWarnings,
      compositionStalePatchCount: siblingHits.stalePatchCount,
    });

    if (!result.confirmed) return;

    // 7. Execute finalize — read narrative AFTER refresh/ack so the signed payload matches the gate.
    const signed = useWorkspace.getState();
    const signedFindings = signed.findingsText;
    const signedImpression = signed.impressionText;
    const signedRecommendation = signed.recommendationText;
    try {
      const finalizeResult = await finalizeRadiologyReport(
        ({
          studyId,
          worklistId: studyId,
          patientId: workflow.currentRow.patientId,
          accessionNumber: workflow.currentRow.accessionNumber ?? "",
          studyInstanceUID: workflow.currentRow.studyInstanceUID ?? "",
          studyDescription: workflow.currentRow.studyDescription ?? "",
          modality: workflow.currentRow.modality ?? "",
        } as any),
        {
          title: workflow.currentRow?.studyDescription ?? "Report",
          htmlBody: (() => {
            const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
            return `<h2>${esc(workflow.currentRow?.studyDescription ?? "Report")}</h2><p><b>Findings:</b> ${esc(signedFindings).replace(/\n/g,"<br/>")}</p><p><b>Impression:</b> ${esc(signedImpression).replace(/\n/g,"<br/>")}</p><p><b>Recommendation:</b> ${esc(signedRecommendation).replace(/\n/g,"<br/>")}</p>`;
          })(),
          impression: [signedImpression],
          isCritical: criticalMarked,
          criticalNote: criticalNote || (criticalHits.length > 0 ? criticalHits.map(h => h.label).join(", ") : null),
          createdBy: sessionFresh?.user?.name ?? undefined,
          actor: sessionFresh?.user?.name ?? undefined,
          signatureId: result.signatureId,
          auditDetails: qualityGate
            ? {
                qualityEvaluationId: qualityGate.textEvaluationId,
                structuredQualityEvaluationId: qualityGate.structuredEvaluationId,
                qualityScore: qualityGate.score,
                qualityBlockingCount: qualityGate.blockingCount,
                qualityWarningCount: qualityGate.warningCount,
                qualitySource: "workspace-finalize",
              }
            : undefined,
        } as any,
      );

      // 7. Honest toast
      if (finalizeResult.signed) {
        toast({ title: "Report finalized & signed", description: `Report #${finalizeResult.reportId}` });
      } else if (finalizeResult.reportCreationSkipped) {
        toast({
          title: "Worklist marked final",
          description: finalizeResult.reportCreationSkipped.includes("no patient")
            ? "Study finalized on the worklist. No billed patient report row (expected until billing is linked)."
            : `No patient report row created: ${finalizeResult.reportCreationSkipped}`,
        });
      } else {
        toast({ title: "Report saved but NOT signed", description: finalizeResult.signError ?? "Sign error", variant: "destructive" });
      }

      // 7b. Auto-push to Hope when this study is linked to a Hope referral (best-effort).
      if (finalizeResult.signed && (finalizeResult.reportId || studyId)) {
        void api
          .post<{ ok?: boolean; alreadySent?: boolean; error?: string }>("/api/internal/radiology/send-report-to-hope", {
            reportId: finalizeResult.reportId ?? undefined,
            worklistId: studyId,
          })
          .then((r) => {
            if (r?.ok) {
              toast({
                title: r.alreadySent ? "Already on Hope" : "Sent to Hope",
                description: "Report is available on Hope ERP investigations.",
                duration: 2500,
              });
            }
          })
          .catch(() => { /* no Hope referral / integration off — silent */ });
      }

      // 8. Post-finalize cleanup
      workflow.markCompleted(studyId);
      draftBackup.clear();
      clearRescueDraft();
      useWorkspace.getState().completeFinalize();
      setReadingSession(prev => bumpSessionCompleted(prev));

      // 9. Invalidate queries
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
      qc.invalidateQueries({ queryKey: ["radiology-existing-draft", studyId] });

      // 10. RIS throughput — auto-advance to the next eligible study.
      // goNextStudy handles the transition lock + wrong-patient arrival
      // cross-check and toasts "End of queue" when nothing eligible remains.
      // The just-finalized study is excluded by identity (currentId), so the
      // not-yet-rendered completedIds update cannot cause a self-advance.
      if (result.advanceToNext) {
        goNextStudy();
      }
    } catch (err) {
      toast({ title: "Finalize failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }, [studyId, workflow, isOnline, findingsText, impressionText, recommendationText, techniqueText, clinicalHistoryText, studySetup.checklistPercent, saveDraft, finalizeFlow, draftBackup, qc, toast, isCritical, criticalNote, checklistComm, draftId, session, reportComposer, sessionFresh, goNextStudy]);

  // ─── Command dispatcher (single choke point for keyboard/voice/palette) ────
  const commandDispatcher = useMemo(() => createCommandDispatcher({
    save: async () => { await saveDraft(); },
    finalize: finalizeReport,
    next: () => { goNextStudy(); },
    previous: () => { goPrevStudy(); },
    park: () => { if (studyId) { (workflow as any).park(studyId, ""); } },
    refresh: () => workflow.refreshQueue(),
    "open-viewer": () => { openLegacyTabRef.current("open-study"); },
    "focus-quick-search": () => { openLegacyTabRef.current("library"); },
    verify: () => { verifyActionRef.current?.(); },
    unpark: () => { if (studyId) { workflow.unpark(studyId); } },
    "reload-current": () => window.location.reload(),
    "focus-findings": () => { focusReportField("findings"); },
    "focus-impression": () => { focusReportField("impression"); },
    "close-panel": () => { rightPanelRef.current?.collapse(); },
    "focus-mode": () => { enterReportingFocusMode(); },
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`select-template-${n}`, () => openLegacyTabRef.current("templates")])),
  }), [saveDraft, finalizeReport, workflow, studyId, goNextStudy, goPrevStudy, focusReportField, enterReportingFocusMode]);
  commandDispatcherRef.current = commandDispatcher;

  // ─── Global keyboard shortcuts (voice keys FIRST, then workspace) ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = voiceKeyAction(
        {
          key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
          shiftKey: e.shiftKey, repeat: e.repeat,
          target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
        },
        {
          enabled: voiceSession.enabled,
          pttKey: voiceSettings.pttKey,
          capturing: voiceSession.capturing,
          hasPendingPreview: voiceSession.pending != null,
          confirmViaEnterAllowed: voiceSession.pending?.verdict.confirmViaEnterAllowed ?? false,
        },
      );
      if (action) {
        e.preventDefault();
        if (action === "toggle-listen") voiceSession.toggleListening();
        else if (action === "ptt-start") voiceSession.startListening("ptt");
        else if (action === "confirm-pending") voiceSession.confirmPending("enter");
        else voiceSession.cancel();
        return;
      }

      // Route workflow commands through the dispatcher
      const cmd = matchWorkspaceShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      });
      if (cmd === "finalize" && !shouldHandleFinalizeShortcut(e)) {
        return;
      }
      if (cmd === "finalize" && isAiInstructionTextarea(e.target)) {
        return;
      }
      if (cmd) { e.preventDefault(); commandDispatcher.dispatch(cmd); return; }

      // New features shortcuts
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); useWorkspace.getState().toggleCommandPalette(); return; }
      if (shouldHandleFinalizeShortcut(e)) { e.preventDefault(); finalizeReport(); return; }
      if (shouldHandleAltUndoAbnormal(e)) {
        e.preventDefault();
        handleUndoLastAbnormal();
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        useWorkspace.getState().undoLastPatch();
        return;
      }
      if (e.ctrlKey && (e.key === "i" || e.key === "I")) { e.preventDefault(); triggerAiImpression(); return; }
      if (e.ctrlKey && e.shiftKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        focusVoiceBar();
        if (voiceSession.enabled && !voiceSession.capturing) {
          voiceSession.setMode("dictation");
          voiceSession.startListening("toggle");
        } else if (voiceSession.capturing) {
          voiceSession.stopListening();
        }
        return;
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "textarea" && !(t as HTMLElement)?.isContentEditable) {
          e.preventDefault();
          setShortcutHelpOpen(true);
        }
      }
      if (e.altKey && e.key === "\\") {
        e.preventDefault();
        setLayoutMode(showEmbeddedViewer ? "reportFocus" : "split");
      }
      if (e.altKey && e.key === "[") {
        e.preventDefault();
        leftCollapsed ? leftPanelRef.current?.expand() : leftPanelRef.current?.collapse();
      }
      if (e.altKey && e.key === "]") {
        e.preventDefault();
        rightPanelRef.current?.expand();
        setLegacyTab((t) => t ?? "links");
      }
      // Alt+1…9 jump to a major report section. Skip while typing so Option+digit
      // on Mac (¡™£¢∞§¶•ª) and other Alt combos in editors still produce text.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
        const target = sectionForAltDigit(e.key);
        if (target) {
          e.preventDefault();
          setActiveReportSection(target);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && voiceSession.captureTrigger === "ptt") {
        voiceSession.stopListening();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    commandDispatcher, finalizeReport, leftCollapsed, showEmbeddedViewer, setLayoutMode,
    voiceSession, voiceSettings.pttKey, focusVoiceBar, handleUndoLastAbnormal,
  ]);

  // ─── AI auto-impression (Ctrl+I) ───────────────────────────────────────────
  const triggerAiImpression = useCallback(async () => {
    const cur = useWorkspace.getState().findingsText;
    if (!cur.trim()) return;
    try {
      const res = await api.post<{ impression: string }>("/api/ai-reporting/draft", {
        studyInstanceUID: workflow.currentRow?.studyInstanceUID,
        modality: workflow.currentRow?.modality,
        field: "impression",
        findings: cur,
      });
      if (res.impression) useWorkspace.getState().setGhostText(res.impression, "impression");
    } catch (err) { console.warn("[Workspace] AI impression:", err); }
  }, [workflow.currentRow]);

  useEffect(() => {
    useWorkspace.setState({ triggerAiImpression });
    return () => useWorkspace.setState({ triggerAiImpression: undefined });
  }, [triggerAiImpression]);

  // ─── Word/PDF export (legacy layout path + Classic/Premium) ────────────────
  const { data: presentationTemplates } = useQuery<PresentationTemplatesPayload>({
    queryKey: ["presentation-templates"],
    queryFn: () => api.get("/api/radiology/presentation-templates"),
    staleTime: 60_000,
  });
  const clinicReportLayout = quickSelectLayoutKey(presentationTemplates?.active?.standard);
  const reportLayout = previewLayoutOverride ?? clinicReportLayout;

  const { data: clinicSettings } = useQuery<PrintClinic>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  const { data: imageRefs = [] } = useQuery<ReportImageRef[]>({
    queryKey: ["report-image-references", draftId],
    queryFn: () => api.get(`/api/radiology/report-generator/image-references?draftId=${draftId}`),
    enabled: !!draftId,
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

  // Detach frozen key images when an observation is removed (preserve evidence).
  useEffect(() => {
    const handler = (ev: Event) => {
      const observationId = (ev as CustomEvent<{ observationId?: string }>).detail?.observationId;
      const id = draftId;
      if (!observationId || !id || isLocked || isFinalized) return;
      void api
        .post("/api/radiology/report-generator/key-images/detach-observation", {
          draftId: id,
          observationId,
        })
        .then(() => qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) }))
        .catch(() => undefined);
    };
    window.addEventListener("care:observation-removed", handler as EventListener);
    return () => window.removeEventListener("care:observation-removed", handler as EventListener);
  }, [draftId, isLocked, isFinalized, qc]);

  // Slot-displace merge: remap key-image observationId onto the surviving observation.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ fromObservationId?: string; toObservationId?: string }>).detail;
      const fromId = detail?.fromObservationId;
      const toId = detail?.toObservationId;
      const id = draftId;
      if (!fromId || !toId || !id || isLocked || isFinalized) return;
      const items = frozenKeyImagesQ.data?.items ?? [];
      const toRemap = items.filter((img) => img.observationId === fromId);
      if (toRemap.length === 0) return;
      void Promise.all(
        toRemap.map((img) =>
          api.put(`/api/radiology/report-generator/key-images/${img.id}`, {
            observationId: toId,
          }).catch(() => undefined),
        ),
      ).then(() => qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) }));
    };
    window.addEventListener("care:observation-reassigned", handler as EventListener);
    return () => window.removeEventListener("care:observation-reassigned", handler as EventListener);
  }, [draftId, isLocked, isFinalized, qc, frozenKeyImagesQ.data?.items]);

  const viewerMeasurementsQ = useViewerMeasurements(workflow.currentRow?.studyInstanceUID);

  // Bridge viewer_measurements → MEASURE rail (Zustand) + structured measurements.
  // Historical hydration never uses live Measure toolbar / selection / activeAnchor.
  // Only rows first seen AFTER the study's first successful query resolution are new_event.
  const knownViewerRowIdsRef = useRef<Set<number>>(new Set());
  const viewerHydratedStudyUidRef = useRef<string | null>(null);
  const viewerHydrationCompleteRef = useRef(false);
  useEffect(() => {
    if (isLocked || isFinalized) return;
    const uid = workflow.currentRow?.studyInstanceUID ?? null;
    if (uid !== viewerHydratedStudyUidRef.current) {
      knownViewerRowIdsRef.current = new Set();
      viewerHydrationCompleteRef.current = false;
      viewerHydratedStudyUidRef.current = uid;
    }
    // Wait for the first successful resolution (data may be []). While loading /
    // undefined, do not mark hydration complete and do not ingest.
    if (!viewerMeasurementsQ.isSuccess) return;

    const rows = viewerMeasurementsQ.data ?? [];
    const mapped = rows
      .filter((m) => m.status !== "ignored")
      .map((m) => {
        const label =
          discLevelFromLabel(m.measurementType)
          ?? discLevelFromLabel(m.measurementId)
          ?? formatViewerMeasurementLabel(m);
        const num = Number(parseCanalApNumber(m.value) || m.value);
        return {
          id: `vm-${m.id}`,
          name: label,
          value: Number.isFinite(num) ? num : 0,
          unit: m.unit || "mm",
          source: "viewer" as const,
          inserted: m.status === "imported",
        };
      });
    useWorkspace.getState().setMeasurements(mapped);

    const store = useWorkspace.getState();
    const existingItems = store.structuredViewerMeasurements.items;
    const seenBefore = knownViewerRowIdsRef.current;
    const hydrationComplete = viewerHydrationCompleteRef.current;
    for (const m of rows) {
      const prior = existingItems.find(
        (x) =>
          x.viewerMeasurementRowId === m.id
          || (() => {
            const ann = annotationIdFromCoordinates(m.imageCoordinates);
            return Boolean(ann && x.viewerAnnotationId === ann);
          })(),
      );
      const mode = classifyViewerRowIngestMode({
        hydrationComplete,
        rowId: m.id,
        knownRowIds: seenBefore,
        hasPriorStructured: Boolean(prior),
      });
      // Track every row id from the successful response (including ignored).
      seenBefore.add(m.id);
      if (m.status === "ignored") continue;
      const isNewEvent = mode === "new_event";
      const payload = structuredFromViewerRow({
        row: m,
        mode,
        liveIntent: isNewEvent ? store.measurementIntent : null,
        liveCanalLevel: isNewEvent ? store.canalIntentLevel : null,
        liveSelectedObservationId: isNewEvent ? store.selectedObservationId : null,
        liveActiveAnchor: isNewEvent ? store.activeAnchor : null,
        prior: prior ?? null,
      });
      store.upsertStructuredViewerMeasurement(payload);
    }
    // First successful resolution — even [] or ignored-only — completes hydration.
    viewerHydrationCompleteRef.current = true;
  }, [
    viewerMeasurementsQ.data,
    viewerMeasurementsQ.isSuccess,
    isLocked,
    isFinalized,
    workflow.currentRow?.studyInstanceUID,
  ]);

  const canalApByLevel = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const m of workspaceMeasurements) {
      const level =
        discLevelFromLabel(m.name)
        ?? discLevelFromLabel(String(m.id ?? ""));
      if (!level) continue;
      const raw = typeof m.value === "number" ? m.value : Number(parseCanalApNumber(String(m.value ?? "")) || m.value);
      if (Number.isFinite(raw)) out[level] = raw;
    }
    return out;
  }, [workspaceMeasurements]);

  // OHIF postMessage → viewer_measurements / report image-references / capture
  const ohifCapturePendingRef = useRef<Set<string>>(new Set());
  const ohifTargetOriginRef = useRef<string | null>(null);
  const captionRefreshInFlightRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const uid = workflow.currentRow?.studyInstanceUID ?? null;
    if (!uid) return;
    const mutationsAllowed = !(isLocked || isFinalized);
    const liveLaunchUrl =
      embeddedViewerRef.current?.getOhifLaunchUrl?.()
      || (typeof window !== "undefined" ? window.localStorage.getItem("care_ohif_launch_url") : null);
    const viteExtras =
      typeof import.meta !== "undefined"
      && typeof (import.meta as ImportMeta & { env?: { VITE_OHIF_ALLOWED_ORIGINS?: string } }).env?.VITE_OHIF_ALLOWED_ORIGINS === "string"
        ? (import.meta as ImportMeta & { env: { VITE_OHIF_ALLOWED_ORIGINS: string } }).env.VITE_OHIF_ALLOWED_ORIGINS
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    const allowAny =
      typeof import.meta !== "undefined"
      && (import.meta as ImportMeta & { env?: { VITE_OHIF_ALLOW_ANY?: string } }).env?.VITE_OHIF_ALLOW_ANY === "1";
    const ohifOrigins = deriveOhifAllowedOrigins({
      pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
      ohifLaunchUrl: liveLaunchUrl,
      extraOrigins: viteExtras,
      allowAny,
    });
    ohifTargetOriginRef.current = resolveOhifTargetOrigin({
      ohifLaunchUrl: liveLaunchUrl,
      allowedOrigins: ohifOrigins,
      pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
    });

    return subscribeCareOhifBridge({
      studyInstanceUID: uid,
      patientId: workflow.currentRow?.patientId ?? null,
      studyId: workflow.currentRow?.studyId ?? studyId ?? null,
      draftId: draftId ?? null,
      getImageRefs: () => imageRefs,
      pendingCaptureRequestIds: ohifCapturePendingRef.current,
      mutationsAllowed,
      allowedOrigins: ohifOrigins,
      getExpectedSourceWindow: () => embeddedViewerRef.current?.getOhifWindow?.() ?? null,
      onMeasurementSaved: () => {
        if (!mutationsAllowed) return;
        void qc.invalidateQueries({ queryKey: ["viewer-measurements", uid] });
      },
      onKeyImageSaved: () => {
        if (!mutationsAllowed) return;
        void qc.invalidateQueries({ queryKey: ["report-image-references", draftId] });
        toast({ title: "Key image added from viewer" });
      },
      onActiveAnchor: (ctx) => {
        useWorkspace.getState().setActiveAnchor(viewportToAnchor(ctx));
      },
      onMeasurementDeleted: (annotationId) => {
        if (!mutationsAllowed) return;
        const store = useWorkspace.getState();
        const prev = store.structuredViewerMeasurements;
        const hit = prev.items.find((x) => x.viewerAnnotationId === annotationId);
        store.setStructuredViewerMeasurements(
          removeStructuredMeasurementByAnnotation(prev, annotationId),
        );
        // Persist ignore so refetch does not rehydrate the deleted annotation.
        if (hit?.viewerMeasurementRowId) {
          void api
            .patch(`/api/radiology-lesions/viewer-measurements/${hit.viewerMeasurementRowId}`, {
              status: "ignored",
            })
            .then(() => qc.invalidateQueries({ queryKey: ["viewer-measurements", uid] }))
            .catch(() => undefined);
        }
      },
      onViewportCaptureResult: async (msg) => {
        if (!mutationsAllowed) return;
        const blob = captureResultToBlob(msg);
        if (!blob) {
          toast({
            title: "OHIF capture failed",
            description: "Annotated image payload was unreadable.",
            variant: "destructive",
          });
          return;
        }
        let id = draftId;
        if (!id) id = await saveDraft({ silent: true });
        if (!id) {
          toast({ title: "Could not save draft for capture", variant: "destructive" });
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
          : "Key image (OHIF annotated capture)";
        const fd = new FormData();
        fd.append("image", blob, "ohif-capture.jpg");
        fd.append("draftId", String(id));
        fd.append("sourceType", "VIEWPORT_CAPTURE");
        fd.append("caption", caption);
        fd.append("captionManual", "false");
        fd.append("includeInReport", "true");
        fd.append("viewer", "ohif");
        if (selectedId) fd.append("observationId", selectedId);
        if (msg.studyInstanceUID) fd.append("studyInstanceUID", msg.studyInstanceUID);
        if (msg.seriesInstanceUID) fd.append("seriesInstanceUID", msg.seriesInstanceUID);
        if (msg.sopInstanceUID) fd.append("sopInstanceUID", msg.sopInstanceUID);
        if (msg.frameNumber != null) fd.append("frameNumber", String(msg.frameNumber));
        if (msg.annotations != null) {
          fd.append("annotationMetadataJson", JSON.stringify(msg.annotations).slice(0, 8000));
        }
        await uploadFrozenKeyImage(fd);
        void qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) });
        toast({ title: "Annotated key image captured from OHIF" });
      },
    });
  }, [
    workflow.currentRow?.studyInstanceUID,
    workflow.currentRow?.patientId,
    workflow.currentRow?.studyId,
    studyId,
    draftId,
    imageRefs,
    qc,
    toast,
    saveDraft,
    isLocked,
    isFinalized,
  ]);

  // Caption refresh: linked observation text changed + captionManual=false → refresh.
  // Harden: skip images already in-flight to avoid PUT storms.
  useEffect(() => {
    if (!draftId || isLocked || isFinalized) return;
    const items = frozenKeyImagesQ.data?.items ?? [];
    const patches = useWorkspace.getState().appliedPathologyPatches;
    for (const img of items) {
      if (!img.observationId || img.captionManual) continue;
      if (captionRefreshInFlightRef.current.has(img.id)) continue;
      const patch = patches.find((p) => p.id === img.observationId);
      if (!patch) continue;
      const next = buildObservationKeyImageCaption({
        level: patch.observation?.level,
        laterality: patch.observation?.laterality,
        concept: patch.observation?.concept,
        region: patch.observation?.region,
        lastRenderedFindings: patch.lastRendered.findings,
      });
      const refreshed = maybeRefreshCaption({
        captionManual: Boolean(img.captionManual),
        currentCaption: img.caption || "",
        nextAutoCaption: next,
      });
      if (refreshed === (img.caption || "")) continue;
      captionRefreshInFlightRef.current.add(img.id);
      void api
        .put(`/api/radiology/report-generator/key-images/${img.id}`, {
          caption: refreshed,
          captionManual: false,
        })
        .then(() => qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(draftId) }))
        .catch(() => undefined)
        .finally(() => {
          captionRefreshInFlightRef.current.delete(img.id);
        });
    }
  }, [
    draftId,
    isLocked,
    isFinalized,
    appliedPathologyPatches,
    frozenKeyImagesQ.data,
    qc,
  ]);

  const studyNameForExport = resolvePrintedReportTitle(
    appliedFormatReportTitle,
    studySetup.testName
      ?? workflow.currentRow?.studyDescription
      ?? "Radiology Report",
  );

  // ─── Canonical report demography (ERP > DICOM > manual override) ─────────
  const patientMasterQ = useQuery<{
    dateOfBirth?: string | null;
    ageValue?: number | null;
    ageUnit?: string | null;
    gender?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }>({
    queryKey: ["patient-master", workflow.currentRow?.patientId],
    queryFn: () => api.get(`/api/patients/${workflow.currentRow!.patientId}`),
    enabled: !!workflow.currentRow?.patientId,
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
    const master = patientMasterQ.data ?? null;
    const erpAge = resolveDisplayAge(
      { age: row?.age, patientAge: row?.patientAge },
      master,
      row?.dicomMetadata && typeof row.dicomMetadata === "object"
        ? String((row.dicomMetadata as Record<string, unknown>).PatientAge ?? "")
        : null,
    );
    const merged = mergeReportDemography({
      erp: {
        patientName: row?.patientName,
        age: erpAge,
        sex: row?.sex ?? master?.gender,
        patientId: row?.patientId,
        uhid: row?.uhid,
        accessionNumber: row?.accessionNumber,
        studyDescription: row?.studyDescription,
        studyDate: row?.studyDate,
        referringDoctor: row?.referringDoctor,
        dateOfBirth: master?.dateOfBirth,
      },
      dicom: (row?.dicomMetadata as Record<string, unknown> | undefined) ?? {},
      overrides: demographyOverrides,
      referringDoctorCatalog: doctorCatalogLabels(doctorsCatalogQ.data ?? []),
    });
    return merged;
  }, [workflow.currentRow, patientMasterQ.data, demographyOverrides, doctorsCatalogQ.data]);

  const livePrintBodyHtml = useMemo(
    () =>
      buildLivePrintBodyHtml({
        clinicalHistory: clinicalHistoryText,
        technique: techniqueText,
        rawFindings: findingsText,
        findingsMap: useStructured ? findingsMap : {},
        useStructured,
        impression: impressionText.split("\n").filter(Boolean),
        recommendation: recommendationText,
        impressionStyle,
        headingCase,
      }),
    [
      clinicalHistoryText, techniqueText, findingsText, findingsMap, useStructured,
      impressionText, recommendationText, impressionStyle, headingCase,
    ],
  );

  const previewHtml = useMemo(
    () =>
      buildPreviewHtml({
        patientName: canonicalDemography.patientName,
        age: canonicalDemography.age,
        sex: canonicalDemography.sex,
        accessionNumber: canonicalDemography.accessionNumber,
        referringDoctor: canonicalDemography.referringDoctor,
        studyDate: canonicalDemography.studyDate,
        headerStyle: reportLayout === "care-classic" ? "classic" : "table",
        studyName: studyNameForExport,
        technique: techniqueText,
        clinicalHistory: clinicalHistoryText,
        findingsMap: useStructured ? findingsMap : {},
        rawFindings: findingsText,
        useStructured,
        impression: impressionText.split("\n").filter(Boolean),
        recommendation: recommendationText,
        imageRefs,
        headingCase,
        sectionSpacing,
        impressionStyle,
        signerLine,
        findingsProvenance,
        impressionProvenance,
      }),
    [
      canonicalDemography, studyNameForExport, techniqueText, clinicalHistoryText,
      findingsText, impressionText, recommendationText, imageRefs,
      headingCase, sectionSpacing, impressionStyle, signerLine, reportLayout,
      useStructured, findingsMap, findingsProvenance, impressionProvenance,
    ],
  );

  const handleExportWord = useCallback(async () => {
    setExportingWord(true);
    try {
      let html = previewHtml;
      // Prefer server-rendered letter-pad layout when a draft/report exists.
      if ((reportLayout === "care-premium" || reportLayout === "care-classic") && (draftId || linkedReportIdRef.current)) {
        try {
          await saveDraft({ silent: true });
          const templateQs = reportLayoutTemplateQuery(reportLayout);
          const styleQs = `impressionStyle=${encodeURIComponent(impressionStyle)}`;
          const reportId = linkedReportIdRef.current;
          const url = reportId
            ? `/api/patient-reports/${reportId}/print?preview=true&${templateQs}&${styleQs}`
            : `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}&${styleQs}`;
          const serverHtml = await api.get<string>(url);
          if (typeof serverHtml === "string" && serverHtml.trim()) {
            html = await finalizePrintPreviewHtml(serverHtml, {
              livePrintBodyHtml,
              findingsText,
              impressionText,
              dicomWebBase: BROWSER_DICOMWEB_BASE,
              imageRefs,
              includeProvenanceChrome: false,
              demography: {
                patientName: canonicalDemography.patientName,
                age: canonicalDemography.age,
                sex: canonicalDemography.sex,
                referringDoctor: canonicalDemography.referringDoctor,
                studyDate: canonicalDemography.studyDate,
              },
            });
          }
        } catch {
          /* fall back to client previewHtml */
        }
      }
      const fileName = `${safeFileNamePart(workflow.currentRow?.patientName ?? "patient")}_${safeFileNamePart(workflow.currentRow?.accessionNumber ?? "report")}`;
      await exportRadiologyReportToWord(html, fileName, {
        patientName: canonicalDemography.patientName,
        age: canonicalDemography.age,
        sex: canonicalDemography.sex,
        referringDoctor: canonicalDemography.referringDoctor,
        studyDate: canonicalDemography.studyDate,
        chrome: activeStandardLetterhead(presentationTemplates),
        // Word is finished on pre-printed letter-pad — always reserve top margin.
        // (Header ON/OFF still controls the HTML/PDF letterhead chrome.)
        physicalLetterpad: true,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: formatReportExportError(err, "Word"),
        variant: "destructive",
      });
    } finally {
      setExportingWord(false);
    }
  }, [
    workflow.currentRow, previewHtml, toast, reportLayout, draftId, canonicalDemography,
    presentationTemplates, saveDraft, impressionStyle, livePrintBodyHtml, findingsText,
    impressionText, imageRefs,
  ]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      let measurements: Array<{ label: string; value: string }> = [];
      const spinalKey = workflow.currentRow?.studyId ?? studyId;
      if (spinalKey) {
        try {
          const rows = await api.get<Array<{ vertebraLevel: string; canalAP: string | null }>>(
            `/api/radiology/report-generator/spinal-measurements?studyId=${spinalKey}`,
          );
          const values: Record<string, string> = {};
          for (const r of rows) {
            if (r.canalAP?.trim()) values[r.vertebraLevel] = r.canalAP.trim();
          }
          const hint = [
            studySetup.matchedStudyRegion,
            workflow.currentRow?.studyDescription,
          ].filter(Boolean).join(" ");
          const segment =
            canalSegmentFromSpine(useWorkspace.getState().reportingContext.spineSegment)
            ?? resolveCanalSegment(hint)
            ?? (Object.keys(values).some((k) => k.startsWith("C")) ? "cervical" : "lumbar");
          measurements = canalApToPdfRows(segment, values);
        } catch { /* omit measurements section */ }
      }
      const frozenForPdf = frozenKeyImages
        .filter((img) => img.includeInReport)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      let frozenDataUrls: string[] = [];
      if (frozenForPdf.length > 0) {
        frozenDataUrls = (
          await Promise.all(
            frozenForPdf.map(async (img) => {
              try {
                const res = await fetch(img.imageUrl);
                if (!res.ok) return null;
                const blob = await res.blob();
                return await new Promise<string | null>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result || "") || null);
                  reader.onerror = () => resolve(null);
                  reader.readAsDataURL(blob);
                });
              } catch {
                return null;
              }
            }),
          )
        ).filter((u): u is string => Boolean(u));
      }
      await exportRadiologyReportToPdf({
        patientName: canonicalDemography.patientName,
        age: canonicalDemography.age,
        sex: canonicalDemography.sex,
        accessionNumber: canonicalDemography.accessionNumber,
        studyDate: canonicalDemography.studyDate,
        referringDoctor: canonicalDemography.referringDoctor,
        modality: workflow.currentRow?.modality ?? "",
        bodyPart: workflow.currentRow?.studyDescription ?? "",
        clinicalHistory: clinicalHistoryText,
        technique: techniqueText,
        useStructured,
        findingsMap: useStructured ? findingsMap : {},
        rawFindings: findingsText,
        impression: impressionText.split("\n").filter(Boolean),
        recommendation: recommendationText,
        studyName: studyNameForExport,
        headingCase,
        dicomWebBase: BROWSER_DICOMWEB_BASE,
        imageRefs,
        frozenKeyImages: frozenDataUrls,
        clinic: clinicSettings ?? null,
        letterhead: activeStandardLetterhead(presentationTemplates),
        showLetterpadHeader,
        measurements,
        doctorsCatalog: doctorsCatalogQ.data ?? [],
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: formatReportExportError(err, "PDF"),
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  }, [
    canonicalDemography, clinicalHistoryText, techniqueText, findingsText,
    impressionText, recommendationText, studyNameForExport, headingCase,
    imageRefs, frozenKeyImages, clinicSettings, toast, workflow.currentRow,
    useStructured, findingsMap, presentationTemplates, showLetterpadHeader,
    studyId, studySetup.matchedStudyRegion, doctorsCatalogQ.data,
  ]);

  const handlePrintLikeFinal = useCallback(async () => {
    let id = draftId;
    if (!id) id = await saveDraft({ silent: true });
    if (!id) {
      toast({ title: "Could not save draft", description: "Print-like-final needs a saved draft.", variant: "destructive" });
      return;
    }
    setPrintingLikeFinal(true);
    const w = window.open("", "_blank");
    if (!w) {
      setPrintingLikeFinal(false);
      toast({ title: "Popup blocked", description: "Allow popups for this site to print.", variant: "destructive" });
      return;
    }
    try {
      const templateQs = reportLayoutTemplateQuery(reportLayout);
      const styleQs = `impressionStyle=${encodeURIComponent(impressionStyle)}`;
      const url = `/api/radiology/report-generator/drafts/${id}/print-preview?autoPrint=true&likeFinal=true&${templateQs}&${styleQs}`;
      let html = await api.get<string>(url);
      if (typeof html !== "string" || !html.trim()) {
        throw new Error("Empty print preview");
      }
      // Merge unsaved editor text into server layout; hydrate key images client-side.
      html = await finalizePrintPreviewHtml(html, {
        livePrintBodyHtml,
        findingsText,
        impressionText,
        dicomWebBase: BROWSER_DICOMWEB_BASE,
        imageRefs,
        includeProvenanceChrome: false,
        demography: {
          patientName: canonicalDemography.patientName,
          age: canonicalDemography.age,
          sex: canonicalDemography.sex,
          referringDoctor: canonicalDemography.referringDoctor,
          studyDate: canonicalDemography.studyDate,
        },
      });
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch (err) {
      w.close();
      toast({
        title: "Print preview failed",
        description: err instanceof Error ? err.message : "Could not open print layout.",
        variant: "destructive",
      });
    } finally {
      setPrintingLikeFinal(false);
    }
  }, [
    draftId, reportLayout, saveDraft, toast, imageRefs, impressionStyle,
    livePrintBodyHtml, findingsText, impressionText, canonicalDemography,
  ]);

  // ─── Teaching case save ─────────────────────────────────────────────────────
  const handleSaveTeachingCase = useCallback(async () => {
    if (!studyId) return;
    try {
      await api.post("/api/teaching-cases/generate-from-report", {
        studyId,
        findings: findingsText,
        impression: impressionText,
        modality: workflow.currentRow?.modality,
        studyDescription: workflow.currentRow?.studyDescription,
        patientName: workflow.currentRow?.patientName,
      });
      toast({ title: "Saved as teaching case" });
    } catch (err) { toast({ title: "Teaching case save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }); }
  }, [studyId, findingsText, impressionText, toast, workflow.currentRow]);

  // ─── Verify / countersign (legacy D9) — additive; does not replace Finalize ─
  const linkedReportId = useMemo(() => {
    const row = workflow.currentRow as { reportId?: number | null } | null | undefined;
    const draft = existingDraft as { finalReportId?: number | null } | null | undefined;
    return draft?.finalReportId ?? row?.reportId ?? null;
  }, [workflow.currentRow, existingDraft]);
  linkedReportIdRef.current = linkedReportId;

  // ─── Report share (WhatsApp) — dialog with phone + verify-then-send ─────────
  const handleShare = useCallback(() => {
    const reportId = linkedReportIdRef.current;
    if (!reportId) {
      toast({
        title: "Finalize the report first",
        description: "WhatsApp send needs a signed patient report. Use Finalize, then Share.",
        variant: "destructive",
      });
      return;
    }
    setWhatsappShareOpen(true);
  }, [toast]);

  const { data: finalReport } = useQuery<{
    id?: number;
    signedByName?: string | null;
    status?: string | null;
    lifecycle?: { state?: string; superseded?: boolean };
    version?: { superseded?: boolean };
  }>({
    queryKey: ["workspace-final-report", linkedReportId],
    queryFn: () => api.get(`/api/patient-reports/${linkedReportId}`),
    enabled: !!linkedReportId,
  });

  const verifyGate = useMemo(
    () => canVerifyReport(
      {
        subjectName: session?.user?.name ?? undefined,
        role: session?.user?.role ?? undefined,
        permissions: (session?.user as { permissions?: string[] } | undefined)?.permissions,
      },
      finalReport ?? null,
    ),
    [session, finalReport],
  );
  const reportSuperseded = Boolean(finalReport?.version?.superseded || finalReport?.lifecycle?.superseded);
  const canShowVerify = Boolean(finalReport) && verifyGate.allowed && !reportSuperseded;
  canVerifyRef.current = canShowVerify;

  const handleVerifyReport = useCallback(async () => {
    if (!finalReport || verifyBusy) return;
    const targetId = finalReport.id ?? linkedReportId;
    if (!targetId) return;
    setConfirmVerify(true);
  }, [finalReport, verifyBusy, linkedReportId]);

  const confirmedVerifyReport = useCallback(async () => {
    setConfirmVerify(false);
    setVerifyBusy(true);
    try {
      const targetId = finalReport?.id ?? linkedReportId;
      if (!targetId) return;
      await api.post(`/api/patient-reports/${targetId}/verify`, {
        verifiedByName: sessionFresh?.user?.name ?? undefined,
      });
      toast({ title: "Report verified" });
      void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
    } catch (err) {
      toast({
        title: "Verify failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    } finally {
      setVerifyBusy(false);
    }
  }, [finalReport, linkedReportId, sessionFresh, toast, qc]);

  verifyActionRef.current = () => {
    if (canShowVerify && !verifyBusy) void handleVerifyReport();
  };

  const openLegacyTab = useCallback((tab: LegacyBoxTab) => {
    setLegacyTab(tab);
    rightPanelRef.current?.expand();
  }, []);
  openLegacyTabRef.current = openLegacyTab;

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
    refetchInterval: 30000,
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
    refetchInterval: 30_000,
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

  // Dual Screen: open Legacy Open Study (popup viewer). Fall back to Split if blocked.
  useEffect(() => {
    if (layoutMode !== "dualScreen") return;
    openLegacyTab("open-study");
  }, [layoutMode, studyId, openLegacyTab]);

  // ─── Compute derived state ──────────────────────────────────────────────────
  const study = studies.find((s: Study) => s.id === activeStudyId);
  const sessionMin = Math.floor((Date.now() - sessionStartedAt) / 60000);
  const showFatigue = sessionMin >= 90 && sessionMin % 90 < 2 && !useWorkspace.getState().fatigueCardDismissed;
  const findingsPct = study ? getFindingsCompletionPct(findingsText, study.modality) : 0;

  // ─── Collapsed-section summaries (orientation, not another card) ────────────
  // Always use catalog-enriched REF. BY (Settings → Doctors degree), not the raw
  // worklist string which often lacks qualification.
  const referringDoctorName = canonicalDemography.referringDoctor || null;
  const findingsAssistedCount = useMemo(
    () =>
      countAssisted(
        provenanceMapToSegments(findingsText, findingsProvenance ?? {}).map((seg) => ({
          kind: provenanceVisualKind(seg.sources),
          label: "",
        })),
      ),
    [findingsText, findingsProvenance],
  );
  const findingsTextDebounced = useDebouncedValue(findingsText, 200);
  const findingsLintCount = useMemo(
    () => (findingsTextDebounced ? runLintRules(findingsTextDebounced, { modality: study?.modality ?? "XR", sex: study?.patient?.sex }).length : 0),
    [findingsTextDebounced, study?.modality, study?.patient?.sex],
  );
  const reportLayoutLabel = REPORT_LAYOUT_OPTIONS.find((o) => o.key === reportLayout)?.label ?? "Classic";
  const sectionSummaries: Record<ReportSectionId, string> = {
    demography: summarizeDemography({
      patientName: canonicalDemography.patientName,
      age: canonicalDemography.age,
      sex: canonicalDemography.sex,
      patientCode: canonicalDemography.uhid || canonicalDemography.patientId || null,
    }),
    refDoctor: summarizeRefDoctor(referringDoctorName),
    region: summarizeRegion({
      regions: studySetup.studyRegions,
      protocolName: studySetup.activeProtocol?.name ?? null,
      testName: studySetup.testName,
      templateMismatch: studySetup.templateMismatch,
    }),
    history: summarizeFieldText(clinicalHistoryText, "Not recorded"),
    technique: summarizeTechnique({
      techniqueText,
      protocolName: studySetup.activeProtocol?.name ?? null,
    }),
    findings: summarizeFindings({
      findingsText,
      structured: useStructured,
      structuredSectionCount: Object.keys(findingsMap).length,
      assistedCount: findingsAssistedCount,
      lintCount: findingsLintCount,
    }),
    impression: summarizeImpression(impressionText),
    recommendation: summarizeRecommendation(recommendationText, isCritical),
    report: summarizeReport({ layoutLabel: reportLayoutLabel, paper: "A4" }),
  };
  const sectionStatus = sectionStatuses({
    hasPatient: !!workflow.currentRow,
    refDoctor: referringDoctorName,
    regions: studySetup.studyRegions,
    templateMismatch: studySetup.templateMismatch,
    clinicalHistoryText,
    techniqueText,
    findingsText,
    structured: useStructured,
    structuredSectionCount: Object.keys(findingsMap).length,
    impressionText,
    recommendationText,
    critical: isCritical,
    reportReady: !!draftId,
  });
  const sectionMeta = (id: ReportSectionId) => {
    const idx = REPORT_SECTIONS.findIndex((s) => s.id === id);
    const meta = REPORT_SECTIONS[idx];
    return { index: idx + 1, label: meta.label, accent: meta.accent };
  };
  /** Shared props for every accordion header — keeps the nine call sites terse. */
  const accordionProps = (id: ReportSectionId, extra?: { collapsedWarning?: ReactNode }) => {
    const meta = sectionMeta(id);
    return {
      id,
      index: meta.index,
      label: meta.label,
      accent: meta.accent,
      summary: sectionSummaries[id],
      status: sectionStatus[id],
      active: activeReportSection === id,
      onActivate: activateReportSection,
      collapsedWarning: extra?.collapsedWarning,
    };
  };

  const impressionContradictionWarnings = useMemo(() => [
    ...structuredCanalApContradiction(appliedPathologyPatches),
    ...ledgerSeverityContradiction(appliedPathologyPatches, impressionText),
    ...validateReport({
      findings: findingsText,
      impression: impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
    }).filter((w) => /contradict|mismatch|severity|stenosis|moderate|severe|laterality/i.test(w)),
  ], [appliedPathologyPatches, impressionText, findingsText]);

  // Auto-reveal sections that carry validation / stale warnings so collapse
  // never hides a blocker.
  useEffect(() => {
    const need = sectionsRequiringReveal({
      impressionNeedsRefresh,
      impressionHasContradiction: impressionContradictionWarnings.length > 0,
      recommendationCritical: isCritical,
    });
    if (need.length === 0) return;
    if (activeReportSection && need.includes(activeReportSection)) return;
    // Prefer impression when both impression + recommendation need attention.
    const target = need.includes("impression") ? "impression" : need[0]!;
    setActiveReportSection(target);
  }, [impressionNeedsRefresh, impressionContradictionWarnings.length, isCritical, activeReportSection]);

  const undoLastAbnormalEnabled = canUndoLastAbnormal({
    lastPatchSnapshot,
    appliedPathologyPatches,
    isFinalized,
  }, { locked: isLocked });

  // ─── Auto-collapse panels on mobile ──────────────────────────────────────
  useEffect(() => {
    if (isMobile) {
      leftPanelRef.current?.collapse();
      rightPanelRef.current?.collapse();
    }
  }, [isMobile]);

  // ─── Debounced server auto-save (30 s after last keystroke) ─────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDirty || !isOnline || !draftId || isFinalized || isMobile) {
      if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const genAtSchedule = saveGenerationRef.current;
      setAutoSaveStatus("saving");
      saveDraft({ silent: true }).then((id) => {
        if (genAtSchedule !== saveGenerationRef.current) return;
        setAutoSaveStatus(id != null ? "saved" : "error");
      }).catch(() => {
        if (genAtSchedule !== saveGenerationRef.current) return;
        setAutoSaveStatus("error");
      });
    }, 30_000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [isDirty, isOnline, draftId, isFinalized, isMobile, findingsText, impressionText, techniqueText, recommendationText, clinicalHistoryText, saveDraft]);

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-emerald-50/40 via-background to-background overflow-hidden">
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
              onClick={() => setLayoutMode(m.mode)}
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
              if (id) openStudy(id);
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
          title={leftCollapsed ? "Expand worklist" : "Collapse worklist"}
          data-testid="toggle-left-panel"
          onClick={() => (leftCollapsed ? leftPanelRef.current?.expand() : leftPanelRef.current?.collapse())}
        >
          {leftCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title={rightCollapsed ? "Expand Orient / Observe / Measure" : "Collapse Orient / Observe / Measure"}
          data-testid="toggle-right-panel"
          onClick={() => (rightCollapsed ? rightPanelRef.current?.expand() : rightPanelRef.current?.collapse())}
        >
          {rightCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
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
          {/* Legacy Box opener — does not replace new UI */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-amber-800"
            title="Open Legacy Box (old tools kept alongside)"
            data-testid="open-legacy-box"
            onClick={() => openLegacyTab(legacyTab ?? "links")}
          >
            <Archive className="h-3.5 w-3.5 mr-1" /> Legacy
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
            const keySections: ReportSectionId[] = ["history", "technique", "findings", "impression", "recommendation"];
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
          {/* Finalize */}
          <Button size="sm" className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={finalizeReport} disabled={!studyId || isLocked || (!allowEditSigned && (isFinalized || workflow.currentRow?.status === "REPORT_FINAL")) || pcpndtBlocked}
            title={pcpndtBlocked ? "Complete PCPNDT Form F before finalize" : undefined}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            {isFinalized ? "Signed" : "Finalize"}
            <kbd className="ml-1.5 rounded bg-white/20 px-1 py-0.5 text-[8px] font-mono">⌃↵</kbd>
          </Button>
        </div>
      </header>

      {/* ─── Lock status bar ─── */}
      {isLocked && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          <Lock className="h-3 w-3" />
          Study locked by {studyLock.ownerName}. Expires {studyLock.expiresAt ? new Date(studyLock.expiresAt).toLocaleTimeString() : "soon"}.
          <Button size="sm" variant="outline" className="h-5 text-[10px] ml-auto" onClick={() => studyLock.forceRelease(String(studyId))}>
            Force release
          </Button>
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
        <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          <AlertTriangle className="h-3 w-3" />
          PCPNDT Form F incomplete{pcpndtMissing.length ? `: ${pcpndtMissing.join(", ")}` : ""}. Finalize is blocked — use Legacy Box → Measure → Review & Map to Form F.
          <Button size="sm" variant="outline" className="h-5 text-[10px] ml-auto" onClick={() => openLegacyTab("measurements")}>
            Open Measure
          </Button>
        </div>
      )}
      {isObUsg && pcpndtCompliance?.compliant === true && (
        <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-emerald-50 to-emerald-100/60 border-b border-emerald-200 text-[11px] text-emerald-800 font-medium">
          <ShieldCheck className="h-3 w-3" /> PCPNDT Form F verified
        </div>
      )}

      {/* ─── Three-column resizable layout ─── */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          {/* Left: Worklist — collapsible like the legacy workspace */}
          <ResizablePanel
            defaultSize={18}
            minSize={12}
            maxSize={26}
            collapsible
            collapsedSize={3}
            ref={leftPanelRef}
            onCollapse={() => setLeftCollapsed(true)}
            onExpand={() => setLeftCollapsed(false)}
          >
            <div className="h-full border-r border-emerald-200/50 bg-gradient-to-b from-card to-emerald-50/20">
              {leftCollapsed ? (
                <button
                  type="button"
                  className="flex h-full w-full flex-col items-center gap-2 py-3 text-emerald-600 hover:bg-emerald-50 transition-colors"
                  onClick={() => leftPanelRef.current?.expand()}
                  title="Expand worklist"
                  data-testid="left-panel-expand"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  <span className="text-[9px] writing-mode-vertical font-semibold tracking-wider uppercase text-emerald-700" style={{ writingMode: "vertical-rl" }}>
                    Queue
                  </span>
                </button>
              ) : (
                <WorklistStrip
                  onSelectStudy={openStudy}
                  onNextStudy={goNextStudy}
                  modalityFilter={queueModality}
                  onModalityFilterChange={persistQueueModality}
                  datePreset={datePreset}
                  onDatePresetChange={persistDatePreset}
                  sortMode={queueSort}
                  onSortModeChange={persistQueueSort}
                  onWarmMriTodayYesterday={() => warmMriTodayYesterday.mutate()}
                  mriWarmBusy={warmMriTodayYesterday.isPending || !!mriWarmStatus?.running}
                  mriWarmLabel={mriWarmCountLabel}
                />
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Center: Embedded WADO + compact Print/Report pickers (hidden in Report Focus) */}
          {showEmbeddedViewer && (
            <>
              <ResizablePanel
                defaultSize={layoutMode === "viewerFocus" ? 48 : 36}
                minSize={28}
                maxSize={58}
              >
                <div
                  className="flex h-full flex-col"
                  data-testid="embedded-viewer-column"
                  onMouseDown={enterReportingFocusMode}
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
                      onRequestOhifAnnotatedCapture={
                        isLocked || isFinalized
                          ? undefined
                          : () => {
                              const requestId = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                              ohifCapturePendingRef.current.add(requestId);
                              const win = embeddedViewerRef.current?.getOhifWindow?.();
                              let targetOrigin = ohifTargetOriginRef.current;
                              if (!targetOrigin) {
                                const launch = embeddedViewerRef.current?.getOhifLaunchUrl?.();
                                if (launch) {
                                  try { targetOrigin = new URL(launch).origin; } catch { /* ignore */ }
                                }
                              }
                              const ok = requestOhifViewportCapture({
                                target: win,
                                requestId,
                                targetOrigin,
                              });
                              if (!ok) {
                                ohifCapturePendingRef.current.delete(requestId);
                                toast({
                                  title: "OHIF capture unavailable",
                                  description: "OHIF iframe is not ready. Switch to Frames or open OHIF in a new tab.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              toast({
                                title: "Annotated capture requested",
                                description: "Waiting for CARE OHIF extension. Falls back to Frames/upload if unsupported.",
                              });
                              window.setTimeout(() => {
                                ohifCapturePendingRef.current.delete(requestId);
                              }, 60_000);
                            }
                      }
                      onCaptureViewport={
                        isLocked || isFinalized
                          ? undefined
                          : async (payload) => {
                              setCaptureBusy(true);
                              try {
                                let id = draftId;
                                if (!id) id = await saveDraft({ silent: true });
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
                        isLocked || isFinalized
                          ? undefined
                          : async (ref) => {
                              let id = draftId;
                              if (!id) id = await saveDraft({ silent: true });
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
                        disabled={isLocked || isFinalized || workflow.currentRow?.status === "REPORT_FINAL"}
                        filterObservationId={keyImageFilterObsId}
                        observationLabels={observationLabels}
                        onFocusObservation={(id) => {
                          useWorkspace.getState().setSelectedObservationId(id);
                          setKeyImageFilterObsId(id);
                        }}
                        aiSelectedIds={aiSelectedKeyImageIds}
                        onAiSelectedIdsChange={setAiSelectedKeyImageIds}
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
                      <ReportImagePicker
                        draftId={draftId ?? null}
                        studyId={studyId ?? null}
                        studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                        disabled={isLocked || isFinalized || workflow.currentRow?.status === "REPORT_FINAL"}
                        onEnsureDraft={isLocked ? undefined : () => saveDraft({ silent: true })}
                        onExpandChange={setReportImagesOpen}
                        hideSelectedList
                      />
                    </div>
                  )}
                  {!viewerColumnExpanded && workflow.currentRow && (
                    <div className="border-t border-border shrink-0">
                      <PrintImagePicker
                        studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                        disabled={isLocked || isFinalized || workflow.currentRow?.status === "REPORT_FINAL"}
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {/* Right: Editor + Copilot Rail */}
          <ResizablePanel defaultSize={showEmbeddedViewer ? (layoutMode === "viewerFocus" ? 38 : 46) : 82} minSize={36}>
            <ResizablePanelGroup direction="horizontal">
              {/* Editor column */}
              <ResizablePanel defaultSize={58} minSize={42}>
                <div className="h-full flex bg-gradient-to-b from-card to-emerald-50/10 min-h-0">
                <div className="flex flex-1 min-w-0 flex-col min-h-0">
                  {/* Viewer chrome — never hidden behind an accordion header */}
                  <div className="shrink-0 space-y-2 px-3 pt-3 empty:hidden">
                    {!showEmbeddedViewer && layoutMode === "reportFocus" && (
                      <button
                        type="button"
                        data-testid="open-ohif-viewer"
                        onClick={() => setLayoutMode("split")}
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
                          onClick={() => setViewerFocus(false)}
                          className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                          title="Show app menu again"
                          data-testid="viewer-focus-restore"
                        >
                          Show details
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Reporting pane — progressive accordion (one active section).
                      R2 lumbar canvas / ledger live inside Findings; sections still
                      auto-collapse when another header is activated. */}
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
                    data-testid="reporting-canvas-r2"
                    data-report-accordion="progressive"
                    onMouseDown={enterReportingFocusMode}
                  >
                    <AnchorRail anchor={activeAnchor} />
                    {/* 1. DEMOGRAPHY — canonical, editable, feeds all outputs */}
                    <ReportAccordionSection {...accordionProps("demography")}>
                      {workflow.currentRow ? (
                        <ReportDemographyCard
                          value={canonicalDemography}
                          onChange={(patch) => setDemographyOverrides((prev) => ({ ...prev, ...patch }))}
                          disabled={isLocked || isFinalized}
                        />
                      ) : (
                        <p className="py-2 text-xs text-muted-foreground">No study selected.</p>
                      )}
                    </ReportAccordionSection>

                    {/* Report Format — first-class one-click whole-report control.
                        Below demography / study context; before Region and Technique.
                        Same Zustand apply engine as the right-rail picker. */}
                    <div className="px-0.5" data-testid="report-format-primary-slot">
                      <WholeReportFormatControl
                        reportingContext={studySetup.studyContext}
                        modality={workflow.currentRow?.modality ?? null}
                        bodyPartFallback={studySetup.matchedStudyRegion}
                        studyDescription={workflow.currentRow?.studyDescription ?? null}
                        disabled={isLocked || isFinalized}
                      />
                    </div>

                    {/* 2. REFERRING DOCTOR — current doctor, edit, quick chips, add */}
                    <ReportAccordionSection {...accordionProps("refDoctor")}>
                      {workflow.currentRow ? (
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
                    {/* One-click Start Report */}
                    {!isLocked && !isFinalized && reportNeedsStart && (studySetup.matchedStudyRegion || studySetup.studyRegions[0]) && (
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
                            One click applies protocol, template, and normal findings. You can undo immediately.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs font-semibold gap-1 bg-amber-600 hover:bg-amber-700 text-white border-0"
                          onClick={handleStartReport}
                          data-testid="btn-start-report"
                        >
                          <Zap size={14} /> Start Report
                        </Button>
                      </div>
                    )}

                    {canUndoStartReport && !isLocked && !isFinalized && (
                      <div className="flex items-center gap-2 p-2 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs">
                        <span className="flex-1">Report bootstrapped — undo restores your previous text.</span>
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={undoStartReport}>
                          Undo start
                        </Button>
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
                        disabled={isLocked || isFinalized}
                        onOpenTab={(tab) => {
                          if (tab === "measurements") openLegacyTab("measurements");
                          else if (tab === "templates" || tab === "quickselect") openLegacyTab("templates");
                          else if (tab === "prior") rightPanelRef.current?.expand();
                          else openLegacyTab("links");
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
                      modality={workflow.currentRow?.modality ?? null}
                      disabled={isLocked || isFinalized}
                      testName={studyNameForExport || studySetup.testName}
                      activeProtocolName={studySetup.activeProtocol?.name ?? null}
                      onReapplyDefaults={() => studySetup.reapplyDefaults()}
                      canReapplyDefaults={studySetup.studyRegions.length > 0}
                    />

                    </div>
                    </ReportAccordionSection>

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
                          disabled={isLocked || isFinalized}
                        />
                        <FindingsEditor
                          field="clinicalHistory"
                          label="Clinical History"
                          minHeight="56px"
                          placeholder="Presenting complaint and relevant history."
                          hideQuickSelect
                        />
                      </div>
                      {!isLocked && !isFinalized && (
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
                      isOwner={isOwner}
                      disabled={isLocked || isFinalized}
                    />
                    <div className="flex items-center gap-2 mt-1.5" data-testid="canonical-technique-editor">
                      <div className="flex-1">
                        <FindingsEditor
                          field="technique"
                          label="Technique"
                          minHeight="60px"
                          placeholder="Modality, sequences, contrast..."
                          hideQuickSelect
                          onQuickSelectPick={() => { void saveDraft({ silent: true }); }}
                        />
                      </div>
                      {!isLocked && !isFinalized && (
                        <FieldCareMic voice={voiceSession} target="technique" />
                      )}
                    </div>
                    </ReportAccordionSection>

                    {/* 6. FINDINGS — region-aware macros on top, editor as the hero,
                         and exactly ONE assistance drawer open at a time below. */}
                    <ReportAccordionSection
                      {...accordionProps("findings")}
                      headerExtra={
                        <div className="flex shrink-0 items-center gap-2">
                          <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                            <Checkbox
                              checked={useStructured}
                              onCheckedChange={(v) => {
                                const on = !!v;
                                setUseStructured(on);
                                if (on && Object.keys(findingsMap).length === 0 && studySetup.templateFindingsSections.length > 0) {
                                  const map: Record<string, { normal: boolean; text: string }> = {};
                                  for (const s of studySetup.templateFindingsSections) {
                                    map[s.label] = { normal: true, text: s.normal };
                                  }
                                  setFindingsMap(map);
                                }
                              }}
                              disabled={isLocked || isFinalized}
                            />
                            Structured
                          </label>
                          <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                            <Checkbox
                              checked={studySetup.highlightFindings}
                              onCheckedChange={(v) => studySetup.setHighlightFindings(!!v)}
                            />
                            Highlight scan
                          </label>
                          {!isLocked && !isFinalized && (
                            <FieldCareMic voice={voiceSession} target="findings" />
                          )}
                        </div>
                      }
                    >
                    {/* A. Region-aware macros — driven by the Region section above.
                        Pencil edits a box; the dashed blank box adds a new one.
                        Same add/edit also lives in Settings → Radiology → Quick Select. */}
                    {!useStructured && (
                      <ChocolateBoxMacros
                        setKey={studySetup.chocolateBoxSet.key}
                        label={studySetup.chocolateBoxSet.label}
                        disabled={isLocked || isFinalized}
                        onInsert={studySetup.applyChocolateTile}
                        onRemoveBundle={(bundleId) => useWorkspace.getState().removeMacroBundle(bundleId)}
                      />
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
                          disabled={isLocked || isFinalized}
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
                        <SpineApCanalMeasurements segment="lumbar" disabled={isLocked || isFinalized} />
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
                          disabled={isLocked || isFinalized}
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
                        <SpineApCanalMeasurements segment="cervical" disabled={isLocked || isFinalized} />
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
                          disabled={isLocked || isFinalized}
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
                    <ObservationLedgerPanel
                      patches={appliedPathologyPatches}
                      findingsText={findingsText}
                      selectedId={selectedObservationId}
                      keyImageCounts={keyImageCounts}
                      measurementChips={measurementChips}
                      impressionDisabled={isLocked || isFinalized}
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
                          document.getElementById(`r2-region-${level}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
                        disabled={isLocked || isFinalized}
                      />
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
                          disabled={isLocked || isFinalized}
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

                    {useStructured ? (
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
                                    disabled={isLocked || isFinalized}
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
                                    disabled={isLocked || isFinalized}
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
                                {!isLocked && !isFinalized && (
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
                                  disabled={isLocked || isFinalized}
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
                    ) : studySetup.highlightFindings ? (
                      <FindingsHighlightEditor
                        value={findingsText}
                        onChange={(v) => useWorkspace.getState().setField("findings", v)}
                        placeholder="Type findings. Abnormal lines tint amber."
                        className="min-h-[220px]"
                        disabled={isLocked || isFinalized}
                        dataEditor="findings"
                      />
                    ) : (
                      /* B. The editor is the hero. Its Quick Select tile wall moves
                         to the Quick Select drawer below (same component). */
                      <FindingsEditor
                        field="findings"
                        label=""
                        minHeight="220px"
                        placeholder="Type findings. Use :macro + Tab for snippets. Ctrl+Enter for AI ghost."
                        showGhost
                        hideQuickSelect
                        transientHighlight={
                          abnormalHighlight
                            ? { needle: abnormalHighlight.needle, token: abnormalHighlight.token }
                            : null
                        }
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
                    <OwnershipTracePanel />

                    {/* C. Assistance drawers — one at a time; every panel stays
                         mounted so search text, structured nav and drafts survive. */}
                    <div className="mt-2 space-y-1.5">
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
                          disabled={isLocked || isFinalized}
                          sticky
                        />
                        <QuickSelectStrip
                          field="findings"
                          bodyPart={studySetup.matchedStudyRegion}
                          anatomyFilter={activeFindingsAnatomy}
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
                          />
                        </div>
                      </FindingsToolDrawer>

                      {/* Structured format (P1) — level-based / repeating groups */}
                      <FindingsToolDrawer id="structured" active={activeFindingsTool === "structured"}>
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
                              patientId={workflow.currentRow.patientId}
                              excludeStudyId={studyId ?? undefined}
                              modality={workflow.currentRow.modality ?? ""}
                              studyDescription={workflow.currentRow.studyDescription ?? ""}
                              comparisonMissing={false}
                              disabled={isLocked || isFinalized}
                              onInsertFindings={appendFindings}
                              onOpenPriorTab={() => rightPanelRef.current?.expand()}
                            />
                          )}
                          {!isLocked && workflow.currentRow?.studyInstanceUID && (
                            <ViewerMeasurementsBanner
                              studyInstanceUID={workflow.currentRow.studyInstanceUID}
                              disabled={isLocked || isFinalized}
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
                                copilotClear={true}
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
                                        if (isLocked || isFinalized) return;
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
                    </ReportAccordionSection>

                    {/* 7. IMPRESSION — Quick Select + editor + Generate + dictation */}
                    <ReportAccordionSection
                      {...accordionProps("impression", {
                        collapsedWarning: (impressionNeedsRefresh || impressionContradictionWarnings.length > 0) ? (
                          <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[9px] text-amber-950" data-testid="impression-collapsed-warning">
                            {impressionNeedsRefresh
                              ? "⚠ Impression needs refresh — expand to review"
                              : "⚠ Contradiction detected — expand to review"}
                          </div>
                        ) : null,
                      })}
                    >
                      <ImpressionStaleBanner
                        needsRefresh={impressionNeedsRefresh}
                        disabled={isLocked || isFinalized}
                        onRefresh={() => useWorkspace.getState().refreshImpressionFromLedger()}
                      />
                      <ContradictionBanner
                        warnings={impressionContradictionWarnings}
                      />
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Impression</span>
                          {!isLocked && !isFinalized && (
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
                                  <Sparkles size={11} className="mr-1" /> Generate Impression
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        {!isLocked && !isFinalized && (
                          <QuickSelectStrip
                            field="impression"
                            bodyPart={studySetup.matchedStudyRegion}
                            compact
                            onAfterPick={() => { void saveDraft({ silent: true }); }}
                          />
                        )}
                        <FindingsEditor field="impression" label="" minHeight="100px" placeholder="Conclusion. Ctrl+I for AI impression." showGhost />
                      </div>
                      {!isLocked && !isFinalized && (
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
                            setActiveReportSection("findings");
                            setActiveFindingsTool("structured");
                          }}
                        >
                          Findings → Structured
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
                        {!isLocked && !isFinalized && (
                          <QuickSelectStrip
                            field="recommendation"
                            bodyPart={studySetup.matchedStudyRegion}
                            compact
                            onAfterPick={() => { void saveDraft({ silent: true }); }}
                          />
                        )}
                        {recommendationChips.length > 0 && !isLocked && !isFinalized && (
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
                      {!isLocked && !isFinalized && (
                        <FieldCareMic voice={voiceSession} target="recommendation" />
                      )}
                    </div>

                    {/* Critical finding mark + communication checklist (legacy) */}
                    <div className="flex flex-col gap-2 border rounded-md p-3 bg-red-50/40 border-red-100" data-testid="critical-finding-panel">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="critical"
                          checked={isCritical}
                          onCheckedChange={setIsCritical}
                          disabled={isLocked || isFinalized}
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
                            disabled={isLocked || isFinalized}
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
                                  disabled={isLocked || isFinalized}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
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
                          disabled={isLocked || isFinalized}
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
                      onFinalize={finalizeReport}
                      finalizeDisabled={!studyId || isLocked || (!allowEditSigned && (isFinalized || workflow.currentRow?.status === "REPORT_FINAL")) || pcpndtBlocked}
                      finalizeLabel={isFinalized && !allowEditSigned ? "Signed" : allowEditSigned ? "Re-finalize" : "Finalize"}
                      exportingWord={exportingWord}
                      exportingPdf={exportingPdf}
                      printingLikeFinal={printingLikeFinal}
                      disabled={false}
                      imageRefs={imageRefs}
                      dicomWebBase={BROWSER_DICOMWEB_BASE}
                      showLetterpadHeader={showLetterpadHeader}
                      onShowLetterpadHeaderChange={setShowLetterpadHeader}
                      bodyFontSize={bodyFontSize}
                      onBodyFontSizeChange={(v) => {
                        setBodyFontSize(v);
                        try {
                          const cur = loadPrintSettings();
                          savePrintSettings({ ...cur, fontSize: v });
                        } catch { /* ignore */ }
                      }}
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
                    onSave={() => { void saveDraft(); }}
                    onFinalize={finalizeReport}
                    onNextStudy={goNextStudy}
                    finalizeDisabled={!studyId || isLocked || (!allowEditSigned && (isFinalized || workflow.currentRow?.status === "REPORT_FINAL")) || pcpndtBlocked}
                    finalizeLabel={isFinalized && !allowEditSigned ? "Signed" : allowEditSigned ? "Re-finalize" : "Confirm & Sign"}
                    saveDisabled={!isOnline || isLocked || (isFinalized && !allowEditSigned)}
                  />
                </div>
                {draftId ? (
                  <aside
                    className="w-40 shrink-0 border-l border-emerald-200/50 p-2 overflow-y-auto bg-emerald-50/20"
                    data-testid="selected-images-rail"
                  >
                    <ReportImagePanel
                      draftId={draftId}
                      dicomWebBase={BROWSER_DICOMWEB_BASE}
                      disabled={isLocked || isFinalized || workflow.currentRow?.status === "REPORT_FINAL"}
                      layout="stack"
                    />
                  </aside>
                ) : null}
                </div>
              </ResizablePanel>
              <ResizableHandle />
              {/* Copilot rail with ComparisonPanel + FollowUpPanel */}
              <ResizablePanel
                defaultSize={42}
                minSize={18}
                collapsible
                collapsedSize={3}
                ref={rightPanelRef}
                onCollapse={() => setRightCollapsed(true)}
                onExpand={() => setRightCollapsed(false)}
              >
                <div className="h-full border-l border-emerald-200/50 bg-gradient-to-b from-card to-emerald-50/15 overflow-y-auto">
                  {rightCollapsed ? (
                    <button
                      type="button"
                      className="flex h-full w-full flex-col items-center gap-2 py-3 text-emerald-600 hover:bg-emerald-50 transition-colors"
                      onClick={() => rightPanelRef.current?.expand()}
                      title="Expand Orient / Observe / Measure"
                      data-testid="right-panel-expand"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                      <span className="text-[9px] font-semibold tracking-wider uppercase text-emerald-700" style={{ writingMode: "vertical-rl" }}>
                        Orient
                      </span>
                    </button>
                  ) : (
                    <>
                  <CopilotRail
                    spinalStudyId={workflow.currentRow?.studyId ?? studyId ?? null}
                    draftId={draftId ?? null}
                    patientId={workflow.currentRow?.patientId ?? null}
                    worklistId={studyId ?? null}
                    studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                    regionHint={[
                      studySetup.matchedStudyRegion,
                      workflow.currentRow?.studyDescription,
                    ].filter(Boolean).join(" ") || null}
                    measureDisabled={isLocked || isFinalized}
                    onJumpToCanalProvenance={(prov) => {
                      const ok = embeddedViewerRef.current?.goToAnchor({
                        studyInstanceUID: prov.studyInstanceUID,
                        seriesInstanceUID: prov.seriesInstanceUID,
                        sopInstanceUID: prov.sopInstanceUID,
                        frameNumber: prov.frameNumber,
                      });
                      if (ok) return;
                      const win = embeddedViewerRef.current?.getOhifWindow?.();
                      if (prov.studyInstanceUID && win) {
                        const sent = requestOhifNavigateToAnchor({
                          target: win,
                          studyInstanceUID: prov.studyInstanceUID,
                          seriesInstanceUID: prov.seriesInstanceUID,
                          sopInstanceUID: prov.sopInstanceUID,
                          frameNumber: prov.frameNumber,
                          targetOrigin: ohifTargetOriginRef.current,
                        });
                        if (sent) {
                          toast({
                            title: "Navigate requested in OHIF",
                            description: "Requires CARE OHIF extension support for navigate-to-anchor.",
                          });
                          return;
                        }
                      }
                      toast({
                        title: "Source image unavailable",
                        description: "FRAMES could not locate that series/frame in the loaded study.",
                      });
                    }}
                  />
                  {workflow.currentRow && (
                    <div className="border-t border-border p-2">
                      <ComparisonPanel
                        patientId={workflow.currentRow?.patientId ?? undefined}
                        excludeStudyId={studyId ?? undefined}
                        currentModality={workflow.currentRow.modality ?? ""}
                        currentStudyDescription={workflow.currentRow.studyDescription ?? ""}
                        currentFindings={findingsText}
                        onInsertFindings={(text) => appendFindings(text)}
                        onInsertImpression={(text) => {
                          useWorkspace.getState().mergeField("impression", text, "template");
                        }}
                        onSelectPrior={(prior) => {
                          if (prior?.dateIso) {
                            appendFindings(`Compared with prior study dated ${String(prior.dateIso).slice(0, 10)}.`);
                          }
                        }}
                      />
                    </div>
                  )}
                  {workflow.currentRow && (
                    <div className="border-t border-border p-2">
                      <ModuleErrorBoundary>
                        <FollowUpPanel
                          patientId={workflow.currentRow?.patientId ?? null}
                          currentFindings={findingsText}
                          onCopyFindings={(text: string) => useWorkspace.getState().setField("findings", text)}
                          onCopyImpression={(lines: string[]) => useWorkspace.getState().setField("impression", lines.join("\n"))}
                        />
                      </ModuleErrorBoundary>
                    </div>
                  )}

                  {/* Legacy Box — all remaining old tools kept alongside new UI */}
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
                      onAppendImpression={(text) => {
                        useWorkspace.getState().mergeField("impression", text, "template");
                      }}
                      onAppendRecommendation={(text) => {
                        useWorkspace.getState().mergeField("recommendation", text, "template");
                      }}
                      onSetFindings={(text) => useWorkspace.getState().setField("findings", text)}
                      onSetImpression={(text) => useWorkspace.getState().setField("impression", text)}
                      onSetTechnique={(text) => useWorkspace.getState().setField("technique", text)}
                      onApplyReport={(r) => {
                        const state = useWorkspace.getState();
                        if (r.findingsText) state.mergeField("findings", r.findingsText, "template");
                        if (r.impressionLines?.length) {
                          for (const line of r.impressionLines) {
                            useWorkspace.getState().mergeField("impression", line, "template");
                          }
                        }
                        if (r.technique) state.mergeField("technique", r.technique, "template");
                      }}
                      onViewerLaunchResult={(result) => {
                        if (!result.success && result.errorCode === "POPUP_BLOCKED" && layoutMode === "dualScreen") {
                          setLayoutMode(fallbackModeWhenPopupBlocked("dualScreen"));
                          toast({
                            title: "Popup blocked — showing Split View",
                            description: "Allow popups for this site to use Dual Screen, then open the study again.",
                            variant: "destructive",
                          });
                        }
                      }}
                      printLayout={reportLayout}
                      onPrintLayoutChange={setPreviewLayoutOverride}
                      clinicActiveLayout={presentationTemplates?.active?.standard}
                    />
                  </ModuleErrorBoundary>
                    </>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* ─── Footer: shortcuts + status ─── */}
      <footer className="flex items-center justify-between border-t border-emerald-200/60 px-3 py-1.5 bg-gradient-to-r from-emerald-50/60 via-card to-emerald-50/60 text-[10px] text-muted-foreground shadow-[0_-1px_3px_rgba(16,185,129,0.08)]">
        <div className="flex items-center gap-3">
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">⌘K</kbd> palette</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">⌃↵</kbd> finalize</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">⌃S</kbd> save</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">⌃⇧N</kbd> next</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">⌃⇧P</kbd> previous</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">⌃⇧K</kbd> park</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">:macro</kbd>+<kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">Tab</kbd></span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">?</kbd> shortcuts</span>
          <span><kbd className="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 px-1 py-0.5 font-mono shadow-sm">Alt+]</kbd> Legacy Box</span>
        </div>
        {study?.lockedBy && <div className="flex items-center gap-1.5 text-amber-600"><Lock className="h-3 w-3" />Locked by you</div>}
        <div className="flex items-center gap-2">
          {study?.criticalFlag && <Badge variant="outline" className="text-[9px] bg-rose-50 text-rose-700 border-rose-200"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Critical</Badge>}
          {preloadTriggered && <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200"><Zap className="h-2.5 w-2.5 mr-0.5" />Preloaded</Badge>}
          {readingSession.enabled && <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200"><ChevronRight className="h-2.5 w-2.5 mr-0.5" />Auto-advance</Badge>}
          <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Zero-Click Read Loop</span>
        </div>
      </footer>

      {/* ─── Floating UI overlays ─── */}
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
      {/* Overnight / shadow AI drafts — self-gates on pilot visibility */}
      <AiDraftPanel
        studyInstanceUid={workflow.currentRow?.studyInstanceUID ?? study?.studyInstanceUID ?? null}
        modality={workflow.currentRow?.modality ?? study?.modality ?? null}
        onInsertText={appendFindings}
        preferOpen={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ai") === "1"}
      />
      {/* Background text Report Composer — assistant artifact until Apply */}
      <div
        className={`fixed bottom-4 left-4 z-40 shadow-lg pointer-events-auto ${
          aiAssistantMinimized
            ? "w-auto max-w-[calc(100vw-2rem)]"
            : "w-[min(520px,calc(100vw-2rem))]"
        }`}
      >
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
              sel || findingsText.slice(0, 800),
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
      <ZaiCommandPalette />
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
            {!allowEditSigned && (
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
    </div>
  );
}
