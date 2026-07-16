import { describe, it, expect } from "vitest";
import { usgScrotumModuleItems } from "./copilotUsgScrotumModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Scrotum", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Scrotum Copilot module (PR B §12)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-scrotum");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgScrotumModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-scrotal ultrasound study", () => {
    expect(usgScrotumModuleItems({ ...base, studyDescription: "USG Thyroid" })).toEqual([]);
  });

  it("flags a lesion described without vascularity assessment", () => {
    const items = usgScrotumModuleItems({ ...base, findings: "A hypoechoic nodule in the right testis." });
    expect(items.some((i) => i.id === "usg-scrotum:vascularity-missing")).toBe(true);
  });

  it("stays quiet when vascularity is described", () => {
    const items = usgScrotumModuleItems({ ...base, findings: "Right testis nodule shows increased vascularity on Doppler." });
    expect(items.some((i) => i.id === "usg-scrotum:vascularity-missing")).toBe(false);
  });

  it("flags an abnormal finding described without laterality", () => {
    const items = usgScrotumModuleItems({ ...base, findings: "A hydrocele is noted." });
    expect(items.some((i) => i.id === "usg-scrotum:laterality-missing")).toBe(true);
  });

  it("stays quiet on laterality when normal", () => {
    const items = usgScrotumModuleItems({ ...base, findings: "Both testes normal in size and echotexture." });
    expect(items.some((i) => i.id === "usg-scrotum:laterality-missing")).toBe(false);
  });
});
