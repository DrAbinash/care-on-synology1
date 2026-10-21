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

/**
 * The AI doors also refuse for reasons that are not a failed generation: a study this
 * clinic does not have, a patient id that contradicts the study's own record, a draft
 * that belongs to someone else. Each carries `code` and a sentence naming both sides,
 * and none of them is the no-usable-result sentence above.
 *
 * Shown as itself because the two ask different things of the clinician. A generation
 * failure means try again; an identity refusal means the screen is pointing at the wrong
 * patient, study or draft, and pressing the same button again changes nothing. Collapsing
 * the second into the first is how a cross-patient guard stops being a guard: the
 * radiologist reads a model complaint, and the mismatch that stopped the send is never seen.
 *
 * The sentence comes from the server verbatim — it names the ids, which only the server
 * knows — so this file supplies the headline and nothing else.
 */
const AI_IDENTITY_TITLES: Record<string, string> = {
  STUDY_NOT_IN_CLINIC: "This study is not in the clinic",
  PATIENT_ID_MISMATCH: "The patient does not match this study",
  STUDY_UID_MISMATCH: "The study does not match this record",
  WORKLIST_NOT_FOUND: "This worklist row does not exist",
  NO_STUDY_UID: "No study to report on",
  DRAFT_NOT_FOUND: "That draft no longer exists",
  DRAFT_STUDY_MISMATCH: "That draft belongs to another study",
  DRAFT_NOT_YOURS: "That draft belongs to another radiologist",
};

/** The refusal's code, or null when this was not an identity refusal. */
export function aiIdentityCode(error: unknown): string | null {
  const details = (error as { details?: unknown } | null | undefined)?.details;
  const code = (details as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code in AI_IDENTITY_TITLES ? code : null;
}

/**
 * What to show for an AI call that was refused for an identity reason, or null when the
 * failure is an ordinary one and the shared no-usable-result sentence is the true thing
 * to say.
 */
export function aiIdentityProblem(
  error: unknown,
): { title: string; description: string; code: string } | null {
  const code = aiIdentityCode(error);
  if (!code) return null;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  // The server's sentence is the content. A refusal that only repeats the code has
  // replaced one unusable message with another.
  const description = typeof message === "string" && message.trim().length > 0
    ? message
    : "Nothing was sent to the AI and nothing was saved.";
  return { title: AI_IDENTITY_TITLES[code] ?? "The AI request was refused", description, code };
}
