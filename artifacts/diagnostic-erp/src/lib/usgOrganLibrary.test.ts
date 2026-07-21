import { describe, it, expect } from "vitest";
import { generateUsgFinding } from "./usgFindingBuilder";
import {
  findingDefById,
  findingDefsForOrgan,
  organsForStudy,
  PROSTATE_ENLARGEMENT_ML,
} from "./usgOrganLibrary";

const renalDef = findingDefById("renal_calculus")!;
const gbDef = findingDefById("gb_cholelithiasis")!;
const prostateDef = findingDefById("prostatomegaly")!;

function renal(values: Record<string, string>) {
  return generateUsgFinding(renalDef, values).object;
}
function gb(values: Record<string, string>) {
  return generateUsgFinding(gbDef, values).object;
}
function prostate(values: Record<string, string>) {
  return generateUsgFinding(prostateDef, values).object;
}

describe("organ gating by sex and preset", () => {
  it("male whole-abdomen shows prostate, hides uterus/ovaries", () => {
    const keys = organsForStudy({ sex: "M", preset: "whole_abdomen" }).map((o) => o.key);
    expect(keys).toContain("prostate");
    expect(keys).not.toContain("uterus");
    expect(keys).not.toContain("right_ovary");
  });
  it("female whole-abdomen shows uterus/ovaries, hides prostate", () => {
    const keys = organsForStudy({ sex: "F", preset: "whole_abdomen" }).map((o) => o.key);
    expect(keys).toContain("uterus");
    expect(keys).toContain("right_ovary");
    expect(keys).not.toContain("prostate");
  });
  it("KUB preset is limited to kidneys, bladder, prostate(male)", () => {
    const keys = organsForStudy({ sex: "M", preset: "kub" }).map((o) => o.key);
    expect(keys).toEqual(["right_kidney", "left_kidney", "urinary_bladder", "prostate"]);
  });
  it("kidney organs resolve the renal-calculus finding", () => {
    expect(findingDefsForOrgan("right_kidney").map((d) => d.id)).toEqual(["renal_calculus"]);
    expect(findingDefsForOrgan("gallbladder").map((d) => d.id)).toEqual(["gb_cholelithiasis"]);
  });
});

describe("Reference finding 1 — right renal calculus", () => {
  it("reproduces the specified finding + impression", () => {
    const o = renal({
      side: "Right", location: "Middle calyx", number: "Single", size: "5.5",
      shadowing: "Present", twinkle: "Not assessed", hydronephrosis: "None", ureter: "None",
    });
    expect(o.findingText).toBe(
      "A single echogenic calculus measuring 5.5 mm is seen in the middle calyx of the right kidney, showing posterior acoustic shadowing. No hydronephrosis is noted.",
    );
    expect(o.impressionText).toBe("Right nephrolithiasis without hydronephrosis.");
    expect(o.laterality).toBe("Right");
  });

  it("single vs multiple wording never disagrees with itself", () => {
    const single = renal({ side: "Left", location: "Lower calyx", number: "Single", size: "4", hydronephrosis: "None" });
    expect(single.findingText).toContain("A single echogenic calculus");
    expect(single.findingText).toContain(" is seen");
    expect(single.findingText).not.toMatch(/calculi/);

    const multiple = renal({ side: "Left", location: "Lower calyx", number: "Multiple", size: "4", hydronephrosis: "None" });
    expect(multiple.findingText).toContain("Multiple echogenic calculi");
    expect(multiple.findingText).toContain(" are seen");
    expect(multiple.findingText).not.toMatch(/A single/);
  });

  it("states hydronephrosis grade in finding and impression when present", () => {
    const o = renal({ side: "Right", location: "Renal pelvis", number: "Single", size: "8", shadowing: "Absent", hydronephrosis: "Mild", ureter: "Present" });
    expect(o.findingText).toContain("There is mild hydronephrosis.");
    expect(o.findingText).toContain("There is associated ureteric dilatation.");
    expect(o.findingText).not.toContain("shadowing"); // shadowing absent → clause dropped
    expect(o.impressionText).toBe("Right nephrolithiasis with mild hydronephrosis.");
  });

  it("handles bilateral grammar ('both kidneys')", () => {
    const o = renal({ side: "Bilateral", location: "Lower calyx", number: "Multiple", size: "6", hydronephrosis: "None" });
    expect(o.findingText).toContain("of both kidneys");
    expect(o.impressionText).toBe("Bilateral nephrolithiasis without hydronephrosis.");
  });
});

describe("Reference finding 2 — cholelithiasis", () => {
  it("reproduces the specified finding when supporting fields are recorded", () => {
    const o = gb({
      number: "Multiple", largest: "3", mobility: "Mobile",
      wall: "Normal", pericholecystic: "Absent", murphy: "Negative", distension: "Normal", sludge: "Absent",
    });
    expect(o.findingText).toBe(
      "Multiple mobile calculi are seen within the gallbladder, the largest measuring 3 cm. Gallbladder wall thickness is within normal limits. No pericholecystic collection is seen. Sonographic Murphy sign is negative.",
    );
    expect(o.impressionText).toBe("Cholelithiasis without sonographic evidence of acute cholecystitis.");
  });

  it("GUARD: does NOT assert absence of acute cholecystitis unless wall+murphy+pericholecystic are recorded", () => {
    // murphy not assessed → no exclusion
    const notAssessed = gb({ number: "Multiple", largest: "3", mobility: "Mobile", wall: "Normal", pericholecystic: "Absent", murphy: "Not assessed" });
    expect(notAssessed.impressionText).toBe("Cholelithiasis.");
    expect(notAssessed.findingText).not.toContain("Murphy");

    // thickened wall → no exclusion (a supporting field is abnormal)
    const thickWall = gb({ number: "Single", largest: "1.2", mobility: "Mobile", wall: "Thickened", wall_thickness: "5", pericholecystic: "Absent", murphy: "Negative" });
    expect(thickWall.impressionText).toBe("Cholelithiasis.");
    expect(thickWall.findingText).toContain("thickened, measuring 5 mm");
  });

  it("single calculus wording + impaction site", () => {
    const o = gb({ number: "Single", largest: "8 mm", mobility: "Impacted", impaction_site: "Neck", wall: "Normal", pericholecystic: "Absent", murphy: "Not assessed" });
    expect(o.findingText).toContain("A single impacted calculus is seen within the gallbladder, impacted at the neck");
    expect(o.findingText).not.toMatch(/calculi/);
  });
});

describe("Reference finding 3 — prostatomegaly / volume", () => {
  it("computes ellipsoid volume ~13 cc (NOT 35) and does not label prostatomegaly", () => {
    const o = prostate({ ap: "3.4", tr: "3.1", cc: "2.4" });
    expect(o.findingText).toBe("Prostate measures 3.4 × 3.1 × 2.4 cm with a calculated volume of approximately 13 cc.");
    expect(o.impressionText).toBe(""); // 13 cc < 30 → no prostatomegaly label
    const vol = o.derived.find((d) => d.key === "volume")!;
    expect(vol.value).toBeCloseTo(13.23, 2);
    expect(vol.source).toBe("calculated");
    expect(o.warnings).toEqual([]);
  });

  it("labels prostatomegaly only above the enlargement threshold", () => {
    const o = prostate({ ap: "5", tr: "4.5", cc: "4" }); // 50×45×40 → ~47 cc
    expect(o.impressionText).toContain("Prostatomegaly (volume approximately");
    const vol = o.derived.find((d) => d.key === "volume")!;
    expect(vol.value as number).toBeGreaterThanOrEqual(PROSTATE_ENLARGEMENT_ML);
  });

  it("manual volume WITH a reason is used but flagged when it differs materially", () => {
    const o = prostate({ ap: "3.4", tr: "3.1", cc: "2.4", manual_volume: "35", override_reason: "on-cart measurement" });
    const vol = o.derived.find((d) => d.key === "volume")!;
    expect(vol.value).toBe(35);
    expect(vol.source).toBe("manual");
    expect(o.warnings.join(" ")).toMatch(/differs materially/i);
    // 35 cc ≥ 30 → now labelled prostatomegaly off the overridden volume
    expect(o.impressionText).toContain("Prostatomegaly");
  });

  it("manual volume WITHOUT a reason is ignored (falls back to calculated) and warns", () => {
    const o = prostate({ ap: "3.4", tr: "3.1", cc: "2.4", manual_volume: "35" });
    const vol = o.derived.find((d) => d.key === "volume")!;
    expect(vol.value).toBeCloseTo(13.23, 2); // fell back to calculated
    expect(vol.source).toBe("calculated");
    expect(o.warnings.join(" ")).toMatch(/reason must be recorded/i);
  });

  it("renders optional PVR and median lobe when present", () => {
    const o = prostate({ ap: "5", tr: "4.5", cc: "4", median_lobe: "Present", pvr: "80" });
    expect(o.findingText).toContain("There is median lobe projection into the bladder base.");
    expect(o.findingText).toContain("Post-void residual urine measures 80 ml.");
  });
});
