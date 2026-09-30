/**
 * mriBrainVesselObservations.test.ts — the row a radiologist clicks is what the
 * technique can carry (mra/mrv spec §5, §7, §10, §12, §17).
 *
 * The failures this guards against are the clinically loud ones: a TOF signal gap
 * printed as an occlusion, a sinus flow gap printed as thrombosis, one vessel holding
 * two contradictory statuses, and a normal variant cancelling the pathology recorded
 * on the same artery. Each is asserted from both directions — the descriptive row
 * stays recordable, the conclusion row is refused until the acquisition supports it.
 */

import { describe, expect, it } from "vitest";

import { isImpressionworthyAbnormal } from "@/lib/conceptCanon/contentPacks";
import {
  ARTERIAL_VESSEL_STATUSES,
  VENOUS_VESSEL_STATUSES,
  patentSentenceFor,
  statusesForSystem,
  systemForTerritory,
  vesselFindingsSection,
  vesselObservationAtoms,
  vesselRowsForTerritory,
  vesselStatusByKey,
  vesselStatusGate,
  vesselStatusText,
  type VesselStatusKey,
} from "@/lib/mriBrainVesselObservations";
import { VESSEL_DEFINITIONS, vesselByKey } from "@/lib/mriBrainVessels";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";

const BRAIN = parseBrainSequences("MRI Brain: T1, T2, FLAIR, DWI with ADC, SWI");
const withTech = (keys: Parameters<typeof defaultVascularTechnique>[0] = {}) => {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
};
const TOF_ONLY = withTech({ mraTof: true, mrvTof: true });
const LUMEN_BEARING = withTech({ mraTof: true, mraCe: true, sourceImages: true, mrvCe: true });

describe("mriBrainVesselObservations — the status lists are the specification's", () => {
  it("covers every §5 arterial status", () => {
    const keys = ARTERIAL_VESSEL_STATUSES.map((s) => s.key.replace(/^a:/, ""));
    expect(keys).toEqual([
      "patent",
      "caliberAsymmetry",
      "focalNarrowing",
      "multifocalNarrowing",
      "flowRelatedSignalLoss",
      "nonVisualization",
      "suspectedOcclusion",
      "confirmedOcclusion",
      "ectasia",
      "aneurysmalOutpouching",
      "variant",
      "other",
    ]);
  });

  it("covers every §12 venous status", () => {
    const keys = VENOUS_VESSEL_STATUSES.map((s) => s.key.replace(/^v:/, ""));
    expect(keys).toEqual([
      "patent",
      "reducedFlowSignal",
      "flowGap",
      "fillingDefect",
      "thrombusSignal",
      "partialThrombosis",
      "occlusiveThrombosis",
      "recanalization",
      "collateralVeins",
      "developmentalHypoplasia",
      "other",
    ]);
  });

  it("splits the two systems cleanly and knows which territory each belongs to", () => {
    expect(statusesForSystem("arterial")).toBe(ARTERIAL_VESSEL_STATUSES);
    expect(statusesForSystem("venous")).toBe(VENOUS_VESSEL_STATUSES);
    expect(systemForTerritory("venous")).toBe("venous");
    expect(systemForTerritory("neckArterial")).toBe("arterial");
    expect(vesselStatusByKey("a:patent")?.familyConcept).not.toBe(vesselStatusByKey("v:patent")?.familyConcept);
  });

  it("never puts a numeric grade in a status sentence", () => {
    // A percentage is a measured statement with provenance, never a chip (§7, §11).
    for (const status of [...ARTERIAL_VESSEL_STATUSES, ...VENOUS_VESSEL_STATUSES]) {
      expect(status.finding, status.key).not.toMatch(/\d+\s*%/);
      expect(status.impression ?? "", status.key).not.toMatch(/\d+\s*%/);
    }
  });
});

describe("mriBrainVesselObservations — flow findings are not conclusions", () => {
  it("keeps occlusion wording out of the arterial flow rows", () => {
    for (const key of ["a:flowRelatedSignalLoss", "a:nonVisualization", "a:focalNarrowing"] as VesselStatusKey[]) {
      const status = vesselStatusByKey(key)!;
      const lower = status.finding.toLowerCase();
      expect(lower, key).not.toContain("occlu");
      expect(lower, key).not.toContain("infarct");
    }
  });

  it("keeps thrombosis wording out of the venous flow rows", () => {
    for (const key of ["v:reducedFlowSignal", "v:flowGap"] as VesselStatusKey[]) {
      const status = vesselStatusByKey(key)!;
      expect(status.finding.toLowerCase(), key).not.toContain("thromb");
    }
    expect(vesselStatusByKey("v:flowGap")?.familyConcept).toBe("mrv_venous");
    expect(vesselStatusByKey("v:occlusiveThrombosis")?.familyConcept).toBe("cvst");
  });

  it("marks only the conclusion rows as interpretations", () => {
    const interpretations = [...ARTERIAL_VESSEL_STATUSES, ...VENOUS_VESSEL_STATUSES]
      .filter((s) => s.interpretation)
      .map((s) => s.key);
    expect(interpretations).toEqual([
      "a:suspectedOcclusion",
      "a:confirmedOcclusion",
      "v:partialThrombosis",
      "v:occlusiveThrombosis",
    ]);
  });

  it("refuses a confirmed occlusion when the acquisition carries no lumen", () => {
    const blocked = vesselObservationAtoms({
      vessel: "right ICA terminus",
      status: "a:confirmedOcclusion",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(blocked.atoms).toEqual([]);
    expect(blocked.blocked?.notice).toMatch(/non-visualisation on TOF/i);

    const allowed = vesselObservationAtoms({
      vessel: "right ICA terminus",
      status: "a:confirmedOcclusion",
      territory: "intracranialArterial",
      technique: LUMEN_BEARING,
      brain: BRAIN,
    });
    expect(allowed.atoms).toHaveLength(1);
    expect(allowed.atoms[0]!.findings).toBe("Occlusion of the right ICA terminus.");
    expect(allowed.atoms[0]!.impression).toBe("Occlusion of the right ICA terminus.");
  });

  it("still records the honest descriptive row on TOF alone", () => {
    const row = vesselObservationAtoms({
      vessel: "right ICA terminus",
      status: "a:nonVisualization",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(row.atoms).toHaveLength(1);
    expect(row.atoms[0]!.findings).toContain("is not visualized on the angiographic acquisition");
    expect(row.atoms[0]!.impression).toBeUndefined();
  });

  it("refuses any arterial row when no arterial acquisition exists at all", () => {
    const row = vesselObservationAtoms({
      vessel: "basilar artery",
      status: "a:patent",
      territory: "intracranialArterial",
      technique: defaultVascularTechnique(),
      brain: BRAIN,
    });
    expect(row.atoms).toEqual([]);
    expect(row.blocked?.notice).toMatch(/no intracranial arterial acquisition/i);
    expect(vesselStatusGate(vesselStatusByKey("a:patent")!, defaultVascularTechnique(), BRAIN)?.allowed)
      .toBe(false);
  });

  it("needs a contrast or phase study for a filling defect, not a flow gap", () => {
    const gap = vesselObservationAtoms({
      vessel: "left transverse sinus",
      status: "v:flowGap",
      territory: "venous",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(gap.atoms).toHaveLength(1);
    const defect = vesselObservationAtoms({
      vessel: "left transverse sinus",
      status: "v:fillingDefect",
      territory: "venous",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(defect.blocked?.notice).toMatch(/filling defect is a contrast/i);
    const defectOnCe = vesselObservationAtoms({
      vessel: "left transverse sinus",
      status: "v:fillingDefect",
      territory: "venous",
      technique: LUMEN_BEARING,
      brain: BRAIN,
    });
    expect(defectOnCe.atoms[0]!.findings).toBe("Focal filling defect within the left transverse sinus.");
  });
});

describe("mriBrainVesselObservations — acuity is a separate gated claim", () => {
  it("refuses 'acute' without the supporting brain sequences", () => {
    const noDwi = parseBrainSequences("MRI Brain: T1, T2, FLAIR, SWI");
    const blocked = vesselObservationAtoms({
      vessel: "left MCA M1",
      status: "a:confirmedOcclusion",
      territory: "intracranialArterial",
      acute: true,
      technique: LUMEN_BEARING,
      brain: noDwi,
    });
    expect(blocked.atoms).toEqual([]);
    expect(blocked.blocked?.notice).toMatch(/acuity is never assigned/i);

    const allowed = vesselObservationAtoms({
      vessel: "left MCA M1",
      status: "a:confirmedOcclusion",
      territory: "intracranialArterial",
      acute: true,
      technique: LUMEN_BEARING,
      brain: BRAIN,
    });
    expect(allowed.atoms[0]!.findings).toBe("Acute occlusion of the left MCA M1.");
    expect(allowed.atoms[0]!.impression).toBe("Acute occlusion of the left MCA M1.");
  });

  it("refuses an acuity selection on a row that carries no acuity wording", () => {
    const row = vesselObservationAtoms({
      vessel: "basilar artery",
      status: "a:ectasia",
      territory: "intracranialArterial",
      acute: true,
      technique: LUMEN_BEARING,
      brain: BRAIN,
    });
    expect(row.atoms).toEqual([]);
    expect(row.error).toMatch(/carries no acuity wording/);
  });

  it("gates the venous stage apart from the thrombosis finding", () => {
    const plain = vesselObservationAtoms({
      vessel: "superior sagittal sinus",
      status: "v:occlusiveThrombosis",
      territory: "venous",
      technique: LUMEN_BEARING,
      brain: BRAIN,
    });
    expect(plain.atoms[0]!.findings).toBe("Occlusive thrombus within the superior sagittal sinus.");
    expect(plain.atoms[0]!.severity).toBe("critical");
    const staged = vesselObservationAtoms({
      vessel: "superior sagittal sinus",
      status: "v:occlusiveThrombosis",
      territory: "venous",
      acute: true,
      // Stage wording needs the source sequences that actually show clot signal.
      technique: LUMEN_BEARING,
      brain: parseBrainSequences("MRI Brain: T1, T2, FLAIR, DWI with ADC"),
    });
    expect(staged.atoms[0]!.findings).toBe(
      "Acute occlusive thrombus within the superior sagittal sinus.",
    );
    const unstaged = vesselObservationAtoms({
      vessel: "superior sagittal sinus",
      status: "v:occlusiveThrombosis",
      territory: "venous",
      technique: LUMEN_BEARING,
      brain: parseBrainSequences("MRI Brain: T1, T2, FLAIR, DWI with ADC"),
    });
    expect(unstaged.atoms[0]!.findings).not.toMatch(/^acute/i);
  });
});

describe("mriBrainVesselObservations — one vessel, one status, one slot", () => {
  it("puts every status of one vessel in one slot, and never two vessels in one slot", () => {
    const patent = vesselObservationAtoms({
      vessel: "right MCA M1",
      status: "a:patent",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    const occluded = vesselObservationAtoms({
      vessel: "right MCA M1",
      status: "a:confirmedOcclusion",
      territory: "intracranialArterial",
      technique: LUMEN_BEARING,
      brain: BRAIN,
    });
    const leftM1 = vesselObservationAtoms({
      vessel: "left MCA M1",
      status: "a:patent",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    const m2 = vesselObservationAtoms({
      vessel: "right MCA M2",
      status: "a:patent",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(occluded.atoms[0]!.concept).toBe(patent.atoms[0]!.concept);
    expect(occluded.atoms[0]!.laterality).toBe(patent.atoms[0]!.laterality);
    expect(occluded.atoms[0]!.conflictGroup).toBe(patent.atoms[0]!.conflictGroup);
    // The identity that survives the ledger is the concept: `level` is a spine
    // vocabulary and is discarded for vessels, so two arteries must not share one.
    expect(patent.atoms[0]!.concept).toBe("mra_vessel_mca_m1");
    expect(leftM1.atoms[0]!.concept).toBe("mra_vessel_mca_m1");
    expect(leftM1.atoms[0]!.laterality).toBe("left");
    expect(m2.atoms[0]!.concept).toBe("mra_vessel_mca_m2");
    expect(m2.atoms[0]!.concept).not.toBe(patent.atoms[0]!.concept);
  });

  it("supersedes the vessel's own normal sentence, not the study-wide MRA normal", () => {
    const row = vesselObservationAtoms({
      vessel: "right MCA M1",
      status: "a:focalNarrowing",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(row.atoms[0]!.baselineReplaces).toBe(patentSentenceFor(vesselByKey("mca-m1-right")!));
    expect(row.atoms[0]!.baselineReplaces).not.toContain("MRA");
    expect(row.atoms[0]!.role).toBe("finding");
    const normal = vesselObservationAtoms({
      vessel: "right MCA M1",
      status: "a:patent",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(normal.atoms[0]!.role).toBe("baseline");
    expect(normal.atoms[0]!.baselineReplaces).toBeUndefined();
  });

  it("is idempotent per vessel and status, distinct per bundle", () => {
    const first = vesselObservationAtoms({
      vessel: "basilar artery",
      status: "a:ectasia",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    const again = vesselObservationAtoms({
      vessel: "basilar artery",
      status: "a:ectasia",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(again.bundleId).toBe(first.bundleId);
    const other = vesselObservationAtoms({
      vessel: "basilar artery",
      status: "a:caliberAsymmetry",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(other.bundleId).not.toBe(first.bundleId);
  });

  it("keeps a normal variant in its own slot so it cannot cancel pathology", () => {
    const variant = vesselObservationAtoms({
      vessel: "right A1",
      status: "a:variant",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    const stenosed = vesselObservationAtoms({
      vessel: "right A1",
      status: "a:focalNarrowing",
      territory: "intracranialArterial",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(variant.atoms[0]!.concept).toBe("mra_vessel_aca_a1_variant");
    expect(stenosed.atoms[0]!.concept).toBe("mra_vessel_aca_a1");
    expect(variant.atoms[0]!.conflictGroup).toBe("aca-a1-right-variant");
    // Variants are non-pathologic: they must not be pushed into the Impression as an
    // abnormality by the system-normal guard.
    expect(isImpressionworthyAbnormal("mra_variant")).toBe(false);
    expect(isImpressionworthyAbnormal("mrv_variant")).toBe(false);
    expect(isImpressionworthyAbnormal("mra_arterial")).toBe(true);
  });

  it("refuses a venous status on an artery and an unidentifiable vessel", () => {
    expect(
      vesselObservationAtoms({
        vessel: "basilar artery",
        status: "v:flowGap",
        territory: "intracranialArterial",
        technique: LUMEN_BEARING,
        brain: BRAIN,
      }).error,
    ).toMatch(/is a venous status/);
    expect(
      vesselObservationAtoms({
        vessel: "vertebral artery",
        status: "a:patent",
        technique: TOF_ONLY,
        brain: BRAIN,
      }).error,
    ).toMatch(/vessel not identified/);
    expect(
      vesselObservationAtoms({
        vessel: "vertebral artery",
        status: "a:patent",
        territory: "neckArterial",
        side: "left",
        technique: TOF_ONLY,
        brain: BRAIN,
      }).atoms[0]!.level,
    ).toBe("VERTEBRAL-CERVICAL-LEFT");
  });

  it("leaves an unpaired vessel without a laterality", () => {
    const row = vesselObservationAtoms({
      vessel: "superior sagittal sinus",
      status: "v:patent",
      territory: "venous",
      technique: TOF_ONLY,
      brain: BRAIN,
    });
    expect(row.atoms[0]!.laterality).toBeUndefined();
    expect(row.atoms[0]!.supportsLaterality).toBe(false);
  });
});

describe("mriBrainVesselObservations — the rows land in the §17 subsections", () => {
  it("maps each vessel system to its Findings subsection", () => {
    const label = (key: string) => vesselFindingsSection(VESSEL_DEFINITIONS.find((d) => d.key === key)!);
    expect(label("mca-m1-right")).toBe("Anterior circulation");
    expect(label("basilar")).toBe("Posterior circulation");
    expect(label("ica-cervical-right")).toBe("Right carotid system");
    expect(label("ica-cervical-left")).toBe("Left carotid system");
    expect(label("vertebral-origin-right")).toBe("Vertebral arteries");
    expect(label("sss")).toBe("Dural venous sinuses");
    expect(label("vein-of-galen")).toBe("Deep venous system");
    expect(label("ijv-proximal-right")).toBe("Other veins");
  });

  it("orders the tree with real vessels before variant-only slots", () => {
    const rows = vesselRowsForTerritory("intracranialArterial").map((d) => d.key);
    expect(rows.indexOf("basilar")).toBeLessThan(rows.indexOf("mca-m1-right"));
    expect(rows.indexOf("fetal-pca-right")).toBeGreaterThan(rows.indexOf("basilar"));
    const lastVariant = rows.lastIndexOf("a1-hypoplasia-left");
    const firstPathology = rows.findIndex((k) => !VESSEL_DEFINITIONS.find((d) => d.key === k)!.variantOnly);
    expect(lastVariant).toBeGreaterThan(firstPathology);
    expect(vesselRowsForTerritory("venous").length).toBeGreaterThan(12);
  });

  it("names each vessel with its side inside the sentence", () => {
    expect(
      vesselStatusText(vesselStatusByKey("a:patent")!, vesselByKey("mca-m1-right")!).findings,
    ).toBe("The right MCA M1 is patent with normal course and caliber.");
    expect(
      vesselStatusText(vesselStatusByKey("a:patent")!, vesselByKey("basilar")!).findings,
    ).toBe("The basilar artery is patent with normal course and caliber.");
  });
});
