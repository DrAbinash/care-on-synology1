import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "./reportingShortcutHelp";
import { matchWorkspaceShortcut } from "./workspaceReportState";

/**
 * U12 contract pins — the `?` help overlay must agree with the real shortcut
 * matrix. The old rows advertised an "Alt + 1–9 → Toggle Nth finding" that no
 * code implemented (Alt+digits jump report sections) and omitted real
 * shortcuts, so a keyboard-first radiologist trusting the overlay got section
 * jumps mid-report. Every advertised matrix-combo below is pinned to what
 * matchWorkspaceShortcut actually returns; changing either side breaks CI.
 */
function row(keys: string): { keys: string; action: string } {
  for (const g of SHORTCUT_GROUPS) {
    const r = g.rows.find((x) => x.keys === keys);
    if (r) return r;
  }
  throw new Error(`no help row for ${keys}`);
}

const OUTSIDE_TEXT = { tagName: "DIV", isContentEditable: false } as const;

describe("shortcut help ↔ matrix contract (U12)", () => {
  it("every advertised matrix combo does what its row says", () => {
    expect(matchWorkspaceShortcut({ key: "s", ctrlKey: true, target: OUTSIDE_TEXT })).toBe("save");
    expect(matchWorkspaceShortcut({ key: "p", ctrlKey: true, target: OUTSIDE_TEXT })).toBe("print");
    expect(matchWorkspaceShortcut({ key: "Enter", ctrlKey: true, target: OUTSIDE_TEXT })).toBe("finalize");
    expect(matchWorkspaceShortcut({ key: "n", ctrlKey: true, shiftKey: true, target: OUTSIDE_TEXT })).toBe("next-study");
    expect(matchWorkspaceShortcut({ key: "p", ctrlKey: true, shiftKey: true, target: OUTSIDE_TEXT })).toBe("previous-study");
    expect(matchWorkspaceShortcut({ key: "k", ctrlKey: true, shiftKey: true, target: OUTSIDE_TEXT })).toBe("park-study");
    expect(matchWorkspaceShortcut({ key: "f", ctrlKey: true, shiftKey: true, target: OUTSIDE_TEXT })).toBe("focus-mode");
    expect(matchWorkspaceShortcut({ key: "[", altKey: true, target: OUTSIDE_TEXT })).toBe("toggle-left-panel");
    expect(matchWorkspaceShortcut({ key: "]", altKey: true, target: OUTSIDE_TEXT })).toBe("toggle-right-panel");
    expect(matchWorkspaceShortcut({ key: "\\", altKey: true, target: OUTSIDE_TEXT })).toBe("toggle-viewer");
    expect(matchWorkspaceShortcut({ key: "o", altKey: true, target: OUTSIDE_TEXT })).toBe("open-study");
    expect(matchWorkspaceShortcut({ key: "/", target: OUTSIDE_TEXT })).toBe("quickselect");
    expect(row("Ctrl + S").action).toBe("Save draft");
    expect(row("Ctrl + P").action).toBe("Print like final");
    expect(row("Ctrl + Enter").action).toBe("Finalize report");
    expect(row("Ctrl + Shift + N").action).toBe("Next study");
    expect(row("Ctrl + Shift + P").action).toBe("Previous study");
    expect(row("Ctrl + Shift + K").action).toBe("Park study");
  });

  it("bare P is previous-study, NOT park — the old 'Park (P)' lie, pinned", () => {
    expect(matchWorkspaceShortcut({ key: "p", target: OUTSIDE_TEXT })).toBe("previous-study");
    expect(matchWorkspaceShortcut({ key: "n", target: OUTSIDE_TEXT })).toBe("next-study");
    expect(matchWorkspaceShortcut({ key: "q", target: OUTSIDE_TEXT })).toBe("toggle-left-panel");
    expect(row("P").action).toContain("Previous study");
  });

  it("the Alt+1–9 row tells the truth: report sections, not a finding toggle", () => {
    const altRow = row("Alt + 1–9");
    expect(altRow.action).toContain("section");
    expect(altRow.action).not.toMatch(/finding/i);
    // Alt+digits are owned by useWorkspaceCommands' section-jump handler, not
    // the matrix — the matrix must not claim them.
    expect(matchWorkspaceShortcut({ key: "3", altKey: true, target: OUTSIDE_TEXT })).toBeNull();
  });

  it("the Ctrl+1–9 row names both real owners of the combo", () => {
    const rowText = row("Ctrl + 1–9").action;
    expect(rowText).toContain("study tab");
    expect(rowText).toContain("template");
  });

  it("Ctrl+1–6 templates fire outside the Quick Add panel and yield inside it (U12 double-fire fix)", () => {
    expect(matchWorkspaceShortcut({ key: "2", ctrlKey: true, target: OUTSIDE_TEXT })).toBe("select-template-2");
    const insidePanel = {
      tagName: "BUTTON",
      isContentEditable: false,
      closest: (sel: string) => (sel === "[data-quick-findings-panel]" ? ({} as Element) : null),
    };
    expect(matchWorkspaceShortcut({ key: "2", ctrlKey: true, target: insidePanel })).toBeNull();
    // A target without closest() (plain test objects, non-DOM callers) keeps
    // the pre-existing template behavior.
    expect(matchWorkspaceShortcut({ key: "2", ctrlKey: true, target: { tagName: "BUTTON" } })).toBe("select-template-2");
    // Still suppressed while typing, as before.
    expect(matchWorkspaceShortcut({ key: "2", ctrlKey: true, target: { tagName: "INPUT" } })).toBeNull();
  });

  it("real shortcuts the old overlay omitted are now listed", () => {
    for (const keys of ["Ctrl + I", "Ctrl + Shift + V", "Alt + U", "N", "P", "Q", "Ctrl + Z", "Ctrl + Shift + Z / Ctrl + Y"]) {
      expect(() => row(keys)).not.toThrow();
    }
  });
});
