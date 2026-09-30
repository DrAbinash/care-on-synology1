/**
 * mriBrainVascularLesions.test.ts — the aneurysm / moyamoya / AVM records say what
 * was entered and nothing stronger (mra/mrv spec §6, §8, §9, §16, §18).
 *
 * Three classes of failure are asserted here:
 *
 *   - A calculated value drifting from its sources. The dome-to-neck ratio exists only
 *     as arithmetic on the entered dome height and neck width, so a record cannot
 *     carry a ratio the radiologist typed, and an un-entered measurement cannot invent
 *     one.
 *   - A conclusion arriving without being chosen. "Ruptured" / "unruptured", Moyamoya
 *     disease and a Spetzler–Martin grade each appear only on the branch where the
 *     radiologist stated them; the pattern sentences are asserted NOT to contain the
 *     diagnosis they resemble.
 *   - Two records collapsing into one slot. §6 requires one or multiple aneurysms, so
 *     the parent vessel is part of the ledger identity — which is also the property
 *     that keeps an aneurysm from erasing the stenosis recorded on the same artery.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { contentPackForConcept } from "@/lib/conceptCanon/contentPacks";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import { ALL_VASCULAR_TILES } from "@/lib/mriBrainVascularSubMasters";
import {
  aneurysmAtoms,
  aneurysmDomeNeckRatio,
  aneurysmFindingsSentence,
  aneurysmImpressionSentence,
  aneurysmSlotFor,
  avmAtoms,
  avmFindingsSentence,
  moyamoyaAtoms,
  moyamoyaFindingsSentence,
  type AneurysmRecord,
  type AvmRecord,
  type MoyamoyaPatternRecord,
} from "@/lib/mriBrainVascularLesions";
import { VASCULAR_LIBRARY_PROSE } from "@/lib/mriBrainVascularProse";
import { vesselObservationAtoms } from "@/lib/mriBrainVesselObservations";
import {
  defaultVascularTechnique,
  type VascularTechniqueState,
} from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { useWorkspace } from "@/lib/zai-workspace/store";

const BRAIN_FULL = parseBrainSequences(
  "MRI brain: T1, T2, FLAIR, DWI with ADC, GRE/SWI. Gadolinium administered.",
);
/** A protocol with no sequence that could show clot, blood products or ischaemia. */
const BRAIN_PLAIN = parseBrainSequences("MRI brain: FLAIR only");

function tech(keys: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
}

const TOF = tech({ mraTof: true });
const NO_ANGIO = tech();
const TIME_RESOLVED = tech({ mraTof: true, timeResolved: true });

const CTX_FULL = { technique: TOF, brain: BRAIN_FULL };
const CTX_NO_BLOOD = { technique: TOF, brain: BRAIN_PLAIN };

const aneurysm = (over: Partial<AneurysmRecord> = {}): AneurysmRecord => ({
  parentVessel: "right MCA M1",
  morphology: "saccular",
  domeHeightMm: 8,
  maxWidthMm: 6,
  neckWidthMm: 4,
  ...over,
});

const applyAtoms = (
  atoms: ReturnType<typeof aneurysmAtoms>,
  region = "Brain",
) => {
  useWorkspace.getState().applyMacroBundle({
    bundleId: atoms.bundleId,
    observations: brainAtomsToPatches(region, atoms.bundleId, atoms.atoms),
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
      studyDescription: "MRI Brain with MRA",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

// ─── §6 the calculated value ─────────────────────────────────────────────

describe("§6 aneurysm — the ratio belongs to its measurements", () => {
  it("divides the dome height by the neck width, to two decimals", () => {
    expect(aneurysmDomeNeckRatio({ domeHeightMm: 8, neckWidthMm: 4 })).toBe(2);
    expect(aneurysmDomeNeckRatio({ domeHeightMm: 7, neckWidthMm: 4 })).toBe(1.75);
  });

  it("refuses to calculate from an empty or zero field", () => {
    expect(aneurysmDomeNeckRatio({ domeHeightMm: "", neckWidthMm: 4 })).toBeNull();
    expect(aneurysmDomeNeckRatio({ domeHeightMm: 8, neckWidthMm: "" })).toBeNull();
    // Number("") is 0, which is why the form's empty string is not a measurement.
    expect(aneurysmDomeNeckRatio({ domeHeightMm: 0, neckWidthMm: 0 })).toBeNull();
  });

  it("ignores the maximum width, which §6 reports but does not divide", () => {
    expect(aneurysmDomeNeckRatio({ domeHeightMm: 8, neckWidthMm: 4, maxWidthMm: 20 })).toBe(2);
  });

  it("cannot be fed a ratio: AneurysmRecord has no such field, and an extra one changes nothing", () => {
    const tampered = Object.assign({}, aneurysm(), { domeNeckRatio: 99, ratio: 99 });
    expect(aneurysmFindingsSentence(tampered, "right MCA M1")).toContain(
      "dome-to-neck ratio 2",
    );
    expect(aneurysmFindingsSentence(tampered, "right MCA M1")).not.toContain("99");
  });

  it("is not stored on the atom as anything but a derived statement of the two inputs", () => {
    const row = aneurysmAtoms([aneurysm()], CTX_FULL);
    expect(row.atoms[0]!.measurement).toBe("8");
    expect(row.atoms[0]!.state).toBe("dome-to-neck ratio 2");
    const noNeck = aneurysmAtoms([aneurysm({ neckWidthMm: "" })], CTX_FULL);
    expect(noNeck.atoms[0]!.state).toBeUndefined();
  });
});

describe("§6 aneurysm — the sentence is the record", () => {
  it("states all three measurements and the calculated ratio", () => {
    const s = aneurysmFindingsSentence(aneurysm(), "right MCA M1");
    expect(s).toBe(
      "Saccular aneurysm of the right MCA M1 measuring maximum dome height 8 mm, "
      + "maximum width 6 mm and neck width 4 mm (dome-to-neck ratio 2).",
    );
  });

  it("prints only the measurements that were entered", () => {
    const s = aneurysmFindingsSentence(
      aneurysm({ maxWidthMm: "", neckWidthMm: "" }),
      "right MCA M1",
    );
    expect(s).toBe("Saccular aneurysm of the right MCA M1 measuring maximum dome height 8 mm.");
  });

  it("adds each selected clause and no other", () => {
    const s = aneurysmFindingsSentence(
      aneurysm({
        segment: "MCA bifurcation",
        orientation: "anteroinferiorly",
        branchIncorporation: "present",
        daughterSac: true,
        thrombus: "absent",
        massEffect: "absent",
        associatedHemorrhage: "absent",
      }),
      "right MCA M1",
    );
    expect(s).toContain("at the MCA bifurcation");
    expect(s).toContain("The aneurysm is oriented anteroinferiorly.");
    expect(s).toContain("A branch vessel is incorporated at the neck.");
    expect(s).toContain("daughter sac");
    expect(s).toContain("There is no intrinsic thrombus.");
    expect(s).toContain("No associated haemorrhage is seen on T2* GRE/SWI.");
    const bare = aneurysmFindingsSentence(aneurysm(), "right MCA M1");
    expect(bare).not.toMatch(/oriented|daughter|thrombus|mass effect|haemorrhage|branch/);
  });

  it("names no shape when the morphology was not selected", () => {
    const measured = "measuring maximum dome height 8 mm, maximum width 6 mm and neck width 4 mm (dome-to-neck ratio 2).";
    expect(aneurysmFindingsSentence(aneurysm({ morphology: "" }), "basilar artery"))
      .toBe(`Aneurysm of the basilar artery ${measured}`);
    expect(aneurysmFindingsSentence(aneurysm({ morphology: "fusiform" }), "basilar artery"))
      .toContain("Fusiform aneurysm of the basilar artery");
  });

  it("writes a radiologist's rupture statement into both sentences, and nothing otherwise", () => {
    expect(aneurysmFindingsSentence(aneurysm(), "right MCA M1")).not.toMatch(/ruptur/i);
    expect(aneurysmImpressionSentence(aneurysm(), "right MCA M1")).not.toMatch(/ruptur/i);
    expect(aneurysmFindingsSentence(aneurysm({ ruptureStatus: "unruptured" }), "right MCA M1"))
      .toMatch(/^Unruptured saccular aneurysm of the right MCA M1/);
    expect(aneurysmImpressionSentence(aneurysm({ ruptureStatus: "ruptured" }), "right MCA M1"))
      .toBe("Ruptured saccular aneurysm of the right MCA M1 measuring 8 mm with a 4 mm neck.");
  });

  it("escalates a stated rupture to the critical path and sizes the rest by the dome", () => {
    expect(aneurysmAtoms([aneurysm({ ruptureStatus: "ruptured" })], CTX_FULL).atoms[0]!.severity)
      .toBe("critical");
    expect(aneurysmAtoms([aneurysm()], CTX_FULL).atoms[0]!.severity).toBe("urgent");
    expect(aneurysmAtoms([aneurysm({ domeHeightMm: 4 })], CTX_FULL).atoms[0]!.severity)
      .toBe("significant");
  });
});

// ─── §6 one slot per aneurysm ────────────────────────────────────────────

describe("§6 aneurysm — one or multiple, on the parent vessel", () => {
  it("opens a different slot per parent vessel and per side", () => {
    const row = aneurysmAtoms([
      aneurysm({ parentVessel: "anterior communicating artery" }),
      aneurysm({ parentVessel: "right MCA M1" }),
      aneurysm({ parentVessel: "left MCA M1", side: "left" }),
    ], CTX_FULL);
    expect(row.errors).toBeUndefined();
    expect(row.atoms.map((a) => `${a.concept}|${a.laterality ?? ""}`)).toEqual([
      "mra_aneurysm_acom|",
      "mra_aneurysm_mca_m1|right",
      "mra_aneurysm_mca_m1|left",
    ]);
  });

  it("keeps three aneurysms as three sentences in the report", () => {
    const findings = applyAtoms(aneurysmAtoms([
      aneurysm({ parentVessel: "ACom" }),
      aneurysm({ parentVessel: "right MCA M1" }),
      aneurysm({ parentVessel: "left ICA terminus", side: "left" }),
    ], CTX_FULL));
    expect(findings.match(/aneurysm/gi)).not.toBeNull();
    expect(findings).toContain("ACom region");
    expect(findings).toContain("right MCA M1");
    expect(findings).toContain("left ICA terminus");
    expect(useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale)).toHaveLength(3);
  });

  it("does not let a second record on the same vessel silently overwrite the first", () => {
    const row = aneurysmAtoms([
      aneurysm({ parentVessel: "right MCA M1", manualNote: "First sac." }),
      aneurysm({ parentVessel: "right MCA M1 segment", manualNote: "Second sac." }),
    ], CTX_FULL);
    expect(row.atoms).toHaveLength(1);
    expect(row.errors?.[0]).toMatch(/Two aneurysm records describe the right MCA M1/);
  });

  it("refuses a parent vessel that does not name one artery, rather than guessing", () => {
    const row = aneurysmAtoms([aneurysm({ parentVessel: "the posterior circulation" })], CTX_FULL);
    expect(row.atoms).toEqual([]);
    expect(row.errors?.[0]).toMatch(/does not name a single artery/);
  });

  it("splits an aneurysm from the lumen status of the same artery", () => {
    const stenosis = vesselObservationAtoms({
      vessel: "right MCA M1",
      status: "a:focalNarrowing",
      territory: "intracranialArterial",
      technique: TOF,
      brain: BRAIN_FULL,
    });
    useWorkspace.getState().applyMacroBundle({
      bundleId: stenosis.bundleId,
      observations: brainAtomsToPatches("Brain", stenosis.bundleId, stenosis.atoms),
    });
    const findings = applyAtoms(aneurysmAtoms([aneurysm()], CTX_FULL));
    expect(findings).toContain("Focal luminal narrowing of the right MCA M1");
    expect(findings).toContain("Saccular aneurysm of the right MCA M1");
  });

  it("binds the aneurysm palette tile to the same slot the record writes", () => {
    const tile = ALL_VASCULAR_TILES.find((t) => t.id === "mra-aneurysm-acom");
    const record = aneurysmAtoms([aneurysm({ parentVessel: "ACom" })], CTX_FULL);
    expect(tile!.atoms[0]!.concept).toBe(record.atoms[0]!.concept);
    expect(tile!.atoms[0]!.conflictGroup).toBe(record.atoms[0]!.conflictGroup);
  });

  it("supersedes the all-normal MRA sentence and keeps the rest of the tree normal", () => {
    const normal = brainBundleIdAtoms();
    useWorkspace.getState().applyMacroBundle({
      bundleId: normal.bundleId,
      observations: brainAtomsToPatches("Brain", normal.bundleId, normal.atoms),
    });
    expect(useWorkspace.getState().findingsText).toContain("uniform high-velocity signal");
    const findings = applyAtoms(aneurysmAtoms([aneurysm({ parentVessel: "ACom" })], {
      ...CTX_FULL,
      replaceTreeNormal: VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
      remainderNormal: "The remaining visualised intracranial arteries are normal.",
    }));
    expect(findings).not.toContain("uniform high-velocity signal");
    expect(findings).toContain("The remaining visualised intracranial arteries are normal.");
  });

  it("gives every aneurysm slot a registered content pack", () => {
    for (const atom of aneurysmAtoms([
      aneurysm({ parentVessel: "ACom" }),
      aneurysm({ parentVessel: "right cervical ICA", territory: "neckArterial" }),
    ], CTX_FULL).atoms) {
      expect(contentPackForConcept(atom.concept), atom.concept).toBeTruthy();
    }
  });

  it("resolves a neck aneurysm onto the neck family concept", () => {
    const slot = aneurysmSlotFor("left cervical ICA");
    expect(slot!.concept).toBe("mra_neck_aneurysm_ica_cervical");
    expect(slot!.laterality).toBe("left");
  });
});

function brainBundleIdAtoms() {
  const tile = ALL_VASCULAR_TILES.find((t) => t.id === "mra-normal")!;
  return { atoms: tile.atoms, bundleId: "bsm-test-mra-normal" };
}

// ─── §6/§4 gating ────────────────────────────────────────────────────────

describe("§6 aneurysm — the acquisition decides what may be written", () => {
  it("refuses the whole record when no arterial acquisition exists", () => {
    const row = aneurysmAtoms([aneurysm()], { technique: NO_ANGIO, brain: BRAIN_FULL });
    expect(row.blocked?.notice).toMatch(/no arterial statement/i);
    expect(row.atoms).toEqual([]);
  });

  it("describes the sac on TOF alone, which is what an aneurysm needs", () => {
    expect(aneurysmAtoms([aneurysm()], CTX_FULL).blocked).toBeUndefined();
  });

  it("will not describe thrombus without the sequences that show it", () => {
    const blocked = aneurysmAtoms([aneurysm({ thrombus: "present" })], CTX_NO_BLOOD);
    expect(blocked.blocked?.missing.join(" ")).toMatch(/t1/i);
    expect(blocked.blocked?.notice).toMatch(/source sequences/i);
    expect(aneurysmAtoms([aneurysm({ thrombus: "present" })], CTX_FULL).blocked).toBeUndefined();
  });

  it("will not mention associated haemorrhage without a susceptibility sequence", () => {
    expect(aneurysmAtoms([aneurysm({ associatedHemorrhage: "absent" })], CTX_NO_BLOOD).blocked)
      .toBeTruthy();
    expect(aneurysmAtoms([aneurysm({ associatedHemorrhage: "absent" })], CTX_FULL).blocked)
      .toBeUndefined();
  });
});

// ─── §8 moyamoya ─────────────────────────────────────────────────────────

describe("§8 moyamoya — the pattern is not the disease", () => {
  const pattern: MoyamoyaPatternRecord = {
    terminalIcaNarrowing: "bilateral",
    proximalAcaInvolvement: "bilateral",
    basalCollateralNetwork: true,
  };

  it("reassembles the library's pattern wording from what was entered", () => {
    const s = moyamoyaFindingsSentence(pattern);
    expect(s).toContain("Progressive narrowing / occlusion of the bilateral terminal internal carotid artery");
    expect(s).toContain("lenticulostriate collateral vessels");
    expect(s).toContain('"puff of smoke" appearance');
    expect(moyamoyaFindingsSentence({ terminalIcaNarrowing: "right" })).not.toMatch(/collateral/);
  });

  it("never reaches the disease sentence from the pattern record", () => {
    const row = moyamoyaAtoms(pattern, CTX_FULL);
    const text = row.atoms.map((a) => `${a.findings} ${a.impression ?? ""}`).join(" ");
    expect(row.atoms).toHaveLength(1);
    expect(text).not.toMatch(/moyamoya disease/i);
    expect(row.atoms[0]!.concept).toBe("mra_moyamoya_pattern");
    expect(row.atoms[0]!.impression).toMatch(/disease classification is a radiologist diagnosis/);
    expect(row.atoms[0]!.laterality).toBe("bilateral");
  });

  it("adds the disease only when the radiologist classifies it, on its own slot", () => {
    const row = moyamoyaAtoms({ ...pattern, diseaseClassification: true }, CTX_FULL);
    expect(row.atoms.map((a) => a.concept)).toEqual([
      "mra_moyamoya_pattern",
      "mra_moyamoya_disease",
    ]);
    expect(row.atoms[1]!.findings).toMatch(/classified by the reporting radiologist/);
  });

  it("shares one slot with the palette tiles rather than opening a second", () => {
    const tileConcepts = ALL_VASCULAR_TILES
      .filter((t) => t.id.startsWith("mra-moyamoya"))
      .map((t) => t.atoms[0]!.concept);
    const row = moyamoyaAtoms({ ...pattern, diseaseClassification: true }, CTX_FULL);
    expect(tileConcepts).toEqual(row.atoms.map((a) => a.concept));
  });

  it("gates the associated brain findings on the sequences that show them", () => {
    expect(moyamoyaAtoms({ ...pattern, ischemicFindings: true }, CTX_NO_BLOOD).blocked?.notice)
      .toMatch(/diffusion/i);
    expect(moyamoyaAtoms({ ...pattern, hemorrhagicFindings: true }, CTX_NO_BLOOD).blocked?.notice)
      .toMatch(/GRE|SWI/i);
    expect(moyamoyaAtoms({ ...pattern, ischemicFindings: true }, CTX_FULL).blocked)
      .toBeUndefined();
  });

  it("records nothing for an empty pattern, and refuses without an angiogram", () => {
    expect(moyamoyaAtoms({}, CTX_FULL).errors).toEqual(["no moyamoya-pattern findings entered"]);
    expect(moyamoyaAtoms(pattern, { technique: NO_ANGIO, brain: BRAIN_FULL }).blocked).toBeTruthy();
  });

  it("moves the ledger and comes back off it", () => {
    const row = moyamoyaAtoms(pattern, CTX_FULL);
    const findings = applyAtoms(row);
    expect(findings).toContain("puff of smoke");
    expect(useWorkspace.getState().removeMacroBundle(row.bundleId)).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toContain("puff of smoke");
  });
});

// ─── §9 AVM ──────────────────────────────────────────────────────────────

describe("§9 AVM — the malformation is described, not graded", () => {
  const avm: AvmRecord = {
    location: "left parietal lobe",
    nidusPresent: true,
    nidusApCm: 3,
    nidusTransverseCm: 2.5,
    nidusCcCm: 2,
    arterialFeeders: ["left MCA M2", "left ACA A2"],
    venousDrainage: "superior sagittal sinus",
    drainagePattern: "superficial",
  };

  it("states the three nidus dimensions and the resolved feeders", () => {
    const s = avmFindingsSentence(avm, ["left MCA M2", "left ACA A2"]);
    expect(s).toContain("central nidus measuring 3 cm AP × 2.5 cm transverse × 2 cm craniocaudal");
    expect(s).toContain("Dominant arterial feeders from the left MCA M2, left ACA A2.");
    expect(s).toContain("Venous drainage by superficial route into the superior sagittal sinus.");
  });

  it("resolves a feeder through the vessel registry and rejects one that is not an artery", () => {
    const row = avmAtoms({ ...avm, arterialFeeders: ["superior sagittal sinus"] }, CTX_FULL);
    expect(row.errors?.[0]).toMatch(/does not name a single artery/);
    expect(row.atoms).toEqual([]);
  });

  it("will not guess which side a side-less feeder belongs to", () => {
    expect(avmAtoms({ ...avm, arterialFeeders: ["ACA A2"] }, CTX_FULL).errors?.[0])
      .toMatch(/does not name a single artery/);
  });

  it("needs a location, because the nidus sits in brain rather than in a vessel", () => {
    expect(avmAtoms({ ...avm, location: "  " }, CTX_FULL).errors?.[0])
      .toMatch(/needs its location/);
  });

  it("will not claim early draining veins from a static angiogram", () => {
    const blocked = avmAtoms({ ...avm, earlyVenousDrainage: true }, CTX_FULL);
    expect(blocked.blocked?.notice).toMatch(/static MRA cannot establish/i);
    expect(blocked.atoms).toEqual([]);
    const row = avmAtoms({ ...avm, earlyVenousDrainage: true }, {
      ...CTX_FULL,
      technique: TIME_RESOLVED,
    });
    expect(row.blocked).toBeUndefined();
    expect(row.atoms.map((a) => a.concept)).toEqual(["avm", "avm_venous_drainage"]);
    expect(row.atoms[1]!.findings).toContain("time-resolved acquisition");
  });

  it("never computes a grade, and prints one only when it was entered", () => {
    expect(avmFindingsSentence(avm, [])).not.toMatch(/spetzler/i);
    expect(avmFindingsSentence({ ...avm, spetzlerMartinGrade: 3 }, []))
      .toContain("Spetzler–Martin grade 3 (radiologist-entered).");
  });

  it("records an associated aneurysm as an association, not as §6 morphology", () => {
    const row = avmAtoms({ ...avm, associatedAneurysm: true }, CTX_FULL);
    const atom = row.atoms.find((a) => a.concept === "avm_associated_aneurysm");
    expect(atom?.state).toMatch(/no morphology recorded/);
    expect(contentPackForConcept("avm_associated_aneurysm")).toBeTruthy();
  });

  it("shares the nidus slot with the AVM palette tile", () => {
    const tile = ALL_VASCULAR_TILES.find((t) => t.id === "mra-avm-nidus");
    expect(tile!.atoms[0]!.concept).toBe(avmAtoms(avm, CTX_FULL).atoms[0]!.concept);
  });

  it("gates associated haemorrhage on susceptibility, and the record on an angiogram", () => {
    expect(avmAtoms({ ...avm, associatedHemorrhage: true }, CTX_NO_BLOOD).blocked).toBeTruthy();
    expect(avmAtoms(avm, { technique: NO_ANGIO, brain: BRAIN_FULL }).blocked).toBeTruthy();
  });

  it("writes the parenchymal context the radiologist selected", () => {
    const s = avmFindingsSentence({
      ...avm,
      gliosisOrEdema: true,
      massEffect: true,
      nidusPresent: false,
    }, []);
    expect(s).toContain("without a demonstrable nidus");
    expect(s).toContain("Surrounding gliosis / oedema is present.");
    expect(s).toContain("Adjacent mass effect is present.");
  });
});

describe("§15 a pattern record supersedes the normal the report carries", () => {
  const pattern = {
    terminalIcaNarrowing: "bilateral" as const,
    basalCollateralNetwork: true,
  };
  const TREE = "Major intracranial arteries are normal.";
  const REMAINDER = "The remaining intracranial arteries are normal.";

  it("supersedes the intracranial baseline named on the context", () => {
    const row = moyamoyaAtoms(pattern, { ...CTX_FULL, replaceTreeNormal: TREE, remainderNormal: REMAINDER });
    expect(row.atoms[0]!.baselineReplaces).toBe(TREE);
    const remainder = row.atoms.find((a) => a.findings === REMAINDER);
    expect(remainder?.concept).toBe("mra_arterial");
    expect(remainder?.role).toBe("baseline");
  });

  it("does not invent a baseline the report never carried", () => {
    const row = moyamoyaAtoms(pattern, CTX_FULL);
    expect(row.atoms[0]!.baselineReplaces).toBeUndefined();
    expect(row.atoms.some((a) => a.findings === REMAINDER)).toBe(false);
  });

  it("routes the rest of the tree normal through the neck when the aneurysm is a neck aneurysm", () => {
    const record = aneurysm({ parentVessel: "right cervical ICA", territory: "neckArterial", side: "right" });
    const neck = aneurysmAtoms([record], {
      ...CTX_FULL,
      replaceTreeNormal: TREE,
      remainderNormal: REMAINDER,
    });
    expect(neck.atoms[1]!.concept).toBe("mra_neck_arterial");
    const head = aneurysmAtoms([aneurysm()], {
      ...CTX_FULL,
      replaceTreeNormal: TREE,
      remainderNormal: REMAINDER,
    });
    expect(head.atoms[1]!.concept).toBe("mra_arterial");
  });
});
