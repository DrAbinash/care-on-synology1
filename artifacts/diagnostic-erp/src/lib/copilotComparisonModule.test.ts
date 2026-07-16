import { describe, it, expect } from "vitest";
import { comparisonModuleItems } from "./copilotComparisonModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "MR", studyDescription: "MRI LS Spine", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("comparison Copilot module (MRI PR 1 §7)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("comparison");
  });

  it("suggests a comparison when a prior is available but none is written", () => {
    const items = comparisonModuleItems({ ...base, findings: "Disc bulge at L4-L5.", prior: { available: true, studyName: "MRI LS Spine", dateIso: "2025-06-12" } });
    expect(items.some((i) => i.id === "cmp:available")).toBe(true);
  });

  it("stays quiet once a comparison is written", () => {
    const items = comparisonModuleItems({ ...base, findings: "Compared with the previous study dated 12 June 2025, there is mild interval progression.", prior: { available: true } });
    expect(items.some((i) => i.id === "cmp:available")).toBe(false);
  });

  it("flags a significant measurement change as a warning", () => {
    const items = comparisonModuleItems({ ...base, findings: "Compared with prior.", prior: { available: true, significantChanges: [{ label: "Lesion AP", deltaText: "+3 mm" }] } });
    const meas = items.find((i) => i.category === "measurement");
    expect(meas).toBeTruthy();
    expect(meas!.severity).toBe("warning");
  });

  it("does nothing without a prior", () => {
    expect(comparisonModuleItems(base)).toEqual([]);
  });
});
