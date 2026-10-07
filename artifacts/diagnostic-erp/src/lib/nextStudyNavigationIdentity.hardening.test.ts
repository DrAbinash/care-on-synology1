/**
 * POST-AUDIT-A / A-03 — prove the prediction, then pin the fix.
 *
 * The audit predicted: `advanceToNextStudy()` / `parkStudy()` change which study the
 * workspace holds but cannot navigate (the store has no router access — its own comment at
 * `store.ts:1267` says so), so the route stays on B while the store moves to C. The
 * strongest consequence is the one tested here: the editor becomes associated with C while
 * an autosave still targets B.
 *
 * The prediction is executed against the real store rather than argued, because the
 * instruction was to fix A-03 only if it reproduces. It reproduces. The fix is NOT a change
 * to `advanceToNextStudy`'s ranking — that priority+TAT ordering is a deliberate clinical
 * queue policy — it is that the two UI entry points stop calling a selection function that
 * cannot navigate, and run the workspace's own guarded Next/Park instead, which go through
 * `requestLeaveThen` → `beginTransition` → `openStudy` and therefore navigate, select and
 * hydrate as one transition.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { studyTransitionReset } from "@/lib/zai-workspace/clinicalStateReset";
import { shouldCommitAutosave } from "@/lib/radiologyWorkspaceSafety";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const B = {
  id: 202, patientId: 2, patientName: "SITA DEBI", accessionNumber: "ACC-202",
  modality: "USG", studyDescription: "USG Whole Abdomen", bodyPart: "Abdomen",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.B",
};
/** Highest priority in the queue, so advanceToNextStudy is certain to pick it. */
const C = {
  id: 303, patientId: 3, patientName: "MOHAN RAJ", accessionNumber: "ACC-303",
  modality: "CT", studyDescription: "CT Chest", bodyPart: "Chest",
  status: "in_progress", priority: "stat", studyInstanceUID: "1.2.840.C",
};

beforeEach(() => {
  useWorkspace.setState({ ...studyTransitionReset(null), studies: [], completedStudyIds: new Set(), parkedStudyIds: new Set() });
});

describe("A-03 CONFIRMED — store selection without navigation desynchronises the study", () => {
  it("advanceToNextStudy moves the store off the route study and cannot move the route", () => {
    useWorkspace.getState().setStudies([B, C]);
    useWorkspace.setState({ ...studyTransitionReset(202), findingsText: "B: hepatic steatosis" });
    const routeStudyId = 202;                       // what the URL says, and cannot change here

    useWorkspace.getState().advanceToNextStudy();

    const s = useWorkspace.getState();
    expect(s.activeStudyId).toBe("303");            // store is on C
    expect(s.activeStudyId).not.toBe(String(routeStudyId));   // … route still on B
    // B's report is gone from the canvas and C's context is now in it.
    expect(s.findingsText).toBe("");
    expect(s.clinicalHistoryText).toBe("");
  });

  it("the predicted consequence holds: an autosave for the ROUTE study would still commit", () => {
    useWorkspace.getState().setStudies([B, C]);
    useWorkspace.setState(studyTransitionReset(202));
    useWorkspace.getState().advanceToNextStudy();

    // saveDraft captures the route study and a generation that nothing bumped, because
    // no navigation happened to bump it. The commit guard therefore says "yes" while the
    // narrative it read belongs to whichever study the store just switched to.
    const capturedStudyId = 202;
    const generation = 7;
    expect(shouldCommitAutosave(capturedStudyId, capturedStudyId, generation, generation)).toBe(true);
    expect(useWorkspace.getState().activeStudyId).toBe("303");

    // So the write is: B's row identity + C's clinical state. That is why this entry
    // point must not be reachable from the UI without navigating.
  });

  it("parkStudy has the same shape", () => {
    useWorkspace.getState().setStudies([B, C]);
    useWorkspace.setState(studyTransitionReset(202));
    useWorkspace.getState().parkStudy();
    const s = useWorkspace.getState();
    expect(s.parkedStudyIds.has("202")).toBe(true);   // parks the STORE's study, not the route's
    expect(s.activeStudyId).toBe("303");
  });
});

describe("A-03 the fix — guarded navigation is the only path the UI can take", () => {
  it("the command palette no longer calls the store's non-navigating selectors", () => {
    const src = read("components/radiology/zai-workspace/command-palette.tsx");
    expect(src).not.toMatch(/ws\.advanceToNextStudy\(\)/);
    expect(src).not.toMatch(/ws\.parkStudy\(\)/);
    expect(src).toMatch(/onNextStudy\?:\s*\(\)\s*=>\s*void/);
    expect(src).toMatch(/onParkStudy\?:\s*\(\)\s*=>\s*void/);
    // And the commands exist only when wired to something that navigates — the same
    // rule the print and finalize items follow. An unwired "Next study" would otherwise
    // fall back to the unsafe path.
    expect(src).toMatch(/action:\s*\(\)\s*=>\s*onNextStudy\(\)/);
    expect(src).toMatch(/action:\s*\(\)\s*=>\s*onParkStudy\(\)/);
  });

  it("the palette is wired to the workspace command dispatcher, not to the store", () => {
    const overlays = read("components/radiology/workspace/WorkspaceOverlays.tsx");
    expect(overlays).toMatch(/onNextStudy=\{\(\)\s*=>\s*_commandDispatcher\?\.next\?\.\(\)\}/);
    expect(overlays).toMatch(/onParkStudy=\{\(\)\s*=>\s*_commandDispatcher\?\.park\?\.\(\)\}/);
    expect(overlays).toMatch(/onFinalize=\{\(\)\s*=>\s*void finalizeReport\(\)\}/);
  });

  it("the dispatcher's next/park are the guarded, navigating mechanism", () => {
    const commands = read("hooks/radiology-workspace/useWorkspaceCommands.ts");
    expect(commands).toMatch(/next:\s*\(\)\s*=>\s*\{\s*goNextStudy\(\);\s*\}/);
    // goNextStudy is `requestLeaveThen(...)` in useDraftPersistence — it asks before it
    // resets, then begins a transition and opens the study.
    const draft = read("hooks/radiology-workspace/useDraftPersistence.ts");
    const start = draft.indexOf("goNextStudyRef.current = ()");
    expect(start).toBeGreaterThan(-1);
    const body = draft.slice(start, start + 600);
    expect(body).toMatch(/requestLeaveThen/);
    expect(body).toMatch(/beginTransition/);
    expect(body).toMatch(/openStudy\(next\.id\)/);
  });

  it("the Reading Queue's Next button has no unsafe fallback left in it", () => {
    const src = read("components/radiology/zai-workspace/worklist-strip.tsx");
    // Match the CALL SHAPE, not the identifier: the file legitimately names
    // advanceToNextStudy in a comment explaining why it is no longer called, and a
    // bare identifier assertion would then fail on its own prose.
    expect(src).not.toMatch(/getState\(\)\s*\.\s*advanceToNextStudy\s*\(/);
    expect(src).not.toMatch(/s => s\.advanceToNextStudy/);
    expect(src).not.toMatch(/s\.parkStudy/);
  });

  it("the store selectors themselves are unchanged, because the queue policy is not the defect", () => {
    useWorkspace.getState().setStudies([B, C]);
    useWorkspace.setState(studyTransitionReset(202));
    useWorkspace.getState().advanceToNextStudy();
    // stat outranks routine: selection logic deliberately preserved.
    expect(useWorkspace.getState().activeStudyId).toBe("303");
  });
});

describe("A-02 and A-03 together — the identity invariant has no remaining UI breach", () => {
  it("the only writers of activeStudyId are the route transition and selectStudy", () => {
    // selectStudy is called from openStudy, which navigates in the same breath
    // (useWorkspaceClinicalUi.tsx:1926-1929), so it cannot leave the store off-route.
    const clinicalUi = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
    const openStudy = clinicalUi.slice(clinicalUi.indexOf("const openStudy = useCallback"));
    expect(openStudy.slice(0, 400)).toMatch(/selectStudy\(sid\);[\s\S]{0,80}navigate\(/);
    // The lagging mirror is gone, so nothing can leave A authoritative after a move to B.
    expect(clinicalUi).not.toMatch(/if \(!studies\.some\(\(s: Study\) => s\.id === sid\)\) return;/);
  });
});
