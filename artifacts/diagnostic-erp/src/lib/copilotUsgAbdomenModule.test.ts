import { describe, it, expect } from "vitest";
import { usgAbdomenModuleItems } from "./copilotUsgAbdomenModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Whole Abdomen", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Abdomen Copilot module (PR B §12)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-abdomen");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgAbdomenModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-abdominal ultrasound study", () => {
    expect(usgAbdomenModuleItems({ ...base, studyDescription: "USG Thyroid" })).toEqual([]);
  });

  it("flags missing organs when findings are present but incomplete", () => {
    const items = usgAbdomenModuleItems({ ...base, findings: "Liver: normal echotexture. Gallbladder: normal." });
    const organCheck = items.find((i) => i.id === "usg-abd:organ-coverage");
    expect(organCheck).toBeTruthy();
    expect(organCheck!.detail).toContain("Pancreas");
    expect(organCheck!.detail).toContain("Kidneys");
  });

  it("stays quiet on organ coverage once every organ is addressed", () => {
    const items = usgAbdomenModuleItems({
      ...base,
      findings: "Liver normal. Gallbladder normal, no CBD dilatation. Pancreas normal. Spleen normal. Both kidneys normal. Bladder normal.",
    });
    expect(items.some((i) => i.id === "usg-abd:organ-coverage")).toBe(false);
  });

  it("flags a missing post-void residue for a KUB study", () => {
    const items = usgAbdomenModuleItems({ ...base, studyDescription: "USG KUB", findings: "Both kidneys normal. Bladder normal." });
    expect(items.some((i) => i.id === "usg-abd:pvr-missing")).toBe(true);
  });

  it("does not flag PVR for a non-KUB abdomen study", () => {
    const items = usgAbdomenModuleItems({ ...base, studyDescription: "USG Whole Abdomen", findings: "Liver normal." });
    expect(items.some((i) => i.id === "usg-abd:pvr-missing")).toBe(false);
  });

  it("flags ascites mentioned in findings but absent from impression", () => {
    const items = usgAbdomenModuleItems({
      ...base,
      findings: "Mild ascites noted in the pelvis.",
      impression: ["Normal abdominal ultrasound."],
    });
    expect(items.some((i) => i.id === "usg-abd:ascites-in-impression")).toBe(true);
  });

  it("stays quiet on ascites when it is already in the impression", () => {
    const items = usgAbdomenModuleItems({
      ...base,
      findings: "Mild ascites noted.",
      impression: ["Mild ascites."],
    });
    expect(items.some((i) => i.id === "usg-abd:ascites-in-impression")).toBe(false);
  });
});
