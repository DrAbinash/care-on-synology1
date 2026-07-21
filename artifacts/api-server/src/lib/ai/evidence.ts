/**
 * Evidence Store — pure validation (Phase P1 / Gate G5).
 *
 * No DB, no network. The grounding gate: an evidence anchor is valid only if it
 * points at something real in the study snapshot. This is what stops a model
 * (in a later phase) from citing an instance that is not part of the study.
 * Heatmap evidence is RESERVED — the type exists but is never produced in P1.
 */

export type EvidenceType = "image" | "measurement" | "heatmap";

export interface EvidenceAnchor {
  findingKey: string;
  evidenceType: EvidenceType;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  frameNumber?: number;
  measurementRef?: string;
  confidence?: number; // 0-100
}

export interface EvidenceValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate an evidence anchor against the study snapshot's instance set.
 *  - image      → series/SOP must exist in the snapshot (the anti-hallucination gate)
 *  - measurement → must carry a measurementRef
 *  - heatmap    → reserved; always rejected in P1 (interface reserved only)
 * Confidence, when present, must be in [0, 100].
 */
export function validateEvidenceAnchor(
  anchor: EvidenceAnchor,
  snapshotInstances: Array<{ seriesUid: string; sopUid: string }>,
): EvidenceValidationResult {
  if (!anchor.findingKey) return { ok: false, reason: "missing findingKey" };
  if (anchor.confidence != null && (anchor.confidence < 0 || anchor.confidence > 100)) {
    return { ok: false, reason: "confidence out of range 0-100" };
  }
  if (anchor.evidenceType === "heatmap") {
    return { ok: false, reason: "heatmap evidence is reserved and not produced in this phase" };
  }
  if (anchor.evidenceType === "measurement") {
    return anchor.measurementRef
      ? { ok: true }
      : { ok: false, reason: "measurement evidence requires measurementRef" };
  }
  // image evidence
  if (!anchor.seriesInstanceUid || !anchor.sopInstanceUid) {
    return { ok: false, reason: "image evidence requires seriesInstanceUid + sopInstanceUid" };
  }
  const exists = snapshotInstances.some(
    (i) => i.seriesUid === anchor.seriesInstanceUid && i.sopUid === anchor.sopInstanceUid,
  );
  return exists
    ? { ok: true }
    : { ok: false, reason: "anchor SOP/series not present in study snapshot (ungrounded)" };
}
