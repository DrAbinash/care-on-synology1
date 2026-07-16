import { describe, it, expect } from "vitest";
import { usgObstetricModuleItems } from "./copilotUsgObstetricModule";
import { getCopilotModules } from "./copilotModules";
import type { CopilotContext } from "./copilotOrchestrator";

const base: CopilotContext = {
  modality: "USG", studyDescription: "USG Obstetric Growth Scan", clinicalHistory: "", findings: "", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

describe("USG Obstetric Copilot module (PR B §12)", () => {
  it("registers itself with the shared Copilot registry", () => {
    expect(getCopilotModules().map((m) => m.id)).toContain("usg-obstetric");
  });

  it("does nothing for non-ultrasound modalities", () => {
    expect(usgObstetricModuleItems({ ...base, modality: "MR" })).toEqual([]);
  });

  it("does nothing for a non-obstetric ultrasound study", () => {
    expect(usgObstetricModuleItems({ ...base, studyDescription: "USG Whole Abdomen" })).toEqual([]);
  });

  it("flags missing GA/EDD", () => {
    const items = usgObstetricModuleItems({ ...base, findings: "Single live intrauterine fetus." });
    expect(items.some((i) => i.id === "usg-ob:ga-missing")).toBe(true);
  });

  it("stays quiet on GA when it is stated", () => {
    const items = usgObstetricModuleItems({ ...base, findings: "GA 32 weeks 2 days by biometry." });
    expect(items.some((i) => i.id === "usg-ob:ga-missing")).toBe(false);
  });

  it("flags missing placenta and liquor mentions", () => {
    const items = usgObstetricModuleItems({ ...base, findings: "GA 32w2d. Fetal heart rate normal." });
    expect(items.some((i) => i.id === "usg-ob:placenta-missing")).toBe(true);
    expect(items.some((i) => i.id === "usg-ob:liquor-missing")).toBe(true);
  });

  it("always includes a non-blocking PCPNDT Form F reminder for obstetric studies", () => {
    const items = usgObstetricModuleItems({ ...base, findings: "GA 32w2d, placenta fundal, liquor adequate." });
    const pcpndt = items.find((i) => i.id === "usg-ob:pcpndt");
    expect(pcpndt).toBeTruthy();
    expect(pcpndt!.severity).toBe("warning");
    expect(pcpndt!.category).toBe("recommendation");
  });
});
