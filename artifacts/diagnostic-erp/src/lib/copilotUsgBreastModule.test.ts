import { describe, it, expect } from "vitest";
import { usgBreastModuleItems } from "./copilotUsgBreastModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Breast", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Breast Copilot module (PR B §12)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-breast");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgBreastModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-breast ultrasound study", () => {
    expect(usgBreastModuleItems({ ...base, studyDescription: "USG Thyroid" })).toEqual([]);
  });

  it("flags a lesion described without a BI-RADS category", () => {
    const items = usgBreastModuleItems({ ...base, findings: "A well-defined hypoechoic mass in the left breast." });
    expect(items.some((i) => i.id === "usg-breast:birads-missing")).toBe(true);
  });

  it("stays quiet when BI-RADS is stated", () => {
    const items = usgBreastModuleItems({ ...base, findings: "Mass in left breast, BI-RADS 3." });
    expect(items.some((i) => i.id === "usg-breast:birads-missing")).toBe(false);
  });

  it("flags missing laterality and axilla mentions", () => {
    const items = usgBreastModuleItems({ ...base, findings: "Breast parenchyma shows normal echotexture." });
    expect(items.some((i) => i.id === "usg-breast:laterality-missing")).toBe(true);
    expect(items.some((i) => i.id === "usg-breast:axilla-missing")).toBe(true);
  });
});
