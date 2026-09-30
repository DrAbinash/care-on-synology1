/**
 * mriDorsoLumbarImpression.test.ts — the Dorso-Lumbar Impression priority
 * (spec §26) and the one sorter that applies it.
 *
 * The §26 order is not the §37 spine order, and the difference is clinical: an
 * acute fracture or infection leads a Dorso-Lumbar report, and the cord → conus →
 * cauda transition outranks the mechanical stenosis that caused it. These tests
 * pin the nine categories, the two rules that stop a mild degenerative line
 * posing as a major finding, and the store switch that only changes the table
 * for a dedicated Dorso-Lumbar composition — Dorsal and LS studies keep §37.
 *
 * Sorting moves existing sentences. Nothing here rewrites wording, so the
 * provenance-by-sentence protection survives a re-order.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  DORSOLUMBAR_IMPRESSION_PRIORITY,
  DORSOLUMBAR_IMPRESSION_SPEC_ORDER,
  DORSOLUMBAR_MINOR_DEGENERATIVE_RANK,
  dorsoLumbarImpressionCategories,
  rankDorsoLumbarImpressionLine,
} from "@/lib/mriDorsoLumbarImpression";
import { orderImpressionLines } from "@/lib/impressionPriority";
import { useWorkspace } from "@/lib/zai-workspace/store";

function rank(line: string): number {
  return rankDorsoLumbarImpressionLine(line).rank;
}

describe("§26 categories", () => {
  it("states the nine spec categories in the spec's own order", () => {
    expect(DORSOLUMBAR_IMPRESSION_SPEC_ORDER).toHaveLength(9);
    const ranks = DORSOLUMBAR_IMPRESSION_PRIORITY.slice(0, 9).map((r) => r.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("leads with acute fracture, infection or a destructive lesion", () => {
    expect(rank("Acute burst fracture at T12-L1 with retropulsion and severe canal compromise.")).toBe(1);
    expect(rank("Imaging features of infective spondylodiscitis involving T12-L1 and L1-L2.")).toBe(1);
    expect(rank("Marrow-replacing lesion at T9-T10 with pathological fracture."))
      .toBe(1);
  });

  it("puts the neural structure above the stenosis that compressed it", () => {
    expect(rank("Severe central canal stenosis at T10-T11 with cord compression."))
      .toBe(2);
    expect(rank("Conus compression at T12-L1."))
      .toBe(2);
    expect(rank("Cauda equina crowding at L3-L4."))
      .toBe(2);
    expect(rank("Intrinsic T2 hyperintense cord signal at T7-T8."))
      .toBe(2);
  });

  it("splits major canal and disc disease by the half of the spine named", () => {
    expect(rank("Severe central canal stenosis at T8-T9."))
      .toBe(4);
    expect(rank("Severe central canal stenosis at L4-L5."))
      .toBe(5);
    expect(rank("Lateral recess stenosis with traversing root impingement at L4-L5."))
      .toBe(5);
  });

  it("counts a junction finding as junctional only when it is significant", () => {
    expect(rank("Junctional kyphosis with canal compromise at T12-L1."))
      .toBe(3);
    expect(rank("Focal gibbus deformity at the thoracolumbar junction."))
      .toBe(3);
    // Coverage wording about the bridge is not junctional pathology.
    expect(rank("Coverage extends from T8-T9 to T12-L1.")).toBeLessThan(90);
    expect(rank("Coverage extends from T8-T9 to T12-L1.")).toBeGreaterThan(3);
  });

  it("classifies tumour, deformity / post-operative, screening and recommendation lines", () => {
    expect(rank("Intradural extramedullary lesion at T11-T12."))
      .toBe(6);
    expect(rank("Scoliotic curvature with apex at T8-T9."))
      .toBe(7);
    expect(rank("Post-operative change at L4-L5 with epidural fibrosis."))
      .toBe(7);
    expect(rank("Incidental finding on the accompanying cervical screening."))
      .toBe(8);
    expect(rank("Recommend clinical correlation for persistent back pain."))
      .toBe(9);
  });

  it("keeps a mildly-worded degenerative line out of the major categories", () => {
    expect(rank("Mild disc bulge at T12-L1 without canal compromise."))
      .toBe(DORSOLUMBAR_MINOR_DEGENERATIVE_RANK);
    expect(rank("Mild facet joint arthropathy at L4-L5."))
      .toBe(DORSOLUMBAR_MINOR_DEGENERATIVE_RANK);
    // A leading "mild" is not a licence to bury a real neural compromise.
    expect(rank("Mild canal narrowing at L3-L4 with cauda equina crowding."))
      .toBe(2);
  });

  it("leaves an unclassified sentence below the nine categories but above minor change", () => {
    const ranked = rank("Findings are as described above.");
    expect(ranked).toBeGreaterThan(9);
    expect(ranked).toBeLessThan(DORSOLUMBAR_MINOR_DEGENERATIVE_RANK);
  });
});

describe("ordering with the §26 table", () => {
  it("reorders lines without rewriting them", () => {
    const minor = "Mild facet joint arthropathy at L4-L5.";
    const junction = "Severe thoracolumbar junctional kyphosis with retropulsion.";
    const recess = "Lateral recess stenosis with traversing root impingement at L4-L5.";
    const ordered = orderImpressionLines([minor, recess, junction], {
      rankLine: rankDorsoLumbarImpressionLine,
    });
    expect(ordered).toEqual([junction, recess, minor]);
    expect(ordered.join(" ")).toContain("Severe thoracolumbar junctional kyphosis");
  });

  it("is a no-op once the radiologist owns the order", () => {
    const lines = ["Mild facet joint arthropathy at L4-L5.", "Lateral recess stenosis at L4-L5."];
    expect(orderImpressionLines(lines, { frozen: true, rankLine: rankDorsoLumbarImpressionLine }))
      .toEqual(lines);
  });

  it("previews every line with the category it was placed in", () => {
    const preview = dorsoLumbarImpressionCategories([
      "Acute burst fracture at T12-L1 with retropulsion.",
      "Cord compression at T10-T11.",
    ]);
    expect(preview.map((p) => p.ruleId)).toEqual([
      "dl-acute-fracture-infection",
      "dl-neural-compromise",
    ]);
  });
});

describe("the store applies the §26 table only to a dedicated Dorso-Lumbar study", () => {
  const JUNCTION = "Severe thoracolumbar junctional kyphosis with retropulsion.";
  const RECESS = "Lateral recess stenosis with traversing root impingement at L4-L5.";

  beforeEach(() => {
    useWorkspace.setState({
      impressionText: "",
      findingsText: "",
      fieldProvenance: {},
      impressionOrderFrozen: false,
      isDirty: false,
      studyComposition: null,
      studyCompositionProvenance: "none",
      studyCompositionOverridden: false,
    });
  });

  function setImpression(lines: string[]) {
    useWorkspace.getState().setField("impression", lines.join("\n"), { source: "quick-findings" });
  }

  it("sorts a Dorso-Lumbar Impression by the §26 categories", () => {
    useWorkspace.getState().setStudyComposition("dorsolumbar-dedicated", "catalog-code");
    setImpression([RECESS, JUNCTION]);
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText.split("\n")[0]).toBe(JUNCTION);
  });

  it("keeps the §37 spine order for a dedicated Dorsal study", () => {
    useWorkspace.getState().setStudyComposition("dorsal-dedicated", "catalog-code");
    setImpression([RECESS, JUNCTION]);
    useWorkspace.getState().orderImpressionByPriority();
    // §37 has no junction category at all: the recess stenosis is the
    // foraminal / recess rule and the kyphosis line is a deformity.
    expect(useWorkspace.getState().impressionText.split("\n")[0]).toBe(RECESS);
  });

  it("keeps a hand-ordered Dorso-Lumbar Impression untouched", () => {
    useWorkspace.getState().setStudyComposition("dorsolumbar-dedicated", "catalog-code");
    setImpression([RECESS, JUNCTION]);
    useWorkspace.getState().setImpressionOrderFrozen(true);
    useWorkspace.getState().orderImpressionByPriority();
    expect(useWorkspace.getState().impressionText).toBe([RECESS, JUNCTION].join("\n"));
  });
});
