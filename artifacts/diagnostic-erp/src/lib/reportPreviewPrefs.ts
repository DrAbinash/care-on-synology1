/**
 * Where the radiologist left the live rendered report — its visibility and its
 * height — remembered between reports and between sessions.
 *
 * The preview pane is permanently in the report column on a wide desktop, so its
 * size is a choice he makes once per monitor rather than once per study. Both
 * failure modes are how the rendered report stopped being part of his signing
 * decision: a preview he cannot shrink is a preview that steals height from the
 * Findings editor, and a preview whose state does not survive the next study is
 * one he closes and stops using.
 *
 * Read once at mount, written when he moves it. Storage that is missing or refuses
 * (private mode, a harness with no `window`) falls back to the defaults instead of
 * failing the panel — the preview is a viewing aid, never a dependency.
 */
export const PREVIEW_OPEN_KEY = "care.reportPreview.open";
export const PREVIEW_HEIGHT_KEY = "care.reportPreview.height";
export const MIN_PREVIEW_PANE_PX = 180;
export const MAX_PREVIEW_PANE_PX = 900;
export const DEFAULT_PREVIEW_PANE_PX = 320;

export function clampPreviewPaneHeight(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_PREVIEW_PANE_PX;
  return Math.min(MAX_PREVIEW_PANE_PX, Math.max(MIN_PREVIEW_PANE_PX, Math.round(px)));
}

export function readPreviewPrefs(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): { open: boolean; heightPx: number } {
  let rawOpen: string | null = null;
  let rawHeight = NaN;
  try {
    rawOpen = storage?.getItem(PREVIEW_OPEN_KEY) ?? null;
    rawHeight = Number(storage?.getItem(PREVIEW_HEIGHT_KEY));
  } catch {
    return { open: true, heightPx: DEFAULT_PREVIEW_PANE_PX };
  }
  return {
    // Absent means never-collapsed: the preview must be on for the radiologist who
    // has not been asked about it yet.
    open: rawOpen !== "0",
    heightPx: Number.isFinite(rawHeight) ? clampPreviewPaneHeight(rawHeight) : DEFAULT_PREVIEW_PANE_PX,
  };
}

export function writePreviewPref(
  key: typeof PREVIEW_OPEN_KEY | typeof PREVIEW_HEIGHT_KEY,
  value: string,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  try { storage?.setItem(key, value); } catch { /* nothing to persist to */ }
}
