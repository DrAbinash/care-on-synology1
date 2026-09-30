/**
 * mriBrainVascularThrombosis.test.ts — a clot is described, a thrombosis is declared,
 * and only the radiologist does the second (mra/mrv spec §12, §13, §15, §19).
 *
 * §12's transverse-sinus rule is the reason this module exists: the appearances that
 * raise thrombosis and the statement that it is thrombosis are different records in
 * the report. The tests below hold that line — a filling defect with no selection
 * produces no thrombosis sentence, a clot signal produces no stage, and the library's
 * "diagnostic of ACUTE" clause is reachable only from an acute selection. The rest is
 * reconciliation: the thrombosed sinus's own patent sentence must leave the report, and
 * the deep system's thalamic oedema must stay with the deep system.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { contentPackForConcept } from "@/lib/conceptCanon/contentPacks";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import { ALL_VASCULAR_TILES, VASCULAR_TREE_NORMALS } from "@/lib/mriBrainVascularSubMasters";
import {
  isDeepVenousVessel,
  venousThrombosisAtoms,
  venousThrombosisConclusionSentence,
  venousThrombosisFindingsSentence,
  type CvstRecord,
} from "@/lib/mriBrainVascularThrombosis";
import { vesselByKey, vesselConceptId } from "@/lib/mriBrainVessels";
import { patentSentenceFor, vesselObservationAtoms } from "@/lib/mriBrainVesselObservations";
import { VASCULAR_LIBRARY_PROSE } from "@/lib/mriBrainVascularProse";
import { defaultVascularTechnique, type VascularTechniqueState } from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { useWorkspace } from "@/lib/zai-workspace/store";

const BRAIN_FULL = parseBrainSequences(
  "MRI brain: T1, T2, FLAIR, DWI with ADC, GRE/SWI. Gadolinium administered.",
);
const BRAIN_NO_SWI = parseBrainSequences("MRI brain: T1, T2, FLAIR");
const BRAIN_NO_FLAIR = parseBrainSequences("MRI brain: T1, T2, DWI with ADC, GRE/SWI");

function tech(keys: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
}

const MRV_TOF = tech({ mrvTof: true });
const MRV_CONTRAST = tech({ mrvTof: true, mrvCe: true });
const CTX = { technique: MRV_CONTRAST, brain: BRAIN_FULL };
const CTX_TOF = { technique: MRV_TOF, brain: BRAIN_FULL };

const cvst = (over: Partial<CvstRecord> = {}): CvstRecord => ({
  vein: "superior sagittal sinus",
  occlusion: "occlusive",
  extent: "spanning from the anterior third to the torcular herophili",
  thrombusSignal: "T1 hyperintense and T2/FLAIR iso-to-hypointense",
  thrombosisSelected: true,
  stage: "acute",
  ...over,
});

const applyRecord = (atoms: ReturnType<typeof venousThrombosisAtoms>) => {
  useWorkspace.getState().applyMacroBundle({
    bundleId: atoms.bundleId,
    observations: brainAtomsToPatches("Brain", atoms.bundleId, atoms.atoms),
  });
  return useWorkspace.getState().findingsText;
};

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
      studyDescription: "MRI Brain with MR venography",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

describe("§13 the description, in the sinus's own words", () => {
  it("states occlusion, extent and signal as entered", () => {
    const s = venousThrombosisFindingsSentence(cvst(), "superior sagittal sinus");
    expect(s).toBe(
      "Occlusive thrombus filling the superior sagittal sinus, spanning from the anterior "
      + "third to the torcular herophili. Thrombus signal: T1 hyperintense and T2/FLAIR "
      + "iso-to-hypointense. The reporting radiologist stages the thrombus as acute on the "
      + "available sequences and clinical context.",
    );
    expect(venousThrombosisFindingsSentence(cvst({ occlusion: "non-occlusive" }), "SSS"))
      .toContain("Non-occlusive thrombus along the SSS wall");
  });

  it("records recanalisation and collaterals only when they were chosen", () => {
    expect(venousThrombosisFindingsSentence(cvst(), "superior sagittal sinus"))
      .not.toMatch(/recanal|collateral/);
    const s = venousThrombosisFindingsSentence(
      cvst({ recanalization: "present", collateralization: "absent" }),
      "superior sagittal sinus",
    );
    expect(s).toContain("Partial recanalisation of the thrombus.");
    expect(s).toContain("No collateral veins are demonstrated.");
  });

  it("writes the sinus's own row, superseding that sinus's patent sentence", () => {
    const row = venousThrombosisAtoms(cvst(), CTX);
    expect(row.atoms[0]!.concept).toBe("mrv_vessel_sss");
    expect(row.atoms[0]!.baselineReplaces).toBe(patentSentenceFor(vesselByKey("sss")!));
    expect(row.atoms[0]!.anatomicalSection).toBe("Dural venous sinuses");
  });

  it("replaces the MRV all-normal sentence and keeps the remaining sinuses normal", () => {
    const normal = ALL_VASCULAR_TILES.find((t) => t.id === "mrv-normal")!;
    useWorkspace.getState().applyMacroBundle({
      bundleId: "bsm-test-mrv-normal",
      observations: brainAtomsToPatches("Brain", "bsm-test-mrv-normal", normal.atoms),
    });
    expect(useWorkspace.getState().findingsText).toContain("without filling defect");
    const findings = applyRecord(venousThrombosisAtoms(cvst({
      replaceTreeNormal: VASCULAR_TREE_NORMALS.mrv.sentence,
      remainderNormal: VASCULAR_TREE_NORMALS.mrv.remainder,
    }), CTX));
    expect(findings).not.toContain("without filling defect");
    expect(findings).toContain("The remaining dural venous sinuses and deep cerebral veins");
  });

  it("removes the patent row's sentence from Findings, not just from the ledger", () => {
    const leftTransverse = vesselByKey("transverse-sinus-left")!;
    const normalSentence = patentSentenceFor(leftTransverse);
    const patent = vesselObservationAtoms({
      vessel: "left transverse sinus",
      status: "v:patent",
      territory: "venous",
      technique: MRV_CONTRAST,
      brain: BRAIN_FULL,
    });
    useWorkspace.getState().applyMacroBundle({
      bundleId: patent.bundleId,
      observations: brainAtomsToPatches("Brain", patent.bundleId, patent.atoms),
    });
    expect(useWorkspace.getState().findingsText).toContain(normalSentence);
    const findings = applyRecord(venousThrombosisAtoms(
      cvst({ vein: "left transverse sinus" }),
      CTX,
    ));
    // §19: "sinus patent + same sinus occlusively thrombosed" cannot both be printed.
    expect(findings).not.toContain(normalSentence);
    expect(findings).toContain("Occlusive thrombus filling the left transverse sinus");
  });
});

describe("§12 a flow gap is not a thrombosis", () => {
  it("emits no thrombosis statement until it is selected", () => {
    const row = venousThrombosisAtoms(
      cvst({ thrombosisSelected: false, occlusion: "", thrombusSignal: "", stage: "" }),
      CTX,
    );
    const text = row.atoms.map((a) => `${a.findings} ${a.impression ?? ""}`).join(" ");
    expect(row.atoms.some((a) => a.concept === "mrv_thrombosis")).toBe(false);
    expect(text).not.toMatch(/thrombosis/i);
  });

  it("describes a filling defect on its own, without a diagnosis", () => {
    const row = venousThrombosisAtoms({
      vein: "left transverse sinus",
      fillingDefect: "present",
      thrombosisSelected: false,
      occlusion: "",
      thrombusSignal: "",
    }, CTX);
    expect(row.atoms[0]!.findings).toBe("Filling defect within the left transverse sinus.");
    expect(row.atoms[0]!.concept).toBe("mrv_vessel_transverse_sinus");
    expect(row.atoms[0]!.laterality).toBe("left");
  });

  it("puts the conclusion on the palette's own concept and severity", () => {
    const tile = ALL_VASCULAR_TILES.find((t) => t.id === "mrv-thrombosis-diagnosis")!;
    const row = venousThrombosisAtoms(cvst(), CTX);
    const conclusion = row.atoms.find((a) => a.concept === "mrv_thrombosis");
    expect(conclusion).toBeTruthy();
    expect(tile.atoms[0]!.concept).toBe(conclusion!.concept);
    expect(conclusion!.severity).toBe("critical");
  });
});

describe("§13 the stage is the radiologist's interpretation", () => {
  it("says nothing about timing when no stage was chosen", () => {
    const s = venousThrombosisFindingsSentence(cvst({ stage: "" }), "superior sagittal sinus");
    expect(s).not.toMatch(/acute|subacute|chronic/);
    expect(venousThrombosisAtoms(cvst({ stage: "" }), CTX).atoms[1]!.impression)
      .not.toMatch(/diagnostic of acute/i);
  });

  it("reaches the library's acute conclusion only through an acute selection", () => {
    const acute = venousThrombosisAtoms(cvst({ stage: "acute" }), CTX);
    expect(acute.atoms.find((a) => a.concept === "mrv_thrombosis")!.impression)
      .toMatch(/diagnostic of acute dural venous sinus thrombosis/i);
    const subacute = venousThrombosisAtoms(cvst({ stage: "subacute" }), CTX);
    const impression = subacute.atoms.find((a) => a.concept === "mrv_thrombosis")!.impression!;
    expect(impression).not.toMatch(/diagnostic of/i);
    expect(impression).toContain("(subacute, radiologist-staged)");
    expect(subacute.atoms.find((a) => a.concept === "mrv_vessel_sss")!.state)
      .toBe("staged subacute by the radiologist");
    expect(subacute.atoms.find((a) => a.concept === "mrv_thrombosis")!.state)
      .toBe("staged subacute");
  });

  it("keeps the recorded stage beside the conclusion", () => {
    expect(venousThrombosisConclusionSentence(cvst(), "superior sagittal sinus")).toBe(
      "Occlusive thrombosis of the superior sagittal sinus, spanning from the anterior "
      + "third to the torcular herophili — staged acute by the reporting radiologist.",
    );
  });
});

describe("§13 extension across the venous anatomy", () => {
  it("opens one row per structure the thrombus extends into", () => {
    const row = venousThrombosisAtoms(cvst({
      extension: ["left transverse sinus", "right sigmoid sinus"],
    }), CTX);
    expect(row.atoms.map((a) => `${a.concept}|${a.laterality ?? ""}`)).toEqual([
      "mrv_vessel_sss|",
      "mrv_vessel_transverse_sinus|left",
      "mrv_vessel_sigmoid_sinus|right",
      "mrv_thrombosis|",
    ]);
    expect(row.atoms[2]!.findings).toBe("Extension of thrombus into the right sigmoid sinus.");
    expect(row.atoms[2]!.baselineReplaces).toContain("preserved venous flow signal");
  });

  it("refuses the whole record when one extension names nothing", () => {
    const row = venousThrombosisAtoms(cvst({ extension: ["the jugger"] }), CTX);
    expect(row.atoms).toEqual([]);
    expect(row.errors?.[0]).toMatch(/does not name a single venous structure/);
  });

  it("refuses a vein that is not one vein", () => {
    expect(venousThrombosisAtoms(cvst({ vein: "the dural venous system" }), CTX).errors?.[0])
      .toMatch(/does not name a single venous structure/);
  });

  it("records nothing for an empty entry", () => {
    expect(venousThrombosisAtoms({ vein: "sss" }, CTX).errors)
      .toEqual(["no venous thrombosis findings entered"]);
  });
});

describe("§13 the deep venous system", () => {
  it("knows which structures are deep", () => {
    expect(isDeepVenousVessel(vesselByKey("vein-of-galen")!)).toBe(true);
    expect(isDeepVenousVessel(vesselByKey("internal-cerebral-vein-left")!)).toBe(true);
    expect(isDeepVenousVessel(vesselByKey("sss")!)).toBe(false);
  });

  it("states deep thrombosis on its own concept, with the thalamic oedema the library words there", () => {
    const row = venousThrombosisAtoms(cvst({
      vein: "vein of Galen",
      thrombusSignal: "",
      brainFindings: { bilateralThalamicEdema: true },
    }), CTX);
    expect(row.errors).toBeUndefined();
    const conclusion = row.atoms.find((a) => a.concept === "mrv_deep_venous_thrombosis");
    expect(conclusion).toBeTruthy();
    expect(row.atoms.some((a) => a.concept === "mrv_thrombosis")).toBe(false);
    expect(conclusion!.findings).toContain("bilateral thalamic oedema on FLAIR");
    expect(conclusion!.impression).toContain("Deep cerebral venous thrombosis");
    expect(row.atoms.some((a) => a.concept === "edema")).toBe(false);
  });

  it("will not attach thalamic oedema to a sinus that is not the deep system", () => {
    const row = venousThrombosisAtoms(cvst({
      thrombosisSelected: false,
      brainFindings: { bilateralThalamicEdema: true },
    }), CTX);
    expect(row.errors?.[0]).toMatch(/belongs with thrombosis of the deep venous system/);
  });
});

describe("§13/§4 the associated brain findings keep their sequence gates", () => {
  it("needs a susceptibility sequence for any haemorrhagic venous wording", () => {
    const blocked = venousThrombosisAtoms(cvst({
      brainFindings: { petechialHemorrhage: true },
    }), { technique: MRV_CONTRAST, brain: BRAIN_NO_SWI });
    expect(blocked.blocked?.notice).toMatch(/GRE or SWI/i);
    expect(blocked.atoms).toEqual([]);
  });

  it("needs DWI with ADC to claim restricted diffusion", () => {
    const row = venousThrombosisAtoms(cvst({
      brainFindings: { diffusionRestriction: true },
    }), { technique: MRV_CONTRAST, brain: BRAIN_NO_SWI });
    expect(row.blocked?.notice).toMatch(/DWI|ADC/);
  });

  it("needs FLAIR to describe oedema or a venous infarct", () => {
    const row = venousThrombosisAtoms(cvst({
      brainFindings: { venousInfarction: true },
    }), { technique: MRV_CONTRAST, brain: BRAIN_NO_FLAIR });
    expect(row.blocked?.notice).toMatch(/FLAIR is not recorded as performed/);
  });

  it("needs contrast or phase-contrast technique to call something a filling defect", () => {
    expect(venousThrombosisAtoms(cvst({ fillingDefect: "present" }), CTX_TOF).blocked?.notice)
      .toMatch(/flow gap, not a thrombus/);
  });

  it("needs the source sequences that show clot signal", () => {
    expect(venousThrombosisAtoms(cvst(), {
      technique: MRV_CONTRAST,
      brain: BRAIN_NO_FLAIR,
    }).blocked).toBeUndefined();
    expect(venousThrombosisAtoms(cvst(), {
      technique: MRV_CONTRAST,
      brain: parseBrainSequences("MRI brain: FLAIR only"),
    }).blocked?.notice).toMatch(/source sequences/i);
  });

  it("refuses the whole record without a venogram", () => {
    expect(venousThrombosisAtoms(cvst(), {
      technique: defaultVascularTechnique(),
      brain: BRAIN_FULL,
    }).blocked?.notice).toMatch(/no MR venography acquisition/i);
  });
});

describe("§13 the record lands on the ledger", () => {
  it("writes every finding, then takes them all back off", () => {
    const row = venousThrombosisAtoms(cvst({
      extension: ["left transverse sinus"],
      brainFindings: {
        venousInfarction: true,
        hemorrhagicVenousInfarction: true,
        massEffect: true,
        midlineShiftMm: 6,
        midlineShiftSide: "right",
        location: "high parasagittal superior frontal gyrus",
      },
    }), CTX);
    const findings = applyRecord(row);
    expect(findings).toContain("Extension of thrombus into the left transverse sinus");
    expect(findings).toContain("venous haemorrhagic infarction");
    expect(findings).toContain("Midline shift of 6 mm to the right");
    expect(useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale)).toHaveLength(6);
    for (const atom of row.atoms) {
      expect(contentPackForConcept(atom.concept), atom.concept).toBeTruthy();
    }
    const shift = row.atoms.find((a) => a.concept === "midline_shift");
    expect(shift?.severity).toBe("critical");
    expect(shift?.measurement).toBe("6");
    expect(useWorkspace.getState().removeMacroBundle(row.bundleId)).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toContain("Occlusive thrombus");
  });

  it("keeps one thrombosed sinus statement when a palette row already described it", () => {
    const tile = ALL_VASCULAR_TILES.find((t) => t.id === "mrv-thrombus-signal")!;
    useWorkspace.getState().applyMacroBundle({
      bundleId: "bsm-test-thrombus-tile",
      observations: brainAtomsToPatches("Brain", "bsm-test-thrombus-tile", tile.atoms),
    });
    const row = venousThrombosisAtoms(cvst(), CTX);
    expect(vesselConceptId(vesselByKey("sss")!)).toBe(tile.atoms[0]!.concept);
    applyRecord(row);
    const live = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && p.observation?.concept === "mrv_vessel_sss");
    expect(live).toHaveLength(1);
    expect(live[0]!.lastRendered?.findings).toContain("spanning from the anterior third");
  });

  it("quotes the library's own normal sentence when nothing was found", () => {
    expect(VASCULAR_LIBRARY_PROSE.mrvNormal).toContain("without filling defect");
  });
});

describe("§15 the caller can state the carried baseline on the context", () => {
  it("supersedes it and keeps the remaining sinuses normal", () => {
    const row = venousThrombosisAtoms(cvst(), {
      ...CTX,
      replaceTreeNormal: VASCULAR_TREE_NORMALS.mrv.sentence,
      remainderNormal: VASCULAR_TREE_NORMALS.mrv.remainder,
    });
    expect(row.atoms.some((a) => a.baselineReplaces === VASCULAR_TREE_NORMALS.mrv.sentence))
      .toBe(true);
    const remainder = row.atoms.find((a) => a.concept === "mrv_venous");
    expect(remainder?.findings).toBe(VASCULAR_TREE_NORMALS.mrv.remainder);
    expect(remainder?.role).toBe("baseline");
  });

  it("still prefers a baseline stated on the record itself", () => {
    const row = venousThrombosisAtoms(
      cvst({ replaceTreeNormal: "The sentence this record was entered against." }),
      { ...CTX, replaceTreeNormal: VASCULAR_TREE_NORMALS.mrv.sentence },
    );
    expect(row.atoms.some((a) => a.baselineReplaces === "The sentence this record was entered against."))
      .toBe(true);
  });
});
