/**
 * The one sentence the AI Draft panel shows after a "Generate Draft with AI" press.
 *
 * `POST /api/ai/generate` answers `{ enqueued, reason }` (`lib/aiClient.ts:109`), and the
 * reason is the whole explanation: `schedulerService.ts:84` refuses with "master flag off",
 * `:91` with a duplicate-enqueue notice, `:130` with the scheduler's own deferral text, and
 * `routes/aiClinical.ts:82,88` answers 403 when AI is off for the account or the modality.
 * The panel used to `await` that call and drop the answer, so the spinner stopped and a
 * refusal, a failure and a successful queue looked identical to the radiologist.
 *
 * Kept out of the component because the component has no test renderer in this package: the
 * wording is a clinical-trust surface and belongs where a test can assert every branch,
 * including that the server's own words survive into the sentence.
 */

export type AiGenerateOutcome = {
  enqueued?: boolean;
  reason?: string;
  jobId?: number | null;
};

export function describeAiGenerateOutcome(outcome: AiGenerateOutcome | null | undefined): string {
  if (outcome?.enqueued) {
    const job = outcome.jobId == null ? "" : ` (job #${outcome.jobId})`;
    return `Queued for an AI draft${job}: ${outcome.reason ?? "the server did not say why"}`;
  }
  // A 200 with `enqueued: false` is a REFUSAL, not a failure — and the reason is the
  // sentence the radiologist needs, verbatim. "No reason given" is deliberate: an empty
  // reason must not render as a bare "Not queued: " and read as a broken label.
  return `Not queued: ${outcome?.reason?.trim() || "the server gave no reason"}`;
}

/** The thrown-error form, for the 403/5xx paths that never produce an outcome object. */
export function describeAiGenerateFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  return `Not queued: ${message || "the request failed"}`;
}
