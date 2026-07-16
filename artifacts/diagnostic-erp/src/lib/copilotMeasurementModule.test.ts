import { describe, it, expect } from "vitest";
import { measurementModuleItems } from "./copilotMeasurementModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "MR", studyDescription: "MRI LS Spine", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("measurement-completeness Copilot module (MRI PR 2 §7)", () => {
  it("registers on the shared registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("measurement-completeness");
  });

  it("flags an accepted viewer measurement whose value is missing from the report", () => {
    const items = measurementModuleItems({
      ...base,
      findings: "Diffuse disc bulge at L4-L5.",
      viewerMeasurements: [{ label: "AP canal diameter", value: 7.2, unit: "mm", imported: true }],
    });
    const omitted = items.find((i) => i.id.startsWith("meas:omitted"));
    expect(omitted).toBeTruthy();
    expect(omitted!.insertTarget).toBe("findings");
    expect(omitted!.insertText).toMatch(/7\.2 mm/);
  });

  it("stays quiet when the value is already in the report", () => {
    const items = measurementModuleItems({
      ...base,
      findings: "AP canal diameter at L4-L5 measures approximately 7.2 mm.",
      viewerMeasurements: [{ label: "AP canal diameter", value: 7.2, unit: "mm", imported: true }],
    });
    expect(items.find((i) => i.id.startsWith("meas:omitted"))).toBeFalsy();
  });

  it("ignores non-imported (still pending) measurements", () => {
    const items = measurementModuleItems({
      ...base, findings: "Normal.",
      viewerMeasurements: [{ label: "Lesion", value: 12, unit: "mm", imported: false }],
    });
    expect(items).toEqual([]);
  });

  it("flags a value disagreement near the label", () => {
    const items = measurementModuleItems({
      ...base,
      findings: "The lesion measures approximately 15 mm.",
      viewerMeasurements: [{ label: "lesion", value: 12, unit: "mm", imported: true }],
    });
    // 12 not in report → omitted; and near "lesion" the report says 15 → mismatch.
    expect(items.some((i) => i.id.startsWith("meas:mismatch"))).toBe(true);
  });

  it("does nothing without viewer measurements", () => {
    expect(measurementModuleItems({ ...base, findings: "Something 5 mm." })).toEqual([]);
  });
});
