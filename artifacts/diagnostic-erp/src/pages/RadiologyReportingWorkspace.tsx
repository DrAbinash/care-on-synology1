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

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
import { useRadiologyDraftId } from "@/hooks/useRadiologyDraftId";
import { useRadiologyPalettePrefs } from "@/hooks/useRadiologyPalettePrefs";
import { useFindingsMacroRecents } from "@/hooks/useFindingsMacroRecents";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

// ─── Existing Care lib/services ────────────────────────────────────────────────
import { api } from "@/lib/fetchApi";
import { readStaffSession, normalizeRole, isOwnerRole, isFeatureEnabled } from "@/lib/staffSession";
import { saveRadiologyDraft, finalizeRadiologyReport } from "@/lib/radiologyReportLifecycle";
import { exportRadiologyReportToWord, safeFileNamePart } from "@/lib/radiologyReportWordExport";
import { exportRadiologyReportToPdf } from "@/lib/radiologyReportPdfExport";
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
  formatDoctorWithDegree,
  type ReportDemography,
} from "@/lib/reportDemography";
import type { PrintClinic } from "@/lib/reportPdfGenerator";
import {
  REPORT_LAYOUT_OPTIONS,
  type ReportLayoutKey,
  quickSelectLayoutKey,
  reportLayoutTemplateQuery,
} from "@/components/radiology/ReportLayoutQuickSelect";
import ReportExportPanel from "@/components/radiology/ReportExportPanel";
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
import ComparisonPanel from "@/components/radiology/ComparisonPanel";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import FinalizeSignDialog from "@/components/radiology/FinalizeSignDialog";
import VoiceCommandBar from "@/components/radiology/VoiceCommandBar";
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
import LegacyBox, { type LegacyBoxTab } from "@/components/radiology/LegacyBox";
import { AiDraftPanel } from "@/components/ai/AiDraftPanel";
import { WhatsAppReportShareDialog } from "@/components/radiology/WhatsAppReportShareDialog";
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import MriReadinessStrip from "@/components/radiology/MriReadinessStrip";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
import ReportingShortcutHelp from "@/components/radiology/ReportingShortcutHelp";
import StructuredFindingDialog from "@/components/radiology/StructuredFindingDialog";
import { FindingsHighlightEditor } from "@/components/FindingsHighlightEditor";
import ReportDemographyCard from "@/components/radiology/ReportDemographyCard";
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import ClinicalHistoryChipStrip from "@/components/radiology/ClinicalHistoryChipStrip";
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
import { removeBlock, removeImpression } from "@/lib/quickFindingsMerge";
import { inferOwnership, type PathologyIncoming } from "@/lib/pathologyPatch";
import {
  provenanceMapToSegments,
  provenanceVisualKind,
  type InsertSource,
} from "@/lib/reportFieldMerge";
import { generateLocalImpression } from "@/lib/generateLocalImpression";
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
import { useWorkspace, formatSignOff, lookupProfile, type WorkspaceStore } from "@/lib/zai-workspace/store";
import { getFindingsCompletionPct, runLintRules, shouldPreloadNext } from "@/lib/zai-workspace/types";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import { WorklistStrip, type ReadingQueueDatePreset } from "@/components/radiology/zai-workspace/worklist-strip";
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
import { FinalizeDialog } from "@/components/radiology/zai-workspace/finalize-dialog";
import { InterruptChannelCard } from "@/components/radiology/zai-workspace/interrupt-card";
import { QuickSelectEditor } from "@/components/radiology/zai-workspace/quick-select-editor";
import { MergePreviewDialog } from "@/components/radiology/zai-workspace/merge-preview-dialog";
import { ConfirmOverwriteDialog } from "@/components/radiology/zai-workspace/confirm-overwrite-dialog";
import { SaveAsFormatDialog } from "@/components/radiology/zai-workspace/save-as-format-dialog";
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
  CheckCircle2,
  Maximize2, Columns2, Monitor, Archive, Keyboard, AppWindow, MessageCircle, Hospital,
  Trash2, MonitorPlay, Plus,
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
  const [previewLayoutOverride, setPreviewLayoutOverride] = useState<ReportLayoutKey | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
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
  const [activeReportSection, setActiveReportSection] = useState<ReportSectionId | null>("findings");
  const [activeFindingsTool, setActiveFindingsTool] = useState<FindingsToolId | null>(null);
  const activateReportSection = useCallback((id: ReportSectionId) => {
    setActiveReportSection((cur) => nextActiveSection(cur, id));
  }, []);
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
      if (stored === "today" || stored === "all" || stored === "today-yesterday") return stored;
    } catch { /* ignore */ }
    return "today-yesterday";
  });
  const queueDateRange = useMemo(() => {
    if (datePreset === "today") return { from: todayISO(), to: todayISO() };
    if (datePreset === "today-yesterday") return { from: daysAgoISO(1), to: todayISO() };
    return { from: "", to: "" };
  }, [datePreset]);

  // ─── Session ──────────────────────────────────────────────────────────────
  const session = useMemo(() => readStaffSession(), []);
  const myUserId = session?.user?.id ? Number(session.user.id) : null;
  const myName = session?.user?.name ?? null;
  const role = normalizeRole(session?.user?.role ?? "");
  const isOwner = isOwnerRole(session);

  // ─── Z.ai workspace store (new features) ──────────────────────────────────
  const ws = useWorkspace;
  const studies = useWorkspace((s: WorkspaceStore) => s.studies);
  const activeStudyId = useWorkspace((s: WorkspaceStore) => s.activeStudyId);
  const selectStudy = useWorkspace((s: WorkspaceStore) => s.selectStudy);
  const setStudies = useWorkspace((s: WorkspaceStore) => s.setStudies);
  const findingsText = useWorkspace((s: WorkspaceStore) => s.findingsText);
  const impressionText = useWorkspace((s: WorkspaceStore) => s.impressionText);
  const recommendationText = useWorkspace((s: WorkspaceStore) => s.recommendationText);
  const techniqueText = useWorkspace((s: WorkspaceStore) => s.techniqueText);
  const clinicalHistoryText = useWorkspace((s: WorkspaceStore) => s.clinicalHistoryText);
  // Read-only: drives the collapsed Findings summary's "N assisted" count.
  const findingsProvenance = useWorkspace((s: WorkspaceStore) => s.fieldProvenance.findings);
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
  });

  // 2. Study lock (claim/heartbeat/release)
  const studyLock = useStudyLock(studyId, {
    enabled: Boolean(workflow.currentRow && workflow.currentRow.status !== "REPORT_FINAL" && workflow.currentRow.status !== "DELIVERED") as any,
  });
  const isLocked = studyLock.status === "locked-by-other";
  const lockLost = studyLock.status === "expired-lost" || studyLock.status === "connection-lost";

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
    enabled: workflow.currentRow?.status !== "REPORT_FINAL",
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
      const text = normalizeDictationText(intent.text, { autoPunctuation: voiceSettings.autoPunctuation });
      if (!text) return { ok: false, message: "Nothing to insert" };
      const state = useWorkspace.getState();
      const mode = intent.mode;
      const voiceSource = "manual" as const;
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
  }, [voiceSettings.autoPunctuation, focusReportField]);

  const voiceSession = useVoiceSession({
    studyId: studyId ?? undefined,
    settings: voiceSettings,
    capabilities: voiceCapabilities,
    getContext: () => ({
      studyId: studyId ?? null,
      dirty: useWorkspace.getState().isDirty,
      isLocked: studyLock.status === "locked-by-other",
      lockedByOther: studyLock.status === "locked-by-other",
      lockLost: studyLock.status === "expired-lost" || studyLock.status === "connection-lost",
      canVerify: canVerifyRef.current,
      structuredFindings: false,
      viewerAvailable: embeddedViewerRef.current != null,
      confirmationPolicy: voiceSettings.confirmationPolicy,
    }),
    execute: executeVoiceCommand,
    cleanupDictation: async (raw) => {
      try {
        const res = await api.post<{ cleaned?: string; text?: string }>(
          "/api/radiology/report-generator/voice-cleanup",
          { rawTranscript: raw, draftId, studyId, patientId: workflow.currentRow?.patientId },
        );
        return (res.cleaned ?? res.text ?? raw).trim() || raw;
      } catch {
        return raw;
      }
    },
    onAudit: (commandType, outcome) => {
      api.post("/api/radiology/voice-command-audit", { commandType, studyId, outcome }).catch(() => {});
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
  const [protocolTitleOpen, setProtocolTitleOpen] = useState(false);
  const [protocolTitle, setProtocolTitle] = useState("");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [patientJumpFilter, setPatientJumpFilter] = useState("");

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

  // Reset structured state when switching studies
  useEffect(() => {
    setFindingsMap({});
    setUseStructured(false);
    startReportUndoRef.current = null;
    setCanUndoStartReport(false);
    setStructuredValues({});
    structuredTouchedRef.current = false;
    structuredFormatDrivingRef.current = false;
    lastStructuredFindingsLinesRef.current = {};
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
    onToast: (opts) => toast({ title: opts.title, description: opts.description, variant: opts.variant }),
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
  }, [studySetup.selectedTemplate]);

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
      .filter((c) => c.isActive && studySetup.studyRegions.includes(c.studyType))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayLabel.localeCompare(b.displayLabel)),
    [studySetup.quickSelectData, studySetup.studyRegions],
  );

  const addProtocolTitle = useCallback(async () => {
    const name = protocolTitle.trim();
    if (!name) return;
    useWorkspace.getState().mergeField("technique", `${name}.`, "protocol");
    const studyType = studySetup.studyRegions[0] || studySetup.matchedStudyRegion || "MRI";
    if (isOwner) {
      try {
        const row = await api.post<{ id: number; name: string }>("/api/radiology/quick-select/protocols", {
          name,
          studyType,
          modality: workflow.currentRow?.modality ?? "",
          techniqueText: `${name}.`,
        });
        void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
        const created = studySetup.availableProtocols.find((p) => p.id === row?.id)
          ?? (row ? { ...row, studyType, modality: workflow.currentRow?.modality ?? "", checklistJson: "[]", techniqueText: `${name}.`, normalText: "", recommendationText: "", requiredMeasurements: "", isGoldStandard: false, isDefault: false, sortOrder: 0, isActive: true } : null);
        if (created && "techniqueText" in created) studySetup.requestProtocolChange(created as typeof studySetup.availableProtocols[number]);
      } catch {
        toast({ title: "Title added to Technique", description: "Shared protocol save needs admin permission." });
      }
    }
    setProtocolTitle("");
    setProtocolTitleOpen(false);
  }, [protocolTitle, isOwner, studySetup, workflow.currentRow?.modality, qc, toast]);

  const recommendationChips = useMemo<string[]>(() => {
    const raw = pacsSettingsRows?.find((r) => r.key === "report_recommendation_chips")?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const chips = parsed.map((x) => String(x).trim()).filter(Boolean);
          if (chips.length > 0) return chips;
        }
      } catch { /* fall back */ }
    }
    return DEFAULT_RECOMMENDATION_CHIPS;
  }, [pacsSettingsRows]);

  const reportNeedsStart = useMemo(() => {
    const region = studySetup.matchedStudyRegion ?? studySetup.studyRegions[0];
    if (!region) return false;
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
    studySetup.activeProtocol, studySetup.availableProtocols.length,
  ]);

  const handleStartReport = useCallback(() => {
    if (studyLock.status === "locked-by-other" || isFinalized) return;
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
    studyLock.status, isFinalized, studySetupSetters, findingsMap, useStructured, studySetup,
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
    if (studyLock.status === "locked-by-other" || isFinalized) return;
    const lines = generateLocalImpression(
      useStructured ? findingsMapToText(findingsMap) : findingsText,
      useStructured ? findingsMap : undefined,
    );
    if (lines.length === 0) {
      toast({ title: "No findings to summarize", description: "Add findings first.", variant: "destructive" });
      return;
    }
    if (impressionText.trim() && !window.confirm("Replace current impression with generated summary?")) return;
    useWorkspace.getState().setField("impression", lines.join("\n"));
    toast({ title: "Impression generated", description: `${lines.length} point${lines.length > 1 ? "s" : ""} from findings` });
  }, [studyLock.status, isFinalized, useStructured, findingsMap, findingsText, impressionText, toast]);

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

  /** Clinic Quick Select — pathology patches over the whole report (ownership + laterality). */
  const handleQuickToggle = useCallback((finding: QuickFinding, nowSelected: boolean) => {
    const state = useWorkspace.getState();
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
        ...((!finding.anatomicalSection && !finding.conflictGroup)
          ? inferOwnership(finding.label, [finding.findingText, finding.impressionText])
          : {}),
      };
      state.applyPathologyOverlay({
        incoming: templates,
        templates,
        ownership,
        source: "quick-findings",
        side: quickSide,
        id: `qf-${finding.id}`,
      });
      const applied = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === `qf-${finding.id}`);
      lastQuickRenderedRef.current.set(finding.id, applied?.lastRendered ?? templates);
      setSelectedQuickIds((prev) => {
        const next = new Set(prev);
        next.add(finding.id);
        return next;
      });
    } else {
      const last = lastQuickRenderedRef.current.get(finding.id);
      const findings = last?.findings || finding.findingText;
      const impression = last?.impression || finding.impressionText;
      const technique = last?.technique || finding.techniqueText;
      const recommendation = last?.recommendation || finding.recommendationText;
      if (findings) state.setField("findings", removeBlock(state.findingsText, findings));
      if (impression) {
        const lines = state.impressionText.split("\n").filter(Boolean);
        state.setField("impression", removeImpression(lines, impression).join("\n"));
      }
      if (technique) state.setField("technique", removeBlock(state.techniqueText, technique));
      if (recommendation) state.setField("recommendation", removeBlock(state.recommendationText, recommendation));
      lastQuickRenderedRef.current.delete(finding.id);
      setSelectedQuickIds((prev) => {
        const next = new Set(prev);
        next.delete(finding.id);
        return next;
      });
    }
  }, [quickSide]);
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
  useEffect(() => {
    // Always sync (including empty) so the strip clears when the queue is empty.
    // setStudies is idempotent for equal content — safe against unstable [].
    setStudies(workflow.queue ?? []);
  }, [workflow.queue, setStudies]);

  // Server-backed whole-report formats + chocolate macros (migrate localStorage once).
  useEffect(() => {
    void useWorkspace.getState().hydrateContentLibraries();
  }, []);

  // ─── Auto-select first study ────────────────────────────────────────────────
  useEffect(() => {
    if (studies.length === 0 || activeStudyId) return;
    if (studyId) {
      const match = studies.find((s: Study) => s.id === String(studyId));
      if (match) { selectStudy(match.id); return; }
    }
    const pr: Record<string, number> = { stat: 0, urgent: 1, routine: 2, vip: 1 };
    const sorted = [...studies].sort(
      (a: Study, b: Study) => ((pr[a.priority] ?? 2) - (pr[b.priority] ?? 2)) || (a.tatMinutes - b.tatMinutes),
    );
    if (sorted[0]) openStudy(sorted[0].id);
  }, [studies, activeStudyId, studyId, selectStudy, openStudy]);

  // ─── Hydrate editor when study changes ──────────────────────────────────────
  useEffect(() => {
    if (!studyId) return;
    if (isLoadingExistingDraft) return;
    if (hydratedDraftForStudyRef.current === studyId) return;

    if (existingDraft) {
      hydratedDraftForStudyRef.current = studyId;
      setDraftHydratedStudyId(studyId);
      const draft = existingDraft as any;
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
      return;
    }

    // No server draft — mark hydrated so protocol/template auto-select can run,
    // then optionally fill from AI draft (fill-empty only after auto setup).
    hydratedDraftForStudyRef.current = studyId;
    setDraftHydratedStudyId(studyId);
    const row = workflow.currentRow;
    if (row) {
      api.post<{ findings: string; impression: string; recommendation: string; technique?: string }>("/api/ai-reporting/draft", {
        studyInstanceUID: row.studyInstanceUID,
        modality: row.modality,
      }).then((draft: any) => {
        if (!draft || typeof draft !== "object") return;
        const state = useWorkspace.getState();
        const normStr = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
        // Fill-empty only so auto protocol/template win when AI is empty.
        if (!state.findingsText.trim() && normStr(draft.findings)) state.setFieldIfEmpty("findings", normStr(draft.findings), "ai-draft");
        if (!state.impressionText.trim() && draft.impression) state.setFieldIfEmpty("impression", normalizeImpressionLines(draft.impression).join("\n"), "ai-draft");
        if (!state.recommendationText.trim() && normStr(draft.recommendation)) state.setFieldIfEmpty("recommendation", normStr(draft.recommendation), "ai-draft");
        if (!state.techniqueText.trim() && normStr(draft.technique)) state.setFieldIfEmpty("technique", normStr(draft.technique), "ai-draft");
        if (!state.clinicalHistoryText.trim()) state.setField("clinicalHistory", (row as any).clinicalHistory ?? "");
      }).catch(() => {
        const state = useWorkspace.getState();
        if (!state.clinicalHistoryText.trim()) {
          state.setField("clinicalHistory", (row as any).clinicalHistory ?? "");
        }
      });
    }
  }, [studyId, existingDraft, isLoadingExistingDraft, workflow.currentRow]);

  // Reset hydrate marker when studyId changes (before the hydrate effect).
  useEffect(() => {
    hydratedDraftForStudyRef.current = null;
    setDraftHydratedStudyId(null);
  }, [studyId]);

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
    const offlineMsg = offlineBlockMessage(isOnline, "save");
    if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return null; }
    try {
      const res = await retryWithBackoff(
        () => saveRadiologyDraft<{ success?: boolean; draft?: { id: number }; id?: number }>({
          id: draftId ?? undefined,
          studyId,
          worklistId: studyId,
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
        } as any),
        { shouldRetry: isTransientError },
      );
      const id = res?.draft?.id ?? res?.id ?? null;
      if (id) captureSavedDraftId(id);
      setLastSavedAt(new Date());
      if (!opts?.silent) toast({ title: "Draft saved", duration: 1500 });
      return id;
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
      return null;
    }
  }, [studyId, draftId, clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText, isOnline, captureSavedDraftId, toast, useStructured, findingsMap, structuredValues, studySetup.selectedTemplate]);
  saveDraftRef.current = saveDraft;

  // ─── Finalize (sign + archive + notify) ─────────────────────────────────────
  const finalizeReport = useCallback(async () => {
    if (!studyId || !workflow.currentRow) return;
    const offlineMsg = offlineBlockMessage(isOnline, "finalize");
    if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return; }

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

    // 6. Prompt via finalize flow (quality gate + critical ack + signer)
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
    });

    if (!result.confirmed) return;

    // 7. Execute finalize
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
            return `<h2>${esc(workflow.currentRow?.studyDescription ?? "Report")}</h2><p><b>Findings:</b> ${esc(findingsText).replace(/\n/g,"<br/>")}</p><p><b>Impression:</b> ${esc(impressionText).replace(/\n/g,"<br/>")}</p><p><b>Recommendation:</b> ${esc(recommendationText).replace(/\n/g,"<br/>")}</p>`;
          })(),
          impression: [impressionText],
          isCritical: criticalMarked,
          criticalNote: criticalNote || (criticalHits.length > 0 ? criticalHits.map(h => h.label).join(", ") : null),
          createdBy: session?.user?.name ?? "Dr. Sugandha Priyadarshini",
          actor: session?.user?.name ?? "Dr. Sugandha Priyadarshini",
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
    } catch (err) {
      toast({ title: "Finalize failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }, [studyId, workflow, isOnline, findingsText, impressionText, recommendationText, techniqueText, clinicalHistoryText, studySetup.checklistPercent, saveDraft, finalizeFlow, draftBackup, qc, toast, isCritical, criticalNote, checklistComm, draftId, session]);

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
    "select-template-1": () => { openLegacyTabRef.current("templates"); },
    "select-template-2": () => { openLegacyTabRef.current("templates"); },
    "select-template-3": () => { openLegacyTabRef.current("templates"); },
    "select-template-4": () => { openLegacyTabRef.current("templates"); },
    "select-template-5": () => { openLegacyTabRef.current("templates"); },
    "select-template-6": () => { openLegacyTabRef.current("templates"); },
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
      if (cmd) { e.preventDefault(); commandDispatcher.dispatch(cmd); return; }

      // New features shortcuts
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); useWorkspace.getState().toggleCommandPalette(); return; }
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); finalizeReport(); return; }
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
    voiceSession, voiceSettings.pttKey, focusVoiceBar,
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

  const studyNameForExport = studySetup.testName
    ?? workflow.currentRow?.studyDescription
    ?? "Radiology Report";

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
      referringDoctorCatalog: (doctorsCatalogQ.data ?? []).map((d) => formatDoctorWithDegree(d.name, d.degree)),
    });
    return merged;
  }, [workflow.currentRow, patientMasterQ.data, demographyOverrides, doctorsCatalogQ.data]);

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
      }),
    [
      canonicalDemography, studyNameForExport, techniqueText, clinicalHistoryText,
      findingsText, impressionText, recommendationText, imageRefs,
      headingCase, sectionSpacing, impressionStyle, signerLine, reportLayout,
      useStructured, findingsMap,
    ],
  );

  const handleExportWord = useCallback(async () => {
    setExportingWord(true);
    try {
      let html = previewHtml;
      // Prefer server-rendered letter-pad layout when a draft/report exists.
      if ((reportLayout === "care-premium" || reportLayout === "care-classic") && (draftId || linkedReportIdRef.current)) {
        try {
          const templateQs = `template=${encodeURIComponent(reportLayout)}`;
          const reportId = linkedReportIdRef.current;
          const url = reportId
            ? `/api/patient-reports/${reportId}/print?preview=true&${templateQs}`
            : `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}`;
          const serverHtml = await api.get<string>(url);
          if (typeof serverHtml === "string" && serverHtml.trim()) html = serverHtml;
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
  }, [workflow.currentRow, previewHtml, toast, reportLayout, draftId, canonicalDemography, presentationTemplates]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
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
        clinic: clinicSettings ?? null,
        letterhead: activeStandardLetterhead(presentationTemplates),
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
    imageRefs, clinicSettings, toast, workflow.currentRow,
    useStructured, findingsMap, presentationTemplates,
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
      const url = `/api/radiology/report-generator/drafts/${id}/print-preview?autoPrint=true&likeFinal=true&${templateQs}`;
      const html = await api.get<string>(url);
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch {
      w.close();
      toast({ title: "Print preview failed", variant: "destructive" });
    } finally {
      setPrintingLikeFinal(false);
    }
  }, [draftId, reportLayout, saveDraft, toast]);

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
    } catch (err) { toast({ title: "Failed", variant: "destructive" }); }
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
    if (!window.confirm(
      `Verify (countersign) this report as ${session?.user?.name ?? "current user"}?\n\n` +
      `This records you as the verifying radiologist.`,
    )) return;
    setVerifyBusy(true);
    try {
      await api.post(`/api/patient-reports/${targetId}/verify`, {
        verifiedByName: session?.user?.name ?? undefined,
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
  }, [finalReport, verifyBusy, linkedReportId, session, toast, qc]);

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
  const referringDoctorName = (workflow.currentRow as { referringDoctor?: string } | null)?.referringDoctor ?? null;
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
  const findingsLintCount = useMemo(
    () => (findingsText ? runLintRules(findingsText, { modality: study?.modality ?? "XR", sex: study?.patient?.sex }).length : 0),
    [findingsText, study?.modality, study?.patient?.sex],
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
  const accordionProps = (id: ReportSectionId) => {
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
    };
  };

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
            <span className="text-xs font-semibold truncate">{studySetup.testName ?? study.studyDescription}</span>
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
          {voiceSession.enabled && <VoiceCommandBar voice={voiceSession} embedded />}
          {/* Save button */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void saveDraft()} disabled={!isOnline}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          {/* WhatsApp share */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-emerald-700"
            onClick={handleShare}
            title="Send report PDF link on WhatsApp"
            data-testid="btn-workspace-whatsapp-share"
          >
            <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleShare} title="Share report">
            <Share2 className="h-3.5 w-3.5 mr-1" /> Share
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
          {/* Finalize */}
          <Button size="sm" className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={finalizeReport} disabled={!studyId || isFinalized || isLocked || pcpndtBlocked}
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
                      accessionNumber={workflow.currentRow?.accessionNumber ?? null}
                      patientName={canonicalDemography.patientName || workflow.currentRow?.patientName || study?.patient?.name || null}
                      columnExpanded={viewerColumnExpanded}
                      onColumnExpandedChange={setViewerColumnExpanded}
                    />
                  </div>
                  {!viewerColumnExpanded && workflow.currentRow && (
                    <div className={reportImagesOpen ? "flex-1 min-h-0 overflow-hidden" : "border-t border-border shrink-0"}>
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

                  {/* ── Progressive accordion: one active major section at a time.
                       Collapsed sections keep their children MOUNTED (hidden), so
                       editors, drawers and panels never lose state. ── */}
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
                    data-testid="report-section-accordion"
                    onMouseDown={enterReportingFocusMode}
                  >
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

                    {/* 2. REFERRING DOCTOR — current doctor, edit, quick chips, add */}
                    <ReportAccordionSection {...accordionProps("refDoctor")}>
                      {workflow.currentRow ? (
                        <div className="space-y-1" data-testid="ref-dr-block">
                          <ReferringDoctorQuickSelect
                            worklistId={studyId ?? 0}
                            currentName={(workflow.currentRow as any)?.referringDoctor}
                          />
                        </div>
                      ) : (
                        <p className="py-2 text-xs text-muted-foreground">No study selected.</p>
                      )}
                    </ReportAccordionSection>

                    {/* 3. REGION / STUDY / PROTOCOL — the ONE anatomical context
                         selector. Everything downstream (macros, Quick Select,
                         Quick Add, structured template, suggestions) reads the
                         region chosen here. */}
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

                    {/* Study setup strip — regions / protocol / test name from DICOM */}
                    {(studySetup.activeProtocol || studySetup.selectedTemplate || studySetup.studyRegions.length > 0) && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200/60 bg-gradient-to-r from-emerald-50/40 via-card to-emerald-50/20 px-2 py-1.5 text-[10px] shadow-sm" data-testid="study-setup-strip">
                        {studySetup.availableRegions.length > 0 && (
                          <label className="inline-flex items-center gap-1 flex-wrap">
                            <span className="font-semibold text-muted-foreground">Regions</span>
                            <div className="inline-flex flex-wrap gap-0.5" role="group" aria-label="Study regions (multi-select)" data-testid="study-region-chips">
                              {(() => {
                                const REGION_CHIP_LIMIT = 6;
                                const primary = studySetup.availableRegions.slice(0, REGION_CHIP_LIMIT);
                                const overflow = studySetup.availableRegions.slice(REGION_CHIP_LIMIT);
                                const extraSelected = studySetup.studyRegions.filter((r) => !primary.includes(r));
                                const visible = [...primary, ...extraSelected];
                                return (
                                  <>
                                    {visible.map((r) => {
                                      const on = studySetup.studyRegions.includes(r);
                                      const isPrimary = on && studySetup.matchedStudyRegion === r;
                                      const title = !on
                                        ? `Add ${r} as primary (macros follow this)`
                                        : isPrimary && studySetup.studyRegions.length > 1
                                          ? `Remove ${r}`
                                          : isPrimary
                                            ? `Primary region — macros follow ${r}`
                                            : `Make ${r} primary (macros follow this)`;
                                      return (
                                        <button
                                          key={r}
                                          type="button"
                                          disabled={isLocked || isFinalized}
                                          aria-pressed={on}
                                          aria-current={isPrimary ? "true" : undefined}
                                          data-primary={isPrimary ? "true" : undefined}
                                          title={title}
                                          className={`h-6 px-1.5 text-[10px] rounded border font-medium transition-colors ${
                                            isPrimary
                                              ? "bg-primary text-primary-foreground border-primary ring-2 ring-offset-1 ring-emerald-400"
                                              : on
                                                ? "bg-primary/75 text-primary-foreground border-primary"
                                                : "bg-background text-muted-foreground border-border hover:bg-muted"
                                          }`}
                                          onClick={() => studySetup.handleRegionToggle(r)}
                                        >
                                          {r}
                                        </button>
                                      );
                                    })}
                                    {overflow.length > 0 && (
                                      <select
                                        aria-label="More study regions"
                                        title="Add another region — its technique merges into Technique"
                                        className="h-6 max-w-[9rem] text-[10px] rounded border bg-background px-1"
                                        value=""
                                        disabled={isLocked || isFinalized}
                                        onChange={(e) => {
                                          const name = e.target.value;
                                          if (name) studySetup.handleRegionToggle(name);
                                          e.currentTarget.value = "";
                                        }}
                                      >
                                        <option value="">More regions…</option>
                                        {overflow.map((r) => (
                                          <option key={r} value={r}>
                                            {studySetup.studyRegions.includes(r) ? "✓ " : "+ "}{r}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                            {studySetup.regionOverrides != null && (
                              <button
                                type="button"
                                className="text-amber-600 underline text-[10px]"
                                title={`Auto-detected: ${studySetup.autoStudyRegion ?? "none"}`}
                                onClick={() => studySetup.resetRegionOverrides()}
                              >
                                reset
                              </button>
                            )}
                          </label>
                        )}
                        {studySetup.availableProtocols.length > 0 && (
                          <select
                            className="h-6 max-w-[12rem] rounded border bg-background px-1 text-[10px]"
                            value={studySetup.activeProtocol?.id ?? ""}
                            disabled={isLocked || isFinalized}
                            onChange={(e) => {
                              const id = Number(e.target.value);
                              const p = studySetup.availableProtocols.find((x) => x.id === id) ?? null;
                              studySetup.requestProtocolChange(p);
                            }}
                            data-testid="protocol-select"
                            aria-label="Protocol"
                          >
                            <option value="">Protocol…</option>
                            {studySetup.availableProtocols.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " ★" : ""}</option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          data-testid="protocol-add-title"
                          className="inline-flex items-center gap-0.5 h-6 px-1.5 text-[10px] rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary"
                          disabled={isLocked || isFinalized}
                          onClick={() => setProtocolTitleOpen((v) => !v)}
                          title="Add a protocol title (like History chips)"
                        >
                          <Plus size={10} /> Add Title
                        </button>
                        {protocolTitleOpen && (
                          <input
                            className="h-6 w-36 rounded border px-1.5 text-[10px] bg-background"
                            placeholder="Protocol title"
                            value={protocolTitle}
                            onChange={(e) => setProtocolTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void addProtocolTitle();
                              if (e.key === "Escape") setProtocolTitleOpen(false);
                            }}
                            autoFocus
                            data-testid="protocol-title-input"
                          />
                        )}
                        {studySetup.testName && (
                          <span className="text-foreground" title="Test / template name from DICOM match">
                            Test: <strong>{studySetup.testName}</strong>
                            {studySetup.templateMismatch ? " ⚠ region mismatch" : ""}
                          </span>
                        )}
                        {(studySetup.templateMismatch || !studySetup.activeProtocol) && studySetup.studyRegions[0] && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600">
                            <AlertTriangle size={11} />
                            {studySetup.templateMismatch ? "template mismatch" : "protocol not applied"}
                          </span>
                        )}
                        {studySetup.activeProtocol && (
                          <span className="text-muted-foreground">
                            Checklist {studySetup.checklistPercent}%
                          </span>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] ml-auto"
                          disabled={isLocked || isFinalized || studySetup.studyRegions.length === 0}
                          onClick={() => studySetup.reapplyDefaults()}
                          data-testid="reapply-defaults"
                        >
                          Re-apply defaults
                        </Button>
                      </div>
                    )}

                    </div>
                    </ReportAccordionSection>

                    {/* 4. HISTORY — History Quick Select + editor + dictation together */}
                    <ReportAccordionSection {...accordionProps("history")}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1.5">
                        <ClinicalHistoryChipStrip
                          chips={clinicalHistoryChips}
                          studyRegions={studySetup.studyRegions}
                          defaultStudyType={studySetup.studyRegions[0] || studySetup.matchedStudyRegion || "MRI Brain"}
                          clinicalHistoryText={clinicalHistoryText}
                          onClinicalHistoryChange={(next) => useWorkspace.getState().setField("clinicalHistory", next)}
                          isOwner={isOwner}
                          disabled={isLocked || isFinalized}
                        />
                        <FindingsEditor field="clinicalHistory" label="Clinical History" minHeight="56px" placeholder="Presenting complaint and relevant history." />
                      </div>
                      {!isLocked && !isFinalized && (
                        <FieldCareMic voice={voiceSession} target="clinicalHistory" />
                      )}
                    </div>
                    </ReportAccordionSection>

                    {/* 5. TECHNIQUE — Quick Select + editor + dictation + protocol context */}
                    <ReportAccordionSection {...accordionProps("technique")}>
                    {(studySetup.activeProtocol || studySetup.studyRegions.length > 0) && (
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground" data-testid="technique-protocol-context">
                        {studySetup.studyRegions.length > 0 && (
                          <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-900">
                            {studySetup.studyRegions.join(" + ")}
                          </span>
                        )}
                        {studySetup.activeProtocol && (
                          <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-900">
                            {studySetup.activeProtocol.name}
                          </span>
                        )}
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => setActiveReportSection("region")}
                          title="Change region or protocol (Alt+3)"
                        >
                          change
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2" data-testid="canonical-technique-editor">
                      <div className="flex-1">
                        <FindingsEditor field="technique" label="Technique" minHeight="60px" placeholder="Modality, sequences, contrast..." />
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
                      <FindingsEditor field="findings" label="" minHeight="220px" placeholder="Type findings. Use :macro + Tab for snippets. Ctrl+Enter for AI ghost." showGhost hideQuickSelect />
                    )}

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
                        <QuickSelectStrip field="findings" bodyPart={studySetup.matchedStudyRegion} />
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
                            onFindingsLoaded={(findings) => { quickFindingTemplatesRef.current = findings; }}
                            externalSearch={qsExternalSearch}
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
                              Region / Study / Protocol
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
                                  clinicalHistoryChips.length > 0
                                    ? () => {
                                        if (isLocked || isFinalized) return;
                                        const state = useWorkspace.getState();
                                        state.setField(
                                          "clinicalHistory",
                                          clinicalHistoryChips.reduce(
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
                    <ReportAccordionSection {...accordionProps("impression")}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Impression</span>
                          {!isLocked && !isFinalized && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={handleGenerateLocalImpression}
                              data-testid="generate-local-impression"
                              title="Generate impression from findings (local, no AI)"
                            >
                              <Sparkles size={11} className="mr-1" /> Generate Impression
                            </Button>
                          )}
                        </div>
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
                      finalizeDisabled={!studyId || isFinalized || isLocked || pcpndtBlocked}
                      finalizeLabel={isFinalized ? "Signed" : "Finalize"}
                      exportingWord={exportingWord}
                      exportingPdf={exportingPdf}
                      printingLikeFinal={printingLikeFinal}
                      disabled={false}
                    />
                    </ReportAccordionSection>
                  </div>
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
                  <CopilotRail />
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
          {(readingSession as any)?.autoAdvance && <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200"><ChevronRight className="h-2.5 w-2.5 mr-0.5" />Auto-advance</Badge>}
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
      />
      <ZaiCommandPalette />
      <FinalizeSignDialog
        open={finalizeFlow.open}
        input={finalizeFlow.input}
        onResolve={finalizeFlow.resolve}
        onCancel={finalizeFlow.cancel}
      />
      <FinalizeDialog />
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
      {isFinalized && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-30 animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 via-emerald-600 to-emerald-700 px-4 py-2 text-white shadow-2xl shadow-emerald-500/40 ring-2 ring-emerald-300/50">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-sm font-semibold">Report signed & delivered</span>
            <span className="text-[10px] opacity-80">· auto-advancing...</span>
            <ChevronRight className="h-4 w-4 animate-pulse" />
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
    </div>
  );
}
