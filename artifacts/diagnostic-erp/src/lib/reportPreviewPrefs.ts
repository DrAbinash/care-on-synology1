/**
 * Where the radiologist left the live rendered report — its visibility and its
 * width — remembered between reports and between sessions.
 *
 * OWNER DECISION 2026-11-01 put the preview in a column of its own, to the right of
 * the Findings/Impression editors, so its size is now a WIDTH and the thing it can
 * steal is the editor's, not its height. Both failure modes are how the rendered
 * report stopped being part of his signing decision: a preview he cannot shrink is a
 * preview that starves the editor it renders from — measured at 1536x800 with the old
 * bottom pane, the Impression editor sat at y=824 of an 800px viewport, entirely below
 * the fold — and a preview whose state does not survive the next study is one he
 * closes and stops using.
 *
 * Read once at mount, written when he moves it. Storage that is missing or refuses
 * (private mode, a harness with no `window`) falls back to the defaults instead of
 * failing the panel — the preview is a viewing aid, never a dependency.
 */
export const PREVIEW_OPEN_KEY = "care.reportPreview.open";
export const PREVIEW_WIDTH_KEY = "care.reportPreview.width";

/** Percent of the report column group, not of the window: the queue and the viewer
 *  have already taken their share before this column is laid out. */
export const MIN_PREVIEW_PANE_PCT = 18;
export const MAX_PREVIEW_PANE_PCT = 45;
export const DEFAULT_PREVIEW_PANE_PCT = 30;

/** The Findings/Impression editors' floor, in CSS pixels. Measured at 1536x800 on the
 *  rig (tmp/evidence/preview-column-*.json, study 1113): the editor column is 641px wide
 *  with the preview open at this clinic's 30% default, 754px with it folded, and 431px
 *  with Quick Select open as well. 560 sits between the first and the third, so the
 *  three columns share a normal study and the preview is the thing that goes when they
 *  cannot — the owner's rule: "At constrained widths, collapse the preview automatically
 *  instead of squeezing the editor." */
export const EDITOR_MIN_PX = 560;

/** The share the preview column keeps when closed: a strip he can reopen, not a gap.
 *  Shared because the editor column's mount default is `100 - preview`, and a group
 *  whose defaults do not sum to 100 is re-normalised at mount — which silently reprices
 *  the width he persisted. */
export const PREVIEW_STRIP_PCT = 3;

export function clampPreviewPaneWidthPct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_PREVIEW_PANE_PCT;
  return Math.min(MAX_PREVIEW_PANE_PCT, Math.max(MIN_PREVIEW_PANE_PCT, Math.round(pct)));
}

/**
 * Does the editor column still have room for this preview beside it?
 *
 * Measured off the editor panel's own width rather than off a model of the workspace:
 * the reading queue, the viewer and the Quick Select rail each take a share the
 * radiologist controls, and the only number that answers "is the editor being
 * squeezed?" is the width the editor actually has. When it falls under the floor, the
 * preview is what goes — never the editor.
 */
export function editorHasRoomForPreview(editorWidthPx: number): boolean {
  // An unmeasured column (0, NaN) is not evidence of a squeeze: never fold a preview
  // he asked for because the browser had not laid the page out yet.
  if (!Number.isFinite(editorWidthPx) || editorWidthPx <= 0) return true;
  return editorWidthPx >= EDITOR_MIN_PX;
}

export function readPreviewPrefs(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): { open: boolean; widthPct: number } {
  let rawOpen: string | null = null;
  let rawWidth = NaN;
  try {
    rawOpen = storage?.getItem(PREVIEW_OPEN_KEY) ?? null;
    // An absent entry is `null` from localStorage, and `Number(null)` is 0 — a
    // finite number that would clamp to the minimum. Never-asked is the default,
    // not the smallest pane.
    rawWidth = num(storage?.getItem(PREVIEW_WIDTH_KEY));
  } catch {
    return { open: true, widthPct: DEFAULT_PREVIEW_PANE_PCT };
  }
  return {
    // Absent means never-collapsed: the preview must be on for the radiologist who
    // has not been asked about it yet.
    open: rawOpen !== "0",
    widthPct: Number.isFinite(rawWidth) ? clampPreviewPaneWidthPct(rawWidth) : DEFAULT_PREVIEW_PANE_PCT,
  };
}

function num(raw: string | null | undefined): number {
  return raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
}

export function writePreviewPref(
  key: typeof PREVIEW_OPEN_KEY | typeof PREVIEW_WIDTH_KEY,
  value: string,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  try { storage?.setItem(key, value); } catch { /* nothing to persist to */ }
}
