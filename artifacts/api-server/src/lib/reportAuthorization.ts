/**
 * reportAuthorization.ts — the ONE rule for "this report may physically leave
 * the clinic".
 *
 * The owner's ruling (2026-10-25): Dr Sugandha signs every printed report by
 * pen, and a countersignature must NOT be demanded just to hand paper over —
 * while an unsigned report must never be deliverable.
 *
 * Why the electronic `verified` status cannot be the gate: `/verify` refuses a
 * verifier whose signature block is the signer's
 * (`patient-reports.ts:2997, 3017` — "Verifier must be a different person from
 * the signer"). A single-signature reporting setup therefore never reaches
 * `verified`, and gating delivery on it would make every report in the clinic
 * undeliverable. Delivery surfaces already accept a signed-but-not-countersigned
 * report (`patient-reports.ts:3981-3983, 3995, 4058`), so this predicate matches
 * the release rule the clinic actually runs instead of inventing a stricter one.
 *
 * What it does NOT do: it never treats a print, PDF download, WhatsApp send or
 * `status='delivered'` as evidence that paper changed hands — those are recorded
 * in `report_shares` / `report_custody_events`, not here. And it does not relax
 * the clinical record itself: `signedArtifactGuard.isSignedArtifact` stays the
 * authority for immutability questions, and this file deliberately does not
 * reuse it, because "is this artifact frozen" and "may this be handed to a
 * patient" are different questions that must be allowed to disagree.
 */

export type ReportAuthorizationInput = {
  status: string | null;
  signedAt?: Date | string | null;
  signatureId?: number | null;
};

/** Countersigned states. A report in either is released even if the signature
 *  columns were written by an older code path. */
const COUNTERSIGNED_STATUSES = new Set(["verified", "delivered"]);

export function isReportClinicallyAuthorized(row: ReportAuthorizationInput | null | undefined): boolean {
  if (!row) return false;
  // A draft is never deliverable, whatever else its columns claim.
  if (row.status === "draft") return false;
  // The pen signature is recorded by the sign route as signedAt + signatureId,
  // which moves the report to pending_verification.
  if (row.signedAt != null || row.signatureId != null) return true;
  return COUNTERSIGNED_STATUSES.has(String(row.status));
}

/** The sentence a counter clerk sees when the answer is no. Keep it in one place
 *  so the same refusal reads the same on every surface. */
export const UNSIGNED_REPORT_REFUSAL =
  "This report has no signature recorded yet. A signed report can be handed over; an unsigned one cannot.";
