import { describe, it, expect } from "vitest";
import {
  isStaleVoiceResult,
  shouldDiscardVoiceOnStudyChange,
  deriveVoiceUiState,
  voiceUiStatusLabel,
  voiceKeyAction,
  type VoiceKeyState,
} from "./voiceSessionState";
import { matchWorkspaceShortcut } from "./workspaceReportState";

describe("stale-result binding (Phase 5)", () => {
  it("a result is stale when the study changed OR a newer capture started", () => {
    expect(isStaleVoiceResult({ studyId: 7, nonce: 3 }, 7, 3)).toBe(false);
    expect(isStaleVoiceResult({ studyId: 7, nonce: 3 }, 8, 3)).toBe(true);
    expect(isStaleVoiceResult({ studyId: 7, nonce: 3 }, 7, 4)).toBe(true);
    expect(isStaleVoiceResult({ studyId: null, nonce: 1 }, null, 1)).toBe(false);
    expect(isStaleVoiceResult({ studyId: 7, nonce: 1 }, null, 1)).toBe(true);
  });

  it("study switch always discards prior voice session", () => {
    expect(shouldDiscardVoiceOnStudyChange(1, 2)).toBe(true);
    expect(shouldDiscardVoiceOnStudyChange(1, 1)).toBe(false);
    expect(shouldDiscardVoiceOnStudyChange(undefined, 1)).toBe(true);
  });
});

describe("voice UI state machine", () => {
  it("never reports listening when phase is idle", () => {
    expect(deriveVoiceUiState({
      enabled: true, providerKind: "webspeech", phase: "idle", trouble: null, hasPendingPreview: false,
    })).toBe("idle");
  });

  it("maps permission trouble to error, not listening", () => {
    expect(deriveVoiceUiState({
      enabled: true, providerKind: "webspeech", phase: "listening",
      trouble: { kind: "permission", message: "denied" }, hasPendingPreview: false,
    })).toBe("error");
    expect(voiceUiStatusLabel("error", "permission")).toBe("Mic permission denied");
  });

  it("unsupported when no provider", () => {
    expect(deriveVoiceUiState({
      enabled: false, providerKind: null, phase: "idle", trouble: null, hasPendingPreview: false,
    })).toBe("unsupported");
  });

  it("ready when editable preview is pending", () => {
    expect(deriveVoiceUiState({
      enabled: true, providerKind: "webspeech", phase: "idle", trouble: null, hasPendingPreview: true,
    })).toBe("ready");
    expect(voiceUiStatusLabel("ready")).toMatch(/edit or send/i);
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
    expect(voiceKeyAction({ key: "Enter", target: body }, state({ hasPendingPreview: true }))).toBeNull();
    expect(voiceKeyAction({ key: "Enter", target: textarea }, pending)).toBeNull();
    expect(voiceKeyAction({ key: "Enter", ctrlKey: true, target: body }, pending)).toBeNull();
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
    expect(matchWorkspaceShortcut({ key: " ", ctrlKey: true, target: body })).toBeNull();
    expect(matchWorkspaceShortcut({ key: " ", target: body })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "Enter", target: body })).toBeNull();
    expect(voiceKeyAction({ key: "s", ctrlKey: true, target: body }, state({ capturing: true, hasPendingPreview: true }))).toBeNull();
    expect(voiceKeyAction({ key: "Enter", ctrlKey: true, target: body }, state({ hasPendingPreview: true, confirmViaEnterAllowed: true }))).toBeNull();
  });
});
