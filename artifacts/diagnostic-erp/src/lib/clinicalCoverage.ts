/**
 * clinicalCoverage.ts — Clinical Content Coverage scoring (pure functions).
 *
 * Management analytics over the EXISTING platform registries — not a reporting
 * engine. Input is the per-pack coverage rows served by the existing Knowledge
 * Pack engine (`GET /api/radiology/knowledge-packs/coverage`, itself a thin
 * per-pack projection of the /stats loop), optionally joined client-side with
 * the Clinical Recommendation Registry. Study names are never hardcoded —
 * everything derives from pack rows.
 *
 * Weights are data and every function takes them as a parameter;
 * DEFAULT_COVERAGE_WEIGHTS is a starting point, not a constant baked into any
 * calculation.
 */
import { CLINICAL_RECOMMENDATION_REGISTRY } from "./clinicalRecommendations";

/** The 15 pack sections, as served by the pack validator. */
export type PackSectionName =
  | "template" | "protocol" | "clinicalHistory" | "quickFindings" | "structuredFindings"
  | "measurements" | "checklist" | "companion" | "copilot" | "recommendations"
  | "previousComparison" | "criticalFindings" | "teaching" | "knowledge" | "references";

export interface CoverageRow {
  packId: string;
  modality: string;
  name: string;
  status: string;
  studyType: string | null;
  category: string | null;
  version: string;
  sections: Record<string, boolean>;
  issues: { section: string; severity: string; message: string }[];
  readinessPercent: number;
  health: string;
  coverage: Record<string, number | boolean>;
  manifestCounts: Record<string, number>;
}

/** Default clinical weights per section — a judgment surface, deliberately
 *  editable in the dashboard UI and overridable in every function below. */
export const DEFAULT_COVERAGE_WEIGHTS: Record<PackSectionName, number> = {
  protocol: 15,
  template: 10,
  quickFindings: 12,
  structuredFindings: 8,
  measurements: 12,
  clinicalHistory: 5,
  checklist: 4,
  companion: 4,
  copilot: 6,
  recommendations: 8,
  previousComparison: 5,
  criticalFindings: 6,
  teaching: 2,
  knowledge: 2,
  references: 1,
};

export const SECTION_LABELS: Record<PackSectionName, string> = {
  protocol: "Protocol", template: "Template", clinicalHistory: "Clinical History",
  quickFindings: "Quick Findings", structuredFindings: "Structured Findings",
  measurements: "Measurements", checklist: "Checklist", companion: "Companion",
  copilot: "Copilot", recommendations: "Recommendations",
  previousComparison: "Comparison Rules", criticalFindings: "Critical Findings",
  teaching: "Teaching Cases", knowledge: "Knowledge Articles", references: "References",
};

/** Where each gap is fixed — deep links to the REAL owning admin routes
 *  (paths verified against App.tsx; the coverage test pins them). */
export const SECTION_ADMIN_LINKS: Record<PackSectionName, string> = {
  protocol: "/settings/radiology-quick-select",
  template: "/radiology/structured-report-templates",
  clinicalHistory: "/settings/radiology-quick-select",
  quickFindings: "/settings/radiology-quick-select",
  structuredFindings: "/settings/radiology-quick-select",
  measurements: "/measurement-registry",
  checklist: "/settings/radiology-quick-select",
  companion: "/settings/radiology/knowledge-packs",
  copilot: "/settings/radiology/knowledge-packs",
  recommendations: "/settings/radiology/recommendations",
  previousComparison: "/settings/radiology/knowledge-packs",
  criticalFindings: "/settings/radiology/knowledge-packs",
  teaching: "/teaching-cases",
  knowledge: "/settings/radiology/knowledge-packs",
  references: "/settings/radiology/knowledge-packs",
};

export const ALL_SECTIONS = Object.keys(DEFAULT_COVERAGE_WEIGHTS) as PackSectionName[];

/** Weighted Clinical Coverage Score for one study (0–100). */
export function clinicalScore(
  sections: Record<string, boolean>,
  weights: Record<PackSectionName, number> = DEFAULT_COVERAGE_WEIGHTS,
): number {
  let total = 0, covered = 0;
  for (const s of ALL_SECTIONS) {
    const w = Math.max(0, weights[s] ?? 0);
    total += w;
    if (sections[s]) covered += w;
  }
  return total > 0 ? Math.round((covered / total) * 100) : 0;
}

/** Recommendation-registry enrichment: entries activated per pack id. */
export function registryRecommendationCount(packId: string): number {
  return CLINICAL_RECOMMENDATION_REGISTRY.filter((r) => r.knowledgePackRefs.includes(packId)).length;
}

export interface StudyCoverage extends CoverageRow {
  clinicalScore: number;
  registryRecommendations: number;
  missing: { section: PackSectionName; label: string; weight: number; link: string }[];
}

/** Score every pack row + gap analysis, in one pass. */
export function scoreRows(
  rows: CoverageRow[],
  weights: Record<PackSectionName, number> = DEFAULT_COVERAGE_WEIGHTS,
): StudyCoverage[] {
  return rows.map((row) => {
    const missing = ALL_SECTIONS
      .filter((s) => !row.sections[s])
      .map((s) => ({ section: s, label: SECTION_LABELS[s], weight: Math.max(0, weights[s] ?? 0), link: SECTION_ADMIN_LINKS[s] }))
      .sort((a, b) => b.weight - a.weight);
    return {
      ...row,
      clinicalScore: clinicalScore(row.sections, weights),
      registryRecommendations: registryRecommendationCount(row.packId),
      missing,
    };
  });
}

/** Per-modality summary (avg score, counts) — derives, never hardcodes. */
export function modalitySummary(studies: StudyCoverage[]): { modality: string; packs: number; enabled: number; avgScore: number }[] {
  const by = new Map<string, { packs: number; enabled: number; sum: number }>();
  for (const s of studies) {
    const b = by.get(s.modality) ?? { packs: 0, enabled: 0, sum: 0 };
    b.packs++; if (s.status === "enabled") b.enabled++; b.sum += s.clinicalScore;
    by.set(s.modality, b);
  }
  return [...by.entries()]
    .map(([modality, b]) => ({ modality, packs: b.packs, enabled: b.enabled, avgScore: b.packs ? Math.round(b.sum / b.packs) : 0 }))
    .sort((a, b) => a.modality.localeCompare(b.modality));
}

/** Heatmap: per modality, per section, % of packs covering it. */
export function sectionHeatmap(studies: StudyCoverage[]): { modality: string; cells: { section: PackSectionName; pct: number }[] }[] {
  const by = new Map<string, StudyCoverage[]>();
  for (const s of studies) {
    if (!by.has(s.modality)) by.set(s.modality, []);
    by.get(s.modality)!.push(s);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([modality, list]) => ({
    modality,
    cells: ALL_SECTIONS.map((section) => ({
      section,
      pct: list.length ? Math.round((list.filter((s) => s.sections[section]).length / list.length) * 100) : 0,
    })),
  }));
}

/**
 * Priority generator: rank studies by expected ROI of content work.
 * impact = clinical criticality signals we HAVE (enabled status, critical
 * findings declared, category weight); need = 100 - score. Usage frequency is
 * NOT available (no per-study reporting telemetry yet) — documented limitation,
 * not silently faked.
 */
export function priorityRank(
  studies: StudyCoverage[],
  weights: Record<PackSectionName, number> = DEFAULT_COVERAGE_WEIGHTS,
): (StudyCoverage & { priority: number })[] {
  return studies
    .map((s) => {
      const need = 100 - s.clinicalScore;
      const statusFactor = s.status === "enabled" ? 1 : s.status === "placeholder" ? 0.6 : 0.2;
      const criticalFactor = s.sections["criticalFindings"] || (s.manifestCounts?.criticalFindings ?? 0) > 0 ? 1.2 : 1;
      // Highest-weight missing section signals where the clinical risk is.
      const topMissing = s.missing.length ? Math.max(...s.missing.map((m) => m.weight)) : 0;
      const maxWeight = Math.max(...ALL_SECTIONS.map((x) => Math.max(0, weights[x] ?? 0)), 1);
      const priority = Math.round(need * statusFactor * criticalFactor * (0.5 + 0.5 * (topMissing / maxWeight)));
      return { ...s, priority };
    })
    .sort((a, b) => b.priority - a.priority || a.clinicalScore - b.clinicalScore);
}

/** Overall platform score (weighted across all packs; enabled count double). */
export function overallScore(studies: StudyCoverage[]): number {
  if (!studies.length) return 0;
  let sum = 0, n = 0;
  for (const s of studies) {
    const f = s.status === "enabled" ? 2 : 1;
    sum += s.clinicalScore * f; n += f;
  }
  return Math.round(sum / n);
}
