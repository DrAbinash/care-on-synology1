/**
 * POST-AUDIT-A / A-02 — one authoritative active study, and a Copilot stamp that means
 * something because of it.
 *
 * The route `studyId` (the radiology_worklist row) is the canonical reporting-study
 * identity. `activeStudyId` used to be a mirror written by a separate effect in
 * `useWorkspaceClinicalUi` that bailed with `if (!studies.some(s => s.id === sid)) return;`
 * — so navigating to a study that had not yet landed in the scoped queue left the store
 * convinced it was still on Patient A while the screen showed Patient B. Roughly twenty
 * consumers read that field as the truth, `recomputeCopilot` among them: it stamped items
 * with `st.id` resolved from `activeStudyId`, and `insertCopilotItem` compared them
 * against `activeStudyId`. Same value on both sides, so #840's guard could never fire —
 * an item derived from A's modality, sex and priors while reading B's narrative was
 * stamped "A" and waved through by A == A.
 *
 * These tests drive the production transition payload (`studyTransitionReset`, the object
 * `useDraftPersistence` now writes in one setState) and the production store actions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  CLINICAL_RESET_FIELDS,
  emptyClinicalState,
  studyTransitionReset,
} from "@/lib/zai-workspace/clinicalStateReset";
import type { CopilotItem } from "@/lib/zai-workspace/types";

const A = {
  id: 101, patientId: 1, patientName: "RAM ADHIKARI", accessionNumber: "ACC-101",
  modality: "MR", studyDescription: "MRI Brain Plain", bodyPart: "Brain",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.A",
};
/** Deliberately NOT the LS Spine row: this is the study the queue has not delivered yet. */
const B = {
  id: 202, patientId: 2, patientName: "SITA DEBI", accessionNumber: "ACC-202",
  modality: "USG", studyDescription: "USG Whole Abdomen", bodyPart: "Abdomen",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.B",
};

function putAOnScreen() {
  useWorkspace.getState().setStudies([A]);
  useWorkspace.setState({
    ...studyTransitionReset(101),
    activeStudyInstanceUID: "1.2.840.A",
    clinicalHistoryText: "A: headache for three days",
    findingsText: "A: left basal ganglia infarct",
    impressionText: "A: acute infarct",
    recommendationText: "A: neurology review",
    techniqueText: "A: MR without contrast",
    isDirty: true,
    isFinalized: true,
  });
}

beforeEach(() => {
  useWorkspace.setState({
    ...studyTransitionReset(null),
    studies: [],
    copilotItems: [],
    acknowledgedCopilotIds: new Set(),
  });
});

describe("A-02 the transition payload binds identity to the route study", () => {
  it("carries every clinical field emptyClinicalState defines, so the two cannot drift", () => {
    const patch = studyTransitionReset(202);
    for (const field of CLINICAL_RESET_FIELDS) {
      expect(patch[field]).toEqual((emptyClinicalState() as Record<string, unknown>)[field]);
    }
  });

  it("makes the route study authoritative while clearing A's content in the same write", () => {
    putAOnScreen();
    useWorkspace.setState(studyTransitionReset(202));
    const s = useWorkspace.getState();
    expect(s.activeStudyId).toBe("202");
    expect(s.findingsText).toBe("");
    expect(s.impressionText).toBe("");
    expect(s.clinicalHistoryText).toBe("");
    expect(s.isDirty).toBe(false);
    expect(s.isFinalized).toBe(false);
  });

  it("still becomes the route study when that study is NOT in the scoped queue", () => {
    // This is the exact condition that made the old mirror bail and leave A authoritative.
    putAOnScreen();
    useWorkspace.getState().setStudies([A]);            // B has not arrived yet
    expect(useWorkspace.getState().studies.some((x) => x.id === "202")).toBe(false);

    useWorkspace.setState(studyTransitionReset(202));

    expect(useWorkspace.getState().activeStudyId).toBe("202");
    expect(useWorkspace.getState().activeStudyInstanceUID).toBeNull();
  });

  it("never keeps the previous study's StudyInstanceUID for the new route study", () => {
    putAOnScreen();
    expect(useWorkspace.getState().activeStudyInstanceUID).toBe("1.2.840.A");
    useWorkspace.setState(studyTransitionReset(202));
    // null = unknown, and every consumer treats unknown as refuse. Not "carry over".
    expect(useWorkspace.getState().activeStudyInstanceUID).toBeNull();
  });

  it("no route study means no active study", () => {
    putAOnScreen();
    expect(useWorkspace.getState().activeStudyId).toBe("101");
    useWorkspace.setState(studyTransitionReset(undefined));
    expect(useWorkspace.getState().activeStudyId).toBeNull();
    useWorkspace.setState(studyTransitionReset(null));
    expect(useWorkspace.getState().activeStudyId).toBeNull();
    useWorkspace.setState(studyTransitionReset(""));
    expect(useWorkspace.getState().activeStudyId).toBeNull();
  });

  it("does not invent a study id from a non-numeric value", () => {
    useWorkspace.setState(studyTransitionReset("abc" as unknown as number));
    // The route param is coerced from the URL; a junk value is stored as the string form
    // rather than being turned into NaN, and it will simply match no worklist row.
    expect(useWorkspace.getState().activeStudyId).toBe("abc");
    expect(useWorkspace.getState().studies.find((s) => s.id === useWorkspace.getState().activeStudyId)).toBeUndefined();
  });
});

describe("A-02 selectStudy keeps agreeing with the route-driven transition", () => {
  it("both entry points land on the same identity for the same study", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.getState().selectStudy("202");
    const viaSelectStudy = useWorkspace.getState().activeStudyId;
    useWorkspace.setState(studyTransitionReset(202));
    expect(useWorkspace.getState().activeStudyId).toBe(viaSelectStudy);
  });
});

describe("A-02/A-05 the Copilot study stamp is now a real check", () => {
  const itemForA = (over: Partial<CopilotItem> = {}): CopilotItem => ({
    id: "suggestion-a",
    kind: "suggestion",
    title: "Add the comparison line",
    detail: "Comparison with the prior study is missing.",
    insertText: "A-DERIVED ADVICE: compare with the previous MR study.",
    confidence: "medium",
    source: "copilot",
    studyId: "101",
    ...over,
  });

  it("refuses to insert A's suggestion while B is the active study, and writes nothing", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState(studyTransitionReset(202));

    useWorkspace.getState().insertCopilotText(itemForA());

    expect(useWorkspace.getState().findingsText).toBe("");
    expect(useWorkspace.getState().findingsText).not.toMatch(/A-DERIVED/);
  });

  it("POSITIVE CONTROL — inserts the identical item when the study matches", () => {
    // Without this the refusal above is vacuous: a guard that refuses everything passes
    // the test before it.
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState(studyTransitionReset(101));

    useWorkspace.getState().insertCopilotText(itemForA());

    expect(useWorkspace.getState().findingsText).toMatch(/A-DERIVED/);
  });

  it("refuses an unstamped item even on the study it might have come from", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState(studyTransitionReset(101));

    useWorkspace.getState().insertCopilotText(itemForA({ studyId: undefined }));

    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("refuses when no study is open at all", () => {
    useWorkspace.setState(studyTransitionReset(null));
    useWorkspace.getState().insertCopilotText(itemForA());
    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("recomputeCopilot stamps every item with the study it actually read", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState({
      ...studyTransitionReset(101),
      findingsText: "Left basal ganglia shows restricted diffusion.",
      impressionText: "",
    });

    useWorkspace.getState().recomputeCopilot();

    const items = useWorkspace.getState().copilotItems;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.studyId === "101")).toBe(true);
  });

  it("and after the transition the new study's items are stamped for the new study", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState({ ...studyTransitionReset(101), findingsText: "Restricted diffusion." });
    useWorkspace.getState().recomputeCopilot();

    // A transition: identity + content move together, then the rail is rebuilt for B.
    useWorkspace.setState(studyTransitionReset(202));
    expect(useWorkspace.getState().copilotItems).toEqual([]);
    useWorkspace.getState().recomputeCopilot();
    const items = useWorkspace.getState().copilotItems;
    expect(items.every((i) => i.studyId === "202")).toBe(true);

    // A stale handler firing with A's item now cannot get through.
    useWorkspace.getState().insertCopilotText(itemForA());
    expect(useWorkspace.getState().findingsText).toBe("");
  });
});
