/**
 * workspaceLayoutPrefs — layout-mode + column-size persistence for the
 * Radiology Reporting Workspace.
 *
 * Live page (Queue | OHIF | Report stack):
 *   - `left` / `leftCollapsed` → Reading Queue panel
 *   - `viewerPct` / `reportPct` → OHIF vs report stack (when viewer shown)
 *   - `right` / `rightCollapsed` → nested Orient/Copilot rail (secondary)
 *
 * Legacy 3-column body used left/right as patient | tools; v2 storage is
 * shared. Missing viewerPct/reportPct fall back to mode defaults.
 *
 * Pure calculation + localStorage persistence only — no React, no report
 * content, no draft/finalize state.
 */

export type WorkspaceLayoutMode = "reportFocus" | "split" | "viewerFocus" | "dualScreen";

export const WORKSPACE_LAYOUT_MODES: readonly WorkspaceLayoutMode[] = [
  "reportFocus",
  "split",
  "viewerFocus",
  "dualScreen",
];

/** First visit defaults to Split so the embedded OHIF / WADO viewer is visible. */
export const DEFAULT_LAYOUT_MODE: WorkspaceLayoutMode = "split";

// ── Column-width constraints (percentage of the outer panel group) ─────────
export const LEFT_MIN_PCT = 12;
export const LEFT_MAX_PCT = 26;
export const LEFT_COLLAPSED_PCT = 3;
export const RIGHT_MIN_PCT = 16;
export const RIGHT_MAX_PCT = 40;
export const RIGHT_COLLAPSED_PCT = 3;
export const VIEWER_MIN_PCT = 22;
export const VIEWER_MAX_PCT = 72;
export const REPORT_MIN_PCT = 28;
export const REPORT_MAX_PCT = 82;
export const CENTER_MIN_PX = 480;

export interface ModeLayoutState {
  /** Expanded width of the Reading Queue (left) panel, in % of the outer group. */
  left: number;
  /** Expanded width of the nested Orient/Copilot rail (secondary), in %. */
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /**
   * OHIF/viewer column % of the outer Queue|Viewer|Report group.
   * Omitted in older prefs → mode default applied at restore time.
   */
  viewerPct?: number;
  /** Report stack % of the outer group when the embedded viewer is shown. */
  reportPct?: number;
}

export interface WorkspaceLayoutPrefs {
  mode: WorkspaceLayoutMode;
  byMode: Record<WorkspaceLayoutMode, ModeLayoutState>;
  /**
   * Preferred layout mode per modality bucket (MR/CT/XR/US/MG/OTHER).
   * Study-agnostic / protocol-agnostic — V1 memory only.
   */
  byModality: Record<string, WorkspaceLayoutMode>;
}

const DEFAULT_MODE_STATE: Record<WorkspaceLayoutMode, ModeLayoutState> = {
  // Report Focus: viewer hidden; report stack owns remaining width.
  reportFocus: {
    left: 18,
    right: 20,
    leftCollapsed: true,
    rightCollapsed: true,
    viewerPct: 0,
    reportPct: 82,
  },
  // Split / reporting-biased defaults (laptop auto-focus uses these targets;
  // wide desktop keeps last manual drag when persisted).
  split: {
    left: 18,
    right: 26,
    leftCollapsed: true,
    rightCollapsed: true,
    viewerPct: 33,
    reportPct: 64,
  },
  // Viewer Focus: OHIF ~2/3, report ~1/3.
  viewerFocus: {
    left: 18,
    right: 22,
    leftCollapsed: true,
    rightCollapsed: true,
    viewerPct: 65,
    reportPct: 32,
  },
  // Dual Screen: embedded viewer hidden (lives on second monitor).
  dualScreen: {
    left: 18,
    right: 20,
    leftCollapsed: true,
    rightCollapsed: true,
    viewerPct: 0,
    reportPct: 82,
  },
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

export function clampViewerPct(value: number): number {
  return clampPct(value, VIEWER_MIN_PCT, VIEWER_MAX_PCT);
}

export function clampReportPct(value: number): number {
  return clampPct(value, REPORT_MIN_PCT, REPORT_MAX_PCT);
}

/** Resolve viewer/report pair for a mode, filling defaults when prefs omit them. */
export function resolveViewerReportPcts(
  mode: WorkspaceLayoutMode,
  state: ModeLayoutState,
): { viewerPct: number; reportPct: number } {
  const fallback = defaultModeState(mode);
  const viewerPct =
    typeof state.viewerPct === "number" && Number.isFinite(state.viewerPct)
      ? mode === "reportFocus" || mode === "dualScreen"
        ? Math.max(0, state.viewerPct)
        : clampViewerPct(state.viewerPct)
      : (fallback.viewerPct ?? 33);
  const reportPct =
    typeof state.reportPct === "number" && Number.isFinite(state.reportPct)
      ? clampReportPct(state.reportPct)
      : (fallback.reportPct ?? 64);
  return { viewerPct, reportPct };
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
  return { mode: DEFAULT_LAYOUT_MODE, byMode, byModality: {} };
}

/** Modality buckets for layout memory (not study/protocol specific). */
export type LayoutModalityBucket = "MR" | "CT" | "XR" | "US" | "MG" | "OTHER";

/**
 * Bucket a raw worklist/DICOM modality into a layout preference key.
 * XR covers CR/DX/XA/RF; US covers USG/Doppler aliases.
 */
export function layoutModalityBucket(raw: string | null | undefined): LayoutModalityBucket {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return "OTHER";
  if (v === "US" || v === "USG" || v.startsWith("US ") || v.includes("USG") || v.includes("ULTRASOUND") || v.includes("DOPPLER")) {
    return "US";
  }
  if (v === "MR" || v.startsWith("MR")) return "MR";
  if (v === "CT" || v.startsWith("CT")) return "CT";
  if (v === "MG" || v.startsWith("MG") || v.includes("MAMMO")) return "MG";
  if (
    v === "XR" || v === "CR" || v === "DX" || v === "XA" || v === "RF"
    || v === "XRAY" || v === "X-RAY" || v.startsWith("XR")
  ) {
    return "XR";
  }
  return "OTHER";
}

export function resolveLayoutModeForModality(
  prefs: WorkspaceLayoutPrefs,
  rawModality: string | null | undefined,
): WorkspaceLayoutMode {
  const bucket = layoutModalityBucket(rawModality);
  const saved = prefs.byModality?.[bucket];
  if (isWorkspaceLayoutMode(saved)) return saved;
  return prefs.mode;
}

export function withModalityLayoutMode(
  prefs: WorkspaceLayoutPrefs,
  rawModality: string | null | undefined,
  mode: WorkspaceLayoutMode,
): WorkspaceLayoutPrefs {
  const bucket = layoutModalityBucket(rawModality);
  return {
    ...prefs,
    mode,
    byModality: { ...(prefs.byModality ?? {}), [bucket]: mode },
  };
}

function sanitizeModeState(raw: unknown, mode: WorkspaceLayoutMode): ModeLayoutState {
  const fallback = defaultModeState(mode);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const viewerPct =
    typeof r.viewerPct === "number" && Number.isFinite(r.viewerPct)
      ? r.viewerPct
      : fallback.viewerPct;
  const reportPct =
    typeof r.reportPct === "number" && Number.isFinite(r.reportPct)
      ? clampReportPct(r.reportPct)
      : fallback.reportPct;
  return {
    left: typeof r.left === "number" && Number.isFinite(r.left) ? clampLeftPct(r.left) : fallback.left,
    right: typeof r.right === "number" && Number.isFinite(r.right) ? clampRightPct(r.right) : fallback.right,
    leftCollapsed: typeof r.leftCollapsed === "boolean" ? r.leftCollapsed : fallback.leftCollapsed,
    rightCollapsed: typeof r.rightCollapsed === "boolean" ? r.rightCollapsed : fallback.rightCollapsed,
    viewerPct,
    reportPct,
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
    const byModality: Record<string, WorkspaceLayoutMode> = {};
    const rawByMod =
      p.byModality && typeof p.byModality === "object" ? (p.byModality as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(rawByMod)) {
      if (isWorkspaceLayoutMode(v)) byModality[k] = v;
    }
    return { mode, byMode, byModality };
  } catch {
    return defaults;
  }
}

const STORAGE_PREFIX_V1 = "radiology_workspace_layout_v1";
const STORAGE_PREFIX_V2 = "radiology_workspace_layout_v2";

/** V2 slot (includes byModality). */
export function workspaceLayoutStorageKey(userKey: string | number | null | undefined): string {
  return `${STORAGE_PREFIX_V2}:${userKey ?? "anon"}`;
}

function workspaceLayoutStorageKeyV1(userKey: string | number | null | undefined): string {
  return `${STORAGE_PREFIX_V1}:${userKey ?? "anon"}`;
}

export function loadWorkspaceLayoutPrefs(userKey: string | number | null | undefined): WorkspaceLayoutPrefs {
  try {
    if (typeof localStorage === "undefined") return defaultWorkspaceLayoutPrefs();
    const v2 = localStorage.getItem(workspaceLayoutStorageKey(userKey));
    if (v2) return parseWorkspaceLayoutPrefs(v2);
    // Migrate: read v1 once if v2 missing (upgrade happens on next save).
    const v1 = localStorage.getItem(workspaceLayoutStorageKeyV1(userKey));
    return parseWorkspaceLayoutPrefs(v1);
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
    const normalized: WorkspaceLayoutPrefs = {
      ...prefs,
      byModality: prefs.byModality ?? {},
    };
    localStorage.setItem(workspaceLayoutStorageKey(userKey), JSON.stringify(normalized));
  } catch {
    /* private mode / quota — layout just won't persist, non-fatal */
  }
}
