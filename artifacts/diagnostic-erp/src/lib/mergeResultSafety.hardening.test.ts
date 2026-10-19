/**
 * `applyMergedResult` — merging two report formats destroyed the report it was
 * merging into.
 *
 * The two-format merge is reached from the format picker: Ctrl-click two tiles,
 * "Merge & preview", review the preview dialog, Apply. `applySelectedFormats` →
 * `confirmOverwriteAndApply` → `mergeTwoFormats` → preview → `applyMergedResult`.
 *
 * The single-format path beside it (`confirmOverwriteAndApply`, the `fs.length
 * === 1` branch) is careful: it calls `captureClinicalSnapshot` before writing,
 * keeps prior observations as `stale` audit context rather than deleting them,
 * and pushes the frame with `withPushedClinicalUndo`. The merge path did none of
 * that. Its one `set` hard-coded:
 *
 *   appliedPathologyPatches: []   — the observation ledger, gone
 *   lastPatchSnapshot: null       — the undo frame, gone
 *   patchUndoStack: []            — the whole undo history, gone
 *   impressionNeedsRefresh: false — "the impression is up to date"
 *
 * So Apply deleted the structured record of every observation the radiologist
 * had made, removed his ability to undo any of it, and then asserted the
 * Impression was fresh — when the Impression it had just written is
 * template-derived prose that has never been reconciled against his findings.
 * `merge-preview-dialog.tsx` warns only about textual replacement, and
 * `confirm-overwrite-dialog.tsx` says "Manual or ambiguous sections will be
 * replaced. Patient and DICOM identity stay unchanged." Neither mentions the
 * ledger, so nothing on screen told him the observations were about to be
 * discarded. Ctrl+Shift+Z after Apply returned false — "nothing to undo" —
 * because the stack had been emptied, not because there was nothing to reverse.
 *
 * These tests drive the real sequence and pin the corrected contract:
 * ownership survives (live when the merge preserved its prose, explicitly stale when
 * it did not — never deleted), one undo frame is pushed, undo restores the complete
 * pre-merge state, and freshness is computed rather than asserted.
 *
 * Ruling 2 later changed what this door writes at all — see
 * `zai-workspace/mergeDoorFollowsQuickSelectRules.test.ts` — so two expectations here
 * moved with it, and both are annotated where they are asserted rather than silently
 * renumbered.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { canUndoLastAbnormal } from "@/lib/undoLastAbnormal";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const WHOLE_SCREEN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!;
const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;

function lsContext() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI LS Spine",
    regions: ["LS Spine"],
    source: "auto",
  });
}

/** The fields a merge writes, captured so "complete pre-merge state" is checkable. */
function captureReport() {
  const s = useWorkspace.getState();
  return {
    clinicalHistoryText: s.clinicalHistoryText,
    techniqueText: s.techniqueText,
    findingsText: s.findingsText,
    impressionText: s.impressionText,
    recommendationText: s.recommendationText,
    fieldProvenance: JSON.parse(JSON.stringify(s.fieldProvenance)),
    appliedPathologyPatches: JSON.parse(JSON.stringify(s.appliedPathologyPatches)),
    impressionNeedsRefresh: s.impressionNeedsRefresh,
    appliedFormatReportTitle: s.appliedFormatReportTitle,
    undoDepth: s.patchUndoStack.length,
  };
}

beforeEach(() => {
  useWorkspace.setState({
    reportingContext: lsContext(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    activeStudyId: "study-merge",
    activeStudyInstanceUID: "1.2.840.MERGE",
    clinicalHistoryText: "44F, L5 radiculopathy.",
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    impressionNeedsRefresh: false,
    isDirty: false,
    isFinalized: false,
    confirmOverwriteOpen: false,
    pendingFormatIds: [],
    pendingFormatOverwrite: null,
    pendingFormatRegion: null,
    pendingPathologyPatch: null,
    abnormalPatternConfirm: null,
    mergePreviewOpen: false,
    lastMergeResult: null,
    lastMergeFormats: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
  } as never);
});

/**
 * A populated report: one Quick Select observation in the ledger with prose in
 * Findings and Impression, a radiologist's own sentence on top of it, and two
 * undo frames from the two edits that produced them.
 */
function buildPopulatedReport() {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
    templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
    ownership: {
      anatomicalSection: DISC_L45.anatomicalSection,
      conflictGroup: DISC_L45.conflictGroup,
      baselineReplaces: DISC_L45.baselineReplaces,
    },
    source: "quick-select",
    id: "qs-disc-l45",
    region: DISC_L45.scopeBodyPart,
    label: DISC_L45.label,
    findingsText: DISC_L45.sentence,
  });

  // His own wording, so the pre-merge state is not purely machine-written.
  useWorkspace.getState().setField(
    "recommendation",
    "Clinical correlation advised.",
    { source: "manual" },
  );

  const s = useWorkspace.getState();
  expect(s.appliedPathologyPatches.length).toBeGreaterThan(0);
  expect(s.findingsText).toContain("L4-L5");
  expect(s.patchUndoStack.length).toBeGreaterThan(0);
  return s;
}

/** The real picker sequence, ending with the preview dialog open. */
function mergeTwoFormatsViaThePicker() {
  const ws = useWorkspace.getState();
  ws.toggleFormatSelection(LS_NORMAL.id);
  ws.toggleFormatSelection(WHOLE_SCREEN.id);
  expect(useWorkspace.getState().selectedFormatIds).toHaveLength(2);

  useWorkspace.getState().applySelectedFormats();
  // Either it needed confirmation or it went straight through; both land here.
  if (useWorkspace.getState().confirmOverwriteOpen) {
    useWorkspace.getState().confirmOverwriteAndApply();
  }
  expect(useWorkspace.getState().mergePreviewOpen).toBe(true);
  expect(useWorkspace.getState().lastMergeResult).not.toBeNull();
}

describe("applyMergedResult — the report being merged into is not destroyed", () => {
  it("keeps the observation in the ledger, with the prose it owns still on the page", () => {
    buildPopulatedReport();
    mergeTwoFormatsViaThePicker();

    useWorkspace.getState().applyMergedResult();

    const patches = useWorkspace.getState().appliedPathologyPatches;
    // RULING 2 changed what this door WRITES, so it changed what "stale" can mean here.
    // Before it the merge replaced all five fields with the two templates, which is exactly
    // why the observation had to go stale — its prose was genuinely gone, and leaving the
    // row live would have it claim ownership of sentences the merge overwrote. Now the
    // herniation sentence the click wrote is still on the page, so the row is live, and a
    // live row is what the next rebuild keeps instead of dropping. The stale half of the
    // contract is still tested, at `mergeDoorFollowsQuickSelectRules.test.ts`, reached by
    // removing the prose rather than by replacing it.
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe("qs-disc-l45");
    expect(patches[0]!.stale, "its contribution survived the merge").toBeFalsy();
    // Identity survives, so the radiologist can see WHICH observation the merge is about.
    expect(patches[0]!.observation?.level).toBe("L4-L5");
    expect(patches[0]!.lastRendered.findings).toContain("L4-L5");
    expect(useWorkspace.getState().findingsText).toContain("L4-L5");
  });

  it("pushes exactly one undo frame instead of emptying the stack", () => {
    const before = buildPopulatedReport();
    const depthBefore = before.patchUndoStack.length;
    mergeTwoFormatsViaThePicker();

    useWorkspace.getState().applyMergedResult();

    const after = useWorkspace.getState();
    expect(after.patchUndoStack).toHaveLength(depthBefore + 1);
    expect(after.lastPatchSnapshot).not.toBeNull();
    // The frame has to belong to this study or undoLastPatch will refuse it.
    expect(after.lastPatchSnapshot!.activeStudyId).toBe("study-merge");
  });

  it("derives the impression's freshness instead of asserting it", () => {
    buildPopulatedReport();
    mergeTwoFormatsViaThePicker();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);

    useWorkspace.getState().applyMergedResult();

    // The property this test holds is that the door never writes a freshness verdict as a
    // literal: before ruling 2 it hard-coded `impressionNeedsRefresh: false` while its
    // template Impression sat over findings it had itself made stale. The expected value is
    // the same `true` it has always expected, and it arrives for a different reason now —
    // the merged normal was withheld and the merge added findings under a conclusion it did
    // not write, so the pair is left flagged rather than re-based. Deleting either half of
    // that (the withhold, or the withhold-aware derivation) fails this test by name.
    const s = useWorkspace.getState();
    expect(s.impressionText, "the Impression is his conclusion, not template prose")
      .toBe("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(
      s.impressionNeedsRefresh,
      "the merge added findings under a conclusion it did not write, so the door leaves it "
      + "flagged for review rather than re-basing the pair it no longer speaks for",
    ).toBe(true);
    expect(s.impressionDependencyReasons, "…by the shared predicate, not by a literal here").toEqual(["findings-changed"]);
    expect(s.impressionBasis?.recordedBy, "and the flag travels, so a reload does not clear it")
      .toBe("unreconciled");
  });

  it("writes the merged narrative and keeps what he had written", () => {
    buildPopulatedReport();
    const hisFindings = useWorkspace.getState().findingsText;
    mergeTwoFormatsViaThePicker();
    const preview = useWorkspace.getState().lastMergeResult!;

    useWorkspace.getState().applyMergedResult();

    const s = useWorkspace.getState();
    expect(s.findingsText, "the merged anatomy is all on the page").toContain(preview.findings.split("\n")[0]!);
    expect(s.findingsText, "and nothing he wrote was swept up with it").toContain(hisFindings);
    expect(s.techniqueText).toBe(preview.technique);
    expect(s.recommendationText).toContain(preview.recommendation);
    expect(s.mergePreviewOpen).toBe(false);
    expect(s.lastMergeResult).toBeNull();
  });

  it("restores the complete pre-merge state on undo", () => {
    const before = captureReport();
    buildPopulatedReport();
    const populated = captureReport();
    mergeTwoFormatsViaThePicker();
    useWorkspace.getState().applyMergedResult();

    const undone = useWorkspace.getState().undoLastPatch();

    expect(undone).toBe(true);
    const after = captureReport();
    expect(after.findingsText).toBe(populated.findingsText);
    expect(after.impressionText).toBe(populated.impressionText);
    expect(after.recommendationText).toBe(populated.recommendationText);
    expect(after.techniqueText).toBe(populated.techniqueText);
    expect(after.clinicalHistoryText).toBe(populated.clinicalHistoryText);
    expect(after.fieldProvenance).toEqual(populated.fieldProvenance);
    // The ledger comes back as it was — not empty, and not stale.
    expect(after.appliedPathologyPatches).toEqual(populated.appliedPathologyPatches);
    expect(after.appliedPathologyPatches[0]!.stale).toBeFalsy();
    // Freshness is part of the state the merge wrote, so undo has to give it back.
    expect(after.impressionNeedsRefresh).toBe(populated.impressionNeedsRefresh);
    expect(after.appliedFormatReportTitle).toBe(populated.appliedFormatReportTitle);
    expect(after.undoDepth).toBe(populated.undoDepth);
    expect(before.findingsText).toBe("");
  });

  it("does not turn the merge into an 'Undo Last Abnormal'", () => {
    buildPopulatedReport();
    mergeTwoFormatsViaThePicker();
    useWorkspace.getState().applyMergedResult();

    // That button is gated on a patch being new or changed relative to the top
    // frame. A merge stales existing patches without altering their rendered
    // content, so the gate stays shut and Ctrl+Shift+Z remains the way back.
    const s = useWorkspace.getState();
    // Asserted so this cannot pass vacuously on a missing snapshot, which is how
    // it behaved before the fix.
    expect(s.lastPatchSnapshot).not.toBeNull();
    expect(canUndoLastAbnormal({
      lastPatchSnapshot: s.lastPatchSnapshot,
      appliedPathologyPatches: s.appliedPathologyPatches,
      isFinalized: s.isFinalized,
    })).toBe(false);
  });

  it("still runs the abnormal-pattern confirmation branch untouched", () => {
    // applyMergedResult has an early return for a pending abnormal-pattern
    // confirmation. It must keep short-circuiting before any of the above.
    let called = 0;
    useWorkspace.setState({
      abnormalPatternConfirm: () => { called += 1; },
      mergePreviewOpen: true,
      lastMergeResult: null,
    } as never);

    useWorkspace.getState().applyMergedResult();

    expect(called).toBe(1);
    expect(useWorkspace.getState().mergePreviewOpen).toBe(false);
    expect(useWorkspace.getState().patchUndoStack).toEqual([]);
  });
});
