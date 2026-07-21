import { describe, it, expect } from "vitest";
import { resolveShortcut, isTypingTarget, USG_SHORTCUTS } from "./usgKeyboard";

const ev = (over: Partial<{ key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }>) =>
  ({ key: "", shiftKey: false, metaKey: false, ctrlKey: false, ...over });

describe("P2.9 keyboard suppression", () => {
  it("plain-key shortcuts are suppressed while typing", () => {
    for (const k of ["n", "f", "e", "m", "]", "["]) {
      expect(resolveShortcut(ev({ key: k }), { typing: true, readOnly: false })).toBeNull();
      expect(resolveShortcut(ev({ key: k }), { typing: false, readOnly: false })).not.toBeNull();
    }
  });

  it("modifier shortcuts fire even while typing", () => {
    expect(resolveShortcut(ev({ key: "s", metaKey: true }), { typing: true, readOnly: false })).toBe("save_draft");
    expect(resolveShortcut(ev({ key: "Enter", ctrlKey: true }), { typing: true, readOnly: false })).toBe("finalize");
  });

  it("editing shortcuts are disabled in read-only, navigation still works", () => {
    expect(resolveShortcut(ev({ key: "n" }), { typing: false, readOnly: true })).toBeNull();       // mark_normal (editing)
    expect(resolveShortcut(ev({ key: "f" }), { typing: false, readOnly: true })).toBeNull();       // open_builder (editing)
    expect(resolveShortcut(ev({ key: "s", metaKey: true }), { typing: false, readOnly: true })).toBeNull(); // save (editing)
    expect(resolveShortcut(ev({ key: "]" }), { typing: false, readOnly: true })).toBe("next_organ"); // nav ok
    expect(resolveShortcut(ev({ key: "m" }), { typing: false, readOnly: true })).toBe("open_measurements"); // read-only ok
  });

  it("shift+N is normal-all-remaining", () => {
    expect(resolveShortcut(ev({ key: "N", shiftKey: true }), { typing: false, readOnly: false })).toBe("normal_all");
  });

  it("isTypingTarget detects fields and contenteditable", () => {
    expect(isTypingTarget("INPUT")).toBe(true);
    expect(isTypingTarget("TEXTAREA")).toBe(true);
    expect(isTypingTarget("SELECT")).toBe(true);
    expect(isTypingTarget("DIV")).toBe(false);
    expect(isTypingTarget("DIV", true)).toBe(true);
  });

  it("bare shortcut letters do not collide with organ-jump hotkeys", () => {
    const organLetters = new Set(["L", "G", "B", "P", "S", "R", "K", "U", "T", "W", "O", "V"]);
    const plainLetters = USG_SHORTCUTS.filter((s) => !s.modifier && /^[A-Z]$/.test(s.combo)).map((s) => s.combo);
    for (const l of plainLetters) expect(organLetters.has(l)).toBe(false);
  });
});
