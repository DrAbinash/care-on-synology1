import { describe, it, expect } from "vitest";
import { usgGallbladderModuleItems } from "./copilotUsgGallbladderModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Whole Abdomen", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Gall Bladder Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-gallbladder");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgGallbladderModuleItems({ ...base, modality: "MR", findings: "Gallbladder normal." })).toEqual([]);
  });

  it("does nothing when the gallbladder is never mentioned", () => {
    expect(usgGallbladderModuleItems({ ...base, studyDescription: "USG Thyroid", findings: "Thyroid normal." })).toEqual([]);
  });

  it("flags wall thickening described without pericholecystic fluid status", () => {
    const items = usgGallbladderModuleItems({ ...base, findings: "Gallbladder wall thickening is noted." });
    expect(items.some((i) => i.id === "usg-gallbladder:pericholecystic-fluid-not-mentioned")).toBe(true);
  });

  it("stays quiet on pericholecystic fluid when it is stated", () => {
    const items = usgGallbladderModuleItems({ ...base, findings: "Gallbladder wall thickening with pericholecystic fluid is noted." });
    expect(items.some((i) => i.id === "usg-gallbladder:pericholecystic-fluid-not-mentioned")).toBe(false);
  });

  it("flags a calculus described without a size measurement", () => {
    const items = usgGallbladderModuleItems({ ...base, findings: "A gallbladder calculus is noted." });
    expect(items.some((i) => i.id === "usg-gallbladder:calculus-size-missing")).toBe(true);
  });

  it("stays quiet when calculus size is stated", () => {
    const items = usgGallbladderModuleItems({ ...base, findings: "A 8 mm gallbladder calculus is noted." });
    expect(items.some((i) => i.id === "usg-gallbladder:calculus-size-missing")).toBe(false);
  });

  it("flags a gallbladder study with no CBD mention", () => {
    const items = usgGallbladderModuleItems({ ...base, studyDescription: "USG Gallbladder", findings: "Gallbladder is normal." });
    expect(items.some((i) => i.id === "usg-gallbladder:cbd-not-mentioned")).toBe(true);
  });
});
