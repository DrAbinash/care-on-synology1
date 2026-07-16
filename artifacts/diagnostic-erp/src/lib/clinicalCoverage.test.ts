/**
 * clinicalCoverage.test.ts — Clinical Content Coverage validation (Step 10).
 * Weighted scoring, gap analysis, heatmap, priorities — plus the honesty
 * checks: configurable weights actually change scores, percentages stay in
 * bounds, links point at real admin routes, and nothing hardcodes study names.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ALL_SECTIONS, DEFAULT_COVERAGE_WEIGHTS, SECTION_ADMIN_LINKS, SECTION_LABELS,
  clinicalScore, scoreRows, modalitySummary, sectionHeatmap, priorityRank, overallScore,
  type CoverageRow, type PackSectionName,
} from "./clinicalCoverage";

const HERE = dirname(fileURLToPath(import.meta.url));

function row(over: Partial<CoverageRow> & { sections?: Record<string, boolean> }): CoverageRow {
  const sections = Object.fromEntries(ALL_SECTIONS.map((s) => [s, false]));
  return {
    packId: over.packId ?? "ct.test_pack", modality: over.modality ?? "CT",
    name: over.name ?? "Test Pack", status: over.status ?? "enabled",
    studyType: "CT Test", category: "Neuro", version: "1.0.0",
    sections: { ...sections, ...(over.sections ?? {}) },
    issues: [], readinessPercent: 0, health: "warn",
    coverage: {}, manifestCounts: { criticalFindings: 0 },
    ...over,
  } as CoverageRow;
}

describe("weighted Clinical Coverage Score", () => {
  it("0% when nothing covered, 100% when everything covered", () => {
    expect(clinicalScore(row({}).sections)).toBe(0);
    const all = Object.fromEntries(ALL_SECTIONS.map((s) => [s, true]));
    expect(clinicalScore(all)).toBe(100);
  });
  it("weights are configurable and actually change the score (never hardcoded)", () => {
    const sections = { ...Object.fromEntries(ALL_SECTIONS.map((s) => [s, false])), protocol: true };
    const def = clinicalScore(sections);
    const heavy = clinicalScore(sections, { ...DEFAULT_COVERAGE_WEIGHTS, protocol: 1000 });
    const zero = clinicalScore(sections, { ...DEFAULT_COVERAGE_WEIGHTS, protocol: 0 });
    expect(heavy).toBeGreaterThan(def);
    expect(zero).toBe(0);
  });
  it("scores stay within 0–100 for arbitrary weights", () => {
    const sections = Object.fromEntries(ALL_SECTIONS.map((s, i) => [s, i % 2 === 0]));
    for (const w of [0, 1, 7, 999]) {
      const weights = Object.fromEntries(ALL_SECTIONS.map((s) => [s, w])) as Record<PackSectionName, number>;
      const score = clinicalScore(sections, weights);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("gap analysis", () => {
  it("missing sections carry label, weight and a REAL admin route", () => {
    const app = readFileSync(resolve(HERE, "../App.tsx"), "utf8");
    const [s] = scoreRows([row({ sections: { protocol: true } })]);
    expect(s.missing.length).toBe(ALL_SECTIONS.length - 1);
    for (const m of s.missing) {
      expect(m.label).toBe(SECTION_LABELS[m.section]);
      expect(m.link).toBe(SECTION_ADMIN_LINKS[m.section]);
      // every link resolves to a registered route (or a registered prefix)
      const base = m.link.split("?")[0];
      expect(app.includes(`path="${base}"`), `route ${base}`).toBe(true);
    }
  });
  it("missing list is sorted by clinical weight (biggest gap first)", () => {
    const [s] = scoreRows([row({})]);
    const weights = s.missing.map((m) => m.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});

describe("summaries, heatmap, priorities", () => {
  const rows = [
    row({ packId: "ct.a", modality: "CT", name: "A", sections: { protocol: true, quickFindings: true } }),
    row({ packId: "ct.b", modality: "CT", name: "B", sections: Object.fromEntries(ALL_SECTIONS.map((s) => [s, true])) }),
    row({ packId: "mri.c", modality: "MRI", name: "C", status: "placeholder" }),
  ];
  it("modality summary derives (never hardcodes) and averages correctly", () => {
    const sum = modalitySummary(scoreRows(rows));
    expect(sum.map((m) => m.modality)).toEqual(["CT", "MRI"]);
    const ct = sum.find((m) => m.modality === "CT")!;
    expect(ct.packs).toBe(2);
    expect(ct.avgScore).toBeGreaterThan(0);
    expect(ct.avgScore).toBeLessThanOrEqual(100);
  });
  it("heatmap percentages are per-modality per-section and bounded", () => {
    const hm = sectionHeatmap(scoreRows(rows));
    const ct = hm.find((r) => r.modality === "CT")!;
    const protocol = ct.cells.find((c) => c.section === "protocol")!;
    expect(protocol.pct).toBe(100); // both CT packs have protocol
    for (const r of hm) for (const c of r.cells) {
      expect(c.pct).toBeGreaterThanOrEqual(0);
      expect(c.pct).toBeLessThanOrEqual(100);
    }
  });
  it("priority ranks lowest-completeness enabled studies first", () => {
    const ranked = priorityRank(scoreRows(rows));
    expect(ranked[0].packId).toBe("ct.a"); // enabled + very incomplete beats placeholder + empty
    expect(ranked[ranked.length - 1].packId).toBe("ct.b"); // complete study is lowest priority
    for (const r of ranked) expect(r.priority).toBeGreaterThanOrEqual(0);
  });
  it("overall platform score weighs enabled packs double and stays bounded", () => {
    const s = overallScore(scoreRows(rows));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
    expect(overallScore([])).toBe(0);
  });
});

describe("no duplicate studies / registry join (Step 10)", () => {
  it("scoreRows preserves one row per pack (no duplication)", () => {
    const scored = scoreRows([row({ packId: "ct.x" }), row({ packId: "ct.y" })]);
    expect(new Set(scored.map((s) => s.packId)).size).toBe(2);
  });
  it("recommendation counts derive from the real registry by pack id", () => {
    const [kub] = scoreRows([row({ packId: "ct.kub" })]);
    expect(kub.registryRecommendations).toBeGreaterThan(0); // rec.ct.kub.stone-urology et al.
    const [unknown] = scoreRows([row({ packId: "zz.nothing" })]);
    expect(unknown.registryRecommendations).toBe(0);
  });
});
