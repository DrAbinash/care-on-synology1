import { describe, it, expect } from "vitest";
import { usgKidneyModuleItems } from "./copilotUsgKidneyModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG KUB", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Kidney Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-kidney");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgKidneyModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-renal ultrasound study", () => {
    expect(usgKidneyModuleItems({ ...base, studyDescription: "USG Thyroid" })).toEqual([]);
  });

  it("does not fire on renal Doppler studies (a separate module owns those)", () => {
    expect(usgKidneyModuleItems({ ...base, studyDescription: "Renal Artery Doppler" })).toEqual([]);
  });

  it("flags a calculus described without laterality", () => {
    const items = usgKidneyModuleItems({ ...base, findings: "A calculus is seen in the kidney." });
    expect(items.some((i) => i.id === "usg-kidney:calculus-laterality-missing")).toBe(true);
  });

  it("stays quiet on laterality when stated", () => {
    const items = usgKidneyModuleItems({ ...base, findings: "A calculus is seen in the right kidney." });
    expect(items.some((i) => i.id === "usg-kidney:calculus-laterality-missing")).toBe(false);
  });

  it("flags hydronephrosis described without a grade", () => {
    const items = usgKidneyModuleItems({ ...base, findings: "Hydronephrosis is noted in the left kidney." });
    expect(items.some((i) => i.id === "usg-kidney:hydronephrosis-grade-missing")).toBe(true);
  });

  it("stays quiet when hydronephrosis grade is stated", () => {
    const items = usgKidneyModuleItems({ ...base, findings: "Mild hydronephrosis is noted in the left kidney." });
    expect(items.some((i) => i.id === "usg-kidney:hydronephrosis-grade-missing")).toBe(false);
  });
});
