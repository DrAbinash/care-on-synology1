/**
 * mriBrainVascularPresets.test.ts — one click cannot outrun the technique (§16, §17).
 *
 * A preset is the loudest shortcut in the phase: a single action that writes many
 * sentences. So the palette's gate has to be applied here too, and these tests check it
 * from both ends — with nothing angiographic recorded, no vascular preset writes
 * anything; with a full study, the preset writes the descriptive rows and still does not
 * name a diagnosis the tiles keep behind a selection. The two canonical macros are
 * asserted line by line against the library text they quote, because their value is that
 * they are the supplied prose, not a paraphrase of it.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { contentPackForConcept, isImpressionworthyAbnormal } from "@/lib/conceptCanon/contentPacks";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import { brainSubMasterById, type BrainPresetContext } from "@/lib/mriBrainSubMasters";
import {
  VASCULAR_BRAIN_PRESETS,
  VASCULAR_FINDINGS_ORDERS,
  VASCULAR_NORMAL_BUNDLE_ID,
  VASCULAR_PRESET_SPECS,
  aneurysmMacroAtoms,
  cvstMacroAtoms,
  isVascularNormalPreset,
  orderVascularAtoms,
  vascularBrainPresetById,
  vascularNormalBundle,
  vascularNormalPresetIdForTile,
  vascularNormalPresetIdsInReport,
  vascularPresetAtomsFor,
} from "@/lib/mriBrainVascularPresets";
import {
  ANEURYSM_MACRO_FINDINGS,
  ANEURYSM_MACRO_IMPRESSION,
  CVST_MACRO_FINDINGS,
  CVST_MACRO_IMPRESSIONS,
  INTRACRANIAL_MRA_FINDINGS_ORDER,
  MRA_SCREENING_PROSE,
  VASCULAR_FINDINGS_SECTIONS,
} from "@/lib/mriBrainVascularProse";
import {
  ALL_VASCULAR_TILES,
  VASCULAR_TREE_NORMALS,
} from "@/lib/mriBrainVascularSubMasters";
import { aneurysmAtoms } from "@/lib/mriBrainVascularLesions";
import { defaultVascularTechnique, type VascularTechniqueState } from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { useWorkspace } from "@/lib/zai-workspace/store";

const BRAIN = parseBrainSequences(
  "MRI brain: T1, T2, FLAIR, DWI with ADC, GRE/SWI. Gadolinium administered.",
);

function tech(keys: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
}

const FULL: VascularTechniqueState = tech({
  mraTof: true, mraCe: true, mraVesselWall: true, sourceImages: true,
  mipReformatted: true, timeResolved: true, mrvTof: true, mrvCe: true,
});

const ctxWith = (technique: VascularTechniqueState): BrainPresetContext => ({
  region: "Brain",
  seq: BRAIN,
  vascular: { technique, brain: BRAIN },
});

const FULL_CTX = ctxWith(FULL);
const NO_ANGIO = ctxWith(defaultVascularTechnique());
const TOF_ONLY = ctxWith(tech({ mraTof: true }));

const presetText = (id: string, ctx: BrainPresetContext = FULL_CTX): string =>
  vascularPresetAtomsFor(id, ctx).atoms
    .map((a) => `${a.findings} ${a.impression ?? ""}`)
    .join(" ");

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
      studyDescription: "MRI Brain with MRA and MRV",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

describe("§16 the preset table", () => {
  it("carries four normals, the two canonical macros and eight structured presets", () => {
    expect(VASCULAR_BRAIN_PRESETS.map((p) => p.id)).toEqual(VASCULAR_PRESET_SPECS.map((s) => s.id));
    expect(VASCULAR_BRAIN_PRESETS.map((p) => p.id)).toEqual([
      "vascular-normal-mra", "vascular-normal-mra-neck", "vascular-normal-mrv",
      "vascular-normal-mra-screening",
      "aneurysm-macro", "cvst-macro",
      "mra-focal-stenosis", "mra-vessel-occlusion", "mra-moyamoya-pattern", "mra-avm-pattern",
      "neck-carotid-stenosis", "neck-carotid-dissection",
      "mrv-deep-venous-thrombosis", "mrv-transverse-hypoplasia",
    ]);
    for (const preset of VASCULAR_BRAIN_PRESETS) {
      expect(brainSubMasterById(preset.subMasterId), preset.subMasterId).toBeTruthy();
      expect(vascularBrainPresetById(preset.id)).toBe(preset);
    }
  });

  it("names only tiles that exist", () => {
    const tileIds = new Set(ALL_VASCULAR_TILES.map((t) => t.id));
    for (const spec of VASCULAR_PRESET_SPECS) {
      for (const [, tileId] of spec.tiles) {
        expect(tileIds.has(tileId), `${spec.id} → ${tileId}`).toBe(true);
      }
    }
  });

  it("writes nothing at all when nothing angiographic was acquired", () => {
    for (const spec of VASCULAR_PRESET_SPECS) {
      const { atoms, dropped } = vascularPresetAtomsFor(spec.id, NO_ANGIO);
      expect(atoms, `${spec.id} without an acquisition`).toEqual([]);
      expect(dropped.length).toBeGreaterThan(0);
    }
  });

  it("keeps every gated tile out of every preset", () => {
    // The nine tiles this phase keeps behind a radiologist selection — none may ride a preset.
    const gated = [
      "mra-aneurysm-unruptured", "mra-moyamoya-disease", "mra-avm-early-drainage",
      "mra-acute-occlusion", "mra-stenosis-graded", "neck-stenosis-nascet",
      "neck-dissection-diagnosis", "mrv-thrombosis-diagnosis", "mrv-filling-defect-subacute",
    ];
    const referenced = new Set(VASCULAR_PRESET_SPECS.flatMap((s) => s.tiles.map(([, id]) => id)));
    for (const tileId of gated) {
      expect(referenced.has(tileId), tileId).toBe(false);
    }
  });
});

describe("§16 a preset cannot conclude what a tile keeps behind a selection", () => {
  it("describes a stenosis without inventing a grade", () => {
    expect(presetText("mra-focal-stenosis")).toMatch(/Focal luminal narrowing/);
    expect(presetText("mra-focal-stenosis")).not.toMatch(/\d+\s*%|severe|high-grade/);
    expect(presetText("neck-carotid-stenosis")).not.toMatch(/\d+\s*%|NASCET/i);
  });

  it("describes a dissection pattern without calling it acute", () => {
    expect(presetText("neck-carotid-dissection")).toContain("intramural hematoma");
    expect(presetText("neck-carotid-dissection")).not.toMatch(/acute|diagnostic of/i);
  });

  it("records the moyamoya pattern without naming the disease", () => {
    expect(presetText("mra-moyamoya-pattern")).toContain("puff of smoke");
    expect(presetText("mra-moyamoya-pattern")).not.toMatch(/moyamoya disease/i);
  });

  it("describes the malformation without a temporal drainage claim", () => {
    expect(presetText("mra-avm-pattern")).toContain("central nidus");
    expect(presetText("mra-avm-pattern")).not.toMatch(/early draining|shunting/i);
  });

  it("leaves occlusion suspected on a study that cannot confirm it", () => {
    expect(presetText("mra-vessel-occlusion", TOF_ONLY)).toMatch(/raising suspicion for occlusion/i);
    expect(presetText("mra-vessel-occlusion", TOF_ONLY)).not.toMatch(/diagnostic of acute|confirmed occlusion/i);
  });

  it("refuses the vessel-wall preset when no vessel-wall sequence exists", () => {
    const { atoms, dropped } = vascularPresetAtomsFor("neck-carotid-dissection", TOF_ONLY);
    expect(atoms).toEqual([]);
    expect(dropped).toContain("neck-dissection-pattern");
  });
});

describe("§16 the two canonical macros", () => {
  it("seeds the aneurysm macro line by line", () => {
    const atoms = aneurysmMacroAtoms();
    const text = atoms.map((a) => a.findings).join("\n");
    for (const line of ANEURYSM_MACRO_FINDINGS) {
      expect(text, line).toContain(line);
    }
    expect(atoms.map((a) => a.concept)).toEqual([
      "willis_configuration", "mra_aneurysm_acom", "mra_arterial",
    ]);
    expect(atoms[1]!.impression).toBe(ANEURYSM_MACRO_IMPRESSION);
    expect(atoms[1]!.severity).toBe("urgent");
  });

  it("puts the aneurysm's own lines on one record so the measurements stay with it", () => {
    const record = aneurysmMacroAtoms()[1]!.findings;
    expect(record.split("\n")).toHaveLength(4);
    expect(record).toContain("Dimensions: Maximum dome height = X mm");
    expect(record).toContain("(Dome-to-neck ratio = X)");
    expect(record).toContain("Orientation: The aneurysm sac is oriented anteroinferiorly.");
  });

  it("seeds the CVST macro line by line, with its two impression lines", () => {
    const atoms = cvstMacroAtoms();
    const text = atoms.map((a) => a.findings).join("\n");
    for (const line of CVST_MACRO_FINDINGS) expect(text, line).toContain(line);
    expect(atoms.map((a) => a.concept)).toEqual([
      "mrv_vessel_sss", "mrv_vessel_transverse_sinus", "mrv_venous", "venous_infarct",
    ]);
    expect(atoms[0]!.impression).toBe(CVST_MACRO_IMPRESSIONS[0]);
    expect(atoms[3]!.impression).toBe(CVST_MACRO_IMPRESSIONS[1]);
    expect(atoms[0]!.severity).toBe("critical");
  });

  it("takes the all-normal sentences out of the report rather than contradicting them", () => {
    const built = vascularPresetAtomsFor("aneurysm-macro", FULL_CTX);
    useWorkspace.getState().applyMacroBundle({
      bundleId: "bsm-test-mra-normal",
      observations: brainAtomsToPatches("Brain", "bsm-test-mra-normal", ALL_VASCULAR_TILES
        .find((t) => t.id === "mra-normal")!.atoms),
    });
    expect(useWorkspace.getState().findingsText).toContain("uniform high-velocity signal");
    useWorkspace.getState().applyMacroBundle({
      bundleId: built.bundleId,
      observations: brainAtomsToPatches("Brain", built.bundleId, built.atoms),
    });
    const findings = useWorkspace.getState().findingsText;
    expect(findings).not.toContain("uniform high-velocity signal");
    expect(findings).toContain("Saccular aneurysmal outpouching originating at the junction");
  });

  it("registers every concept it writes, and only impression-worthy ones conclude", () => {
    for (const spec of VASCULAR_PRESET_SPECS) {
      for (const atom of vascularPresetAtomsFor(spec.id, FULL_CTX).atoms) {
        expect(contentPackForConcept(atom.concept), `${spec.id}: ${atom.concept}`).toBeTruthy();
        // §10: a non-pathologic variant is recorded but is not an abnormality, so it is
        // allowed to carry its explanatory line without being impression-worthy.
        const variant = atom.concept.endsWith("_variant") || atom.role === "baseline";
        if (atom.impression && !variant) {
          expect(isImpressionworthyAbnormal(atom.concept), `${spec.id}: ${atom.concept}`).toBe(true);
        }
      }
    }
  });
});

describe("§17 the presets land in the Findings order", () => {
  it("uses the same §17 order the spec guard reads", () => {
    expect(VASCULAR_FINDINGS_ORDERS.mra).toEqual([
      VASCULAR_FINDINGS_SECTIONS.technique,
      ...INTRACRANIAL_MRA_FINDINGS_ORDER.slice(1).map((k) => VASCULAR_FINDINGS_SECTIONS[k]),
    ]);
  });

  it("emits atoms in section order, with unknown sections last and stable", () => {
    const sections = [
      VASCULAR_FINDINGS_SECTIONS.variants,
      MRA_SCREENING_PROSE.sectionLabel,
      VASCULAR_FINDINGS_SECTIONS.anteriorCirculation,
      VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
    ];
    const ordered = orderVascularAtoms("mra", sections.map((section, i) => ({
      concept: `preset_order_${i}`,
      findings: `${section} sentence.`,
      anatomicalSection: section,
    })));
    expect(ordered.map((a) => a.anatomicalSection)).toEqual([
      VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
      VASCULAR_FINDINGS_SECTIONS.anteriorCirculation,
      VASCULAR_FINDINGS_SECTIONS.variants,
      MRA_SCREENING_PROSE.sectionLabel,
    ]);
  });

  it("keeps each preset's atoms in non-decreasing section rank", () => {
    for (const spec of VASCULAR_PRESET_SPECS) {
      const order = VASCULAR_FINDINGS_ORDERS[spec.module];
      const ranks = vascularPresetAtomsFor(spec.id, FULL_CTX).atoms
        .map((a) => {
          const rank = order.indexOf(a.anatomicalSection ?? "");
          return rank < 0 ? order.length : rank;
        });
      const sorted = [...ranks].sort((x, y) => x - y);
      expect(ranks, spec.id).toEqual(sorted);
    }
  });
});

describe("§16 presets stay reversible bundles", () => {
  it("applies and removes as one atomic bundle", () => {
    const built = vascularPresetAtomsFor("cvst-macro", FULL_CTX);
    const bundleId = "bsm-preset-cvst-macro";
    useWorkspace.getState().applyMacroBundle({
      bundleId,
      observations: brainAtomsToPatches("Brain", bundleId, built.atoms),
    });
    expect(useWorkspace.getState().findingsText).toMatch(/superior sagittal sinus/i);
    expect(useWorkspace.getState().removeMacroBundle(bundleId)).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toMatch(/thrombus spanning from the anterior third/);
    const left = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && p.observation?.concept?.startsWith("mrv_"));
    expect(left).toHaveLength(0);
  });

  it("gives every preset a stable bundle id so deselect can find it again", () => {
    for (const spec of VASCULAR_PRESET_SPECS) {
      const first = vascularBrainPresetById(spec.id)!.build(FULL_CTX);
      const second = vascularBrainPresetById(spec.id)!.build(FULL_CTX);
      expect(first.bundleId).toBe(second.bundleId);
      expect(first.bundleId).toBe(`bsm-preset-${spec.id}`);
    }
  });
});


describe("§15 the module normals are one baseline block", () => {
  const MRA_NORMAL = "vascular-normal-mra";
  const NECK_NORMAL = "vascular-normal-mra-neck";
  const MRV_NORMAL = "vascular-normal-mrv";

  it("gives each module's all-normal sentence its own slot", () => {
    const atoms = [MRA_NORMAL, NECK_NORMAL, MRV_NORMAL].flatMap(
      (id) => vascularPresetAtomsFor(id, FULL_CTX).atoms,
    );
    expect(atoms.map((a) => a.concept)).toEqual([
      "mra_arterial",
      "mra_neck_arterial",
      "mrv_venous",
    ]);
  });

  it("registers the neck tree statement as a concept of its own", () => {
    const entry = contentPackForConcept("mra_neck_arterial");
    expect(entry?.label).toBe("MRA Neck Arterial");
    expect(entry?.regions).toContain("brain");
  });

  it("composes the chosen normals into one bundle so none supersedes another", () => {
    useWorkspace.getState().applyMacroBundle(vascularNormalBundle([MRA_NORMAL], FULL_CTX));
    expect(useWorkspace.getState().findingsText).toContain("uniform high-velocity signal");

    useWorkspace.getState().applyMacroBundle(
      vascularNormalBundle([MRA_NORMAL, NECK_NORMAL, MRV_NORMAL], FULL_CTX),
    );
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("uniform high-velocity signal");
    expect(findings).toContain("intact luminal flow voids");
    expect(findings).toContain("normal venous flow signal");
    expect(
      useWorkspace.getState().appliedPathologyPatches.filter((p) => p.observation && !p.stale),
    ).toHaveLength(3);
  });

  it("reads the carried baselines back from the ledger, so a toggle subtracts", () => {
    const row = (id: string) => {
      const atom = vascularPresetAtomsFor(id, FULL_CTX).atoms[0]!;
      return { concept: atom.concept, findings: atom.findings };
    };
    expect(vascularNormalPresetIdsInReport([])).toEqual([]);
    expect(vascularNormalPresetIdsInReport([row(MRV_NORMAL), row(MRA_NORMAL)])).toEqual([
      MRA_NORMAL,
      MRV_NORMAL,
    ]);
    expect(vascularNormalPresetIdForTile("neck-normal")).toBe(NECK_NORMAL);
    expect(vascularNormalPresetIdForTile("mra-focal-narrowing")).toBeNull();
    expect(isVascularNormalPreset(MRA_NORMAL)).toBe(true);
    expect(isVascularNormalPreset("aneurysm-macro")).toBe(false);
    expect(vascularNormalBundle([], FULL_CTX).bundleId).toBe(VASCULAR_NORMAL_BUNDLE_ID);
    expect(vascularNormalBundle([], FULL_CTX).observations).toHaveLength(0);
  });

  it("stops counting a baseline the report has already disowned", () => {
    // The remainder normal sits on the same family concept after an abnormality supersedes
    // the all-normal sentence; it must not be read as the normal still being carried.
    const superseded = {
      concept: VASCULAR_TREE_NORMALS.mra.concept,
      findings: VASCULAR_TREE_NORMALS.mra.remainder,
    };
    expect(vascularNormalPresetIdsInReport([superseded])).toEqual([]);
  });

  it("keeps a superseded normal out of a later composed baseline", () => {
    useWorkspace.getState().applyMacroBundle(vascularNormalBundle([MRA_NORMAL], FULL_CTX));
    const aneurysm = aneurysmAtoms(
      [
        {
          parentVessel: "right ICA terminus",
          side: "right",
          territory: "intracranialArterial",
          domeHeightMm: 7,
          neckWidthMm: 3,
        },
      ],
      {
        ...FULL_CTX.vascular,
        replaceTreeNormal: VASCULAR_TREE_NORMALS.mra.sentence,
        remainderNormal: VASCULAR_TREE_NORMALS.mra.remainder,
      },
    );
    useWorkspace.getState().applyMacroBundle({
      bundleId: aneurysm.bundleId,
      observations: brainAtomsToPatches("Brain", aneurysm.bundleId, aneurysm.atoms),
    });
    const carried = () =>
      vascularNormalPresetIdsInReport(
        useWorkspace
          .getState()
          .appliedPathologyPatches.filter((p) => p.observation && !p.stale)
          .map((p) => ({
            concept: p.observation?.concept,
            findings: p.lastRendered.findings ?? p.templates.findings,
          })),
      );
    expect(carried()).toEqual([]);
    useWorkspace.getState().applyMacroBundle(vascularNormalBundle([NECK_NORMAL], FULL_CTX));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("intact luminal flow voids");
    expect(findings).not.toContain("uniform high-velocity signal without focal stenosis");
    expect(findings).toContain("The remaining visualised intracranial arteries");
  });
});
