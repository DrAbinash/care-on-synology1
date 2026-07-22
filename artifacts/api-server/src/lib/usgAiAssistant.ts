/**
 * usgAiAssistant — safety-bounded USG AI suggestion layer (P8).
 *
 * The AI is ADVISORY ONLY. This module encodes, as pure + testable logic, the
 * non-negotiable guarantees:
 *   - AI never signs, finalizes, or writes to `patient_reports`. The only write
 *     target it can ever produce is a DRAFT, enforced by a hard guard that
 *     THROWS on any other target.
 *   - AI never bypasses the PCPNDT Form-F gate and never emits fetal sex.
 *   - AI never overwrites radiologist text silently — a suggestion enters the
 *     draft only on explicit human acceptance, and merges non-destructively.
 *   - AI output is shown only when the canonical AI enablement policy
 *     (`resolveAiEnablement`) says it is visible to the radiologist.
 *
 * It REUSES the canonical AI enablement policy (`ai/aiPolicy`) — it does not
 * introduce a second AI gate — and produces suggestions for the canonical draft
 * lifecycle, not a parallel AI report store.
 */

import type { Enablement } from "./ai/aiPolicy";

export type UsgAiSuggestionKind = "finding" | "impression" | "measurement_flag" | "growth_note";

/** The ONLY write target AI output may ever carry. */
export type AiWriteTarget = "draft_suggestion";

export interface UsgAiSuggestion {
  kind: UsgAiSuggestionKind;
  /** Target organ/section for a finding/impression suggestion. */
  section?: string | null;
  /** Draft text the AI proposes — never inserted without acceptance. */
  text: string;
  /** Why the AI proposed this — always shown for verification. */
  rationale: string;
  confidence: number;             // 0..1
  writeTarget: AiWriteTarget;     // always "draft_suggestion"
  status: "suggested";           // never "accepted"/"final" from the AI
  requiresHumanAcceptance: true;
  /** Values behind the suggestion so the radiologist verifies before accepting. */
  evidence?: Record<string, string | number | null>;
}

const FORBIDDEN_TOKENS = /\b(male|female|boy|girl|gender)\b/i;
/** "sex" only when it refers to the foetus — allow "same sex" etc. is out of scope here; be strict. */
const FETAL_SEX = /\bsex\b/i;

export class AiWriteViolationError extends Error {
  constructor(target: string) {
    super(`AI is not permitted to write to "${target}" — AI output may only become a draft suggestion.`);
    this.name = "AiWriteViolationError";
  }
}

/**
 * Hard guard. Any attempt to route AI output anywhere other than a draft
 * suggestion throws. Call this at every seam where AI output could reach a
 * write. There is deliberately no override parameter.
 */
export function assertAiWriteAllowed(target: string): asserts target is AiWriteTarget {
  if (target !== "draft_suggestion") throw new AiWriteViolationError(target);
}

/** Build a suggestion, enforcing the safety invariants at construction time. */
export function buildUsgAiSuggestion(input: {
  kind: UsgAiSuggestionKind;
  section?: string | null;
  text: string;
  rationale: string;
  confidence: number;
  evidence?: Record<string, string | number | null>;
}): UsgAiSuggestion {
  const text = input.text.trim();
  // PCPNDT / sex-disclosure guard — AI can never surface fetal sex.
  if (FORBIDDEN_TOKENS.test(text) || FETAL_SEX.test(text)) {
    throw new Error("AI suggestion blocked: fetal sex / gender content is not permitted (PCPNDT).");
  }
  return {
    kind: input.kind,
    section: input.section ?? null,
    text,
    rationale: input.rationale.trim(),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    writeTarget: "draft_suggestion",
    status: "suggested",
    requiresHumanAcceptance: true,
    evidence: input.evidence,
  };
}

export interface AiVisibility {
  visible: boolean;
  reason: string;
}

/**
 * Whether USG AI suggestions may be SHOWN to the radiologist, reusing the
 * canonical enablement. Even when visible, suggestions remain accept-only.
 */
export function gateUsgAiVisibility(enablement: Enablement): AiVisibility {
  return {
    visible: enablement.visibleToRadiologist,
    reason: enablement.visibleToRadiologist ? `AI visible (${enablement.reason})` : `AI hidden (${enablement.reason})`,
  };
}

export interface AcceptResult {
  text: string;
  changed: boolean;
  /** True when existing radiologist text was preserved (append/merge, not overwrite). */
  preservedExisting: boolean;
}

/**
 * Apply an accepted suggestion to a draft section's current text. NON-destructive:
 * existing text is never overwritten — the suggestion is appended only if it
 * isn't already present. Acceptance is an explicit human action; this function
 * must not be called for a suggestion the radiologist did not accept.
 */
export function acceptSuggestionIntoDraft(
  currentText: string,
  suggestion: UsgAiSuggestion,
  accepted: boolean,
): AcceptResult {
  assertAiWriteAllowed(suggestion.writeTarget);
  const existing = (currentText ?? "").trim();
  if (!accepted) return { text: existing, changed: false, preservedExisting: !!existing };

  const add = suggestion.text.trim();
  if (!add) return { text: existing, changed: false, preservedExisting: !!existing };
  if (existing && existing.toLowerCase().includes(add.toLowerCase())) {
    return { text: existing, changed: false, preservedExisting: true };
  }
  const merged = existing ? `${existing}\n${add}` : add;
  return { text: merged, changed: true, preservedExisting: !!existing };
}
