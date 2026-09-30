/**
 * mriBrainVascularSubMasters.test.ts — the dedicated vascular palettes offer a
 * conclusion only when the acquisition earned it (mra/mrv spec §5, §7, §8, §9,
 * §11, §12, §15, §16, §23).
 *
 * These tests are the machine-readable form of the phase's clinical promise. Each
 * prohibited inference — TOF signal loss becoming a stenosis grade, a sinus flow gap
 * becoming thrombosis, an angiographic pattern becoming Moyamoya disease, a T1
 * crescent becoming an acute dissection — is asserted from both sides: the
 * descriptive tile stays available and says nothing stronger, and the conclusion tile
 * is refused until the technique state supports it. The last group proves the tiles
 * really move the ledger: applying a vessel row removes the all-normal sentence it
 * supersedes instead of leaving the report contradicting itself.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { contentPackForConcept } from "@/lib/conceptCanon/contentPacks";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  brainSubMasterById,
  buildTilePatch,
  tileAvailable,
} from "@/lib/mriBrainSubMasters";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { brainAtomsToPatches, brainBundleId } from "@/lib/mriBrainAtoms";
import {
  MRV_SUBMASTER,
  MRA_NECK_SUBMASTER,
  MRA_SUBMASTER,
  VASCULAR_SUB_MASTERS,
  VASCULAR_TREE_NORMALS,
  ALL_VASCULAR_TILES,
} from "@/lib/mriBrainVascularSubMasters";
import {
  VASCULAR_GATES,
  defaultVascularTechnique,
  deriveVascularTechniqueAcquired,
  type VascularTechniqueState,
} from "@/lib/mriBrainVascularTechnique";
import { VASCULAR_LIBRARY_PROSE } from "@/lib/mriBrainVascularProse";
import { vesselObservationAtoms } from "@/lib/mriBrainVesselObservations";
import { useWorkspace } from "@/lib/zai-workspace/store";

const TECH_BRAIN = parseBrainSequences(
  "MRI brain: T1, T2, FLAIR, DWI with ADC, GRE/SWI. Gadolinium administered.",
);

function techFrom(techniqueText: string, overrides: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  const derived = deriveVascularTechniqueAcquired({ techniqueText });
  for (const [key, value] of Object.entries(derived)) {
    state.acquired[key as keyof typeof state.acquired] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    state.acquired[key as keyof typeof state.acquired] = value;
  }
  return state;
}

const TOF = techFrom("3D TOF of the circle of Willis");
const CE_MRA = techFrom("3D TOF and contrast-enhanced MRA with source images");
const VESSEL_WALL = techFrom("Vessel-wall black-blood MRA with 3D TOF");
const MRV_TOF = techFrom("2D TOF MRV of the dural venous sinuses");
const MRV_CE = techFrom("Contrast-enhanced MRV with phase-contrast images");
const TRICKS = techFrom("Time-resolved 4D contrast-enhanced MRA");

const tileOf = (subMasterId: string, tileId: string) => {
  const found = brainSubMasterById(subMasterId)?.tiles.find((t) => t.id === tileId);
  if (!found) throw new Error(`missing vascular tile ${subMasterId}/${tileId}`);
  return found;
};

const availability = (subMasterId: string, tileId: string, technique: VascularTechniqueState) =>
  tileAvailable(tileOf(subMasterId, tileId), TECH_BRAIN, { technique, brain: TECH_BRAIN });

beforeEach(() => {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
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
      studyDescription: "MRI Brain with MRA",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

describe("mriBrainVascularSubMasters — the palette surface", () => {
  it("mounts three dedicated palettes with unique tiles", () => {
    expect(VASCULAR_SUB_MASTERS.map((s) => s.id)).toEqual(["mra", "mraNeck", "mrv"]);
    expect(MRA_SUBMASTER.tiles.length).toBeGreaterThan(10);
    expect(MRA_NECK_SUBMASTER.tiles.length).toBeGreaterThan(6);
    expect(MRV_SUBMASTER.tiles.length).toBeGreaterThan(8);
    const ids = ALL_VASCULAR_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every tile atoms that compile through the existing bundle machinery", () => {
    for (const tile of ALL_VASCULAR_TILES) {
      const built = buildTilePatch(tile);
      expect(built.observations.length, tile.id).toBeGreaterThan(0);
      expect(built.bundleId, tile.id).toBe(`bsm-tile-${tile.id}`);
      for (const patch of built.observations) {
        expect(patch.findingsText.trim().length, tile.id).toBeGreaterThan(0);
        expect(patch.source, tile.id).toBe("structured-template");
      }
    }
  });

  it("quotes the canonical library normal sentences for each module", () => {
    expect(VASCULAR_TREE_NORMALS.mra.sentence).toBe(VASCULAR_LIBRARY_PROSE.mraIntracranialNormal);
    expect(VASCULAR_TREE_NORMALS.mraNeck.sentence).toBe(VASCULAR_LIBRARY_PROSE.mraNeckNormal);
    expect(VASCULAR_TREE_NORMALS.mrv.sentence).toBe(VASCULAR_LIBRARY_PROSE.mrvNormal);
    expect(tileOf("mra", "mra-normal").atoms[0]!.role).toBe("baseline");
    expect(tileOf("mra", "mra-normal").atoms[0]!.findings).toBe(VASCULAR_LIBRARY_PROSE.mraIntracranialNormal);
  });

  it("refuses every acquisition-gated tile until the technique is stated", () => {
    const none = defaultVascularTechnique();
    const gated = VASCULAR_SUB_MASTERS.flatMap((sub) =>
      sub.tiles
        // A gate with an `anyOf` list names an angiographic acquisition; a gate
        // without one (blooming, diffusion, enhancement) is a parenchymal sequence
        // requirement and is satisfied by the brain context, not the technique state.
        .filter((t) => t.requiresVascular && VASCULAR_GATES[t.requiresVascular].anyOf)
        .map((t) => [sub.id, t] as const),
    );
    expect(gated.length).toBeGreaterThan(18);
    for (const [subId, tile] of gated) {
      const state = tileAvailable(tile, TECH_BRAIN, { technique: none, brain: TECH_BRAIN });
      expect(state.ok, `${subId}/${tile.id}`).toBe(false);
      expect(state.notice, `${subId}/${tile.id}`).toBeTruthy();
    }
  });
});

describe("mriBrainVascularSubMasters — §5 / §7 flow signal is not a lumen", () => {
  it("offers the descriptive rows on TOF alone and keeps them descriptive", () => {
    for (const id of ["mra-normal", "mra-flow-loss", "mra-nonvisualization", "mra-focal-narrowing"]) {
      expect(availability("mra", id, TOF).ok, id).toBe(true);
    }
    const flowLoss = tileOf("mra", "mra-flow-loss").atoms[0]!;
    expect(flowLoss.findings.toLowerCase()).not.toContain("occlu");
    expect(flowLoss.findings).not.toMatch(/\d+\s*%/);
    expect(flowLoss.impression).toBeUndefined();
    const nonVisual = tileOf("mra", "mra-nonvisualization").atoms[0]!;
    expect(nonVisual.findings.toLowerCase()).not.toContain("occlu");
    expect(nonVisual.impression).toBeUndefined();
  });

  it("refuses the graded-stenosis tile on TOF and offers it on a lumen-bearing study", () => {
    expect(availability("mra", "mra-stenosis-graded", TOF).ok).toBe(false);
    expect(availability("mra", "mra-stenosis-graded", TOF).notice).toMatch(/numeric/i);
    expect(availability("mra", "mra-stenosis-graded", CE_MRA).ok).toBe(true);
  });

  it("refuses non-visualization as an occlusion and confirmed occlusion as an acute one", () => {
    expect(availability("mra", "mra-confirmed-occlusion", TOF).ok).toBe(false);
    expect(availability("mra", "mra-confirmed-occlusion", CE_MRA).ok).toBe(true);
    // Acuity needs DWI support as well as a lumen-bearing acquisition (§5, §7).
    expect(
      tileAvailable(tileOf("mra", "mra-acute-occlusion"), TECH_BRAIN, { technique: CE_MRA, brain: TECH_BRAIN }).ok,
    ).toBe(true);
    const noDwi = parseBrainSequences("MRI brain: T1, T2, FLAIR, GRE/SWI");
    expect(tileAvailable(tileOf("mra", "mra-acute-occlusion"), noDwi, { technique: CE_MRA, brain: noDwi }).ok)
      .toBe(false);
  });

  it("keeps the acute tile's wording gated in the row builder too", () => {
    const blocked = vesselObservationAtoms({
      vessel: "left PCA P2",
      status: "a:confirmedOcclusion",
      territory: "intracranialArterial",
      acute: true,
      technique: techFrom("Vessel-wall black-blood MRA"),
      brain: parseBrainSequences("MRI brain: T1, T2, FLAIR"),
    });
    expect(blocked.atoms).toEqual([]);
    expect(blocked.blocked?.notice).toMatch(/acuity/i);
  });
});

describe("mriBrainVascularSubMasters — §8 pattern against disease", () => {
  it("separates the moyamoya pattern tile from the disease tile", () => {
    const pattern = tileOf("mra", "mra-moyamoya-pattern").atoms[0]!;
    expect(pattern.findings).toBe(VASCULAR_LIBRARY_PROSE.moyamoyaPattern.split(", diagnostic")[0]);
    expect(pattern.impression).toMatch(/moyamoya-pattern vasculopathy/i);
    expect(pattern.impression ?? "").not.toMatch(/moyamoya disease/i);

    const disease = tileOf("mra", "mra-moyamoya-disease");
    expect(disease.advanced).toBe(true);
    expect(disease.atoms[0]!.findings).toMatch(/classified by the reporting radiologist/);
    expect(disease.atoms[0]!.level).not.toBe(pattern.level);
  });
});

describe("mriBrainVascularSubMasters — §9 temporal claims", () => {
  it("refuses early draining veins without a time-resolved acquisition", () => {
    expect(availability("mra", "mra-avm-early-drainage", TOF).ok).toBe(false);
    expect(availability("mra", "mra-avm-early-drainage", TOF).notice).toMatch(/temporal/i);
    expect(availability("mra", "mra-avm-early-drainage", TRICKS).ok).toBe(true);
    expect(availability("mra", "mra-avm-nidus", TOF).ok).toBe(true);
    expect(tileOf("mra", "mra-avm-nidus").atoms[0]!.findings.toLowerCase()).not.toContain("drain");
  });
});

describe("mriBrainVascularSubMasters — §11 neck safety", () => {
  it("gates the intramural hematoma on vessel-wall imaging and T1", () => {
    expect(availability("mraNeck", "neck-dissection-pattern", TOF).ok).toBe(false);
    expect(availability("mraNeck", "neck-dissection-pattern", VESSEL_WALL).ok).toBe(true);
    const noT1 = parseBrainSequences("MRI brain: T2, FLAIR, DWI with ADC");
    expect(
      tileAvailable(tileOf("mraNeck", "neck-dissection-pattern"), noT1, {
        technique: VESSEL_WALL,
        brain: noT1,
      }).ok,
    ).toBe(false);
  });

  it("never lets a dissection appearance assert acuity by itself", () => {
    const pattern = tileOf("mraNeck", "neck-dissection-pattern").atoms[0]!;
    expect(pattern.findings.toLowerCase()).not.toContain("acute");
    expect(pattern.impression).toBeUndefined();
    const diagnosis = tileOf("mraNeck", "neck-dissection-diagnosis");
    expect(diagnosis.advanced).toBe(true);
    expect(diagnosis.atoms[0]!.impression ?? "").toMatch(/acute carotid artery dissection/i);
  });

  it("requires a measured statement for NASCET wording", () => {
    expect(availability("mraNeck", "neck-stenosis-nascet", TOF).ok).toBe(false);
    expect(availability("mraNeck", "neck-stenosis-nascet", CE_MRA).ok).toBe(true);
    expect(availability("mraNeck", "neck-stenosis-atherosclerotic", TOF).ok).toBe(true);
    const plain = tileOf("mraNeck", "neck-stenosis-atherosclerotic").atoms[0]!;
    expect(plain.findings).not.toMatch(/nascet|\d+\s*%/i);
    expect(plain.impression).toBeUndefined();
  });

  it("keeps the vertebral-to-PICA variant non-pathologic", () => {
    const variant = tileOf("mraNeck", "neck-vertebral-hypoplasia-pica").atoms[0]!;
    // The registry base already names the anatomy as a variant, and the `_variant`
    // suffix is the §10 slot that keeps it out of the pathology slot for the vessel.
    expect(variant.concept).toBe("mra_vessel_pica_termination_variant_variant");
    expect(variant.laterality).toBe("right");
    expect(variant.findings).toBe(VASCULAR_LIBRARY_PROSE.vertebralPicaVariant.split(", representing")[0]);
    expect(variant.impression).toMatch(/normal anatomic variant/i);
  });
});

describe("mriBrainVascularSubMasters — §12 / §13 venous separation", () => {
  it("describes a flow gap without naming a cause", () => {
    const gap = tileOf("mrv", "mrv-flow-gap").atoms[0]!;
    expect(gap.findings.toLowerCase()).not.toContain("thromb");
    expect(gap.concept).toBe("mrv_vessel_transverse_sinus");
    expect(gap.impression).toBeUndefined();
    expect(availability("mrv", "mrv-flow-gap", MRV_TOF).ok).toBe(true);
  });

  it("refuses a filling defect on TOF and allows it on contrast or phase imaging", () => {
    expect(availability("mrv", "mrv-filling-defect", MRV_TOF).ok).toBe(false);
    expect(availability("mrv", "mrv-filling-defect", MRV_CE).ok).toBe(true);
  });

  it("keeps the thrombosis conclusion separate from the clot-signal description", () => {
    const signal = tileOf("mrv", "mrv-thrombus-signal").atoms[0]!;
    expect(signal.findings).toBe(VASCULAR_LIBRARY_PROSE.cvstSagittal.split(", diagnostic")[0]);
    expect(signal.impression).toBeUndefined();
    const diagnosis = tileOf("mrv", "mrv-thrombosis-diagnosis");
    expect(diagnosis.advanced).toBe(true);
    expect(diagnosis.atoms[0]!.impression ?? "").toMatch(/diagnostic of acute dural venous sinus thrombosis/i);
    expect(diagnosis.atoms[0]!.severity).toBe("critical");
  });

  it("records the transverse sinus hypoplasia variant as its own slot, not a clot", () => {
    const variant = tileOf("mrv", "mrv-transverse-hypoplasia").atoms[0]!;
    // Its own per-vessel variant concept: neither the shared venous family nor the
    // thrombosis concept, so it can be mistaken for — or overwrite — a clot.
    expect(variant.concept).toBe("mrv_vessel_transverse_sinus_hypoplasia_variant");
    expect(variant.conflictGroup).toBe("transverse-sinus-hypoplasia-left-variant");
    expect(variant.findings.toLowerCase()).not.toContain("thromb");
    expect(contentPackForConcept(variant.concept)?.impressionworthyAbnormal).toBe(false);
  });

  it("quotes the deep venous thrombosis line and needs FLAIR for the oedema claim", () => {
    const deep = tileOf("mrv", "mrv-deep-venous-thrombosis").atoms[0]!;
    expect(deep.findings).toBe(VASCULAR_LIBRARY_PROSE.deepVenousThrombosis);
    const noFlair = parseBrainSequences("MRI brain: T1, T2, DWI with ADC");
    expect(
      tileAvailable(tileOf("mrv", "mrv-deep-venous-thrombosis"), noFlair, {
        technique: MRV_CE,
        brain: noFlair,
      }).ok,
    ).toBe(false);
  });
});

describe("mriBrainVascularSubMasters — no conclusion without its gate", () => {
  it("makes every diagnostic-strength tile both advanced and gated", () => {
    const offenders: string[] = [];
    for (const tile of ALL_VASCULAR_TILES) {
      const text = tile.atoms
        .map((a) => `${a.findings} ${a.impression ?? ""}`)
        .join(" ")
        .toLowerCase();
      const asserts = /\bdiagnostic of\b|\bconsistent with (?:acute|subacute)\b/.test(text);
      if (asserts && (!tile.advanced || !tile.requiresVascular)) offenders.push(tile.id);
    }
    expect(offenders).toEqual([]);
  });

  it("never mentions contrast enhancement without contrast in the tile text", () => {
    const unenhanced = techFrom("3D TOF of the circle of Willis");
    const enhancing = ALL_VASCULAR_TILES.filter((t) => /enhanc|gadolin|post-?contrast/i.test(t.atoms.map((a) => a.findings).join(" ")));
    expect(enhancing.length).toBeGreaterThan(0);
    for (const tile of enhancing) {
      if (!tile.requiresVascular) {
        // Only allowed when no enhancement claim survives — check the wording itself.
        expect(tile.atoms.map((a) => a.findings).join(" "), tile.id).not.toMatch(/rim enhancement|peripheral enhancement/i);
      } else {
        expect(availability(tile.id.startsWith("mrv") ? "mrv" : "mra", tile.id, unenhanced).ok, tile.id).toBe(false);
      }
    }
  });
});

describe("mriBrainVascularSubMasters — the tiles move the ledger", () => {
  it("reconciles the all-normal sentence when one vessel becomes abnormal", () => {
    useWorkspace.getState().applyMacroBundle(buildTilePatch(tileOf("mra", "mra-normal")));
    expect(useWorkspace.getState().findingsText).toContain("uniform high-velocity signal");

    const row = vesselObservationAtoms({
      vessel: "right MCA M1",
      status: "a:focalNarrowing",
      territory: "intracranialArterial",
      technique: TOF,
      brain: TECH_BRAIN,
      replaceTreeNormal: VASCULAR_TREE_NORMALS.mra.sentence,
      remainderNormal: VASCULAR_TREE_NORMALS.mra.remainder,
    });
    const bundleId = row.bundleId || brainBundleId("vessel", "row");
    useWorkspace.getState().applyMacroBundle({
      bundleId,
      observations: brainAtomsToPatches("Brain", bundleId, row.atoms),
    });

    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("Focal luminal narrowing of the right MCA M1");
    expect(findings).toContain("remaining visualised intracranial arteries");
    // The all-normal sentence is gone rather than printed next to its own contradiction.
    expect(findings).not.toContain("uniform high-velocity signal");
  });

  it("removes the row again when its bundle is deselected", () => {
    const row = vesselObservationAtoms({
      vessel: "left transverse sinus",
      status: "v:flowGap",
      territory: "venous",
      technique: MRV_TOF,
      brain: TECH_BRAIN,
    });
    const patchBundle = brainBundleId("vessel", "flow-gap-row");
    useWorkspace
      .getState()
      .applyMacroBundle({
        bundleId: patchBundle,
        observations: brainAtomsToPatches("Brain", patchBundle, row.atoms),
      });
    expect(useWorkspace.getState().findingsText).toContain("Segmental flow gap in the left transverse sinus");
    expect(useWorkspace.getState().removeMacroBundle(patchBundle)).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toContain("Segmental flow gap");
  });

  it("keeps two aneurysms as two observations on two slots", () => {
    const acom = buildTilePatch(tileOf("mra", "mra-aneurysm-acom"));
    const mca = buildTilePatch(tileOf("mra", "mra-aneurysm-mca"));
    // Aneurysms live on the parent vessel's aneurysm concept, not its lumen concept,
    // so an aneurysm never erases the stenosis recorded on the same artery — and the
    // §6 structured record refines this exact slot rather than opening a third one.
    expect(acom.observations[0]!.concept).toBe("mra_aneurysm_acom");
    expect(mca.observations[0]!.concept).toBe("mra_aneurysm_mca_bifurcation");
    useWorkspace.getState().applyMacroBundle(acom);
    useWorkspace.getState().applyMacroBundle(mca);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("anterior communicating artery (ACom)");
    expect(findings).toContain("bifurcation of the [right/left] middle cerebral artery");
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThanOrEqual(2);
  });

  it("traces every statement concept to a registered content pack", () => {
    const registered = new Set<string>();
    for (const tile of ALL_VASCULAR_TILES) {
      for (const atom of tile.atoms) {
        expect(contentPackForConcept(atom.concept), `${tile.id}: ${atom.concept}`).toBeTruthy();
        registered.add(atom.concept);
      }
    }
    expect(registered).toContain("mra_aneurysm_acom");
    expect(registered).toContain("mra_moyamoya_pattern");
    expect(registered).toContain("mra_moyamoya_disease");
    expect(registered).toContain("mrv_deep_venous_thrombosis");
  });
});
