/**
 * FACET STUDY-WIDE RETIREMENT — the engine half of the facet contradiction fix.
 *
 * The acceptance corpus (clinicalAcceptanceCorpus.test.ts) drives the shipped
 * tiles; the shipped catalogue carries exactly one level-bearing facet tile
 * (L4-L5), one ligamentum flavum tile and a severity-bearing foraminal family,
 * so the corpus cannot reach every level / laterality / severity shape the
 * ownership rule has to answer for. This file is the engine's own battery:
 *
 *  - the predicate matrix on `sentenceOwnedBySlot` + `falsifies` — every
 *    level variant (L4-L5, L5-S1, dorsal), both laterality shapes, the
 *    foreign-region refusals that keep the rule from widening ("Cervical /
 *    Dorsal / sacroiliac facet joints are unremarkable." stay), and the
 *    conservative pins ("lumbosacral", "sacral", junction words);
 *  - the store journeys the shipped catalogue has no tile for: a second facet
 *    level (L5-S1), a bilateral pair, and a severity chain on the facet slot —
 *    each asserting BOTH directions: what must be gone, what must stay, and
 *    that the shared study-wide normal returns exactly when the LAST abnormal
 *    goes, whichever order the tiles are clicked or deselected in.
 *
 * The boxes below mirror the shipped facet tile's wording (quick-select-tiles
 * .data.ts:129 — "Facet arthropathy at L4-L5." / concept facet_joint /
 * conflictGroup facet) with the level, side or severity substituted, exactly
 * the way the shipped foraminal family (:142, "{severity} {side} neural
 * foraminal stenosis at L4-L5.") parameterises its own slot. No other clinical
 * content is invented: the baselines are the shipped Standard Normal's own
 * sentences, asserted verbatim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { sentenceOwnedBySlot } from "@/lib/observationSlot";
import { falsifies, filterRestorableBaselines } from "@/lib/clinicalSelection/normalSuppression";
import { useWorkspace } from "./store";

const STUDY_CTX = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});
const CLICK_CTX = { region: "LS Spine", studyType: "LS Spine" };

/** fullReportBaseline.ts facet-joints — the study-wide normal under test. */
const FACET_NORMAL = "Lumbar facet joints are unremarkable.";
/** fullReportBaseline.ts — the neighbours the rule must NOT touch. */
const LF_NORMAL = "Ligamentum flavum is not hypertrophied.";
const VERTEBRAL_NORMAL = "Lumbar vertebral bodies demonstrate normal height and marrow signal.";
const LORDOSIS_NORMAL = "Normal lumbar lordosis is maintained.";
const SACROILIAC_NORMAL = "Visualized sacroiliac joints are unremarkable.";
const CANAL_NORMAL_L45 = "L4-L5: No spinal canal or thecal sac compression is seen.";

/** quick-select-tiles.data.ts:129 wording, level substituted. */
const facetBox = (level: string, id: number): ClinicalQuickFindingBox => ({
  id,
  label: `Facet arthropathy ${level}`,
  studyType: "LS Spine",
  field: "findings",
  findingText: `Facet arthropathy at ${level}.`,
  impressionText: `Facet arthropathy at ${level}.`,
  techniqueText: "",
  recommendationText: "",
  concept: "facet_joint",
  conflictGroup: "facet",
});

/** The shipped foraminal family's parameterisation (:142 — "{severity} {side} …"),
 * applied to the facet wording: one observation per side. */
const sidedFacetBox = (): ClinicalQuickFindingBox => ({
  ...facetBox("L4-L5", 9302),
  findingText: "{side} facet joint arthropathy at L4-L5.",
  impressionText: "{side} facet joint arthropathy at L4-L5.",
});

/** Severity variants on the facet slot — the shape the shipped canal trio
 * (:122-:124) parameterises for its own concept. */
const SEVERITY_FACET_MILD: ClinicalQuickFindingBox = {
  ...facetBox("L4-L5", 9311),
  findingText: "Mild facet joint arthropathy at L4-L5.",
  impressionText: "Mild facet joint arthropathy at L4-L5.",
};
const SEVERITY_FACET_SEVERE: ClinicalQuickFindingBox = {
  ...facetBox("L4-L5", 9312),
  findingText: "Severe facet joint arthropathy at L4-L5.",
  impressionText: "Severe facet joint arthropathy at L4-L5.",
};

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;
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
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
  });
}

function openNormalLsSpine() {
  const outcome = useWorkspace.getState()
    .generateProfessionalReport(STUDY_CTX, { automatic: true, requireOwnedApprovedNormal: true });
  expect(outcome.status, "the automatic pass must build the approved normal").toBe("generated");
  expect(lines(findings()), "sanity: the scaffold carries the study-wide facet normal")
    .toContain(FACET_NORMAL);
}

function click(box: ClinicalQuickFindingBox, params: { side?: string } = {}) {
  const patch = quickFindingPatch(box, CLICK_CTX, params);
  expect(useWorkspace.getState().applyPathologyOverlay(patch), `${box.label} click`).toBe("applied");
  return patch.id!;
}

/** The live Quick Select row by its rendered finding — the strip's deselect target. */
const qsRowIdByFinding = (findingSentence: string): string => {
  const key = normalizeForDedupe(findingSentence);
  const row = useWorkspace.getState().appliedPathologyPatches.find(
    (p) => !p.stale
      && String(p.id).startsWith("qf-")
      && splitToSentences(p.lastRendered?.findings ?? "").some((s) => normalizeForDedupe(s) === key),
  );
  if (!row) throw new Error(`no live Quick Select row for ${findingSentence}`);
  return row.id;
};

const recompose = () => useWorkspace.getState().composeInstantReport(STUDY_CTX, false);

beforeEach(resetWorkspace);

describe("facet study-wide retirement — the ownership predicate matrix", () => {
  const facetObs = (level: string, laterality = "") => ({
    concept: "facet_joint",
    level,
    laterality,
    anatomicalSection: "facet joints",
    baselineReplaces: "",
  });

  it("a facet observation at any lumbar level owns the study-wide facet normal", () => {
    for (const level of ["L1-L2", "L3-L4", "L4-L5", "L5-S1"]) {
      expect(sentenceOwnedBySlot(FACET_NORMAL, facetObs(level)), `${level} owns the normal`).toBe(true);
    }
  });

  it("laterality shapes own the study-wide normal — left, right and bilateral", () => {
    for (const lat of ["left", "right", "bilateral"]) {
      expect(sentenceOwnedBySlot(FACET_NORMAL, facetObs("L4-L5", lat)), `${lat} owns the normal`).toBe(true);
    }
  });

  it("a FOREIGN region word still pins the sentence: cervical, dorsal and sacroiliac stay", () => {
    expect(sentenceOwnedBySlot("Cervical facet joints are unremarkable.", facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot("Dorsal facet joints are unremarkable.", facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot("Thoracic facet joints are unremarkable.", facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot(SACROILIAC_NORMAL, facetObs("L4-L5"))).toBe(false);
  });

  it("the concept gate holds: neighbouring lumbar normals are never owned", () => {
    expect(sentenceOwnedBySlot(LF_NORMAL, facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot(VERTEBRAL_NORMAL, facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot(LORDOSIS_NORMAL, facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot(CANAL_NORMAL_L45, facetObs("L4-L5"))).toBe(false);
  });

  it("another level's own facet sentence is that level's claim, and stays", () => {
    expect(sentenceOwnedBySlot("L5-S1: Facet joints are unremarkable.", facetObs("L4-L5"))).toBe(false);
  });

  it("the conservative pins: lumbosacral, sacral and junction words are site words", () => {
    // "Lumbosacral" names the junction, not the whole lumbar territory.
    expect(sentenceOwnedBySlot("Lumbosacral facet joints are unremarkable.", facetObs("L4-L5"))).toBe(false);
    expect(sentenceOwnedBySlot("Sacral facet joints are unremarkable.", facetObs("L5-S1"))).toBe(false);
    expect(sentenceOwnedBySlot("Cervicothoracic facet joints are unremarkable.", facetObs("C7-T1"))).toBe(false);
    expect(sentenceOwnedBySlot("Thoracolumbar facet joints are unremarkable.", facetObs("L1-L2"))).toBe(false);
  });

  it("dorsal levels own their own region's wording — both synonyms", () => {
    expect(sentenceOwnedBySlot("Dorsal facet joints are unremarkable.", facetObs("D8-D9"))).toBe(true);
    expect(sentenceOwnedBySlot("Thoracic facet joints are unremarkable.", facetObs("D8-D9"))).toBe(true);
    expect(sentenceOwnedBySlot(FACET_NORMAL, facetObs("D8-D9")), "a dorsal tile never takes the lumbar sentence").toBe(false);
  });

  it("a regional bucket level keeps the same verdicts as its levels", () => {
    expect(sentenceOwnedBySlot(FACET_NORMAL, facetObs("lumbar"))).toBe(true);
    expect(sentenceOwnedBySlot("Cervical facet joints are unremarkable.", facetObs("lumbar"))).toBe(false);
    expect(sentenceOwnedBySlot("Cervical facet joints are unremarkable.", facetObs("cervical"))).toBe(true);
  });

  it("the suppression oracle agrees: any lumbar facet level falsifies the shared normal", () => {
    const carrier = { concept: "facet_joint", level: "L5-S1", baselineReplaces: null as string | null };
    expect(falsifies(carrier, FACET_NORMAL)).toBe(true);
    // ...and a survivor that still holds it keeps the normal retired on a
    // partial deselect, restoring only when the last one goes (the shipped
    // filterRestorableBaselines contract).
    expect(filterRestorableBaselines([FACET_NORMAL], [carrier])).toEqual([]);
    expect(filterRestorableBaselines([FACET_NORMAL], [])).toEqual([FACET_NORMAL]);
    // A canal claim is not a facet claim.
    expect(falsifies({ concept: "facet_joint", level: "L4-L5", baselineReplaces: null }, CANAL_NORMAL_L45)).toBe(false);
    // The shipped oracle deliberately answers TRUE for a foreign-region
    // observation over a level-less claim (its own header: a study-wide
    // baseline is falsified by any observation of the concept, any level —
    // over-suppression keeps a true normal off the page, where under-
    // suppression would print a contradicted one). The ownership walk is what
    // keeps a cervical tile from ever RETIRING the lumbar normal (foreign
    // region word); this verdict only lengthens suppression while both
    // regions' facet tiles coexist on a whole-spine study, and the pinned
    // behaviour is documented so a change to either half is a conscious one.
    expect(falsifies({ concept: "facet_joint", level: "C5-C6", baselineReplaces: null }, FACET_NORMAL)).toBe(true);
  });
});

describe("facet study-wide retirement — store journeys the shipped catalogue has one tile for", () => {
  it("a second lumbar level (L5-S1) retires the shared normal and restores it on deselect", () => {
    openNormalLsSpine();
    const scaffold = findings();
    click(facetBox("L5-S1", 9201));
    expect(lines(findings())).toContain("Facet arthropathy at L5-S1.");
    expect(lines(findings()), "the study-wide normal is gone").not.toContain(FACET_NORMAL);
    expect(lines(impression())).toContain("Facet arthropathy at L5-S1.");
    expect(lines(impression())).not.toContain("Normal MRI of the lumbosacral spine.");
    // The neighbours stay.
    expect(lines(findings())).toContain(LF_NORMAL);
    expect(lines(findings())).toContain(VERTEBRAL_NORMAL);
    expect(lines(findings())).toContain(LORDOSIS_NORMAL);
    expect(lines(findings())).toContain(SACROILIAC_NORMAL);
    // Deselect restores the shared normal, deterministically.
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Facet arthropathy at L5-S1."));
    expect(lines(findings())).toContain(FACET_NORMAL);
    expect(lines(findings())).not.toContain("Facet arthropathy at L5-S1.");
    expect(sentencesOf(findings()), "determinism: exactly the pre-click scaffold").toEqual(sentencesOf(scaffold));
  });

  it("two facet levels: the shared normal returns only when the LAST abnormal goes, in either deselect order", () => {
    openNormalLsSpine();
    click(facetBox("L4-L5", 9202));
    click(facetBox("L5-S1", 9203));
    expect(lines(findings())).toContain("Facet arthropathy at L4-L5.");
    expect(lines(findings())).toContain("Facet arthropathy at L5-S1.");
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    // Deselect L4-L5 first: the normal must STAY retired while L5-S1 is held.
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Facet arthropathy at L4-L5."));
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    expect(lines(findings())).not.toContain("Facet arthropathy at L4-L5.");
    expect(lines(findings())).toContain("Facet arthropathy at L5-S1.");
    // The last one out brings the shared normal back, exactly once.
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Facet arthropathy at L5-S1."));
    expect(lines(findings())).toContain(FACET_NORMAL);
    expect(lines(findings())).not.toContain("Facet arthropathy at L5-S1.");
    expect(lines(findings()).filter((l) => l === FACET_NORMAL)).toHaveLength(1);
  });

  it("the same pair in the OTHER deselect order reaches the same page", () => {
    openNormalLsSpine();
    click(facetBox("L4-L5", 9202));
    click(facetBox("L5-S1", 9203));
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Facet arthropathy at L5-S1."));
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    expect(lines(findings())).toContain("Facet arthropathy at L4-L5.");
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Facet arthropathy at L4-L5."));
    expect(lines(findings())).toContain(FACET_NORMAL);
    expect(lines(findings())).not.toContain("Facet arthropathy at L4-L5.");
  });

  it("a bilateral facet pair: both sides print, the normal waits for the last side", () => {
    openNormalLsSpine();
    click(sidedFacetBox(), { side: "left" });
    click(sidedFacetBox(), { side: "right" });
    expect(lines(findings())).toContain("Left facet joint arthropathy at L4-L5.");
    expect(lines(findings())).toContain("Right facet joint arthropathy at L4-L5.");
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Left facet joint arthropathy at L4-L5."));
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    expect(lines(findings())).toContain("Right facet joint arthropathy at L4-L5.");
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Right facet joint arthropathy at L4-L5."));
    expect(lines(findings())).toContain(FACET_NORMAL);
  });

  it("a severity chain on the facet slot restores the original normal, never the intermediate wording", () => {
    openNormalLsSpine();
    click(SEVERITY_FACET_MILD);
    expect(lines(findings())).toContain("Mild facet joint arthropathy at L4-L5.");
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    click(SEVERITY_FACET_SEVERE);
    expect(lines(findings())).toContain("Severe facet joint arthropathy at L4-L5.");
    expect(lines(findings())).not.toContain("Mild facet joint arthropathy at L4-L5.");
    // The chain's lineage: the pre-click normal, not the intermediate mild.
    useWorkspace.getState().removeObservation(qsRowIdByFinding("Severe facet joint arthropathy at L4-L5."));
    expect(lines(findings())).toContain(FACET_NORMAL);
    expect(lines(findings())).not.toContain("Mild facet joint arthropathy at L4-L5.");
    expect(lines(findings())).not.toContain("Severe facet joint arthropathy at L4-L5.");
  });

  it("the Mode A pass over a two-level facet report keeps both findings and the normal retired", () => {
    openNormalLsSpine();
    click(facetBox("L4-L5", 9202));
    click(facetBox("L5-S1", 9203));
    expect(recompose().action).toBe("compose");
    expect(lines(findings())).toContain("Facet arthropathy at L4-L5.");
    expect(lines(findings())).toContain("Facet arthropathy at L5-S1.");
    expect(lines(findings())).not.toContain(FACET_NORMAL);
    const once = findings();
    expect(recompose().action).toBe("compose");
    expect(findings()).toBe(once);
  });
});
