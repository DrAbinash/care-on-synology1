import { describe, it, expect } from "vitest";
import { usgDopplerModuleItems } from "./copilotUsgDopplerModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Carotid Doppler", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Doppler Copilot module (PR B §12/§16)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-doppler");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgDopplerModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-Doppler ultrasound study with no Doppler terms in the findings", () => {
    expect(usgDopplerModuleItems({ ...base, studyDescription: "USG Whole Abdomen", findings: "Liver normal." })).toEqual([]);
  });

  it("flags PSV present without EDV", () => {
    const items = usgDopplerModuleItems({ ...base, findings: "PSV 85 cm/s in the right ICA." });
    expect(items.some((i) => i.id === "usg-doppler:psv-edv-incomplete")).toBe(true);
  });

  it("stays quiet on PSV/EDV completeness when both are present", () => {
    const items = usgDopplerModuleItems({ ...base, findings: "PSV 85 cm/s, EDV 25 cm/s, RI 0.7, triphasic waveform." });
    expect(items.some((i) => i.id === "usg-doppler:psv-edv-incomplete")).toBe(false);
  });

  it("flags a missing derived index when both velocities are present but RI/S-D are not", () => {
    const items = usgDopplerModuleItems({ ...base, findings: "PSV 85 cm/s, EDV 25 cm/s." });
    expect(items.some((i) => i.id === "usg-doppler:derived-index-missing")).toBe(true);
  });

  it("stays quiet on the derived index when RI is already stated", () => {
    const items = usgDopplerModuleItems({ ...base, findings: "PSV 85 cm/s, EDV 25 cm/s, RI 0.7." });
    expect(items.some((i) => i.id === "usg-doppler:derived-index-missing")).toBe(false);
  });

  it("flags a missing waveform description", () => {
    const items = usgDopplerModuleItems({ ...base, findings: "PSV 85 cm/s, EDV 25 cm/s, RI 0.7." });
    expect(items.some((i) => i.id === "usg-doppler:waveform-missing")).toBe(true);
  });
});
