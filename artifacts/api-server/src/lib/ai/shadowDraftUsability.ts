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
  /**
   * What the provider actually did, as named by the gateway. Without this every
   * empty draft — a model that exhausted its answer budget, one that returned no
   * text, and one whose text was not valid report JSON — read identically.
   */
  providerFailure?: { code: string | null; detail: string | null } | null;
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
  /** Named provider outcome behind an unusable draft; null when none was reported. */
  providerFailureCode: string | null;
  providerFailureDetail: string | null;
  quarantineReasonClasses: Array<{ reason: string; count: number }>;
}

/**
 * Sentences for the causes a radiologist can act on. Unknown or absent codes fall
 * back to the generic wording, so a new failure mode stays honest instead of
 * claiming a cause we did not establish.
 */
export function describeProviderFailure(code: string | null): string | null {
  switch (code) {
    case "OUTPUT_BUDGET_EXHAUSTED":
      return "The model spent its entire answer budget before writing any report text — the draft is empty because none was ever produced.";
    case "EMPTY_MODEL_OUTPUT":
      return "The AI provider answered successfully but returned no text at all.";
    case "PARSE_FAILED":
      return "The model replied with text that could not be read as a structured draft.";
    case "PROVIDER_TIMEOUT":
      return "The AI provider did not answer within the timeout.";
    case "GPU_OUT_OF_MEMORY":
      return "The AI machine ran out of GPU memory while answering.";
    case "CONTEXT_BUDGET_EXCEEDED":
      return "The request was larger than the model's available context window.";
    case "PROVIDER_HTTP_ERROR":
      return "The AI provider returned an HTTP error.";
    default:
      return null;
  }
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
  const failureCode = input.providerFailure?.code ?? null;
  const failureDetail = input.providerFailure?.detail ?? null;

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
      providerFailureCode: failureCode,
      providerFailureDetail: failureDetail,
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
      providerFailureCode: failureCode,
      providerFailureDetail: failureDetail,
      quarantineReasonClasses,
    };
  }

  const degraded = input.degraded === true;
  const emptyReason: ShadowEmptyReasonCode = degraded ? "degraded_empty" : "model_or_gateway_empty";
  const namedCause = degraded ? describeProviderFailure(failureCode) : null;
  const emptyReasonLabel = namedCause
    ? namedCause
    : degraded
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
    providerFailureCode: failureCode,
    providerFailureDetail: failureDetail,
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
    providerFailureCode: u.providerFailureCode,
    providerFailureDetail: u.providerFailureDetail,
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
