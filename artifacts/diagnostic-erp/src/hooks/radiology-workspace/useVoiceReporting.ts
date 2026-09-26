/**
 * Voice session + V-04 catalog-match adapter for RadiologyReportingWorkspace.
 * Phase 2 extraction — A2 (structuredFindings) + A1 pending-preview preserved.
 */

import {
  useCallback, useMemo, useRef, useState,
  type Dispatch, type MutableRefObject, type RefObject, type SetStateAction,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useVoiceSession, type VoiceExecutionResult } from "@/hooks/useVoiceSession";
import {
  parseVoiceSettings, parseVoiceUserPrefs, mergeVoiceSettings,
  fetchTranscribeCapabilities, type TranscribeCapabilities, type VoiceSettings,
} from "@/lib/voiceTranscription";
import {
  normalizeDictationText, describeIntent,
  type ParsedVoiceCommand, type ViewerOp,
} from "@/lib/voiceCommandGrammar";
import {
  matchQuickFindingBySpokenTerm,
  resolveQuickFindingFromSpeech,
} from "@/lib/resolveQuickFindingFromSpeech";
import { trackWorkspaceEvent } from "@/lib/reportingTelemetry";
import { matchStudyCombination, buildCombination, combinationInserts } from "@/lib/studyCombinations";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import type { LegacyBoxTab } from "@/components/radiology/LegacyBox";
import type { DispatchResult } from "@/lib/workspaceCommands";

export type UseVoiceReportingOptions = {
  studyId: number | undefined;
  allowEditSigned: boolean;
  useStructured: boolean;
  isFinalized: boolean;
  studyLockStatus: string;
  worklistStatus: string | null | undefined;
  focusReportField: (field: "findings" | "impression" | "technique" | "clinicalHistory" | "recommendation") => void;
  embeddedViewerRef: RefObject<EmbeddedViewerHandle | null>;
  rightPanelRef: RefObject<ImperativePanelHandle | null>;
  commandDispatcherRef: MutableRefObject<{ dispatch: (cmd: string) => DispatchResult } | null>;
  canVerifyRef: MutableRefObject<boolean>;
  openLegacyTabRef: MutableRefObject<(tab: LegacyBoxTab) => void>;
  /** Shared with Quick Select UI — templates loaded by the workspace. */
  quickFindingTemplatesRef: MutableRefObject<QuickFinding[]>;
  selectedQuickIdsRef: MutableRefObject<Set<number>>;
  handleQuickToggleRef: MutableRefObject<(finding: QuickFinding, nowSelected: boolean) => void>;
};

export function useVoiceReporting(opts: UseVoiceReportingOptions) {
  const {
    studyId, allowEditSigned, useStructured, isFinalized, studyLockStatus, worklistStatus,
    focusReportField, embeddedViewerRef, rightPanelRef, commandDispatcherRef, canVerifyRef,
    openLegacyTabRef, quickFindingTemplatesRef, selectedQuickIdsRef, handleQuickToggleRef,
  } = opts;

  const { data: pacsSettingsRows } = useQuery<Array<{ id: number; key: string; value: string | null; category: string }>>({
    queryKey: ["pacs-settings"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
    staleTime: 5 * 60_000,
  });
  const clinicVoiceSettings = useMemo(() => parseVoiceSettings(pacsSettingsRows), [pacsSettingsRows]);
  const autoCollapseQueueOnStudyOpen = useMemo(() => {
    const row = pacsSettingsRows?.find((r) => r.key === "auto_collapse_queue_on_study_open");
    if (!row || row.value == null || String(row.value).trim() === "") return true;
    const v = String(row.value).trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }, [pacsSettingsRows]);

  const { data: voiceUserPrefsRaw } = useQuery<unknown>({
    queryKey: ["voice-user-preferences"],
    queryFn: () => api.get("/api/radiology/report-generator/voice-preferences"),
    enabled: clinicVoiceSettings.enabled,
    staleTime: 5 * 60_000,
  });
  const voiceSettings: VoiceSettings = useMemo(
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
  const voiceParkReasonRef = useRef<string | null>(null);
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
      if (studyLockStatus === "locked-by-other") {
        return { ok: false, message: "Study is locked by another user — read-only" };
      }
      const text = normalizeDictationText(intent.text, { autoPunctuation: voiceSettings.autoPunctuation });
      if (!text) return { ok: false, message: "Nothing to insert" };
      const mode = intent.mode;
      const voiceSource = "radiologist-voice" as const;
      if (intent.target === "findings") {
        if (mode === "append") {
          const catalog = quickFindingTemplatesRef.current;
          const resolved = resolveQuickFindingFromSpeech(text, catalog);
          if (resolved.status === "ambiguous") {
            return {
              ok: false,
              message: `Multiple findings match “${resolved.matchedVia}”: ${resolved.candidates.slice(0, 3).map((c) => c.label).join(" · ")} — say the full name`,
            };
          }
          if (resolved.status === "matches") {
            const applied: QuickFinding[] = [];
            for (const hit of resolved.findings) {
              const f = catalog.find((c) => c.id === hit.finding.id);
              if (!f) continue;
              if (!selectedQuickIdsRef.current.has(f.id)) {
                handleQuickToggleRef.current(f, true);
                applied.push(f);
              }
            }
            if (applied.length > 0) {
              trackWorkspaceEvent({
                type: "voice_catalog_apply",
                studyId: studyId ?? null,
                meta: { count: applied.length, labels: applied.map((a) => a.label).join("|") },
              });
              return {
                ok: true,
                message: `Applied ${applied.map((a) => a.label).join(" · ")}`,
                undo: () => {
                  for (const f of applied) handleQuickToggleRef.current(f, false);
                },
                undoLabel: "voice catalog findings",
              };
            }
          }
        }
        const prev = state.findingsText;
        if (mode === "replace") state.replaceField("findings", text, voiceSource);
        else state.mergeField("findings", text, voiceSource);
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} findings`,
          undo: () => useWorkspace.getState().setField("findings", prev),
          undoLabel: "findings edit",
        };
      }
      if (intent.target === "impression") {
        const prev = state.impressionText;
        if (mode === "replace") state.replaceField("impression", text, voiceSource);
        else state.mergeField("impression", text, voiceSource);
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} impression`,
          undo: () => useWorkspace.getState().setField("impression", prev),
          undoLabel: "impression edit",
        };
      }
      if (intent.target === "recommendation") {
        const prev = state.recommendationText;
        if (mode === "replace") state.replaceField("recommendation", text, voiceSource);
        else state.mergeField("recommendation", text, voiceSource);
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} recommendation`,
          undo: () => useWorkspace.getState().setField("recommendation", prev),
          undoLabel: "recommendation edit",
        };
      }
      if (intent.target === "technique") {
        const prev = state.techniqueText;
        if (mode === "replace") state.replaceField("technique", text, voiceSource);
        else state.mergeField("technique", text, voiceSource);
        return {
          ok: true,
          message: `${mode === "replace" ? "Replaced" : "Appended to"} technique`,
          undo: () => useWorkspace.getState().setField("technique", prev),
          undoLabel: "technique edit",
        };
      }
      const prev = state.clinicalHistoryText;
      if (mode === "replace") state.replaceField("clinicalHistory", text, voiceSource);
      else state.mergeField("clinicalHistory", text, voiceSource);
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
      const selected = selectedQuickIdsRef.current;
      const pool = intent.action === "remove" ? templates.filter((f) => selected.has(f.id)) : templates;
      const matched = matchQuickFindingBySpokenTerm(intent.term, templates, { pool });
      if (matched.status === "zero-match") {
        return {
          ok: false,
          message: intent.action === "remove"
            ? `No selected finding matches “${intent.term}”`
            : `No quick finding matches “${intent.term}”`,
        };
      }
      if (matched.status === "ambiguous") {
        return {
          ok: false,
          message: `Multiple findings match “${intent.term}”: ${matched.candidates.slice(0, 3).map((f) => f.label).join(" · ")} — say the full name`,
        };
      }
      const f = templates.find((t) => t.id === matched.finding.id);
      if (!f) return { ok: false, message: `No quick finding matches “${intent.term}”` };
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
  }, [
    voiceSettings.autoPunctuation, focusReportField, allowEditSigned, studyLockStatus, studyId,
    quickFindingTemplatesRef, selectedQuickIdsRef, handleQuickToggleRef,
    commandDispatcherRef, embeddedViewerRef, openLegacyTabRef, rightPanelRef,
  ]);

  const voiceSession = useVoiceSession({
    studyId: studyId ?? undefined,
    settings: voiceSettings,
    capabilities: voiceCapabilities,
    getContext: () => ({
      studyId: studyId ?? null,
      dirty: useWorkspace.getState().isDirty,
      isLocked: studyLockStatus === "locked-by-other" || isFinalized
        || (worklistStatus === "REPORT_FINAL" && !allowEditSigned),
      lockedByOther: studyLockStatus === "locked-by-other",
      lockLost: studyLockStatus === "expired-lost" || studyLockStatus === "connection-lost",
      canVerify: canVerifyRef.current,
      structuredFindings: useStructured,
      requiresCatalogConfirm: (text) => {
        const r = resolveQuickFindingFromSpeech(text, quickFindingTemplatesRef.current);
        return r.status === "matches" || r.status === "ambiguous";
      },
      viewerAvailable: embeddedViewerRef.current != null,
      confirmationPolicy: voiceSettings.confirmationPolicy,
    }),
    execute: executeVoiceCommand,
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

  return {
    pacsSettingsRows,
    autoCollapseQueueOnStudyOpen,
    voiceSettings,
    voiceCapabilities,
    voiceSession,
    focusVoiceBar,
    qsExternalSearch,
    setQsExternalSearch: setQsExternalSearch as Dispatch<SetStateAction<{ seq: number; term: string } | null>>,
    voiceParkReasonRef,
    voiceComposerComposeRef,
    executeVoiceCommand,
  };
}
