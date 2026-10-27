import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReportingStudySetup, type StudySetupSetters, type UseReportingStudySetupArgs } from "./useReportingStudySetup";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

// Only the server catalog is mocked; React, the hook, transition policy, formats,
// provenance, ledger withdrawal and undo history all execute their real code.
vi.mock("@tanstack/react-query", () => {
  const tabs = ["Whole Spine", "Cervical Spine"].map((name, index) => ({
    id: index + 1, name, isActive: true, sortOrder: index,
  }));
  const catalog = {
    tabs, findings: [], measurements: [], clinicalHistory: [],
    protocols: tabs.map((tab) => ({
      id: tab.id, studyTabId: tab.id, studyType: tab.name,
      name: `MRI ${tab.name}`, modality: "MR", techniqueText: `${tab.name} acquisition.`,
      recommendationText: "", normalText: "", checklistJson: "[]", requiredMeasurements: "",
      isActive: true, isDefault: true, isGoldStandard: false, sortOrder: tab.sortOrder,
    })),
  };
  const templates: unknown[] = [];
  return { useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "radiology-quick-select" ? catalog : templates,
  }) };
});

const STUDY_A = 91001;
const STUDY_B = 91002;
const initialStore = useWorkspace.getState();
let root: Root;
let current: ReturnType<typeof useReportingStudySetup>;

const setters: StudySetupSetters = {
  setTechnique: vi.fn(), setFindings: vi.fn(), setImpression: vi.fn(),
  setRecommendation: vi.fn(), setClinicalHistory: vi.fn(),
  mergeTechnique: (text, source) => useWorkspace.getState().mergeField("technique", text, source),
  mergeFindings: vi.fn(), mergeImpression: vi.fn(),
  mergeRecommendation: (text, source) => useWorkspace.getState().mergeField("recommendation", text, source),
  setTechniqueIfEmpty: vi.fn(), setFindingsIfEmpty: vi.fn(),
  setImpressionIfEmpty: vi.fn(), setRecommendationIfEmpty: vi.fn(),
  replaceTechnique: (text, source) => useWorkspace.getState().replaceField("technique", text, source),
  replaceFindings: vi.fn(), replaceImpression: vi.fn(), replaceRecommendation: vi.fn(),
  readFields: () => {
    const s = useWorkspace.getState();
    return {
      technique: s.techniqueText, findings: s.findingsText, impression: s.impressionText,
      recommendation: s.recommendationText, clinicalHistory: s.clinicalHistoryText,
    };
  },
  readTechniqueProvenance: () => useWorkspace.getState().fieldProvenance.technique ?? {},
};

function Harness({ args, beforeEffects }: { args: UseReportingStudySetupArgs; beforeEffects?: () => void }) {
  current = useReportingStudySetup(args);
  // Exercises the render -> passive-reset gap without mocking React's hooks.
  useLayoutEffect(() => { beforeEffects?.(); }, [beforeEffects]);
  return null;
}

function render(
  studyId: number | null,
  disabled = false,
  beforeEffects?: () => void,
  billedTestName = "MRI SCREENING WHOLE SPINE",
) {
  act(() => root.render(createElement(Harness, {
    args: {
      studyId, disabled, modality: "MR", studyDescription: "MRI SCREENING WHOLE SPINE",
      billedTestName, isLoadingExistingDraft: false,
      draftHydrated: true, existingDraft: null, setters,
    },
    beforeEffects,
  })));
}

function openWholeSpine(studyId: number) {
  useWorkspace.setState({
    ...emptyClinicalState(), activeStudyId: String(studyId),
    clinicalHistoryText: `Synthetic study ${studyId} history.`,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI SCREENING WHOLE SPINE",
      regions: ["Whole Spine"], source: "billed",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
  });
  const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening Normal")!;
  useWorkspace.getState().applyFormatById(format.id);
  // Let the hook seed an untouched protocol so the primary-region confirm also
  // exercises the technique writer, not just the region and ledger writers.
  useWorkspace.getState().replaceField("technique", "", "protocol");
}

function reportSnapshot() {
  const s = useWorkspace.getState();
  return structuredClone({
    activeStudyId: s.activeStudyId, context: s.reportingContext,
    narrative: setters.readFields(), provenance: s.fieldProvenance,
    ledger: s.appliedPathologyPatches, transitions: s.regionTransitions,
    undo: s.patchUndoStack, redo: s.patchRedoStack, lastSnapshot: s.lastPatchSnapshot,
    isDirty: s.isDirty,
  });
}

function requestCervical() {
  act(() => current.selectPrimaryRegion("Cervical Spine"));
  expect(current.pendingRegionTransition?.plan.requiresConfirmation).toBe(true);
  expect(current.pendingRegionTransition?.plan.retire).toHaveLength(11);
  return current.confirmRegionTransition;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No network in hook tests")));
  // This component renders null: a minimal host container is sufficient for real
  // ReactDOM lifecycle scheduling, with no DOM/test-renderer dependency added.
  const document = {
    nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {},
  };
  const window = Object.assign(new EventTarget(), { document, HTMLIFrameElement: class {} });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  root = createRoot({
    nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document, addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLElement);
  useWorkspace.setState(initialStore, true);
  openWholeSpine(STUDY_A);
  render(STUDY_A);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useWorkspace.setState(initialStore, true);
});

describe("study-bound region confirmation", () => {
  it("clears A's pending confirmation on study change", () => {
    requestCervical();
    act(() => openWholeSpine(STUDY_B));
    render(STUDY_B);
    expect(current.pendingRegionTransition).toBeNull();
  });

  it("refuses a retained A callback after B opens with identical baseline IDs", () => {
    const staleConfirm = requestCervical();
    const idsA = useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
    act(() => openWholeSpine(STUDY_B));
    render(STUDY_B);
    expect(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id)).toEqual(idsA);
    const before = reportSnapshot();
    const commit = vi.spyOn(useWorkspace.getState(), "commitRegionTransition");
    act(staleConfirm);
    expect(reportSnapshot()).toEqual(before);
    expect(current.regionOverrides).toBeNull();
    expect(current.studyRegions).toEqual(["Whole Spine"]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("refuses when the store switches before the hook renders the new study", () => {
    const staleConfirm = requestCervical();
    act(() => openWholeSpine(STUDY_B));
    const before = reportSnapshot();
    act(staleConfirm);
    expect(reportSnapshot()).toEqual(before);
    expect(current.regionOverrides).toBeNull();
  });

  it("refuses during B's layout phase even while the store still names A", () => {
    const staleConfirm = requestCervical();
    const before = reportSnapshot();
    render(STUDY_B, false, () => {
      expect(useWorkspace.getState().activeStudyId).toBe(String(STUDY_A));
      staleConfirm();
      expect(reportSnapshot()).toEqual(before);
    });
    // The ordinary study-reset effect clears the protocol selection afterwards.
    expect(reportSnapshot()).toEqual({
      ...before, context: { ...before.context, protocolName: null },
    });
    expect(current.regionOverrides).toBeNull();
    expect(current.pendingRegionTransition).toBeNull();
  });

  it("refuses a retained callback when the current hook becomes disabled/locked", () => {
    const staleConfirm = requestCervical();
    const before = reportSnapshot();
    render(STUDY_A, true, staleConfirm);
    expect(reportSnapshot()).toEqual(before);
    expect(current.regionOverrides).toBeNull();
    act(() => current.confirmRegionTransition());
    expect(reportSnapshot()).toEqual(before);
  });

  it("refuses a retained callback when the store becomes finalized", () => {
    const staleConfirm = requestCervical();
    act(() => useWorkspace.setState({ isFinalized: true }));
    const before = reportSnapshot();
    const commit = vi.spyOn(useWorkspace.getState(), "commitRegionTransition");
    act(staleConfirm);
    expect(reportSnapshot()).toEqual(before);
    expect(current.regionOverrides).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("confirms normally within A, including technique, retirement and one undo frame", () => {
    const before = reportSnapshot();
    const confirm = requestCervical();
    expect(reportSnapshot()).toEqual(before);
    act(confirm);
    const after = useWorkspace.getState();
    expect(current.pendingRegionTransition).toBeNull();
    expect(current.studyRegions).toEqual(["Cervical Spine"]);
    expect(after.reportingContext.region).toBe("Cervical Spine");
    expect(after.techniqueText).toBe("Cervical Spine acquisition.");
    expect(after.findingsText).toContain("Cervical spine:");
    expect(after.findingsText).not.toContain("Dorsal spine:");
    expect(after.findingsText).not.toContain("Lumbar spine:");
    expect(after.regionTransitions).toHaveLength(1);
    expect(after.regionTransitions[0].retired).toHaveLength(11);
    expect(after.appliedPathologyPatches).toHaveLength(before.ledger.length - 11);
    expect(after.patchUndoStack).toHaveLength(before.undo.length + 1);
  });

  it.each(["toggle", "reset", "clear"] as const)("binds and confirms the %s writer within B", (control) => {
    act(() => openWholeSpine(STUDY_B));
    render(STUDY_B);
    if (control === "toggle") {
      act(() => current.handleRegionToggle("Cervical Spine"));
      act(() => current.handleRegionToggle("Whole Spine"));
    } else {
      // Keep the manually selected whole-spine coverage while the billed hint
      // becomes cervical: reset/placeholder now ask about a genuine narrowing.
      act(() => current.selectPrimaryRegion("Whole Spine"));
      render(STUDY_B, false, undefined, "MRI CERVICAL SPINE");
      expect(current.autoStudyRegion).toBe("Cervical Spine");
    }
    const before = reportSnapshot();
    act(() => {
      if (control === "toggle") current.handleRegionToggle("Whole Spine");
      else if (control === "reset") current.resetRegionOverrides();
      else current.selectPrimaryRegion(null);
    });
    expect(current.pendingRegionTransition?.studyId).toBe(STUDY_B);
    expect(current.pendingRegionTransition?.plan.retire).toHaveLength(11);
    expect(reportSnapshot()).toEqual(before);
    act(() => current.confirmRegionTransition());
    expect(current.pendingRegionTransition).toBeNull();
    expect(current.studyRegions).toEqual(["Cervical Spine"]);
    expect(useWorkspace.getState().regionTransitions[0].retired).toHaveLength(11);
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(before.ledger.length - 11);
  });

  it("cancels without changing the report or region, even with a retained callback", () => {
    const before = reportSnapshot();
    const staleConfirm = requestCervical();
    act(() => current.cancelRegionTransition());
    act(staleConfirm);
    act(() => current.confirmRegionTransition());
    expect(current.pendingRegionTransition).toBeNull();
    expect(current.regionOverrides).toBeNull();
    expect(reportSnapshot()).toEqual(before);
  });
});
