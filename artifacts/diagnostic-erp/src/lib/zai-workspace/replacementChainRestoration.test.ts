/**
 * C3 / C4 — replacement-chain lineage and orphaned advice, at the store's own
 * entry points, on shipped catalogue wording.
 *
 * C3 (severity-chain lineage loss): a same-slot update — mild → moderate →
 * severe, or bulge → protrusion — used to record the VACATED row's own
 * abnormal wording as the claim deselect restores. The chain's real lineage is
 * the pre-click NORMAL the first click retired; the claim belongs to the slot,
 * not to whichever abnormal happened to sit on it last. Deselecting the final
 * abnormal must therefore restore the original normal and never resurrect the
 * intermediate abnormal wording (owner directive: "The fix must not restore
 * intermediate abnormal wording after deselection").
 *
 * C4 (orphaned recommendations): the vacated row's advice used to survive the
 * update that retired its finding. The deselection path strips a row's own
 * recommendation sentences (removeLedgerObservation → stripContribution); the
 * same-slot update path dropped the row from the ledger without that strip, so
 * the report kept advising about a finding it no longer contained — with the
 * only guards being the ones this file pins: advice another live row also
 * owns stays, and advice the radiologist hand-edited stays.
 *
 * The boxes below mirror quick-select-tiles.data.ts (the shipped catalogue):
 * 122 Mild canal stenosis L4-L5 · 123 Moderate canal stenosis L4-L5 ·
 * 124 Severe canal stenosis L4-L5 · 117 Disc herniation L4-L5, and the
 * paracentral-extrusion family the same catalogue ships for other levels.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import {
  DEFAULT_REPORT_FORMATS,
} from "./report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { useWorkspace } from "./store";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

/** quick-select-tiles.data.ts:122 — t("findings","Mild canal stenosis L4-L5", …). */
const MILD: ClinicalQuickFindingBox = {
  id: 9111,
  label: "Mild canal stenosis L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Mild canal stenosis at L4-L5 without cord compression.",
  impressionText: "Mild canal stenosis at L4-L5.",
  techniqueText: "",
  recommendationText: "",
  concept: "canal_stenosis",
  conflictGroup: "canal stenosis",
};

/** quick-select-tiles.data.ts:123. */
const MODERATE: ClinicalQuickFindingBox = {
  ...MILD,
  id: 9102,
  label: "Moderate canal stenosis L4-L5",
  findingText: "Moderate canal stenosis at L4-L5.",
  impressionText: "Moderate canal stenosis at L4-L5.",
};

/** quick-select-tiles.data.ts:124. */
const SEVERE: ClinicalQuickFindingBox = {
  ...MILD,
  id: 9113,
  label: "Severe canal stenosis L4-L5",
  findingText: "Severe canal stenosis at L4-L5 with thecal sac compression.",
  impressionText: "Severe canal stenosis at L4-L5.",
};

/** quick-select-tiles.data.ts:117 — the shipped disc herniation box, with the
 * recommendation sentence the catalogue carries for it. */
const HERNIATION: ClinicalQuickFindingBox = {
  id: 9101,
  label: "Disc herniation L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral "
    + "protrusion causing indentation on the thecal sac and mild narrowing of bilateral "
    + "neural foramina. No significant central canal stenosis.",
  impressionText: "Disc herniation at L4-L5 causing indentation on the thecal sac.",
  techniqueText: "",
  recommendationText: "Conservative management with NSAIDs and physiotherapy.",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

/** The same catalogue's paracentral-extrusion wording (shipped for other
 * levels, here on the herniation's own slot): a second abnormal for the same
 * disc, carrying its own distinct advice. */
const EXTRUSION: ClinicalQuickFindingBox = {
  id: 9114,
  label: "Disc extrusion L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Right paracentral disc extrusion at L4-L5 indenting the thecal sac.",
  impressionText: "Right paracentral disc extrusion at L4-L5.",
  techniqueText: "",
  recommendationText: "Surgical referral if neurological deficits develop.",
  concept: "disc_contour",
  conflictGroup: "disc bulge",
};

/** quick-select-tiles.data.ts:142 family — a DIFFERENT slot (foraminal, not
 * canal) whose box carries the same advice sentence the herniation carries:
 * the held-elsewhere guard's honest case. */
const FORAMINAL: ClinicalQuickFindingBox = {
  id: 9115,
  label: "Foraminal stenosis L4-L5",
  studyType: "LS Spine",
  field: "findings",
  findingText: "Left neural foraminal stenosis at L4-L5.",
  impressionText: "Left neural foraminal stenosis at L4-L5.",
  techniqueText: "",
  recommendationText: "Conservative management with NSAIDs and physiotherapy.",
  concept: "foraminal_stenosis",
  conflictGroup: "foraminal_stenosis",
};

/** fullReportBaseline.ts l4-l5-canal — the per-level normal the first canal
 * click retires; the claim the whole chain must keep restorable. */
const CANAL_NORMAL_L45 = "L4-L5: No spinal canal or thecal sac compression is seen.";
/** fullReportBaseline.ts l4-l5-disc-contour — the disc slot's own normal. */
const DISC_NORMAL_L45 = "L4-L5: No significant disc bulge or protrusion is seen.";

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;
const recommendation = () => useWorkspace.getState().recommendationText;
/** Clinical meaning, order-independent — the journeys' own equivalence rule. */
const sentencesOf = (text: string) =>
  splitToSentences(text).map(normalizeForDedupe).filter(Boolean).sort();

function resetWorkspace() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionDependencyReasons: [], impressionBasis: null,
    impressionOrderFrozen: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], pendingFormatOverwrite: null,
    pendingFormatRegion: null, startingCanvasBaseline: null, appliedFormatName: null,
    appliedFormatReportTitle: null, reportingContext: STUDY_CTX,
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], isFinalized: false,
    coverageMarks: [], coverageByScope: {}, normalLinesRemovedByRadiologist: [],
  });
}

function openNormalLsSpine() {
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status, "the automatic pass must build the approved normal").toBe("generated");
  expect(lines(findings()), "sanity: the scaffold carries the L4-L5 canal normal")
    .toContain(CANAL_NORMAL_L45);
}

function click(box: ClinicalQuickFindingBox) {
  const patch = quickFindingPatch(box, CLICK_CTX);
  expect(useWorkspace.getState().applyPathologyOverlay(patch)).toBe("applied");
  return patch.id!;
}

/** The strip's "Remove from report" control, one step later in the same store. */
function deselect(rowId: string) {
  useWorkspace.getState().removeObservation(rowId);
}

/** The Quick Select row id for a concept — what the strip's deselect uses.
 * The qf- prefix is what keeps this the CLICKED row: the scaffold's own
 * baseline rows carry the same concepts (every level has its canal normal),
 * and deselecting one of those would strip a normal instead of the tile. */
const qsRowIdByConcept = (concept: string): string => {
  const row = useWorkspace.getState().appliedPathologyPatches.find(
    (p) => !p.stale && String(p.id).startsWith("qf-") && p.observation?.concept === concept,
  );
  if (!row) throw new Error(`no live Quick Select row for concept ${concept}`);
  return row.id;
};

/** The Mode A pass the workspace debounce runs — the live entry. */
const recompose = () => useWorkspace.getState().composeInstantReport(STUDY_CTX, false);

beforeEach(resetWorkspace);

describe("replacement-chain lineage (C3) and orphaned advice (C4)", () => {
  it("a two-step severity chain restores the pre-click normal, never the intermediate abnormal", () => {
    openNormalLsSpine();
    const scaffold = findings();
    const mild = click(MILD);
    expect(lines(findings())).toContain("Mild canal stenosis at L4-L5 without cord compression.");
    click(MODERATE);
    // The update folded the slot: the survivor's wording replaced the mild's.
    expect(lines(findings())).toContain("Moderate canal stenosis at L4-L5.");
    expect(lines(findings())).not.toContain("Mild canal stenosis at L4-L5 without cord compression.");
    void mild;

    deselect(qsRowIdByConcept("canal_stenosis"));

    // C3: the chain's claim is the normal the FIRST click retired.
    expect(lines(findings()), "the original canal normal comes back").toContain(CANAL_NORMAL_L45);
    expect(lines(findings()), "the intermediate abnormal wording never comes back")
      .not.toContain("Mild canal stenosis at L4-L5 without cord compression.");
    expect(lines(findings())).not.toContain("Moderate canal stenosis at L4-L5.");
    expect(sentencesOf(findings()), "determinism: the page is exactly the pre-click scaffold")
      .toEqual(sentencesOf(scaffold));
  });

  it("a three-step chain (mild → moderate → severe → deselect) restores the same original normal", () => {
    openNormalLsSpine();
    click(MILD);
    click(MODERATE);
    click(SEVERE);
    expect(lines(findings())).toContain("Severe canal stenosis at L4-L5 with thecal sac compression.");

    deselect(qsRowIdByConcept("canal_stenosis"));

    expect(lines(findings())).toContain(CANAL_NORMAL_L45);
    for (const gone of [
      "Mild canal stenosis at L4-L5 without cord compression.",
      "Moderate canal stenosis at L4-L5.",
      "Severe canal stenosis at L4-L5 with thecal sac compression.",
    ]) {
      expect(lines(findings()), `no intermediate residue: ${gone}`).not.toContain(gone);
    }
  });

  it("a wording change on the same slot (herniation → extrusion) restores the disc normal, not the herniation", () => {
    openNormalLsSpine();
    click(HERNIATION);
    expect(lines(findings())).not.toContain(DISC_NORMAL_L45);
    click(EXTRUSION);
    expect(lines(findings())).toContain("Right paracentral disc extrusion at L4-L5 indenting the thecal sac.");
    expect(lines(findings())).not.toContain("Broad-based disc bulge at L4-L5");

    deselect(qsRowIdByConcept("disc_contour"));

    expect(lines(findings()), "the disc contour normal the herniation first retired returns")
      .toContain(DISC_NORMAL_L45);
    expect(lines(findings()), "the superseded herniation's words are not a claim")
      .not.toContain("Disc herniation at L4-L5 causing indentation on the thecal sac.");
    expect(lines(findings())).not.toContain("Right paracentral disc extrusion at L4-L5 indenting the thecal sac.");
  });

  it("C4: the vacated row's own advice leaves the Recommendation when its finding is replaced", () => {
    openNormalLsSpine();
    click(HERNIATION);
    expect(lines(recommendation())).toContain("Conservative management with NSAIDs and physiotherapy.");
    click(EXTRUSION);
    // The extrusion's own advice arrives…
    expect(lines(recommendation())).toContain("Surgical referral if neurological deficits develop.");
    // …and the herniation's advice — advice for a finding no longer in the
    // report — must be gone, exactly as a deselection would have taken it.
    expect(lines(recommendation()), "no orphan advice for the superseded finding")
      .not.toContain("Conservative management with NSAIDs and physiotherapy.");
  });

  it("C4 guard: advice another live row also owns survives the vacate (held-elsewhere)", () => {
    openNormalLsSpine();
    click(FORAMINAL);
    click(HERNIATION);
    expect(lines(recommendation())).toContain("Conservative management with NSAIDs and physiotherapy.");
    click(EXTRUSION); // vacates the herniation slot; the foraminal row still holds the advice
    expect(lines(recommendation()), "the live foraminal row still owns that advice")
      .toContain("Conservative management with NSAIDs and physiotherapy.");
  });

  it("C4 guard: advice the radiologist hand-edited survives the vacate", () => {
    openNormalLsSpine();
    click(HERNIATION);
    useWorkspace.getState().mergeField(
      "recommendation",
      "Conservative management with NSAIDs and physiotherapy.",
      "manual",
    );
    click(EXTRUSION);
    expect(lines(recommendation()), "manual authorship is never deleted by a tile update")
      .toContain("Conservative management with NSAIDs and physiotherapy.");
    expect(lines(recommendation())).toContain("Surgical referral if neurological deficits develop.");
  });

  it("#167 guard: the Mode A replay after a severity update claims no abnormal wording", () => {
    openNormalLsSpine();
    const scaffold = findings();
    click(MILD);
    click(MODERATE);
    // The automatic pass the workspace debounce runs — the path that used to
    // adopt the tile's own rendered words as its restorable claim (#167).
    const decision = recompose();
    expect(decision.action).toBe("compose");

    deselect(qsRowIdByConcept("canal_stenosis"));

    expect(lines(findings())).toContain(CANAL_NORMAL_L45);
    expect(lines(findings())).not.toContain("Mild canal stenosis at L4-L5 without cord compression.");
    expect(lines(findings())).not.toContain("Moderate canal stenosis at L4-L5.");
    expect(sentencesOf(findings())).toEqual(sentencesOf(scaffold));
  });

  it("guard: the plain normal → abnormal → deselect journey still restores the normal", () => {
    openNormalLsSpine();
    const scaffold = findings();
    click(MODERATE);
    deselect(qsRowIdByConcept("canal_stenosis"));
    // The primary journey the whole machinery exists for: one click, one
    // deselect, exactly the approved normal back. The lineage fix must not
    // have tightened this into a loss.
    expect(sentencesOf(findings())).toEqual(sentencesOf(scaffold));
    expect(impression()).toMatch(/Normal MRI of the lumbosacral spine/);
  });
});
