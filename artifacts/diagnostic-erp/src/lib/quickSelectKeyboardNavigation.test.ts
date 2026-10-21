/**
 * Phase 3, item E — reliable keyboard navigation for the Quick Select strip.
 *
 * The tiles were `<div onClick>`: a keyboard user could not reach a single
 * one. Tab skipped the whole rail, there was no arrow key, no Enter
 * activation, no Escape — the highest-traffic control in the workspace was
 * mouse-only.
 *
 * The model (`quickSelectKeyboardNavigation`) is pure so its semantics are
 * pinned exactly; the strip's wiring is pinned by source contract because
 * this container has no browser. What the model guarantees:
 *
 *   · ArrowRight/ArrowLeft move with WRAP — no tile is a dead end;
 *   · from an un-entered rail, ArrowRight starts at the first tile and
 *     ArrowLeft at the last (listbox semantics);
 *   · Enter/Space activate ONLY when a tile is focused (never a stray press);
 *   · Escape exits the rail only when it holds focus — a page-level
 *     Escape-shortcut keeps working while the rail is not entered;
 *   · every key the model does not own is "none", and the wiring must not
 *     preventDefault it, so the editor's own shortcuts never break;
 *   · the roving tabIndex puts exactly ONE tab stop in the rail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { quickSelectKeyNav, quickSelectRovingTabIndex } from "./quickSelectKeyboardNavigation";

const nav = (key: string, index: number | null, count: number) =>
  quickSelectKeyNav(key, { index, count });

describe("arrow movement wraps and never dead-ends", () => {
  it("ArrowRight from null enters at the first tile; from the last it wraps", () => {
    expect(nav("ArrowRight", null, 5)).toEqual({ action: "move", index: 0 });
    expect(nav("ArrowRight", 3, 5)).toEqual({ action: "move", index: 4 });
    expect(nav("ArrowRight", 4, 5)).toEqual({ action: "move", index: 0 });
  });

  it("ArrowLeft from null enters at the LAST tile; from the first it wraps", () => {
    expect(nav("ArrowLeft", null, 5)).toEqual({ action: "move", index: 4 });
    expect(nav("ArrowLeft", 1, 5)).toEqual({ action: "move", index: 0 });
    expect(nav("ArrowLeft", 0, 5)).toEqual({ action: "move", index: 4 });
  });

  it("Home and End go to the ends whatever the current focus", () => {
    expect(nav("Home", 3, 9)).toEqual({ action: "move", index: 0 });
    expect(nav("End", 3, 9)).toEqual({ action: "move", index: 8 });
    expect(nav("Home", null, 9)).toEqual({ action: "move", index: 0 });
  });

  it("a single tile wraps to itself — the smallest rail still works", () => {
    expect(nav("ArrowRight", 0, 1)).toEqual({ action: "move", index: 0 });
    expect(nav("ArrowLeft", 0, 1)).toEqual({ action: "move", index: 0 });
  });
});

describe("activation and exit are deliberate", () => {
  it("Enter and Space activate the focused tile only", () => {
    expect(nav("Enter", 2, 5)).toEqual({ action: "activate", index: 2 });
    expect(nav(" ", 2, 5)).toEqual({ action: "activate", index: 2 });
    expect(nav("Enter", null, 5).action).toBe("none");
    expect(nav(" ", null, 5).action).toBe("none");
  });

  it("Escape exits only when the rail holds focus", () => {
    expect(nav("Escape", 2, 5)).toEqual({ action: "exit" });
    expect(nav("Escape", null, 5).action).toBe("none");
  });

  it("keys the model does not own are none — typing and shortcuts never break", () => {
    for (const key of ["a", "1", "Tab", "ArrowUp", "ArrowDown", "Backspace", "/"]) {
      expect(nav(key, 2, 5).action, `key "${key}"`).toBe("none");
    }
  });

  it("an empty rail owns no key at all", () => {
    expect(nav("ArrowRight", null, 0).action).toBe("none");
    expect(nav("Enter", 0, 0).action).toBe("none");
  });
});

describe("the roving tabIndex puts exactly one tab stop in the rail", () => {
  it("un-entered: the first tile is the rail's tab stop", () => {
    expect(quickSelectRovingTabIndex(null, 0)).toBe(0);
    expect(quickSelectRovingTabIndex(null, 1)).toBe(-1);
    expect(quickSelectRovingTabIndex(null, 4)).toBe(-1);
  });

  it("focused: the focused tile is the tab stop and only it", () => {
    expect(quickSelectRovingTabIndex(3, 0)).toBe(-1);
    expect(quickSelectRovingTabIndex(3, 3)).toBe(0);
    expect(quickSelectRovingTabIndex(3, 4)).toBe(-1);
  });
});

/** No browser in this container — the strip wiring is pinned by source. */
describe("the strip wiring (source contract)", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

  it("the tile rail carries the keydown model, roving focus and a real tab stop", () => {
    const strip = read("../components/radiology/zai-workspace/quick-select-strip.tsx");
    // The model drives the handler.
    expect(strip).toMatch(/quickSelectKeyNav/);
    expect(strip).toMatch(/quickSelectRovingTabIndex/);
    // The container only swallows keys the model owns.
    expect(strip).toMatch(/if \(nav\.action === "none"\) return;/);
    // The chip is focusable and addressed by position.
    expect(strip).toMatch(/data-qs-focus-index=\{chipPosition\}/);
    expect(strip).toMatch(/role="button"/);
    expect(strip).toMatch(/tabIndex=\{focusTabIndex \?\? -1\}/);
    // Inner buttons keep their own keys.
    expect(strip).toMatch(/closest\("button"\)/);
    // Escape returns focus somewhere useful.
    expect(strip).toMatch(/Quick select search/);
  });
});
