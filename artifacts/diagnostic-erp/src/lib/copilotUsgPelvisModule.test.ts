import { describe, it, expect } from "vitest";
import { usgPelvisModuleItems } from "./copilotUsgPelvisModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Pelvis", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Pelvis Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-pelvis");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgPelvisModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-pelvis ultrasound study", () => {
    expect(usgPelvisModuleItems({ ...base, studyDescription: "USG Thyroid" })).toEqual([]);
  });

  it("does not fire for obstetric-pattern studies — the obstetric module owns those", () => {
    expect(usgPelvisModuleItems({ ...base, studyDescription: "USG Obstetric Pelvis Pregnancy" })).toEqual([]);
  });

  it("flags all three missing organs when findings are empty but present", () => {
    const items = usgPelvisModuleItems({ ...base, findings: "Bladder appears normal." });
    expect(items.some((i) => i.id === "usg-pelvis:uterus-missing")).toBe(true);
    expect(items.some((i) => i.id === "usg-pelvis:endometrium-missing")).toBe(true);
    expect(items.some((i) => i.id === "usg-pelvis:ovaries-missing")).toBe(true);
  });

  it("stays quiet once uterus, endometrium, and ovaries are all addressed", () => {
    const items = usgPelvisModuleItems({
      ...base,
      findings: "Uterus normal in size. Endometrium is central and normal. Both ovaries normal.",
    });
    expect(items).toEqual([]);
  });
});
