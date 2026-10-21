/**
 * The one sentence a radiologist is shown when an AI call came back with nothing
 * they can use.
 *
 * It lives here because four surfaces ask the same question — Ctrl+I impression,
 * the AI query panel, the image-review assistant and the model comparison page —
 * and per-surface wording is how a failed generation starts to read as a clinical
 * finding. The unmounted Composer panel still says "No additional findings
 * suggested." for an empty answer, which is the failure mode this file exists to
 * prevent: the clinician is told the images were reviewed and were clear.
 *
 * Deliberately free of provider text, codes and exception messages. The cause is
 * filed in the AI audit log against the request's `requestId`, where an
 * administrator can read it; at the reporting keyboard it is enough to know the
 * report was not touched.
 */
export const AI_NO_USABLE_RESULT_TITLE = "No usable AI response";
export const AI_NO_USABLE_RESULT =
  "AI could not generate a usable response. Your report has not been changed.";

/**
 * True only when the model actually produced readable text. Whitespace is not an
 * answer: `qwen3-vl:8b` was measured answering HTTP 200 with an empty body on 9 of
 * 9 attempts, and every surface that trusted transport alone called that a draft.
 */
export function aiAnswerIsUsable(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

/**
 * The server's own verdict, when the response carried one. `failure` is the object
 * the audit row is filed from, so a surface that shows a success while it is
 * present disagrees with the record an auditor reads.
 */
export function aiResponseCarriesFailure(failure: unknown): boolean {
  return failure != null;
}
