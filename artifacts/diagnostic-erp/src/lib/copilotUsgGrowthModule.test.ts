import { describe, it, expect } from "vitest";
import { usgGrowthModuleItems } from "./copilotUsgGrowthModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Growth Scan", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Growth Scan Copilot module (PR C §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-growth");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgGrowthModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-growth-scan study", () => {
    expect(usgGrowthModuleItems({ ...base, studyDescription: "USG Whole Abdomen" })).toEqual([]);
  });

  it("flags a missing EFW", () => {
    const items = usgGrowthModuleItems({ ...base, findings: "Single live fetus in cephalic presentation." });
    expect(items.some((i) => i.id === "usg-growth:efw-missing")).toBe(true);
  });

  it("stays quiet when EFW is stated", () => {
    const items = usgGrowthModuleItems({ ...base, findings: "EFW is 2500 g, corresponding to the 40th percentile." });
    expect(items.some((i) => i.id === "usg-growth:efw-missing")).toBe(false);
  });

  it("flags growth restriction noted without Doppler correlation", () => {
    const items = usgGrowthModuleItems({ ...base, findings: "EFW is 1800 g, suggestive of fetal growth restriction." });
    expect(items.some((i) => i.id === "usg-growth:doppler-not-correlated")).toBe(true);
  });

  it("stays quiet when Doppler correlation is present", () => {
    const items = usgGrowthModuleItems({
      ...base,
      findings: "EFW is 1800 g, suggestive of fetal growth restriction. Umbilical artery Doppler PI is within normal limits.",
    });
    expect(items.some((i) => i.id === "usg-growth:doppler-not-correlated")).toBe(false);
  });

  it("flags missing liquor/AFI", () => {
    const items = usgGrowthModuleItems({ ...base, findings: "EFW is 2500 g." });
    expect(items.some((i) => i.id === "usg-growth:liquor-missing")).toBe(true);
  });
});
