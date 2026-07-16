import { describe, it, expect } from "vitest";
import { usgAnomalyModuleItems } from "./copilotUsgAnomalyModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Anomaly Scan", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Anomaly Scan Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-anomaly");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgAnomalyModuleItems({ ...base, modality: "MR", findings: "x" })).toEqual([]);
  });

  it("does nothing for a non-anomaly-scan study", () => {
    expect(usgAnomalyModuleItems({ ...base, studyDescription: "USG Whole Abdomen", findings: "x" })).toEqual([]);
  });

  it("does nothing when findings are still empty (nothing to survey yet)", () => {
    expect(usgAnomalyModuleItems({ ...base, findings: "" })).toEqual([]);
  });

  it("flags missing organs when findings are partially complete", () => {
    const items = usgAnomalyModuleItems({
      ...base,
      findings: "Cranium and cerebellum are normal. Spine is normal.",
    });
    const survey = items.find((i) => i.id === "usg-anomaly:survey-incomplete");
    expect(survey).toBeTruthy();
    expect(survey!.detail).toContain("Cardiac");
    expect(survey!.detail).toContain("Limbs");
  });

  it("stays quiet once every organ system is addressed", () => {
    const items = usgAnomalyModuleItems({
      ...base,
      findings:
        "Cranium and cerebellum normal. Spine is normal. Cardiac four-chamber and outflow views normal. " +
        "Abdominal wall and stomach normal. Both kidneys and bladder normal. All limbs normal.",
    });
    expect(items.some((i) => i.id === "usg-anomaly:survey-incomplete")).toBe(false);
  });
});
