import { describe, it, expect } from "vitest";
import { criticalModuleItems } from "./copilotCriticalModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "MR", studyDescription: "MRI Brain", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("critical-results Copilot module (MRI PR 3)", () => {
  it("registers itself on the shared registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("critical-results");
  });

  it("warns when a critical finding is described but not flagged", () => {
    const items = criticalModuleItems({
      ...base,
      findings: "Acute infarct in the left MCA territory.",
      criticalMarked: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("critical:unflagged");
    expect(items[0].category).toBe("critical");
    expect(items[0].severity).toBe("critical");
    // Safety: it never offers to auto-insert or auto-change anything.
    expect(items[0].insertText).toBeUndefined();
  });

  it("switches to a communication reminder once flagged but not telephoned", () => {
    const items = criticalModuleItems({
      ...base,
      findings: "Acute infarct in the left MCA territory.",
      criticalMarked: true,
      criticalCommunicated: false,
    });
    expect(items.map((i) => i.id)).toEqual(["critical:uncommunicated"]);
    expect(items[0].severity).toBe("warning");
  });

  it("stays silent once flagged and communicated", () => {
    const items = criticalModuleItems({
      ...base,
      findings: "Acute infarct in the left MCA territory.",
      criticalMarked: true,
      criticalCommunicated: true,
    });
    expect(items).toEqual([]);
  });

  it("says nothing for a report with no critical findings", () => {
    const items = criticalModuleItems({ ...base, findings: "Age-appropriate cerebral atrophy. No acute infarct." });
    expect(items).toEqual([]);
  });

  it("honours the per-study critical watch list", () => {
    const items = criticalModuleItems({
      ...base,
      findings: "Pituitary adenoma with optic chiasma compression.",
      criticalWatchList: ["optic chiasma compression"],
      criticalMarked: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].detail).toMatch(/optic chiasma compression/);
  });
});
