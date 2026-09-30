/**
 * mriBrainVascularValidation.ts — §19's contradiction and support checks, read against
 * the vessel registry rather than the whole report.
 *
 * The important assertion in this file is the one that produces NO warning: a report that
 * calls the right MCA patent and the left MCA occluded is not self-contradictory, and a
 * validator that cannot tell those two arteries apart would spend the radiologist's
 * attention on noise. Everything else here is the positive half of §19 — the pairs that
 * must be caught, the wording an unrecorded acquisition cannot carry, and the calculated
 * value that stopped agreeing with the numbers it came from.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { vesselByKey } from "@/lib/mriBrainVessels";
import {
  patentSentenceFor,
  vesselStatusByKey,
  vesselStatusText,
} from "@/lib/mriBrainVesselObservations";
import {
  aneurysmFindingsSentence,
  moyamoyaFindingsSentence,
  type AneurysmRecord,
} from "@/lib/mriBrainVascularLesions";
import {
  stenosisFindingsSentence,
  type MeasuredStenosisRecord,
} from "@/lib/mriBrainVascularStenosis";
import { screeningChecklistRows } from "@/lib/mriBrainVascularScreening";
import { ALL_VASCULAR_TILES } from "@/lib/mriBrainVascularSubMasters";
import {
  BRAIN_VASCULAR_CONTRADICTION_RULES,
  brainVascularContradictions,
  vascularDescriptorNumberDisagreements,
  vascularIsScreeningOnly,
  vascularMeasurementInconsistencies,
  vascularScreeningOverreach,
  vascularTextContradictions,
  vascularUnattributedNumbers,
  vascularUnsupportedStatementWarnings,
} from "@/lib/mriBrainVascularValidation";
import {
  defaultVascularTechnique,
  type VascularTechniqueState,
} from "@/lib/mriBrainVascularTechnique";
import { VASCULAR_LIBRARY_PROSE } from "@/lib/mriBrainVascularProse";

const BRAIN = parseBrainSequences("MRI brain: T1, T2, FLAIR, DWI with ADC, GRE/SWI");

function tech(keys: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
}

const NONE = tech();
const TOF = tech({ mraTof: true, sourceImages: true });
const MRV = tech({ mrvTof: true, mrvPhaseContrast: true });

/** The sentence the vessel panel produces for one vessel in one status. */
function statusSentence(statusKey: string, vesselKey: string): string {
  const vessel = vesselByKey(vesselKey)!;
  const status = vesselStatusByKey(statusKey)!;
  return vesselStatusText(status, vessel).findings;
}

const rightMca = () => statusSentence("a:patent", "mca-m1-right");
const leftMcaOccluded = () => statusSentence("a:confirmedOcclusion", "mca-m1-left");
const rightTransversePatent = () => statusSentence("v:patent", "transverse-sinus-right");
const rightTransverseOccluded = () =>
  statusSentence("v:occlusiveThrombosis", "transverse-sinus-right");

const findings = (...sentences: string[]) => sentences.join(" ");

const aneurysm = (over: Partial<AneurysmRecord> = {}): AneurysmRecord => ({
  parentVessel: "ACom",
  morphology: "saccular",
  domeHeightMm: 8,
  neckWidthMm: 4,
  ...over,
});

const stenosis = (over: Partial<MeasuredStenosisRecord> = {}): MeasuredStenosisRecord => ({
  vessel: "left carotid bulb",
  territory: "neckArterial",
  formula: "nascet",
  minResidualLumenMm: 1.25,
  referenceLumenMm: 5,
  provenance: { source: "viewer-caliper", annotationIds: ["svm_a1"] },
  ...over,
});

beforeEach(() => {
  // A report is only ever as contradictory as its own sentences; the prose used here is
  // the prose the panels emit, so a wording change fails these tests rather than drifting.
  expect(rightMca()).toMatch(/patent/i);
});

// ─── §19 the same-vessel rule ────────────────────────────────────────────

describe("§19 — a contradiction is about one vessel", () => {
  it("stays silent when a different vessel carries the abnormality", () => {
    expect(
      vascularTextContradictions({
        findingsText: findings(rightMca(), leftMcaOccluded()),
      }),
    ).toEqual([]);
  });

  it("stays silent across territories, where one sinus is thrombosed and one artery is patent", () => {
    expect(
      vascularTextContradictions({
        findingsText: findings(rightMca(), rightTransverseOccluded()),
      }),
    ).toEqual([]);
  });

  it("warns when the same artery is patent and occluded, and says which artery", () => {
    const warnings = vascularTextContradictions({
      findingsText: findings(rightMca(), statusSentence("a:confirmedOcclusion", "mca-m1-right")),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/patent and occluded/i);
    expect(warnings[0]).toMatch(/right MCA M1/);
  });

  it("warns when a normal-calibre artery is also severely stenosed", () => {
    const warnings = vascularTextContradictions({
      findingsText: findings(
        rightMca(),
        "There is severe stenosis at the left MCA M2 segment.",
      ),
    });
    expect(warnings).toEqual([]);
    const same = vascularTextContradictions({
      findingsText: findings(
        "The left MCA M2 is patent with normal course and caliber.",
        "There is severe stenosis at the left MCA M2 segment.",
      ),
    });
    expect(same[0]).toMatch(/normal-calibre and severely stenosed/i);
  });

  it("warns when the same sinus is patent and occlusively thrombosed, once only", () => {
    const warnings = vascularTextContradictions({
      findingsText: findings(rightTransversePatent(), rightTransverseOccluded()),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/patent and occlusively thrombosed/i);
    expect(warnings[0]).toMatch(/right transverse sinus/i);
  });

  it("warns when a vessel-free normal covers the whole family and one artery is occluded", () => {
    const warnings = vascularTextContradictions({
      findingsText: findings(
        VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
        leftMcaOccluded(),
      ),
    });
    expect(warnings.some((w) => /patent and occluded/i.test(w))).toBe(true);
    expect(warnings.join(" ")).toMatch(/left MCA M1/);
  });

  it("treats non-visualization and absent flow signal as occlusion wording", () => {
    expect(
      vascularTextContradictions({
        findingsText: findings(
          "The basilar artery is patent with normal course and caliber.",
          "The basilar artery is not visualized on the angiographic acquisition.",
        ),
      }),
    ).toHaveLength(1);
  });
});

// ─── §19 aneurysm, haemorrhage, sinus caliber ────────────────────────────

describe("§19 — the remaining listed pairs", () => {
  it("catches a denied aneurysm alongside a described one", () => {
    const described = aneurysmFindingsSentence(aneurysm(), vesselByKey("acom")!.label);
    expect(
      vascularTextContradictions({
        findingsText: findings("No intracranial aneurysm is identified.", described),
      })[0],
    ).toMatch(/denies an aneurysm/i);
    expect(
      vascularTextContradictions({ findingsText: findings("No intracranial aneurysm is identified.") }),
    ).toEqual([]);
  });

  it("does not read an aneurysm description into its own denial", () => {
    expect(
      vascularTextContradictions({
        findingsText: findings(
          "No aneurysm is seen.",
          "There is no evidence of an aneurysmal outpouching.",
        ),
      }),
    ).toEqual([]);
  });

  it("catches a denied haemorrhage alongside a described one", () => {
    expect(
      vascularTextContradictions({
        findingsText: findings(
          "No acute intracranial haemorrhage is seen.",
          "There is associated haemorrhage with mass effect.",
        ),
      })[0],
    ).toMatch(/denies haemorrhage/i);
  });

  it("catches a normal-calibre sinus alongside hypoplasia of that sinus", () => {
    const warnings = vascularTextContradictions({
      findingsText: findings(
        "The right transverse sinus is of normal caliber.",
        statusSentence("v:developmentalHypoplasia", "transverse-sinus-right"),
      ),
    });
    expect(warnings[0]).toMatch(/normal-calibre and hypoplastic/i);
    expect(warnings[0]).toMatch(/right transverse sinus/i);
  });

  it("leaves a patent-but-small sinus alone, which is the developmental variant", () => {
    expect(
      vascularTextContradictions({
        findingsText: findings(
          rightTransversePatent(),
          statusSentence("v:developmentalHypoplasia", "transverse-sinus-right"),
        ),
      }),
    ).toEqual([]);
  });

  it("maps every rule to one of §19's listed bullets", () => {
    expect(BRAIN_VASCULAR_CONTRADICTION_RULES.map((r) => r.id)).toEqual([
      "vessel_normal_vs_occluded",
      "vessel_normal_vs_severe_stenosis",
      "aneurysm_denied_vs_described",
      "venous_normal_vs_thrombosis",
      "sinus_patent_vs_occlusive_thrombus",
      "sinus_normal_caliber_vs_hypoplasia",
      "hemorrhage_denied_vs_described",
    ]);
  });
});

// ─── §19 / §4 wording the acquisition cannot carry ───────────────────────

describe("§19 — statements against the recorded acquisition", () => {
  const unsupported = (text: string, state: VascularTechniqueState | null) =>
    vascularUnsupportedStatementWarnings({
      findingsText: text,
      technique: state,
      brain: BRAIN,
    });

  it("says so when an acute occlusion is stated without a lumen-bearing acquisition", () => {
    expect(unsupported("Acute arterial occlusion of the right MCA M1.", tech({ mraTof: true }))[0]).toMatch(
      /acute arterial occlusion/i,
    );
    expect(unsupported("Acute arterial occlusion of the right MCA M1.", TOF)).toEqual([]);
  });

  it("says so when a percentage is stated with nothing to measure on", () => {
    const text = "There is 70% stenosis of the right intracranial ICA.";
    expect(unsupported(text, tech({ mraTof: true }))[0]).toMatch(/numeric intracranial stenosis/i);
    expect(unsupported(text, TOF)).toEqual([]);
  });

  it("names the acquisition that is missing rather than the finding", () => {
    const warnings = unsupported(
      "There is an intramural haematoma of the cervical ICA.",
      TOF,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/vessel-wall \/ black-blood MRA/i);
    expect(warnings[0]).toMatch(/not recorded/i);
  });

  it("carries the early-drainage claim only with a time-resolved acquisition", () => {
    expect(
      unsupported("There is early venous drainage into the vein of Galen.", MRV).length,
    ).toBeGreaterThan(0);
    expect(
      unsupported(
        "There is early venous drainage into the vein of Galen.",
        tech({ mrvTof: true, timeResolved: true }),
      ),
    ).toEqual([]);
  });
});

// ─── §19 calculated values ───────────────────────────────────────────────

describe("§19 — a calculated value must follow from its inputs", () => {
  it("accepts the ratio the aneurysm sentence derived", () => {
    const text = aneurysmFindingsSentence(aneurysm(), vesselByKey("acom")!.label);
    expect(text).toMatch(/dome-to-neck ratio 2/);
    expect(vascularMeasurementInconsistencies({ findingsText: text })).toEqual([]);
  });

  it("catches a hand-edited ratio, in either prose form the app uses", () => {
    const vascular = aneurysmFindingsSentence(aneurysm(), vesselByKey("acom")!.label)
      .replace("ratio 2", "ratio 5");
    expect(vascularMeasurementInconsistencies({ findingsText: vascular })[0]).toMatch(
      /ratio of 5 does not follow/i,
    );
    const measures =
      "Saccular cerebral aneurysm at the ACom region measuring 8 mm dome × 4 mm neck (dome/neck aspect ratio 3).";
    expect(vascularMeasurementInconsistencies({ findingsText: measures })[0]).toMatch(
      /give 2/i,
    );
  });

  it("leaves a sentence that states one number alone", () => {
    expect(
      vascularMeasurementInconsistencies({
        findingsText: "The dome height measures 8 mm.",
      }),
    ).toEqual([]);
  });

  it("reports a descriptor that contradicts its own percentage", () => {
    const text = stenosisFindingsSentence(
      { ...stenosis(), percent: 20, manualOverride: true, formula: "entered", descriptor: "severe" },
      "left carotid bulb",
    );
    expect(
      vascularDescriptorNumberDisagreements({ findingsText: text })[0],
    ).toMatch(/does not match the measured 20% \(mild at that figure\)/i);
  });

  it("accepts a descriptor that matches the measured figure", () => {
    const text = stenosisFindingsSentence(
      { ...stenosis(), descriptor: "severe" },
      "left carotid bulb",
    );
    expect(vascularDescriptorNumberDisagreements({ findingsText: text })).toEqual([]);
  });
});

// ─── §11 / §19 provenance ────────────────────────────────────────────────

describe("§19 — a numeric stenosis must say where it came from", () => {
  it("stays quiet while the calculated row carries its own measurement source", () => {
    const text = stenosisFindingsSentence(stenosis(), "left carotid bulb");
    expect(text).toMatch(/Measurement source:/i);
    expect(vascularUnattributedNumbers({ findingsText: text })).toEqual([]);
  });

  it("says so when the row itself records no provenance", () => {
    const text = stenosisFindingsSentence(stenosis({ provenance: undefined }), "left carotid bulb");
    expect(
      vascularUnattributedNumbers({ findingsText: text })[0],
    ).toMatch(/no measurement provenance/i);
  });

  it("says so when a percentage was typed in without one", () => {
    expect(
      vascularUnattributedNumbers({
        findingsText: "There is a 70% stenosis of the right ICA cervical segment.",
      })[0],
    ).toMatch(/without the acquisition or caliper/i);
  });

  it("does not treat a percentage of territory as a measured stenosis", () => {
    expect(
      vascularUnattributedNumbers({
        findingsText: "The infarct involves about 30% of the MCA territory.",
      }),
    ).toEqual([]);
  });
});

// ─── §14 / §19 screening scope ───────────────────────────────────────────

describe("§19 — a screening pass stays inside screening", () => {
  const dedicated =
    "Segment-by-segment assessment shows a 70% NASCET stenosis with a dome-to-neck ratio of 2 and a nidus.";

  it("names the dedicated claim a screening-only report cannot carry", () => {
    const warnings = vascularScreeningOverreach({
      findingsText: dedicated,
      screeningOnly: true,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/basic intracranial MRA screening only/i);
    expect(warnings[0]).toMatch(/NASCET/);
  });

  it("stays silent once a dedicated acquisition is being reported", () => {
    expect(
      vascularScreeningOverreach({ findingsText: dedicated, screeningOnly: false }),
    ).toEqual([]);
  });

  it("derives screening-only from the two concept vocabularies that own them", () => {
    const screeningConcepts = [
      ...screeningChecklistRows().map((row) => row.concept),
      "mra_screening",
      "mra_screening_limitation",
    ];
    expect(vascularIsScreeningOnly(screeningConcepts)).toBe(true);
    const tileConcepts = ALL_VASCULAR_TILES.flatMap((tile) =>
      tile.atoms.map((atom) => atom.concept),
    );
    expect(vascularIsScreeningOnly([...screeningConcepts, ...tileConcepts])).toBe(false);
    expect(vascularIsScreeningOnly(tileConcepts)).toBe(false);
    expect(vascularIsScreeningOnly(["adenoid", "canal_stenosis"])).toBe(false);
    expect(vascularIsScreeningOnly([])).toBe(false);
  });
});

// ─── the one call the workspace makes ────────────────────────────────────

describe("brainVascularContradictions — one banner, warnings only", () => {
  it("collects the contradiction, the unsupported wording and the broken arithmetic", () => {
    const warnings = brainVascularContradictions({
      findingsText: [
        findings(rightMca(), statusSentence("a:confirmedOcclusion", "mca-m1-right")),
        "There is early venous drainage into the vein of Galen.",
        aneurysmFindingsSentence(aneurysm(), vesselByKey("acom")!.label).replace(
          "ratio 2",
          "ratio 9",
        ),
      ].join("\n"),
      technique: TOF,
      brain: BRAIN,
    });
    expect(warnings.some((w) => /Vascular contradiction/.test(w))).toBe(true);
    expect(warnings.some((w) => /Vascular support/.test(w))).toBe(true);
    expect(warnings.some((w) => /Vascular measurement/.test(w))).toBe(true);
    for (const warning of warnings) expect(typeof warning).toBe("string");
  });

  it("accepts a report that is internally consistent", () => {
    expect(
      brainVascularContradictions({
        findingsText: [
          findings(rightMca(), leftMcaOccluded()),
          stenosisFindingsSentence({ ...stenosis(), descriptor: "severe" }, "left carotid bulb"),
        ].join("\n"),
        impressionText: "Occlusion of the left MCA M1.",
        technique: TOF,
        brain: BRAIN,
      }),
    ).toEqual([]);
  });

  it("never needs a technique state to answer", () => {
    expect(() =>
      brainVascularContradictions({
        findingsText: moyamoyaFindingsSentence({
          rightInternalCarotidTerminus: "stenosed",
          leftInternalCarotidTerminus: "stenosed",
        } as never),
        brain: BRAIN,
      }),
    ).not.toThrow();
  });

  it("reports the library normal sentence for an all-normal tree as consistent", () => {
    expect(
      brainVascularContradictions({
        findingsText: findings(
          VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
          VASCULAR_LIBRARY_PROSE.mrvNormal,
        ),
        technique: tech({ mraTof: true, mrvTof: true }),
        brain: BRAIN,
      }),
    ).toEqual([]);
  });
});
