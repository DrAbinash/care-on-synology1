import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_ASSISTANT_MINIMIZED_KEY,
  readAiAssistantMinimizedPreference,
  writeAiAssistantMinimizedPreference,
} from "./aiAssistantPrefs";
import {
  canUndoLastAbnormal,
  describeRestoredBaseline,
  findLastReversibleAbnormalPatch,
} from "./undoLastAbnormal";
import { shouldSubmitAiInstructionKey } from "./aiInstructionKeys";
import {
  formatHumanSaveStatus,
} from "./humanSaveStatus";
import {
  badgeTextLeaksIntoReport,
  deriveNormalBaselineBadge,
} from "./normalBaselineBadge";
import {
  REPORT_SECTION_COLLAPSE_PREFS_KEY,
  prefsAfterSectionActivate,
  readReportSectionCollapsePrefs,
  sectionsRequiringReveal,
  writeReportSectionCollapsePrefs,
} from "./reportSectionCollapsePrefs";
import {
  buildAbnormalHighlightFromPatch,
  clearHighlightIfStudyChanged,
  describeAbnormalReplacementToast,
  highlightIsDisplayOnly,
} from "./abnormalSelectionFeedback";
import {
  isEditableTarget,
  shouldHandleAltUndoAbnormal,
  shouldHandleFinalizeShortcut,
  shortcutBlockedWhileTyping,
} from "./reportingWorkspaceShortcuts";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";

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

describe("AI Assistant minimized preference", () => {
  it("missing preference defaults to minimized", () => {
    expect(readAiAssistantMinimizedPreference(memoryStorage())).toBe(true);
  });

  it("stored expanded (\"0\") is respected", () => {
    const s = memoryStorage({ [AI_ASSISTANT_MINIMIZED_KEY]: "0" });
    expect(readAiAssistantMinimizedPreference(s)).toBe(false);
  });

  it("stored minimized (\"1\") is respected", () => {
    const s = memoryStorage({ [AI_ASSISTANT_MINIMIZED_KEY]: "1" });
    expect(readAiAssistantMinimizedPreference(s)).toBe(true);
  });

  it("write persists 0/1 and round-trips", () => {
    const s = memoryStorage();
    writeAiAssistantMinimizedPreference(s, false);
    expect(s.getItem(AI_ASSISTANT_MINIMIZED_KEY)).toBe("0");
    expect(readAiAssistantMinimizedPreference(s)).toBe(false);
    writeAiAssistantMinimizedPreference(s, true);
    expect(s.getItem(AI_ASSISTANT_MINIMIZED_KEY)).toBe("1");
    expect(readAiAssistantMinimizedPreference(s)).toBe(true);
  });
});

describe("AI instruction key handling", () => {
  it("plain Enter does not submit (newline stays in textarea)", () => {
    expect(shouldSubmitAiInstructionKey({ key: "Enter" })).toBe(false);
    expect(shouldSubmitAiInstructionKey({ key: "Enter", ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("Ctrl+Enter and Cmd+Enter invoke Run", () => {
    expect(shouldSubmitAiInstructionKey({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(shouldSubmitAiInstructionKey({ key: "Enter", metaKey: true })).toBe(true);
  });
});

describe("AI Assistant multiline + minimize contracts", () => {
  it("uses a textarea with optional instructions label and preserves parent-controlled text across minimize", () => {
    const src = readFileSync(
      join(__dirname, "../components/radiology/ReportComposerAssistant.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<textarea/);
    expect(src).toMatch(/Instructions to AI \(optional\)/);
    expect(src).toMatch(/Tell AI what to improve, rephrase or emphasize/);
    expect(src).toMatch(/shouldSubmitAiInstructionKey/);
    expect(src).toMatch(/data-testid="ai-report-assistant-minimized"/);
    expect(src).toMatch(/value=\{props\.microInstruction\}/);
    expect(src).toMatch(/stopPropagation/);
    expect(src).not.toMatch(/onMinimizedChange\?\.\(true\);[\s\S]{0,80}onMicroInstructionChange\(""\)/);
  });

  it("workspace defaults AI assistant preference via read helper and widens only when expanded", () => {
    const page = readFileSync(
      join(__dirname, "../pages/RadiologyReportingWorkspace.tsx"),
      "utf8",
    );
    expect(page).toMatch(/readAiAssistantMinimizedPreference/);
    expect(page).toMatch(/writeAiAssistantMinimizedPreference/);
    expect(page).toMatch(/w-\[min\(520px,calc\(100vw-2rem\)\)\]/);
    expect(page).toMatch(/undo-last-abnormal/);
    expect(page).toMatch(/Undo Last Abnormal/);
    expect(page).toMatch(/ReportingStickyActionBar/);
    expect(page).toMatch(/NormalBaselineBadge/);
    expect(page).toMatch(/shouldHandleAltUndoAbnormal/);
  });
});

function abnormalPatch(partial: Partial<AppliedPathologyPatch> & { id: string }): AppliedPathologyPatch {
  return {
    id: partial.id,
    ownership: partial.ownership ?? {
      conflictGroup: "hemorrhage",
      anatomicalSection: "basal ganglia",
      baselineReplaces: "Basal ganglia are normal.",
    },
    templates: partial.templates ?? { findings: "Acute hemorrhage." },
    lastRendered: partial.lastRendered ?? {
      findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
    },
    source: partial.source ?? "quick-select",
    observation: partial.observation ?? ({
      id: partial.id,
      concept: "hemorrhage",
      region: "Brain",
      anatomicalSection: "basal ganglia",
      conceptSource: "explicit",
      conflictGroup: "hemorrhage",
      level: "",
      laterality: "right",
      state: "",
      severity: "",
      measurement: "",
      slotKey: "brain|hemorrhage||right",
      source: "quick-select",
      baselineReplaces: "Basal ganglia are normal.",
      supportsLaterality: true,
      bundleId: "",
      sectionsOwned: [],
      role: "primary",
      specificity: "standard",
    } as unknown as AppliedPathologyPatch["observation"]),
    replacedBaseline: partial.replacedBaseline ?? {
      findings: ["Basal ganglia are normal in signal intensity."],
      impression: [],
    },
    protected: partial.protected,
    stale: partial.stale,
  };
}

describe("Undo Last Abnormal selector", () => {
  it("is disabled when there is no patch snapshot", () => {
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: null,
      appliedPathologyPatches: [abnormalPatch({ id: "a1" })],
      isFinalized: false,
    })).toBe(false);
  });

  it("is disabled when finalized", () => {
    const patch = abnormalPatch({ id: "a1" });
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: { appliedPathologyPatches: [] },
      appliedPathologyPatches: [patch],
      isFinalized: true,
    })).toBe(false);
  });

  it("is disabled when locked", () => {
    const patch = abnormalPatch({ id: "a1" });
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: { appliedPathologyPatches: [] },
      appliedPathologyPatches: [patch],
      isFinalized: false,
    }, { locked: true })).toBe(false);
  });

  it("enables for a newly applied quick-select abnormal", () => {
    const patch = abnormalPatch({ id: "a1" });
    const state = {
      lastPatchSnapshot: { appliedPathologyPatches: [] },
      appliedPathologyPatches: [patch],
      isFinalized: false,
    };
    expect(canUndoLastAbnormal(state)).toBe(true);
    expect(findLastReversibleAbnormalPatch(state)?.id).toBe("a1");
    expect(describeRestoredBaseline(state)).toMatch(/Basal ganglia are normal/i);
  });

  it("does not treat voice / radiologist-voice patches as Undo Last Abnormal targets", () => {
    const voice = abnormalPatch({
      id: "voice-1",
      source: "radiologist-voice",
    });
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: { appliedPathologyPatches: [] },
      appliedPathologyPatches: [voice],
      isFinalized: false,
    })).toBe(false);
  });
});

describe("Undo Last Abnormal restores baseline via undoLastPatch", () => {
  beforeEach(() => {
    useWorkspace.setState({
      clinicalHistoryText: "",
      techniqueText: "",
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      lastPatchSnapshot: null,
      isFinalized: false,
      isDirty: false,
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
    } as never);
  });

  it("restores the owned normal baseline and keeps protected manual text", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      clinicalHistory: "Hx",
      technique: "Tech",
      findings: "Basal ganglia are normal in signal intensity. Manual note: correlate with EEG.",
      impression: "Normal MRI brain.",
      recommendation: "",
    });
    useWorkspace.setState({
      fieldProvenance: {
        findings: {
          "manual note: correlate with eeg.": ["manual"],
          "basal ganglia are normal in signal intensity.": ["template"],
        },
      },
    } as never);

    const beforeFindings = useWorkspace.getState().findingsText;
    store.applyPathologyOverlay({
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      templates: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: {
        anatomicalSection: "basal ganglia",
        conflictGroup: "hemorrhage",
        baselineReplaces: "Basal ganglia are normal in signal intensity.",
        concept: "hemorrhage",
      },
      source: "quick-select",
      id: "test-hem-undo",
      region: "Brain",
      concept: "hemorrhage",
      label: "Hemorrhage",
      findingsText: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
    });

    const mid = useWorkspace.getState();
    expect(mid.findingsText.toLowerCase()).toContain("hemorrhage");
    expect(mid.findingsText).toMatch(/Manual note: correlate with EEG/i);
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: mid.lastPatchSnapshot,
      appliedPathologyPatches: mid.appliedPathologyPatches,
      isFinalized: mid.isFinalized,
    })).toBe(true);

    expect(mid.undoLastPatch()).toBe(true);
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe(beforeFindings);
    expect(after.findingsText).toMatch(/Manual note: correlate with EEG/i);
    expect(after.findingsText.toLowerCase()).not.toContain("hemorrhage");
  });

  it("undo is disabled for finalized / no-patch states", () => {
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: null,
      appliedPathologyPatches: [],
      isFinalized: false,
    })).toBe(false);
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: { appliedPathologyPatches: [] },
      appliedPathologyPatches: [abnormalPatch({ id: "x" })],
      isFinalized: true,
    })).toBe(false);
  });
});

describe("Autosave human-readable status labels", () => {
  const base = {
    lastSavedAt: null as Date | null,
    nowMs: 1_000_000,
    isDirty: false,
    isOnline: true,
    hasOfflineCopy: false,
  };

  it("shows Saving… / Saved / relative / Offline / failed", () => {
    expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "saving" })?.label).toBe("Saving…");
    expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "saved", lastSavedAt: new Date(999_998) })?.label).toBe("Saved");
    expect(formatHumanSaveStatus({
      ...base,
      autoSaveStatus: "saved",
      lastSavedAt: new Date(1_000_000 - 25_000),
    })?.label).toBe("Saved 25 sec ago");
    expect(formatHumanSaveStatus({
      ...base,
      autoSaveStatus: "idle",
      isOnline: false,
      hasOfflineCopy: true,
      isDirty: true,
    })?.label).toBe("Offline copy saved");
    expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "error" })?.label).toBe("Save failed");
  });

  it("a successful save clears a prior error state", () => {
    expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "error" })?.tone).toBe("red");
    expect(formatHumanSaveStatus({
      ...base,
      autoSaveStatus: "saved",
      lastSavedAt: new Date(base.nowMs),
    })?.tone).toBe("green");
  });
});

describe("Normal baseline badge", () => {
  it("shows review-required when format applied without deviations", () => {
    const b = deriveNormalBaselineBadge({
      appliedFormatName: "MRI Brain — Normal",
      appliedPathologyPatches: [],
    });
    expect(b?.text).toBe("Normal baseline active — review required");
    expect(b?.formatName).toBe("MRI Brain — Normal");
  });

  it("becomes + deviations after an abnormal observation", () => {
    const b = deriveNormalBaselineBadge({
      appliedFormatName: "MRI Brain — Normal",
      appliedPathologyPatches: [abnormalPatch({ id: "a1" })],
    });
    expect(b?.text).toBe("Normal baseline + deviations");
  });

  it("never enters report content / print", () => {
    const text = "Normal baseline active — review required";
    expect(badgeTextLeaksIntoReport(text, {
      findings: "Ventricles are normal.",
      impression: "Normal MRI brain.",
    })).toBe(false);
    const page = readFileSync(
      join(__dirname, "../components/radiology/NormalBaselineBadge.tsx"),
      "utf8",
    );
    expect(page).toMatch(/data-print-exclude="true"/);
    expect(page).toMatch(/data-editor-only="normal-baseline-badge"/);
  });
});

describe("Collapsed-section preferences", () => {
  it("restore prefs from localStorage", () => {
    const s = memoryStorage();
    writeReportSectionCollapsePrefs(s, {
      preferredActive: "impression",
      collapsed: { history: true, technique: true, recommendation: false },
    });
    const r = readReportSectionCollapsePrefs(s);
    expect(r.preferredActive).toBe("impression");
    expect(r.collapsed.recommendation).toBe(false);
    expect(s.getItem(REPORT_SECTION_COLLAPSE_PREFS_KEY)).toBeTruthy();
  });

  it("prefsAfterSectionActivate remembers optional collapse", () => {
    const next = prefsAfterSectionActivate(
      { preferredActive: "findings", collapsed: { history: true, technique: true, recommendation: true } },
      "findings",
      "history",
    );
    expect(next.collapsed.history).toBe(true);
    expect(next.preferredActive).toBe("findings");
  });

  it("validation warnings remain discoverable when collapsed", () => {
    expect(sectionsRequiringReveal({ impressionNeedsRefresh: true })).toEqual(["impression"]);
    const page = readFileSync(
      join(__dirname, "../pages/RadiologyReportingWorkspace.tsx"),
      "utf8",
    );
    expect(page).toMatch(/impression-collapsed-warning/);
    expect(page).toMatch(/sectionsRequiringReveal/);
    const accordion = readFileSync(
      join(__dirname, "../components/radiology/zai-workspace/report-section-accordion.tsx"),
      "utf8",
    );
    expect(accordion).toMatch(/collapsedWarning/);
    expect(accordion).toMatch(/report-section-collapsed-warning/);
  });
});

describe("Abnormal selection highlight (display-only)", () => {
  it("builds a transient highlight and toast from replaced baseline", () => {
    const patch = abnormalPatch({ id: "a1" });
    const h = buildAbnormalHighlightFromPatch(patch, "study-1", 0);
    expect(h?.needle).toContain("hemorrhage");
    expect(h?.studyId).toBe("study-1");
    expect(describeAbnormalReplacementToast(patch)).toMatch(/replaced the normal/i);
    expect(highlightIsDisplayOnly("plain findings text", h!.needle)).toBe(true);
    expect(highlightIsDisplayOnly('<mark data-abnormal-highlight>', "x")).toBe(false);
  });

  it("rapid study switching clears transient highlights", () => {
    const h = buildAbnormalHighlightFromPatch(abnormalPatch({ id: "a1" }), "study-1", 2);
    expect(clearHighlightIfStudyChanged(h, "study-2")).toBeNull();
    expect(clearHighlightIfStudyChanged(h, "study-1")?.studyId).toBe("study-1");
  });

  it("FindingsEditor overlay is display-only (not clinical text)", () => {
    const src = readFileSync(
      join(__dirname, "../components/radiology/zai-workspace/findings-editor.tsx"),
      "utf8",
    );
    expect(src).toMatch(/abnormal-highlight-overlay/);
    expect(src).toMatch(/data-editor-only="abnormal-highlight"/);
    expect(src).toMatch(/transientHighlight/);
  });
});

describe("Keyboard shortcut safety", () => {
  it("Alt+U does not fire while typing in unrelated editors", () => {
    const textarea = { tagName: "TEXTAREA", isContentEditable: false };
    expect(shouldHandleAltUndoAbnormal({
      key: "u",
      altKey: true,
      target: textarea as unknown as EventTarget,
    })).toBe(false);
    expect(shouldHandleAltUndoAbnormal({
      key: "u",
      altKey: true,
      target: { tagName: "DIV", isContentEditable: false } as unknown as EventTarget,
    })).toBe(true);
  });

  it("Ctrl+Enter finalize is skipped when AI instruction textarea is focused", () => {
    expect(shouldHandleFinalizeShortcut({
      key: "Enter",
      ctrlKey: true,
      target: { id: "ai-micro-command", tagName: "TEXTAREA" } as unknown as EventTarget,
    })).toBe(false);
    expect(shouldHandleFinalizeShortcut({
      key: "Enter",
      ctrlKey: true,
      target: { id: "other", tagName: "DIV" } as unknown as EventTarget,
    })).toBe(true);
  });

  it("plain keys while typing are blocked from accidental shortcut handling", () => {
    expect(shortcutBlockedWhileTyping({
      key: "u",
      target: { tagName: "TEXTAREA" } as unknown as EventTarget,
    })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
  });
});
