/**
 * mriBrainVascularStenosis.test.ts — a percentage is measured, and a stage is chosen
 * (mra/mrv spec §7, §11, §19).
 *
 * §11's NASCET safety rule is the one a template can break silently: an appearance
 * preset that reads as "severe" must not become "80 %". So the arithmetic is asserted
 * directly, then the record is asserted from the other side — a descriptor alone
 * produces no number, a number without its two diameters is refused, and a number
 * whose measurement is not attributable says so. The dissection rows are tested the
 * same way: a T1 crescent is a description, and the words "acute" and "dissection"
 * only arrive when the radiologist puts them there.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { contentPackForConcept } from "@/lib/conceptCanon/contentPacks";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import { ALL_VASCULAR_TILES } from "@/lib/mriBrainVascularSubMasters";
import {
  carotidDissectionAtoms,
  measuredStenosisAtoms,
  measuredStenosisPercent,
  nascetBandFor,
  nascetPercent,
  stenosisDescriptorConflict,
  stenosisFindingsSentence,
  stenosisProvenanceLabel,
  dissectionFindingsSentence,
  type CarotidDissectionRecord,
  type MeasuredStenosisRecord,
} from "@/lib/mriBrainVascularStenosis";
import { defaultVascularTechnique, type VascularTechniqueState } from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { useWorkspace } from "@/lib/zai-workspace/store";

const BRAIN = parseBrainSequences("MRI brain: T1, T2, FLAIR, DWI with ADC, GRE/SWI");
const BRAIN_NO_T1 = parseBrainSequences("MRI brain: FLAIR only");

function tech(keys: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
}

const TOF = tech({ mraTof: true });
const MEASURABLE = tech({ mraTof: true, sourceImages: true, mraCe: true });
const VESSEL_WALL = tech({ mraTof: true, mraVesselWall: true });
const CTX = { technique: MEASURABLE, brain: BRAIN };
const CTX_TOF = { technique: TOF, brain: BRAIN };

const PROVENANCE = { source: "viewer-caliper", annotationIds: ["svm_a1", "svm_b2"] } as const;

const stenosis = (over: Partial<MeasuredStenosisRecord> = {}): MeasuredStenosisRecord => ({
  vessel: "left carotid bulb",
  formula: "nascet",
  minResidualLumenMm: 1.2,
  referenceLumenMm: 5,
  provenance: PROVENANCE,
  ...over,
});

const dissection = (over: Partial<CarotidDissectionRecord> = {}): CarotidDissectionRecord => ({
  vessel: "left cervical ICA",
  intramuralHematoma: "present",
  hematomaExtent: "from the bulb to the skull base",
  ...over,
});

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
      studyDescription: "MRI Brain and neck MRA",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

// ─── §11 the arithmetic ──────────────────────────────────────────────────

describe("§11 NASCET — the percentage is a quotient", () => {
  it("divides the residual lumen by the distal reference", () => {
    expect(nascetPercent(1.2, 5)).toBe(76);
    expect(nascetPercent(2, 4)).toBe(50);
    expect(nascetPercent(1.9, 4)).toBe(53);
  });

  it("will not calculate from a missing or non-positive diameter", () => {
    expect(nascetPercent("", 5)).toBeNull();
    expect(nascetPercent(1.2, "")).toBeNull();
    expect(nascetPercent(1.2, 0)).toBeNull();
    // A zero residual is an occlusion, and the occlusion row is where it belongs.
    expect(nascetPercent(0, 5)).toBeNull();
  });

  it("will not turn a measurement error into a negative or impossible stenosis", () => {
    expect(nascetPercent(5, 5)).toBeNull();
    expect(nascetPercent(6, 5)).toBeNull();
  });

  it("reports the override figure when the radiologist supplies one", () => {
    expect(measuredStenosisPercent(stenosis({ manualOverride: true, percent: 70 }))).toBe(70);
    expect(measuredStenosisPercent(stenosis())).toBe(76);
  });

  it("places a descriptor on the trial's own bands, for validation only", () => {
    expect([4, 49, 50, 69, 70, 94, 95, 100].map(nascetBandFor)).toEqual([
      "mild", "mild", "moderate", "moderate", "severe", "severe", "near-occlusion", "occluded",
    ]);
  });

  it("spots a descriptor that does not match the number, and only warns", () => {
    expect(stenosisDescriptorConflict("mild", 80)).toMatch(/does not match the measured 80% \(severe/);
    expect(stenosisDescriptorConflict("severe", 80)).toBeNull();
    expect(stenosisDescriptorConflict("high-grade", 85)).toBeNull();
    expect(stenosisDescriptorConflict("severe", null)).toBeNull();
    const row = measuredStenosisAtoms(stenosis({ descriptor: "mild" }), CTX);
    expect(row.warnings?.[0]).toMatch(/need review/);
    expect(row.atoms).toHaveLength(1);
  });
});

// ─── §11 no number without its measurements ─────────────────────────────

describe("§11 NASCET — an appearance preset cannot become a percentage", () => {
  it("refuses a NASCET row that has a descriptor but no diameters", () => {
    const row = measuredStenosisAtoms(
      stenosis({ minResidualLumenMm: "", referenceLumenMm: "", descriptor: "severe" }),
      CTX,
    );
    expect(row.atoms).toEqual([]);
    expect(row.errors?.[0]).toMatch(/needs both the minimum residual lumen and the distal reference/);
  });

  it("prints no number when only the appearance was recorded", () => {
    const row = measuredStenosisAtoms(
      { vessel: "left carotid bulb", formula: "entered", descriptor: "severe" },
      CTX,
    );
    const text = `${row.atoms[0]!.findings} ${row.atoms[0]!.impression ?? ""}`;
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).toContain("without a reported percentage");
    expect(text).toContain("severe stenosis.");
  });

  it("explains a residual that is not narrower than its reference", () => {
    const row = measuredStenosisAtoms(stenosis({ minResidualLumenMm: 5, referenceLumenMm: 4 }), CTX);
    expect(row.errors?.[0]).toMatch(/is not narrower than its reference/);
  });

  it("says where the number came from, and warns when nothing says so", () => {
    const withSource = measuredStenosisAtoms(stenosis(), CTX);
    expect(withSource.atoms[0]!.findings).toContain(
      "Measurement source: measured on the viewer from the linked caliper; annotations svm_a1, svm_b2.",
    );
    expect(withSource.warnings).toBeUndefined();
    const bare = measuredStenosisAtoms(stenosis({ provenance: undefined }), CTX);
    expect(bare.warnings?.[0]).toMatch(/without measurement provenance/);
    expect(bare.atoms).toHaveLength(1);
  });

  it("keeps a manual override identified as one", () => {
    const s = stenosisFindingsSentence(
      stenosis({ manualOverride: true, percent: 60, overrideReason: "the caliper crossed a plaque" }),
      "left carotid bulb",
    );
    expect(s).toContain(": 60% NASCET");
    expect(s).toContain("The percentage is the reporting radiologist's figure: the caliper crossed a plaque.");
    expect(measuredStenosisAtoms(stenosis({ manualOverride: true, percent: 60 }), CTX).atoms[0]!.state)
      .toContain("radiologist override");
  });

  it("names an unattributed figure as typed rather than measured", () => {
    expect(stenosisProvenanceLabel({ source: "manual-entry" }))
      .toBe("entered by the reporting radiologist without a linked caliper");
    expect(stenosisProvenanceLabel(undefined)).toBe("no measurement provenance recorded");
  });

  it("states both diameters beside the percentage", () => {
    expect(stenosisFindingsSentence(stenosis(), "left carotid bulb")).toContain(
      "Measured stenosis of the left carotid bulb: 76% NASCET "
      + "(minimum residual lumen 1.2 mm against a distal normal internal carotid reference of 5 mm).",
    );
  });
});

// ─── §7 the same rule inside the skull ───────────────────────────────────

describe("§7 intracranial stenosis — a stated percentage keeps its provenance", () => {
  it("writes an entered percentage onto the vessel's own lumen slot", () => {
    const row = measuredStenosisAtoms({
      vessel: "right MCA M1",
      formula: "entered",
      percent: 70,
      provenance: { source: "external-study", detail: "CTA two days earlier" },
    }, CTX);
    expect(row.atoms[0]!.concept).toBe("mra_vessel_mca_m1");
    expect(row.atoms[0]!.laterality).toBe("right");
    expect(row.atoms[0]!.findings).toContain(
      "Measurement source: carried across from the study named below; CTA two days earlier.",
    );
  });

  it("refuses a numeric grade that the acquisition cannot carry", () => {
    const row = measuredStenosisAtoms(stenosis(), CTX_TOF);
    expect(row.blocked?.notice).toMatch(/not generated from TOF signal loss/);
    expect(row.atoms).toEqual([]);
  });

  it("refuses to describe even a number-less stenosis without an angiogram", () => {
    const row = measuredStenosisAtoms(
      { vessel: "left carotid bulb", formula: "entered" },
      { technique: defaultVascularTechnique(), brain: BRAIN },
    );
    expect(row.blocked?.notice).toMatch(/no arterial statement/i);
  });

  it("holds the vessel's one measured stenosis, superseding the appearance row", () => {
    const tile = ALL_VASCULAR_TILES.find((t) => t.id === "neck-stenosis-atherosclerotic")!;
    const tileBundle = "bsm-test-neck-appearance";
    useWorkspace.getState().applyMacroBundle({
      bundleId: tileBundle,
      observations: brainAtomsToPatches("Brain", tileBundle, tile.atoms),
    });
    const row = measuredStenosisAtoms(stenosis(), CTX);
    useWorkspace.getState().applyMacroBundle({
      bundleId: row.bundleId,
      observations: brainAtomsToPatches("Brain", row.bundleId, row.atoms),
    });
    const live = useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale);
    expect(live).toHaveLength(1);
    expect(live[0]!.observation?.concept).toBe("mra_neck_vessel_carotid_bulb");
    expect(live[0]!.observation?.measurement).toBe("76");
    expect(useWorkspace.getState().findingsText).toContain("76% NASCET");
  });

  it("refuses a vessel that names nothing", () => {
    const row = measuredStenosisAtoms(stenosis({ vessel: "the great vessels" }), CTX);
    expect(row.errors?.[0]).toMatch(/does not name a single vessel/);
  });
});

// ─── §11 dissection ──────────────────────────────────────────────────────

describe("§11 dissection — a T1 crescent is not a stage or a diagnosis", () => {
  it("describes the hematoma without any acuity word", () => {
    const s = dissectionFindingsSentence(dissection(), "left cervical ICA");
    expect(s).toContain("Eccentric crescentic T1 hyperintense intramural hematoma");
    expect(s).toContain("extending from the bulb to the skull base");
    expect(s).not.toMatch(/acute|chronic|subacute/);
  });

  it("states the stage only when the radiologist stages it", () => {
    const s = dissectionFindingsSentence(dissection({ stage: "subacute" }), "left cervical ICA");
    expect(s).toContain("stages the appearance as subacute");
  });

  it("keeps the conclusion on its own row, and the description impression-free", () => {
    const plain = carotidDissectionAtoms(dissection(), { technique: VESSEL_WALL, brain: BRAIN });
    expect(plain.atoms).toHaveLength(1);
    expect(plain.atoms[0]!.concept).toBe("mra_neck_vessel_ica_cervical");
    expect(plain.atoms[0]!.impression).toBeUndefined();
    const selected = carotidDissectionAtoms(
      dissection({ dissectionSelected: true, correlationRecommendation: "CTA of the neck" }),
      { technique: VESSEL_WALL, brain: BRAIN },
    );
    expect(selected.atoms.map((a) => a.concept)).toEqual([
      "mra_neck_vessel_ica_cervical",
      "mra_neck_dissection",
    ]);
    expect(selected.atoms[1]!.recommendation)
      .toBe("Recommend CTA of the neck for further characterisation.");
    expect(selected.atoms[1]!.findings).toContain("as a dissection.");
  });

  it("never volunteers a correlation study", () => {
    const row = carotidDissectionAtoms(dissection({ dissectionSelected: true }), {
      technique: VESSEL_WALL,
      brain: BRAIN,
    });
    expect(row.atoms[1]!.recommendation).toBeUndefined();
  });

  it("reserves the library's acute conclusion for an acute selection", () => {
    const chronic = carotidDissectionAtoms(
      dissection({ dissectionSelected: true, stage: "chronic" }),
      { technique: VESSEL_WALL, brain: BRAIN },
    );
    expect(chronic.atoms[1]!.impression).not.toMatch(/acute/);
    const acute = carotidDissectionAtoms(
      dissection({ dissectionSelected: true, stage: "acute" }),
      { technique: VESSEL_WALL, brain: BRAIN },
    );
    expect(acute.atoms[1]!.impression).toMatch(/diagnostic of acute carotid artery dissection/i);
  });

  it("needs the vessel-wall sequence for hematoma wording, but not to deny one", () => {
    const blocked = carotidDissectionAtoms(dissection(), CTX);
    expect(blocked.blocked?.notice).toMatch(/intramural hematoma is claimed only/i);
    expect(carotidDissectionAtoms(dissection(), {
      technique: VESSEL_WALL,
      brain: BRAIN,
    }).blocked).toBeUndefined();
    expect(carotidDissectionAtoms(dissection({ intramuralHematoma: "absent" }), CTX).blocked)
      .toBeUndefined();
  });

  it("will not claim a hematoma without the T1 to see it on", () => {
    const row = carotidDissectionAtoms(dissection(), {
      technique: VESSEL_WALL,
      brain: BRAIN_NO_T1,
    });
    expect(row.blocked?.missing.join(" ")).toMatch(/t1/i);
  });

  it("adds a pseudoaneurysm as its own registered statement", () => {
    const row = carotidDissectionAtoms(dissection({ pseudoaneurysm: true }), {
      technique: VESSEL_WALL,
      brain: BRAIN,
    });
    const atom = row.atoms.find((a) => a.concept === "aneurysm_pseudoaneurysm");
    expect(atom?.findings).toContain("suspicious for a pseudoaneurysm");
    expect(contentPackForConcept("aneurysm_pseudoaneurysm")).toBeTruthy();
  });

  it("shares the descriptive and conclusion slots with the palette tiles", () => {
    const pattern = ALL_VASCULAR_TILES.find((t) => t.id === "neck-dissection-pattern")!;
    const diagnosis = ALL_VASCULAR_TILES.find((t) => t.id === "neck-dissection-diagnosis")!;
    const row = carotidDissectionAtoms(dissection({ dissectionSelected: true }), {
      technique: VESSEL_WALL,
      brain: BRAIN,
    });
    expect(pattern.atoms[0]!.concept).toBe(row.atoms[0]!.concept);
    expect(diagnosis.atoms[0]!.concept).toBe(row.atoms[1]!.concept);
  });

  it("refuses an empty record and an unresolvable vessel", () => {
    expect(carotidDissectionAtoms({ vessel: "left cervical ICA" }, {
      technique: VESSEL_WALL,
      brain: BRAIN,
    }).errors).toEqual(["no dissection findings entered"]);
    expect(carotidDissectionAtoms({ vessel: "the aortic arch" }, CTX).errors?.[0])
      .toMatch(/does not name a single vessel/);
  });

  it("moves the ledger and comes back off it", () => {
    const row = carotidDissectionAtoms(dissection({ dissectionSelected: true }), {
      technique: VESSEL_WALL,
      brain: BRAIN,
    });
    useWorkspace.getState().applyMacroBundle({
      bundleId: row.bundleId,
      observations: brainAtomsToPatches("Brain", row.bundleId, row.atoms),
    });
    expect(useWorkspace.getState().findingsText).toContain("intramural hematoma");
    expect(useWorkspace.getState().removeMacroBundle(row.bundleId)).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toContain("intramural hematoma");
  });
});
