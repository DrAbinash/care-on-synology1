/**
 * Section 3 — track which Study Tab auto-applied Technique and detect mismatch.
 * Uses explicit origin state + report field provenance (not text heuristics alone).
 */

import type { FieldProvenanceMap, InsertSource } from "@/lib/reportFieldMerge";

export type TechniqueAutoOrigin = {
  studyTabId: number | null;
  studyTabName: string;
  protocolId: number | null;
  appliedText: string;
};

const AUTO_SOURCES: InsertSource[] = ["protocol", "template"];

export function techniqueProvenanceIsManual(provenance: FieldProvenanceMap | undefined): boolean {
  if (!provenance) return false;
  return Object.values(provenance).some((sources) => sources.includes("manual"));
}

export function techniqueTextMatchesAutoOrigin(text: string, origin: TechniqueAutoOrigin | null): boolean {
  if (!origin) return false;
  return text.trim() === origin.appliedText.trim();
}

/** Region switch: should we auto-replace Technique with the new Study Tab default? */
export function shouldAutoReplaceTechniqueOnRegionChange(input: {
  techniqueText: string;
  provenance: FieldProvenanceMap | undefined;
  origin: TechniqueAutoOrigin | null;
  nextStudyTabId: number | null;
}): boolean {
  const text = input.techniqueText.trim();
  if (!text) return true;
  if (techniqueProvenanceIsManual(input.provenance)) return false;
  if (!input.origin?.studyTabId || !input.nextStudyTabId) return false;
  if (input.origin.studyTabId === input.nextStudyTabId) return false;
  return techniqueTextMatchesAutoOrigin(text, input.origin);
}

/** Show compact mismatch banner when Technique belongs to another Study Tab. */
export function techniqueRegionMismatch(input: {
  techniqueText: string;
  provenance: FieldProvenanceMap | undefined;
  origin: TechniqueAutoOrigin | null;
  currentStudyTabId: number | null;
  currentStudyTabName: string | null;
}): { originStudyTabName: string; currentStudyTabName: string } | null {
  const text = input.techniqueText.trim();
  if (!text || !input.currentStudyTabId || !input.currentStudyTabName) return null;
  if (!input.origin?.studyTabId || input.origin.studyTabId === input.currentStudyTabId) return null;
  if (shouldAutoReplaceTechniqueOnRegionChange({
    techniqueText: text,
    provenance: input.provenance,
    origin: input.origin,
    nextStudyTabId: input.currentStudyTabId,
  })) {
    return null;
  }
  return {
    originStudyTabName: input.origin.studyTabName,
    currentStudyTabName: input.currentStudyTabName,
  };
}

export function recordTechniqueAutoOrigin(
  protocol: { id: number; studyTabId?: number | null; studyType: string; techniqueText: string } | null,
  studyTabId: number | null,
  studyTabName: string,
  appliedText: string,
): TechniqueAutoOrigin | null {
  if (!appliedText.trim()) return null;
  return {
    studyTabId: protocol?.studyTabId ?? studyTabId,
    studyTabName: protocol?.studyType ?? studyTabName,
    protocolId: protocol?.id ?? null,
    appliedText: appliedText.trim(),
  };
}

export function techniqueOriginSources(): InsertSource[] {
  return AUTO_SOURCES;
}
