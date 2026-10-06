import { api, isHttpError } from "./fetchApi";

/**
 * reportSignatureWithdrawal.ts — the client half of
 * POST /api/patient-reports/:id/withdraw-signature.
 *
 * The server route already does the whole job: it nulls the signature, puts the
 * report back to "draft", reopens the bound radiology worklist row to
 * REPORT_IN_PROGRESS, clears a delivery status that would otherwise advertise
 * an unsigned report as ready to hand over, and writes an attributed audit
 * event carrying the reason (patient-reports.ts:2838-2970). What it did not
 * have was a caller. Nothing in diagnostic-erp invoked it, so the only way to
 * take back a signature was to issue the request by hand — which is to say a
 * radiologist who signed the wrong study, or signed before the impression was
 * finished, had no way back from the app.
 *
 * This module is deliberately pure (no React, no DOM) so the gate and the
 * refusal mapping are testable in this repo's node-environment vitest; only
 * ReportHub renders anything.
 */

/** The subset of a Report Hub row the withdrawal gate needs. */
export type WithdrawableReportRow = {
  status: string | null;
  signedAt?: string | null;
  signedByName?: string | null;
  structuredJson?: { audit?: { signature?: { state?: string } } } | null;
  /**
   * Only GET /:id rows carry `lifecycle.structuredSigned`; list rows carry
   * `structuredJson` instead. Both are accepted so one gate serves both
   * surfaces rather than each growing its own idea of "signed structured".
   */
  structuredSigned?: boolean;
};

/**
 * Whether Report Hub should offer to withdraw this row's signature.
 *
 * Mirrors the server's own refusals so the button is not offered for a row the
 * route would reject — a doomed click on a clinical correction is worse than no
 * click. The two things this cannot know client-side are deliberately left to
 * the server, which enforces both and answers with a sentence this module
 * surfaces verbatim: whether the caller is the signer or an administrator
 * (:2882-2895), and whether the bound worklist row is already DELIVERED
 * (:2932-2934).
 */
export function canWithdrawSignature(row: WithdrawableReportRow): boolean {
  // Verified and delivered are past the point the server will un-sign; those
  // rows are pointed at amendment instead (:2866-2874).
  if (row.status === "verified" || row.status === "delivered") return false;
  // A row carrying a signed structured document is refused with
  // `structured_signed_report` and sent to POST /:id/amend (:2875-2881). The
  // server's gate also requires a string `document_id`, which the Report Hub
  // list row type does not carry, so signature state alone is the proxy here.
  // That is narrower than the server, which withholds the button rather than
  // showing one that 409s.
  if (row.structuredSigned === true) return false;
  if (row.structuredJson?.audit?.signature?.state === "final") return false;
  // What remains must still actually be signed, or the route answers 409
  // `not_signed` (:2857-2860). isSignedArtifact counts a row as signed when
  // signedAt is set, or the status is one of pending_verification / verified /
  // delivered, or the structured document is final (signedArtifactGuard.ts:50-55);
  // the latter two are already excluded above, leaving pending_verification.
  return row.signedAt != null || row.status === "pending_verification";
}

export type WithdrawalOutcome =
  | { withdrawn: true; status: string | null }
  | { withdrawn: false; error: string };

/**
 * The sentence a person should read out of a failed withdrawal.
 *
 * This route family puts a machine token in `error` and the sentence in
 * `message` — except the refusals raised inside the transaction, which come
 * back as `{ error: <code>, detail: <sentence> }` (:2957). `sanitizeApiErrorMessage`
 * prefers `error` whenever it is non-generic, and a snake_case token is not in
 * its generic list, so without this the toast would read `not_the_signer`.
 */
export function withdrawalRefusalText(err: unknown): string {
  if (isHttpError(err)) {
    const body = err.details as { message?: unknown; detail?: unknown } | undefined;
    for (const field of [body?.message, body?.detail]) {
      if (typeof field === "string" && field.trim()) return field.trim();
    }
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return "Could not withdraw the signature.";
}

/**
 * Withdraws a signature. Never throws: the caller decides how to present the
 * refusal, and an exception escaping a correction path is how a radiologist
 * ends up not knowing whether the report is still signed.
 *
 * An empty reason is refused here with the server's own sentence rather than
 * spent on a round trip that answers 400 for the same reason (:2847-2851).
 */
export async function withdrawReportSignature(
  reportId: number,
  reason: string,
): Promise<WithdrawalOutcome> {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { withdrawn: false, error: "Say why the signature is being withdrawn." };
  }
  try {
    const row = await api.post<{ status?: string | null }>(
      `/api/patient-reports/${reportId}/withdraw-signature`,
      { reason: trimmed },
    );
    return { withdrawn: true, status: row?.status ?? null };
  } catch (err) {
    return { withdrawn: false, error: withdrawalRefusalText(err) };
  }
}

/**
 * The narrowest shape of a React Query client this module needs, so the
 * invalidation is testable here in node rather than only assertable as text in
 * the page that renders the dialog. A real `QueryClient` satisfies it.
 */
export type QueryCacheInvalidator = {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
};

/**
 * What has to be dropped from the cache for a withdrawal to take effect in the
 * reporting workspace.
 *
 * The workspace decides whether a study is signed from `["pacs-worklist-detail",
 * studyId]`, cached with a 60-second `staleTime` and preferred over the queue row
 * (useWorkspaceClinicalUi.tsx:789-790). The route reverts the worklist row to
 * REPORT_IN_PROGRESS in the same transaction, but nothing on this side of it
 * refetches — so the workspace keeps locking a report the signature has already
 * come off, for up to a minute, with nothing on screen to say why.
 *
 * Signing already knew this: useStudyFinalize.ts:517-522 invalidates both keys
 * and says so in a comment. Withdrawal is the mirror case and was missed.
 *
 * The detail key is invalidated by prefix rather than per study because a Report
 * Hub row carries no studyId — the pointer the route follows is
 * radiology_worklist.report_id, which the list endpoint does not return — and
 * the withdrawn study is whichever one the radiologist opens next.
 */
export const WORKLIST_CACHE_KEYS_AFTER_WITHDRAWAL: ReadonlyArray<readonly unknown[]> = [
  ["pacs-worklist-detail"],
  ["radiology-pacs-worklist"],
];

/**
 * Drops the cached worklist rows a withdrawal has just made wrong. Call it only
 * after `withdrawReportSignature` returned `{ withdrawn: true }`: on a refusal
 * the server changed nothing, and dropping the cache then would refetch a row
 * that still says signed and make the refusal look like a flicker.
 */
export function invalidateWorklistCachesAfterWithdrawal(qc: QueryCacheInvalidator): void {
  for (const queryKey of WORKLIST_CACHE_KEYS_AFTER_WITHDRAWAL) {
    void qc.invalidateQueries({ queryKey });
  }
}
