import { describe, it, expect, afterEach, vi } from "vitest";
import {
  clampLeftPct,
  clampRightPct,
  defaultModeState,
  defaultWorkspaceLayoutPrefs,
  DEFAULT_LAYOUT_MODE,
  fallbackModeWhenPopupBlocked,
  isWorkspaceLayoutMode,
  layoutModalityBucket,
  LEFT_COLLAPSED_PCT,
  LEFT_MAX_PCT,
  LEFT_MIN_PCT,
  loadWorkspaceLayoutPrefs,
  parseWorkspaceLayoutPrefs,
  resolveLayoutModeForModality,
  RIGHT_COLLAPSED_PCT,
  RIGHT_MAX_PCT,
  RIGHT_MIN_PCT,
  saveWorkspaceLayoutPrefs,
  shouldShowEmbeddedViewer,
  withModalityLayoutMode,
  workspaceLayoutStorageKey,
} from "./workspaceLayoutPrefs";

// Runs under vitest's node environment (no jsdom, no `window`) — this repo
// has no React testing-library set up, so these pure functions carry the
// actual layout-persistence logic (mirrors radiologyDraftId.test.ts /
// billPrintSettings.test.ts). The component only wires them to useState.

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shouldShowEmbeddedViewer — Phase 2 mode contract", () => {
  it("shows the viewer only in split and viewerFocus", () => {
    expect(shouldShowEmbeddedViewer("split")).toBe(true);
    expect(shouldShowEmbeddedViewer("viewerFocus")).toBe(true);
  });

  it("hides the viewer in reportFocus and dualScreen", () => {
    expect(shouldShowEmbeddedViewer("reportFocus")).toBe(false);
    expect(shouldShowEmbeddedViewer("dualScreen")).toBe(false);
  });
});

describe("fallbackModeWhenPopupBlocked — dual-screen graceful fallback", () => {
  it("falls back to split view when the popup is blocked", () => {
    expect(fallbackModeWhenPopupBlocked("dualScreen")).toBe("split");
  });

  it("leaves every other mode unchanged", () => {
    expect(fallbackModeWhenPopupBlocked("reportFocus")).toBe("reportFocus");
    expect(fallbackModeWhenPopupBlocked("split")).toBe("split");
    expect(fallbackModeWhenPopupBlocked("viewerFocus")).toBe("viewerFocus");
  });
});

describe("clampLeftPct / clampRightPct — the report editor never gets crushed", () => {
  it("clamps below the minimum up to the floor", () => {
    expect(clampLeftPct(0)).toBe(LEFT_MIN_PCT);
    expect(clampRightPct(-5)).toBe(RIGHT_MIN_PCT);
  });

  it("clamps above the maximum down to the ceiling", () => {
    expect(clampLeftPct(99)).toBe(LEFT_MAX_PCT);
    expect(clampRightPct(99)).toBe(RIGHT_MAX_PCT);
  });

  it("passes through in-range values unchanged", () => {
    expect(clampLeftPct(30)).toBe(30);
    expect(clampRightPct(25)).toBe(25);
  });

  it("non-finite input falls back to the minimum rather than NaN leaking into layout math", () => {
    expect(clampLeftPct(NaN)).toBe(LEFT_MIN_PCT);
    expect(clampRightPct(Infinity)).toBe(RIGHT_MIN_PCT);
  });
});

describe("isWorkspaceLayoutMode", () => {
  it("accepts the four defined modes", () => {
    expect(isWorkspaceLayoutMode("reportFocus")).toBe(true);
    expect(isWorkspaceLayoutMode("split")).toBe(true);
    expect(isWorkspaceLayoutMode("viewerFocus")).toBe(true);
    expect(isWorkspaceLayoutMode("dualScreen")).toBe(true);
  });

  it("rejects anything else, including legacy/garbage values", () => {
    expect(isWorkspaceLayoutMode("fullscreen")).toBe(false);
    expect(isWorkspaceLayoutMode(null)).toBe(false);
    expect(isWorkspaceLayoutMode(42)).toBe(false);
    expect(isWorkspaceLayoutMode(undefined)).toBe(false);
  });
});

describe("defaultWorkspaceLayoutPrefs", () => {
  it("defaults to split so the embedded OHIF viewer is visible on first visit", () => {
    expect(DEFAULT_LAYOUT_MODE).toBe("split");
    expect(defaultWorkspaceLayoutPrefs().mode).toBe("split");
  });
});

describe("defaultModeState — Phase 3 target proportions", () => {
  it("Report Focus's compact width matches the 18-22% target and both panels start collapsed", () => {
    expect(LEFT_COLLAPSED_PCT).toBeGreaterThanOrEqual(18);
    expect(LEFT_COLLAPSED_PCT).toBeLessThanOrEqual(22);
    const s = defaultModeState("reportFocus");
    expect(s.leftCollapsed).toBe(true);
    expect(s.rightCollapsed).toBe(true);
  });

  it("Dual Screen also starts with both panels collapsed (viewer lives in the second window)", () => {
    const s = defaultModeState("dualScreen");
    expect(s.leftCollapsed).toBe(true);
    expect(s.rightCollapsed).toBe(true);
  });

  it("Split View starts with the left (viewer) panel expanded", () => {
    const s = defaultModeState("split");
    expect(s.leftCollapsed).toBe(false);
  });

  it("Viewer Focus gives the left/viewer column more width than Split View", () => {
    expect(defaultModeState("viewerFocus").left).toBeGreaterThan(defaultModeState("split").left);
  });

  it("every mode's stored expanded widths already fall inside the clamped range", () => {
    for (const mode of ["reportFocus", "split", "viewerFocus", "dualScreen"] as const) {
      const s = defaultModeState(mode);
      expect(s.left).toBe(clampLeftPct(s.left));
      expect(s.right).toBe(clampRightPct(s.right));
    }
  });

  it("returns a fresh object each call — callers can't mutate the shared default", () => {
    const a = defaultModeState("split");
    a.left = 999;
    expect(defaultModeState("split").left).not.toBe(999);
  });
});

describe("collapsed vs. expanded width invariant", () => {
  it("collapsing a panel must actually free width — the collapsed snap size is strictly below the expanded minimum", () => {
    expect(LEFT_COLLAPSED_PCT).toBeLessThan(LEFT_MIN_PCT);
    expect(RIGHT_COLLAPSED_PCT).toBeLessThan(RIGHT_MIN_PCT);
  });
});

describe("parseWorkspaceLayoutPrefs — corrupt/missing input never breaks the workspace", () => {
  it("null/undefined/empty degrade to full defaults", () => {
    expect(parseWorkspaceLayoutPrefs(null)).toEqual(defaultWorkspaceLayoutPrefs());
    expect(parseWorkspaceLayoutPrefs(undefined)).toEqual(defaultWorkspaceLayoutPrefs());
    expect(parseWorkspaceLayoutPrefs("")).toEqual(defaultWorkspaceLayoutPrefs());
  });

  it("malformed JSON degrades to full defaults", () => {
    expect(parseWorkspaceLayoutPrefs("{not json")).toEqual(defaultWorkspaceLayoutPrefs());
  });

  it("non-object JSON degrades to full defaults", () => {
    expect(parseWorkspaceLayoutPrefs("[1,2,3]")).toEqual(defaultWorkspaceLayoutPrefs());
    expect(parseWorkspaceLayoutPrefs("42")).toEqual(defaultWorkspaceLayoutPrefs());
  });

  it("an unknown/garbage mode string falls back to the default mode", () => {
    const parsed = parseWorkspaceLayoutPrefs(JSON.stringify({ mode: "theaterMode", byMode: {} }));
    expect(parsed.mode).toBe(defaultWorkspaceLayoutPrefs().mode);
  });

  it("a valid mode + partial byMode round-trips the known fields and fills in the rest", () => {
    const parsed = parseWorkspaceLayoutPrefs(JSON.stringify({
      mode: "viewerFocus",
      byMode: { viewerFocus: { left: 50, right: 30, leftCollapsed: false, rightCollapsed: false } },
    }));
    expect(parsed.mode).toBe("viewerFocus");
    expect(parsed.byMode.viewerFocus).toEqual({ left: 50, right: 30, leftCollapsed: false, rightCollapsed: false });
    // reportFocus wasn't in the blob — must still be present and sane, not undefined.
    expect(parsed.byMode.reportFocus).toEqual(defaultModeState("reportFocus"));
  });

  it("out-of-range stored widths are clamped back into the usable range", () => {
    const parsed = parseWorkspaceLayoutPrefs(JSON.stringify({
      mode: "split",
      byMode: { split: { left: 5, right: 95, leftCollapsed: false, rightCollapsed: false } },
    }));
    expect(parsed.byMode.split.left).toBe(LEFT_MIN_PCT);
    expect(parsed.byMode.split.right).toBe(RIGHT_MAX_PCT);
  });
});

describe("workspaceLayoutStorageKey — per-radiologist isolation", () => {
  it("scopes the key to the given user id", () => {
    expect(workspaceLayoutStorageKey(7)).not.toBe(workspaceLayoutStorageKey(8));
    expect(workspaceLayoutStorageKey(7)).toBe(workspaceLayoutStorageKey(7));
  });

  it("falls back to a shared anon slot when no user id is known yet", () => {
    expect(workspaceLayoutStorageKey(null)).toBe(workspaceLayoutStorageKey(undefined));
  });
});

describe("layoutModalityBucket / resolveLayoutModeForModality / withModalityLayoutMode", () => {
  it("buckets MR/CT/XR/US/MG correctly", () => {
    expect(layoutModalityBucket("MR")).toBe("MR");
    expect(layoutModalityBucket("MRI")).toBe("MR");
    expect(layoutModalityBucket("CT")).toBe("CT");
    expect(layoutModalityBucket("CTA")).toBe("CT");
    expect(layoutModalityBucket("XR")).toBe("XR");
    expect(layoutModalityBucket("CR")).toBe("XR");
    expect(layoutModalityBucket("DX")).toBe("XR");
    expect(layoutModalityBucket("USG")).toBe("US");
    expect(layoutModalityBucket("US")).toBe("US");
    expect(layoutModalityBucket("MG")).toBe("MG");
    expect(layoutModalityBucket("OT")).toBe("OTHER");
    expect(layoutModalityBucket("")).toBe("OTHER");
  });

  it("MR preference restores; XR preference does not affect MR", () => {
    let prefs = defaultWorkspaceLayoutPrefs();
    prefs = withModalityLayoutMode(prefs, "MR", "viewerFocus");
    prefs = withModalityLayoutMode(prefs, "XR", "reportFocus");
    expect(resolveLayoutModeForModality(prefs, "MRI")).toBe("viewerFocus");
    expect(resolveLayoutModeForModality(prefs, "CR")).toBe("reportFocus");
    expect(resolveLayoutModeForModality(prefs, "CT")).toBe(prefs.mode); // unknown bucket uses current mode after XR write
  });

  it("unknown modality uses default mode when no byModality entry", () => {
    const prefs = defaultWorkspaceLayoutPrefs();
    expect(resolveLayoutModeForModality(prefs, "NM")).toBe(DEFAULT_LAYOUT_MODE);
  });

  it("manual layout change updates saved preference for that modality", () => {
    stubLocalStorage();
    let prefs = defaultWorkspaceLayoutPrefs();
    prefs = withModalityLayoutMode(prefs, "USG", "reportFocus");
    saveWorkspaceLayoutPrefs(3, prefs);
    const loaded = loadWorkspaceLayoutPrefs(3);
    expect(resolveLayoutModeForModality(loaded, "US")).toBe("reportFocus");
  });

  it("missing/corrupt preference fails safely", () => {
    expect(parseWorkspaceLayoutPrefs("{bad")).toEqual(defaultWorkspaceLayoutPrefs());
    const partial = parseWorkspaceLayoutPrefs(JSON.stringify({ mode: "split", byMode: {}, byModality: { MR: "nope" } }));
    expect(partial.byModality.MR).toBeUndefined();
    expect(resolveLayoutModeForModality(partial, "MR")).toBe("split");
  });

  it("v1 blob without byModality still loads", () => {
    stubLocalStorage({
      "radiology_workspace_layout_v1:9": JSON.stringify({ mode: "viewerFocus", byMode: {} }),
    });
    const loaded = loadWorkspaceLayoutPrefs(9);
    expect(loaded.mode).toBe("viewerFocus");
    expect(loaded.byModality).toEqual({});
  });
});

describe("loadWorkspaceLayoutPrefs / saveWorkspaceLayoutPrefs — persistence round-trip", () => {
  it("loads defaults when nothing has ever been saved for this user", () => {
    stubLocalStorage();
    expect(loadWorkspaceLayoutPrefs(11)).toEqual(defaultWorkspaceLayoutPrefs());
  });

  it("save then load returns exactly what was saved, for that user only", () => {
    stubLocalStorage();
    const prefs = { ...defaultWorkspaceLayoutPrefs(), mode: "viewerFocus" as const };
    saveWorkspaceLayoutPrefs(11, prefs);
    expect(loadWorkspaceLayoutPrefs(11)).toEqual(prefs);
    // A different radiologist's browser profile is unaffected.
    expect(loadWorkspaceLayoutPrefs(12)).toEqual(defaultWorkspaceLayoutPrefs());
  });

  it("never throws when localStorage is unavailable (private browsing / SSR)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveWorkspaceLayoutPrefs(11, defaultWorkspaceLayoutPrefs())).not.toThrow();
    expect(loadWorkspaceLayoutPrefs(11)).toEqual(defaultWorkspaceLayoutPrefs());
  });

  it("never throws when localStorage.getItem itself throws (quota/security errors)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    });
    expect(() => saveWorkspaceLayoutPrefs(11, defaultWorkspaceLayoutPrefs())).not.toThrow();
    expect(loadWorkspaceLayoutPrefs(11)).toEqual(defaultWorkspaceLayoutPrefs());
  });
});
