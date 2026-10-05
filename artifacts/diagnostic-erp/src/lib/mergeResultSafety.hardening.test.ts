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
 * ownership survives as explicitly stale audit context (never deleted, never
 * left claiming prose that is no longer there), one undo frame is pushed, undo
 * restores the complete pre-merge state, and freshness is computed rather than
 * asserted.
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
  it("keeps the observation in the ledger, marked stale rather than deleted", () => {
    buildPopulatedReport();
    mergeTwoFormatsViaThePicker();

    useWorkspace.getState().applyMergedResult();

    const patches = useWorkspace.getState().appliedPathologyPatches;
    // Deleting it loses the structured record of what was asserted; keeping it
    // live claims ownership of prose the merge just overwrote. Stale is the
    // repo's own word for "rendered text no longer present" — the same flag
    // hydrateObservationLedger sets on reopen, surfaced as NEEDS REFRESH in the
    // ledger panel.
    expect(patches).toHaveLength(1);
    expect(patches[0]!.id).toBe("qs-disc-l45");
    expect(patches[0]!.stale).toBe(true);
    // Identity survives, so the radiologist can see WHICH observation went stale.
    expect(patches[0]!.observation?.level).toBe("L4-L5");
    expect(patches[0]!.lastRendered.findings).toContain("L4-L5");
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

  it("does not mark the template-derived impression fresh", () => {
    buildPopulatedReport();
    mergeTwoFormatsViaThePicker();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);

    useWorkspace.getState().applyMergedResult();

    // The merged Impression is template prose. A stale observation with rendered
    // findings means it has not been reconciled against them — which is exactly
    // what impressionNeedsRefreshFromNarrative already decides on hydrate.
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("writes the merged narrative", () => {
    buildPopulatedReport();
    mergeTwoFormatsViaThePicker();
    const preview = useWorkspace.getState().lastMergeResult!;

    useWorkspace.getState().applyMergedResult();

    const s = useWorkspace.getState();
    expect(s.findingsText).toBe(preview.findings);
    expect(s.impressionText).toBe(preview.impression);
    expect(s.techniqueText).toBe(preview.technique);
    expect(s.recommendationText).toBe(preview.recommendation);
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
