// registry.ts — builds a validated, indexed Measurement Registry from
// definitions and resolves arbitrary legacy identifiers to canonical ids.
//
// Same architectural shape as the quality engine (lib/report-quality):
//   - createMeasurementRegistry(defs) returns an isolated instance
//   - DEFAULT_MEASUREMENT_REGISTRY is the singleton over the shipped catalog
//   - resolution is DETERMINISTIC: exact id → canonicalKey → normalized alias
//     → normalized alias with parenthetical stripped. No fuzzy matching.

import type {
  MeasurementDefinition,
  MeasurementResolution,
  RegistryValidationIssue,
} from "./contract";
import { MEASUREMENT_CATALOG, MEASUREMENT_CATALOG_VERSION } from "./catalog";
import { normalizeMeasurementLabel, stripParenthetical } from "./normalize";
import { canonicalUnit, isKnownUnit } from "./units";

export interface MeasurementRegistry {
  version: string;
  /** All definitions in catalog order. */
  list(): readonly MeasurementDefinition[];
  /** Exact-id lookup. */
  get(id: string): MeasurementDefinition | undefined;
  /** Resolve any id / canonicalKey / legacy label / column key to a definition. */
  resolve(input: string): MeasurementResolution | undefined;
  /** Resolve a usg_measurements-family column name (e.g. "cbdMm", "liquorAfi"). */
  resolveByColumn(column: string): MeasurementDefinition | undefined;
  /** Definitions filtered by modality code (US/CT/MR/XR/MG/BMD). */
  byModality(modality: string): readonly MeasurementDefinition[];
  /** Structured validation issues for this registry's definitions (empty = healthy). */
  validationIssues(): readonly RegistryValidationIssue[];
}

export function createMeasurementRegistry(
  definitions: readonly MeasurementDefinition[],
  version: string = MEASUREMENT_CATALOG_VERSION,
): MeasurementRegistry {
  const byId = new Map<string, MeasurementDefinition>();
  const byCanonicalKey = new Map<string, MeasurementDefinition>();
  const byAlias = new Map<string, MeasurementDefinition>();
  const byColumn = new Map<string, MeasurementDefinition>();
  const issues: RegistryValidationIssue[] = [];

  for (const def of definitions) {
    if (byId.has(def.id)) {
      issues.push({ kind: "duplicate-id", measurementId: def.id, detail: `id "${def.id}" defined more than once` });
      continue;
    }
    byId.set(def.id, def);

    const canonicalNorm = normalizeMeasurementLabel(def.canonicalKey);
    const prior = byCanonicalKey.get(canonicalNorm);
    if (prior && prior.id !== def.id) {
      issues.push({ kind: "duplicate-alias", measurementId: def.id, detail: `canonicalKey "${def.canonicalKey}" collides with ${prior.id}` });
    } else {
      byCanonicalKey.set(canonicalNorm, def);
    }

    // Aliases + displayName + id itself all resolve. Collisions across
    // DIFFERENT measurements are validation failures; repeats within the same
    // measurement are harmless.
    const aliasForms = [def.displayName, def.id, ...def.aliases];
    for (const alias of aliasForms) {
      const norm = normalizeMeasurementLabel(alias);
      if (!norm) continue;
      const existing = byAlias.get(norm);
      if (existing && existing.id !== def.id) {
        issues.push({
          kind: "duplicate-alias",
          measurementId: def.id,
          detail: `alias "${alias}" (normalized "${norm}") already resolves to ${existing.id}`,
        });
        continue;
      }
      byAlias.set(norm, def);
    }

    for (const col of def.refs.usgColumns ?? []) {
      const norm = normalizeMeasurementLabel(col);
      const existing = byColumn.get(norm);
      if (existing && existing.id !== def.id) {
        issues.push({
          kind: "duplicate-alias",
          measurementId: def.id,
          detail: `usg column "${col}" already mapped to ${existing.id}`,
        });
        continue;
      }
      byColumn.set(norm, def);
    }

    // Unit sanity.
    if (!def.allowedUnits.map(canonicalUnit).includes(canonicalUnit(def.defaultUnit))) {
      issues.push({ kind: "unit-not-allowed", measurementId: def.id, detail: `defaultUnit "${def.defaultUnit}" not in allowedUnits` });
    }
    for (const u of [def.defaultUnit, ...def.allowedUnits]) {
      if (!isKnownUnit(u)) {
        issues.push({ kind: "unknown-unit", measurementId: def.id, detail: `unit "${u}" is not in the shared unit vocabulary` });
      }
    }

    // Range sanity.
    for (const [label, range] of [["normalRange", def.normalRange], ["criticalRange", def.criticalRange]] as const) {
      if (!range) continue;
      if (range.low !== undefined && range.high !== undefined && range.low > range.high) {
        issues.push({ kind: "range-inverted", measurementId: def.id, detail: `${label} low ${range.low} > high ${range.high}` });
      }
      if (range.unit && !def.allowedUnits.map(canonicalUnit).includes(canonicalUnit(range.unit))) {
        issues.push({ kind: "range-unit-not-allowed", measurementId: def.id, detail: `${label} unit "${range.unit}" not in allowedUnits` });
      }
    }
  }

  // replacedBy referential integrity (needs the full id set first).
  for (const def of definitions) {
    if (def.replacedBy && !byId.has(def.replacedBy)) {
      issues.push({ kind: "bad-replaced-by", measurementId: def.id, detail: `replacedBy "${def.replacedBy}" is not a known id` });
    }
  }

  function resolve(input: string): MeasurementResolution | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const direct = byId.get(trimmed);
    if (direct) return { definition: direct, matchedBy: "id", input };
    const canonical = byCanonicalKey.get(normalizeMeasurementLabel(trimmed));
    if (canonical) return { definition: canonical, matchedBy: "canonicalKey", input };
    const alias = byAlias.get(normalizeMeasurementLabel(trimmed));
    if (alias) return { definition: alias, matchedBy: "alias", input };
    const stripped = normalizeMeasurementLabel(stripParenthetical(trimmed));
    if (stripped) {
      const viaStripped = byAlias.get(stripped);
      if (viaStripped) return { definition: viaStripped, matchedBy: "alias-stripped", input };
    }
    return undefined;
  }

  return {
    version,
    list: () => definitions,
    get: (id) => byId.get(id),
    resolve,
    resolveByColumn: (column) => byColumn.get(normalizeMeasurementLabel(column)),
    byModality: (modality) => {
      const m = modality.trim().toUpperCase();
      return definitions.filter((d) => (d.modalities as readonly string[]).includes(m));
    },
    validationIssues: () => issues,
  };
}

/** The platform-wide registry over the shipped catalog. */
export const DEFAULT_MEASUREMENT_REGISTRY: MeasurementRegistry = createMeasurementRegistry(MEASUREMENT_CATALOG);

/** Convenience façade over the default registry (mirrors report-quality's registry.ts style). */
export function resolveMeasurement(input: string): MeasurementResolution | undefined {
  return DEFAULT_MEASUREMENT_REGISTRY.resolve(input);
}

export function getMeasurement(id: string): MeasurementDefinition | undefined {
  return DEFAULT_MEASUREMENT_REGISTRY.get(id);
}
