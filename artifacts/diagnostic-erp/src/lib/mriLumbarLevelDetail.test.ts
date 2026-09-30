/**
 * mriLumbarLevelDetail.test.ts — per-level detail rules (spec §9-§11, §43).
 *
 * The rules this protects:
 * - traversing and exiting roots at one level are DIFFERENT slots, so both may
 *   be reported; a mismatch is warned about, never auto-corrected;
 * - statements that need a fluid-sensitive sequence are dropped rather than
 *   emitted without it;
 * - facet subtype wording stays owned by the established `facet_joint` concept
 *   (new concepts would re-route the aliases existing rows resolve through);
 * - epidural lipomatosis plus degenerative stenosis is ONE sentence, not two
 *   competing ones.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildLumbarLevelDetailBundle,
  deriveLumbarLevelDetail,
  epiduralAtoms,
  expectedRootForLocation,
  listhesisAtoms,
  lumbarLevelDetailHasContent,
  parsAtoms,
  rootAtoms,
  rootConsistencyWarning,
  type LumbarLevelDetail,
} from "@/lib/mriLumbarLevelDetail";
import { buildLumbarLevelBundle } from "@/lib/mriLumbarSubMasters";
import { defaultLumbarNumbering, lumbarRootConflictGroup } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences, type SpineSequencesAvailable } from "@/lib/mriSpineSequences";
import type { LumbarLevelSelection } from "@/lib/mriLumbarRegions";
import { useWorkspace } from "@/lib/zai-workspace/store";

const seq = (overrides: Partial<SpineSequencesAvailable> = {}): SpineSequencesAvailable => ({
  ...defaultSpineSequences(),
  axial: true,
  ...overrides,
});

function resetLedger() {
  useWorkspace.setState({
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    fieldProvenance: {},
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
  });
}

describe("traversing vs exiting roots (spec §8)", () => {
  it("keeps both roots at one level as separate slots", () => {
    const sel: LumbarLevelSelection = { rootContact: true, rootRelation: "compression" };
    const detail: LumbarLevelDetail = { foramRight: { rootEffect: "impingement" } };
    const atoms = rootAtoms({ level: "L4-L5", numbering: defaultLumbarNumbering(), sel, detail });
    expect(atoms.map((a) => a.concept).sort()).toEqual(["root_exiting", "root_traversing"]);
    const groups = atoms.map((a) => a.conflictGroup);
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups).toContain(lumbarRootConflictGroup("L4-L5", "L5", "traversing"));
    expect(groups).toContain(lumbarRootConflictGroup("L4-L5", "L4", "exiting"));
  });

  it("routes the same root through the same slot so a newer statement replaces it", () => {
    const a = rootAtoms({
      level: "L4-L5",
      numbering: defaultLumbarNumbering(),
      sel: { rootContact: true, rootRelation: "contact" },
    });
    const b = rootAtoms({
      level: "L4-L5",
      numbering: defaultLumbarNumbering(),
      sel: { rootContact: true, rootRelation: "compression" },
    });
    expect(a[0].conflictGroup).toBe(b[0].conflictGroup);
    expect(a[0].severity).toBe("");
    expect(b[0].severity).toBe("severe");
  });

  it("states reduced certainty instead of hiding an ambiguous transitional mapping", () => {
    const atoms = rootAtoms({
      level: "L5-S1",
      numbering: { ...defaultLumbarNumbering(), mode: "lstv-sacralization" },
      sel: { rootContact: true, rootRelation: "compression" },
    });
    expect(atoms[0].impression).toMatch(/reduced certainty/);
  });

  it("predicts the expected root from the disc location", () => {
    const numbering = defaultLumbarNumbering();
    expect(expectedRootForLocation("L4-L5", "left far lateral", numbering)).toMatchObject({ root: "L4", kind: "exiting" });
    expect(expectedRootForLocation("L4-L5", "right paracentral", numbering)).toMatchObject({ root: "L5", kind: "traversing" });
  });

  it("warns about an inconsistent root without changing anything", () => {
    const numbering = { ...defaultLumbarNumbering(), wholeSpineLocalizer: true };
    const wrong = rootConsistencyWarning({ level: "L4-L5", location: "right paracentral", root: "L4", numbering });
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong.join(" ")).toMatch(/L5/);
    expect(rootConsistencyWarning({ level: "L4-L5", location: "right paracentral", root: "L5", numbering })).toEqual([]);
    // Advisory only: no root value is rewritten.
    expect(rootConsistencyWarning({ level: "L4-L5", location: null, root: "L4", numbering })).toEqual([]);
  });
});

describe("sequence-gated detail", () => {
  it("drops a pars marrow-oedema claim when no fluid-sensitive sequence exists", () => {
    const pars = { side: "left" as const, marrowEdema: true };
    expect(parsAtoms("L4-L5", pars, defaultSpineSequences())).toEqual([]);
    const withStir = parsAtoms("L4-L5", pars, seq({ stir: true }));
    expect(withStir.length).toBe(1);
    expect(withStir[0].findings).toMatch(/oedema|edema/i);
  });

  it("still reports a pars defect that needs no fluid-sensitive sequence", () => {
    const atoms = parsAtoms("L4-L5", { side: "bilateral", chronic: true }, defaultSpineSequences());
    expect(atoms.length).toBe(1);
    expect(atoms[0].concept).toBe("pars_defect");
    expect(atoms[0].findings).toMatch(/bilateral pars defect/i);
  });

  it("carries slip direction, magnitude and cause into one sentence", () => {
    const atoms = listhesisAtoms("L4-L5", {
      direction: "antero",
      displacementMm: 6,
      cause: "isthmic",
      grade: "II",
    });
    expect(atoms.length).toBeGreaterThan(0);
    const text = atoms.map((a) => a.findings).join(" ");
    expect(text).toMatch(/anterolisthesis/i);
    expect(text).toMatch(/6/);
    expect(atoms.every((a) => a.proseSource === "canonical-library" || a.proseSource === "structured-choice")).toBe(true);
  });
});

describe("epidural space (spec §11)", () => {
  it("combines lipomatosis with degenerative stenosis into a single sentence", () => {
    const sel: LumbarLevelSelection = { canal: "severe" };
    const atoms = epiduralAtoms("L4-L5", { finding: "lipomatosis", levelExtent: "L3-L4 to L5-S1" }, sel);
    expect(atoms.length).toBe(1);
    expect(atoms[0].concept).toBe("epidural_lipomatosis");
    expect(atoms[0].findings).toMatch(/lipomatosis/i);
    expect(atoms[0].findings).toMatch(/stenosis|canal/i);
  });

  it("states lipomatosis alone when the canal is not stenosed", () => {
    const atoms = epiduralAtoms("L4-L5", { finding: "lipomatosis" }, {});
    expect(atoms.length).toBe(1);
    expect(atoms[0].findings.toLowerCase()).toContain("lipomatosis");
  });

  it("leaves the epidural space unmentioned when nothing was selected", () => {
    expect(epiduralAtoms("L4-L5", null, {})).toEqual([]);
    expect(epiduralAtoms("L4-L5", { finding: "normal_fat" }, {})).toHaveLength(1);
  });
});

describe("level bundle ownership", () => {
  beforeEach(() => resetLedger());

  const detail: LumbarLevelDetail = {
    canalMorphology: "cauda_crowding",
    migration: "caudal",
    migrationMm: 8,
    recessRight: { severity: "moderate", rootEffect: "impingement" },
    foramLeft: { severity: "severe", fat: "complete_loss", rootEffect: "compression" },
    facet: { arthropathy: true, hypertrophy: true, laterality: "bilateral" },
    ligamentumFlavum: { hypertrophy: true, thicknessMm: 5 },
    listhesis: { direction: "antero", displacementMm: 5, cause: "degenerative" },
    epidural: { finding: "prominent_fat" },
  };

  it("emits one atom per populated structure and labels its provenance", () => {
    const built = buildLumbarLevelDetailBundle({
      level: "L4-L5",
      detail,
      sel: { rootContact: true, rootRelation: "compression", canal: "moderate" },
      numbering: defaultLumbarNumbering(),
      sequences: seq(),
    });
    expect(built.bundleId).toBe("spm-ls-detail-L4-L5");
    expect(built.atoms.length).toBeGreaterThan(8);
    expect(built.atoms.every((a) => a.findings.trim().length > 0)).toBe(true);
    expect(built.atoms.filter((a) => a.proseSource === "structured-choice").length).toBe(built.structuredChoiceCount);
    expect(lumbarLevelDetailHasContent(detail)).toBe(true);
  });

  it("keeps facet subtype wording owned by the established facet concept", () => {
    const built = buildLumbarLevelDetailBundle({
      level: "L4-L5",
      detail: { facet: { arthropathy: true, effusion: true, laterality: "right" } },
      numbering: defaultLumbarNumbering(),
      sequences: seq(),
    });
    const facetAtoms = built.atoms.filter((a) => /facet/i.test(a.conflictGroup ?? ""));
    expect(facetAtoms.length).toBeGreaterThan(0);
    expect(facetAtoms.every((a) => a.concept === "facet_joint")).toBe(true);
    expect(facetAtoms[0].state).toMatch(/arthropathy/);
  });

  it("owns every observation to the level it was captured at", () => {
    const built = buildLumbarLevelBundle({
      level: "L3-L4",
      detail,
      numbering: defaultLumbarNumbering(),
      sequences: seq(),
      region: "LS Spine",
    });
    expect(built.observations.length).toBeGreaterThan(0);
    expect(built.observations.every((o) => o.level === "L3-L4" || o.anatomicalSection === "L3-L4")).toBe(true);
    useWorkspace.getState().applyMacroBundle(built);
    const text = useWorkspace.getState().findingsText;
    expect(text).toMatch(/L3-L4/);
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(built.observations.length);
  });

  it("reads level detail back out of the ledger", () => {
    const built = buildLumbarLevelBundle({
      level: "L4-L5",
      detail: { recessRight: { severity: "severe" }, canalMorphology: "trefoil" },
      numbering: defaultLumbarNumbering(),
      sequences: seq(),
    });
    useWorkspace.getState().applyMacroBundle(built);
    const derived = deriveLumbarLevelDetail(useWorkspace.getState().appliedPathologyPatches, "L4-L5");
    expect(derived.recessRight?.severity).toBe("severe");
    expect(derived.canalMorphology).toBe("trefoil");
    expect(deriveLumbarLevelDetail([], "L4-L5")).toEqual({});
  });

  it("reconciles normal → abnormal at the same level instead of contradicting", () => {
    useWorkspace.getState().setField("findings", "The central canal is patent at L4-L5.", { source: "system" });
    const built = buildLumbarLevelBundle({
      level: "L4-L5",
      detail: { canalMorphology: "cauda_crowding" },
      numbering: defaultLumbarNumbering(),
      sequences: seq(),
    });
    useWorkspace.getState().applyMacroBundle(built);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/cauda/i);
    expect(
      useWorkspace.getState().appliedPathologyPatches.some((p) => p.observation?.concept === "canal_morphology"),
    ).toBe(true);
  });
});
