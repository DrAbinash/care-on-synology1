import { describe, expect, it } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTilePayload";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";

/**
 * Stage C-1 · shared-baseline retirement.
 *
 * Two shipped MRI Cervical Spine tiles falsify the SAME normal sentence —
 * `quick-select-tiles.data.ts:157` (Burst fracture C5) and `:161` (Lytic lesion C2) both declare
 * `baselineReplaces: "Cervical vertebral bodies demonstrate normal height and marrow signal."`
 * The radiologist can therefore hold both abnormalities at once, and either one alone makes that
 * normal false.
 *
 * The shipped engine records, per patch, only the baseline sentences THAT PATCH happened to
 * replace (`observationLedger.ts:53`, filled at `store.ts:2472`), and deselecting a patch restores
 * exactly its own private list (`observationLedger.ts:181,184` — `restoreBaselineSentences` has no
 * other caller). So the second tile, which found the normal already gone, restores nothing, and the
 * first tile puts the sentence back while the second tile's lesion is still on the page. The report
 * then states normal cervical vertebral bodies alongside a C2 lytic lesion.
 *
 * Suppression and restoration must be computed from the FINAL ACTIVE SELECTION SET, never from the
 * order the boxes were clicked. That is what these tests pin, and they are written against the real
 * store rather than the schema so a passing test means a passing report.
 */

const SHARED_NORMAL = "Cervical vertebral bodies demonstrate normal height and marrow signal.";
const UNRELATED_NORMAL = "Cervical spinal cord signal intensity is normal.";
const THIRD_NORMAL = "No spinal canal stenosis is seen.";
const C2_LESION = "Focal lytic lesion of the C2 vertebral body without cortical breach.";
const C5_BURST = "Burst fracture of the C5 vertebral body with loss of posterior vertebral body height.";

const BASELINE = [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL].join("\n");

type Tile = { id: number; label: string; baselineReplaces?: string };

function tile(label: string): Tile {
  const found = (TILES as Tile[]).find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const BURST_C5 = tile("Burst fracture C5");
const LYTIC_C2 = tile("Lytic lesion C2");

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null, voiceComposerObservations: [],
    // The canonical anatomical order. A real format application records this (`store.ts:1925`);
    // without it there is no order to restore into and the ledger keeps its historical behaviour,
    // which is what a surface with no recorded baseline must do.
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
  useWorkspace.getState().setField("findings", BASELINE, {
    source: "template", replaceProvenance: true,
  });
}

function select(...tiles: Tile[]): void {
  for (const t of tiles) {
    const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
    if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
  }
}

function deselect(t: Tile): void {
  useWorkspace.getState().removeObservation(`qs-${t.id}`);
}

function sentences(field = useWorkspace.getState().findingsText): string[] {
  return splitToSentences(field).map(normalizeForDedupe).filter(Boolean);
}

function holds(sentence: string, field?: string): boolean {
  return sentences(field).includes(normalizeForDedupe(sentence));
}

function indexOf(sentence: string): number {
  return sentences().indexOf(normalizeForDedupe(sentence));
}

describe("Stage C-1 · a normal falsified by two abnormalities", () => {
  it("holds the two shipped tiles that share one baseline", () => {
    expect(BURST_C5.baselineReplaces).toBe(LYTIC_C2.baselineReplaces);
    expect(BURST_C5.baselineReplaces).toBe(SHARED_NORMAL);
  });

  it("removes the shared normal while both are selected", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    expect(holds(SHARED_NORMAL), "both tiles falsify the vertebral-body normal").toBe(false);
    expect(holds(C5_BURST), "the first lesion prints").toBe(true);
    expect(holds(C2_LESION), "the second lesion prints").toBe(true);
  });

  it("keeps the shared normal suppressed when one of the two is deselected", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    deselect(BURST_C5);

    // The C2 lesion is still selected, and a lytic lesion of the C2 body is not a normal body.
    expect(holds(C2_LESION), "the surviving lesion must stay on the page").toBe(true);
    expect(holds(SHARED_NORMAL),
      "a C2 lytic lesion is still selected, so \"vertebral bodies demonstrate normal height and "
      + "marrow signal\" must NOT return").toBe(false);
  });

  it("restores the shared normal only when the last tile that falsifies it is removed", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    deselect(LYTIC_C2);
    expect(holds(SHARED_NORMAL), "Burst fracture C5 still falsifies it").toBe(false);
    deselect(BURST_C5);
    expect(holds(SHARED_NORMAL),
      "nothing selected now contradicts the vertebral-body normal, so it must return").toBe(true);
  });

  it("leaves an unrelated normal standing throughout", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    expect(holds(UNRELATED_NORMAL), "a C2 lesion does not make the cord normal false").toBe(true);
    deselect(BURST_C5);
    expect(holds(UNRELATED_NORMAL)).toBe(true);
    expect(holds(THIRD_NORMAL)).toBe(true);
  });

  it("returns a restored normal to its own anatomical position, not to the end of the field", () => {
    reset();
    const syrinx = tile("Cervical syrinx");
    select(BURST_C5, syrinx);
    deselect(syrinx);

    const findings = useWorkspace.getState().findingsText;
    expect(holds(UNRELATED_NORMAL, findings),
      "the syrinx was the only falsifier of the cord sentence, so it must return").toBe(true);
    const lines = sentences(findings);
    expect(lines.indexOf(normalizeForDedupe(UNRELATED_NORMAL)),
      "the cord sentence sits before the stenosis sentence in the recorded baseline, so restoration "
      + "must rejoin it there instead of appending it after the findings it sits above")
      .toBeLessThan(lines.indexOf(normalizeForDedupe(THIRD_NORMAL)));
  });

  it.fails("loses a shared normal permanently once its only recorded holder has been deselected", () => {
    // Known, characterised gap — pinned as an expected failure so it stays enforced and cannot be
    // skipped over. `replacedBaseline` is stored per patch, so Burst fracture C5 is the only row that
    // ever recorded the vertebral-body sentence. Deselecting it consumes that record while the C2
    // lesion still legitimately suppresses the normal, and nothing is left to bring it back when the
    // lesion goes too. The report then never states the vertebral bodies again: fail-safe rather than
    // false, but still a lost finding. Closing it means *deriving* the baseline layer from the
    // canonical set on every change instead of remembering it per patch — the remaining Phase 3 work.
    // When that lands, this line becomes `it(...)`: the assertion below is the correct behaviour and
    // will start failing-as-passing the moment it is true.
    reset();
    const syrinx = tile("Cervical syrinx");
    select(BURST_C5, LYTIC_C2, syrinx);
    deselect(BURST_C5);
    deselect(LYTIC_C2);
    deselect(syrinx);
    expect(holds(SHARED_NORMAL),
      "nothing selected contradicts it, so the vertebral-body normal should return").toBe(true);
  });

  it("leaves radiologist-authored text exactly as written through a shared-baseline cycle", () => {
    reset();
    const MANUAL = "Prior C5 burst fracture is healed; the patient was counseled about residual symptoms.";
    useWorkspace.getState().setField("findings", `${BASELINE}\n${MANUAL}`, {
      source: "manual", replaceProvenance: true,
    });
    select(BURST_C5, LYTIC_C2);
    deselect(BURST_C5);
    deselect(LYTIC_C2);
    expect(holds(MANUAL),
      "a manual sentence declares no baseline, so suppression never touches it").toBe(true);
  });

  it("produces the same clinical content for either selection order", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    const forward = sentences().slice().sort();
    const forwardAfterDeselect = (() => {
      deselect(BURST_C5);
      return sentences().slice().sort();
    })();

    reset();
    select(LYTIC_C2, BURST_C5);
    expect(sentences().slice().sort()).toEqual(forward);
    deselect(BURST_C5);
    expect(sentences().slice().sort()).toEqual(forwardAfterDeselect);
  });
});
