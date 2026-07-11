import { describe, it, expect } from "vitest";
import { isStaleVoiceResult, voiceKeyAction, type VoiceKeyState } from "./voiceSessionState";
import { matchWorkspaceShortcut } from "./workspaceReportState";

// Ticket M1.6B2 Phase 5/8 — staleness binding + voice keyboard rules, and
// the non-conflict contract with the pinned M1.4/M1.5 shortcut matrix.

describe("stale-result binding (Phase 5)", () => {
  it("a result is stale when the study changed OR a newer capture started", () => {
    expect(isStaleVoiceResult({ studyId: 7, nonce: 3 }, 7, 3)).toBe(false);
    expect(isStaleVoiceResult({ studyId: 7, nonce: 3 }, 8, 3)).toBe(true);  // study switch
    expect(isStaleVoiceResult({ studyId: 7, nonce: 3 }, 7, 4)).toBe(true);  // superseded capture
    expect(isStaleVoiceResult({ studyId: null, nonce: 1 }, null, 1)).toBe(false);
    expect(isStaleVoiceResult({ studyId: 7, nonce: 1 }, null, 1)).toBe(true);
  });
});

const state = (over: Partial<VoiceKeyState> = {}): VoiceKeyState => ({
  enabled: true, pttKey: "Space", capturing: false,
  hasPendingPreview: false, confirmViaEnterAllowed: false,
  ...over,
});

const body = { tagName: "BODY" };
const textarea = { tagName: "TEXTAREA" };

describe("voiceKeyAction (Phase 8)", () => {
  it("Ctrl/Cmd+Space toggles listening anywhere", () => {
    expect(voiceKeyAction({ key: " ", ctrlKey: true, target: body }, state())).toBe("toggle-listen");
    expect(voiceKeyAction({ key: " ", metaKey: true, target: textarea }, state())).toBe("toggle-listen");
    expect(voiceKeyAction({ key: " ", ctrlKey: true, shiftKey: true, target: body }, state())).toBeNull();
  });

  it("plain Space is push-to-talk ONLY outside typing/interactive elements", () => {
    expect(voiceKeyAction({ key: " ", target: body }, state())).toBe("ptt-start");
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "BUTTON"]) {
      expect(voiceKeyAction({ key: " ", target: { tagName } }, state()), tagName).toBeNull();
    }
    expect(voiceKeyAction({ key: " ", target: { tagName: "DIV", isContentEditable: true } }, state())).toBeNull();
  });

  it("Space PTT respects repeat, the off setting, and active capture/preview", () => {
    expect(voiceKeyAction({ key: " ", repeat: true, target: body }, state())).toBeNull();
    expect(voiceKeyAction({ key: " ", target: body }, state({ pttKey: "off" }))).toBeNull();
    expect(voiceKeyAction({ key: " ", target: body }, state({ capturing: true }))).toBeNull();
    expect(voiceKeyAction({ key: " ", target: body }, state({ hasPendingPreview: true }))).toBeNull();
  });

  it("Enter confirms ONLY a pending preview that allows it, outside typing", () => {
    const pending = state({ hasPendingPreview: true, confirmViaEnterAllowed: true });
    expect(voiceKeyAction({ key: "Enter", target: body }, pending)).toBe("confirm-pending");
    // HIGH_RISK previews set confirmViaEnterAllowed=false → Enter does nothing
    expect(voiceKeyAction({ key: "Enter", target: body }, state({ hasPendingPreview: true }))).toBeNull();
    expect(voiceKeyAction({ key: "Enter", target: textarea }, pending)).toBeNull();
    expect(voiceKeyAction({ key: "Enter", ctrlKey: true, target: body }, pending)).toBeNull(); // Ctrl+Enter stays finalize
    expect(voiceKeyAction({ key: "Enter", target: body }, state())).toBeNull();
  });

  it("Escape cancels only while capturing/previewing — otherwise falls through", () => {
    expect(voiceKeyAction({ key: "Escape", target: body }, state({ capturing: true }))).toBe("cancel");
    expect(voiceKeyAction({ key: "Escape", target: body }, state({ hasPendingPreview: true }))).toBe("cancel");
    expect(voiceKeyAction({ key: "Escape", target: body }, state())).toBeNull();
  });

  it("everything is inert when voice is disabled/unavailable", () => {
    const off = state({ enabled: false, capturing: true, hasPendingPreview: true, confirmViaEnterAllowed: true });
    for (const key of [" ", "Enter", "Escape"]) {
      expect(voiceKeyAction({ key, target: body }, off)).toBeNull();
      expect(voiceKeyAction({ key, ctrlKey: true, target: body }, off)).toBeNull();
    }
  });
});

describe("no conflicts with the pinned workspace shortcut matrix", () => {
  it("voice keys are invisible to matchWorkspaceShortcut and vice versa", () => {
    // The keys voice claims are FREE in the existing matrix…
    expect(matchWorkspaceShortcut({ key: " ", ctrlKey: true, target: body })).toBeNull();
    expect(matchWorkspaceShortcut({ key: " ", target: body })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "Enter", target: body })).toBeNull();
    // …and the existing combos never trigger a voice action.
    const s = state({ hasPendingPreview: true, confirmViaEnterAllowed: true, capturing: true });
    expect(voiceKeyAction({ key: "s", ctrlKey: true, target: body }, s)).toBeNull();      // Ctrl+S save
    expect(voiceKeyAction({ key: "Enter", ctrlKey: true, target: body }, s)).toBeNull();  // Ctrl+Enter finalize
    expect(voiceKeyAction({ key: "k", ctrlKey: true, target: body }, s)).toBeNull();      // Ctrl+K quickselect
    expect(voiceKeyAction({ key: "n", ctrlKey: true, shiftKey: true, target: body }, s)).toBeNull();
    expect(voiceKeyAction({ key: "o", altKey: true, target: body }, s)).toBeNull();       // Alt+O open study
    expect(voiceKeyAction({ key: "/", target: body }, s)).toBeNull();
  });

  it("Escape stays owned by the workspace when voice is idle", () => {
    expect(voiceKeyAction({ key: "Escape", target: body }, state())).toBeNull();
    expect(matchWorkspaceShortcut({ key: "Escape", target: body })).toBe("escape");
  });
});
