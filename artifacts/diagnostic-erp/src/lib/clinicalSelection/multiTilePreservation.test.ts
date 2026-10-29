import { describe, expect, it } from "vitest";
import { useWorkspace } from "../zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "../zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "../zai-workspace/report-formats-library";
import type { QuickSelectTile } from "../zai-workspace/types";
import { clickedTilePatch, clinicalBoxForTile, quickSelectTilePatch, renderClickedTile, tileRowId } from "../zai-workspace/quickSelectTileFixture";
import { quickFindingRowBelongsTo } from "../zai-workspace/quickSelectTilePayload";
import {
  quickFindingPatch, type ClinicalQuickFindingBox,
} from "../zai-workspace/quickSelectTilePayload";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { normalizeForDedupe } from "../reportFieldMerge";
import { assertsNormalStatement } from "../generateLocalImpression";

/**
 * Stage C Phase 3 · the composition shapes a radiologist actually builds a report from,
 * measured on shipped data: real Quick Select tiles and the real per-level
 * "Standard Normal" documents they are clicked onto.
 *
 * These are the shapes where prose-derived ownership can silently drop a finding — and
 * where an over-eager "same report whatever the order" could only be satisfied by
 * discarding something compatible. Nothing here is invented wording:
 *
 *   · three levels of one family (disc bulge C4-C5, C5-C6, C6-C7),
 *   · three different concepts at ONE level (herniation + desiccation + cord compression),
 *   · the same concept and level at two sides (left and right foraminal stenosis),
 *   · the same slot named twice (herniation then extrusion) — the one case where
 *     replacing IS correct, and the severity ladder,
 *   · removal in every order, and a manual sentence written into the middle of it.
 *
 * The comparison is over the lines the report ASSERTS as findings, sorted: an
 * observation's sentence lands where the level block it belongs to sits, so line
 * position legitimately varies while the set of claims must not. Contradicted normals
 * are deliberately excluded from that comparison — the click-order asymmetry there is
 * measured and documented in `docs/clinical/V4_STAGE_C_INTEGRATION_MAP.md` §8.
 */

type Tile = QuickSelectTile;
type Side = "left" | "right" | "bilateral";

function tile(label: string): Tile {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

function format(name: string): { findings: string; impression: string } {
  const found = FORMATS.find((f) => f.name === name);
  if (!found) throw new Error(`no shipped format named ${name}`);
  return { findings: String(found.findings), impression: String(found.impression ?? "") };
}

const CERVICAL = format("MRI Cervical Spine — Standard Normal");
const LUMBAR = format("MRI LS Spine — Standard Normal");

const BULGE_C45 = tile("Disc bulge C4-C5");
const BULGE_C56 = tile("Disc bulge C5-C6");
const BULGE_C67 = tile("Disc bulge C6-C7");
const HERNIATION_C56 = tile("Disc herniation C5-C6");
const EXTRUSION_C56 = tile("Disc extrusion C5-C6");
const DESICCATION_C56 = tile("Disc desiccation C5-C6");
const CORD_C56 = tile("Cord compression C5-C6");
const FORAMEN_C56 = tile("Foraminal stenosis C5-C6");
const ROOT_C6 = tile("Nerve root compression C6");
const HERNIATION_L45 = tile("Disc herniation L4-L5");
const DESICCATION_L45 = tile("Disc desiccation L4-L5");
const HEIGHT_L45 = tile("Reduced disc height L4-L5");
const MILD_STENOSIS_L45 = tile("Mild canal stenosis L4-L5");
const MODERATE_STENOSIS_L45 = tile("Moderate canal stenosis L4-L5");

const C56_BULGE_NORMAL = "C5-C6: No significant disc bulge or protrusion is seen.";
const C67_BULGE_NORMAL = "C6-C7: No significant disc bulge or protrusion is seen.";
const C56_COMPRESSION_NORMAL = "C5-C6: No spinal canal or thecal sac compression is seen.";
const C56_SIGNAL_NORMAL = "C5-C6: Intervertebral disc signal is preserved.";
const C56_ROOT_NORMAL = "C5-C6: No exiting or traversing nerve root compression is seen.";

function reset(document: { findings: string; impression: string }, region: "Cervical Spine" | "LS Spine") {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null, voiceComposerObservations: [],
    patchUndoStack: [], patchRedoStack: [],
    startingCanvasBaseline: {
      formatName: `Synthetic ${region} — Standard Normal`,
      formatRevision: null,
      findings: document.findings,
      impression: document.impression,
      appliedAt: "2026-10-16T00:00:00.000Z",
    },
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: region === "LS Spine" ? "MRI LS Spine Plain" : "MRI Cervical Spine Plain",
      regions: [region],
      source: "auto",
    }),
  });
  useWorkspace.getState().setField("findings", document.findings, {
    source: "template", replaceProvenance: true,
  });
  useWorkspace.getState().setField("impression", document.impression, {
    source: "template", replaceProvenance: true,
  });
}

function select(t: Tile, side?: Side): void {
  // The cervical boxes now write the level that is SELECTED, not the one their
  // label illustrates, so this fixture selects it — `clickedTilePatch` reads the
  // level off the label the way the radiologist types it into the level chip. A
  // tile that asks for a side is still refused unless one is passed.
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    clickedTilePatch(t, "findings", side ? { side } : {}),
  );
  if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
  // Priority 1 hold semantics: this suite hand-writes the whole Findings field
  // with replaceProvenance, so a tile claiming that field's slots meets manual
  // wording and asks before replacing it — Replace grants the click, and the
  // point of this suite (the radiologist's own sentence survives) is unaffected.
  if (outcome === "pending") useWorkspace.getState().confirmOverwriteAndApply();
}

function deselect(t: Tile, side?: Side): void {
  useWorkspace.getState().removeObservation(
    tileRowId(t, side),
  );
}

function rowIds(): string[] {
  return useWorkspace.getState().appliedPathologyPatches.map((p) => p.id);
}

function lines(text: string): string[] {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

function findingLines(): string[] {
  return lines(useWorkspace.getState().findingsText)
    .filter((l) => !assertsNormalStatement(normalizeForDedupe(l)))
    .sort();
}

/** The shipped document plus whatever the tiles added — the order-independent claim set. */
function claimSet(): string[] {
  return findingLines().filter((l) => !lines(CERVICAL.findings).includes(l) && !lines(LUMBAR.findings).includes(l));
}

function holds(sentence: string, where = "findings"): void {
  const text = where === "findings"
    ? useWorkspace.getState().findingsText
    : useWorkspace.getState().impressionText;
  expect(
    lines(text).some((l) => normalizeForDedupe(l).includes(normalizeForDedupe(sentence))),
    `${where} no longer says "${sentence}"`,
  ).toBe(true);
}

function saysNothing(sentence: string): void {
  expect(
    lines(useWorkspace.getState().findingsText).some((l) => normalizeForDedupe(l).includes(normalizeForDedupe(sentence))),
    `"${sentence}" is still on the page`,
  ).toBe(false);
}

/** A box's own finding statements — the normals inside them are the tile's own wording. */
function asserts(t: Tile, side?: Side): string[] {
  const text = renderClickedTile(t, side ? { side } : {});
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !assertsNormalStatement(normalizeForDedupe(s)));
}

function permutations<T>(items: [T, T, T]): Array<[T, T, T]> {
  const [a, b, c] = items;
  return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

describe("Stage C Phase 3 · three levels of one family", () => {
  it("prints every selected level, whatever order the boxes were clicked in", () => {
    for (const order of permutations([BULGE_C45, BULGE_C56, BULGE_C67])) {
      reset(CERVICAL, "Cervical Spine");
      for (const t of order) select(t);
      expect(rowIds(), `${order.map((t) => t.label).join(" → ")} did not leave three live rows`)
        .toHaveLength(3);
      for (const t of order) for (const s of asserts(t)) holds(s);
    }
  });

  it("is one report for one selection set, across all six click orders", () => {
    reset(CERVICAL, "Cervical Spine");
    for (const t of [BULGE_C45, BULGE_C56, BULGE_C67]) select(t);
    const reference = claimSet();
    for (const order of permutations([BULGE_C45, BULGE_C56, BULGE_C67])) {
      reset(CERVICAL, "Cervical Spine");
      for (const t of order) select(t);
      expect(claimSet(), `click order ${order.map((t) => t.label).join(" → ")} changed the findings`)
        .toEqual(reference);
    }
  });

  it("retires the normal at the level named and leaves the other levels alone", () => {
    reset(CERVICAL, "Cervical Spine");
    select(BULGE_C56);
    saysNothing(C56_BULGE_NORMAL);
    holds(C67_BULGE_NORMAL.replace("C6-C7: ", ""));
    holds("C5-C6: Intervertebral disc signal is preserved.");
    holds("C5-C6: No exiting or traversing nerve root compression is seen.");
  });

  it("gives the baseline back when the last level is deselected, in every removal order", () => {
    for (const order of permutations([BULGE_C45, BULGE_C56, BULGE_C67])) {
      reset(CERVICAL, "Cervical Spine");
      for (const t of [BULGE_C45, BULGE_C56, BULGE_C67]) select(t);
      for (const t of order) deselect(t);
      expect(
        lines(useWorkspace.getState().findingsText),
        `removing in order ${order.map((t) => t.label).join(" → ")} left the document altered`,
      ).toEqual(lines(CERVICAL.findings));
    }
  });
});

describe("Stage C Phase 3 · three concepts at one level", () => {
  it("keeps herniation, desiccation and cord compression at C5-C6 side by side", () => {
    for (const order of permutations([HERNIATION_C56, DESICCATION_C56, CORD_C56])) {
      reset(CERVICAL, "Cervical Spine");
      for (const t of order) select(t);
      expect(rowIds(), `${order.map((t) => t.label).join(" → ")} collapsed to ${rowIds().length} rows`)
        .toHaveLength(3);
      for (const t of order) for (const s of asserts(t)) holds(s);
      saysNothing(C56_BULGE_NORMAL);
      saysNothing(C56_SIGNAL_NORMAL);
      saysNothing(C56_COMPRESSION_NORMAL);
      holds(C56_ROOT_NORMAL.replace("C5-C6: ", ""));
    }
  });

  it("is one report for one selection set at one level, across all six click orders", () => {
    reset(CERVICAL, "Cervical Spine");
    for (const t of [HERNIATION_C56, DESICCATION_C56, CORD_C56]) select(t);
    const reference = claimSet();
    for (const order of permutations([HERNIATION_C56, DESICCATION_C56, CORD_C56])) {
      reset(CERVICAL, "Cervical Spine");
      for (const t of order) select(t);
      expect(claimSet(), `click order ${order.map((t) => t.label).join(" → ")} changed the findings`)
        .toEqual(reference);
    }
  });

  it("leaves the other two findings intact when one of three is removed", () => {
    for (const removed of [HERNIATION_C56, DESICCATION_C56, CORD_C56]) {
      reset(CERVICAL, "Cervical Spine");
      for (const t of [HERNIATION_C56, DESICCATION_C56, CORD_C56]) select(t);
      deselect(removed);
      expect(rowIds()).toHaveLength(2);
      for (const t of [HERNIATION_C56, DESICCATION_C56, CORD_C56]) {
        if (t === removed) continue;
        for (const s of asserts(t)) holds(s);
      }
      saysNothing(asserts(removed)[0]);
    }
  });

  it("carries three lumbar concepts at L4-L5 into the document without losing one", () => {
    reset(LUMBAR, "LS Spine");
    for (const t of [HERNIATION_L45, DESICCATION_L45, HEIGHT_L45]) select(t);
    expect(rowIds()).toHaveLength(3);
    for (const t of [HERNIATION_L45, DESICCATION_L45, HEIGHT_L45]) {
      for (const s of asserts(t)) holds(s);
    }
  });
});

describe("Stage C Phase 3 · the two sides of one box are two findings", () => {
  it("keeps a left and a right statement of the same box, in either click order", () => {
    for (const [first, second] of [["left", "right"], ["right", "left"]] as Array<[Side, Side]>) {
      reset(CERVICAL, "Cervical Spine");
      select(FORAMEN_C56, first);
      select(FORAMEN_C56, second);
      expect(rowIds(), `${first} and ${second} of one box are two observations, not one`)
        .toHaveLength(2);
      for (const s of asserts(FORAMEN_C56, first)) holds(s);
      for (const s of asserts(FORAMEN_C56, second)) holds(s);
      holds(`${first[0].toUpperCase()}${first.slice(1)} foraminal stenosis at C5-C6.`, "impression");
      holds(`${second[0].toUpperCase()}${second.slice(1)} foraminal stenosis at C5-C6.`, "impression");
    }
  });

  it("removes exactly the side that is clicked off, and never strands the other", () => {
    for (const kept of ["left", "right"] as Side[]) {
      const gone = kept === "left" ? "right" : "left";
      reset(CERVICAL, "Cervical Spine");
      select(FORAMEN_C56, "left");
      select(FORAMEN_C56, "right");
      deselect(FORAMEN_C56, gone);
      expect(rowIds(), "one side off leaves exactly one live row").toHaveLength(1);
      for (const s of asserts(FORAMEN_C56, kept)) holds(s);
      for (const s of asserts(FORAMEN_C56, gone)) saysNothing(s);
      expect(
        lines(useWorkspace.getState().impressionText)
          .filter((l) => l.includes("foraminal stenosis at C5-C6")),
        `the ${gone} impression line stayed in the report after that side was removed`,
      ).toHaveLength(1);
    }
  });

  it("keeps the whole document when both sides are clicked off, in either removal order", () => {
    reset(CERVICAL, "Cervical Spine");
    select(FORAMEN_C56, "left");
    select(FORAMEN_C56, "right");
    deselect(FORAMEN_C56, "right");
    deselect(FORAMEN_C56, "left");
    // The system normal row legitimately returns once nothing contradicts it, so the
    // claim here is about this box: both of its rows are gone, and so is its text.
    const foramenBoxId = clinicalBoxForTile(FORAMEN_C56).id;
    expect(rowIds().filter((id) => quickFindingRowBelongsTo(id, foramenBoxId))).toEqual([]);
    expect(lines(useWorkspace.getState().findingsText)).toEqual(lines(CERVICAL.findings));
  });

  it("treats a left stenosis and a right root compression as two findings", () => {
    reset(CERVICAL, "Cervical Spine");
    select(FORAMEN_C56, "left");
    select(ROOT_C6, "right");
    expect(rowIds()).toHaveLength(2);
    for (const s of asserts(FORAMEN_C56, "left")) holds(s);
    for (const s of asserts(ROOT_C6, "right")) holds(s);
  });
});

describe("Stage C Phase 3 · the same slot still replaces", () => {
  it("replaces a herniation with an extrusion at the same level — one slot, one statement", () => {
    // The shape where taking the other observation's sentence away is CORRECT: same
    // region, same concept, same level, so the engine already resolved them into one
    // slot. A report must not carry "central disc herniation at C5-C6" and "disc
    // extrusion at C5-C6" as two separate conclusions.
    reset(CERVICAL, "Cervical Spine");
    select(HERNIATION_C56);
    select(EXTRUSION_C56);
    expect(rowIds(), "the fence must not freeze the slot").toHaveLength(1);
    for (const s of asserts(EXTRUSION_C56)) holds(s);
    for (const s of asserts(HERNIATION_C56)) saysNothing(s);
  });

  it("replaces a grade with a grade at the same level", () => {
    reset(LUMBAR, "LS Spine");
    select(MILD_STENOSIS_L45);
    select(MODERATE_STENOSIS_L45);
    expect(rowIds(), "one slot, one survivor").toHaveLength(1);
    for (const s of asserts(MODERATE_STENOSIS_L45)) holds(s);
    for (const s of asserts(MILD_STENOSIS_L45)) saysNothing(s);
  });
});

describe("Stage C Phase 3 · manual text inside a multi-level composition", () => {
  it("never reaches the radiologist's own sentence, whichever box is clicked next", () => {
    const MANUAL = "The patient declined contrast; the study is non-contrast only.";
    for (const order of permutations([BULGE_C45, BULGE_C56, BULGE_C67])) {
      reset(CERVICAL, "Cervical Spine");
      useWorkspace.getState().setField("findings", `${CERVICAL.findings}\n${MANUAL}`, {
        source: "manual", replaceProvenance: true,
      });
      for (const t of order) select(t);
      holds(MANUAL);
      for (const t of order) for (const s of asserts(t)) holds(s);
    }
  });
});

/**
 * Defect D1, measured on the release candidate at study 253 (`tmp/evidence/probe-multi-253.json`).
 *
 * Three `radiology_quick_findings` rows of ONE family at THREE levels, clicked the way the
 * Reporting Tools rail clicks them: the rail keeps a single level chip for the whole study, so
 * after "Disc bulge (pick level)" has been answered with L4-L5 that value is still lit when the
 * next box is clicked — including a box that never asked for a level and names its own
 * vertebra in its sentence. Stamping it made two different discs share one slot, and the second
 * box took over the first one's ledger row: the L4-L5 bulge left Findings and the Impression,
 * the chip went idle, and no control was left that could bring it back.
 *
 * The rows below are verbatim catalogue data, and the document is the shipped Standard Normal
 * applied through the shipped door, so the debounced report pass the clinic runs is in the frame
 * too — the composition the radiologist actually builds, not a hand-written field.
 */
const LS_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

/** row 401 — its level is in its sentence and it declares no `{level}`. */
const BULGE_L34: ClinicalQuickFindingBox = {
  id: 401, label: "Disc bulge L3-L4", studyType: "LS Spine", field: "findings",
  findingText: "Disc bulge at L3-L4 without nerve root compression.",
  impressionText: "Disc bulge at L3-L4 without nerve root compression.",
  techniqueText: "", recommendationText: "",
  concept: "", anatomicalSection: "", conflictGroup: "disc bulge", baselineReplaces: "", properties: "",
};
/** row 521 — the box that DOES ask, answered from the chip. */
const BULGE_PICK: ClinicalQuickFindingBox = {
  id: 521, label: "Disc bulge (pick level)", studyType: "LS Spine", field: "findings",
  findingText: "Disc bulge at {level} without nerve root compression.",
  impressionText: "Disc bulge at {level} without nerve root compression.",
  techniqueText: "", recommendationText: "",
  concept: "", anatomicalSection: "", conflictGroup: "disc bulge", baselineReplaces: "", properties: "level",
};
/** row 413 — a different vertebra, its own declared baseline. */
const PROTRUSION_L5S1: ClinicalQuickFindingBox = {
  id: 413, label: "Disc protrusion L5-S1", studyType: "LS Spine", field: "findings",
  findingText: "Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",
  impressionText: "Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",
  techniqueText: "", recommendationText: "",
  concept: "", anatomicalSection: "", conflictGroup: "disc protrusion",
  baselineReplaces: "L5-S1: No spinal canal or thecal sac compression is seen.", properties: "",
};

const DISC_NORMAL = (level: string) => `${level}: No significant disc bulge or protrusion is seen.`;

const findingsText = () => useWorkspace.getState().findingsText;
const liveRowIds = () => useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale).map((p) => p.id);
const addedLines = (from: string, to: string) => lines(to).filter((l) => l && !lines(from).includes(l));
const LS_NORMAL = FORMATS.find((f) => f.name === "MRI LS Spine — Standard Normal")!;

/** The rail's own sequence: the approved normal, then a click, then the debounced pass. */
function openLumbarAndClick(
  box: ClinicalQuickFindingBox,
  params: { level?: string } = {},
): string {
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickFindingPatch(box, { region: "LS Spine", studyType: "LS Spine" }, params),
  );
  if (outcome === "pending") useWorkspace.getState().confirmOverwriteAndApply();
  if (outcome === "refused") throw new Error(`selection refused for ${box.label}`);
  useWorkspace.getState().composeInstantReport(LS_CTX, false);
  return `qf-${box.id}`;
}

function openStandardNormal() {
  reset(LUMBAR, "LS Spine");
  useWorkspace.setState({ reportFormats: FORMATS as never });
  useWorkspace.getState().applyFormatById(String(LS_NORMAL.id));
}

describe("D1 · one family at three levels, clicked with the rail's level chip still lit", () => {
  it("keeps all three discs as three observations and three sentences", () => {
    openStandardNormal();
    const before = findingsText();
    openLumbarAndClick(BULGE_L34);
    openLumbarAndClick(BULGE_PICK, { level: "L4-L5" });
    openLumbarAndClick(PROTRUSION_L5S1, { level: "L4-L5" });

    expect(liveRowIds().filter((id) => id.startsWith("qf-")),
      "three boxes at three levels are three observations")
      .toEqual(expect.arrayContaining(["qf-401", "qf-521", "qf-413"]));
    for (const s of [
      "Disc bulge at L3-L4 without nerve root compression.",
      "Disc bulge at L4-L5 without nerve root compression.",
      "Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",
    ]) holds(s);
    // Each box retired its OWN level's normal and no other's.
    for (const level of ["L1-L2", "L2-L3"]) holds(DISC_NORMAL(level));
    expect(addedLines(before, findingsText()).sort(), "three findings, nothing else")
      .toEqual([
        "Disc bulge at L3-L4 without nerve root compression.",
        "Disc bulge at L4-L5 without nerve root compression.",
        "Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",
      ].sort());
  });

  it("takes the middle level out and puts exactly its own normal back", () => {
    openStandardNormal();
    openLumbarAndClick(BULGE_L34);
    const middle = openLumbarAndClick(BULGE_PICK, { level: "L4-L5" });
    openLumbarAndClick(PROTRUSION_L5S1, { level: "L4-L5" });

    expect(useWorkspace.getState().removeObservation(middle)).toBe("removed");
    useWorkspace.getState().composeInstantReport(LS_CTX, false);

    saysNothing("Disc bulge at L4-L5 without nerve root compression.");
    holds(DISC_NORMAL("L4-L5"));
    for (const s of [
      "Disc bulge at L3-L4 without nerve root compression.",
      "Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",
    ]) holds(s);
    holds(DISC_NORMAL("L1-L2"));
    // Findings and Impression move together: the middle conclusion goes, the two
    // that were not touched stay.
    const imp = lines(useWorkspace.getState().impressionText);
    expect(imp.filter((l) => /L4-L5/.test(l)), "the deseasured level leaves the Conclusion too")
      .toHaveLength(0);
    expect(imp.some((l) => l.includes("L3-L4")) && imp.some((l) => l.includes("L5-S1")),
      `the surviving levels are still concluded: ${JSON.stringify(imp)}`).toBe(true);
  });

  it("reapplies the middle level beside the other two", () => {
    openStandardNormal();
    openLumbarAndClick(BULGE_L34);
    const middle = openLumbarAndClick(BULGE_PICK, { level: "L4-L5" });
    openLumbarAndClick(PROTRUSION_L5S1, { level: "L4-L5" });
    useWorkspace.getState().removeObservation(middle);
    useWorkspace.getState().composeInstantReport(LS_CTX, false);

    openLumbarAndClick(BULGE_PICK, { level: "L4-L5" });
    holds("Disc bulge at L4-L5 without nerve root compression.");
    holds("Disc bulge at L3-L4 without nerve root compression.");
    holds("Posterocentral disc protrusion at L5-S1 indenting the thecal sac.");
    saysNothing(DISC_NORMAL("L4-L5"));
    expect(liveRowIds().filter((id) => id.startsWith("qf-")).sort())
      .toEqual(["qf-401", "qf-413", "qf-521"]);
  });
});

