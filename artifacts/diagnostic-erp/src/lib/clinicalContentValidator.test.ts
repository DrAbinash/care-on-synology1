/**
 * clinicalContentValidator.test.ts — Content Validator validation.
 * Synthetic bad content must be caught; the REAL shipped registries must be
 * clean; passthroughs preserve the platform validators' findings; the health
 * score is data-driven and bounded.
 */
import { describe, it, expect } from "vitest";
import {
  validateRecommendationRegistry, validatePackRegistry,
  passthroughPackIssues, passthroughMeasurementIssues,
  healthScore, buildReport, reportToMarkdown, DEFAULT_PENALTIES,
} from "./clinicalContentValidator";
import { CLINICAL_RECOMMENDATION_REGISTRY, type ClinicalRecommendation } from "./clinicalRecommendations";
import type { CoverageRow } from "./clinicalCoverage";

const REC = (over: Partial<ClinicalRecommendation>): ClinicalRecommendation => ({
  id: "rec.test.entry", title: "T", description: "D",
  trigger: { kind: "measurement", labels: ["X"], comparator: ">", threshold: 1, unit: "mm" },
  measurementRefs: ["X"], qualityRuleRefs: [], knowledgePackRefs: ["ct.kub"],
  modalities: ["CT"], severity: "warning", priority: "routine", evidenceLevel: "consensus",
  followUp: { action: "Do a thing", interval: "Days" }, rationale: "Because.",
  contraindications: [], references: [], followUpQuestions: [], version: "1.0.0",
  ...over,
});

const ROW = (over: Partial<CoverageRow>): CoverageRow => ({
  packId: "ct.a", modality: "CT", name: "A", status: "enabled", studyType: "CT A",
  category: null, version: "1.0.0",
  sections: { protocol: true }, issues: [], readinessPercent: 50, health: "warn",
  coverage: {}, manifestCounts: {},
  ...over,
} as CoverageRow);

describe("recommendation validation — synthetic defects are caught", () => {
  it("duplicate ids", () => {
    const f = validateRecommendationRegistry([REC({}), REC({})]);
    expect(f.some((x) => x.code === "rec.duplicate-id")).toBe(true);
  });
  it("broken pack reference (only when pack ids are known)", () => {
    const f = validateRecommendationRegistry([REC({ knowledgePackRefs: ["zz.ghost"] })], new Set(["ct.kub"]));
    expect(f.some((x) => x.code === "rec.broken-pack-ref" && x.severity === "error")).toBe(true);
    // Without a pack list, no false broken-ref claims are made.
    const f2 = validateRecommendationRegistry([REC({ knowledgePackRefs: ["zz.ghost"] })]);
    expect(f2.some((x) => x.code === "rec.broken-pack-ref")).toBe(false);
  });
  it("conflicting triggers on the same label/comparator/modality", () => {
    const f = validateRecommendationRegistry([
      REC({ id: "rec.a" }),
      REC({ id: "rec.b" }),
    ]);
    expect(f.some((x) => x.code === "rec.conflicting-trigger")).toBe(true);
  });
  it("orphans, invalid enums, bad version, non-hierarchical id, incomplete text", () => {
    const f = validateRecommendationRegistry([
      REC({ id: "nothierarchical", knowledgePackRefs: [], measurementRefs: [], qualityRuleRefs: [], trigger: { kind: "finding-text", phrases: ["x"] }, severity: "fatal" as never, priority: "asap" as never, evidenceLevel: "vibes" as never, version: "v1", followUp: { action: " ", interval: "" }, rationale: " " }),
    ]);
    for (const code of ["rec.bad-id", "rec.orphan", "rec.bad-severity", "rec.bad-priority", "rec.bad-evidence", "rec.bad-version", "rec.incomplete"]) {
      expect(f.some((x) => x.code === code), code).toBe(true);
    }
  });
  it("bad quality-rule reference format is flagged", () => {
    const f = validateRecommendationRegistry([REC({ qualityRuleRefs: ["totally-made-up"] })]);
    expect(f.some((x) => x.code === "rec.bad-rule-ref")).toBe(true);
  });
  it("the REAL shipped registry is clean (no errors)", () => {
    const errors = validateRecommendationRegistry(CLINICAL_RECOMMENDATION_REGISTRY).filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("pack cross-registry validation", () => {
  it("duplicate pack ids and duplicate (modality, studyType) pairs", () => {
    const f = validatePackRegistry([ROW({}), ROW({ packId: "ct.a" }), ROW({ packId: "ct.b", studyType: "CT A" })]);
    expect(f.some((x) => x.code === "pack.duplicate-id")).toBe(true);
    expect(f.some((x) => x.code === "pack.duplicate-study")).toBe(true);
  });
  it("enabled-but-empty pack is an error; content-rich placeholder is info", () => {
    const empty = ROW({ packId: "ct.empty", studyType: "CT E", sections: {} });
    const rich = ROW({
      packId: "ct.rich", studyType: "CT R", status: "placeholder",
      sections: Object.fromEntries(["protocol", "template", "clinicalHistory", "quickFindings", "structuredFindings", "measurements", "checklist", "companion"].map((s) => [s, true])),
    });
    const f = validatePackRegistry([empty, rich]);
    expect(f.some((x) => x.code === "pack.enabled-empty" && x.severity === "error")).toBe(true);
    expect(f.some((x) => x.code === "pack.placeholder-rich" && x.severity === "info")).toBe(true);
  });
});

describe("passthroughs reuse platform validators (never re-implement)", () => {
  it("pack validatePack issues are passed through with source=pack-validator", () => {
    const f = passthroughPackIssues([ROW({ issues: [{ section: "protocol", severity: "warn", message: "Missing protocol" }] })]);
    expect(f).toHaveLength(1);
    expect(f[0].source).toBe("pack-validator");
    expect(f[0].code).toBe("pack.protocol");
  });
  it("measurement registry validation payload is passed through", () => {
    const f = passthroughMeasurementIssues({
      healthy: false,
      registryIssues: ["dup alias"],
      unresolvedLabels: ["Ghost label"],
      unreferencedMeasurements: ["unusedMeasurement"],
    });
    expect(f.map((x) => x.code).sort()).toEqual(["meas.registry-issue", "meas.unreferenced", "meas.unresolved-label"]);
    expect(f.every((x) => x.source === "measurement-registry")).toBe(true);
    expect(passthroughMeasurementIssues(null)).toEqual([]);
  });
});

describe("health score + report + export", () => {
  it("score is data-driven (penalties parameter) and bounded 0-100", () => {
    const errs = Array.from({ length: 20 }, (_, i) => ({ code: "x", severity: "error" as const, area: "recommendation" as const, subject: `s${i}`, message: "m", source: "content-validator" as const }));
    expect(healthScore([])).toBe(100);
    expect(healthScore(errs)).toBe(0); // 20×10 clamps at 0
    expect(healthScore(errs, { error: 0.1, warn: 0, info: 0 })).toBe(98); // penalties are data
    expect(healthScore(errs, DEFAULT_PENALTIES)).toBeGreaterThanOrEqual(0);
  });
  it("report sorts errors first and counts by area; markdown export contains every finding", () => {
    const findings = [
      { code: "a", severity: "info" as const, area: "measurement" as const, subject: "s1", message: "m1", source: "content-validator" as const },
      { code: "b", severity: "error" as const, area: "recommendation" as const, subject: "s2", message: "m2", fix: "f2", source: "content-validator" as const },
    ];
    const r = buildReport(findings);
    expect(r.findings[0].severity).toBe("error");
    expect(r.totals).toEqual({ error: 1, warn: 0, info: 1 });
    expect(r.byArea).toEqual({ measurement: 1, recommendation: 1 });
    const md = reportToMarkdown(r, "2026-07-16T00:00:00Z");
    expect(md).toContain("Health score");
    expect(md).toContain("s2");
    expect(md).toContain("f2");
  });
});
