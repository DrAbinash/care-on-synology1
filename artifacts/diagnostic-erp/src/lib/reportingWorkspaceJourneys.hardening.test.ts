/**
 * The clinically dangerous journeys, end to end.
 *
 * Each describe here is one row of the audit's failure-mode catalogue (§22) or
 * one journey from its test list (§23), traced through the real production
 * modules rather than through a re-implementation. Where a journey runs through
 * a React hook the ERP test environment cannot mount (no DOM), the behavioural
 * half is tested against the extracted pure decision and the wiring half is
 * asserted as a source contract that reads the real file — the same compromise
 * `clinicalStateReset.hardening.test.ts` makes, and recorded as the weaker form
 * of proof that it is.
 *
 * Journeys covered:
 *   11 — a delayed AI answer for Study A arriving while Study B is open
 *   12 — pending AI text must never be silently signed
 *   13 — A → B → A rapid switching through the singleton store
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decideAiFinalizeGate, REVIEWABLE_AI_JOB_STATUSES } from "@/lib/aiFinalizeGate";
import { shouldApplyAsyncStudyKey } from "@/lib/radiologyWorkspaceSafety";
import { materializeAcceptedText, type TrackedChange } from "@/lib/reportComposer/types";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const AI_IMPRESSION_SRC = "hooks/radiology-workspace/useTriggerAiImpression.ts";
const FINALIZE_SRC = "hooks/radiology-workspace/useStudyFinalize.ts";

/** Assert `a` appears in `src` strictly before `b`. Order IS the wiring here. */
function expectOrder(src: string, ...needles: string[]): void {
  let prev = -1;
  for (const n of needles) {
    const at = src.indexOf(n);
    expect(at, `missing from source: ${n}`).toBeGreaterThan(-1);
    expect(at, `out of order: ${n}`).toBeGreaterThan(prev);
    prev = at;
  }
}

function tracked(over: Partial<TrackedChange>): TrackedChange {
  return {
    id: "c1",
    source: "AI_COMPOSER",
    changeType: "REPLACE",
    field: "IMPRESSION",
    originalText: "",
    proposedText: "",
    reviewState: "PENDING",
    clinicalSignificance: false,
    clinicalSignificanceReasons: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  useWorkspace.setState({ ...emptyClinicalState() } as never);
  useWorkspace.setState({
    activeStudyId: null,
    activeStudyInstanceUID: null,
    clinicalHistoryText: "",
    studies: [],
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── Journey 11 — a delayed AI answer lands on the wrong patient ──────────────

describe("Journey 11 — Ctrl+I on Study A, answer arrives on Study B", () => {
  /**
   * The clinical harm: the radiologist presses Ctrl+I on Patient A's findings,
   * the local model takes several seconds, they move to Patient B, and A's
   * impression appears in B's ghost layer — one Tab+Enter from being accepted
   * into B's signed report. The findings it summarises are not on screen.
   */
  const UID_A = "1.2.840.113619.STUDY.A";
  const UID_B = "1.2.840.113619.STUDY.B";

  it("refuses the answer once the open study has moved on", () => {
    const requested = { studyId: "study-A", uid: UID_A };
    const now = { studyId: "study-B", uid: UID_B };
    expect(
      shouldApplyAsyncStudyKey(requested.studyId, now.studyId)
      && shouldApplyAsyncStudyKey(requested.uid, now.uid),
    ).toBe(false);
  });

  it("accepts the answer when the radiologist is still on the same study", () => {
    expect(
      shouldApplyAsyncStudyKey("study-A", "study-A")
      && shouldApplyAsyncStudyKey(UID_A, UID_A),
    ).toBe(true);
  });

  it("refuses when only ONE of the two identities has moved", () => {
    // A stale study id with a fresh UID (or the reverse) is exactly the partial
    // binding the workspace can produce: activeStudyId is set by the URL effect
    // and activeStudyInstanceUID by a separate effect on the worklist row.
    expect(shouldApplyAsyncStudyKey("study-A", "study-A") && shouldApplyAsyncStudyKey(UID_A, UID_B)).toBe(false);
    expect(shouldApplyAsyncStudyKey("study-A", "study-B") && shouldApplyAsyncStudyKey(UID_A, UID_A)).toBe(false);
  });

  it("returns to A after A→B→A and accepts A's answer again", () => {
    const requested = { studyId: "study-A", uid: UID_A };
    expect(shouldApplyAsyncStudyKey(requested.studyId, "study-A") && shouldApplyAsyncStudyKey(requested.uid, UID_A)).toBe(true);
  });

  it("the store clears a pending ghost on switch, so only the in-flight callback could leak", () => {
    // Fake timers: selectStudy defers recomputeCopilot()/seedSystemNormalImpression()
    // by a 0ms timeout, which would otherwise fire during a later test and mutate
    // the singleton store underneath it.
    vi.useFakeTimers();
    useWorkspace.setState({
      studies: [
        { id: "study-A", studyInstanceUID: UID_A },
        { id: "study-B", studyInstanceUID: UID_B },
      ],
    } as never);
    useWorkspace.getState().selectStudy("study-A");
    useWorkspace.getState().setGhostText("A: L4-L5 disc protrusion.", "impression");
    expect(useWorkspace.getState().ghostText).toBe("A: L4-L5 disc protrusion.");

    useWorkspace.getState().selectStudy("study-B");
    const s = useWorkspace.getState();
    expect(s.ghostText).toBeNull();
    expect(s.ghostTextTarget).toBeNull();
    expect(s.activeStudyInstanceUID).toBe(UID_B);
  });

  it("WIRED: the hook captures identity before the await and checks it before writing the ghost", () => {
    const src = read(AI_IMPRESSION_SRC);
    expect(src).toContain("shouldApplyAsyncStudyKey");
    expectOrder(
      src,
      "const atRequest = useWorkspace.getState()",
      "const requested = {",
      "await api.post<AiDraftResponse>(\"/api/ai-reporting/draft\"",
      "shouldApplyAsyncStudyKey(requested.studyId, now.activeStudyId)",
      "shouldApplyAsyncStudyKey(requested.studyInstanceUID, now.activeStudyInstanceUID)",
      "setGhostText(res.impression",
    );
    // The refusal must be told to the radiologist, not swallowed. A silent
    // discard on this path is the same defect as the silent console.warn the
    // catch block already documents.
    expect(src).toContain("AI impression discarded");
  });

  it("WIRED: the ghost write reads the post-await store, not a pre-await snapshot", () => {
    // A snapshot taken before the await would carry the OLD study's actions; the
    // write has to come from the state that the guard just cleared.
    const src = read(AI_IMPRESSION_SRC);
    expect(src).toContain("const now = useWorkspace.getState();");
    // Matched on the call's shape rather than its exact text: C2 added the context
    // binding as a third argument, and this test is about WHICH store the write
    // comes from, not about how many arguments `setGhostText` takes.
    expect(src).toMatch(/now\.setGhostText\(\s*res\.impression,\s*"impression",\s*binding\s*\)/);
    expect(src).not.toContain("atRequest.setGhostText");
  });

  it("WIRED: the Ctrl+I binding is taken from the pre-await state, not the response", () => {
    // C2's whole claim is that a proposal records the state it was generated from.
    // Read after the await it would describe whatever the radiologist had typed in
    // the meantime, and the proposal would arrive already looking current — the
    // in-flight drift case, pinned here by ordering rather than by behaviour,
    // because behaviour alone cannot tell the two readings apart until the moment
    // a response lands late.
    const src = read(AI_IMPRESSION_SRC);
    expectOrder(
      src,
      "const atRequest = useWorkspace.getState()",
      "const requestSeq = atRequest.beginAiProposalRequest()",
      "aiProposalBindingForImpression(",
      "await api.post<AiDraftResponse>(\"/api/ai-reporting/draft\"",
      "now.setGhostText(res.impression, \"impression\", binding)",
    );
    expect(src).toContain("const verdict = evaluateAiProposal(");
    expect(src).toContain("AI impression is already out of date");
  });
});

// ─── Journey 12 — pending AI text must never be silently signed ───────────────

describe("Journey 12 — signing with an unreviewed AI draft outstanding", () => {
  const pending = [tracked({ id: "p1", reviewState: "PENDING", proposedText: "AI words" })];

  it("BLOCKS finalize while a READY job has unreviewed proposals", () => {
    expect(decideAiFinalizeGate({ job: { status: "READY", trackedChanges: pending }, bypassed: false }))
      .toEqual({ block: true, pendingCount: 1 });
  });

  it("BLOCKS on STALE_READY too — a stale draft is still an unreviewed one", () => {
    expect(decideAiFinalizeGate({ job: { status: "STALE_READY", trackedChanges: pending }, bypassed: false }))
      .toEqual({ block: true, pendingCount: 1 });
  });

  it("counts every pending proposal, not just the first", () => {
    const three = [
      tracked({ id: "p1", reviewState: "PENDING" }),
      tracked({ id: "p2", reviewState: "ACCEPTED" }),
      tracked({ id: "p3", reviewState: "PENDING" }),
      tracked({ id: "p4", reviewState: "REJECTED" }),
      tracked({ id: "p5", reviewState: "PENDING" }),
    ];
    expect(decideAiFinalizeGate({ job: { status: "READY", trackedChanges: three }, bypassed: false }))
      .toEqual({ block: true, pendingCount: 3 });
  });

  it("lets the explicit bypass through — 'Reject remaining and continue' must work", () => {
    expect(decideAiFinalizeGate({ job: { status: "READY", trackedChanges: pending }, bypassed: true }))
      .toEqual({ block: false });
  });

  it("allows a fully reviewed draft", () => {
    const reviewed = [
      tracked({ id: "a1", reviewState: "ACCEPTED" }),
      tracked({ id: "r1", reviewState: "REJECTED" }),
      tracked({ id: "e1", reviewState: "EDITED" }),
    ];
    expect(decideAiFinalizeGate({ job: { status: "READY", trackedChanges: reviewed }, bypassed: false }))
      .toEqual({ block: false });
  });

  it("allows READY with no proposals at all, and no job", () => {
    expect(decideAiFinalizeGate({ job: { status: "READY", trackedChanges: [] }, bypassed: false })).toEqual({ block: false });
    expect(decideAiFinalizeGate({ job: { status: "READY" }, bypassed: false })).toEqual({ block: false });
    expect(decideAiFinalizeGate({ job: null, bypassed: false })).toEqual({ block: false });
    expect(decideAiFinalizeGate({ job: undefined, bypassed: false })).toEqual({ block: false });
  });

  it("does not strand the radiologist on a job status the review panel cannot act on", () => {
    // ReportComposerAssistant shows its action bar only for READY/STALE_READY.
    // Blocking on pending rows under any other status would raise a dialog the
    // radiologist has no button to clear. Those rows are not signable either:
    // AI text reaches the report only through applyAccepted.
    for (const status of ["QUEUED", "COMPOSING", "FAILED", "APPLIED", "DISCARDED", "CANCELLED", "OBSOLETE", undefined, null]) {
      expect(decideAiFinalizeGate({ job: { status, trackedChanges: pending }, bypassed: false }), `status=${status}`)
        .toEqual({ block: false });
    }
    expect([...REVIEWABLE_AI_JOB_STATUSES]).toEqual(["READY", "STALE_READY"]);
  });

  it("the text-level property holds independently: PENDING proposals never reach the report body", () => {
    // This is the stronger half of the journey. Guard 10 is a workflow nudge;
    // what actually keeps unreviewed AI words out of a signed report is that
    // materializeAcceptedText skips them, and applyAccepted is never automatic.
    const changes = [
      tracked({ id: "a1", field: "IMPRESSION", reviewState: "ACCEPTED", proposedText: "Reviewed impression." }),
      tracked({ id: "p1", field: "FINDINGS", reviewState: "PENDING", proposedText: "UNREVIEWED AI FINDINGS" }),
      tracked({ id: "p2", field: "RECOMMENDATION", reviewState: "PENDING", proposedText: "UNREVIEWED AI ADVICE" }),
    ];
    const out = materializeAcceptedText({
      currentFindings: "Radiologist's own findings.",
      currentImpression: "Radiologist's own impression.",
      currentRecommendation: "Radiologist's own advice.",
      changes,
    });
    expect(out.impression).toBe("Reviewed impression.");
    expect(out.findings).toBe("Radiologist's own findings.");
    expect(out.recommendation).toBe("Radiologist's own advice.");
    expect(JSON.stringify(out)).not.toContain("UNREVIEWED");
  });

  it("WIRED: the gate runs before anything irreversible in the finalize gauntlet", () => {
    const src = read(FINALIZE_SRC);
    expect(src).toContain("decideAiFinalizeGate");
    expectOrder(
      src,
      "const aiGate = decideAiFinalizeGate({",
      "if (aiGate.block) {",
      "reportComposer.setReviewOpen(true)",
      "await saveDraft()",
      "validateReport({",
      "/api/signatures",
      "await finalizeRadiologyReport(",
    );
    // The bypass flag must be consumed, not left latched for the next attempt.
    expect(src).toContain("aiFinalizeBypassRef.current = false");
  });

  it("WIRED: Apply is never automatic on a READY job", () => {
    const composer = read("hooks/useReportComposer.ts");
    expect(composer).toContain("Never auto on READY");
    expect(composer).toContain("significantPending");
    expect(composer).toContain("materializeAcceptedText({");
  });
});

// ─── Journey 13 — A → B → A rapid switching ───────────────────────────────────

describe("Journey 13 — A→B→A rapid switching through the singleton store", () => {
  /**
   * The store is a module-scope singleton that outlives navigation, so "switch
   * away and back" is the fastest way to find state that was never cleared.
   * A→B→A is worse than A→B: anything cached per study id can be resurrected.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkspace.setState({
      studies: [
        { id: "study-A", studyInstanceUID: "1.2.840.A", clinicalHistory: "A: 44F, radiculopathy" },
        { id: "study-B", studyInstanceUID: "1.2.840.B", clinicalHistory: "B: 61M, headache" },
      ],
    } as never);
  });

  function reportOnA(): void {
    useWorkspace.getState().selectStudy("study-A");
    useWorkspace.setState({
      findingsText: "A: L4-L5 disc protrusion.",
      impressionText: "A: L4-L5 disc protrusion.",
      recommendationText: "A: clinical correlation.",
      techniqueText: "A: MRI LS spine.",
      isDirty: true,
    } as never);
    useWorkspace.getState().setGhostText("A ghost impression", "impression");
    useWorkspace.getState().applyMacroBundle({ observations: [] });
  }

  it("A's report is not resurrected when the radiologist comes back to A", () => {
    reportOnA();
    useWorkspace.getState().selectStudy("study-B");
    useWorkspace.getState().selectStudy("study-A");

    const s = useWorkspace.getState();
    expect(s.activeStudyId).toBe("study-A");
    expect(s.activeStudyInstanceUID).toBe("1.2.840.A");
    expect(s.findingsText).toBe("");
    expect(s.impressionText).toBe("");
    expect(s.recommendationText).toBe("");
    expect(s.techniqueText).toBe("");
    expect(s.ghostText).toBeNull();
    expect(s.isDirty).toBe(false);
    expect(s.patchUndoStack).toEqual([]);
  });

  it("B never sees A's text at any point in the A→B→A journey", () => {
    reportOnA();
    useWorkspace.getState().selectStudy("study-B");
    const atB = useWorkspace.getState();
    expect(atB.activeStudyId).toBe("study-B");
    expect(atB.findingsText).toBe("");
    expect(atB.ghostText).toBeNull();
    expect(atB.clinicalHistoryText).toBe("B: 61M, headache");
    expect(JSON.stringify({
      f: atB.findingsText, i: atB.impressionText, r: atB.recommendationText,
      t: atB.techniqueText, g: atB.ghostText, h: atB.clinicalHistoryText,
    })).not.toContain("A:");

    useWorkspace.getState().selectStudy("study-A");
    expect(useWorkspace.getState().clinicalHistoryText).toBe("A: 44F, radiculopathy");
  });

  it("A's undo frame cannot be replayed onto B, nor onto the second visit to A", () => {
    reportOnA();
    expect(useWorkspace.getState().patchUndoStack).toHaveLength(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Two independent protections, and it matters which one fires.
    // (1) The FULL reset empties the stack, so on a real switch there is no
    //     frame left to replay and undoLastPatch() refuses on an empty stack —
    //     silently, because there is nothing to warn about.
    useWorkspace.getState().selectStudy("study-B");
    expect(useWorkspace.getState().undoLastPatch()).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(warn).not.toHaveBeenCalled();

    useWorkspace.getState().selectStudy("study-A");
    expect(useWorkspace.getState().undoLastPatch()).toBe(false);
    expect(useWorkspace.getState().findingsText).toBe("");
  });

  it("a frame that survives a switch which bypassed every reset path is still refused", () => {
    // Deep link, browser Back/Forward, or selectStudy no-oping on an id that is
    // not in the worklist: none of those run a reset, so the stack is still
    // holding Patient A's frame while Patient B is on screen. This is the only
    // situation the activeStudyId stamp on the frame can defend, and it warns
    // rather than failing quietly.
    reportOnA();
    useWorkspace.setState({ activeStudyId: "study-B", findingsText: "B findings" } as never);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(useWorkspace.getState().undoLastPatch()).toBe(false);

    const after = useWorkspace.getState();
    expect(after.findingsText).toBe("B findings");
    // The frame is the only record of what was undone on A; dropping it would
    // destroy history rather than protect B.
    expect(after.patchUndoStack).toHaveLength(1);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/different study/);
  });

  it("the end-of-queue path also leaves nothing for a returning study", () => {
    reportOnA();
    // Mark both reported so advanceToNextStudy falls through to the third path.
    useWorkspace.setState({ completedStudyIds: new Set(["study-A", "study-B"]) } as never);
    useWorkspace.getState().selectStudy("study-B");
    useWorkspace.getState().advanceToNextStudy();

    const end = useWorkspace.getState();
    expect(end.activeStudyId).toBeNull();
    expect(end.findingsText).toBe("");
    expect(end.patchUndoStack).toEqual([]);

    useWorkspace.getState().selectStudy("study-A");
    expect(useWorkspace.getState().findingsText).toBe("");
  });
});
