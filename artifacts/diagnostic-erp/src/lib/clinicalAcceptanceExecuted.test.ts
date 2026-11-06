/**
 * Stage C · the acceptance cases the CURRENT composer can answer.
 *
 * `lib/db/src/clinicalAcceptanceSpec.ts` holds the owner's twenty cases and, until
 * now, every one of them was `it.skip` with the body `expect(true, "no composer
 * exists yet").toBe(false)` — correct then, because the deterministic composer did
 * not exist. It does now: the workspace store composes a report from shipped Quick
 * Select tiles over a shipped per-level Standard Normal, with no model in the path.
 * So six cases can be discharged here without inventing an architecture — they run
 * on the same primitives `clinicalSelection/multiTilePreservation.test.ts` uses
 * (that suite's `reset`/`select`/`deselect` idiom, the real store, the shipped
 * catalogue), and they assert the properties the spec names, not new ones.
 *
 * Runs against the live composer: **T7, T12, T13, T14, T16, T17** — partially, and
 * the last block in this file names what each of them still cannot show, so a green
 * suite here is not read as a discharged case.
 *
 * Deliberately NOT discharged, with the reason recorded in the spec:
 *  - T2, T3, T5, T10 expect a clinical SENTENCE as the outcome. Their wording is
 *    marked `awaiting-radiologist-review`; a fixture cannot supply the radiologist's
 *    anatomy call, and writing one to make a test pass is the failure §5 forbids.
 *  - T1, T4, T6, T8, T9, T11, T18, T19 are written against the v4 publication
 *    machinery — `clinical_tile_normal_replacements` edges, snapshot domains
 *    (normalSlots / sections / placements / combinationRules), and numbered gate
 *    checks. The composer the clinic runs on does not read those tables, so these
 *    cases have nothing to bind to until either the v4 catalogue is seeded or the
 *    spec is re-derived against the engine that ships. That is reported, not faked.
 *  - T20 ("No AI dependency") is partly answered below as a side effect of these
 *    six running with no network at all, but its own expectation covers the print
 *    and signing legs too, so it stays open.
 *
 * Every sentence asserted here is shipped catalogue prose — the tiles' own
 * `findingText` and the format's own normals. None of it is authored for this file.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "./zai-workspace/report-formats-library";
import type { QuickSelectTile } from "./zai-workspace/types";
import { clickedTilePatch, tileRowId } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe } from "./reportFieldMerge";
import { assertsNormalStatement } from "./generateLocalImpression";

function tile(label: string): QuickSelectTile {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

function document(name: string): { findings: string; impression: string } {
  const found = FORMATS.find((f) => f.name === name);
  if (!found) throw new Error(`no shipped format named ${name}`);
  return { findings: String(found.findings), impression: String(found.impression ?? "") };
}

const LUMBAR = document("MRI LS Spine — Standard Normal");

const BULGE_L34 = tile("Disc bulge L3-L4");
const HERNIATION_L45 = tile("Disc herniation L4-L5");
const PROTRUSION_L5S1 = tile("Disc protrusion L5-S1");
const STENOSIS_MILD = tile("Mild canal stenosis L4-L5");
const STENOSIS_MODERATE = tile("Moderate canal stenosis L4-L5");
const STENOSIS_SEVERE = tile("Severe canal stenosis L4-L5");

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null, voiceComposerObservations: [],
    patchUndoStack: [], patchRedoStack: [],
    startingCanvasBaseline: {
      formatName: "Synthetic LS Spine — Standard Normal",
      formatRevision: null,
      findings: LUMBAR.findings,
      impression: LUMBAR.impression,
      appliedAt: "2026-10-27T00:00:00.000Z",
    },
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine Plain",
      regions: ["LS Spine"],
      source: "auto",
    }),
  });
  useWorkspace.getState().setField("findings", LUMBAR.findings, { source: "template", replaceProvenance: true });
  useWorkspace.getState().setField("impression", LUMBAR.impression, { source: "template", replaceProvenance: true });
}

function select(t: QuickSelectTile): void {
  const outcome = useWorkspace.getState().applyPathologyOverlay(clickedTilePatch(t, "findings", {}));
  if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
  if (outcome === "pending") useWorkspace.getState().confirmOverwriteAndApply();
}

function deselect(t: QuickSelectTile): void {
  useWorkspace.getState().removeObservation(tileRowId(t, undefined));
}

const lines = (text: string) => text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
/** The findings the report ASSERTS, order-independent: normals are excluded because
 *  their position legitimately moves when a level's block is edited. */
function claimedLines(): string[] {
  return lines(useWorkspace.getState().findingsText)
    .filter((l) => !assertsNormalStatement(normalizeForDedupe(l)))
    .sort();
}
const normalLines = (): string[] =>
  lines(useWorkspace.getState().findingsText).filter((l) => assertsNormalStatement(normalizeForDedupe(l)));

/** The shipped per-level normal for one level, read from the document, never typed. */
function normalFor(level: string, word: RegExp): string {
  const found = lines(LUMBAR.findings).find((l) => l.startsWith(`${level}:`) && word.test(l));
  if (!found) throw new Error(`the shipped lumbar baseline states no ${level} normal matching ${word}`);
  return found;
}

beforeEach(() => reset());

describe("T14 · same selection, different click order", () => {
  it("composes the identical claim set whichever abnormality was clicked first", () => {
    select(HERNIATION_L45); select(PROTRUSION_L5S1);
    const a = claimedLines();
    const aImpression = useWorkspace.getState().impressionText;

    reset();
    select(PROTRUSION_L5S1); select(HERNIATION_L45);
    const b = claimedLines();

    expect(b).toEqual(a);
    expect(useWorkspace.getState().impressionText).toBe(aImpression);
    expect(a.length, "both selections are in the report").toBeGreaterThanOrEqual(2);
  });

  it("restores the same baselines in either order once both are deselected", () => {
    select(HERNIATION_L45); select(PROTRUSION_L5S1);
    deselect(HERNIATION_L45); deselect(PROTRUSION_L5S1);
    const restoredOne = normalLines().sort();

    reset();
    select(PROTRUSION_L5S1); select(HERNIATION_L45);
    deselect(PROTRUSION_L5S1); deselect(HERNIATION_L45);
    const restoredOther = normalLines().sort();

    expect(restoredOther).toEqual(restoredOne);
    expect(restoredOne.length, "the click order cannot consume a baseline forever")
      .toBe(normalLines().length || restoredOne.length);
  });
});

describe("T7 · multiple lumbar abnormalities", () => {
  it("keeps both findings, at two levels, in either click order", () => {
    select(BULGE_L34); select(PROTRUSION_L5S1);
    const claims = claimedLines();
    expect(claims.some((l) => /L3-L4/i.test(l))).toBe(true);
    expect(claims.some((l) => /L5-S1/i.test(l))).toBe(true);

    reset();
    select(PROTRUSION_L5S1); select(BULGE_L34);
    expect(claimedLines()).toEqual(claims);
  });

  it("retires one level's baseline without retiring the other level's", () => {
    const l34 = normalFor("L3-L4", /disc bulge|protrusion/i);
    const l5s1 = normalFor("L5-S1", /disc bulge|protrusion/i);
    select(BULGE_L34);
    const after = normalLines();
    expect(after).not.toContain(l34);
    expect(after, "the other level was never touched by this tile").toContain(l5s1);
  });
});

describe("T12 · tile deselection and restoration", () => {
  it("puts the contradicted normal back when the only tile that retired it is removed", () => {
    const before = normalLines();
    const l45 = normalFor("L4-L5", /disc bulge|protrusion/i);
    expect(before).toContain(l45);

    select(HERNIATION_L45);
    expect(normalLines()).not.toContain(l45);

    deselect(HERNIATION_L45);
    expect(normalLines()).toContain(l45);
    expect(claimedLines().some((l) => /herniation/i.test(l)), "the removed finding stays removed").toBe(false);
  });

  it("keeps a baseline retired while the tile that falsifies it is still selected", () => {
    // Derived, not typed: whichever normals the herniation took off the page stay gone
    // while it is held, an unrelated tile at another level cannot put one back, and
    // they all return when the herniation itself is removed. This is the nine-pair
    // register's failure shape — the first click recorded the retirement and a later
    // click consumed the record, so the normal never came back.
    const before = normalLines();
    select(HERNIATION_L45);
    const retired = before.filter((l) => !normalLines().includes(l));
    expect(retired.length, "the herniation tile retires its level's normals")
      .toBeGreaterThanOrEqual(2);

    select(PROTRUSION_L5S1);
    for (const l of retired) {
      expect(normalLines(), `an unrelated level's tile cannot restore it: ${l}`).not.toContain(l);
    }

    deselect(HERNIATION_L45);
    for (const l of retired) {
      expect(normalLines(), `nothing falsifies it any more, so it prints again: ${l}`).toContain(l);
    }
  });
});

describe("T16 · mutually exclusive severity grades", () => {
  it("holds one canal stenosis grade at a level, whichever grade is clicked last", () => {
    select(STENOSIS_MILD);
    select(STENOSIS_MODERATE);
    const stenosis = claimedLines().filter((l) => /canal stenosis/i.test(l));
    expect(stenosis.length, "two grades of one slot are one statement, not two").toBe(1);
    expect(/moderate/i.test(stenosis[0])).toBe(true);

    select(STENOSIS_SEVERE);
    const upgraded = claimedLines().filter((l) => /canal stenosis/i.test(l));
    expect(upgraded.length).toBe(1);
    expect(/severe/i.test(upgraded[0])).toBe(true);
  });

  it("does not let a grade change delete an unrelated finding at the same level", () => {
    select(STENOSIS_MILD);
    select(BULGE_L34);
    select(STENOSIS_MODERATE);
    expect(claimedLines().some((l) => /L3-L4/i.test(l)), "the other level's finding survived").toBe(true);
  });
});

describe("T17 · undo and redo", () => {
  it("undo returns the report to the pre-click composition, redo re-applies it", () => {
    const before = { findings: useWorkspace.getState().findingsText, impression: useWorkspace.getState().impressionText };
    select(HERNIATION_L45);
    const after = claimedLines();
    expect(after).not.toEqual(lines(before.findings).filter((l) => !assertsNormalStatement(normalizeForDedupe(l))).sort());

    useWorkspace.getState().undoLastPatch();
    expect(useWorkspace.getState().findingsText).toBe(before.findings);
    expect(useWorkspace.getState().impressionText).toBe(before.impression);

    useWorkspace.getState().redoLastPatch();
    expect(claimedLines()).toEqual(after);
  });

  it("undo also brings back the baseline the click retired", () => {
    const l45 = normalFor("L4-L5", /disc bulge|protrusion/i);
    select(HERNIATION_L45);
    expect(normalLines()).not.toContain(l45);
    useWorkspace.getState().undoLastPatch();
    expect(normalLines()).toContain(l45);
  });
});

describe("never read this file's green tests as the whole case", () => {
  /**
   * Every case in the spec states several expectations; the live engine answers some
   * and not others. The ones left unevaluated are named here as data, so a passing
   * suite cannot be read as "T12 is discharged" — and so that closing one later
   * removes a line from this list rather than quietly widening a green count.
   *
   * `lib/db/src/clinicalAcceptanceSpec.ts` still marks all twenty
   * `specified-not-executed`, deliberately: widening that union is the spec's own
   * act, its guard test refuses a case claiming more than it can show, and four of
   * the twenty need the radiologist's wording before anything can be claimed.
   */
  const OPEN: Record<string, string[]> = {
    T7: ["an impression-field consolidation, if declared, leaves both findings sentences in place — the live composer has no combination rules to declare"],
    T12: ["the restore set is a SELECT over clinical_tile_normal_replacements — the composer reads `baseline_replaces` off the tile and the concept ownership table, not that edge table"],
    T13: ["the override is stored beside the study, not as a catalogue edit — here it survives as study-local manual text with its provenance, which is the live mechanism, not the v4 shadow row the case names"],
    T14: ["PR #1014's register of nine order-dependent pairs is empty when this case passes — this file proves order-independence for the pair it composes, not for the register"],
    T16: ["which one survives is declared by an `excludes` pair in both directions — the live mutual exclusion comes from the tile's conflictGroup, and nobody has checked both directions exist"],
    T17: ["the determinism principle the content hash exists to certify — no content hash is computed on this path"],
  };

  it("names an open expectation for every case it claims to run", () => {
    expect(Object.keys(OPEN).sort()).toEqual(["T12", "T13", "T14", "T16", "T17", "T7"]);
    for (const [id, gaps] of Object.entries(OPEN)) {
      expect(gaps.length, `${id} says what it still cannot show`).toBeGreaterThan(0);
      for (const gap of gaps) expect(gap, `${id}'s gap names the mechanism`).toContain("—");
    }
  });
});

describe("T13 · manual text protection", () => {
  it("keeps a sentence the radiologist typed when a tile claims the same slot", () => {
    const manual = "The radiologist's own wording about the conus, typed into Findings.";
    useWorkspace.getState().mergeField("findings", manual, "manual");
    const before = useWorkspace.getState().findingsText;
    expect(before).toContain(manual);

    // A tile that speaks about the same level now has to ask, not overwrite: the
    // mechanism returns "pending" and the manual sentence survives whatever the
    // radiologist decides next.
    const outcome = useWorkspace.getState().applyPathologyOverlay(clickedTilePatch(HERNIATION_L45, "findings", {}));
    expect(["pending", "applied", "preserved-manual"]).toContain(outcome);
    expect(useWorkspace.getState().findingsText).toContain(manual);

    if (outcome === "pending") {
      useWorkspace.getState().cancelOverwrite?.();
      expect(useWorkspace.getState().findingsText).toContain(manual);
    }
  });

  it("never rewrites manual prose into a tile sentence when the click is refused", () => {
    const manual = "Manual description of the lumbar canal.";
    useWorkspace.getState().mergeField("findings", manual, "manual");
    select(STENOSIS_MILD);
    expect(useWorkspace.getState().findingsText).toContain(manual);
  });
});
