/**
 * POST-AUDIT-A / A-04 — the dirty-study guard must run BEFORE the destructive reset.
 *
 * The Reading Queue strip's row click did:
 *     select(s.id);            // FULL reset: B's texts cleared, isDirty := false
 *     onSelectStudy?.(s.id);   // = openStudyGuarded → requestLeaveThen → reads isDirty
 * `requestLeaveThen` asks the store whether the current study may be left
 * (useDraftPersistence.ts:604), and the reset had already answered "clean". So one click
 * destroyed the unsaved report the radiologist was on with no prompt, and if the leave
 * flow was cancelled afterwards the store was left on the new study while the route was
 * not.
 *
 * Two things are proven: the ordering, executed against the real `selectStudy` and the
 * real `leaveDirtyStudy` gate; and, because there is no DOM to click a button in, a
 * source contract that fails if the premature reset is put back.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { studyTransitionReset } from "@/lib/zai-workspace/clinicalStateReset";
import { leaveDirtyStudy, type LeaveChoice } from "@/lib/leaveDirtyStudy";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const B_STUDY = {
  id: 202, patientId: 2, patientName: "SITA DEBI", accessionNumber: "ACC-202",
  modality: "USG", studyDescription: "USG Whole Abdomen", bodyPart: "Abdomen",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.B",
};
const C_STUDY = {
  id: 303, patientId: 3, patientName: "MOHAN RAJ", accessionNumber: "ACC-303",
  modality: "CT", studyDescription: "CT Chest", bodyPart: "Chest",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.C",
};

function openBWithUnsavedWork() {
  useWorkspace.getState().setStudies([B_STUDY, C_STUDY]);
  useWorkspace.setState({
    ...studyTransitionReset(202),
    findingsText: "B: fatty liver, no ascites — dictated, never saved",
    impressionText: "B: hepatic steatosis",
    isDirty: true,
  });
}

/** Guards exactly as `requestLeaveThen` builds them, read at the moment of asking. */
function guardsNow() {
  const s = useWorkspace.getState();
  return {
    dirty: s.isDirty,
    saving: false,
    finalizing: s.isFinalizing,
    viewerLaunching: false,
    transitioning: false,
  };
}

async function attemptLeave(choice: LeaveChoice) {
  let asked = false;
  const result = await leaveDirtyStudy({
    guards: guardsNow(),
    promptDirty: () => { asked = true; return choice; },
    saveAndConfirm: async () => true,
    discardLocal: () => { useWorkspace.setState({ findingsText: "", impressionText: "", isDirty: false }); },
  });
  return { result, asked };
}

beforeEach(() => {
  useWorkspace.setState({ ...studyTransitionReset(null), studies: [] });
});

describe("A-04 the ordering that was wrong, demonstrated", () => {
  it("resetting first makes the guard report a dirty study as clean and skip the prompt", () => {
    openBWithUnsavedWork();
    expect(useWorkspace.getState().isDirty).toBe(true);

    // The old click handler, step by step.
    useWorkspace.getState().selectStudy("303");        // destructive, before any asking
    const dirtySeenByTheGuard = useWorkspace.getState().isDirty;

    // This is the whole defect in one assertion: by the time the guard could look,
    // there was nothing left for it to see.
    expect(dirtySeenByTheGuard).toBe(false);
    // …and B's unsaved dictation is already gone.
    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("so the leave gate returns navigate without ever asking the radiologist", async () => {
    openBWithUnsavedWork();
    useWorkspace.getState().selectStudy("303");        // the premature reset
    const { result, asked } = await attemptLeave("stay");
    expect(asked).toBe(false);
    expect(result.action).toBe("navigate");            // unsaved work destroyed silently
  });
});

describe("A-04 the ordering the fix produces", () => {
  it("asks, and the outgoing study's text and dirty flag survive a Cancel", async () => {
    openBWithUnsavedWork();

    // Production now: the click only calls openStudyGuarded → requestLeaveThen, which
    // asks BEFORE anything is reset. Nothing has touched the store yet.
    const { result, asked } = await attemptLeave("stay");

    expect(asked).toBe(true);
    expect(result).toEqual({ action: "stay", reason: "cancelled" });

    const s = useWorkspace.getState();
    expect(s.activeStudyId).toBe("202");                       // route unchanged
    expect(s.findingsText).toBe("B: fatty liver, no ascites — dictated, never saved");
    expect(s.impressionText).toBe("B: hepatic steatosis");
    expect(s.isDirty).toBe(true);
    // And C was never selected or hydrated.
    expect(s.clinicalHistoryText).not.toMatch(/CT Chest/);
  });

  it("Save & leave proceeds only after a successful save, then the transition happens", async () => {
    openBWithUnsavedWork();
    const { result, asked } = await attemptLeave("save_and_leave");
    expect(asked).toBe(true);
    expect(result.action).toBe("navigate");
    // Only now may the selection/reset run.
    useWorkspace.getState().selectStudy("303");
    useWorkspace.setState(studyTransitionReset(303));
    expect(useWorkspace.getState().activeStudyId).toBe("303");
  });

  it("Discard is an explicit choice, not something the guard infers from a wiped flag", async () => {
    openBWithUnsavedWork();
    const { result, asked } = await attemptLeave("discard");
    expect(asked).toBe(true);
    expect(result.action).toBe("navigate");
    expect(useWorkspace.getState().findingsText).toBe("");      // discarded on purpose
  });

  it("a failed save keeps the radiologist on the dirty study", async () => {
    openBWithUnsavedWork();
    const result = await leaveDirtyStudy({
      guards: guardsNow(),
      promptDirty: () => "save_and_leave",
      saveAndConfirm: async () => false,
      discardLocal: () => {},
    });
    expect(result).toEqual({ action: "stay", reason: "save_failed" });
    expect(useWorkspace.getState().findingsText).toBe("B: fatty liver, no ascites — dictated, never saved");
  });
});

describe("A-04 source contract — the premature reset must not come back", () => {
  it("the Reading Queue row click selects nothing before handing off to guarded navigation", () => {
    const src = read("components/radiology/zai-workspace/worklist-strip.tsx");
    // Bound the slice on the JSX handler itself, never on a character budget: a longer
    // comment silently empties the slice and the assertions pass vacuously.
    const start = src.indexOf("onSelectStudy?.(s.id)");
    expect(start).toBeGreaterThan(-1);
    const handler = src.slice(src.lastIndexOf("onClick={() => {", start), start);
    // Then strip the comments from the slice. The handler is annotated with an
    // explanation that contains the very words being forbidden, so a raw-text assertion
    // would fail on its own prose — and a naive strip BEFORE slicing would have removed
    // the marker the slice is anchored on.
    const code = handler.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code.length).toBeGreaterThan(25);                    // non-vacuous slice
    expect(code).not.toMatch(/\bselect\s*\(/);
    expect(code).not.toMatch(/selectStudy/);
  });

  it("the row click still goes through the guarded open, not raw navigation", () => {
    const src = read("components/radiology/zai-workspace/worklist-strip.tsx");
    expect(src).toMatch(/onSelectStudy\?:\s*\(id: string\)\s*=>\s*void/);
    const panel = read("components/radiology/workspace/WorklistPanel.tsx");
    expect(panel).toMatch(/onSelectStudy=\{openStudyGuarded\}/);
  });
});
