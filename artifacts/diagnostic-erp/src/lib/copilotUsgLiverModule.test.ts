import { describe, it, expect } from "vitest";
import { usgLiverModuleItems } from "./copilotUsgLiverModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Whole Abdomen", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Liver Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-liver");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgLiverModuleItems({ ...base, modality: "MR", findings: "Liver is normal." })).toEqual([]);
  });

  it("does nothing when the liver is not mentioned at all and the study isn't liver-focused", () => {
    expect(usgLiverModuleItems({ ...base, studyDescription: "USG Thyroid", findings: "Thyroid normal." })).toEqual([]);
  });

  it("flags fatty liver described without a grade", () => {
    const items = usgLiverModuleItems({ ...base, findings: "Liver shows increased echogenicity." });
    expect(items.some((i) => i.id === "usg-liver:fatty-liver-grade-missing")).toBe(true);
  });

  it("stays quiet when the fatty liver grade is stated", () => {
    const items = usgLiverModuleItems({ ...base, findings: "Liver shows increased echogenicity, Grade I fatty infiltration." });
    expect(items.some((i) => i.id === "usg-liver:fatty-liver-grade-missing")).toBe(false);
  });

  it("flags a hepatic lesion described without echotexture characterization", () => {
    const items = usgLiverModuleItems({ ...base, findings: "A liver lesion is noted in segment VI." });
    expect(items.some((i) => i.id === "usg-liver:lesion-not-characterized")).toBe(true);
  });

  it("stays quiet when the lesion is characterized", () => {
    const items = usgLiverModuleItems({ ...base, findings: "A cystic liver lesion is noted in segment VI." });
    expect(items.some((i) => i.id === "usg-liver:lesion-not-characterized")).toBe(false);
  });

  it("flags a missing liver span when the liver is discussed", () => {
    const items = usgLiverModuleItems({ ...base, findings: "Liver shows normal echotexture." });
    expect(items.some((i) => i.id === "usg-liver:span-not-stated")).toBe(true);
  });

  it("stays quiet on span when it is stated", () => {
    const items = usgLiverModuleItems({ ...base, findings: "Liver span measures 130 mm, normal echotexture." });
    expect(items.some((i) => i.id === "usg-liver:span-not-stated")).toBe(false);
  });
});
