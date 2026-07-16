import { describe, it, expect } from "vitest";
import {
  slug, packIdFor, parseManifest, emptyManifest, emptyCoverage,
  coveredSectionCount, packSections, validatePack, PACK_SECTIONS,
  type PackCoverage, type PackForValidation, type PackManifest,
} from "./knowledgePackManifest";

describe("reconciliation helpers", () => {
  it("slugifies region names to lower_snake", () => {
    expect(slug("Whole Abdomen")).toBe("whole_abdomen");
    expect(slug("Head & Neck")).toBe("head_neck");
  });
  it("builds pack ids as {modality}.{slug}", () => {
    expect(packIdFor("MRI", "Brain")).toBe("mri.brain");
    expect(packIdFor("CT", "CT Chest")).toBe("ct.ct_chest");
  });
});

describe("parseManifest", () => {
  it("returns an empty manifest for null/invalid", () => {
    expect(parseManifest(null)).toEqual(emptyManifest());
    expect(parseManifest("not json")).toEqual(emptyManifest());
  });
  it("parses declarative clinical extras defensively", () => {
    const m = parseManifest(JSON.stringify({
      copilotModules: ["copilotUsgAbdomenModule"],
      companionRules: ["Stone -> hydronephrosis? level? size?"],
      comparisonMeasurements: ["Stone size"],
      criticalFindings: ["acute hemorrhage"],
      recommendations: ["Follow-up CT"],
      references: ["ACR"],
    }));
    expect(m.copilotModules).toEqual(["copilotUsgAbdomenModule"]);
    expect(m.companionRules).toHaveLength(1);
    expect(m.criticalFindings).toEqual(["acute hemorrhage"]);
    expect(m.recommendations).toEqual(["Follow-up CT"]);
  });
});

const fullCoverage = (): PackCoverage => ({
  hasTemplate: true, quickFindings: 20, structuredFindings: 8, protocols: 2, clinicalHistory: 5,
  quickMeasurements: 3, requiredMeasurements: 1, checklistProtocols: 2, impressionRules: 4,
  structuredTemplates: 1, teachingCases: 2, knowledgeArticles: 3,
});
const fullManifest = (): PackManifest => ({
  ...emptyManifest(),
  copilotModules: ["m"], companionRules: ["c"], comparisonMeasurements: ["Stone size"],
  criticalFindings: ["hemorrhage"], recommendations: ["Follow-up CT"], references: ["ACR"],
});
const pack = (over: Partial<PackForValidation> = {}): PackForValidation => ({
  packId: "ct.ct_brain", status: "enabled", modality: "CT", dependsOn: [], manifest: fullManifest(), ...over,
});

describe("packSections / coveredSectionCount", () => {
  it("covers all 15 sections when live content + manifest are complete", () => {
    const sections = packSections(fullCoverage(), fullManifest());
    expect(Object.keys(sections)).toHaveLength(PACK_SECTIONS.length);
    expect(coveredSectionCount(fullCoverage(), fullManifest())).toBe(15);
  });
  it("counts previous-comparison / critical / references from the manifest", () => {
    expect(coveredSectionCount(fullCoverage(), emptyManifest())).toBeLessThan(15);
    const s = packSections(fullCoverage(), emptyManifest());
    expect(s.previousComparison).toBe(false);
    expect(s.criticalFindings).toBe(false);
    expect(s.references).toBe(false);
  });
  it("is 0 for an empty pack", () => {
    expect(coveredSectionCount(emptyCoverage(), emptyManifest())).toBe(0);
  });
});

describe("validatePack", () => {
  const known = new Set(["ct.ct_brain", "usg.whole_abdomen"]);

  it("an enabled, fully-covered pack is healthy at 100% readiness", () => {
    const v = validatePack(pack(), fullCoverage(), known);
    expect(v.health).toBe("ok");
    expect(v.readinessPercent).toBe(100);
    expect(v.coveredSections).toBe(15);
    expect(v.sections.criticalFindings).toBe(true);
  });

  it("warns on missing core sections and reports partial readiness", () => {
    const cov = { ...fullCoverage(), hasTemplate: false, protocols: 0, quickFindings: 0 };
    const v = validatePack(pack({ manifest: { ...fullManifest(), criticalFindings: [] } }), cov, known);
    expect(v.health).toBe("warn");
    expect(v.readinessPercent).toBeLessThan(100);
    expect(v.issues.some((i) => i.section === "template" && i.severity === "warn")).toBe(true);
    expect(v.issues.some((i) => i.section === "criticalFindings" && i.severity === "warn")).toBe(true);
  });

  it("an enabled pack with zero content is broken", () => {
    const v = validatePack(pack({ manifest: emptyManifest() }), emptyCoverage(), known);
    expect(v.health).toBe("error");
    expect(v.readinessPercent).toBe(0);
  });

  it("placeholder/planned packs are intentionally empty (not broken)", () => {
    for (const status of ["placeholder", "planned"] as const) {
      const v = validatePack(pack({ status, manifest: emptyManifest() }), emptyCoverage(), known);
      expect(v.health).toBe("placeholder");
      expect(v.ok).toBe(true);
    }
  });

  it("a missing dependency is an error", () => {
    const v = validatePack(pack({ dependsOn: ["ct.shared"] }), fullCoverage(), known);
    expect(v.health).toBe("error");
    expect(v.issues.some((i) => i.section === "dependencies")).toBe(true);
  });
});
