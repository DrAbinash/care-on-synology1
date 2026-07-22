/**
 * usgExtractionHierarchy — the single deterministic extraction hierarchy (P3.2).
 *
 * One measurement may be reported by several sources. This ranks them by a fixed
 * priority, chooses the winner, and — importantly — RETAINS every candidate and
 * flags conflicts, so a lower-priority disagreement is surfaced for review
 * rather than silently discarded. Pure + testable.
 *
 * Priority (highest first):
 *   1. DICOM SR NUM with SCOORD caliper  (exact frame + coordinates)
 *   2. DICOM SR NUM (referenced image / frame)
 *   3. GE Voluson private tags
 *   4. Encapsulated PDF structured/text
 *   5. Burned-in annotation OCR
 *   6. Manual entry
 */

import type { MeasurementProvenance } from "./usgProvenance";

export type CandidateSource =
  | "dicom_sr_scoord"
  | "dicom_sr_num"
  | "ge_private_tag"
  | "encapsulated_pdf"
  | "ocr"
  | "manual";

export const HIERARCHY_ORDER: CandidateSource[] = [
  "dicom_sr_scoord",
  "dicom_sr_num",
  "ge_private_tag",
  "encapsulated_pdf",
  "ocr",
  "manual",
];

const RANK: Record<CandidateSource, number> = Object.fromEntries(
  HIERARCHY_ORDER.map((s, i) => [s, i]),
) as Record<CandidateSource, number>;

export interface MeasurementCandidate {
  key: string;                       // canonical measurement id
  source: CandidateSource;
  value: string;                     // as extracted (may include unit)
  normalizedValue?: string | null;
  unit?: string | null;
  confidence: number;                // 0..1
  provenance?: MeasurementProvenance;
}

export interface HierarchyResult {
  key: string;
  chosen: MeasurementCandidate;
  candidates: MeasurementCandidate[];   // ALL candidates, ranked (never discarded)
  conflict: boolean;                    // ≥2 materially different values
}

/** Numeric-aware value comparison (falls back to trimmed string equality). */
function sameValue(a: string, b: string): boolean {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) {
    const denom = Math.max(Math.abs(na), Math.abs(nb), 1e-9);
    return Math.abs(na - nb) / denom < 0.02; // within 2% = same measurement
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Resolve one key's candidates: choose by priority, retain all, flag conflict. */
export function selectByHierarchy(candidates: MeasurementCandidate[]): HierarchyResult | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => RANK[a.source] - RANK[b.source]);
  const chosen = ranked[0];
  const conflict = ranked.some((c) => !sameValue(c.value, chosen.value));
  return { key: chosen.key, chosen, candidates: ranked, conflict };
}

/** Resolve every key from a flat candidate list. */
export function selectAllByHierarchy(candidates: MeasurementCandidate[]): Record<string, HierarchyResult> {
  const byKey = new Map<string, MeasurementCandidate[]>();
  for (const c of candidates) {
    const list = byKey.get(c.key) ?? [];
    list.push(c);
    byKey.set(c.key, list);
  }
  const out: Record<string, HierarchyResult> = {};
  for (const [key, list] of byKey) {
    const r = selectByHierarchy(list);
    if (r) out[key] = r;
  }
  return out;
}
