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

/** First visit defaults to Split so the embedded OHIF / WADO viewer is visible. */
export const DEFAULT_LAYOUT_MODE: WorkspaceLayoutMode = "split";

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
  /**
   * Preferred layout mode per modality bucket (MR/CT/XR/US/MG/OTHER).
   * Study-agnostic / protocol-agnostic — V1 memory only.
   */
  byModality: Record<string, WorkspaceLayoutMode>;
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
