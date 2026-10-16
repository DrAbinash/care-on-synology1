import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "../zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "../zai-workspace/report-formats-library";
import { quickSelectTilePatch, tileRowId } from "../zai-workspace/quickSelectTileFixture";
import { isQuickSelectSource } from "../zai-workspace/quickSelectParameterContract";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { normalizeForDedupe } from "../reportFieldMerge";
import { assertsNormalStatement } from "../generateLocalImpression";
import { rankImpressionLine } from "../impressionPriority";
import { stripContribution } from "../observationLedger";

/**
 * Stage C Phase 4 · one report, three fields, every transition.
 *
 * Findings, Impression and Recommendation are separate clinical domains that one box
 * writes together. A deselection has to take that box's words out of every domain it
 * wrote, and only that box's: an advice line two boxes both declared stays while either
 * is held, and a sentence the radiologist typed is never touched.
 *
 * The composition is driven through the door the workspace actually uses — the shipped
 * "MRI LS Spine — Standard Normal" format applied by id, then shipped tiles clicked onto
 * it — because the defect this suite pins only appears once a real baseline has retired
 * part of a tile's sentence.
 *
 * The fixture trio is chosen for exactly that: "Disc herniation L4-L5" writes TWO
 * sentences, and the second one ("No significant central canal stenosis.") is falsified
 * by "Moderate canal stenosis L4-L5", so the moment the stenosis box is on the page the
 * herniation row's recorded contribution no longer matches the field as a whole.
 */

const LS_NORMAL = FORMATS.find((f) => f.name === "MRI LS Spine — Standard Normal")!;
const BASE_LINES = String(LS_NORMAL.findings).split(/\n+/).map((l) => l.trim()).filter(Boolean);

const HERNIATION = tile("Disc herniation L4-L5");
const STENOSIS = tile("Moderate canal stenosis L4-L5");
const SLIP = tile("Grade 1 spondylolisthesis L4-L5");
const TRIO = [HERNIATION, STENOSIS, SLIP] as const;

const HERNIATION_CLAIM = "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina.";
const STENOSIS_CLAIM = "Moderate canal stenosis at L4-L5.";
const SLIP_CLAIM = "Grade 1 spondylolisthesis at L4-L5.";
const SHARED_ADVICE = "Surgical referral if neurological deficits develop.";
const HERNIATION_IMPRESSION = String(HERNIATION.impressionSentence);
const STENOSIS_IMPRESSION = String(STENOSIS.impressionSentence);

function tile(label: string) {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

function openNormalReport() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: FORMATS,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
    }),
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [], isFinalized: false,
  });
  useWorkspace.getState().applyFormatById(LS_NORMAL.id);
}

function select(t: (typeof TRIO)[number]): void {
  const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
  if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
}

function deselect(t: (typeof TRIO)[number]): string {
  return useWorkspace.getState().removeObservation(tileRowId(t));
}

function lines(field: "findings" | "impression" | "recommendation"): string[] {
  const text = field === "findings" ? useWorkspace.getState().findingsText
    : field === "impression" ? useWorkspace.getState().impressionText
      : useWorkspace.getState().recommendationText;
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

/** What the page asserts, ignoring the baseline it started from and its normal statements. */
function claims(): string[] {
  return lines("findings")
    .filter((l) => !BASE_LINES.includes(l))
    .filter((l) => !assertsNormalStatement(normalizeForDedupe(l)))
    .map((l) => normalizeForDedupe(l))
    .sort();
}

function holds(sentence: string, field: "findings" | "impression" | "recommendation" = "findings"): void {
  expect(
    lines(field).some((l) => normalizeForDedupe(l).includes(normalizeForDedupe(sentence))),
    `${field} no longer says "${sentence}"`,
  ).toBe(true);
}

function saysNothing(sentence: string, field: "findings" | "impression" | "recommendation" = "findings"): void {
  expect(
    lines(field).some((l) => normalizeForDedupe(l).includes(normalizeForDedupe(sentence))),
    `${field} still says "${sentence}" after the box that wrote it was clicked off`,
  ).toBe(false);
}

function rowIds(): string[] {
  return useWorkspace.getState().appliedPathologyPatches
    .filter((p) => isQuickSelectSource(p.source))
    .map((p) => p.id);
}

function permutations(): Array<[number, number, number]> {
  return [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
}

describe("Stage C Phase 4 · clicking a box off takes its words out of the report", () => {
  it("removes a finding whose own sentence a second box had already contradicted", () => {
    // The herniation writes a finding AND a normal clause; the stenosis box retires that
    // clause, so the herniation row's recorded contribution is no longer on the page as one
    // block. Removal used to prove only whole-block contributions, found none, and returned
    // `no-op-unproven` — while still deleting the row. The finding stayed printed with
    // nothing left on the ledger to own it, and a second click could not remove it either.
    openNormalReport();
    select(HERNIATION);
    select(STENOSIS);
    select(SLIP);
    expect(deselect(HERNIATION), "the deselection must report a real removal").toBe("removed");
    saysNothing(HERNIATION_CLAIM);
    holds(STENOSIS_CLAIM);
    holds(SLIP_CLAIM);
    expect(rowIds()).toEqual(expect.arrayContaining([tileRowId(STENOSIS), tileRowId(SLIP)]));
    expect(rowIds()).not.toContain(tileRowId(HERNIATION));
  });

  it("removes the same finding whichever order put the boxes on the page", () => {
    for (const order of permutations()) {
      openNormalReport();
      for (const i of order) select(TRIO[i]);
      deselect(HERNIATION);
      expect(claims(), `click order ${order.join("")} left the herniation behind`)
        .toEqual([normalizeForDedupe(SLIP_CLAIM), normalizeForDedupe(STENOSIS_CLAIM)].sort());
    }
  });

  it("takes the box's Impression line and its Findings sentence together", () => {
    openNormalReport();
    select(HERNIATION);
    select(STENOSIS);
    deselect(HERNIATION);
    saysNothing("Disc herniation at L4-L5 causing indentation on the thecal sac.", "impression");
    holds(STENOSIS_CLAIM);
    holds("Moderate canal stenosis at L4-L5.", "impression");
  });

  it("leaves an advice line the remaining box also declared", () => {
    // Herniation and spondylolisthesis both end with the same surgical-referral sentence.
    // Removing one box must not take the advice the other box is still standing behind.
    openNormalReport();
    select(HERNIATION);
    select(SLIP);
    deselect(HERNIATION);
    holds(SHARED_ADVICE, "recommendation");
    saysNothing("MRI if radicular symptoms persist.", "recommendation");
    holds("Clinical correlation.", "recommendation");
  });

  it("keeps the radiologist's own sentence through every composition and removal", () => {
    const MANUAL = "Prior discectomy at L4-L5 with post-operative changes.";
    for (const order of permutations()) {
      openNormalReport();
      useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\n${MANUAL}`, {
        source: "manual", replaceProvenance: false,
      });
      for (const i of order) select(TRIO[i]);
      holds(MANUAL);
      deselect(TRIO[order[0]]);
      deselect(TRIO[order[1]]);
      holds(MANUAL);
    }
  });
});

describe("Stage C Phase 4 · one selection set is one report, in all six click orders", () => {
  it("asserts the same findings whatever the order, and the same impression lines", () => {
    openNormalReport();
    for (const t of TRIO) select(t);
    const referenceFindings = claims();
    const referenceImpression = lines("impression")
      .filter((l) => !assertsNormalStatement(normalizeForDedupe(l)))
      .sort();
    for (const order of permutations()) {
      openNormalReport();
      for (const i of order) select(TRIO[i]);
      const label = order.map((i) => TRIO[i].label).join(" → ");
      expect(claims(), `${label} changed the findings`).toEqual(referenceFindings);
      expect(lines("impression")
        .filter((l) => !assertsNormalStatement(normalizeForDedupe(l)))
        .sort(), `${label} changed the impression claims`).toEqual(referenceImpression);
      expect(rowIds(), `${label} changed which observations are live`).toHaveLength(3);
    }
  });
});

describe("Stage C Phase 4 · two live boxes that say the same thing", () => {
  /**
   * MEASURED before this was written: across the shipped library, no two non-normal boxes in
   * one scope render the same Findings or Impression sentence (1,148 pairs compared with every
   * `{side}`/`{severity}` expansion, 0 collisions). So the second box here is not invented
   * clinical content — it is the radiologist's own box, which is the one way the workspace
   * produces two live rows saying one sentence today. A box the radiologist authors himself
   * (the Clinic Quick Select editor, `custom: true`) carries no `concept` unless he assigns
   * one, so it declares no relationship and coexists with the catalogue box instead of
   * replacing it.
   *
   * The click path already refuses to evict a live row's own sentence (Phase 5), which is why
   * both rows survive here. Removal has to be consistent with that: clicking one box off must
   * not delete words the other box is still standing behind, or the tile stays selected while
   * its finding has silently left the report.
   */
  const COPY: (typeof TILES)[number] = {
    ...STENOSIS,
    id: "custom-l45-canal-stenosis",
    label: "L4-L5 canal stenosis (my box)",
    concept: undefined,
    conflictGroup: undefined,
    custom: true,
  };

  it("keeps the shared sentence while the other box is live, and lets the last box remove it", () => {
    openNormalReport();
    select(STENOSIS);
    select(COPY);
    expect(rowIds(), "two live boxes, so both rows must be on the ledger")
      .toEqual(expect.arrayContaining([tileRowId(STENOSIS), tileRowId(COPY)]));
    expect(rowIds()).toHaveLength(2);

    expect(deselect(COPY), "the copy's row is gone, so the deselection was applied").not.toBe("missing");
    holds(STENOSIS_CLAIM);
    expect(rowIds()).toEqual([tileRowId(STENOSIS)]);

    deselect(STENOSIS);
    saysNothing(STENOSIS_CLAIM);
  });

  it("removes the shared sentence in either order of clicking off", () => {
    for (const first of [COPY, STENOSIS]) {
      openNormalReport();
      select(STENOSIS);
      select(COPY);
      deselect(first);
      holds(STENOSIS_CLAIM, "findings");
      expect(rowIds()).toEqual([tileRowId(first === COPY ? STENOSIS : COPY)]);
    }
  });
});

describe("Stage C Phase 4 · the measured residual: two unclassified lines keep the click order", () => {
  /**
   * Tripwire, not an endorsement.
   *
   * MEASURED: with the three shipped lumbar boxes on the shipped "MRI LS Spine — Standard
   * Normal" document, all six click orders produce ONE set of Impression statements and TWO
   * Impression sequences — herniation leads in orders HSP/HPS/PHS, stenosis leads in
   * SHP/SPH/PSH. Findings has the same split. The content is deterministic; the sequence is not.
   *
   * The cause is a gap in the shipped category table, not in the composer: `orderImpressionLines`
   * sorts by (rank, index) and documents "stable for equal ranks", and both of these statements
   * classify as UNCLASSIFIED_RANK, so their index — the order the boxes were clicked — decides.
   * These assertions hold while that is true and fail the moment anyone ranks one of them.
   *
   * WHY NO ORDER WAS CHOSEN HERE: which of a disc herniation and a moderate canal stenosis leads
   * a lumbar Impression is a clinical judgement, and the clinic's own lumbar library disagrees
   * with the shipped table on the neighbouring case (docs/clinical-libraries/
   * mri-lumbar-clinical-content-library.md:204 ranks spondylolisthesis ABOVE severe foraminal
   * stenosis and exiting-root compression, while `IMPRESSION_PRIORITY` ranks stenosis 5 and
   * spondylolisthesis 8). Guessing a second row of ranks would be inventing clinical policy and
   * would silently re-sequence every lumbar report. This is an owner decision; when it is ruled
   * on, replace this block with the ranked assertion.
   */
  it("leaves both shipped lumbar compressive statements unclassified, which is what lets the mouse decide", () => {
    const h = rankImpressionLine(HERNIATION_IMPRESSION, 0, { spineSegment: "lumbar" });
    const s = rankImpressionLine(STENOSIS_IMPRESSION, 0, { spineSegment: "lumbar" });
    expect(h.ruleId, `"${h.label}" is now ranked — the owner decision has been made`).toBeNull();
    expect(s.ruleId, `"${s.label}" is now ranked — the owner decision has been made`).toBeNull();
    expect(h.rank).toBe(s.rank);
  });

  it("says the same clinical things in every click order, in two possible sequences", () => {
    const sets = new Map<string, string>();
    const sequences = new Map<string, string[]>();
    for (const order of permutations()) {
      openNormalReport();
      for (const i of order) select(TRIO[i]);
      useWorkspace.getState().refreshImpressionFromLedger();
      const seq = lines("impression").filter((l) => !assertsNormalStatement(normalizeForDedupe(l)));
      sequences.set(JSON.stringify(seq), [...(sequences.get(JSON.stringify(seq)) ?? []), order.join("")]);
      sets.set(JSON.stringify([...seq].sort()), seq.join("\n"));
    }
    expect(sets.size, "click order changed WHICH Impression statements exist").toBe(1);
    expect([...sequences.keys()]).toHaveLength(2);
  });
});

describe("Stage C Phase 4 · the strip rules, stated once and unit-tested", () => {
  const CONTRIBUTION = `${HERNIATION_CLAIM}\nNo significant central canal stenosis.`;
  const FIELD = `L4-L5: Something.\n${HERNIATION_CLAIM}\n${STENOSIS_CLAIM}`;

  it("removes the sentences that are still on the page when the block as a whole is gone", () => {
    const out = stripContribution(FIELD, CONTRIBUTION, {
      [normalizeForDedupe(HERNIATION_CLAIM)]: ["quick-select"],
    });
    expect(out.outcome).toBe("removed");
    expect(out.text).not.toContain(HERNIATION_CLAIM);
    expect(out.text).toContain(STENOSIS_CLAIM);
  });

  it("never takes a sentence another live observation wrote", () => {
    const held = new Set([normalizeForDedupe(STENOSIS_CLAIM)]);
    const out = stripContribution(
      `${HERNIATION_CLAIM}\n${STENOSIS_CLAIM}`,
      `${HERNIATION_CLAIM}\n${STENOSIS_CLAIM}`,
      {
        [normalizeForDedupe(HERNIATION_CLAIM)]: ["quick-select"],
        [normalizeForDedupe(STENOSIS_CLAIM)]: ["quick-select"],
      },
      held,
    );
    expect(out.text).not.toContain(HERNIATION_CLAIM);
    expect(out.text).toContain(STENOSIS_CLAIM);
  });

  it("still reports nothing to do when no part of the contribution is on the page", () => {
    const out = stripContribution(FIELD, "A sentence that is not here at all.", {});
    expect(out.outcome).toBe("no-op-unproven");
    expect(out.text).toBe(FIELD);
  });

  it("still refuses to reach a sentence the radiologist wrote", () => {
    const manual = "The thecal sac is indented but the cord is spared.";
    const out = stripContribution(
      `${manual}\n${HERNIATION_CLAIM}`,
      `${manual}\n${HERNIATION_CLAIM}`,
      { [normalizeForDedupe(manual)]: ["manual"] },
    );
    expect(out.outcome).toBe("preserved-manual");
    expect(out.text).toContain(manual);
    expect(out.text).toContain(HERNIATION_CLAIM);
  });
});
