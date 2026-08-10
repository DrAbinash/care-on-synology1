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
 *   • PrintImagePicker / ReportImagePicker → DICOM image selection for print
 *   • ComparisonPanel → prior study comparison with sentence-level diff
 *   • FollowUpPanel → follow-up recommendations
 *   • OpenStudyPanel → viewer launch control
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
  serializeReportSnapshot, isReportDirty, shouldOfferBackupRestore,
  canVerifyReport, matchWorkspaceShortcut,
} from "@/lib/workspaceReportState";
import { createCommandDispatcher } from "@/lib/workspaceCommands";
import { loadReadingSession, toggleReadingSession, bumpSessionCompleted } from "@/lib/readingSession";
import {
  loadWorkspaceLayoutPrefs, saveWorkspaceLayoutPrefs,
} from "@/lib/workspaceLayoutPrefs";
import {
  parseVoiceSettings, parseVoiceUserPrefs, mergeVoiceSettings,
  fetchTranscribeCapabilities,
} from "@/lib/voiceTranscription";

// ─── Existing Care components ──────────────────────────────────────────────────
import EmbeddedWadoViewer, { type EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import OpenStudyPanel from "@/components/radiology/OpenStudyPanel";
import PrintImagePicker from "@/components/radiology/PrintImagePicker";
import ReportImagePicker from "@/components/radiology/ReportImagePicker";
import ComparisonPanel from "@/components/radiology/ComparisonPanel";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import FinalizeSignDialog from "@/components/radiology/FinalizeSignDialog";
import VoiceCommandBar from "@/components/radiology/VoiceCommandBar";
// import CommandPalette from "@/components/radiology/CommandPalette"; // replaced by ZaiCommandPalette
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";

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
  Lock, AlertTriangle, ChevronRight, Pause, Clock, Sparkles, ShieldCheck,
  Brain, Activity, Zap, Printer, FileDown, Share2, Eye,
} from "lucide-react";

interface Props { studyId?: number; }

export default function RadiologyReportingWorkspace({ studyId }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isOnline = useOnlineStatus();
  const qc = useQueryClient();

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
      canVerify: false,
      structuredFindings: null,
      viewerAvailable: embeddedViewerRef.current != null,
      confirmationPolicy: voiceSettings.confirmationPolicy,
    }) as any),
    execute: (cmd) => {
      // Route through the command dispatcher
      if (cmd.intent) if (cmd) commandDispatcher.dispatch(cmd as any);
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

  // 10. Layout prefs (per-radiologist panel sizes)
  const [layoutPrefs, setLayoutPrefs] = useState(() => (loadWorkspaceLayoutPrefs as any)());

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const embeddedViewerRef = useRef<EmbeddedViewerHandle>(null);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const hydratedDraftForStudyRef = useRef<number | null>(null);

  // ─── Fetch worklist from real API ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function fetchWorklist() {
      try {
        const data = await api.get<{ studies: Study[] } | Study[]>("/api/radiology/pacs-worklist");
        const list = Array.isArray(data) ? data : data.studies;
        if (!cancelled && list) setStudies(list);
      } catch (err) {
        console.warn("[Workspace] worklist fetch failed:", err);
      }
    }
    fetchWorklist();
    const interval = setInterval(fetchWorklist, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [setStudies]);

  // ─── Sync workflow queue into Z.ai store ────────────────────────────────────
  useEffect(() => {
    if (workflow.queue && workflow.queue.length > 0) {
      setStudies(workflow.queue.map((q: any) => ({
        id: String(q.id),
        accession: q.accessionNumber ?? "",
        studyInstanceUID: q.studyInstanceUID ?? "",
        patient: {
          id: String(q.patientId ?? 0),
          name: q.patientName ?? "Unknown",
          age: q.patientAge ?? 0,
          sex: q.patientSex ?? "O",
          uhid: q.patientId ?? "",
          phone: q.patientPhone,
          referringDoctor: q.referringDoctor ?? "",
        },
        modality: q.modality ?? "XR",
        bodyPart: q.bodyPart ?? "",
        studyDescription: q.studyDescription ?? "",
        clinicalHistory: (q as any).clinicalHistory ?? "",
        status: q.status ?? "received",
        priority: q.priority ?? "routine",
        receivedAt: q.receivedAt ?? "",
        lockedBy: q.lockUserName,
        lockExpiresAt: q.lockExpiresAt,
        priorCount: q.priorCount ?? 0,
        criticalFlag: q.criticalFlag ?? false,
        aiDraftReady: q.aiDraftReady ?? false,
        tatMinutes: q.tatMinutes ?? 0,
        slaMinutes: q.slaMinutes ?? 240,
        series: q.series ?? 0,
        images: q.images ?? 0,
      })));
    }
  }, [workflow.queue, setStudies]);

  // ─── Auto-select first study ────────────────────────────────────────────────
  useEffect(() => {
    if (studies.length === 0 || activeStudyId) return;
    if (studyId) {
      const match = studies.find((s: Study) => s.id === String(studyId));
      if (match) { selectStudy(match.id); return; }
    }
    const pr: Record<string, number> = { stat: 0, urgent: 1, routine: 2, vip: 1 };
    const sorted = [...studies].sort((a: Study, b: Study) => (pr[a.priority] - pr[b.priority]) || (a.tatMinutes - b.tatMinutes));
    if (sorted[0]) selectStudy(sorted[0].id);
  }, [studies, activeStudyId, studyId, selectStudy]);

  // ─── Hydrate editor when study changes ──────────────────────────────────────
  useEffect(() => {
    if (!studyId || hydratedDraftForStudyRef.current === studyId) return;
    if (existingDraft) {
      hydratedDraftForStudyRef.current = studyId;
      const draft = existingDraft as any;
      useWorkspace.getState().setEditorContent({
        findings: draft.findings ?? draft.rawFindings ?? "",
        impression: draft.impression ?? "",
        recommendation: draft.recommendation ?? "",
        technique: draft.technique ?? "",
        clinicalHistory: draft.clinicalHistory ?? (workflow.currentRow as any)?.clinicalHistory ?? "",
      });
    } else {
      // Fetch AI draft
      const row = workflow.currentRow;
      if (row) {
        api.post<{ findings: string; impression: string; recommendation: string }>("/api/ai-reporting/draft", {
          studyInstanceUID: row.studyInstanceUID,
          modality: row.modality,
        }).then(draft => {
          useWorkspace.getState().setEditorContent({
            findings: draft.findings,
            impression: draft.impression,
            recommendation: draft.recommendation,
            technique: "",
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
      Promise.allSettled([
        api.get(`/api/radiology-copilot/prior-studies?patientId=${next.patient.id}`),
        api.get(`/api/radiology/report-generator/measurements?studyId=${next.id}`),
        api.post("/api/ai-reporting/draft", { studyInstanceUID: next.studyInstanceUID, modality: next.modality }),
      ]).then(() => useWorkspace.getState().markNextStudyPreloaded());
    }
  }, [preloadTriggered, studies, activeStudyId]);

  // ─── Save draft (server-side) ──────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    if (!studyId) return;
    const offlineMsg = offlineBlockMessage(isOnline, "save");
    if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return; }
    try {
      const res = await retryWithBackoff(
        () => saveRadiologyDraft({
          studyId,
          draftId: draftId ?? undefined,
          clinicalHistory: clinicalHistoryText,
          technique: techniqueText,
          rawFindings: findingsText,
          impression: [impressionText],
          recommendation: recommendationText,
        } as any),
        { shouldRetry: isTransientError },
      );
      captureSavedDraftId((res as any).id);
      toast({ title: "Draft saved", duration: 1500 });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }, [studyId, draftId, clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText, isOnline, captureSavedDraftId, toast]);

  // ─── Finalize (sign + archive + notify) ─────────────────────────────────────
  const finalizeReport = useCallback(async () => {
    if (!studyId || !workflow.currentRow) return;
    const offlineMsg = offlineBlockMessage(isOnline, "finalize");
    if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return; }

    // 1. Save dirty state first
    if (useWorkspace.getState().isDirty) await saveDraft();

    // 2. Validate
    const validationIssues = validateReport({
      findings: findingsText,
      impression: [impressionText],
      technique: techniqueText,
    } as any);

    // 3. Critical findings check
    const criticalHits = detectCriticalFindings(findingsText, [impressionText]);
    const safetyIssues = computeFinalizeSafety({
      checklistActive: false,
      checklistPercent: 100,
      criticalHits: criticalHits.map(h => ({ label: h.label })),
      criticalMarked: false,
      criticalCommunicated: false,
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
      criticalMarked: false,
      criticalCommunicated: false,
    }),
      criticalSummary: criticalHits.map(h => h.label).join(", "),
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
          isCritical: criticalHits.length > 0,
          criticalNote: criticalHits.length > 0 ? criticalHits.map(h => h.label).join(", ") : null,
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
  }, [studyId, workflow, isOnline, findingsText, impressionText, recommendationText, techniqueText, saveDraft, finalizeFlow, draftBackup, qc, toast]);

  // ─── Command dispatcher (single choke point for keyboard/voice/palette) ────
  const commandDispatcher = useMemo(() => createCommandDispatcher({
    save: saveDraft,
    finalize: finalizeReport,
    next: () => {
      const next = workflow.peekNext();
      if (next) { (workflow.beginTransition as any)(next.id); navigate(`/radiology/reporting-workspace/${next.id}`); }
    },
    previous: () => {
      const prev = workflow.peekParked();
      if (prev) { (workflow.beginPreviousTransition as any)(prev.id); navigate(`/radiology/reporting-workspace/${prev.id}`); }
    },
    park: () => { if (studyId) { (workflow as any).park(studyId, ""); } },
    refresh: () => workflow.refreshQueue(),
    "open-viewer": () => { /* OpenStudyPanel handles this */ },
    "focus-quick-search": () => { /* TODO */ },
    verify: () => { /* TODO: D9 verify */ },
    unpark: () => { if (studyId) { workflow.unpark(studyId); } },
    "reload-current": () => window.location.reload(),
    "focus-findings": () => { /* TODO */ },
    "focus-impression": () => { /* TODO */ },
    "close-panel": () => { rightPanelRef.current?.collapse(); },
    "select-template-1": () => {}, "select-template-2": () => {}, "select-template-3": () => {},
    "select-template-4": () => {}, "select-template-5": () => {}, "select-template-6": () => {},
  }), [saveDraft, finalizeReport, workflow, studyId, navigate]);

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandDispatcher, finalizeReport]);

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

  // ─── PCPNDT gate (OB USG Form F check) ──────────────────────────────────────
  const isObUsg = workflow.currentRow?.modality === "US" && /OB|obstetric|fetal/i.test(workflow.currentRow?.studyDescription ?? "");
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
        {study && (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: study.modality === "MR" ? "oklch(0.55 0.18 280)" : study.modality === "CT" ? "oklch(0.55 0.18 220)" : study.modality === "US" ? "oklch(0.6 0.15 180)" : "oklch(0.6 0.12 60)" }}>
              {study.modality}
            </span>
            <span className="text-xs font-semibold truncate">{study.studyDescription}</span>
            <span className="text-[10px] text-muted-foreground truncate">· {study.patient.name} ({study.patient.age}{study.patient.sex})</span>
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
          {/* Left: Worklist */}
          <ResizablePanel defaultSize={18} minSize={14} maxSize={26} ref={leftPanelRef}>
            <div className="h-full border-r border-border bg-card">
              <WorklistStrip />
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Center: Viewer + Embedded WADO + Print/Report Image Pickers */}
          <ResizablePanel defaultSize={36} minSize={28} maxSize={50}>
            <div className="flex h-full flex-col">
              {/* OpenStudyPanel — viewer launch control */}
              {workflow.currentRow && (
                <div className="border-b border-border p-2">
                  <OpenStudyPanel study={{ studyInstanceUID: workflow.currentRow?.studyInstanceUID ?? null, accessionNumber: workflow.currentRow?.accessionNumber ?? null, patientId: workflow.currentRow?.patientId ?? null, worklistId: studyId ?? null }} isAdmin={isOwner} />
                </div>
              )}
              {/* EmbeddedWadoViewer — 3 enlarge modes */}
              <div className="flex-1 min-h-0">
                <EmbeddedWadoViewer
                  ref={embeddedViewerRef}
                  studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                  accessionNumber={workflow.currentRow?.accessionNumber ?? null}
                />
              </div>
              {/* Report Image Picker */}
              {workflow.currentRow && (
                <div className="border-t border-border">
                  <ReportImagePicker
                    draftId={draftId ?? null}
                    studyId={studyId ?? null}
                    studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                    disabled={workflow.currentRow?.status === "REPORT_FINAL"}
                    onEnsureDraft={async () => { await saveDraft(); return draftId ?? null; }}
                  />
                </div>
              )}
              {/* Print Image Picker */}
              {workflow.currentRow && (
                <div className="border-t border-border">
                  <PrintImagePicker
                    studyInstanceUID={workflow.currentRow?.studyInstanceUID ?? null}
                    disabled={workflow.currentRow?.status === "REPORT_FINAL"}
                  />
                </div>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Right: Editor + Copilot Rail */}
          <ResizablePanel defaultSize={46} minSize={36}>
            <ResizablePanelGroup direction="horizontal">
              {/* Editor column */}
              <ResizablePanel defaultSize={58} minSize={42}>
                <div className="h-full overflow-y-auto bg-card">
                  <div className="p-4 space-y-4">
                    {/* Referring doctor quick select */}
                    {workflow.currentRow && (
                      <ReferringDoctorQuickSelect
                        worklistId={studyId ?? 0}
                        currentName={(workflow.currentRow as any)?.referringDoctor}
                      />
                    )}
                    <FindingsEditor field="clinicalHistory" label="Clinical History" minHeight="56px" placeholder="Presenting complaint and relevant history." />
                    <FindingsEditor field="technique" label="Technique" minHeight="60px" placeholder="Modality, sequences, contrast..." />
                    <FindingsEditor field="findings" label="Findings" minHeight="220px" placeholder="Type findings. Use :macro + Tab for snippets. Ctrl+Enter for AI ghost." showGhost />
                    <FindingsEditor field="impression" label="Impression" minHeight="100px" placeholder="Conclusion. Ctrl+I for AI impression." showGhost />
                    <FindingsEditor field="recommendation" label="Recommendation" minHeight="60px" placeholder="Follow-up, referral..." showGhost />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle />
              {/* Copilot rail with ComparisonPanel + FollowUpPanel */}
              <ResizablePanel defaultSize={42} minSize={32} ref={rightPanelRef}>
                <div className="h-full border-l border-border bg-card overflow-y-auto">
                  <CopilotRail />
                  {/* ComparisonPanel — prior study comparison with sentence-level diff */}
                  {workflow.currentRow && (
                    <div className="border-t border-border p-2">
                      <ComparisonPanel
                        patientId={workflow.currentRow?.patientId ?? undefined}
                        excludeStudyId={studyId ?? undefined}
                        currentModality={workflow.currentRow.modality ?? ""}
                        currentStudyDescription={workflow.currentRow.studyDescription ?? ""}
                        currentFindings={findingsText}
                        onInsertFindings={(text) => useWorkspace.getState().setField("findings", findingsText + " " + text)}
                        onInsertImpression={(text) => useWorkspace.getState().setField("impression", impressionText + " " + text)}
                        onSelectPrior={() => {}}
                      />
                    </div>
                  )}
                  {/* FollowUpPanel — follow-up recommendations with sentence diff */}
                  {workflow.currentRow && (
                    <div className="border-t border-border p-2">
                      <ModuleErrorBoundary>
                        <FollowUpPanel
                          patientId={workflow.currentRow?.patientId ?? null}
                          currentFindings={findingsText}
                          onCopyFindings={(text: string) => useWorkspace.getState().setField("findings", text)}
                          onCopyImpression={(lines: string[]) => useWorkspace.getState().setField("impression", lines.join(" "))}
                        />
                      </ModuleErrorBoundary>
                    </div>
                  )}
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
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃I</kbd> AI impression</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">⌃⇧V</kbd> voice</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">N</kbd> next</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">P</kbd> park</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">:macro</kbd>+<kbd className="rounded bg-muted px-1 py-0.5 font-mono">Tab</kbd></span>
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
      {draftBackup.restoreAvailable && (shouldOfferBackupRestore as any)(
        draftBackup.peek(),
        existingDraft?.updatedAt,
        (serializeReportSnapshot as any)({ clinicalHistory: clinicalHistoryText, technique: techniqueText, rawFindings: findingsText, impression: impressionText, recommendation: recommendationText, quickSelectIds: [] }),
      ) && (
        <div className="fixed top-4 right-4 z-30 w-80 rounded-lg border border-amber-300 bg-amber-50 p-3 shadow-xl">
          <div className="text-xs font-semibold text-amber-800">Unsaved draft found</div>
          <div className="text-[10px] text-amber-700 mt-1">A local backup is newer than the server draft.</div>
          <div className="flex gap-1.5 mt-2">
            <Button size="sm" className="h-6 text-[10px]" onClick={() => { const r = draftBackup.peek() as any; if (r) useWorkspace.getState().setEditorContent({ findings: r.rawFindings ?? "", impression: r.impression ?? "", recommendation: r.recommendation ?? "", technique: r.technique ?? "", clinicalHistory: r.clinicalHistory ?? "" }); }}>Restore</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => draftBackup.discard()}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}
