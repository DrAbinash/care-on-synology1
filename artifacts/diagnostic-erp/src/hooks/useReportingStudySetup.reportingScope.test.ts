/**
 * Owner decision 2026-11-01, part 1 — the reporting scope a disagreement has to earn.
 *
 *   "The confirmed examination actually performed takes precedence over the billing
 *    label when selecting the reporting format … Where billing, worklist and acquisition
 *    descriptions disagree, preserve the billed identity and ask the radiologist to
 *    confirm the reporting scope. Do not alter billing records automatically."
 *
 * Filed from production worklist row 12326: booked `MRI Brain`, acquired
 * `MRI BRAIN + CX SCR`, signed as a brain examination with no word about the cervical
 * spine. `combinedExaminationRegions.test.ts` pins the resolver's arithmetic; this file
 * pins what the workspace does with it — that it asks, that asking writes nothing, and
 * that Confirming produces ONE report covering BOTH examinations with the performed
 * examination owning the format.
 *
 * Only the server catalogue is mocked. The hook, React's effects, the region policy, the
 * technique merge and the store all run their real code, same as the ADR-004 suite.
 */
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReportingStudySetup,
  type StudySetupSetters,
  type UseReportingStudySetupArgs,
} from "./useReportingStudySetup";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";

vi.mock("@tanstack/react-query", () => {
  const tabs = [
    { id: 1, name: "Brain", isActive: true, sortOrder: 0 },
    { id: 2, name: "Cervical Spine", isActive: true, sortOrder: 1 },
  ];
  const catalog = {
    tabs, findings: [], measurements: [], clinicalHistory: [],
    protocols: [
      { id: 1, studyTabId: 1, studyType: "Brain", name: "MRI Brain", modality: "MR",
        techniqueText: "Multiplanar T1W, T2W and FLAIR brain acquisition.",
        recommendationText: "", normalText: "", checklistJson: "[]", requiredMeasurements: "",
        isActive: true, isDefault: true, isGoldStandard: false, sortOrder: 0 },
      { id: 2, studyTabId: 2, studyType: "Cervical Spine", name: "MRI Cervical Spine", modality: "MR",
        techniqueText: "Sagittal T2W and STIR cervical spine acquisition.",
        recommendationText: "", normalText: "", checklistJson: "[]", requiredMeasurements: "",
        isActive: true, isDefault: true, isGoldStandard: false, sortOrder: 1 },
    ],
  };
  return { useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "radiology-quick-select" ? catalog : [],
  }) };
});

const STUDY_A = 92001;
const STUDY_B = 92002;
const COMBINED_DESCRIPTION = "MRI BRAIN + CX SCR";

const initialStore = useWorkspace.getState();
let root: Root;
let current: ReturnType<typeof useReportingStudySetup>;

const setters: StudySetupSetters = {
  setTechnique: vi.fn(), setFindings: vi.fn(), setImpression: vi.fn(),
  setRecommendation: vi.fn(), setClinicalHistory: vi.fn(),
  mergeTechnique: (text, source) => useWorkspace.getState().mergeField("technique", text, source),
  mergeFindings: vi.fn(), mergeImpression: vi.fn(), mergeRecommendation: vi.fn(),
  setTechniqueIfEmpty: vi.fn(), setFindingsIfEmpty: vi.fn(),
  setImpressionIfEmpty: vi.fn(), setRecommendationIfEmpty: vi.fn(),
  replaceTechnique: (text, source) => useWorkspace.getState().replaceField("technique", text, source),
  replaceFindings: vi.fn(), replaceImpression: vi.fn(), replaceRecommendation: vi.fn(),
  stampApprovedNormal: vi.fn(),
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
  useLayoutEffect(() => { beforeEffects?.(); }, [beforeEffects]);
  return null;
}

function render(
  studyId: number | null,
  opts: { disabled?: boolean; billed?: string; acquired?: string | null; beforeEffects?: () => void } = {},
) {
  act(() => root.render(createElement(Harness, {
    args: {
      studyId,
      disabled: opts.disabled ?? false,
      modality: "MR",
      studyDescription: opts.acquired === undefined ? COMBINED_DESCRIPTION : opts.acquired,
      billedTestName: opts.billed ?? "MRI Brain",
      isLoadingExistingDraft: false,
      draftHydrated: true,
      existingDraft: null,
      setters,
    },
    beforeEffects: opts.beforeEffects,
  })));
}

function openStudy(studyId: number) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    activeStudyId: String(studyId),
    clinicalHistoryText: `Headache for three weeks. (synthetic study ${studyId})`,
  });
}

function reportSnapshot() {
  const s = useWorkspace.getState();
  return structuredClone({
    activeStudyId: s.activeStudyId,
    narrative: setters.readFields(),
    ledger: s.appliedPathologyPatches,
    transitions: s.regionTransitions,
    undo: s.patchUndoStack,
    isFinalized: s.isFinalized,
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No network in hook tests")));
  const document = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const window = Object.assign(new EventTarget(), { document, HTMLIFrameElement: class {} });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  root = createRoot({
    nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document, addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLElement);
  useWorkspace.setState(initialStore, true);
  openStudy(STUDY_A);
  render(STUDY_A);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useWorkspace.setState(initialStore, true);
});

describe("a combined examination the bill does not name is asked about", () => {
  it("asks, and the report is still the billed examination until he answers", () => {
    expect(current.pendingScopeConfirmation?.proposal).toMatchObject({
      billedRegions: ["Brain"],
      performedRegions: ["Brain", "Cervical Spine"],
      addedRegions: ["Cervical Spine"],
      proposedRegions: ["Brain", "Cervical Spine"],
    });
    // The billed identity is preserved: nothing is written on the way to the question.
    expect(current.studyRegions).toEqual(["Brain"]);
    expect(current.regionOverrides).toBeNull();
    expect(setters.replaceFindings).not.toHaveBeenCalled();
  });

  it("Confirm covers both examinations in ONE report, and the performed primary owns it", () => {
    act(() => current.confirmReportingScope());

    expect(current.regionOverrides).toEqual(["Brain", "Cervical Spine"]);
    expect(current.studyRegions).toEqual(["Brain", "Cervical Spine"]);
    expect(current.matchedStudyRegion, "the primary examination chooses the report format").toBe("Brain");
    // One combined title, so one report and one signature — not a second study.
    expect(current.testName).toBe("MRI BRAIN WITH CERVICAL SPINE");
    const technique = useWorkspace.getState().techniqueText;
    expect(technique).toContain("brain acquisition");
    expect(technique, "the technique of both examinations, as the owner asked").toContain("cervical spine acquisition");
    expect(current.pendingScopeConfirmation).toBeNull();
  });

  it("the performed examination outranks the billing label on confirm", () => {
    // Booked as the cervical screen, acquired as brain plus cervical spine. The bill
    // keeps its identity while the question is open, and the examination that was
    // actually performed chooses the format once he has confirmed it.
    openStudy(STUDY_B);
    render(STUDY_B, { billed: "MRI CERVICAL SPINE" });
    expect(current.matchedStudyRegion).toBe("Cervical Spine");
    expect(current.pendingScopeConfirmation?.proposal.addedRegions).toEqual(["Brain"]);

    act(() => current.confirmReportingScope());
    expect(current.studyRegions).toEqual(["Brain", "Cervical Spine"]);
    expect(current.matchedStudyRegion).toBe("Brain");
  });

  it("Dismiss keeps the billed scope, writes nothing, and does not ask again", () => {
    const before = reportSnapshot();
    act(() => current.dismissReportingScope());

    expect(reportSnapshot()).toEqual(before);
    expect(current.studyRegions).toEqual(["Brain"]);
    expect(current.regionOverrides).toBeNull();
    expect(current.pendingScopeConfirmation).toBeNull();

    // The same disagreement is still there on the next render — an answer is an answer.
    render(STUDY_A);
    expect(current.pendingScopeConfirmation).toBeNull();
  });

  it("a study the radiologist has already regioned is not asked", () => {
    act(() => current.selectPrimaryRegion("Brain"));
    expect(current.regionOverrides).toEqual(["Brain"]);
    expect(current.pendingScopeConfirmation, "his own choice is the answer to the question").toBeNull();
  });

  it("a console that is locked out is not asked", () => {
    openStudy(STUDY_B);
    render(STUDY_B, { disabled: true });
    expect(current.pendingScopeConfirmation).toBeNull();
  });

  it("asks nothing when the two readings name the same examination", () => {
    openStudy(STUDY_B);
    render(STUDY_B, { billed: "MRI BRAIN + CX SCR" });
    expect(current.pendingScopeConfirmation).toBeNull();
    expect(current.studyRegions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("asks nothing when an ambiguous acquisition name resolves no examination", () => {
    // "Do not infer an additional examination from an ambiguous DICOM series name
    // alone." A protocol label is not an examination name, and it must not widen a
    // report or interrupt the radiologist with a question CARE cannot answer.
    for (const ambiguous of ["MRI", "3D T2 SPACE", "PROTOCOL 7", null]) {
      openStudy(STUDY_B);
      render(STUDY_B, { acquired: ambiguous });
      expect(current.pendingScopeConfirmation, `“${ambiguous}” must not ask`).toBeNull();
      expect(current.studyRegions).toEqual(["Brain"]);
    }
  });

  it("A's retained Confirm cannot widen B's report", () => {
    const stale = current.confirmReportingScope;
    openStudy(STUDY_B);
    render(STUDY_B, { billed: "MRI Brain" });
    const before = reportSnapshot();

    act(stale);
    expect(reportSnapshot()).toEqual(before);
    expect(current.regionOverrides, "B is still unanswered, and A's answer is not B's").toBeNull();
    expect(current.studyRegions).toEqual(["Brain"]);
  });

  it("B's strip is B's own: opening a second patient does not inherit A's answer", () => {
    act(() => current.dismissReportingScope());
    openStudy(STUDY_B);
    render(STUDY_B, { billed: "MRI Brain" });
    expect(current.pendingScopeConfirmation?.proposal.addedRegions).toEqual(["Cervical Spine"]);
    act(() => current.confirmReportingScope());
    expect(current.studyRegions).toEqual(["Brain", "Cervical Spine"]);
  });
});
