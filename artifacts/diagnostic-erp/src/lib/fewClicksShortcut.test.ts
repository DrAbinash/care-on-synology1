/**
 * Few-clicks pass — pure shortcut/matcher units for the Ctrl+P print wiring.
 *
 * The rest of the click-reduction set is pinned in
 * hooks/radiology-workspace/fewClicks.contract.test.ts (source contracts);
 * these two functions are pure, so they get behavioural coverage here.
 *
 * The hazard under guard: Ctrl+Shift+P is "previous study" and bare P
 * (outside text entry) is ALSO "previous study". Ctrl+P must therefore be
 * matched with an explicit `!shift` guard, or the most common muscle-memory
 * print key would step the radiologist backwards in the reading queue
 * instead of printing the report.
 */
import { describe, expect, it } from "vitest";

import { matchWorkspaceShortcut } from "./workspaceReportState";
import { resolveWorkspaceShortcut } from "./workspaceShortcutResolve";
import { isWorkspaceCommand } from "./workspaceCommands";

describe("Ctrl+P → print (few-clicks pass)", () => {
  it("Ctrl+P / Cmd+P resolves to the print shortcut", () => {
    expect(matchWorkspaceShortcut({ key: "p", ctrlKey: true })).toBe("print");
    expect(matchWorkspaceShortcut({ key: "P", metaKey: true })).toBe("print");
    expect(matchWorkspaceShortcut({ key: "p", ctrlKey: true, shiftKey: false })).toBe("print");
  });

  it("shift stays exclusive: Ctrl+Shift+P remains 'previous study'", () => {
    expect(matchWorkspaceShortcut({ key: "p", ctrlKey: true, shiftKey: true })).toBe("previous-study");
  });

  it("bare P outside text entry remains 'previous study' (unchanged)", () => {
    expect(matchWorkspaceShortcut({ key: "p", target: { tagName: "BODY" } })).toBe("previous-study");
    // and typing in an editor still never navigates
    expect(matchWorkspaceShortcut({ key: "p", target: { tagName: "TEXTAREA" } })).toBeNull();
  });

  it("the shortcut resolves to a real dispatcher command", () => {
    const resolved = resolveWorkspaceShortcut("print");
    expect(resolved).toEqual({ kind: "command", command: "print" });
    expect(isWorkspaceCommand("print")).toBe(true);
  });

  it("print is reachable while typing — mod+P never produces text, so the findings editor must not swallow it", () => {
    expect(matchWorkspaceShortcut({ key: "p", ctrlKey: true, target: { tagName: "TEXTAREA" } })).toBe("print");
  });
});
