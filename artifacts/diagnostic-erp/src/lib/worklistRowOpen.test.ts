/**
 * worklistRowOpen.test.ts — the row-open guard's decision table, few-clicks
 * re-audit pass 3.
 *
 * THE DEFECT UNDER GUARD
 *   Few-clicks pass 2 made the whole worklist row open the study. The guard
 *   covered the row's own controls (buttons/inputs/selects opt out) but not
 *   the other thing radiologists do to a row: DRAG-SELECT its text. A
 *   mouseup that completes a text selection still fires `click` on the row,
 *   so copying a patient name / accession number / UHID navigated the
 *   radiologist away instead of copying. The guard must treat an active
 *   text selection exactly like an inner control: the row's job is to open
 *   studies, not to eat copy gestures.
 */
import { describe, expect, it } from "vitest";
import { shouldOpenWorklistRowFromClick } from "./worklistRowOpen";

describe("shouldOpenWorklistRowFromClick", () => {
  it("opens on a plain click in an empty cell of a real study row", () => {
    expect(
      shouldOpenWorklistRowFromClick({ isStudyRow: true, interactiveTarget: false, hasTextSelection: false }),
    ).toBe(true);
  });

  it("stays inert on the sentinel debug row", () => {
    expect(
      shouldOpenWorklistRowFromClick({ isStudyRow: false, interactiveTarget: false, hasTextSelection: false }),
    ).toBe(false);
  });

  it("opts out when the click landed on one of the row's own controls", () => {
    expect(
      shouldOpenWorklistRowFromClick({ isStudyRow: true, interactiveTarget: true, hasTextSelection: false }),
    ).toBe(false);
  });

  it("opts out when a drag completed a text selection — copy wins over navigate", () => {
    // The everyday act under guard: drag across the accession number to
    // copy it, release the mouse on the same row. `click` still fires.
    expect(
      shouldOpenWorklistRowFromClick({ isStudyRow: true, interactiveTarget: false, hasTextSelection: true }),
    ).toBe(false);
    // Selection trumps even a click that would otherwise look plain.
    expect(
      shouldOpenWorklistRowFromClick({ isStudyRow: true, interactiveTarget: false, hasTextSelection: true }),
    ).toBe(false);
  });

  it("a collapsed caret is not a selection — typing-adjacent clicks still open", () => {
    // A double-click that selects a word selects text (guarded above), but
    // a single click leaves a collapsed caret: hasTextSelection false.
    expect(
      shouldOpenWorklistRowFromClick({ isStudyRow: true, interactiveTarget: false, hasTextSelection: false }),
    ).toBe(true);
  });
});
