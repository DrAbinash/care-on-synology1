import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clinicalHistoryRefusal,
  shouldHandleClinicalRedoShortcut,
  shouldHandleClinicalUndoShortcut,
} from "./reportingWorkspaceShortcuts";

/**
 * Stage C Phase 1 · the clinical history keystrokes, pinned as a pure matrix.
 *
 * Redo is worthless if only a keystroke can reach it, and the keystroke was already occupied:
 * `Ctrl+Shift+Z` had been bound to stepping *backwards*. Rebinding it is a change to a muscle-memory
 * control on a live reporting workstation, so it is pinned here rather than trusted to a click test —
 * the handler is bound in the capture phase, which means an editor-focus guard is the only thing
 * standing between a radiologist undoing a stray comma and the clinical ledger rolling back an
 * observation underneath them.
 *
 * The fixtures are the real modifier shapes a keyboard produces, not a subset chosen to pass.
 */

type Key = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
};

const outside = null;
const inFindings = { tagName: "DIV", isContentEditable: true };
const inTextarea = { tagName: "TEXTAREA" };
const inSelect = { tagName: "SELECT" };
const inNestedEditor = {
  tagName: "B",
  isContentEditable: false,
  closest: (sel: string) => (sel === "[contenteditable='true']" ? { tagName: "DIV" } : null),
};

const undoKeys: Key[] = [
  { key: "z", ctrlKey: true, target: outside },
  { key: "Z", ctrlKey: true, target: outside },
  { key: "z", metaKey: true, target: outside },
];
const redoKeys: Key[] = [
  { key: "z", ctrlKey: true, shiftKey: true, target: outside },
  { key: "Z", metaKey: true, shiftKey: true, target: outside },
  { key: "y", ctrlKey: true, target: outside },
];

describe("Stage C Phase 1 · the two directions claim the keyboard exactly once", () => {
  it("binds Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z plus Ctrl+Y to redo", () => {
    for (const k of undoKeys) {
      expect(shouldHandleClinicalUndoShortcut(k), JSON.stringify(k)).toBe(true);
      expect(shouldHandleClinicalRedoShortcut(k), JSON.stringify(k)).toBe(false);
    }
    for (const k of redoKeys) {
      expect(shouldHandleClinicalRedoShortcut(k), JSON.stringify(k)).toBe(true);
      expect(shouldHandleClinicalUndoShortcut(k), JSON.stringify(k)).toBe(false);
    }
  });

  it("never lets one keystroke mean both directions, across every modifier combination", () => {
    // Exhaustive rather than enumerated: the defect this prevents is a key that fires undo AND redo in
    // the same handler, which walks the report back one step and forward again and looks like nothing
    // happened. Every reachable combination of the four modifiers × the keys a hand rests on.
    const keys = ["z", "Z", "y", "Y", "x", "s", "a", "Enter", "Shift", "Tab"];
    const flags = [false, true];
    let both = 0;
    let checked = 0;
    for (const key of keys) {
      for (const ctrlKey of flags) {
        for (const metaKey of flags) {
          for (const shiftKey of flags) {
            for (const altKey of flags) {
              const e = { key, ctrlKey, metaKey, shiftKey, altKey, target: outside };
              const u = shouldHandleClinicalUndoShortcut(e);
              const r = shouldHandleClinicalRedoShortcut(e);
              checked += 1;
              if (u && r) both += 1;
              // Alt is a modifier the workspace already owns elsewhere (Alt+U undo-last-abnormal,
              // Alt+1..9 section jumps), so no history direction may claim it.
              if (altKey) expect(u || r, `Alt is taken: ${JSON.stringify(e)}`).toBe(false);
            }
          }
        }
      }
    }
    expect(both, "a keystroke that means both directions silently cancels itself").toBe(0);
    expect(checked, "the matrix really enumerated every combination").toBe(keys.length * 16);
  });

  it("leaves the editor's own undo/redo to the browser", () => {
    // This is the patient-safety half. Findings, Impression and Recommendation are contenteditable;
    // the handler runs in the capture phase; without this guard one keystroke rewrites clinical state
    // while the radiologist believes they are correcting a word.
    for (const target of [inFindings, inTextarea, inSelect, inNestedEditor]) {
      const shape = JSON.stringify(Object.keys(target));
      expect(shouldHandleClinicalUndoShortcut({ key: "z", ctrlKey: true, target }), shape).toBe(false);
      expect(shouldHandleClinicalRedoShortcut({ key: "z", ctrlKey: true, shiftKey: true, target }), shape).toBe(false);
      expect(shouldHandleClinicalRedoShortcut({ key: "y", ctrlKey: true, target }), shape).toBe(false);
    }
  });

  it("does not claim Cmd+Y, which macOS gives to the system", () => {
    expect(shouldHandleClinicalRedoShortcut({ key: "y", metaKey: true, target: outside })).toBe(false);
    expect(shouldHandleClinicalRedoShortcut({ key: "y", ctrlKey: true, target: outside })).toBe(true);
  });

  it("does not claim a bare Z, so typing is never a clinical action", () => {
    expect(shouldHandleClinicalUndoShortcut({ key: "z", target: outside })).toBe(false);
    expect(shouldHandleClinicalRedoShortcut({ key: "z", shiftKey: true, target: outside })).toBe(false);
  });
});

describe("Stage C Phase 1 · a refused step says which refusal it was", () => {
  const frame = { activeStudyId: "study-A" };
  const here = { activeStudyId: "study-A", isFinalized: false };

  for (const direction of ["undo", "redo"] as const) {
    it(`${direction}: stays silent when the step happened or there was nothing to step to`, () => {
      expect(clinicalHistoryRefusal(direction, true, frame, here), "a completed step needs no notice").toBeNull();
      expect(clinicalHistoryRefusal(direction, false, null, here), "an empty stack is not an error").toBeNull();
    });

    it(`${direction}: names the other study, because that is what protected this patient`, () => {
      const r = clinicalHistoryRefusal(direction, false, frame, { ...here, activeStudyId: "study-B" });
      expect(r?.title).toContain(direction === "undo" ? "Undo" : "Redo");
      expect(r?.title).toMatch(/different study/);
      expect(r?.description).toMatch(/Nothing was changed/);
    });

    it(`${direction}: names the signature and the recovery that really exists`, () => {
      const r = clinicalHistoryRefusal(direction, false, frame, { ...here, isFinalized: true });
      expect(r?.title).toMatch(/signed/);
      // The owner ruling on refusal wording (PR #863): a recovery may only be named if driving it
      // actually returns the report to a writable state. Report Hub's withdraw does exactly that.
      expect(r?.description).toMatch(/withdraw the signature/i);
    });

    it(`${direction}: reports the study mismatch first when both guards fired`, () => {
      const r = clinicalHistoryRefusal(direction, false, frame, { activeStudyId: "study-B", isFinalized: true });
      expect(r?.title, "the frame was refused before the signature was even consulted").toMatch(/different study/);
    });
  }
});

/**
 * What the radiologist can SEE and CLICK.
 *
 * This package has no render harness (`@testing-library/react` is not installed), so the honest
 * evidence here is a wiring contract, not a screenshot: it proves the controls exist in the component
 * that the workspace actually mounts, that their disabled state is bound to the history stacks rather
 * than hardcoded, and that each one names its own keystroke. It cannot prove they paint — that needs a
 * browser, and the delivery report says so instead of implying it. A previous defect in this repo was
 * exactly this shape: the payload and the type carried the fields and the JSX never used them.
 */
describe("Stage C Phase 1 · the controls are mounted where the report is written", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(join(here, "..", rel), "utf8").replace(/\r\n/g, "\n");
  const bar = read("components/radiology/ReportingStickyActionBar.tsx");
  const canvas = read("components/radiology/workspace/ReportCanvas.tsx");
  const palette = read("components/radiology/zai-workspace/command-palette.tsx");

  it("renders an Undo and a Redo control in the existing action bar, each disabled by its own stack", () => {
    // A control that is always enabled invites a click that does nothing; one whose `disabled` is a
    // literal `false` passes a grep for `disabled=` while telling the radiologist nothing.
    for (const [testid, flag, label] of [
      ["sticky-undo-step", "canUndoStep", "Undo last clinical change"],
      ["sticky-redo-step", "canRedoStep", "Redo last undone clinical change"],
    ] as const) {
      const at = bar.indexOf(`data-testid="${testid}"`);
      expect(at, testid + " must exist in the bar the workspace mounts").toBeGreaterThan(-1);
      const button = bar.slice(bar.lastIndexOf("<Button", at), at + 60);
      expect(button, testid + " must be disabled by the history, not by a constant").toContain(`={!${flag}}`);
      expect(button, testid + " is icon-only, so its name has to travel in the accessible label")
        .toContain(`aria-label="${label}"`);
      expect(button, testid + " must name the keystroke it stands for").toMatch(/title="[^"]*(Ctrl|⌘)/);
    }
    expect(bar.match(/data-testid="sticky-(undo|redo)-step"/g) ?? []).toHaveLength(2);
  });

  it("the workspace passes all four props, so the bar is not rendering a dead pair of buttons", () => {
    for (const prop of ["canUndoStep={undoStepEnabled}", "canRedoStep={redoStepEnabled}",
      "onUndoStep={handleUndoStep}", "onRedoStep={handleRedoStep}"]) {
      expect(canvas, prop + " is not wired at the call site").toContain(prop);
    }
  });

  it("the palette teaches the real keystrokes, and no longer claims Shift+Z for undo", () => {
    const undoEntry = palette.slice(palette.indexOf('id: "undo-patch"'), palette.indexOf('id: "redo-patch"'));
    const redoEntry = palette.slice(palette.indexOf('id: "redo-patch"'), palette.indexOf('id: "redo-patch"') + 320);
    expect(undoEntry).toContain('shortcut: "⌃Z"');
    expect(undoEntry).toContain("undoLastPatch()");
    expect(undoEntry, "the old label promised Shift+Z for undo; that key is now redo")
      .not.toContain("⌃⇧Z");
    expect(redoEntry).toContain("redoLastPatch()");
    expect(redoEntry).toContain("⌃⇧Z");
  });
});
