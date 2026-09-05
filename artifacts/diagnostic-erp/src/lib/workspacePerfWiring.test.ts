import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceShortcut,
  isWorkspaceTextEntryTarget,
} from "./workspaceShortcutResolve";
import { matchWorkspaceShortcut } from "./workspaceReportState";
import {
  readingQueueModalityFromParam,
  resolveReadingQueueModality,
  readStoredReadingQueueModality,
  writeStoredReadingQueueModality,
  READING_QUEUE_MODALITY_STORAGE_KEY,
} from "./readingQueueModality";

describe("resolveWorkspaceShortcut — shortcut ID → command ID", () => {
  it("remaps next/previous/park/quickselect/open-study to canonical commands", () => {
    expect(resolveWorkspaceShortcut("next-study")).toEqual({ kind: "command", command: "next" });
    expect(resolveWorkspaceShortcut("previous-study")).toEqual({ kind: "command", command: "previous" });
    expect(resolveWorkspaceShortcut("park-study")).toEqual({ kind: "command", command: "park" });
    expect(resolveWorkspaceShortcut("quickselect")).toEqual({
      kind: "command",
      command: "focus-quick-search",
    });
    expect(resolveWorkspaceShortcut("open-study")).toEqual({
      kind: "command",
      command: "open-viewer",
    });
  });

  it("passes through save/finalize/focus-mode unchanged", () => {
    expect(resolveWorkspaceShortcut("save")).toEqual({ kind: "command", command: "save" });
    expect(resolveWorkspaceShortcut("finalize")).toEqual({ kind: "command", command: "finalize" });
    expect(resolveWorkspaceShortcut("focus-mode")).toEqual({
      kind: "command",
      command: "focus-mode",
    });
  });

  it("routes panel/viewer/escape to layout actions (not dispatcher)", () => {
    expect(resolveWorkspaceShortcut("toggle-left-panel")).toEqual({
      kind: "layout",
      action: "toggle-left-panel",
    });
    expect(resolveWorkspaceShortcut("toggle-right-panel")).toEqual({
      kind: "layout",
      action: "toggle-right-panel",
    });
    expect(resolveWorkspaceShortcut("toggle-viewer")).toEqual({
      kind: "layout",
      action: "toggle-viewer",
    });
    expect(resolveWorkspaceShortcut("escape")).toEqual({ kind: "layout", action: "escape" });
  });

  it("end-to-end: matchWorkspaceShortcut → resolve → dispatchable command", () => {
    const next = matchWorkspaceShortcut({ key: "n", ctrlKey: true, shiftKey: true });
    expect(resolveWorkspaceShortcut(next)?.kind === "command"
      && resolveWorkspaceShortcut(next)?.kind === "command"
      ? resolveWorkspaceShortcut(next)
      : null).toEqual({ kind: "command", command: "next" });

    const qs = matchWorkspaceShortcut({ key: "k", ctrlKey: true });
    expect(resolveWorkspaceShortcut(qs)).toEqual({
      kind: "command",
      command: "focus-quick-search",
    });

    const viewer = matchWorkspaceShortcut({ key: "\\", altKey: true });
    expect(resolveWorkspaceShortcut(viewer)).toEqual({
      kind: "layout",
      action: "toggle-viewer",
    });
  });

  it("does not treat ordinary typing as shortcuts", () => {
    expect(matchWorkspaceShortcut({ key: "n", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "n", target: { tagName: "DIV" } })).toBe("next-study");
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(isWorkspaceTextEntryTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isWorkspaceTextEntryTarget({
      id: "ai-micro-command",
      tagName: "INPUT",
    } as unknown as EventTarget)).toBe(true);
  });

  it("AI instruction field is recognized as text-entry (handlers must not steal)", () => {
    expect(isWorkspaceTextEntryTarget({
      id: "ai-micro-command",
      tagName: "TEXTAREA",
    } as unknown as EventTarget)).toBe(true);
  });
});

describe("reading queue modality deep links", () => {
  function memoryStorage(initial: Record<string, string> = {}): Storage {
    const map = new Map(Object.entries(initial));
    return {
      get length() { return map.size; },
      clear() { map.clear(); },
      getItem(k: string) { return map.has(k) ? map.get(k)! : null; },
      setItem(k: string, v: string) { map.set(k, String(v)); },
      removeItem(k: string) { map.delete(k); },
      key() { return null; },
    };
  }

  it("normalizes USG → US and accepts MR|CT|XR", () => {
    expect(readingQueueModalityFromParam("USG")).toBe("US");
    expect(readingQueueModalityFromParam("usg")).toBe("US");
    expect(readingQueueModalityFromParam("MR")).toBe("MR");
    expect(readingQueueModalityFromParam("CT")).toBe("CT");
    expect(readingQueueModalityFromParam("XR")).toBe("XR");
  });

  it("invalid/ambiguous values fall back without guessing", () => {
    expect(readingQueueModalityFromParam("OT")).toBeNull();
    expect(readingQueueModalityFromParam("NM")).toBeNull();
    expect(readingQueueModalityFromParam("")).toBeNull();
    expect(readingQueueModalityFromParam(null)).toBeNull();
    expect(readingQueueModalityFromParam("not-a-modality")).toBeNull();
  });

  it("deep link wins over storage; missing deep link uses storage", () => {
    const s = memoryStorage({ [READING_QUEUE_MODALITY_STORAGE_KEY]: "CT" });
    expect(resolveReadingQueueModality({ search: "?modality=MR", storage: s })).toEqual({
      modality: "MR",
      fromDeepLink: true,
    });
    expect(resolveReadingQueueModality({ search: "", storage: s })).toEqual({
      modality: "CT",
      fromDeepLink: false,
    });
    expect(resolveReadingQueueModality({ search: "?modality=OT", storage: s })).toEqual({
      modality: "CT",
      fromDeepLink: false,
    });
  });

  it("persists normalized queue choice", () => {
    const s = memoryStorage();
    writeStoredReadingQueueModality(s, "US");
    expect(readStoredReadingQueueModality(s)).toBe("US");
    expect(s.getItem(READING_QUEUE_MODALITY_STORAGE_KEY)).toBe("US");
  });
});
