/**
 * Panel layout / focus modes for RadiologyReportingWorkspace.
 * Phase 2 extraction — behavior unchanged.
 */

import {
  useCallback, useEffect, useRef, useState,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import {
  loadWorkspaceLayoutPrefs, saveWorkspaceLayoutPrefs,
  shouldShowEmbeddedViewer, resolveLayoutModeForModality, withModalityLayoutMode,
  resolveViewerReportPcts, clampLeftPct, clampReportPct, clampViewerPct,
  defaultModeState,
  LEFT_COLLAPSED_PCT,
  RIGHT_COLLAPSED_PCT,
  VIEWER_MIN_PCT,
  type WorkspaceLayoutMode,
  type WorkspaceLayoutPrefs,
} from "@/lib/workspaceLayoutPrefs";
import {
  isNarrowReportingViewport,
  outerPanelPercents,
  isPhoneReportingViewport,
  shouldApplyAutomaticPaneFocus,
  shouldHandBackUnpromptedViewerFocus,
  shouldUseCompactAccordion,
  shouldUseContinuousPrimarySections,
  shouldUseExclusiveReportSections,
  markPaneManualOverride,
  clearPaneManualOverride,
  VIEWER_FOCUS_HANDBACKS_PER_SESSION,
  VIEWER_FOCUS_TYPING_WINDOW_MS,
  type PaneManualOverrideState,
  type ReportingPaneBias,
} from "@/lib/reportingPaneFocus";

export type UseWorkspaceLayoutOptions = {
  myUserId: number | null;
  studyId: number | undefined;
  modality: string | null | undefined;
  viewportWidthPx: number;
  viewportHeightPx: number;
  enterReportingFocusModeRef: MutableRefObject<() => void>;
  enterClinicalEditorFocusRef: MutableRefObject<() => void>;
  exclusiveReportSectionsRef: MutableRefObject<boolean>;
};

export function useWorkspaceLayout(opts: UseWorkspaceLayoutOptions) {
  const {
    myUserId, studyId, modality, viewportWidthPx, viewportHeightPx,
    enterReportingFocusModeRef, enterClinicalEditorFocusRef, exclusiveReportSectionsRef,
  } = opts;

  const embeddedViewerRef = useRef<EmbeddedViewerHandle>(null);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const templatePanelRef = useRef<ImperativePanelHandle>(null);
  const viewerPanelRef = useRef<ImperativePanelHandle>(null);
  const reportPanelRef = useRef<ImperativePanelHandle>(null);
  const paneManualOverrideRef = useRef<PaneManualOverrideState>({});
  const paneFocusApplyingRef = useRef(false);
  const suppressNextModeSizeApplyRef = useRef(false);

  const [viewerColumnExpanded, setViewerColumnExpanded] = useState(false);
  const [reportImagesOpen, setReportImagesOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [keyImageFilterObsId, setKeyImageFilterObsId] = useState<string | null>(null);
  const [viewerFocusMode, setViewerFocusMode] = useState(false);
  const viewerFocusRef = useRef(false);

  const [layoutPrefs, setLayoutPrefs] = useState<WorkspaceLayoutPrefs>(() =>
    loadWorkspaceLayoutPrefs(myUserId),
  );
  const layoutMode = layoutPrefs.mode;
  const showEmbeddedViewer = shouldShowEmbeddedViewer(layoutMode);
  const exclusiveReportSections = shouldUseExclusiveReportSections({
    viewportWidthPx,
    layoutMode,
  });
  // FEW-CLICKS (pass 2): the wide-desktop Findings+Impression cockpit — see
  // shouldUseContinuousPrimarySections for the gate rationale. Exclusive mode
  // stays on for every viewport; this ADDS both primary bodies on big screens.
  const continuousPrimarySections = shouldUseContinuousPrimarySections({
    viewportWidthPx,
    viewportHeightPx,
    layoutMode,
  });
  const compactAccordion = shouldUseCompactAccordion({
    viewportWidthPx,
    layoutMode,
  });

  const setLayoutMode = useCallback((
    mode: WorkspaceLayoutMode,
    opts?: { reenableAutoFocus?: boolean },
  ) => {
    if (opts?.reenableAutoFocus) {
      paneManualOverrideRef.current = clearPaneManualOverride(
        paneManualOverrideRef.current,
        mode,
      );
    }
    setLayoutPrefs((prev) => {
      const next = withModalityLayoutMode(prev, modality ?? null, mode);
      saveWorkspaceLayoutPrefs(myUserId, next);
      return next;
    });
    if (mode === "reportFocus") setViewerColumnExpanded(false);
  }, [myUserId, modality]);

  useEffect(() => {
    if (!studyId) return;
    setLayoutPrefs((prev) => {
      const preferred = resolveLayoutModeForModality(prev, modality ?? null);
      if (preferred === prev.mode) return prev;
      return { ...prev, mode: preferred };
    });
  }, [studyId, modality]);

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

  const applyPaneFocusSplit = useCallback((bias: ReportingPaneBias) => {
    if (!showEmbeddedViewer) return;
    if (paneFocusApplyingRef.current) return;
    const pct = outerPanelPercents({
      bias,
      queueCollapsed: true,
      narrow: isNarrowReportingViewport(viewportWidthPx),
      phone: isPhoneReportingViewport(viewportWidthPx),
    });
    paneFocusApplyingRef.current = true;
    leftPanelRef.current?.collapse();
    // §4 — the Reporting Tools rail is NOT collapsed here. This path used to shut
    // it on every focus of the clinical editor, which measured (1500x950, MRI LS
    // Spine) as 64 visible Quick Select tiles → 0, so each box the radiologist
    // wanted cost a second click on `right-panel-expand`. The rail is his to
    // close; the queue and the template drawer are chrome this mode exists to
    // clear away.
    templatePanelRef.current?.collapse();
    suppressNextModeSizeApplyRef.current = true;
    // …and the width it used to hand back to the editor is taken from the viewer
    // instead, so keeping the rail open does not narrow what he is typing into.
    // Measured at 1500x950: rail open + no compensation = 530px Findings editor,
    // the collapsed-rail figure was 822px. `getSize()` is the rail's live share of
    // its own group, so a dragged-wide rail is compensated by what it actually
    // costs, and a collapsed rail (3%) asks for nothing.
    const railShare = rightCollapsed ? 0 : Math.max(0, Math.round(rightPanelRef.current?.getSize() ?? 0) - RIGHT_COLLAPSED_PCT);
    requestAnimationFrame(() => {
      try {
        // The pair still sums to the group: what the report gains, the viewer
        // gives, and never below the viewer's own minimum.
        viewerPanelRef.current?.resize(Math.max(VIEWER_MIN_PCT, pct.viewer - railShare));
        reportPanelRef.current?.resize(Math.min(100 - VIEWER_MIN_PCT, pct.report + railShare));
      } finally {
        paneFocusApplyingRef.current = false;
      }
    });
  }, [showEmbeddedViewer, viewportWidthPx, rightCollapsed]);

  const applySavedModePanelSizes = useCallback((mode: WorkspaceLayoutMode) => {
    if (paneFocusApplyingRef.current) return;
    const state = layoutPrefs.byMode[mode] ?? layoutPrefs.byMode.split;
    paneFocusApplyingRef.current = true;
    if (state.leftCollapsed) leftPanelRef.current?.collapse();
    else {
      leftPanelRef.current?.expand();
      leftPanelRef.current?.resize(clampLeftPct(state.left));
    }
    if (state.rightCollapsed) rightPanelRef.current?.collapse();
    else {
      rightPanelRef.current?.expand();
      rightPanelRef.current?.resize(state.right);
    }
    requestAnimationFrame(() => {
      try {
        if (!shouldShowEmbeddedViewer(mode)) {
          reportPanelRef.current?.resize(resolveViewerReportPcts(mode, state).reportPct);
          return;
        }
        const { viewerPct, reportPct } = resolveViewerReportPcts(mode, state);
        viewerPanelRef.current?.resize(viewerPct);
        reportPanelRef.current?.resize(reportPct);
      } finally {
        paneFocusApplyingRef.current = false;
      }
    });
  }, [layoutPrefs.byMode]);

  /**
   * §4 — keeping the rail open must not cost the editor its width.
   *
   * Measured at 1500x950 on MRI LS Spine: with the rail open, the reading queue
   * collapsing for reporting focus moved the Findings box 539 → 602 px, while the
   * old behaviour (rail collapsed by the same click) gave 822 px. So the rail's
   * share is taken back out of the viewer, which is the panel reporting focus
   * exists to make room past — and only when the automatic pane split, which
   * already trades viewer for report, is not going to run.
   *
   * Nothing is stored: `autoFocusPersistsByModeSizes` says an automatic focus must
   * not write remembered sizes, and `paneFocusApplyingRef` keeps this resize from
   * being read back as a manual drag.
   */
  const giveReportTheRailWidth = useCallback(() => {
    if (rightCollapsed || !showEmbeddedViewer) return;
    const railShare = Math.max(
      0,
      Math.round(rightPanelRef.current?.getSize() ?? 0) - RIGHT_COLLAPSED_PCT,
    );
    if (railShare <= 0) return;
    const viewerSize = Math.round(viewerPanelRef.current?.getSize() ?? 0);
    const reportSize = Math.round(reportPanelRef.current?.getSize() ?? 0);
    if (viewerSize <= 0 || reportSize <= 0) return;
    // The viewer keeps its own minimum; whatever is left of the rail's share
    // simply is not taken.
    const taken = Math.min(railShare, Math.max(0, viewerSize - VIEWER_MIN_PCT));
    if (taken <= 0) return;
    paneFocusApplyingRef.current = true;
    requestAnimationFrame(() => {
      try {
        viewerPanelRef.current?.resize(viewerSize - taken);
        reportPanelRef.current?.resize(reportSize + taken);
      } finally {
        paneFocusApplyingRef.current = false;
      }
    });
  }, [rightCollapsed, showEmbeddedViewer]);

  const enterReportingFocusMode = useCallback(() => {
    leftPanelRef.current?.collapse();
    // §4 — the rail is not collapsed here either. Reporting focus means "get the
    // queue and the template drawer out of the way of the report", not "take the
    // Quick Select boxes away from the person writing it". The rail keeps
    // whatever state the radiologist left it in.
    templatePanelRef.current?.collapse();
    setViewerFocus(true);
    if (!shouldShowEmbeddedViewer(layoutMode)) setLayoutMode("split");
    else if (layoutMode === "viewerFocus") setLayoutMode("split");
    if (
      showEmbeddedViewer &&
      shouldApplyAutomaticPaneFocus({
        constrained: exclusiveReportSections,
        mode: "split",
        manualOverride: paneManualOverrideRef.current,
      })
    ) {
      applyPaneFocusSplit("reporting");
    } else {
      giveReportTheRailWidth();
    }
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
  }, [
    layoutMode, setLayoutMode, setViewerFocus, showEmbeddedViewer,
    exclusiveReportSections, applyPaneFocusSplit, giveReportTheRailWidth,
  ]);
  enterReportingFocusModeRef.current = enterReportingFocusMode;
  exclusiveReportSectionsRef.current = exclusiveReportSections;

  const enterClinicalEditorFocus = useCallback(() => {
    enterReportingFocusMode();
    if (!showEmbeddedViewer) return;
    if (
      !shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: layoutMode === "viewerFocus" ? "viewerFocus" : "split",
        manualOverride: paneManualOverrideRef.current,
      })
    ) {
      return;
    }
    if (layoutMode === "viewerFocus") setLayoutMode("split");
    applyPaneFocusSplit("reporting");
  }, [
    enterReportingFocusMode, showEmbeddedViewer, layoutMode,
    setLayoutMode, applyPaneFocusSplit,
  ]);
  enterClinicalEditorFocusRef.current = enterClinicalEditorFocus;

  const enterViewerPaneFocus = useCallback(() => {
    if (!showEmbeddedViewer) return;
    if (layoutMode !== "viewerFocus") setLayoutMode("viewerFocus");
    setViewerFocus(true);
    leftPanelRef.current?.collapse();
    if (
      shouldApplyAutomaticPaneFocus({
        constrained: exclusiveReportSections,
        mode: "viewerFocus",
        manualOverride: paneManualOverrideRef.current,
      })
    ) {
      applyPaneFocusSplit("viewer");
    } else {
      applySavedModePanelSizes("viewerFocus");
    }
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
  }, [
    showEmbeddedViewer, layoutMode, setLayoutMode, setViewerFocus,
    exclusiveReportSections, applyPaneFocusSplit, applySavedModePanelSizes,
  ]);

  useEffect(() => {
    if (suppressNextModeSizeApplyRef.current) {
      suppressNextModeSizeApplyRef.current = false;
      return;
    }
    if (paneFocusApplyingRef.current) return;
    applySavedModePanelSizes(layoutMode);
  }, [layoutMode, applySavedModePanelSizes]);

  const handleOuterPanelLayout = useCallback((sizes: number[]) => {
    if (paneFocusApplyingRef.current) return;
    paneManualOverrideRef.current = markPaneManualOverride(
      paneManualOverrideRef.current,
      layoutMode,
    );
    setLayoutPrefs((prev) => {
      const mode = prev.mode;
      const cur = prev.byMode[mode];
      const nextState = { ...cur };
      if (shouldShowEmbeddedViewer(mode) && sizes.length >= 3) {
        const [queueSize, viewerSize, reportSize] = sizes;
        if (typeof queueSize === "number") {
          nextState.leftCollapsed = queueSize <= LEFT_COLLAPSED_PCT + 1;
          if (!nextState.leftCollapsed) nextState.left = clampLeftPct(queueSize);
        }
        if (typeof viewerSize === "number") nextState.viewerPct = clampViewerPct(viewerSize);
        if (typeof reportSize === "number") nextState.reportPct = clampReportPct(reportSize);
      } else if (sizes.length >= 2) {
        const [queueSize, reportSize] = sizes;
        if (typeof queueSize === "number") {
          nextState.leftCollapsed = queueSize <= LEFT_COLLAPSED_PCT + 1;
          if (!nextState.leftCollapsed) nextState.left = clampLeftPct(queueSize);
        }
        if (typeof reportSize === "number") nextState.reportPct = clampReportPct(reportSize);
        nextState.viewerPct = 0;
      } else {
        return prev;
      }
      if (
        nextState.left === cur.left &&
        nextState.leftCollapsed === cur.leftCollapsed &&
        nextState.viewerPct === cur.viewerPct &&
        nextState.reportPct === cur.reportPct
      ) {
        return prev;
      }
      const next = { ...prev, byMode: { ...prev.byMode, [mode]: nextState } };
      saveWorkspaceLayoutPrefs(myUserId, next);
      return next;
    });
  }, [myUserId, layoutMode]);

  /**
   * §4 — the Reporting Tools rail (Quick Select, ledger, Copilot) is opened and
   * closed by the radiologist, and nothing else.
   *
   * `rightCollapsed` on its own is React state, so his choice died with the
   * workspace unmount and the next study started him back on the collapsed
   * "Tools" tab. The flag is therefore mirrored into the same per-mode preference
   * the panel sizes already use — the one `applySavedModePanelSizes` reads back —
   * so the rail comes up the way he left it. Mirroring the state rather than
   * wrapping the setters keeps every existing `onCollapse`/`onExpand` caller
   * unchanged, and a write of the value the preference already holds is a no-op,
   * so the preference-driven collapse above cannot feed itself.
   */
  const railCollapsedRememberedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (railCollapsedRememberedRef.current === rightCollapsed) return;
    railCollapsedRememberedRef.current = rightCollapsed;
    setLayoutPrefs((prev) => {
      const mode = prev.mode;
      const cur = prev.byMode[mode] ?? defaultModeState(mode);
      if (cur.rightCollapsed === rightCollapsed) return prev;
      const next: WorkspaceLayoutPrefs = {
        ...prev,
        byMode: { ...prev.byMode, [mode]: { ...cur, rightCollapsed } },
      };
      saveWorkspaceLayoutPrefs(myUserId, next);
      return next;
    });
  }, [rightCollapsed, myUserId]);

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

  // P4 — the caret the framed viewer takes, and the pane switch it does not.
  //
  // OHIF's document focuses its own viewport when it finishes booting. With the
  // viewer mounted that lands in the middle of a sentence: measured in the
  // browser, 100 consecutive characters typed into Findings delivered 46,
  // `document.activeElement` became `IFRAME#ohif-embed` and stayed there for the
  // rest of the run, and autosave then stored exactly those 46 — a silently
  // truncated report, with nothing on screen saying a thing. The pane-bias call
  // below is for the OTHER case, a radiologist who clicked into the viewer and
  // wants its keyboard bindings, and that route is unchanged.
  //
  // The two are told apart by what the parent document can actually observe. A
  // click inside a cross-origin frame delivers no pointer event here at all
  // (measured: only `focusout` on the editor, then `blur` on the window with the
  // frame as `activeElement`), so intent is read from the keystrokes: a frame
  // that takes focus while they are still arriving took it, one that takes focus
  // after he stopped typing was clicked. `shouldHandBackUnpromptedViewerFocus`
  // holds the rule and its budget.
  useEffect(() => {
    let editor: HTMLElement | null = null;
    let lastKeyAt = 0;
    let handbacksLeft = VIEWER_FOCUS_HANDBACKS_PER_SESSION;
    let watch: number | null = null;

    const onEditorKey = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT" && !t.isContentEditable) return;
      editor = t;
      lastKeyAt = performance.now();
    };

    const viewerFrameHoldsFocus = () => {
      const ae = document.activeElement;
      return ae instanceof HTMLIFrameElement && ae.getAttribute("data-testid") === "ohif-embed";
    };

    const onTakeover = (e: Event) => {
      // Only the two moves that can end in the frame: the window losing focus,
      // or a text field losing it. Every other focusout in the workspace (menus,
      // chips, buttons) would otherwise start a poll for something that cannot
      // happen, and the pane-bias route must keep answering a click into the
      // viewer made without ever leaving an editor.
      const leavedEditor = e instanceof FocusEvent
        && e.target instanceof HTMLElement
        && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.isContentEditable);
      if (e.type !== "blur" && !leavedEditor) return;
      if (watch !== null) return;
      // The parent's `focusout` lands while `activeElement` is still BODY — the
      // frame is not named until the window blur that follows it, so this waits
      // briefly for the answer instead of deciding on the first sample. Bounded
      // so a focus move that never reaches the viewer costs nothing.
      const startedAt = performance.now();
      const decide = () => {
        watch = null;
        if (!viewerFrameHoldsFocus()) return;
        if (
          !shouldHandBackUnpromptedViewerFocus({
            wasTyping: performance.now() - lastKeyAt <= VIEWER_FOCUS_TYPING_WINDOW_MS,
            editor: editor ? { connected: editor.isConnected } : null,
            handbacksLeft,
          })
        ) {
          enterViewerPaneFocus();
          return;
        }
        handbacksLeft -= 1;
        const back = editor;
        if (!back || !back.isConnected) return;
        back.focus({ preventScroll: true });
      };
      const poll = () => {
        if (viewerFrameHoldsFocus()) { decide(); return; }
        if (performance.now() - startedAt >= 300) { watch = null; return; }
        // 8ms, not the 30ms this shipped at: the character typed between the frame
        // taking focus and the hand-back is gone from the draft, and the measured
        // loss was exactly that one keystroke per takeover.
        watch = window.setTimeout(poll, 8);
      };
      poll();
    };

    document.addEventListener("keydown", onEditorKey, true);
    document.addEventListener("input", onEditorKey, true);
    document.addEventListener("focusout", onTakeover, true);
    window.addEventListener("blur", onTakeover);
    return () => {
      if (watch !== null) window.clearTimeout(watch);
      document.removeEventListener("keydown", onEditorKey, true);
      document.removeEventListener("input", onEditorKey, true);
      document.removeEventListener("focusout", onTakeover, true);
      window.removeEventListener("blur", onTakeover);
    };
  }, [enterViewerPaneFocus]);

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
    return () => {
      try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: false })); } catch { /* noop */ }
    };
  }, []);

  return {
    embeddedViewerRef,
    leftPanelRef,
    rightPanelRef,
    templatePanelRef,
    viewerPanelRef,
    reportPanelRef,
    paneManualOverrideRef,
    layoutPrefs,
    setLayoutPrefs: setLayoutPrefs as Dispatch<SetStateAction<WorkspaceLayoutPrefs>>,
    layoutMode,
    showEmbeddedViewer,
    exclusiveReportSections,
    continuousPrimarySections,
    compactAccordion,
    setLayoutMode,
    viewerColumnExpanded,
    setViewerColumnExpanded,
    reportImagesOpen,
    setReportImagesOpen,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    captureBusy,
    setCaptureBusy,
    keyImageFilterObsId,
    setKeyImageFilterObsId,
    viewerFocusMode,
    setViewerFocus,
    applyPaneFocusSplit,
    applySavedModePanelSizes,
    enterReportingFocusMode,
    enterClinicalEditorFocus,
    enterViewerPaneFocus,
    handleOuterPanelLayout,
  };
}
