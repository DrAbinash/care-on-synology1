/**
 * workspaceLayoutPrefs — layout-mode + column-size persistence for the
 * Radiology Reporting Workspace's 3-column body (patient panel / report
 * editor / contextual tool drawer).
 *
 * Pure calculation + localStorage persistence only — no React, no report
 * content, no draft/finalize state. Mirrors the existing per-radiologist
 * localStorage prefs pattern already used by useCopilotPrefs and
 * CollapsibleSection (JSON blob under one key, best-effort read/write).
 */

export type WorkspaceLayoutMode = "reportFocus" | "split" | "viewerFocus" | "dualScreen";

export const WORKSPACE_LAYOUT_MODES: readonly WorkspaceLayoutMode[] = [
  "reportFocus",
  "split",
  "viewerFocus",
  "dualScreen",
];

/** First visit defaults to Report Focus so the writing column owns the screen. */
export const DEFAULT_LAYOUT_MODE: WorkspaceLayoutMode = "reportFocus";

// ── Column-width constraints (percentage of the 3-column body) ─────────────
// Kept wide enough to be useful, tight enough that no column can crush
// another to uselessness. The report editor additionally gets an absolute
// pixel floor (CENTER_MIN_PX) so it never becomes "clinically unusable"
// regardless of percentages, per the layout spec.
// NOTE: each *_COLLAPSED_PCT is deliberately smaller than its *_MIN_PCT —
// "collapsed" (compact patient summary / icon ribbon) is a distinct, narrower
// snap state below the normal expanded floor. If they were equal, collapsing
// a panel wouldn't free any width.
export const LEFT_MIN_PCT = 26;
export const LEFT_MAX_PCT = 55;
export const LEFT_COLLAPSED_PCT = 20;
export const RIGHT_MIN_PCT = 18;
export const RIGHT_MAX_PCT = 46;
export const RIGHT_COLLAPSED_PCT = 6;
export const CENTER_MIN_PX = 480;

export interface ModeLayoutState {
  /** Expanded width of the left patient/study panel, in % of the 3-column body. */
  left: number;
  /** Expanded width of the right contextual tool drawer, in % of the 3-column body. */
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export interface WorkspaceLayoutPrefs {
  mode: WorkspaceLayoutMode;
  byMode: Record<WorkspaceLayoutMode, ModeLayoutState>;
}

const DEFAULT_MODE_STATE: Record<WorkspaceLayoutMode, ModeLayoutState> = {
  // Report Focus: viewer hidden, editor dominant (Phase 3 target: left
  // 18-22%, editor 58-68%, right collapsed or 18-22% when opened). Both
  // panels default to their compact/collapsed (LEFT_COLLAPSED_PCT / icon
  // ribbon) state; `left`/`right` below are just the fallback width if the
  // radiologist manually expands one while staying in this mode.
  reportFocus: { left: 30, right: 20, leftCollapsed: true, rightCollapsed: true },
  // Split View: viewer + editor share the screen — the workspace's default.
  split: { left: 32, right: 26, leftCollapsed: false, rightCollapsed: true },
  // Viewer Focus: viewer gets the lion's share; editor stays usable.
  viewerFocus: { left: 52, right: 22, leftCollapsed: false, rightCollapsed: true },
  // Dual Screen: embedded viewer hidden (it lives in the second window/
  // monitor instead), so the primary screen behaves like Report Focus.
  dualScreen: { left: 30, right: 20, leftCollapsed: true, rightCollapsed: true },
};

export function defaultModeState(mode: WorkspaceLayoutMode): ModeLayoutState {
  return { ...DEFAULT_MODE_STATE[mode] };
}

export function isWorkspaceLayoutMode(value: unknown): value is WorkspaceLayoutMode {
  return typeof value === "string" && (WORKSPACE_LAYOUT_MODES as readonly string[]).includes(value);
}

export function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampLeftPct(value: number): number {
  return clampPct(value, LEFT_MIN_PCT, LEFT_MAX_PCT);
}

export function clampRightPct(value: number): number {
  return clampPct(value, RIGHT_MIN_PCT, RIGHT_MAX_PCT);
}

/** The embedded DICOM viewer only ever renders in these two modes — Report
 *  Focus and Dual Screen both intentionally hide it (Phase 2/4). */
export function shouldShowEmbeddedViewer(mode: WorkspaceLayoutMode): boolean {
  return mode === "split" || mode === "viewerFocus";
}

/** Dual Screen relies on a real popup window (the existing Open Study /
 *  OHIF / Weasis launch path). If the browser blocks that popup, fall back
 *  to Split View so the radiologist still has a working viewer in-page. */
export function fallbackModeWhenPopupBlocked(mode: WorkspaceLayoutMode): WorkspaceLayoutMode {
  return mode === "dualScreen" ? "split" : mode;
}

export function defaultWorkspaceLayoutPrefs(): WorkspaceLayoutPrefs {
  const byMode = {} as Record<WorkspaceLayoutMode, ModeLayoutState>;
  for (const m of WORKSPACE_LAYOUT_MODES) byMode[m] = defaultModeState(m);
  return { mode: DEFAULT_LAYOUT_MODE, byMode };
}

function sanitizeModeState(raw: unknown, mode: WorkspaceLayoutMode): ModeLayoutState {
  const fallback = defaultModeState(mode);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  return {
    left: typeof r.left === "number" && Number.isFinite(r.left) ? clampLeftPct(r.left) : fallback.left,
    right: typeof r.right === "number" && Number.isFinite(r.right) ? clampRightPct(r.right) : fallback.right,
    leftCollapsed: typeof r.leftCollapsed === "boolean" ? r.leftCollapsed : fallback.leftCollapsed,
    rightCollapsed: typeof r.rightCollapsed === "boolean" ? r.rightCollapsed : fallback.rightCollapsed,
  };
}

/** Parses a persisted JSON blob, tolerating missing/corrupt fields — any
 *  problem falls back to sane per-field defaults rather than throwing, the
 *  same defensive stance CollapsibleSection/useCopilotPrefs take. */
export function parseWorkspaceLayoutPrefs(json: string | null | undefined): WorkspaceLayoutPrefs {
  const defaults = defaultWorkspaceLayoutPrefs();
  if (!json) return defaults;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return defaults;
    const p = parsed as Record<string, unknown>;
    const mode = isWorkspaceLayoutMode(p.mode) ? p.mode : defaults.mode;
    const byMode = {} as Record<WorkspaceLayoutMode, ModeLayoutState>;
    const rawByMode = p.byMode && typeof p.byMode === "object" ? (p.byMode as Record<string, unknown>) : {};
    for (const m of WORKSPACE_LAYOUT_MODES) byMode[m] = sanitizeModeState(rawByMode[m], m);
    return { mode, byMode };
  } catch {
    return defaults;
  }
}

const STORAGE_PREFIX = "radiology_workspace_layout_v1";

/** One storage slot per radiologist (falls back to a shared slot when no
 *  session user id is available yet, e.g. before login resolves). */
export function workspaceLayoutStorageKey(userKey: string | number | null | undefined): string {
  return `${STORAGE_PREFIX}:${userKey ?? "anon"}`;
}

export function loadWorkspaceLayoutPrefs(userKey: string | number | null | undefined): WorkspaceLayoutPrefs {
  try {
    if (typeof localStorage === "undefined") return defaultWorkspaceLayoutPrefs();
    return parseWorkspaceLayoutPrefs(localStorage.getItem(workspaceLayoutStorageKey(userKey)));
  } catch {
    return defaultWorkspaceLayoutPrefs();
  }
}

export function saveWorkspaceLayoutPrefs(
  userKey: string | number | null | undefined,
  prefs: WorkspaceLayoutPrefs,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(workspaceLayoutStorageKey(userKey), JSON.stringify(prefs));
  } catch {
    /* private mode / quota — layout just won't persist, non-fatal */
  }
}
