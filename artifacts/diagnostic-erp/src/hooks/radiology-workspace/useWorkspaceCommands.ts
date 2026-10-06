/**
 * Command dispatcher + global keyboard shortcuts for RadiologyReportingWorkspace.
 * Phase 4 extraction — behavior unchanged.
 *
 * Keyboard precedence (single keydown chain):
 *   voiceKeyAction FIRST → Ctrl+Shift+Enter → shortcut matrix →
 *   Ctrl+K / Alt+U / Ctrl+Shift+Z / Ctrl+I / Ctrl+Shift+V / '?' / Alt+1..9
 *
 * Voice PTT/confirm/cancel keys moved here from useVoiceReporting to avoid
 * double-mounted listeners. onKeyUp PTT space stop lives in the same effect.
 */

import {
  useCallback, useEffect, useMemo,
  type Dispatch, type MutableRefObject, type RefObject, type SetStateAction,
} from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { createCommandDispatcher, type DispatchResult } from "@/lib/workspaceCommands";
import { matchWorkspaceShortcut } from "@/lib/workspaceReportState";
import { resolveWorkspaceShortcut } from "@/lib/workspaceShortcutResolve";
import {
  saveAndNextFieldsReady,
  shouldHandleAltUndoAbnormal,
  shouldHandleFinalizeShortcut,
  isAiInstructionTextarea,
} from "@/lib/reportingWorkspaceShortcuts";
import { voiceKeyAction } from "@/lib/voiceSessionState";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { sectionForAltDigit, type ReportSectionId } from "@/lib/reportSectionAccordion";
import type { QuickInsertSource, ReportingToolsTab } from "@/components/radiology/ReportingToolsPanel";
import type { WorkspaceLayoutMode } from "@/lib/workspaceLayoutPrefs";
import type { VoiceSettings } from "@/lib/voiceTranscription";

export type UseWorkspaceCommandsOptions = {
  commandDispatcherRef: MutableRefObject<{ dispatch: (cmd: string) => DispatchResult } | null>;
  saveDraft: (opts?: { silent?: boolean }) => Promise<unknown>;
  finalizeReport: () => void | Promise<void>;
  workflow: {
    park?: (studyId: number, reason: string) => void;
    unpark: (studyId: number) => void;
    refreshQueue: () => void;
  };
  studyId: number | undefined;
  goNextStudy: () => void;
  goPrevStudy: () => void;
  focusReportField: (field: "findings" | "impression" | "technique" | "clinicalHistory" | "recommendation") => void;
  enterReportingFocusMode: () => void;
  setLayoutMode: (mode: WorkspaceLayoutMode, opts?: { reenableAutoFocus?: boolean }) => void;
  openReportingToolsRef: MutableRefObject<(tab: ReportingToolsTab, source?: QuickInsertSource) => void>;
  verifyActionRef: MutableRefObject<(() => void) | null>;
  rightPanelRef: RefObject<ImperativePanelHandle | null>;
  leftPanelRef: RefObject<ImperativePanelHandle | null>;
  contentLocked: boolean;
  toast: ReturnType<typeof import("@/hooks/use-toast").useToast>["toast"];
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  showEmbeddedViewer: boolean;
  setReportingToolsTab: Dispatch<SetStateAction<ReportingToolsTab>>;
  voiceSession: {
    enabled: boolean;
    capturing: boolean;
    captureTrigger: "ptt" | "toggle" | null;
    pending: {
      verdict: { confirmViaEnterAllowed: boolean };
    } | null;
    setMode: (mode: "command" | "dictation") => void;
    startListening: (trigger: "ptt" | "toggle") => void;
    stopListening: () => void;
    toggleListening: () => void;
    confirmPending: (via: "click" | "enter" | "voice") => void;
    cancel: () => void;
  };
  voiceSettings: Pick<VoiceSettings, "pttKey">;
  focusVoiceBar: () => void;
  handleUndoLastAbnormal: () => void;
  activateReportSection: (section: ReportSectionId) => void;
  exclusiveReportSectionsRef: MutableRefObject<boolean>;
  enterReportingFocusModeRef: MutableRefObject<() => void>;
  triggerAiImpression: () => void;
  setShortcutHelpOpen: Dispatch<SetStateAction<boolean>>;
};

export function useWorkspaceCommands(opts: UseWorkspaceCommandsOptions) {
  const {
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
  } = opts;

  // ─── Command dispatcher (single choke point for keyboard/voice/palette) ────
  const commandDispatcher = useMemo(() => createCommandDispatcher({
    save: async () => { await saveDraft(); },
    finalize: finalizeReport,
    next: () => { goNextStudy(); },
    previous: () => { goPrevStudy(); },
    park: () => { if (studyId) { (workflow as { park?: (id: number, reason: string) => void }).park?.(studyId, ""); } },
    refresh: () => workflow.refreshQueue(),
    "open-viewer": () => { setLayoutMode("split", { reenableAutoFocus: true }); },
    "focus-quick-search": () => { openReportingToolsRef.current("quick-insert", "quick-add"); },
    verify: () => { verifyActionRef.current?.(); },
    unpark: () => { if (studyId) { workflow.unpark(studyId); } },
    "reload-current": () => window.location.reload(),
    "focus-findings": () => { focusReportField("findings"); },
    "focus-impression": () => { focusReportField("impression"); },
    "close-panel": () => { rightPanelRef.current?.collapse(); },
    "focus-mode": () => { enterReportingFocusMode(); },
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`select-template-${n}`, () => openReportingToolsRef.current("templates")])),
  }), [saveDraft, finalizeReport, workflow, studyId, goNextStudy, goPrevStudy, focusReportField, enterReportingFocusMode, setLayoutMode, openReportingToolsRef, verifyActionRef, rightPanelRef]);
  commandDispatcherRef.current = commandDispatcher;

  const handleFrictionlessSaveAndNext = useCallback(async () => {
    if (contentLocked || useWorkspace.getState().isFinalizing) return;
    await saveDraft({ silent: true });
    const live = readWorkspaceClinicalTexts();
    if (!saveAndNextFieldsReady({ findings: live.findingsText, impression: live.impressionText })) {
      toast({ title: "Please complete findings/impression before Save & Next" });
      return;
    }
    await finalizeReport();
  }, [contentLocked, saveDraft, finalizeReport, toast]);

  // ─── Global keyboard shortcuts (voice PTT/confirm consolidated here) ─
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Voice keys FIRST (was capture:true in useVoiceReporting).
      const voiceAction = voiceKeyAction(
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
      if (voiceAction) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (voiceAction === "toggle-listen") voiceSession.toggleListening();
        else if (voiceAction === "ptt-start") voiceSession.startListening("ptt");
        else if (voiceAction === "confirm-pending") voiceSession.confirmPending("enter");
        else voiceSession.cancel();
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        void handleFrictionlessSaveAndNext();
        return;
      }

      // Route workflow commands through the dispatcher (shortcut ID → command ID).
      const shortcut = matchWorkspaceShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
      });
      const resolved = resolveWorkspaceShortcut(shortcut);
      if (resolved?.kind === "layout") {
        e.preventDefault();
        if (resolved.action === "toggle-left-panel") {
          leftCollapsed ? leftPanelRef.current?.expand() : leftPanelRef.current?.collapse();
        } else if (resolved.action === "toggle-right-panel") {
          if (rightCollapsed) {
            rightPanelRef.current?.expand();
            setReportingToolsTab((t) => t ?? "quick-insert");
          } else {
            rightPanelRef.current?.collapse();
          }
        } else if (resolved.action === "toggle-viewer") {
          setLayoutMode(showEmbeddedViewer ? "reportFocus" : "split", { reenableAutoFocus: true });
        } else if (resolved.action === "escape") {
          rightPanelRef.current?.collapse();
        }
        return;
      }
      if (resolved?.kind === "command") {
        // Comfort polish (#678): Ctrl+Enter finalize must not fire in AI instruction
        // textarea; that field owns Ctrl+Enter to Run.
        if (resolved.command === "finalize" && !shouldHandleFinalizeShortcut(e)) {
          return;
        }
        if (isAiInstructionTextarea(e.target)) {
          return;
        }
        e.preventDefault();
        commandDispatcher.dispatch(resolved.command);
        return;
      }

      // New features shortcuts (not part of the workflow shortcut matrix)
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        useWorkspace.getState().toggleCommandPalette();
        return;
      }
      if (shouldHandleAltUndoAbnormal(e)) {
        e.preventDefault();
        handleUndoLastAbnormal();
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        const ws = useWorkspace.getState();
        // Read the frame BEFORE the pop: `undoLastPatch` returns a plain boolean
        // (24 existing tests assert `.toBe(true)`, so widening it to a union
        // would silently invert every one of them — `"empty"` is truthy). The
        // frame stays on the stack when refused, so its `activeStudyId` is still
        // readable afterwards, but capturing it here keeps the two facts that
        // decide the message from being read at different times.
        const topFrame = ws.patchUndoStack[ws.patchUndoStack.length - 1] ?? null;
        const undone = ws.undoLastPatch();
        if (!undone && topFrame && topFrame.activeStudyId !== ws.activeStudyId) {
          // The store refused to restore a frame captured against another study.
          // Silent refusal here would leave the radiologist pressing Ctrl+Shift+Z
          // repeatedly on a report that had already changed under them.
          // `pushNotification` is deliberately NOT used: its only consumer
          // renders `kind === "interrupt"` as a red card headed "Critical finding
          // detected", and `kind: "ledger"` / `"edge-glow"` render nowhere.
          toast({
            title: "Undo refused — that edit belongs to a different study",
            description:
              "The workspace switched study since that edit was made, so restoring it would have written the previous patient's report text into this one. Nothing was changed.",
            variant: "destructive",
            duration: 8000,
          });
        } else if (!undone && topFrame && ws.isFinalized) {
          // Same reasoning as the cross-study branch: the store refused and the
          // frame is still there, so without this the shortcut does nothing at all
          // and the radiologist keeps pressing it.
          //
          // This branch used to stop at "cannot be edited", because at the time
          // there was no way back from the app and naming one would have been a
          // false promise. There is one now: Report Hub's Withdraw button calls
          // POST /api/patient-reports/:id/withdraw-signature, which nulls the
          // signature, puts the report back to "draft", sets the bound worklist
          // row to REPORT_IN_PROGRESS and clears its reportId and deliveryStatus
          // (patient-reports.ts:2838-2970). assertDraftWritable refuses on
          // REPORT_FINAL || DELIVERED || reportId (radiologyIdentity.ts:291), so
          // all three of its conditions go with the signature and the study
          // really is editable again — the loop closes rather than being
          // gestured at. The message still does not offer amend or unlock: amend
          // needs a signed structured document this clinic never produces, and
          // there is no unlock affordance anywhere.
          toast({
            title: "Undo refused — the report is signed",
            description:
              "Nothing was changed. To correct it, withdraw the signature from Report Hub — only the signer or an administrator can. The report returns to draft and the study can be edited and signed again.",
            variant: "destructive",
            duration: 8000,
          });
        }
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
      // Alt+1…9 jump to a major report section. Skip while typing so Option+digit
      // on Mac (¡™£¢∞§¶•ª) and other Alt combos in editors still produce text.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
        const target = sectionForAltDigit(e.key);
        if (target) {
          e.preventDefault();
          activateReportSection(target);
          if (exclusiveReportSectionsRef.current) {
            enterReportingFocusModeRef.current();
          }
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && voiceSession.captureTrigger === "ptt") {
        voiceSession.stopListening();
      }
    };
    // capture:true so voice keys keep prior Phase-2 precedence vs other listeners
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [
    commandDispatcher, leftCollapsed, rightCollapsed, showEmbeddedViewer, setLayoutMode,
    voiceSession, voiceSettings.pttKey, focusVoiceBar, handleUndoLastAbnormal, activateReportSection,
    handleFrictionlessSaveAndNext,
    leftPanelRef, rightPanelRef, setReportingToolsTab,
    exclusiveReportSectionsRef, enterReportingFocusModeRef,
    // Preserve prior page deps: triggerAiImpression / setShortcutHelpOpen intentionally omitted
    // (same stale-closure behavior as pre-Phase-4 page effect).
  ]);

  return { commandDispatcher, handleFrictionlessSaveAndNext };
}
