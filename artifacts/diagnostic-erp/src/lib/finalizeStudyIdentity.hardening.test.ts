/**
 * POST-AUDIT-A / A-01 — finalization must sign the study it was started on.
 *
 * P0 being defended: `useStudyFinalize` captures the initiating study from the render
 * closure, then runs an asynchronous gauntlet (save-draft → server validation → AI
 * quality evaluation → signature fetch → the sign dialog, i.e. a human deciding) and
 * only AFTER all of that reads the report narrative out of the module-scope workspace
 * store. If the study changed underneath it, the request carried A's identity with B's
 * findings — and the server could not tell, because it validates
 * report ↔ worklist ↔ patient and then trusts `htmlBody` verbatim.
 *
 * Two things are proven here, separately:
 *   1. the identity predicate that now gates the payload read, and
 *   2. the leave guard that was already written and already wired, but was never armed
 *      on the path that actually signs a report (`startFinalize()` had exactly one
 *      caller in the repository — the command palette, which only set the flag).
 *
 * Why the guard is exercised at the store + pure-function level rather than by clicking
 * a dialog: this repository's vitest environment is `node` with no DOM (see
 * `clinicalStateReset.hardening.test.ts`, which records the same reason). `canLeaveStudy`
 * and `leaveDirtyStudy` are the production gate, and they are driven here with guards
 * built exactly the way `requestLeaveThen` builds them from the live store.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { studyTransitionReset } from "@/lib/zai-workspace/clinicalStateReset";
import { canLeaveStudy } from "@/lib/reportingWorkflow";
import { leaveDirtyStudy } from "@/lib/leaveDirtyStudy";
import {
  isFinalizeStudyIdentityIntact,
  shouldApplyAsyncStudyResult,
} from "@/lib/radiologyWorkspaceSafety";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");

const A = {
  id: 101, patientId: 1, patientName: "RAM ADHIKARI", accessionNumber: "ACC-101",
  modality: "MR", studyDescription: "MRI Brain Plain", bodyPart: "Brain",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.A",
};
const B = {
  id: 202, patientId: 2, patientName: "SITA DEBI", accessionNumber: "ACC-202",
  modality: "USG", studyDescription: "USG Whole Abdomen", bodyPart: "Abdomen",
  status: "in_progress", priority: "routine", studyInstanceUID: "1.2.840.B",
};

/** The store's guards, read the way `useDraftPersistence.requestLeaveThen` reads them. */
function guardsAsProductionBuildsThem(over: Partial<{ saving: boolean; transitioning: boolean }> = {}) {
  const s = useWorkspace.getState();
  return {
    dirty: s.isDirty,
    saving: over.saving ?? false,
    finalizing: s.isFinalizing,
    viewerLaunching: false,
    transitioning: over.transitioning ?? false,
  };
}

beforeEach(() => {
  useWorkspace.setState({
    ...studyTransitionReset(null),
    studies: [],
    nextStudyId: null,
    completedStudyIds: new Set(),
    parkedStudyIds: new Set(),
  });
});

/**
 * The wiring, pinned.
 *
 * The tests below prove the primitives behave correctly once armed; they cannot prove
 * that the finalize path arms them, because arming happens inside a React hook and this
 * environment has no DOM to run it in. These contracts read the production file, so
 * deleting `startFinalize()` or moving the identity assertion below the payload read
 * fails here rather than silently re-opening the P0. Ordering is asserted, not mere
 * presence: the assertion must come BEFORE the narrative is read, and the arming must
 * come BEFORE the first await.
 */
describe("A-01 the finalize path is the thing that arms and checks", () => {
  const src = readFileSync(resolve(ERP_SRC, "hooks/radiology-workspace/useStudyFinalize.ts"), "utf8");

  it("arms the lifecycle before its first await", () => {
    // Match the production call shape, not the bare identifier — the file's own prose
    // explains what startFinalize() is, and a naked search would match the explanation.
    const arm = src.indexOf("useWorkspace.getState().startFinalize()");
    const firstAwait = src.indexOf("await saveDraft()");
    expect(arm).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(arm).toBeLessThan(firstAwait);
  });

  it("asserts identity before it reads the clinical narrative", () => {
    const guard = src.indexOf("isFinalizeStudyIdentityIntact(studyId, useWorkspace.getState().activeStudyId)");
    const payloadRead = src.indexOf("const signed = useWorkspace.getState()");
    expect(guard).toBeGreaterThan(-1);
    expect(payloadRead).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(payloadRead);
  });

  it("refuses with a plain-language message instead of continuing or going silent", () => {
    const guard = src.indexOf("isFinalizeStudyIdentityIntact");
    const block = src.slice(guard, src.indexOf("const signed = useWorkspace.getState()"));
    expect(block).toMatch(/return;/);                     // stops; does not carry on
    expect(block).toMatch(/toast\(/);                     // and says so
    expect(block).toMatch(/Not signed/);
    expect(block).toMatch(/another study/i);
  });

  it("clears the flag on every exit through a finally, not on one happy path", () => {
    const wrapper = src.slice(src.indexOf("const finalizeReport = useCallback"));
    expect(wrapper).toMatch(/try\s*\{[\s\S]*runFinalizeGauntlet\(\)[\s\S]*\}\s*finally\s*\{[\s\S]*cancelFinalize\(\)/);
  });

  it("no longer exposes a command that arms the flag without finalizing", () => {
    const paletteRaw = readFileSync(resolve(ERP_SRC, "components/radiology/zai-workspace/command-palette.tsx"), "utf8");
    // Strip comments first: the item's own annotation quotes the call it forbids, and an
    // unstripped assertion fails on its own prose.
    const palette = paletteRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(palette).not.toMatch(/startFinalize\s*\(\s*\)/);
    const overlays = readFileSync(resolve(ERP_SRC, "components/radiology/workspace/WorkspaceOverlays.tsx"), "utf8");
    expect(overlays).toMatch(/onFinalize=\{\(\)\s*=>\s*void finalizeReport\(\)\}/);
  });
});

describe("A-01 the finalize identity predicate", () => {
  it("accepts the study it was started on", () => {
    expect(isFinalizeStudyIdentityIntact(101, 101)).toBe(true);
  });

  it("accepts the store's string form of the same route id", () => {
    // The route param is a number; the store keys studies by string. A strict `===`
    // here would refuse EVERY finalize, so the coercion is load-bearing in both
    // directions — and a non-numeric junk value must still be refused (below).
    expect(isFinalizeStudyIdentityIntact(101, "101")).toBe(true);
  });

  it("refuses a different study", () => {
    expect(isFinalizeStudyIdentityIntact(101, 202)).toBe(false);
    expect(isFinalizeStudyIdentityIntact(101, "202")).toBe(false);
  });

  it("refuses when either side is unknown — stricter than the AI sibling", () => {
    expect(isFinalizeStudyIdentityIntact(null, 101)).toBe(false);
    expect(isFinalizeStudyIdentityIntact(undefined, 101)).toBe(false);
    expect(isFinalizeStudyIdentityIntact(101, null)).toBe(false);
    expect(isFinalizeStudyIdentityIntact(101, undefined)).toBe(false);
    // `shouldApplyAsyncStudyKey` deliberately PERMITS a null request key because AI
    // paths legitimately run against rows with no DICOM UID. There is no such thing
    // for a signature.
    expect(isFinalizeStudyIdentityIntact(101, "")).toBe(false);
    expect(isFinalizeStudyIdentityIntact(101, "not-a-number")).toBe(false);
  });

  it("is not confused by NaN coercion of an empty study id", () => {
    // Number("") === 0, so a bare Number() comparison would let a finalize of study 0
    // through with no study open.
    expect(isFinalizeStudyIdentityIntact(0, "")).toBe(false);
  });
});

describe("A-01 the mixed write the predicate prevents", () => {
  it("after a study transition the live store no longer holds the captured study's narrative", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState({
      ...studyTransitionReset(101),
      findingsText: "A: LEFT basal ganglia acute infarct.",
      impressionText: "A: ACUTE ISCHAEMIC INFARCT, LEFT BASAL GANGLIA.",
      recommendationText: "A: Neurology referral.",
      isDirty: true,
    });

    // What finalize would have signed at this instant.
    const capturedStudyId = 101;
    const aFindings = useWorkspace.getState().findingsText;

    // The radiologist navigates to B while the gauntlet is still in flight.
    useWorkspace.setState(studyTransitionReset(202));

    expect(isFinalizeStudyIdentityIntact(capturedStudyId, useWorkspace.getState().activeStudyId))
      .toBe(false);
    // And the content it would have read is demonstrably not A's — the guard is not
    // refusing a hypothetical, it is refusing this.
    expect(useWorkspace.getState().findingsText).not.toBe(aFindings);
    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("a same-study refetch keeps the guard green, so the fix cannot block normal signing", () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState({ ...studyTransitionReset(101), findingsText: "A: oedema." });
    // Autosave commits, queries invalidate, the store stays on A.
    expect(isFinalizeStudyIdentityIntact(101, useWorkspace.getState().activeStudyId)).toBe(true);
    expect(shouldApplyAsyncStudyResult(101, 101)).toBe(true);
  });
});

describe("A-01 arming the existing leave guard on the real finalize path", () => {
  it("the flag was previously false for a clean study — that is the bug being fixed", () => {
    useWorkspace.getState().setStudies([A]);
    useWorkspace.setState({ ...studyTransitionReset(101), findingsText: "A: text", isDirty: false });
    // Step 1 of the gauntlet saves and clears isDirty, so by the time the awaits are
    // running the study looks perfectly left-able.
    expect(canLeaveStudy(guardsAsProductionBuildsThem()).kind).toBe("ok");
  });

  it("blocks leaving a CLEAN study while it is finalizing", () => {
    useWorkspace.getState().setStudies([A]);
    useWorkspace.setState({ ...studyTransitionReset(101), findingsText: "A: text", isDirty: false });

    useWorkspace.getState().startFinalize();
    const verdict = canLeaveStudy(guardsAsProductionBuildsThem());
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind === "blocked") {
      expect(verdict.reason).toMatch(/Finalize in progress/i);
    }
  });

  it("the real leave gate refuses to navigate while finalizing, and the study's text survives", async () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState({ ...studyTransitionReset(101), findingsText: "A: report in flight", isDirty: false });
    useWorkspace.getState().startFinalize();

    let prompted = false;
    let discarded = false;
    const result = await leaveDirtyStudy({
      guards: guardsAsProductionBuildsThem(),
      promptDirty: () => { prompted = true; return "stay"; },
      saveAndConfirm: async () => true,
      discardLocal: () => { discarded = true; },
    });

    expect(result.action).toBe("stay");
    // Blocked before the prompt, not answered by it — the dialog must not even open.
    expect(prompted).toBe(false);
    expect(discarded).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe("A: report in flight");
  });

  it("cancelFinalize clears the flag without disturbing the signed lock or the narrative", () => {
    useWorkspace.setState({ ...studyTransitionReset(101), isFinalized: true, isFinalizing: true, findingsText: "kept" });
    useWorkspace.getState().cancelFinalize();
    const s = useWorkspace.getState();
    expect(s.isFinalizing).toBe(false);
    expect(s.isFinalized).toBe(true);   // I9 must not unlock a signed report
    expect(s.findingsText).toBe("kept");
  });

  it("completeFinalize also releases the flag, so the post-sign auto-advance is not blocked by it", () => {
    useWorkspace.setState({ ...studyTransitionReset(101), isFinalizing: true });
    useWorkspace.getState().completeFinalize();
    const s = useWorkspace.getState();
    expect(s.isFinalizing).toBe(false);
    expect(s.isFinalized).toBe(true);
    expect(canLeaveStudy(guardsAsProductionBuildsThem()).kind).toBe("ok");
  });

  it("leaving is allowed again once finalization has been cleaned up", async () => {
    useWorkspace.getState().setStudies([A, B]);
    useWorkspace.setState({ ...studyTransitionReset(101), isFinalizing: true });
    useWorkspace.getState().cancelFinalize();

    const result = await leaveDirtyStudy({
      guards: guardsAsProductionBuildsThem(),
      promptDirty: () => "stay",
      saveAndConfirm: async () => true,
      discardLocal: () => {},
    });
    expect(result.action).toBe("navigate");
  });
});
