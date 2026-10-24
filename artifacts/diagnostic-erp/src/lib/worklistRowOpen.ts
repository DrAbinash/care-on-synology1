/**
 * worklistRowOpen.ts — the PACS worklist row's open-on-click decision.
 *
 * Few-clicks pass 2 made the whole row open the study (click anywhere, or
 * focus the row and press Enter/Space). The wiring carried one guard — the
 * row's own interactive controls opt out — and missed the other everyday
 * gesture on a triage list: DRAG-SELECTING text. A mouseup that completes a
 * selection still fires `click` on the row, so copying a patient name, an
 * accession number, or a UHID navigated the radiologist away from the list
 * instead of copying. Same family as shouldIgnorePaneFocusTarget
 * (reportingPaneFocus.ts): DOM facts in, verdict out, node-testable.
 */

/** The facts a click event provides; the pure decision needs nothing else. */
export type WorklistRowOpenFacts = {
  /** The row is a real study row — the sentinel debug row stays inert. */
  isStudyRow: boolean;
  /**
   * The click landed on (inside) one of the row's own interactive controls
   * (Report / Focus / OHIF / Weasis buttons, the assign select, the
   * overnight checkbox, links) — their own clicks never double-fire the
   * row action.
   */
  interactiveTarget: boolean;
  /**
   * A drag across the row's text completed a selection by mouseup time.
   * The browser still fires `click` on the same element — this is the
   * copy-gesture guard. A collapsed caret is NOT a selection.
   */
  hasTextSelection: boolean;
};

/**
 * Should this click open the study? One authority for the row-open decision,
 * so the click guard and any future affordance can never drift apart.
 */
export function shouldOpenWorklistRowFromClick(facts: WorklistRowOpenFacts): boolean {
  if (!facts.isStudyRow) return false;
  if (facts.interactiveTarget) return false;
  // Copy wins over navigate: the radiologist selected text on purpose, and
  // the selection dies the moment the route changes.
  if (facts.hasTextSelection) return false;
  return true;
}

/**
 * Does the document hold a live, non-collapsed text selection right now?
 * DOM-reading half of the guard — node-safe (absent window reads as "no
 * selection"), and a collapsed caret (the residue of any single click)
 * reads as "no selection" so plain clicks still open.
 */
export function worklistHasTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.getSelection !== "function") return false;
  const selection = window.getSelection();
  if (!selection) return false;
  if (selection.isCollapsed) return false;
  return String(selection).length > 0;
}
