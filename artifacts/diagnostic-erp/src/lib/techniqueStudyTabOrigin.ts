/**
 * Section 3 — track which Study Tab auto-applied Technique and detect mismatch.
 * Uses explicit origin state + report field provenance (not text heuristics alone).
 */

import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import type { FieldProvenanceMap, InsertSource } from "@/lib/reportFieldMerge";

/**
 * Sources that write Technique from a stored definition rather than from a person. Anything else
 * — including a sentence with no recorded source — is treated as content the report must keep.
 */
const MACHINE_TECHNIQUE_SOURCES: InsertSource[] = [
  "protocol", "template", "structured-template", "quick-normal", "system",
];

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

/**
 * May an automatic acquisition statement be ADDED to Technique for this examination?
 *
 * A single-region examination is one acquisition, so once anything — the approved template, a
 * protocol, or the radiologist's own typing — has said it, a second machine sentence is a second
 * account of the same scan. Measured on the shipped MRI Dorsal Spine pathway: the mount bootstrap
 * writes the approved template's "MRI Dorsal (Thoracic) Spine: T1W and T2W sagittal, axial at
 * selected levels.", and Generate's setup half then merged the Study Tab's "Multiplanar
 * multisequence MRI of the spine was performed including T1, T2, and STIR sequences." beside it,
 * printing an STIR claim no dorsal template establishes.
 *
 * Multi-region examinations are different in kind: Brain and Cervical Spine are two acquisitions
 * and the report has to say both, so composition stays allowed there.
 *
 * This refuses to ADD. It never removes, so nothing authored by a person can be lost by it — the
 * text on the page is exactly what it was.
 */
export function mayAddAutoTechniqueStatement(input: {
  techniqueText: string;
  regionCount: number;
}): boolean {
  if (!input.techniqueText.trim()) return true;
  return input.regionCount > 1;
}

/**
 * May Generate REPLACE the Technique on the page with the examination's approved acquisition
 * statement?
 *
 * `mayAddAutoTechniqueStatement` can only refuse an addition, so it cannot help the study whose
 * Technique box starts empty: by the time Generate runs, the setup pass has already written the
 * Study Tab or protocol sentence, and merging the approved statement on top of it leaves one
 * examination with several accounts of one acquisition. Measured on the billed whole-spine
 * screening study, the printed TECHNIQUE block held three.
 *
 * Replacement is only safe over text no person authored, so the decision reads provenance and
 * fails closed: unknown, absent or human-owned text is merged beside, never replaced. A
 * multi-region examination composes one statement per part by design, so it is never replaced.
 */
export function mayReplaceMachineTechniqueWithApproved(input: {
  techniqueText: string;
  provenance: FieldProvenanceMap | undefined;
  regionCount: number;
}): boolean {
  if (input.regionCount > 1) return false;
  const sentences = splitToSentences(input.techniqueText).map(normalizeForDedupe).filter(Boolean);
  if (sentences.length === 0) return false;
  const provenance = input.provenance;
  if (!provenance) return false;
  return sentences.every((key) => {
    const sources = provenance[key];
    if (!sources || sources.length === 0) return false;
    return sources.every((s) => MACHINE_TECHNIQUE_SOURCES.includes(s));
  });
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
