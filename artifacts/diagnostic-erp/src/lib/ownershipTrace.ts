/**
 * Developer/admin ownership diagnostic. Never include patient demographics.
 * Shown only when care_ownership_trace=1 or ?ownershipTrace=1.
 */

import type { LedgerPatch } from "./observationLedger";

export const OWNERSHIP_TRACE_STORAGE_KEY = "care_ownership_trace";

export function ownershipTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("ownershipTrace") === "1") return true;
    return window.localStorage.getItem(OWNERSHIP_TRACE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export type OwnershipTraceRow = {
  id: string;
  catalogId: string | number | "";
  source: string;
  region: string;
  anatomicalSection: string;
  concept: string | null;
  conceptSource: string;
  legacyFallback: boolean;
  conflictGroup: string;
  level: string;
  laterality: string;
  slotKey: string;
  bundleId: string;
  protected: boolean;
  specificity: string;
  lastRenderedFindings: string;
  impressionContribution: string;
  recommendationContribution: string;
  baselineReplaces: string;
  replacedFindings: string[];
  replacedImpression: string[];
};

export function buildOwnershipTrace(patch: LedgerPatch): OwnershipTraceRow {
  const obs = patch.observation;
  return {
    id: patch.id,
    catalogId: obs.catalogId ?? "",
    source: patch.source,
    region: obs.region,
    anatomicalSection: obs.anatomicalSection,
    concept: obs.concept,
    conceptSource: obs.conceptSource,
    legacyFallback: obs.conceptSource === "legacy-fallback" || obs.conceptSource === "none",
    conflictGroup: obs.conflictGroup,
    level: obs.level,
    laterality: obs.laterality,
    slotKey: obs.slotKey,
    bundleId: obs.bundleId,
    protected: patch.protected,
    specificity: obs.specificity,
    lastRenderedFindings: patch.lastRendered.findings ?? "",
    impressionContribution: patch.lastRendered.impression ?? "",
    recommendationContribution: patch.lastRendered.recommendation ?? "",
    baselineReplaces: obs.baselineReplaces,
    replacedFindings: patch.replacedBaseline.findings,
    replacedImpression: patch.replacedBaseline.impression,
  };
}

const PHI_FIELD_KEYS = /^(patient|patientName|patient_name|uhid|accession|accessionNumber|phone|mobile|email|dob|dateOfBirth|address|age|sex|gender|referringDoctor|refBy)$/i;

export function formatOwnershipTraceClipboard(rows: OwnershipTraceRow[]): string {
  const sanitized = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (PHI_FIELD_KEYS.test(k)) continue;
      out[k] = v;
    }
    return out;
  });
  return `${JSON.stringify({ kind: "care.ownership_trace.v1", observations: sanitized }, null, 2)}\n`;
}

export function ownershipTraceLooksLikePhi(text: string, planted: string[]): boolean {
  const lower = text.toLowerCase();
  return planted.some((p) => p.trim() && lower.includes(p.toLowerCase()));
}
