// bridge.ts — backward-compatible enrichment of legacy result rows.
//
// Existing pathology reports store results as a stringified JSON array in
// `patient_reports.parameters`: `[{name,value,unit,refRange,flag}]`, where the
// name is free text, the reference range was hand-typed, and the flag was
// whatever the technician chose. This module maps each legacy row onto a
// canonical analyte and RE-DERIVES the correct reference range + flag for the
// patient — WITHOUT mutating the stored data. Consumers get canonical fields
// alongside the untouched originals and decide what to display. This is the
// non-destructive migration path: every historical report becomes registry-
// aware at read time, and new saves can persist the canonical identity.

import type { AbnormalFlag, FlagStatus, PatientContext } from "./contract";
import { flagValue } from "./flagging";
import { DEFAULT_PATHOLOGY_REGISTRY, type PathologyRegistry } from "./registry";

/** A legacy `patient_reports.parameters` row, tolerant of key spellings. */
export interface LegacyParameterRow {
  name?: string;
  parameter?: string;
  test?: string;
  label?: string;
  value?: string | number;
  result?: string | number;
  unit?: string;
  refRange?: string;
  referenceRange?: string;
  normalRange?: string;
  flag?: string;
}

export interface EnrichedParameter {
  /** Original, preserved verbatim. */
  name: string;
  value: string;
  unit: string;
  refRange: string;
  flag: string;
  /** True when the name resolved to a canonical analyte. */
  resolved: boolean;
  analyteId?: string;
  loinc?: string;
  canonicalName?: string;
  /** Reference range recomputed for this patient from the registry. */
  canonicalRefRange?: string;
  /** Flag recomputed from the value + patient context. */
  canonicalFlag?: AbnormalFlag;
  canonicalStatus?: FlagStatus;
  /** How the name resolved (id / canonicalKey / alias / alias-stripped). */
  matchedBy?: string;
  /** True when the recomputed flag disagrees with the stored one. */
  flagChanged?: boolean;
}

function firstString(...vals: Array<string | number | undefined>): string {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

/** Safely parse a stringified/legacy `parameters` payload into rows. */
export function parseLegacyParameters(raw: unknown): LegacyParameterRow[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((r): r is LegacyParameterRow => !!r && typeof r === "object");
}

/** Enrich one legacy row against the registry. Never mutates the input. */
export function enrichLegacyParameter(
  row: LegacyParameterRow,
  ctx: PatientContext = {},
  registry: PathologyRegistry = DEFAULT_PATHOLOGY_REGISTRY,
): EnrichedParameter {
  const name = firstString(row.name, row.parameter, row.test, row.label);
  const value = firstString(row.value, row.result);
  const unit = firstString(row.unit);
  const refRange = firstString(row.refRange, row.referenceRange, row.normalRange);
  const flag = firstString(row.flag);

  const base: EnrichedParameter = { name, value, unit, refRange, flag, resolved: false };

  const hit = name ? registry.resolveAnalyte(name) : undefined;
  if (!hit) return base;

  const def = hit.definition;
  const fr = flagValue(def, value, ctx, unit || undefined);
  const canonicalFlag = fr.flag;
  const storedFlagUpper = flag.toUpperCase();

  return {
    ...base,
    resolved: true,
    analyteId: def.id,
    loinc: def.loinc,
    canonicalName: def.displayName,
    canonicalRefRange: fr.rangeDisplay,
    canonicalFlag,
    canonicalStatus: fr.status,
    matchedBy: hit.matchedBy,
    flagChanged: canonicalFlag !== "" && canonicalFlag !== storedFlagUpper,
  };
}

/** Enrich a whole legacy `parameters` array. */
export function enrichLegacyParameters(
  raw: unknown,
  ctx: PatientContext = {},
  registry: PathologyRegistry = DEFAULT_PATHOLOGY_REGISTRY,
): EnrichedParameter[] {
  return parseLegacyParameters(raw).map((r) => enrichLegacyParameter(r, ctx, registry));
}

export interface EnrichmentStats {
  total: number;
  resolved: number;
  abnormal: number;
  critical: number;
  flagChanges: number;
}

/** Aggregate counts useful for coverage dashboards / migration reporting. */
export function enrichmentStats(enriched: readonly EnrichedParameter[]): EnrichmentStats {
  let resolved = 0, abnormal = 0, critical = 0, flagChanges = 0;
  for (const e of enriched) {
    if (e.resolved) resolved++;
    if (e.canonicalStatus && e.canonicalStatus !== "normal" && e.canonicalStatus !== "unknown") abnormal++;
    if (e.canonicalStatus === "critical-low" || e.canonicalStatus === "critical-high" || e.canonicalStatus === "critical-abnormal") critical++;
    if (e.flagChanged) flagChanges++;
  }
  return { total: enriched.length, resolved, abnormal, critical, flagChanges };
}
