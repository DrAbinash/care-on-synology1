import { describe, expect, it } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTilePayload";
import type { QuickSelectTile } from "./zai-workspace/types";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { CLINICAL_UNDO_DEPTH } from "./zai-workspace/clinicalUndo";

/**
 * Stage C-2 · redo on the existing clinical snapshot mechanism.
 *
 * There was no redo. `patchUndoStack` is the store's only clinical history, `undoLastPatch` pops it,
 * and Ctrl+Shift+Z is bound to stepping *backwards* — so an undo was irreversible: the radiologist who
 * stepped one frame back to look at something could not put the finding back, they had to re-click the
 * tile and hope the same normal sentence got retired the same way.
 *
 * This slice adds a second stack of the SAME `PatchSnapshot` frames and nothing else — no new snapshot
 * shape, no new store, no second reporting workspace. Three properties are the whole design, and each
 * is pinned below:
 *
 *  1. **Symmetry.** Redo restores exactly what undo took away: Findings, Impression, the observation
 *     ledger with its per-patch records, and field provenance. A frame is not a text diff, so redo
 *     cannot half-restore a report.
 *  2. **Invalidation.** A redo stack is a straight line of history. Any new clinical edit — a Quick
 *     Select click, a bundle apply, or hand-typed text in the editor — makes the old forward branch
 *     unreachable, and keeping it would let a keystroke followed by Ctrl+Shift+Z silently resurrect a
 *     finding the radiologist had replaced.
 *  3. **The same safety boundary as undo.** A frame belongs to the study it was captured against and to
 *     the unsigned world it was captured in. Redo refuses across a study switch and on a signed report,
 *     keeps the frame, and changes nothing.
 *
 * Content is synthetic: the fixtures are shipped Quick Select tiles driven against a
 * synthesise-by-hand format baseline. No approved v4 publication exists yet, so nothing here is
 * clinically operational.
 */

const SHARED_NORMAL = "Cervical vertebral bodies demonstrate normal height and marrow signal.";
const UNRELATED_NORMAL = "Cervical spinal cord signal intensity is normal.";
const THIRD_NORMAL = "No spinal canal stenosis is seen.";
const BASELINE = [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL].join("\n");
const C2_LESION = "Focal lytic lesion of the C2 vertebral body without cortical breach.";
const C5_BURST = "Burst fracture of the C5 vertebral body with loss of posterior vertebral body height.";

function tile(label: string): QuickSelectTile {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const BURST_C5 = tile("Burst fracture C5");
const LYTIC_C2 = tile("Lytic lesion C2");
const SYRINX = tile("Cervical syrinx");

function reset(studyId = "study-A") {
  useWorkspace.setState({
    activeStudyId: studyId,
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    patchUndoStack: [], patchRedoStack: [], lastPatchSnapshot: null,
    impressionNeedsRefresh: false, confirmOverwriteOpen: false, pendingPathologyPatch: null,
    appliedFormatReportTitle: null, voiceComposerObservations: [], isFinalized: false,
    startingCanvasBaseline: {
      formatName: "Synthetic MRI Cervical Spine — Normal",
      formatRevision: null,
      findings: BASELINE,
      impression: "Synthetic normal cervical spine.",
      appliedAt: "2026-10-16T00:00:00.000Z",
    },
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Cervical Spine Plain",
      regions: ["Cervical Spine"], source: "auto",
    }),
  });
  useWorkspace.getState().setField("findings", BASELINE, { source: "template", replaceProvenance: true });
}

function select(...tiles: QuickSelectTile[]): void {
  for (const t of tiles) {
    const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
    if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
  }
}

const deselect = (t: QuickSelectTile) => useWorkspace.getState().removeObservation(`qs-${t.id}`);
const holds = (sentence: string, field = useWorkspace.getState().findingsText): boolean =>
  splitToSentences(field).map(normalizeForDedupe).includes(normalizeForDedupe(sentence));

/** Everything a redo frame owes the radiologist, compared as one value rather than field by field. */
function clinicalMirror() {
  const ws = useWorkspace.getState();
  return {
    findings: ws.findingsText,
    impression: ws.impressionText,
    technique: ws.techniqueText,
    recommendation: ws.recommendationText,
    provenance: ws.fieldProvenance,
    ledger: ws.appliedPathologyPatches.map((p) => ({
      id: p.id,
      source: p.source,
      concept: p.observation?.concept ?? null,
      role: p.observation?.role ?? null,
      baselineReplaces: p.observation?.baselineReplaces ?? null,
      lastRendered: p.lastRendered,
      replacedBaseline: p.replacedBaseline,
      protected: p.protected ?? false,
      stale: p.stale ?? false,
    })),
  };
}

describe("Stage C-2 · redo restores what undo took away", () => {
  it("puts Findings, Impression, the ledger and provenance back exactly", () => {
    reset();
    select(BURST_C5);
    select(LYTIC_C2);
    const before = clinicalMirror();

    expect(useWorkspace.getState().undoLastPatch(), "the last selection is undone").toBe(true);
    expect(clinicalMirror(), "and the report has genuinely changed").not.toEqual(before);

    expect(useWorkspace.getState().redoLastPatch(), "redo returns the C2 lesion").toBe(true);
    expect(clinicalMirror(),
      "redo restores the whole clinical state, not only the prose — the ledger row, its baseline "
      + "record and the provenance map come back with the sentences").toEqual(before);
  });

  it("redoes several steps in the reverse order of the undos", () => {
    reset();
    select(BURST_C5);
    const afterFirst = clinicalMirror();
    select(LYTIC_C2);
    const afterSecond = clinicalMirror();
    select(SYRINX);

    const ws = useWorkspace.getState();
    ws.undoLastPatch();
    ws.undoLastPatch();
    expect(clinicalMirror()).toEqual(afterFirst);

    expect(useWorkspace.getState().redoLastPatch()).toBe(true);
    expect(clinicalMirror()).toEqual(afterSecond);
    expect(useWorkspace.getState().redoLastPatch()).toBe(true);
    expect(holds(C2_LESION) && holds(SYRINX.sentence) && holds(BURST_C5.sentence),
      "the whole forward sequence is rebuilt").toBe(true);
  });

  it("lets the radiologist step back again after a redo", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    const beforeUndo = clinicalMirror();
    useWorkspace.getState().undoLastPatch();
    useWorkspace.getState().redoLastPatch();
    expect(clinicalMirror()).toEqual(beforeUndo);
    expect(useWorkspace.getState().undoLastPatch(),
      "the frame redo consumed is put back on the undo stack, so Undo is not one-way any more").toBe(true);
    expect(clinicalMirror().ledger.map((l) => l.id)).toEqual([`qs-${BURST_C5.id}`]);
  });

  it("re-suppresses a shared normal that the undo had legitimately restored", () => {
    // The set-based rule has to hold in both directions. Deselecting the burst fracture while the C2
    // lesion is held keeps the vertebral-body normal retired; undoing that deselection brings the
    // fracture sentence back; redoing it must retire the normal again, because the lesion falsifies it
    // and the fracture has just been removed a second time.
    reset();
    select(BURST_C5, LYTIC_C2);
    deselect(BURST_C5);
    expect(holds(SHARED_NORMAL), "the lesion still suppresses it").toBe(false);

    useWorkspace.getState().undoLastPatch();
    expect(holds(C5_BURST), "undo re-applies the fracture").toBe(true);
    expect(holds(SHARED_NORMAL),
      "and the normal is still suppressed — two abnormalities are held again").toBe(false);

    expect(useWorkspace.getState().redoLastPatch()).toBe(true);
    expect(holds(C5_BURST), "redo takes the fracture away again").toBe(false);
    expect(holds(SHARED_NORMAL),
      "the normal stays retired while the lytic lesion is still selected").toBe(false);
    expect(holds(C2_LESION), "and the surviving lesion is untouched").toBe(true);
  });
});

describe("Stage C-2 · a new clinical edit invalidates the redo", () => {
  it("refuses redo once another tile has been clicked", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().patchRedoStack.length, "one frame is available").toBe(1);

    select(SYRINX);
    expect(useWorkspace.getState().patchRedoStack,
      "a new clinical edit forks the history, so the old forward branch is unreachable").toEqual([]);
    expect(useWorkspace.getState().redoLastPatch(), "and redo says so rather than guessing").toBe(false);
    expect(holds(SYRINX.sentence) && holds(BURST_C5.sentence),
      "the report is what the radiologist just made it").toBe(true);
    expect(holds(C2_LESION),
      "redo must not resurrect the lesion the new edit replaced it with").toBe(false);
  });

  it("refuses redo after the radiologist types into the report", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    useWorkspace.getState().undoLastPatch();
    const TYPED = "The C2 body is extensively replaced by the patient's own words.";
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\n${TYPED}`, {
      source: "manual",
    });

    expect(useWorkspace.getState().redoLastPatch(),
      "hand-written text is a clinical edit; a redo on top of it would delete what was just written")
      .toBe(false);
    expect(useWorkspace.getState().findingsText.includes(TYPED), "and the typing survives").toBe(true);
  });

  it("keeps the redo stack through an edit that takes no undo frame", () => {
    // `skipUndoSnapshot` is how a multi-level bundle wraps several applies in ONE undo frame. The
    // wrapper's own frame is the edit, so the frames around it must not each discard the forward
    // branch — otherwise a bundle apply would silently cancel a redo the radiologist can still see.
    reset();
    select(BURST_C5, LYTIC_C2);
    useWorkspace.getState().undoLastPatch();
    const before = useWorkspace.getState().patchRedoStack.length;
    useWorkspace.getState().applyPathologyOverlay({
      ...quickSelectTilePatch(SYRINX, "findings"),
      skipUndoSnapshot: true,
    } as never);
    expect(useWorkspace.getState().patchRedoStack.length,
      "a frame-less write is not a new history entry").toBe(before);
  });
});

describe("Stage C-2 · redo obeys the same boundary as undo", () => {
  it("refuses a frame captured against another study and keeps it on the stack", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().patchRedoStack.length).toBe(1);
    const after = clinicalMirror();

    // The three reset paths clear the stacks on a normal switch, so reaching this state means a switch
    // that went through none of them — a deep link, or browser Back/Forward.
    useWorkspace.setState({ activeStudyId: "study-B" } as never);
    expect(useWorkspace.getState().redoLastPatch(),
      "restoring Patient A's frame into Patient B's report is refused").toBe(false);
    expect(useWorkspace.getState().patchRedoStack.length,
      "and the frame is kept: it is still the correct forward history for the study it came from")
      .toBe(1);
    expect(clinicalMirror(), "nothing was written").toEqual(after);
  });

  it("refuses to redo on a signed report", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    useWorkspace.getState().undoLastPatch();
    useWorkspace.getState().completeFinalize();
    expect(useWorkspace.getState().isFinalized, "signed by the real signing action").toBe(true);
    const frames = useWorkspace.getState().patchRedoStack.length;

    expect(useWorkspace.getState().redoLastPatch()).toBe(false);
    expect(useWorkspace.getState().patchRedoStack.length,
      "the frame survives the refusal").toBe(frames);
    expect(holds(C2_LESION), "and the signed text is untouched").toBe(false);
  });

  it("clears the redo stack with the rest of the study's clinical state", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().patchRedoStack.length).toBe(1);

    // `selectStudy` no-ops on an id that is not in the worklist — deliberately, since a silent no-op on
    // a reset path is what hid the cross-patient undo leak — so the switch is made against a real row.
    useWorkspace.setState({
      studies: [{ id: "study-B", studyInstanceUID: "1.2.840.B", clinicalHistory: "B: synthetic" }] as never,
    });
    useWorkspace.getState().selectStudy("study-B");
    expect(useWorkspace.getState().activeStudyId).toBe("study-B");
    expect(useWorkspace.getState().patchRedoStack,
      "the same reset that drops the undo stack must drop the redo stack, or the next patient can be "
      + "handed the previous patient's forward history").toEqual([]);
  });

  it("bounds the redo stack to the same depth as the undo stack", () => {
    reset();
    const tiles = [BURST_C5, LYTIC_C2, SYRINX];
    for (let i = 0; i < CLINICAL_UNDO_DEPTH + 3; i += 1) {
      select(tiles[i % tiles.length]);
    }
    const ws = useWorkspace.getState();
    for (let i = 0; i < CLINICAL_UNDO_DEPTH + 3; i += 1) ws.undoLastPatch();
    expect(useWorkspace.getState().patchRedoStack.length,
      `redo cannot grow without limit either (depth ${CLINICAL_UNDO_DEPTH})`)
      .toBeLessThanOrEqual(CLINICAL_UNDO_DEPTH);
  });
});

describe("Stage C-2 · nothing to redo", () => {
  it("returns false and changes nothing when the stack is empty", () => {
    reset();
    select(BURST_C5);
    expect(useWorkspace.getState().patchRedoStack).toEqual([]);
    const before = clinicalMirror();
    expect(useWorkspace.getState().redoLastPatch()).toBe(false);
    expect(clinicalMirror()).toEqual(before);
  });

  it("stops reporting success once the frames are exhausted", () => {
    reset();
    select(BURST_C5);
    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().redoLastPatch()).toBe(true);
    expect(useWorkspace.getState().redoLastPatch(), "a second redo has nothing left to give").toBe(false);
  });
});
