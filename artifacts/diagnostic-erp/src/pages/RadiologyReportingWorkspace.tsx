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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { validateReport, computeQualityScore } from "@/lib/reportValidator";
import { logParityInDev } from "@/lib/reportQualityShadow";
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
import { createCommandDispatcher } from "@/lib/workspaceCommands";
import { loadReadingSession, toggleReadingSession, bumpSessionCompleted } from "@/lib/readingSession";
import {
  parseVoiceSettings, parseVoiceUserPrefs, mergeVoiceSettings,
  fetchTranscribeCapabilities,
} from "@/lib/voiceTranscription";

// ─── Existing Care components ──────────────────────────────────────────────────
import EmbeddedWadoViewer, { type EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import PrintImagePicker from "@/components/radiology/PrintImagePicker";
import ReportImagePicker from "@/components/radiology/ReportImagePicker";
import ComparisonPanel from "@/components/radiology/ComparisonPanel";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import FinalizeSignDialog from "@/components/radiology/FinalizeSignDialog";
import VoiceCommandBar from "@/components/radiology/VoiceCommandBar";
import QuickFindingsPanel, { type QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import PriorComparisonToolbar from "@/components/radiology/PriorComparisonToolbar";
import ViewerMeasurementsBanner from "@/components/radiology/ViewerMeasurementsBanner";
import LegacyBox, { type LegacyBoxTab } from "@/components/radiology/LegacyBox";
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import MriReadinessStrip from "@/components/radiology/MriReadinessStrip";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
import ReportingShortcutHelp from "@/components/radiology/ReportingShortcutHelp";
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { mergeBlock, removeBlock, mergeImpression, removeImpression } from "@/lib/quickFindingsMerge";
import type { Side } from "@/lib/sideSwap";
import {
  loadWorkspaceLayoutPrefs, saveWorkspaceLayoutPrefs,
  shouldShowEmbeddedViewer, type WorkspaceLayoutMode,
} from "@/lib/workspaceLayoutPrefs";
import { isUltrasoundModality, isObstetricUsgStudy } from "@/lib/usgModality";

// ─── New Z.ai workspace components ─────────────────────────────────────────────
import { useWorkspace, type WorkspaceStore } from "@/lib/zai-workspace/store";
import { getFindingsCompletionPct, shouldPreloadNext } from "@/lib/zai-workspace/types";
import type { Study, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";
import { WorklistStrip } from "@/components/radiology/zai-workspace/worklist-strip";
import { CopilotRail } from "@/components/radiology/zai-workspace/copilot-rail";
import { FindingsEditor } from "@/components/radiology/zai-workspace/findings-editor";
import { VoiceBar } from "@/components/radiology/zai-workspace/voice-bar";
import { FinalizeDialog } from "@/components/radiology/zai-workspace/finalize-dialog";
import { InterruptChannelCard } from "@/components/radiology/zai-workspace/interrupt-card";
import { QuickSelectEditor } from "@/components/radiology/zai-workspace/quick-select-editor";
import { MergePreviewDialog } from "@/components/radiology/zai-workspace/merge-preview-dialog";
import { ConfirmOverwriteDialog } from "@/components/radiology/zai-workspace/confirm-overwrite-dialog";
import { SaveAsFormatDialog } from "@/components/radiology/zai-workspace/save-as-format-dialog";
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
  Brain, Activity, Zap, Printer, FileDown, Share2, Eye, PanelLeftClose, PanelLeftOpen,
  Maximize2, Columns2, Monitor, Archive, Keyboard,
} from "lucide-react";

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
  const commandDispatcherRef = useRef<{ dispatch: (cmd: string) => void } | null>(null);
  const canVerifyRef = useRef(false);
  const verifyActionRef = useRef<(() => void) | null>(null);
  const [legacyTab, setLegacyTab] = useState<LegacyBoxTab | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

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
  });

  // 2. Study lock (claim/heartbeat/release)
  const studyLock = useStudyLock(studyId, {
    enabled: Boolean(workflow.currentRow && workflow.currentRow.status !== "REPORT_FINAL" && workflow.currentRow.status !== "DELIVERED") as any,
  });

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

  // 6. Voice session (4-provider speech-to-text with grammar + safety)
  const [voiceSettings, setVoiceSettings] = useState(() => mergeVoiceSettings(
    parseVoiceSettings([]),
    parseVoiceUserPrefs(null),
  ));
  const [voiceCapabilities, setVoiceCapabilities] = useState<{ server: boolean; local: boolean }>({ server: false, local: false });
  useEffect(() => {
    fetchTranscribeCapabilities().then(caps => setVoiceCapabilities(caps)).catch(() => {});
  }, []);
  const voiceSession = useVoiceSession({
    studyId: studyId ?? undefined,
    settings: voiceSettings,
    capabilities: voiceCapabilities,
    getContext: (() => ({
      studyId: studyId ?? null,
      dirty: useWorkspace.getState().isDirty,
      isLocked: studyLock.status === "locked-by-other",
      lockedByOther: studyLock.status === "locked-by-other",
      lockLost: !!(studyLock.status === "expired-lost" || studyLock.status === "connection-lost"),
      canVerify: canVerifyRef.current,
      structuredFindings: null,
      viewerAvailable: embeddedViewerRef.current != null,
      confirmationPolicy: voiceSettings.confirmationPolicy,
    }) as any),
    execute: (cmd) => {
      // Full legacy-style voice execution — keep NEW dispatcher, add dictate/viewer paths.
      const intent = (cmd as any)?.intent;
      if (!intent) return { ok: false, reason: "no_intent" };
      if (intent.type === "dictate") {
        const text = String(intent.text || "").trim();
        if (!text) return { ok: false, reason: "empty" };
        const state = useWorkspace.getState();
        const target = intent.target || "findings";
        const mode = intent.mode || "append";
        if (target === "impression") {
          state.setField("impression", mode === "replace" ? text : mergeBlock(state.impressionText, text));
        } else if (target === "recommendation") {
          state.setField("recommendation", mode === "replace" ? text : mergeBlock(state.recommendationText, text));
        } else if (target === "technique") {
          state.setField("technique", mode === "replace" ? text : mergeBlock(state.techniqueText, text));
        } else if (target === "clinicalHistory" || target === "clinical_history") {
          state.setField("clinicalHistory", mode === "replace" ? text : mergeBlock(state.clinicalHistoryText, text));
        } else {
          state.setField("findings", mode === "replace" ? text : mergeBlock(state.findingsText, text));
        }
        return { ok: true };
      }
      if (intent.type === "workflow" && intent.command) {
        commandDispatcherRef.current?.dispatch(intent.command);
        return { ok: true };
      }
      if (intent.type === "viewer") {
        const v = embeddedViewerRef.current;
        if (!v) return { ok: false, reason: "no_viewer" };
        if (intent.action === "next") v.nextFrame();
        else if (intent.action === "prev" || intent.action === "previous") v.prevFrame();
        else if (intent.action === "zoom_in") v.zoomIn();
        else if (intent.action === "zoom_out") v.zoomOut();
        else if (intent.action === "reset") v.resetView();
        return { ok: true };
      }
      if (intent.type === "quick_select_search" && intent.term) {
        setLegacyTab("library");
        rightPanelRef.current?.expand();
        return { ok: true };
      }
      return { ok: true };
    },
    onAudit: (commandType, outcome) => {
      api.post("/api/radiology/voice-command-audit", { commandType, studyId, outcome }).catch(() => {});
    },
  });

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
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [checklistComm, setChecklistComm] = useState({ phoned: false, annotated: false, dispatched: false });
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Viewer vertical enlarge (center column only) + left worklist collapse
  const [viewerColumnExpanded, setViewerColumnExpanded] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [patientJumpFilter, setPatientJumpFilter] = useState("");

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

  /** Clinic Quick Select toggle — insert/remove exact template text (legacy merge safety). */
  const handleQuickToggle = useCallback((finding: QuickFinding, nowSelected: boolean) => {
    setSelectedQuickIds((prev) => {
      const next = new Set(prev);
      if (nowSelected) next.add(finding.id);
      else next.delete(finding.id);
      return next;
    });
    const state = useWorkspace.getState();
    if (nowSelected) {
      if (finding.findingText) state.setField("findings", mergeBlock(state.findingsText, finding.findingText));
      if (finding.impressionText) {
        const lines = state.impressionText.split("\n").filter(Boolean);
        state.setField("impression", mergeImpression(lines, finding.impressionText).join("\n"));
      }
      if (finding.techniqueText) state.setField("technique", mergeBlock(state.techniqueText, finding.techniqueText));
      if (finding.recommendationText) state.setField("recommendation", mergeBlock(state.recommendationText, finding.recommendationText));
    } else {
      if (finding.findingText) state.setField("findings", removeBlock(state.findingsText, finding.findingText));
      if (finding.impressionText) {
        const lines = state.impressionText.split("\n").filter(Boolean);
        state.setField("impression", removeImpression(lines, finding.impressionText).join("\n"));
      }
      if (finding.techniqueText) state.setField("technique", removeBlock(state.techniqueText, finding.techniqueText));
      if (finding.recommendationText) state.setField("recommendation", removeBlock(state.recommendationText, finding.recommendationText));
    }
  }, []);

  const appendFindings = useCallback((text: string) => {
    const state = useWorkspace.getState();
    state.setField("findings", mergeBlock(state.findingsText, text));
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
    if (!studyId || hydratedDraftForStudyRef.current === studyId) return;
    if (existingDraft) {
      hydratedDraftForStudyRef.current = studyId;
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
    } else {
      // Fetch AI draft
      const row = workflow.currentRow;
      if (row) {
        api.post<{ findings: string; impression: string; recommendation: string }>("/api/ai-reporting/draft", {
          studyInstanceUID: row.studyInstanceUID,
          modality: row.modality,
        }).then((draft: any) => {
          if (!draft || typeof draft !== "object") return;
          const normStr = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
          useWorkspace.getState().setEditorContent({
            findings: normStr(draft.findings),
            impression: normalizeImpressionLines(draft.impression).join("\n"),
            recommendation: normStr(draft.recommendation),
            technique: normStr(draft.technique),
            clinicalHistory: (row as any).clinicalHistory ?? "",
          });
        }).catch(() => {
          useWorkspace.getState().setField("clinicalHistory", (row as any).clinicalHistory ?? "");
        });
      }
    }
  }, [studyId, existingDraft, workflow.currentRow]);

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
  const saveDraft = useCallback(async (): Promise<number | null> => {
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
        } as any),
        { shouldRetry: isTransientError },
      );
      const id = res?.draft?.id ?? res?.id ?? null;
      if (id) captureSavedDraftId(id);
      setLastSavedAt(new Date());
      toast({ title: "Draft saved", duration: 1500 });
      return id;
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
      return null;
    }
  }, [studyId, draftId, clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText, isOnline, captureSavedDraftId, toast]);

  // ─── Finalize (sign + archive + notify) ─────────────────────────────────────
  const finalizeReport = useCallback(async () => {
    if (!studyId || !workflow.currentRow) return;
    const offlineMsg = offlineBlockMessage(isOnline, "finalize");
    if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return; }

    // 1. Save dirty state first
    if (useWorkspace.getState().isDirty) await saveDraft();

    // 2. Validate (local + server validate-draft when available)
    const validationIssues = validateReport({
      findings: findingsText,
      impression: [impressionText],
      technique: techniqueText,
    } as any);
    if (draftId) {
      try {
        const serverVal = await api.post<{
          structured?: { errors?: unknown[]; warnings?: string[]; skipReasons?: string[] };
        }>("/api/radiology/report-generator/validate-draft", { draftId });
        const errs = serverVal?.structured?.errors ?? [];
        const warns = serverVal?.structured?.warnings ?? [];
        const skips = serverVal?.structured?.skipReasons ?? [];
        for (const e of errs) validationIssues.push(typeof e === "string" ? e : JSON.stringify(e));
        for (const w of warns) validationIssues.push(w);
        for (const s of skips) validationIssues.push(s);
      } catch { /* non-fatal — local validation still applies */ }
    }

    // 3. Critical findings check (auto-detect + manual mark/comms from legacy)
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

    // 4. Get signatures
    const signatures = await api.get<{ id: number; name: string }[]>("/api/signatures");

    // 5. Prompt via finalize flow
    const result = await finalizeFlow.promptFinalize({
      identity: `${workflow.currentRow.patientName} — ${workflow.currentRow.studyDescription}`,
      validationSummary: validationIssues.join("; ") as any,
      warningBlock: safetyIssues.filter(i => i.severity === "warn").map(i => i.message).join("; "),
      safetyBlock: formatFinalizeSafety(safetyIssues),
      unbilledNote: "",
      signatures: signatures,
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

    // 6. Execute finalize
    try {
      const finalizeResult = await finalizeRadiologyReport(
        ({
          studyId,
          worklistId: studyId,
          patientId: workflow.currentRow.patientId,
          accessionNumber: workflow.currentRow.accessionNumber ?? "",
          studyDescription: workflow.currentRow.studyDescription ?? "",
          modality: workflow.currentRow.modality ?? "",
        } as any),
        {
          title: workflow.currentRow?.studyDescription ?? "Report",
          htmlBody: `<h2>${workflow.currentRow?.studyDescription ?? "Report"}</h2><p><b>Findings:</b> ${findingsText}</p><p><b>Impression:</b> ${impressionText}</p><p><b>Recommendation:</b> ${recommendationText}</p>`,
          impression: [impressionText],
          isCritical: criticalMarked,
          criticalNote: criticalNote || (criticalHits.length > 0 ? criticalHits.map(h => h.label).join(", ") : null),
          createdBy: session?.user?.name ?? "Dr. Abinash Kumar",
        } as any,
      );

      // 7. Honest toast
      if (finalizeResult.signed) {
        toast({ title: "Report finalized & signed", description: `Report #${finalizeResult.reportId}` });
      } else if (finalizeResult.reportCreationSkipped) {
        toast({ title: "Worklist marked final", description: `No patient report row created: ${finalizeResult.reportCreationSkipped}`, variant: "destructive" });
      } else {
        toast({ title: "Report saved but NOT signed", description: finalizeResult.signError ?? "Sign error", variant: "destructive" });
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
  }, [studyId, workflow, isOnline, findingsText, impressionText, recommendationText, techniqueText, saveDraft, finalizeFlow, draftBackup, qc, toast, isCritical, criticalNote, checklistComm, draftId, session]);

  // ─── Command dispatcher (single choke point for keyboard/voice/palette) ────
  const commandDispatcher = useMemo(() => createCommandDispatcher({
    save: async () => { await saveDraft(); },
    finalize: finalizeReport,
    next: () => { goNextStudy(); },
    previous: () => { goPrevStudy(); },
    park: () => { if (studyId) { (workflow as any).park(studyId, ""); } },
    refresh: () => workflow.refreshQueue(),
    "open-viewer": () => {
      // External viewers launch from the embedded OHIF header (new tab).
    },
    "focus-quick-search": () => { /* TODO */ },
    verify: () => { verifyActionRef.current?.(); },
    unpark: () => { if (studyId) { workflow.unpark(studyId); } },
    "reload-current": () => window.location.reload(),
    "focus-findings": () => { /* TODO */ },
    "focus-impression": () => { /* TODO */ },
    "close-panel": () => { rightPanelRef.current?.collapse(); },
    "select-template-1": () => {}, "select-template-2": () => {}, "select-template-3": () => {},
    "select-template-4": () => {}, "select-template-5": () => {}, "select-template-6": () => {},
  }), [saveDraft, finalizeReport, workflow, studyId, goNextStudy, goPrevStudy]);
  commandDispatcherRef.current = commandDispatcher;

  // ─── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if (e.ctrlKey && (e.key === "i" || e.key === "I")) { e.preventDefault(); triggerAiImpression(); return; }
      if (e.ctrlKey && e.shiftKey && (e.key === "v" || e.key === "V")) { e.preventDefault(); useWorkspace.getState().toggleVoiceBar(); return; }
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandDispatcher, finalizeReport, leftCollapsed, showEmbeddedViewer, setLayoutMode]);

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

  // ─── Word/PDF export ────────────────────────────────────────────────────────
  const handleExportWord = useCallback(() => {
    const html = `<h2>${workflow.currentRow?.studyDescription ?? "Report"}</h2><p><b>Findings:</b> ${findingsText}</p><p><b>Impression:</b> ${impressionText}</p><p><b>Recommendation:</b> ${recommendationText}</p>`;
    exportRadiologyReportToWord(html, safeFileNamePart(workflow.currentRow?.patientName ?? "report"));
  }, [workflow.currentRow, findingsText, impressionText, recommendationText]);

  const handleExportPdf = useCallback(async () => {
    const html = `<h2>${workflow.currentRow?.studyDescription ?? "Report"}</h2><p><b>Findings:</b> ${findingsText}</p><p><b>Impression:</b> ${impressionText}</p><p><b>Recommendation:</b> ${recommendationText}</p>`;
    await (exportRadiologyReportToPdf as any)({
      htmlBody: html,
      patientName: workflow.currentRow?.patientName ?? "",
      studyDescription: workflow.currentRow?.studyDescription ?? "",
      accessionNumber: workflow.currentRow?.accessionNumber ?? "",
      dicomWebBase: "",
      imageRefs: [],
    });
  }, [workflow.currentRow, findingsText, impressionText, recommendationText]);

  // ─── Teaching case save ─────────────────────────────────────────────────────
  const handleSaveTeachingCase = useCallback(async () => {
    if (!studyId) return;
    try {
      await api.post("/api/teaching-cases/generate-from-report", { studyId, findings: findingsText, impression: impressionText });
      toast({ title: "Saved as teaching case" });
    } catch (err) { toast({ title: "Failed", variant: "destructive" }); }
  }, [studyId, findingsText, impressionText, toast]);

  // ─── Report share (WhatsApp) ─────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!studyId) return;
    try {
      await api.post(`/api/patient-reports/${studyId}/share`, { channel: "whatsapp" });
      toast({ title: "Shared via WhatsApp" });
    } catch (err) { toast({ title: "Share failed", variant: "destructive" }); }
  }, [studyId, toast]);

  // ─── Verify / countersign (legacy D9) — additive; does not replace Finalize ─
  const linkedReportId = useMemo(() => {
    const row = workflow.currentRow as { reportId?: number | null } | null | undefined;
    const draft = existingDraft as { finalReportId?: number | null } | null | undefined;
    return draft?.finalReportId ?? row?.reportId ?? null;
  }, [workflow.currentRow, existingDraft]);

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

  // ─── PCPNDT gate (OB USG Form F check) ──────────────────────────────────────
  const modalityRaw = workflow.currentRow?.modality ?? "";
  const isUltrasound = isUltrasoundModality(modalityRaw);
  const isCtModality = modalityRaw.trim().toUpperCase().startsWith("CT");
  const isMriModality = modalityRaw.trim().toUpperCase().startsWith("MR");
  const companionEligible = isUltrasound || isCtModality;
  const studyRegion = (workflow.currentRow as { bodyPart?: string | null } | null)?.bodyPart
    ?? workflow.currentRow?.studyDescription
    ?? null;
  const qualityScore = useMemo(
    () => computeQualityScore({
      findings: findingsText,
      impression: [impressionText],
      technique: techniqueText,
    } as any),
    [findingsText, impressionText, techniqueText],
  );

  const isObUsg = isObstetricUsgStudy(modalityRaw, workflow.currentRow?.studyDescription ?? "");
  const { data: pcpndtCompliance } = useQuery<{ compliant: boolean; missing?: string[] }>({
    queryKey: ["pcpndt-compliance", workflow.currentRow?.patientId],
    queryFn: () => api.get(`/api/patient-reports/pcpndt-compliance/${workflow.currentRow!.patientId}`),
    enabled: !!workflow.currentRow?.patientId && isObUsg,
    refetchInterval: 30000,
  });

  // ─── Compute derived state ──────────────────────────────────────────────────
  const study = studies.find((s: Study) => s.id === activeStudyId);
  const sessionMin = Math.floor((Date.now() - sessionStartedAt) / 60000);
  const showFatigue = sessionMin >= 90 && sessionMin % 90 < 2 && !useWorkspace.getState().fatigueCardDismissed;
  const findingsPct = study ? getFindingsCompletionPct(findingsText, study.modality) : 0;
  const isLocked = studyLock.status === "locked-by-other";
  const lockLost = studyLock.status === "expired-lost" || studyLock.status === "connection-lost";

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* ─── Top chrome ─── */}
      <header className="flex items-center gap-3 border-b border-border px-3 py-2 bg-card">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-emerald-700">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-xs font-bold leading-none">Z.ai RadReporting</div>
            <div className="text-[9px] text-muted-foreground leading-none mt-0.5">World's best reporting workspace</div>
          </div>
        </div>
        <div className="h-5 w-px bg-border mx-1" />
        {/* Layout modes — Report / Split / Viewer (legacy) */}
        <div className="flex items-center rounded-md border overflow-hidden text-[10px]" data-testid="layout-mode-selector">
          {([
            { mode: "reportFocus" as const, label: "Report", icon: <Maximize2 className="h-3 w-3" />, title: "Report Focus — hide viewer" },
            { mode: "split" as const, label: "Split", icon: <Columns2 className="h-3 w-3" />, title: "Split — viewer + editor" },
            { mode: "viewerFocus" as const, label: "Viewer", icon: <Monitor className="h-3 w-3" />, title: "Viewer Focus — larger viewer" },
          ]).map((m) => (
            <button
              key={m.mode}
              type="button"
              title={m.title}
              onClick={() => setLayoutMode(m.mode)}
              className={`inline-flex items-center gap-1 px-2 py-1.5 border-r last:border-r-0 ${layoutMode === m.mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
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
        <div className="h-5 w-px bg-border mx-1" />
        {/* Searchable patient jump (ported from legacy chrome) */}
        <div className="flex items-center gap-1 shrink-0" data-testid="compact-patient-picker">
          <Input
            value={patientJumpFilter}
            onChange={(e) => setPatientJumpFilter(e.target.value)}
            placeholder="Search patient…"
            className="h-7 w-28 text-[10px] px-1.5"
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
        <div className="h-5 w-px bg-border mx-1" />
        {study && (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: study.modality === "MR" ? "oklch(0.55 0.18 280)" : study.modality === "CT" ? "oklch(0.55 0.18 220)" : study.modality === "US" ? "oklch(0.6 0.15 180)" : "oklch(0.6 0.12 60)" }}>
              {study.modality}
            </span>
            <span className="text-xs font-semibold truncate">{study.studyDescription}</span>
            <span className="text-[10px] text-muted-foreground truncate">
              · {study.patient?.name ?? "Unknown"} ({study.patient?.age ?? 0}{study.patient?.sex ?? "O"})
            </span>
            {findingsPct > 0 && (
              <span className={`text-[9px] font-mono px-1 rounded ${findingsPct >= 80 ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                title="Findings completion (preload fires at 80%)">{findingsPct}%</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {criticalSlaStartedAt && <CriticalSlaTimer />}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground px-2 py-1 rounded bg-muted/40">
            <Activity className="h-3 w-3" />
            <span className="font-mono">{Math.floor(sessionMin / 60)}h {sessionMin % 60}m</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-emerald-600 font-semibold">{completedCount} signed</span>
          </div>
          {/* Existing VoiceCommandBar */}
          {voiceSession.enabled && <VoiceCommandBar voice={voiceSession} embedded />}
          {/* Save button */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={saveDraft} disabled={!isOnline}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          {/* Word export */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleExportWord}>
            <FileDown className="h-3.5 w-3.5 mr-1" /> Word
          </Button>
          {/* PDF export */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleExportPdf}>
            <Printer className="h-3.5 w-3.5 mr-1" /> PDF
          </Button>
          {/* Share */}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5 mr-1" /> Share
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
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => useWorkspace.getState().toggleVoiceBar()}>
            <Brain className="h-3.5 w-3.5 mr-1" /> Voice2
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
            onClick={finalizeReport} disabled={!studyId || isFinalized || isLocked}>
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
          PCPNDT Form F incomplete: {(pcpndtCompliance.missing ?? []).join(", ")}. Finalize will be blocked.
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
            <div className="h-full border-r border-border bg-card">
              {leftCollapsed ? (
                <button
                  type="button"
                  className="flex h-full w-full flex-col items-center gap-2 py-3 text-muted-foreground hover:bg-muted/40"
                  onClick={() => leftPanelRef.current?.expand()}
                  title="Expand worklist"
                  data-testid="left-panel-expand"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  <span className="text-[9px] writing-mode-vertical font-semibold tracking-wider uppercase" style={{ writingMode: "vertical-rl" }}>
                    Queue
                  </span>
                </button>
              ) : (
                <WorklistStrip onSelectStudy={openStudy} />
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
                <div className="flex h-full flex-col">
                  <div className="flex-1 min-h-0">
                    <EmbeddedWadoViewer
                      ref={embeddedViewerRef}
                      studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                      accessionNumber={workflow.currentRow?.accessionNumber ?? null}
                      columnExpanded={viewerColumnExpanded}
                      onColumnExpandedChange={setViewerColumnExpanded}
                    />
                  </div>
                  {!viewerColumnExpanded && workflow.currentRow && (
                    <div className="border-t border-border shrink-0">
                      <ReportImagePicker
                        draftId={draftId ?? null}
                        studyId={studyId ?? null}
                        studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                        disabled={workflow.currentRow?.status === "REPORT_FINAL"}
                        onEnsureDraft={saveDraft}
                      />
                    </div>
                  )}
                  {!viewerColumnExpanded && workflow.currentRow && (
                    <div className="border-t border-border shrink-0">
                      <PrintImagePicker
                        studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                        disabled={workflow.currentRow?.status === "REPORT_FINAL"}
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
                <div className="h-full overflow-y-auto bg-card">
                  <div className="p-4 space-y-3">
                    {workflow.currentRow && (
                      <ReferringDoctorQuickSelect
                        worklistId={studyId ?? 0}
                        currentName={(workflow.currentRow as any)?.referringDoctor}
                      />
                    )}

                    {/* OB dashboard strip — silent for non-OB USG */}
                    {isUltrasound && (
                      <ObDashboardStrip
                        studyId={studyId ?? (workflow.currentRow as { studyId?: number } | null)?.studyId}
                        onApplyToReport={(text) => appendFindings(text)}
                      />
                    )}

                    {/* USG / CT Companion — additive, error-bounded */}
                    {companionEligible && workflow.currentRow?.studyInstanceUID && (
                      <ModuleErrorBoundary resetKey={String(workflow.currentRow.studyInstanceUID)}>
                        <UsgCompanionPanel
                          studyInstanceUID={workflow.currentRow.studyInstanceUID}
                          studyId={studyId ?? undefined}
                          patientId={workflow.currentRow.patientId ?? undefined}
                          disabled={isLocked || isFinalized}
                          templateSelected={false}
                          protocolSelected={false}
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
                          selectedFindingIds={[...selectedQuickIds]}
                          region={studyRegion}
                          onOpenTab={(tab) => {
                            if (tab === "measurements" || tab === "measure") openLegacyTab("measurements");
                            else if (tab === "templates" || tab === "library") openLegacyTab("library");
                            else if (tab === "copilot") openLegacyTab("copilot");
                            else if (tab === "prior") rightPanelRef.current?.expand();
                            else openLegacyTab("links");
                          }}
                        />
                      </ModuleErrorBoundary>
                    )}

                    {/* MRI readiness — when Companion is not shown */}
                    {!isLocked && isMriModality && !companionEligible && (
                      <MriReadinessStrip
                        studyRegion={studyRegion}
                        protocolName={null}
                        protocolApplied={false}
                        templateName={null}
                        templateMismatch={false}
                        priorCount={0}
                        pendingMeasurements={0}
                        checklistPercent={null}
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

                    {/* Prior comparison — one-click interval sentences (legacy) */}
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

                    {/* Pending viewer measurements banner (legacy) */}
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

                    <FindingsEditor field="clinicalHistory" label="Clinical History" minHeight="56px" placeholder="Presenting complaint and relevant history." />
                    <FindingsEditor field="technique" label="Technique" minHeight="60px" placeholder="Modality, sequences, contrast..." />
                    <FindingsEditor field="findings" label="Findings" minHeight="220px" placeholder="Type findings. Use :macro + Tab for snippets. Ctrl+Enter for AI ghost." showGhost />
                    <FindingsEditor field="impression" label="Impression" minHeight="100px" placeholder="Conclusion. Ctrl+I for AI impression." showGhost />
                    <FindingsEditor field="recommendation" label="Recommendation" minHeight="60px" placeholder="Follow-up, referral..." showGhost />

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

                    {/* Clinic Quick Select (legacy QuickFindingsPanel) */}
                    <div className="border rounded-md p-2" data-testid="clinic-quick-select">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Clinic Quick Select</div>
                      <QuickFindingsPanel
                        selectedIds={selectedQuickIds}
                        onToggle={handleQuickToggle}
                        side={quickSide}
                        onSideChange={setQuickSide}
                        disabled={isLocked || isFinalized}
                        initialStudyHint={workflow.currentRow?.studyDescription ?? workflow.currentRow?.modality ?? null}
                        isAdmin={isOwner}
                        onMeasurement={(template, value) => appendFindings(template.replace(/\{value\}/gi, value).replace(/\{val\}/gi, value))}
                        onAutoTechnique={(text) => {
                          const state = useWorkspace.getState();
                          state.setField("technique", mergeBlock(state.techniqueText, text));
                        }}
                        onInsertNormals={(text) => appendFindings(text)}
                        onAcceptLearnedSuggestion={(text) => {
                          const state = useWorkspace.getState();
                          state.setField("recommendation", mergeBlock(state.recommendationText, text));
                        }}
                      />
                    </div>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle />
              {/* Copilot rail with ComparisonPanel + FollowUpPanel */}
              <ResizablePanel defaultSize={42} minSize={32} ref={rightPanelRef}>
                <div className="h-full border-l border-border bg-card overflow-y-auto">
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
                          const state = useWorkspace.getState();
                          const lines = state.impressionText.split("\n").filter(Boolean);
                          state.setField("impression", mergeImpression(lines, text).join("\n"));
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
                        const state = useWorkspace.getState();
                        const lines = state.impressionText.split("\n").filter(Boolean);
                        state.setField("impression", mergeImpression(lines, text).join("\n"));
                      }}
                      onAppendRecommendation={(text) => {
                        const state = useWorkspace.getState();
                        state.setField("recommendation", mergeBlock(state.recommendationText, text));
                      }}
                      onSetFindings={(text) => useWorkspace.getState().setField("findings", text)}
                      onSetImpression={(text) => useWorkspace.getState().setField("impression", text)}
                      onSetTechnique={(text) => useWorkspace.getState().setField("technique", text)}
                      onApplyReport={(r) => {
                        const state = useWorkspace.getState();
                        if (r.findingsText) state.setField("findings", mergeBlock(state.findingsText, r.findingsText));
                        if (r.impressionLines?.length) {
                          state.setField(
                            "impression",
                            r.impressionLines.reduce(
                              (acc, line) => mergeImpression(acc.split("\n").filter(Boolean), line).join("\n"),
                              state.impressionText,
                            ),
                          );
                        }
                        if (r.technique) state.setField("technique", mergeBlock(state.techniqueText, r.technique));
                      }}
                    />
                  </ModuleErrorBoundary>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* ─── Footer: shortcuts + status ─── */}
      <footer className="flex items-center justify-between border-t border-border px-3 py-1.5 bg-card text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌘K</kbd> palette</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃↵</kbd> finalize</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃S</kbd> save</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃⇧N</kbd> next</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃⇧P</kbd> previous</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃⇧K</kbd> park</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">:macro</kbd>+<kbd className="rounded bg-muted px-1 py-0.5 font-mono">Tab</kbd></span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">?</kbd> shortcuts</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">Alt+]</kbd> Legacy Box</span>
        </div>
        {study?.lockedBy && <div className="flex items-center gap-1.5 text-amber-600"><Lock className="h-3 w-3" />Locked by you</div>}
        <div className="flex items-center gap-2">
          {study?.criticalFlag && <Badge variant="outline" className="text-[9px] bg-rose-50 text-rose-700 border-rose-200"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Critical</Badge>}
          {preloadTriggered && <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200"><Zap className="h-2.5 w-2.5 mr-0.5" />Preloaded</Badge>}
          {(readingSession as any)?.autoAdvance && <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200"><ChevronRight className="h-2.5 w-2.5 mr-0.5" />Auto-advance</Badge>}
          <span className="text-emerald-600 font-semibold">✓ Zero-Click Read Loop</span>
        </div>
      </footer>

      {/* ─── Floating UI overlays ─── */}
      <VoiceBar />
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
      <MergePreviewDialog />
      <ConfirmOverwriteDialog />
      <SaveAsFormatDialog />
      <MacroEditorDialog />
      <MacroPromptPopover />
      <ReportingShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      {/* ─── Zero-Click Read Loop success toast ─── */}
      {isFinalized && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-30 animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-white shadow-2xl">
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
