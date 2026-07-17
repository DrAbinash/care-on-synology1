// registry.ts — builds a validated, indexed Pathology Registry from analyte and
// panel definitions and resolves arbitrary legacy labels/codes to canonical ids.
//
// Same architectural shape as @workspace/measurements and the quality engine:
//   - createPathologyRegistry(analytes, panels) returns an isolated instance
//   - DEFAULT_PATHOLOGY_REGISTRY is the singleton over the shipped catalog
//   - resolution is DETERMINISTIC: exact id → canonicalKey → normalized alias →
//     normalized alias with parenthetical stripped. No fuzzy matching.
//   - validationIssues() surfaces every structural problem (duplicate ids,
//     clashing aliases, bad units/ranges, panels referencing unknown analytes)
//     so the catalog is provably self-consistent in CI.

import type {
  AnalyteDefinition,
  AnalyteResolution,
  LabDepartment,
  PanelDefinition,
  PanelResolution,
  RegistryValidationIssue,
} from "./contract";
import {
  PATHOLOGY_ANALYTE_CATALOG,
  PATHOLOGY_PANEL_CATALOG,
  PATHOLOGY_CATALOG_VERSION,
} from "./catalog";
import { normalizeAnalyteLabel, stripParenthetical } from "./normalize";
import { canonicalUnit, isKnownUnit } from "./units";

const LOINC_RE = /^\d{1,7}-\d$/;

export interface PathologyRegistry {
  version: string;
  /** All analytes in catalog order. */
  listAnalytes(): readonly AnalyteDefinition[];
  /** All panels in catalog order. */
  listPanels(): readonly PanelDefinition[];
  /** Exact-id analyte lookup. */
  getAnalyte(id: string): AnalyteDefinition | undefined;
  /** Exact-id panel lookup. */
  getPanel(id: string): PanelDefinition | undefined;
  /** Resolve any id / canonicalKey / legacy label / code to an analyte. */
  resolveAnalyte(input: string): AnalyteResolution | undefined;
  /** Resolve any id / canonicalKey / legacy label / code to a panel. */
  resolvePanel(input: string): PanelResolution | undefined;
  /** The analytes that make up a panel, in report order (unknown ids skipped). */
  panelAnalytes(panelId: string): readonly AnalyteDefinition[];
  /** Analytes belonging to a laboratory department. */
  byDepartment(department: string): readonly AnalyteDefinition[];
  /** Structured validation issues (empty = healthy). */
  validationIssues(): readonly RegistryValidationIssue[];
}

export function createPathologyRegistry(
  analytes: readonly AnalyteDefinition[],
  panels: readonly PanelDefinition[],
  version: string = PATHOLOGY_CATALOG_VERSION,
): PathologyRegistry {
  const byId = new Map<string, AnalyteDefinition>();
  const byCanonicalKey = new Map<string, AnalyteDefinition>();
  const byAlias = new Map<string, AnalyteDefinition>();
  const panelById = new Map<string, PanelDefinition>();
  const panelByCanonicalKey = new Map<string, PanelDefinition>();
  const panelByAlias = new Map<string, PanelDefinition>();
  const issues: RegistryValidationIssue[] = [];

  // ── Analytes ───────────────────────────────────────────────────────────────
  for (const def of analytes) {
    if (byId.has(def.id)) {
      issues.push({ kind: "duplicate-id", entityId: def.id, detail: `analyte id "${def.id}" defined more than once` });
      continue;
    }
    byId.set(def.id, def);

    const canonicalNorm = normalizeAnalyteLabel(def.canonicalKey);
    const priorCanon = byCanonicalKey.get(canonicalNorm);
    if (priorCanon && priorCanon.id !== def.id) {
      issues.push({ kind: "duplicate-alias", entityId: def.id, detail: `canonicalKey "${def.canonicalKey}" collides with ${priorCanon.id}` });
    } else {
      byCanonicalKey.set(canonicalNorm, def);
    }

    const aliasForms = [def.displayName, def.shortName ?? "", def.id, ...def.aliases];
    for (const alias of aliasForms) {
      const norm = normalizeAnalyteLabel(alias);
      if (!norm) continue;
      const existing = byAlias.get(norm);
      if (existing && existing.id !== def.id) {
        issues.push({ kind: "duplicate-alias", entityId: def.id, detail: `alias "${alias}" (normalized "${norm}") already resolves to ${existing.id}` });
        continue;
      }
      byAlias.set(norm, def);
    }

    // Unit sanity (text results have no unit and are exempt).
    const isTextual = def.resultType === "text" || def.resultType === "titre" || def.resultType === "categorical";
    if (!isTextual) {
      const allowedCanon = def.allowedUnits.map(canonicalUnit);
      if (def.defaultUnit && !allowedCanon.includes(canonicalUnit(def.defaultUnit))) {
        issues.push({ kind: "unit-not-allowed", entityId: def.id, detail: `defaultUnit "${def.defaultUnit}" not in allowedUnits` });
      }
      for (const u of [def.defaultUnit, ...def.allowedUnits]) {
        if (u && !isKnownUnit(u)) {
          issues.push({ kind: "unknown-unit", entityId: def.id, detail: `unit "${u}" is not in the shared unit vocabulary` });
        }
      }
    }

    // Range / critical / age sanity.
    if (def.criticalLow !== undefined && def.criticalHigh !== undefined && def.criticalLow > def.criticalHigh) {
      issues.push({ kind: "critical-inverted", entityId: def.id, detail: `criticalLow ${def.criticalLow} > criticalHigh ${def.criticalHigh}` });
    }
    for (const iv of def.referenceIntervals) {
      if (iv.low !== undefined && iv.high !== undefined && iv.low > iv.high) {
        issues.push({ kind: "range-inverted", entityId: def.id, detail: `interval low ${iv.low} > high ${iv.high}` });
      }
      if (iv.unit && !def.allowedUnits.map(canonicalUnit).includes(canonicalUnit(iv.unit))) {
        issues.push({ kind: "range-unit-not-allowed", entityId: def.id, detail: `interval unit "${iv.unit}" not in allowedUnits` });
      }
      if (iv.ageMinYears !== undefined && iv.ageMaxYears !== undefined && iv.ageMinYears >= iv.ageMaxYears) {
        issues.push({ kind: "interval-age-inverted", entityId: def.id, detail: `ageMinYears ${iv.ageMinYears} >= ageMaxYears ${iv.ageMaxYears}` });
      }
      if (iv.criticalLow !== undefined && iv.criticalHigh !== undefined && iv.criticalLow > iv.criticalHigh) {
        issues.push({ kind: "critical-inverted", entityId: def.id, detail: `interval criticalLow ${iv.criticalLow} > criticalHigh ${iv.criticalHigh}` });
      }
    }

    // Result-type completeness.
    if (def.resultType === "categorical" && (!def.categories || def.categories.length === 0)) {
      issues.push({ kind: "categorical-without-values", entityId: def.id, detail: "categorical analyte has no categories" });
    }
    if ((def.resultType === "numeric" || def.resultType === "ratio") &&
        def.referenceIntervals.length === 0 &&
        def.criticalLow === undefined && def.criticalHigh === undefined) {
      issues.push({ kind: "numeric-without-range", entityId: def.id, detail: "numeric analyte has neither a reference interval nor a critical value — it can never be flagged" });
    }

    if (def.loinc && !LOINC_RE.test(def.loinc)) {
      issues.push({ kind: "bad-loinc", entityId: def.id, detail: `loinc "${def.loinc}" is not a valid LOINC code` });
    }
  }

  // replacedBy referential integrity (needs the full analyte id set first).
  for (const def of analytes) {
    if (def.replacedBy && !byId.has(def.replacedBy)) {
      issues.push({ kind: "bad-replaced-by", entityId: def.id, detail: `replacedBy "${def.replacedBy}" is not a known analyte id` });
    }
  }

  // ── Panels ─────────────────────────────────────────────────────────────────
  for (const panel of panels) {
    if (panelById.has(panel.id)) {
      issues.push({ kind: "duplicate-id", entityId: panel.id, detail: `panel id "${panel.id}" defined more than once` });
      continue;
    }
    panelById.set(panel.id, panel);

    const canonicalNorm = normalizeAnalyteLabel(panel.canonicalKey);
    const priorCanon = panelByCanonicalKey.get(canonicalNorm);
    if (priorCanon && priorCanon.id !== panel.id) {
      issues.push({ kind: "duplicate-alias", entityId: panel.id, detail: `panel canonicalKey "${panel.canonicalKey}" collides with ${priorCanon.id}` });
    } else {
      panelByCanonicalKey.set(canonicalNorm, panel);
    }

    for (const alias of [panel.displayName, panel.id, ...panel.aliases]) {
      const norm = normalizeAnalyteLabel(alias);
      if (!norm) continue;
      const existing = panelByAlias.get(norm);
      if (existing && existing.id !== panel.id) {
        issues.push({ kind: "duplicate-alias", entityId: panel.id, detail: `panel alias "${alias}" already resolves to ${existing.id}` });
        continue;
      }
      panelByAlias.set(norm, panel);
    }

    for (const analyteId of panel.analytes) {
      if (!byId.has(analyteId)) {
        issues.push({ kind: "panel-unknown-analyte", entityId: panel.id, detail: `panel references unknown analyte "${analyteId}"` });
      }
    }
    if (panel.loinc && !LOINC_RE.test(panel.loinc)) {
      issues.push({ kind: "bad-loinc", entityId: panel.id, detail: `loinc "${panel.loinc}" is not a valid LOINC code` });
    }
  }
  for (const panel of panels) {
    if (panel.replacedBy && !panelById.has(panel.replacedBy)) {
      issues.push({ kind: "bad-replaced-by", entityId: panel.id, detail: `replacedBy "${panel.replacedBy}" is not a known panel id` });
    }
  }

  function resolveAnalyte(input: string): AnalyteResolution | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const direct = byId.get(trimmed);
    if (direct) return { definition: direct, matchedBy: "id", input };
    const canonical = byCanonicalKey.get(normalizeAnalyteLabel(trimmed));
    if (canonical) return { definition: canonical, matchedBy: "canonicalKey", input };
    const alias = byAlias.get(normalizeAnalyteLabel(trimmed));
    if (alias) return { definition: alias, matchedBy: "alias", input };
    const strippedNorm = normalizeAnalyteLabel(stripParenthetical(trimmed));
    if (strippedNorm) {
      const viaStripped = byAlias.get(strippedNorm);
      if (viaStripped) return { definition: viaStripped, matchedBy: "alias-stripped", input };
    }
    return undefined;
  }

  function resolvePanel(input: string): PanelResolution | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const direct = panelById.get(trimmed);
    if (direct) return { definition: direct, matchedBy: "id", input };
    const canonical = panelByCanonicalKey.get(normalizeAnalyteLabel(trimmed));
    if (canonical) return { definition: canonical, matchedBy: "canonicalKey", input };
    const alias = panelByAlias.get(normalizeAnalyteLabel(trimmed));
    if (alias) return { definition: alias, matchedBy: "alias", input };
    const strippedNorm = normalizeAnalyteLabel(stripParenthetical(trimmed));
    if (strippedNorm) {
      const viaStripped = panelByAlias.get(strippedNorm);
      if (viaStripped) return { definition: viaStripped, matchedBy: "alias-stripped", input };
    }
    return undefined;
  }

  return {
    version,
    listAnalytes: () => analytes,
    listPanels: () => panels,
    getAnalyte: (id) => byId.get(id),
    getPanel: (id) => panelById.get(id),
    resolveAnalyte,
    resolvePanel,
    panelAnalytes: (panelId) => {
      const panel = panelById.get(panelId);
      if (!panel) return [];
      return panel.analytes.map((a) => byId.get(a)).filter((a): a is AnalyteDefinition => a !== undefined);
    },
    byDepartment: (department) => {
      const d = department.trim().toLowerCase();
      return analytes.filter((a) => (a.department as LabDepartment).toLowerCase() === d);
    },
    validationIssues: () => issues,
  };
}

/** The platform-wide registry over the shipped catalog. */
export const DEFAULT_PATHOLOGY_REGISTRY: PathologyRegistry = createPathologyRegistry(
  PATHOLOGY_ANALYTE_CATALOG,
  PATHOLOGY_PANEL_CATALOG,
);

/** Convenience façades over the default registry. */
export function resolveAnalyte(input: string): AnalyteResolution | undefined {
  return DEFAULT_PATHOLOGY_REGISTRY.resolveAnalyte(input);
}
export function getAnalyte(id: string): AnalyteDefinition | undefined {
  return DEFAULT_PATHOLOGY_REGISTRY.getAnalyte(id);
}
export function resolvePanel(input: string): PanelResolution | undefined {
  return DEFAULT_PATHOLOGY_REGISTRY.resolvePanel(input);
}
export function getPanel(id: string): PanelDefinition | undefined {
  return DEFAULT_PATHOLOGY_REGISTRY.getPanel(id);
}
