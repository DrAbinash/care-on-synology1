/**
 * DOM helpers for the clinical text editors (Findings / Impression /
 * Technique / Clinical History / Recommendation).
 *
 * The editors are addressed by their section wrapper's data attribute —
 * `useReportSectionChrome.focusReportField` already queries
 * `[data-report-field="${field}"] textarea` to focus them, so the same
 * selector is the canonical address for reading a caret/selection too.
 */

/** Focus the clinical editor for a field. Returns false when it is not
 * rendered (section collapsed / not mounted) — a no-op, never a throw. */
export function focusClinicalFieldEditor(field: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector(
    `[data-report-field="${field}"] textarea`,
  ) as HTMLTextAreaElement | null;
  if (!el) return false;
  el.focus();
  return true;
}

/**
 * U3 — after a Quick Select tile insert, should the clinical editor take
 * focus back?
 *
 * - A MOUSE pick is one-and-done: the radiologist clicked a finding and the
 *   next thing they do is keep typing, so focus returns to the editor.
 * - A KEYBOARD pick (roving focus + Enter) keeps focus on the rail so the
 *   multi-finding keyboard flow (arrow, arrow, Enter, …) is not broken.
 * - A refused pick wrote nothing; a pending pick opened the same-slot confirm
 *   dialog — neither may steal focus from where the user is looking.
 */
export function shouldRefocusEditorAfterTilePick(
  outcome: string | undefined,
  via: "mouse" | "keyboard",
): boolean {
  if (via !== "mouse") return false;
  if (outcome === "refused" || outcome === "pending") return false;
  return true;
}
