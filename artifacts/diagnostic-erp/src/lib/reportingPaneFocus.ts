/**
 * Reporting ↔ Viewer pane focus helpers for the Radiology Reporting Workspace.
 *
 * Pure math + viewport policy only — no React, no clinical state.
 * Integrates with existing WorkspaceLayoutMode ("split" = reporting-biased,
 * "viewerFocus" = viewer-biased) and react-resizable-panels via .resize().
 */

/** Below this CSS viewport width, enable exclusive accordion + auto 2/3 focus. */
export const CONSTRAINED_REPORTING_VIEWPORT_MAX_PX = 1366;

/** Very narrow: keep both panes usable rather than crushing either. */
export const NARROW_REPORTING_VIEWPORT_MAX_PX = 1100;

export type ReportingPaneBias = "reporting" | "viewer";

/** Target shares of the OHIF+Report band (queue excluded). ~1/3 : 2/3. */
export const REPORTING_FOCUS_VIEWER_SHARE = 0.33;
export const VIEWER_FOCUS_VIEWER_SHARE = 0.67;

export const DEFAULT_QUEUE_EXPANDED_PCT = 18;
export const DEFAULT_QUEUE_COLLAPSED_PCT = 3;

export function isConstrainedReportingViewport(widthPx: number): boolean {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return true;
  return widthPx <= CONSTRAINED_REPORTING_VIEWPORT_MAX_PX;
}

export function isNarrowReportingViewport(widthPx: number): boolean {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return true;
  return widthPx <= NARROW_REPORTING_VIEWPORT_MAX_PX;
}

/**
 * Map radiologist intent → existing WorkspaceLayoutMode without inventing a
 * parallel mode enum. Dual/reportFocus (viewer hidden) are left alone.
 */
export function layoutModeForPaneBias(bias: ReportingPaneBias): "split" | "viewerFocus" {
  return bias === "viewer" ? "viewerFocus" : "split";
}

export function paneBiasForLayoutMode(mode: string): ReportingPaneBias | null {
  if (mode === "viewerFocus") return "viewer";
  if (mode === "split") return "reporting";
  return null;
}

/**
 * Outer ResizablePanelGroup percents: Queue | Viewer | Report.
 * Queue stays collapsed during automatic focus so the clinical 2/3 is usable.
 */
export function outerPanelPercents(opts: {
  bias: ReportingPaneBias;
  queueCollapsed?: boolean;
  queueExpandedPct?: number;
  queueCollapsedPct?: number;
  /** Soften toward 50/50 when the whole window is very narrow. */
  narrow?: boolean;
}): { queue: number; viewer: number; report: number } {
  const queueCollapsed = opts.queueCollapsed !== false;
  const queue = queueCollapsed
    ? (opts.queueCollapsedPct ?? DEFAULT_QUEUE_COLLAPSED_PCT)
    : (opts.queueExpandedPct ?? DEFAULT_QUEUE_EXPANDED_PCT);
  const remainder = Math.max(1, 100 - queue);

  let viewerShare =
    opts.bias === "viewer" ? VIEWER_FOCUS_VIEWER_SHARE : REPORTING_FOCUS_VIEWER_SHARE;
  if (opts.narrow) {
    // Avoid 70/30 when both panes would become clinically awkward.
    viewerShare = opts.bias === "viewer" ? 0.58 : 0.42;
  }

  const viewer = Math.round(remainder * viewerShare);
  const report = Math.max(1, remainder - viewer);
  return { queue, viewer, report };
}

/** True when inactive accordion rows should use single-line compact chrome. */
export function shouldUseCompactAccordion(opts: {
  viewportWidthPx: number;
  layoutMode: string;
}): boolean {
  if (opts.layoutMode === "viewerFocus") return true;
  return isConstrainedReportingViewport(opts.viewportWidthPx);
}

/**
 * Exclusive one-active section (no continuous Findings+Impression).
 * Constrained viewports and viewer-biased layouts need the active editor
 * to own remaining height.
 */
export function shouldUseExclusiveReportSections(opts: {
  viewportWidthPx: number;
  layoutMode: string;
}): boolean {
  if (opts.layoutMode === "viewerFocus") return true;
  return isConstrainedReportingViewport(opts.viewportWidthPx);
}

/**
 * Collapse a two-line summary into a short inline fragment for compact rows.
 * Presentation only — does not mutate clinical data.
 */
export function compactAccordionSummary(summary: string, maxChars = 42): string {
  const cleaned = summary
    .replace(/\s+/g, " ")
    .replace(/\s*[•·|]\s*/g, " · ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * Whether a pointer target should be ignored for pane-focus switching
 * (menus, inputs, resize handles, etc.).
 */
export function shouldIgnorePaneFocusTarget(target: EventTarget | null): boolean {
  if (target == null || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    [
      "[data-pane-focus-ignore]",
      "[data-panel-resize-handle]",
      "[data-radix-popper-content-wrapper]",
      "[role='menu']",
      "[role='listbox']",
      "[role='dialog']",
      "input",
      "textarea",
      "select",
      "button",
      "a",
      "[contenteditable='true']",
    ].join(","),
  );
}
