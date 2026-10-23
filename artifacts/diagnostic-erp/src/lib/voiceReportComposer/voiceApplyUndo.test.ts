import { describe, expect, it, beforeEach } from "vitest";
import { deterministicCompose } from "../../../../api-server/src/lib/voiceReportComposer/composer";
import { DEFAULT_REPORT_FORMATS } from "../zai-workspace/report-formats-library";
import { useWorkspace } from "../zai-workspace/store";

/**
 * Undo after Apply — the affordance beside the Apply button.
 *
 * The store's bounded clinical history (depth 5) already lets Ctrl/⌘+Z step
 * back through an Apply, but nothing at the point of application NAMES the
 * frame: the radiologist who reviews the applied text and changes their mind
 * must find a small icon-only button in the sticky bar and trust it reverts
 * the apply — not one of the edits that may have landed since.
 *
 * This slice gives the apply its own identity, and with it one honest rule:
 *
 *   "Undo apply" reverts exactly the last Apply while that Apply's frame is
 *   still the TOP undo frame. The moment any newer clinical change exists, the
 *   affordance disappears (and a click that raced one says so) — it NEVER
 *   guesses, because reverting "the top frame anyway" could undo a change the
 *   radiologist can still see on the page.
 *
 * Every non-"undone" outcome leaves the undo history exactly as it was, so
 * Ctrl/⌘+Z keeps owning every step. Fixtures are the shipped MRI LS Spine
 * normal baseline driven through the deterministic composer — same lane the
 * safety suite uses, no network, no PHI.
 */

const normalLs = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;

function voicePlan(transcript: string) {
  const plan = deterministicCompose({
    transcript,
    region: "LS Spine",
    // The narrative the composer reasons against is the LIVE report — the same
    // thing the hook hands it — so a second apply sees the first one's text.
    findingsText: useWorkspace.getState().findingsText,
  });
  if (!plan) throw new Error(`deterministicCompose returned no plan for: ${transcript}`);
  return plan;
}

describe("Undo after Apply — the panel's Undo names its own apply frame", () => {
  beforeEach(() => {
    useWorkspace.setState({
      activeStudyId: "study-A",
      clinicalHistoryText: "",
      techniqueText: normalLs.technique,
      findingsText: normalLs.findings,
      impressionText: normalLs.impression,
      recommendationText: normalLs.recommendation,
      fieldProvenance: {},
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      appliedPathologyPatches: [],
      patchUndoStack: [],
      patchRedoStack: [],
      lastPatchSnapshot: null,
      lastVoiceApplyId: null,
      isDirty: false,
      isFinalized: false,
    });
  });

  it("Undo reverts exactly the last Apply — findings, impression, voice ledger — and redo still works", () => {
    const beforeFindings = useWorkspace.getState().findingsText;
    const beforeImpression = useWorkspace.getState().impressionText;

    const plan = voicePlan("Loss of lumbar lordosis. Disc desiccation at L3-4 and L4-5.");
    plan.impressionUpdate = "Loss of lumbar lordosis with multilevel disc desiccation.";
    expect(useWorkspace.getState().applyVoiceComposerPlan(plan, "test transcript")).toBe("applied");
    expect(useWorkspace.getState().findingsText).not.toBe(beforeFindings);

    // The apply named its frame: the marker matches the TOP undo frame, so the
    // button beside Apply reverts THIS apply, not whatever sits beneath it.
    const marker = useWorkspace.getState().lastVoiceApplyId;
    expect(marker).toBeTruthy();
    const top = useWorkspace.getState().patchUndoStack.at(-1);
    expect(top?.voiceApplyId).toBe(marker);

    expect(useWorkspace.getState().undoLastVoiceApply()).toBe("undone");
    expect(useWorkspace.getState().findingsText).toBe(beforeFindings);
    expect(useWorkspace.getState().impressionText).toBe(beforeImpression);
    expect(useWorkspace.getState().voiceComposerObservations).toEqual([]);
    expect(useWorkspace.getState().voiceComposerTranscriptHistory).toEqual([]);

    // The applied state is still reachable forward — redo restores it.
    expect(useWorkspace.getState().redoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).not.toBe(beforeFindings);
  });

  it("a newer clinical edit hides the affordance ('gone') instead of reverting the wrong frame", () => {
    const plan = voicePlan("Disc desiccation at L3-4.");
    expect(useWorkspace.getState().applyVoiceComposerPlan(plan, "turn one")).toBe("applied");

    // A different clinical write — a history checkbox — lands on top of the
    // apply frame. (mergeField/setField deliberately take no frame: they are
    // the typing lane, the editor owns that history.)
    const HISTORY = "Known case of glioma post-resection. Follow-up for recurrence.";
    expect(useWorkspace.getState().toggleClinicalHistoryContribution(HISTORY, true, "")).toBe("applied");

    const depth = useWorkspace.getState().patchUndoStack.length;
    expect(useWorkspace.getState().undoLastVoiceApply()).toBe("gone");
    // Refused to guess: history and text are untouched.
    expect(useWorkspace.getState().patchUndoStack.length).toBe(depth);
    expect(useWorkspace.getState().clinicalHistoryText).toContain("glioma");
    // The generic step-back path still owns the newer edit.
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().clinicalHistoryText).not.toContain("glioma");
  });

  it("depth eviction is honest — 'gone', and the surviving history is not destroyed", () => {
    const plan = voicePlan("Disc desiccation at L3-4.");
    expect(useWorkspace.getState().applyVoiceComposerPlan(plan, "turn one")).toBe("applied");
    // Enough frame-taking clinical writes (a history checkbox toggled on/off)
    // to push the apply frames past the depth bound.
    const HISTORY = "Known case of glioma post-resection. Follow-up for recurrence.";
    for (let i = 0; i < 6; i += 1) {
      expect(useWorkspace.getState().toggleClinicalHistoryContribution(HISTORY, i % 2 === 0, "")).toBeTruthy();
    }
    const depth = useWorkspace.getState().patchUndoStack.length;
    expect(useWorkspace.getState().undoLastVoiceApply()).toBe("gone");
    expect(useWorkspace.getState().patchUndoStack.length).toBe(depth);
  });

  it("a signed report refuses the apply undo and keeps the frame", () => {
    const plan = voicePlan("Disc desiccation at L3-4.");
    expect(useWorkspace.getState().applyVoiceComposerPlan(plan, "turn one")).toBe("applied");
    const depth = useWorkspace.getState().patchUndoStack.length;
    const appliedFindings = useWorkspace.getState().findingsText;

    useWorkspace.setState({ isFinalized: true });
    expect(useWorkspace.getState().undoLastVoiceApply()).toBe("refused");
    expect(useWorkspace.getState().patchUndoStack.length).toBe(depth);
    expect(useWorkspace.getState().findingsText).toBe(appliedFindings);
  });

  it("a second Apply supersedes the first — Undo reverts only the newest", () => {
    expect(useWorkspace.getState().applyVoiceComposerPlan(voicePlan("Disc desiccation at L3-4."), "turn one")).toBe("applied");
    const afterFirst = useWorkspace.getState().findingsText;
    expect(afterFirst).toMatch(/L3-L4/);

    expect(useWorkspace.getState().applyVoiceComposerPlan(voicePlan("Disc bulge at L4-5."), "turn two")).toBe("applied");
    expect(useWorkspace.getState().findingsText).toMatch(/Disc bulge at L4-L5/);

    expect(useWorkspace.getState().undoLastVoiceApply()).toBe("undone");
    // The first apply's text survives; only the second apply was reverted.
    expect(useWorkspace.getState().findingsText).toBe(afterFirst);
  });

  it("a stale marker from another study can never restore a different patient's report", () => {
    const plan = voicePlan("Disc desiccation at L3-4.");
    expect(useWorkspace.getState().applyVoiceComposerPlan(plan, "turn one")).toBe("applied");
    const appliedFindings = useWorkspace.getState().findingsText;
    // Simulates the deep-link / browser-Back edge the undo guard documents:
    // the stack was NOT cleared when the active study changed underneath it.
    useWorkspace.setState({ activeStudyId: "study-B" });
    expect(useWorkspace.getState().undoLastVoiceApply()).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe(appliedFindings);
  });
});
