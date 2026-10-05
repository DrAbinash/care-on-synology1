import { beforeEach, describe, it, expect } from "vitest";
import { criticalModuleItems } from "./copilotCriticalModule";
import { getCopilotModules } from "./copilotModules";
import { setServerFeatureFlags } from "./staffSession";
import { CRITICAL_COMMS_FLAG } from "./criticalResultCommsFlag";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "MR", studyDescription: "MRI Brain", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

/** Drive the flag through the real hydration entry point rather than mocking
 *  isFeatureEnabled, so these tests exercise the same read path the UI uses. */
function setCommsFlag(enabled: boolean) {
  setServerFeatureFlags({ [CRITICAL_COMMS_FLAG]: enabled });
}

describe("critical-results Copilot module (MRI PR 3)", () => {
  // Every advisory this module produces tells the radiologist to use the
  // "Mark Critical Finding" switch or the communication checklist. Those
  // controls only exist while ff_radiology_critical_result_comms is on, so the
  // advisory logic below is only reachable with the flag enabled.
  beforeEach(() => setCommsFlag(true));

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

describe("critical-results Copilot module — ff_radiology_critical_result_comms OFF", () => {
  beforeEach(() => setCommsFlag(false));

  it("stays silent on an unflagged critical finding", () => {
    // Same input the ON suite above asserts produces critical:unflagged.
    expect(criticalModuleItems({
      ...base,
      findings: "Acute infarct in the left MCA territory.",
      criticalMarked: false,
    })).toEqual([]);
  });

  it("stays silent on a flagged-but-not-telephoned critical finding", () => {
    expect(criticalModuleItems({
      ...base,
      findings: "Acute infarct in the left MCA territory.",
      criticalMarked: true,
      criticalCommunicated: false,
    })).toEqual([]);
  });

  it("stays silent on a per-study watch-list hit", () => {
    expect(criticalModuleItems({
      ...base,
      findings: "Pituitary adenoma with optic chiasma compression.",
      criticalWatchList: ["optic chiasma compression"],
      criticalMarked: false,
    })).toEqual([]);
  });

  it("leaves the module registered — off means silent, not removed", () => {
    // The clinic is not using this protocol now; turning it back on must
    // restore the advisory with no code change. Deregistering would not.
    expect(getCopilotModules().map((m) => m.id)).toContain("critical-results");
  });
});
