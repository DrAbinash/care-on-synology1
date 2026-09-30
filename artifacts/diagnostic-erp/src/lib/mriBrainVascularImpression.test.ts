/**
 * mriBrainVascularImpression.ts — §18's impression leads with what matters, and the
 * software never rewrites it on the way there.
 *
 * The ledger assembles the impression in the order its rows were applied, which is the
 * order the radiologist clicked tiles. Clinically that is the wrong order: a developmental
 * sinus variant should not sit above a large-vessel occlusion. These tests pin the
 * reordering, pin that it is a PERMUTATION only (§18's impression comes from accepted
 * observations, not from a second shadow report), and pin that an impression the
 * radiologist wrote by hand is left exactly as they arranged it.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import {
  BRAIN_VASCULAR_IMPRESSION_RULES,
  BRAIN_VASCULAR_IMPRESSION_UNRANKED,
  isImpressionReorderOf,
  orderBrainVascularImpressionLines,
  rankBrainVascularImpressionLine,
} from "@/lib/mriBrainVascularImpression";
import {
  vesselStatusAtom,
  vesselStatusByKey,
} from "@/lib/mriBrainVesselObservations";
import { vesselByKey } from "@/lib/mriBrainVessels";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { useWorkspace } from "@/lib/zai-workspace/store";

const IMPRESSION_ORDER = [
  "large_vessel_occlusion",
  "ruptured_aneurysm",
  "venous_thrombosis",
  "venous_infarction",
  "aneurysm",
  "moyamoya",
  "malformation",
  "dissection",
  "high_grade_stenosis",
  "other_vascular_abnormality",
  "variant",
  "normal_study",
];

const rank = (line: string) => rankBrainVascularImpressionLine(line).rank;

function applyBundle(bundleId: string, atoms: Parameters<typeof brainAtomsToPatches>[2]) {
  useWorkspace.getState().applyMacroBundle({
    bundleId,
    observations: brainAtomsToPatches("Brain", bundleId, atoms),
  });
}

/** The row the vessel panel writes, with its interpretation line, for one status. */
function statusAtom(vesselKey: string, statusKey: string) {
  const vessel = vesselByKey(vesselKey)!;
  const status = vesselStatusByKey(statusKey)!;
  return vesselStatusAtom(vessel, status, {});
}

beforeEach(() => {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "MRI brain: T1, T2, FLAIR, DWI with ADC. 3D TOF MRA with source images.",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    lastPatchSnapshot: null,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    vascularTechnique: defaultVascularTechnique(),
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain with intracranial MRA",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

// ─── the ranking table ───────────────────────────────────────────────────

describe("§18 — clinical priority is a table, not a guess", () => {
  it("lists the priorities in the order they lead", () => {
    expect(BRAIN_VASCULAR_IMPRESSION_RULES.map((r) => r.id)).toEqual(IMPRESSION_ORDER);
    const ranks = BRAIN_VASCULAR_IMPRESSION_RULES.map((r) => r.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // An unclassified line never outranks a ranked abnormality and never falls below a
    // non-pathologic variant, so it keeps its place among the findings.
    expect(BRAIN_VASCULAR_IMPRESSION_UNRANKED).toBeGreaterThan(ranks[9]!);
    expect(BRAIN_VASCULAR_IMPRESSION_UNRANKED).toBeLessThan(ranks[10]!);
  });

  it("ranks the sentences the vascular modules actually write", () => {
    expect(rank("Occlusion of the left MCA M1.")).toBe(10);
    expect(rank("Ruptured aneurysm of the ACom region with subarachnoid haemorrhage."))
      .toBe(20);
    expect(rank("Occlusive dural venous sinus thrombosis of the superior sagittal sinus."))
      .toBe(30);
    expect(rank("Venous infarction with haemorrhage in the left thalamus.")).toBe(40);
    expect(rank("Unruptured saccular aneurysm of the right MCA bifurcation.")).toBe(50);
    expect(rank("Moyamoya pattern without a stated diagnosis.")).toBe(60);
    expect(rank("Right parietal AVM with a draining vein."))
      .toBe(70);
    expect(rank("Acute dissection of the cervical segment of the left ICA.")).toBe(80);
    expect(rank("Severe stenosis at the left carotid bulb.")).toBe(90);
    expect(rank("Developmental hypoplasia of the right transverse sinus, a non-pathologic variant."))
      .toBe(140);
    expect(rank("No vascular abnormality is seen.")).toBe(150);
  });

  it("reads a venous occlusive line as the thrombosis it is", () => {
    // "Occlusive" would otherwise read as a large-vessel occlusion, and a sinus clot
    // would lead a report ahead of an artery that is not blocked at all.
    expect(rankBrainVascularImpressionLine("Occlusive thrombus within the right transverse sinus."))
      .toMatchObject({ ruleId: "venous_thrombosis", rank: 30 });
    expect(rankBrainVascularImpressionLine("Non-occlusive thrombus within the SSS."))
      .toMatchObject({ ruleId: "venous_thrombosis", rank: 30 });
  });

  it("leaves an unfamiliar line unranked rather than inventing a priority", () => {
    const row = rankBrainVascularImpressionLine("Mild age-related cerebral volume loss.", 3);
    expect(row.rank).toBe(BRAIN_VASCULAR_IMPRESSION_UNRANKED);
    expect(row.ruleId).toBe("");
    expect(row.index).toBe(3);
  });
});

// ─── the reorder ─────────────────────────────────────────────────────────

describe("§18 — reordering is a permutation", () => {
  const lines = [
    "Developmental hypoplasia of the right transverse sinus, a non-pathologic variant.",
    "Mild age-related cerebral volume loss.",
    "Occlusion of the left MCA M1.",
    "Unruptured saccular aneurysm of the right MCA bifurcation.",
  ];

  it("puts the occlusion first and the variant last", () => {
    expect(orderBrainVascularImpressionLines(lines)).toEqual([
      "Occlusion of the left MCA M1.",
      "Unruptured saccular aneurysm of the right MCA bifurcation.",
      "Mild age-related cerebral volume loss.",
      "Developmental hypoplasia of the right transverse sinus, a non-pathologic variant.",
    ]);
  });

  it("keeps two lines of equal priority in the order they were applied", () => {
    const same = ["Occlusion of the left MCA M1.", "Occlusion of the basilar artery."];
    expect(orderBrainVascularImpressionLines(same)).toEqual(same);
  });

  it("adds, drops and rewords nothing", () => {
    const ordered = orderBrainVascularImpressionLines([...lines, "", "  "]);
    expect(ordered).toHaveLength(lines.length);
    expect(isImpressionReorderOf(lines, ordered)).toBe(true);
    expect(isImpressionReorderOf(lines, [...lines, "Occlusion of the right PCA P1."])).toBe(false);
    expect(isImpressionReorderOf(lines, lines.slice(0, 2))).toBe(false);
  });

  it("is stable and idempotent", () => {
    const once = orderBrainVascularImpressionLines(lines);
    expect(orderBrainVascularImpressionLines(once)).toEqual(once);
  });

  it("leaves a hand-arranged impression exactly as the radiologist left it", () => {
    expect(
      orderBrainVascularImpressionLines(lines, {
        protectedLine: (line) => /hypoplasia/i.test(line),
      }),
    ).toEqual(lines);
    // Nothing protected, so the reorder runs.
    expect(
      orderBrainVascularImpressionLines(lines, {
        protectedLine: (line) => /never matches/i.test(line),
      })[0],
    ).toMatch(/Occlusion of the left MCA M1/);
  });
});

// ─── the ledger seam ─────────────────────────────────────────────────────

describe("§18 — through the one impression the workspace has", () => {
  it("generates the impression from accepted observations, then leads with the occlusion", () => {
    // The variant row is applied first on purpose: click order must not decide the
    // printed impression.
    applyBundle(
      "bsm-tile-variant",
      [statusAtom("transverse-sinus-right", "v:developmentalHypoplasia")],
    );
    applyBundle(
      "bsm-tile-occlusion",
      [statusAtom("mca-m1-left", "a:confirmedOcclusion")],
    );
    const state = useWorkspace.getState();
    const lines = state.impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    // Two accepted observations, two impression lines, nothing else.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/hypoplasia/i);
    expect(state.orderImpressionByPriority(orderBrainVascularImpressionLines(lines))).toBe(true);
    expect(useWorkspace.getState().impressionText.split("\n")[0]).toMatch(
      /Occlusion of the left MCA M1/,
    );
  });

  it("withdraws the impression line when the linked vascular finding is removed", () => {
    applyBundle("bsm-tile-occlusion", [statusAtom("mca-m1-left", "a:confirmedOcclusion")]);
    expect(useWorkspace.getState().impressionText).toMatch(/Occlusion of the left MCA M1/);
    useWorkspace.getState().removeMacroBundle("bsm-tile-occlusion");
    const state = useWorkspace.getState();
    expect(state.impressionText).not.toMatch(/Occlusion of the left MCA M1/);
    expect(state.impressionNeedsRefresh).toBe(false);
  });

  it("refuses to write anything that is not a permutation of the current impression", () => {
    applyBundle("bsm-tile-occlusion", [statusAtom("mca-m1-left", "a:confirmedOcclusion")]);
    const before = useWorkspace.getState().impressionText;
    const provenanceKeys = Object.keys(useWorkspace.getState().fieldProvenance.impression ?? {});
    expect(
      useWorkspace.getState().orderImpressionByPriority(["A sentence that was never there."]),
    ).toBe(false);
    expect(useWorkspace.getState().impressionText).toBe(before);
    expect(
      useWorkspace.getState().orderImpressionByPriority(
        orderBrainVascularImpressionLines([before, "Occlusion of the basilar artery."]),
      ),
    ).toBe(false);
    expect(Object.keys(useWorkspace.getState().fieldProvenance.impression ?? {})).toEqual(
      provenanceKeys,
    );
  });

  it("reorders the derived impression without marking it stale", () => {
    applyBundle(
      "bsm-tile-variant",
      [statusAtom("transverse-sinus-right", "v:developmentalHypoplasia")],
    );
    applyBundle(
      "bsm-tile-thrombosis",
      [statusAtom("sss", "v:partialThrombosis")],
    );
    const lines = useWorkspace.getState().impressionText
      .split(/\n+/).map((s) => s.trim()).filter(Boolean);
    expect(lines[0]).toMatch(/hypoplasia/i);
    const ordered = orderBrainVascularImpressionLines(lines);
    expect(useWorkspace.getState().orderImpressionByPriority(ordered)).toBe(true);
    const after = useWorkspace.getState();
    expect(after.impressionText.split("\n")[0]).toMatch(/thrombosis/i);
    expect(after.impressionNeedsRefresh).toBe(false);
    expect(isImpressionReorderOf(lines, after.impressionText.split("\n"))).toBe(true);
  });
});

// ─── the slot identity the ranking depends on ────────────────────────────

describe("§18 — the lines it ranks are the lines the ledger owns", () => {
  it("ranks the impression the vessel panel writes, not a paraphrase of it", () => {
    const atom = statusAtom("mca-m1-left", "a:confirmedOcclusion");
    expect(atom.impression).toBe("Occlusion of the left MCA M1.");
    expect(rankBrainVascularImpressionLine(atom.impression!)).toMatchObject({
      ruleId: "large_vessel_occlusion",
      rank: 10,
    });
  });
});
