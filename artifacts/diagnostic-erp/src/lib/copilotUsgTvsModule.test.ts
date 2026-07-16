import { describe, it, expect } from "vitest";
import { usgTvsModuleItems } from "./copilotUsgTvsModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG TVS", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG TVS Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-tvs");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgTvsModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-TVS ultrasound study", () => {
    expect(usgTvsModuleItems({ ...base, studyDescription: "USG Whole Abdomen" })).toEqual([]);
  });

  it("does not fire for obstetric-pattern studies", () => {
    expect(usgTvsModuleItems({ ...base, studyDescription: "TVS Early Pregnancy" })).toEqual([]);
  });

  it("flags endometrial thickness described without a pattern", () => {
    const items = usgTvsModuleItems({ ...base, findings: "Endometrial thickness is 8 mm." });
    expect(items.some((i) => i.id === "usg-tvs:endometrial-pattern-missing")).toBe(true);
  });

  it("stays quiet when endometrial pattern is stated", () => {
    const items = usgTvsModuleItems({ ...base, findings: "Endometrial thickness is 8 mm, trilaminar pattern." });
    expect(items.some((i) => i.id === "usg-tvs:endometrial-pattern-missing")).toBe(false);
  });

  it("flags an adnexal mass described without characterization", () => {
    const items = usgTvsModuleItems({ ...base, findings: "An ovarian cyst is noted in the left adnexa." });
    expect(items.some((i) => i.id === "usg-tvs:adnexal-mass-not-characterized")).toBe(true);
  });

  it("stays quiet when the adnexal mass is characterized", () => {
    const items = usgTvsModuleItems({ ...base, findings: "A simple ovarian cyst is noted in the left adnexa." });
    expect(items.some((i) => i.id === "usg-tvs:adnexal-mass-not-characterized")).toBe(false);
  });
});
