/**
 * Phase 3, item E — reliable keyboard navigation for the Quick Select strip.
 *
 * The strip's tiles were `<div onClick>`: a keyboard user could not reach a
 * single one. Tab skipped the whole strip (no tab stops), there was no arrow
 * key, no Enter activation, and no Escape — the tile rail was mouse-only.
 *
 * This module is the roving-focus model, pure and testable, so the semantics
 * are pinned where they can be measured:
 *
 *   ArrowRight / ArrowLeft  move between tiles, wrapping at the ends — the
 *                           strip is a flex-wrap row, so left/right is the
 *                           natural axis and wrap means no tile is ever a dead
 *                           end;
 *   Home / End              first / last tile;
 *   Enter / Space           activate the focused tile (the same door the
 *                           click uses — review when applied, pick when idle);
 *   Escape                  leave the tile rail (back to the search field);
 *   anything else           "none" — the browser's own scrolling and typing
 *                           behaviour is untouched, so this model never
 *                           fights the editor's shortcuts.
 *
 * `index === null` means "no tile focused yet"; ArrowRight from null focuses
 * the first tile, ArrowLeft the last — a strip you can enter from either end
 * with a single press, exactly like a listbox.
 */
export type QuickSelectNavAction =
  /** Focus the tile at `index`. */
  | { action: "move"; index: number }
  /** Activate the focused tile at `index`. */
  | { action: "activate"; index: number }
  /** Leave the tile rail (Escape). */
  | { action: "exit" }
  /** Not this model's key — the caller must NOT preventDefault. */
  | { action: "none" };

export function quickSelectKeyNav(key: string, opts: {
  /** Currently focused tile index, or null when the rail is not entered. */
  index: number | null;
  /** How many tiles are rendered. 0 renders every key "none" — nothing to navigate. */
  count: number;
}): QuickSelectNavAction {
  const { index, count } = opts;
  if (count <= 0) return { action: "none" };

  const wrap = (next: number): { action: "move"; index: number } => ({
    action: "move",
    index: ((next % count) + count) % count,
  });

  switch (key) {
    case "ArrowRight":
      return wrap(index === null ? 0 : index + 1);
    case "ArrowLeft":
      return wrap(index === null ? count - 1 : index - 1);
    case "Home":
      return { action: "move", index: 0 };
    case "End":
      return { action: "move", index: count - 1 };
    case "Enter":
    case " ":
      return index === null ? { action: "none" } : { action: "activate", index };
    case "Escape":
      // Escape when nothing is focused belongs to whoever owns the page-level
      // shortcut (closing dialogs etc.) — the rail only exits when it holds
      // the focus it can give back.
      return index === null ? { action: "none" } : { action: "exit" };
    default:
      return { action: "none" };
  }
}

/**
 * The roving tabIndex for WAI-ARIA grid-style navigation: exactly ONE tile is
 * a tab stop — the focused one, or the first when the rail has not been
 * entered — so Tab enters the rail at one tile instead of crawling every div.
 */
export function quickSelectRovingTabIndex(index: number | null, position: number): number {
  if (index === null) return position === 0 ? 0 : -1;
  return index === position ? 0 : -1;
}
