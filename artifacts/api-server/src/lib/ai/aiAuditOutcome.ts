/**
 * `ai_reporting_audit_logs.success` has one meaning, and it is not "the HTTP call
 * finished".
 *
 * The column answers the question a radiologist or an auditor actually asks — did
 * this request produce clinical content a human could use? — and the table's own
 * writer documents it that way (`imageSendAudit.ts`: "The clinician was given
 * usable text"). Two of the eight writers already obey that rule. The rest
 * computed `success` from the transport result and the provider's name, so a
 * provider that answered 200 with an empty body, or prose that was never a
 * draft, was filed as a successful clinical generation. `/query` went furthest:
 * it wrote `success = true` and a non-null `error_message` on the same row, so
 * one record asserted and denied the same thing.
 *
 * The vocabulary for "the provider answered but there was nothing to read" already
 * exists — `normalizeAiFailure` returns `EMPTY_RESPONSE` for exactly that shape,
 * and the interactive gateway's contract is that a null `failure` is the only
 * state in which a call "may be recorded and returned as a success"
 * (`interactiveAiGateway.ts`). This module is that rule written down once, so a
 * fifth route cannot forget it and a sixth cannot invent its own.
 *
 * What this deliberately does NOT do: change an HTTP status. `/draft` established
 * the house convention for an unusable answer — 200 plus a `failure` object the
 * client can branch on, with the audit row refusing the success claim. Routes
 * keep their own status logic; only the record and the named cause are shared.
 */

/** A usable answer is text with something in it. Whitespace is not a finding. */
export function isUsableAnswerText(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

export interface AiAuditOutcomeInput {
  /** What the provider layer reported about the call itself. */
  providerReportedSuccess: boolean;
  /** The execution layer named the provider that answered, and it is the one asked. */
  identityVerified: boolean;
  /** The gateway/normalizer verdict. Non-null means this call may not claim success. */
  failure?: { code?: string | null; message?: string | null } | null;
  /** The answer handed to the clinician, for routes whose output is prose. */
  answerText?: string | null;
  /**
   * Structured routes (a parsed draft, a set of proposals) decide usability
   * themselves and pass it here. Supplying it overrides `answerText`.
   */
  usableContent?: boolean | null;
  /** The provider's own error sentence, used only when there is no normalized failure. */
  providerError?: string | null;
}

export interface AiAuditOutcome {
  /** The value for the `success` column. */
  success: boolean;
  /** The value for `error_message`: null exactly when `success` is true. */
  errorMessage: string | null;
}

/**
 * The sentence for the shape that used to be recorded as a success: the call
 * worked, and there is nothing in it. Kept separate from a provider error
 * because the two need different fixes — one is infrastructure, the other is a
 * model that was asked for a report and produced none.
 */
export const NO_USABLE_CONTENT_MESSAGE =
  "The AI provider answered but produced no usable clinical content — recorded as a failed generation, not a success.";

/**
 * Decide what one AI generation row is allowed to claim.
 *
 * Order matters and is the order of certainty: what the provider reported, then
 * whether the answer can be attributed at all, then whether anything usable came
 * back. A row that fails the first two tests cannot be rescued by the third.
 */
export function resolveAiAuditOutcome(input: AiAuditOutcomeInput): AiAuditOutcome {
  const contentUsable =
    input.usableContent !== undefined && input.usableContent !== null
      ? input.usableContent
      : isUsableAnswerText(input.answerText);

  if (!input.providerReportedSuccess) {
    return {
      success: false,
      errorMessage:
        input.failure?.message ?? input.providerError ?? "The AI provider did not complete the request.",
    };
  }
  if (!input.identityVerified) {
    return {
      success: false,
      errorMessage:
        input.failure?.message ??
        "The AI provider that answered could not be confirmed, so its answer cannot be recorded as a generation.",
    };
  }
  if (input.failure) {
    return {
      success: false,
      errorMessage: input.failure.message ?? NO_USABLE_CONTENT_MESSAGE,
    };
  }
  if (!contentUsable) {
    return { success: false, errorMessage: NO_USABLE_CONTENT_MESSAGE };
  }
  return { success: true, errorMessage: null };
}
