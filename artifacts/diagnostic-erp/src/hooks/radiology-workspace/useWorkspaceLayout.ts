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
  isEmbeddedViewerFrame,
  isPhoneReportingViewport,
  isTypingEpisodeActive,
  shouldApplyAutomaticPaneFocus,
  shouldHandBackUnpromptedViewerFocus,
  shouldUseCompactAccordion,
  shouldUseContinuousPrimarySections,
  shouldUseExclusiveReportSections,
  markPaneManualOverride,
  clearPaneManualOverride,
  VIEWER_FOCUS_HANDBACKS_PER_EPISODE,
  viewerFocusHandbacksAfterKeystroke,
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
  // viewer mounted that lands in the middle of a sentence: measured in the browser,
  // 100 consecutive characters typed into Findings delivered 46,
  // `document.activeElement` became `IFRAME#ohif-embed` and stayed there for the
  // rest of the run, and autosave then stored exactly those 46 — a silently
  // truncated report, with nothing on screen saying a thing. The pane-bias call
  // below is for the OTHER case, a radiologist who clicked into the viewer and wants
  // its keyboard bindings, and that route is unchanged.
  //
  // The two are told apart by what the parent can observe: a frame that takes focus
  // while keystrokes are still arriving took it, one that takes focus after he
  // stopped typing was clicked. `shouldHandBackUnpromptedViewerFocus` holds that
  // rule and its budget.
  //
  // HOW the steal gets noticed is a separate problem, and the first answer was
  // wrong. It used to react to the editor losing focus and then poll for 300 ms.
  // Measured again 2026-11-07 (tmp/bs2-p4-focuslog.cjs 7 60 2000 mid — six runs,
  // three lost the rest of the sentence at 74, 65 and 66 characters of 100): the
  // frame re-asserts its viewport roughly every 35 ms, and on the third steal the
  // parent document reported NOTHING — no focusout, no window blur, so no watch was
  // ever armed and the remaining 34 characters went into the viewer. Chromium
  // delivers no focus event when a cross-origin iframe re-takes focus moments after
  // it was itself re-focused, so a rule that waits to be told cannot be relied on.
  //
  // `document.activeElement` is always readable, so a keystroke arms a guard that
  // reads it every 8 ms and tears itself down once the keystrokes stop. Same
  // decision, same pane-bias route, no dependence on an event that does not come.
  //
  // THE GUARD'S OWN LIFECYCLE IS PART OF THE DEFECT. `enterViewerPaneFocus` is
  // rebuilt whenever `layoutMode` changes — including by its own call — so an
  // effect that depends on it is torn down and re-created in the middle of a
  // sentence, losing the field it was protecting and the interval that was
  // watching. Measured 2026-11-07 with this dependency live: two of six runs
  // reached the refusal branch with `lastKeyAt` reset to 0 (so `wasTyping` was
  // false for a radiologist who was mid-keystroke) and lost 33 and 67 characters
  // without ever handing the focus back. The state therefore lives in a ref and the
  // listeners are bound once, on mount.
  //
  // A THIRD mechanism, found by instrumenting the run that lost 6 of 100: the same
  // steal also closed the Findings accordion. When the caret is in the viewer frame,
  // `sectionOwningFocus` reports no section, and the stale-Impression auto-reveal
  // reads that as "he left the report", so it opens Impression — measured
  // Findings 715x541 → 0x0 in the same sample as Impression 0x0 → 715x541, and the
  // Findings body is `display:none`, which blurs the editor and makes every later
  // hand-back focus nothing. Deferring that reveal for a caret the frame took
  // (reportSectionCollapsePrefs `viewerFrameHasCaret`, P0-P/P0-Q in
  // reportSectionCaretReveal.test.ts) took the same hostile-frame run from 6/100 to
  // 89/100 with the editor still open. What remains is the poll's own window: the
  // measured hand-back lands 9 ms after the steal, so a keystroke that falls inside
  // those 9 ms is still lost. Across 14 boot-race runs of the reported defect
  // (tmp/bs2-p4-focuslog.cjs 7 60 2000 end) 12 kept all 100 characters and 2 kept
  // 99, and every one of them ended with the caret back in the Findings editor.
  const caretGuardRef = useRef<{
    editor: HTMLElement | null;
    lastKeyAt: number;
    handbacksLeft: number;
    interval: number | null;
  }>({ editor: null, lastKeyAt: 0, handbacksLeft: VIEWER_FOCUS_HANDBACKS_PER_EPISODE, interval: null });
  const paneFocusFnRef = useRef(enterViewerPaneFocus);
  useEffect(() => { paneFocusFnRef.current = enterViewerPaneFocus; });

  useEffect(() => {
    const st = caretGuardRef.current;

    const viewerFrameHoldsFocus = () => isEmbeddedViewerFrame(document.activeElement);

    const stopGuard = () => {
      if (st.interval === null) return;
      window.clearInterval(st.interval);
      st.interval = null;
    };

    const handBackOrHandOver = () => {
      if (
        !shouldHandBackUnpromptedViewerFocus({
          wasTyping: isTypingEpisodeActive({ msSinceLastKeystroke: performance.now() - st.lastKeyAt }),
          editor: st.editor ? { connected: st.editor.isConnected } : null,
          handbacksLeft: st.handbacksLeft,
        })
      ) {
        // Either he stopped typing and the frame has the caret because he put it
        // there — the pane switch, which must keep working — or the frame is
        // winning and the fight ends here rather than at the caret. Measured
        // 2026-11-07 the yield costs pane width, not the sentence: the Findings
        // column went 715px → 396px with its body still on screen and its text
        // intact, and the `care:viewer-focus` event did not even fire, because
        // mounting the frame had already put the pane in viewer focus.
        stopGuard();
        paneFocusFnRef.current();
        return;
      }
      st.handbacksLeft -= 1;
      const back = st.editor;
      if (!back || !back.isConnected) { stopGuard(); return; }
      back.focus({ preventScroll: true });
    };

    const tick = () => {
      if (viewerFrameHoldsFocus()) { handBackOrHandOver(); return; }
      if (!isTypingEpisodeActive({ msSinceLastKeystroke: performance.now() - st.lastKeyAt })) stopGuard();
    };

    const onEditorKey = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT" && !t.isContentEditable) return;
      st.editor = t;
      st.lastKeyAt = performance.now();
      // A keystroke that reached the field says the last hand-back worked, so the
      // next steal is a new episode rather than the third one in a row.
      st.handbacksLeft = viewerFocusHandbacksAfterKeystroke({
        handbacksLeft: st.handbacksLeft, keystrokeReachedEditor: true,
      });
      // Detection latency is the whole point of this number, because the poll is
      // the only detector for the steals Chromium reports no event for. Paired on
      // the boot race 2026-11-07 (100 characters into Findings, viewer document
      // held 2 s, burst pace): 17 steals across 20 runs at 2 ms against 25 at 8 ms
      // (p=0.28) and the same 19/20 runs keeping every character in both arms — so
      // this is the mechanism's floor, not a measured gain. The loop exists only
      // for the duration of a typing episode, which is what bounds its cost.
      if (st.interval === null) st.interval = window.setInterval(tick, 2);
    };

    document.addEventListener("keydown", onEditorKey, true);
    document.addEventListener("input", onEditorKey, true);
    // Where Chromium does report the editor losing focus, acting inside that task
    // cannot cost the next keystroke anything, while the poll can cost a whole
    // interval. That is the reason it is wired; it is not a demonstrated gain. The
    // paired 20-run battery kept 19/20 sentences whole with and without it, and of
    // the 4 losses in 30 keystroke-accounted runs, 3 were a keydown that never
    // reached this document at all (the viewer's document received it) — including
    // one where the 1 ms caret sampler recorded no transition, so a clean sampler
    // reading is not evidence that nothing was stolen.
    const onFocusOut = () => {
      if (viewerFrameHoldsFocus()) handBackOrHandOver();
    };
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      stopGuard();
      document.removeEventListener("keydown", onEditorKey, true);
      document.removeEventListener("input", onEditorKey, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
    // Mount-only on purpose: rebinding this on a layout change is what let the
    // frame win. `enterViewerPaneFocus` is read through a ref for the same reason.
  }, []);

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
