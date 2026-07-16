import { describe, it, expect } from "vitest";
import {
  slug, packIdFor, parseManifest, emptyManifest, emptyCoverage,
  coveredSectionCount, validatePack, type PackCoverage, type PackForValidation,
} from "./knowledgePackManifest";

describe("reconciliation helpers", () => {
  it("slugifies region names to lower_snake", () => {
    expect(slug("Whole Abdomen")).toBe("whole_abdomen");
    expect(slug("Cervical Spine")).toBe("cervical_spine");
    expect(slug("Head & Neck")).toBe("head_neck");
  });
  it("builds pack ids as {modality}.{slug}", () => {
    expect(packIdFor("MRI", "Brain")).toBe("mri.brain");
    expect(packIdFor("USG", "Whole Abdomen")).toBe("usg.whole_abdomen");
    expect(packIdFor("CT", "Chest")).toBe("ct.chest");
  });
});

describe("parseManifest", () => {
  it("returns an empty manifest for null/invalid", () => {
    expect(parseManifest(null)).toEqual(emptyManifest());
    expect(parseManifest("not json")).toEqual(emptyManifest());
  });
  it("parses declarative extras defensively", () => {
    const m = parseManifest(JSON.stringify({
      copilotModules: ["copilotUsgAbdomenModule"],
      comparisonMeasurements: ["Right Kidney", "Left Kidney"],
      normalValues: [{ label: "CBD", value: "< 6 mm" }, { junk: 1 }],
      reportingNotes: "note",
      references: ["ACR"],
    }));
    expect(m.copilotModules).toEqual(["copilotUsgAbdomenModule"]);
    expect(m.comparisonMeasurements).toHaveLength(2);
    expect(m.normalValues).toEqual([{ label: "CBD", value: "< 6 mm" }]);
    expect(m.reportingNotes).toBe("note");
  });
});

const fullCoverage = (): PackCoverage => ({
  hasTemplate: true, quickFindings: 20, protocols: 2, clinicalHistory: 5,
  quickMeasurements: 3, requiredMeasurements: 1, impressionRules: 4,
  structuredTemplates: 1, teachingCases: 2, knowledgeArticles: 3,
});

const pack = (over: Partial<PackForValidation> = {}): PackForValidation => ({
  packId: "mri.brain", status: "enabled", modality: "MRI", dependsOn: [], manifest: emptyManifest(), ...over,
});

describe("coveredSectionCount", () => {
  it("counts covered sections", () => {
    expect(coveredSectionCount(fullCoverage())).toBe(8);
    expect(coveredSectionCount(emptyCoverage())).toBe(0);
  });
});

describe("validatePack", () => {
  const known = new Set(["mri.brain", "usg.whole_abdomen"]);

  it("an enabled, fully-covered pack is healthy", () => {
    const v = validatePack(pack(), fullCoverage(), known);
    expect(v.health).toBe("ok");
    expect(v.ok).toBe(true);
    expect(v.coveredSections).toBe(8);
  });

  it("an enabled pack missing template/protocol/findings warns", () => {
    const cov = { ...fullCoverage(), hasTemplate: false, protocols: 0, quickFindings: 0 };
    const v = validatePack(pack(), cov, known);
    expect(v.health).toBe("warn");
    expect(v.issues.some((i) => i.section === "template" && i.severity === "warn")).toBe(true);
    expect(v.issues.some((i) => i.section === "protocol" && i.severity === "warn")).toBe(true);
  });

  it("an enabled pack with zero content is broken (error)", () => {
    const v = validatePack(pack(), emptyCoverage(), known);
    expect(v.health).toBe("error");
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.section === "content" && i.severity === "error")).toBe(true);
  });

  it("placeholder/planned packs are intentionally empty (not broken)", () => {
    for (const status of ["placeholder", "planned"] as const) {
      const v = validatePack(pack({ status }), emptyCoverage(), known);
      expect(v.health).toBe("placeholder");
      expect(v.ok).toBe(true);
    }
  });

  it("disabled packs report disabled health", () => {
    const v = validatePack(pack({ status: "disabled" }), fullCoverage(), known);
    expect(v.health).toBe("disabled");
  });

  it("a missing dependency is an error regardless of coverage", () => {
    const v = validatePack(pack({ dependsOn: ["mri.shared_libraries"] }), fullCoverage(), known);
    expect(v.health).toBe("error");
    expect(v.issues.some((i) => i.section === "dependencies" && i.severity === "error")).toBe(true);
  });
});
