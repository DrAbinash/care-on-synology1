/**
 * Shadow draft usability — distinguishes technical job completion from a
 * radiologist-usable AI draft. Pure; no DB.
 *
 * READY  = at least one grounded finding OR non-empty impression text
 * QUARANTINED = candidates existed but all were withheld, and no impression
 * EMPTY  = no candidates and no impression (incl. gateway degraded empty)
 */
export type ShadowDraftClinicalStatus = "READY" | "EMPTY" | "QUARANTINED";

export type ShadowEmptyReasonCode =
  | "no_candidate_findings"
  | "all_findings_quarantined"
  | "model_or_gateway_empty"
  | "degraded_empty";

export interface ShadowDraftUsabilityInput {
  /** Findings that survived the trust gauntlet (grounded). */
  acceptedFindings: Array<{ text?: string | null }>;
  /** Findings rejected by trust/grounding (with reasons). */
  quarantinedFindings: Array<{ reasons?: string[] }>;
  /** Impression lines from the model (usable even when findingCount is 0). */
  impression: string[];
  /** Candidate findings before the gauntlet (parsed model output). */
  candidateCount: number;
  /** Gateway/provider degraded to empty conforming draft. */
  degraded?: boolean;
  /** Images rendered and passed to inference. */
  imageCount?: number;
}

export interface ShadowDraftUsability {
  clinicalStatus: ShadowDraftClinicalStatus;
  usable: boolean;
  acceptedCount: number;
  quarantinedCount: number;
  candidateCount: number;
  impressionCount: number;
  emptyReason: ShadowEmptyReasonCode | null;
  emptyReasonLabel: string | null;
  quarantineReasonClasses: Array<{ reason: string; count: number }>;
}

function trimLines(lines: string[] | null | undefined): string[] {
  return (lines ?? []).map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
}

function hasUsableFindingText(findings: Array<{ text?: string | null }>): boolean {
  return findings.some((f) => typeof f.text === "string" && f.text.trim().length > 0);
}

export function classifyShadowDraftUsability(input: ShadowDraftUsabilityInput): ShadowDraftUsability {
  const accepted = input.acceptedFindings.filter((f) => typeof f.text === "string" && f.text.trim().length > 0);
  const impression = trimLines(input.impression);
  const quarantinedCount = input.quarantinedFindings.length;
  const candidateCount = Math.max(0, input.candidateCount);
  const acceptedCount = accepted.length;
  const impressionCount = impression.length;
  const usable = acceptedCount > 0 || impressionCount > 0;

  const reasonCounts = new Map<string, number>();
  for (const q of input.quarantinedFindings) {
    for (const r of q.reasons ?? []) {
      const key = r.trim() || "unspecified";
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  const quarantineReasonClasses = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  if (usable) {
    return {
      clinicalStatus: "READY",
      usable: true,
      acceptedCount,
      quarantinedCount,
      candidateCount,
      impressionCount,
      emptyReason: null,
      emptyReasonLabel: null,
      quarantineReasonClasses,
    };
  }

  if (quarantinedCount > 0 || (candidateCount > 0 && acceptedCount === 0)) {
    return {
      clinicalStatus: "QUARANTINED",
      usable: false,
      acceptedCount,
      quarantinedCount,
      candidateCount,
      impressionCount,
      emptyReason: "all_findings_quarantined",
      emptyReasonLabel: `${Math.max(quarantinedCount, candidateCount)} candidate finding(s) withheld by grounding/safety checks; no usable impression.`,
      quarantineReasonClasses,
    };
  }

  const degraded = input.degraded === true;
  const emptyReason: ShadowEmptyReasonCode = degraded ? "degraded_empty" : "model_or_gateway_empty";
  const emptyReasonLabel = degraded
    ? "AI gateway degraded to an empty draft (provider/parse failure) — no usable findings or impression."
    : (input.imageCount != null && input.imageCount === 0)
      ? "No images were available for vision inference — no usable findings or impression."
      : "Model returned no candidate findings and no impression.";

  return {
    clinicalStatus: "EMPTY",
    usable: false,
    acceptedCount,
    quarantinedCount,
    candidateCount,
    impressionCount,
    emptyReason,
    emptyReasonLabel,
    quarantineReasonClasses,
  };
}

/** Worklist pointer JSON fields written after a shadow run. */
export function buildWorklistAiDraftPointer(input: {
  draftId: number;
  version: number;
  source: string;
  findingsText: string;
  impression: string[];
  usability: ShadowDraftUsability;
  imageCount: number;
  modelVersion?: string | null;
  degraded: boolean;
}): Record<string, unknown> {
  const u = input.usability;
  return {
    source: input.source,
    draftId: input.draftId,
    version: input.version,
    findingCount: u.acceptedCount,
    findings: input.findingsText,
    impression: input.impression,
    clinicalStatus: u.clinicalStatus,
    emptyReason: u.emptyReason,
    emptyReasonLabel: u.emptyReasonLabel,
    candidateCount: u.candidateCount,
    quarantinedCount: u.quarantinedCount,
    impressionCount: u.impressionCount,
    imageCount: input.imageCount,
    degraded: input.degraded,
    modelVersion: input.modelVersion ?? null,
    quarantineReasonClasses: u.quarantineReasonClasses,
    updatedAt: new Date().toISOString(),
  };
}

export function hasUsableClinicalDraft(opts: {
  findingsText?: string | null;
  findings?: Array<{ text?: string | null }> | null;
  impression?: string[] | null;
}): boolean {
  if (opts.findings && hasUsableFindingText(opts.findings)) return true;
  if (typeof opts.findingsText === "string" && opts.findingsText.trim()) return true;
  return trimLines(opts.impression).length > 0;
}
