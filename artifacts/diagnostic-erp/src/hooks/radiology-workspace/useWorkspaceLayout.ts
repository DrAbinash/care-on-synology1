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
  LEFT_COLLAPSED_PCT,
  type WorkspaceLayoutMode,
  type WorkspaceLayoutPrefs,
} from "@/lib/workspaceLayoutPrefs";
import {
  isNarrowReportingViewport,
  outerPanelPercents,
  isPhoneReportingViewport,
  shouldApplyAutomaticPaneFocus,
  shouldUseCompactAccordion,
  shouldUseExclusiveReportSections,
  markPaneManualOverride,
  clearPaneManualOverride,
  type PaneManualOverrideState,
  type ReportingPaneBias,
} from "@/lib/reportingPaneFocus";

export type UseWorkspaceLayoutOptions = {
  myUserId: number | null;
  studyId: number | undefined;
  modality: string | null | undefined;
  viewportWidthPx: number;
  enterReportingFocusModeRef: MutableRefObject<() => void>;
  enterClinicalEditorFocusRef: MutableRefObject<() => void>;
  exclusiveReportSectionsRef: MutableRefObject<boolean>;
};

export function useWorkspaceLayout(opts: UseWorkspaceLayoutOptions) {
  const {
    myUserId, studyId, modality, viewportWidthPx,
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
    rightPanelRef.current?.collapse();
    templatePanelRef.current?.collapse();
    suppressNextModeSizeApplyRef.current = true;
    requestAnimationFrame(() => {
      try {
        viewerPanelRef.current?.resize(pct.viewer);
        reportPanelRef.current?.resize(pct.report);
      } finally {
        paneFocusApplyingRef.current = false;
      }
    });
  }, [showEmbeddedViewer, viewportWidthPx]);

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

  const enterReportingFocusMode = useCallback(() => {
    leftPanelRef.current?.collapse();
    rightPanelRef.current?.collapse();
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
    }
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
  }, [
    layoutMode, setLayoutMode, setViewerFocus, showEmbeddedViewer,
    exclusiveReportSections, applyPaneFocusSplit,
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

  useEffect(() => {
    const onBlur = () => {
      requestAnimationFrame(() => {
        const ae = document.activeElement;
        if (ae instanceof HTMLIFrameElement && ae.getAttribute("data-testid") === "ohif-embed") {
          enterViewerPaneFocus();
        }
      });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
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
