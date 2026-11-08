import { describe, expect, it } from "vitest";
import { shouldRefocusEditorAfterTilePick } from "./clinicalFieldDom";

/**
 * U3 pins — the focus contract after a Quick Select tile insert. The old
 * behavior left focus on the rail control after EVERY insert, so a
 * mouse-clicking radiologist had to click back into the textarea before
 * continuing to type. The fix returns focus to the editor only where that is
 * the right next action.
 */
describe("shouldRefocusEditorAfterTilePick (U3)", () => {
  it("a mouse pick that wrote returns focus to the editor", () => {
    expect(shouldRefocusEditorAfterTilePick("applied", "mouse")).toBe(true);
    expect(shouldRefocusEditorAfterTilePick(undefined, "mouse")).toBe(true);
  });

  it("a keyboard pick keeps focus on the rail — the multi-finding roving flow must not break", () => {
    expect(shouldRefocusEditorAfterTilePick("applied", "keyboard")).toBe(false);
  });

  it("a refused pick (nothing written) and a pending pick (confirm dialog opened) never steal focus", () => {
    expect(shouldRefocusEditorAfterTilePick("refused", "mouse")).toBe(false);
    expect(shouldRefocusEditorAfterTilePick("pending", "mouse")).toBe(false);
    expect(shouldRefocusEditorAfterTilePick("refused", "keyboard")).toBe(false);
    expect(shouldRefocusEditorAfterTilePick("pending", "keyboard")).toBe(false);
  });
});
