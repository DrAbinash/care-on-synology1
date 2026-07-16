import { describe, it, expect } from "vitest";
import { usgThyroidModuleItems } from "./copilotUsgThyroidModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Thyroid", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Thyroid Copilot module (PR B §12)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-thyroid");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgThyroidModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-thyroid ultrasound study", () => {
    expect(usgThyroidModuleItems({ ...base, studyDescription: "USG Whole Abdomen" })).toEqual([]);
  });

  it("flags a nodule described without a TI-RADS category", () => {
    const items = usgThyroidModuleItems({ ...base, findings: "A 1.2 cm nodule is seen in the right lobe." });
    expect(items.some((i) => i.id === "usg-thyroid:tirads-missing")).toBe(true);
  });

  it("stays quiet when TI-RADS is stated", () => {
    const items = usgThyroidModuleItems({ ...base, findings: "A 1.2 cm nodule, TI-RADS 3, right lobe." });
    expect(items.some((i) => i.id === "usg-thyroid:tirads-missing")).toBe(false);
  });

  it("flags missing isthmus and lymph node mentions", () => {
    const items = usgThyroidModuleItems({ ...base, findings: "Both lobes normal in size and echotexture." });
    expect(items.some((i) => i.id === "usg-thyroid:isthmus-missing")).toBe(true);
    expect(items.some((i) => i.id === "usg-thyroid:nodes-missing")).toBe(true);
  });
});
