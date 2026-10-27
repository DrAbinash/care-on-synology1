/**
 * Which signature a report may be authorized under — read off the records, never a name.
 *
 * Two places on the authorization pathway used to decide this by matching one
 * doctor's name case-insensitively against every signature row on file
 * (`autoSignReport` and the finalize dialog). A regular expression over a
 * person's name is not an authorization rule: with a second radiologist on file
 * it kept choosing the first one, so reports the second radiologist wrote were
 * recorded — and printed — as signed by someone who never read them. It also
 * made the clinic's ability to sign depend on nobody else in the building
 * sharing part of a name.
 *
 * The rule here is structural, over the rows `/api/signatures` already returns and the
 * `signatures` table already holds:
 *
 *   active only        a deactivated block (`isActive: false`, which is what DELETE does)
 *                      must not authorize a new report;
 *   role where it exists  Radiologist blocks are the pool when the clinic has marked any;
 *   else the active set   Report Hub's role dropdown opens on Pathologist and POST defaults
 *                      role to "Doctor" (`patient-reports.ts:1293`), so a perfectly
 *                      configured clinic can have no block marked Radiologist. Falling back
 *                      keeps that clinic signing; it does not widen who may sign, because
 *                      the fallback pool is still only the active rows.
 *
 * One eligible block is the default — that is the single-radiologist clinic, unchanged in
 * behaviour and now independent of who she is called. More than one needs an explicit
 * choice: nothing here picks a person for them. A preference (`radiology_finalize_signer_id`
 * in sessionStorage) is honoured only while it stays inside the pool, because it is a
 * browser-local convenience, not authority.
 */

export type SignerRow = {
  id: number;
  name: string;
  role?: string | null;
  isActive?: boolean;
  qualification?: string | null;
  registrationNo?: string | null;
  imageDataUrl?: string | null;
  /** The staff account the block belongs to; null = never claimed. */
  userId?: number | null;
};

/** What a printed signature block is made of, as the record holds it. */
export type RecordedSigner = {
  name: string;
  qualification: string | null;
  registrationNo: string | null;
  imageDataUrl: string | null;
};

export type SignerChoice =
  | { kind: "preferred"; signatureId: number }
  | { kind: "single"; signatureId: number }
  | { kind: "choose"; candidates: SignerRow[] }
  | { kind: "refused"; reason: "not-eligible" }
  | { kind: "none" };

const RADIOLOGIST_ROLE = "Radiologist";

/**
 * The blocks THIS account may authorize a report with, in the order the server listed
 * them.
 *
 * `viewerUserId` is the logged-in staff account id. A block owned by a different
 * account is not offered at all: measured before this rule, the Report Hub Sign dialog
 * defaulted to a colleague's block for a user whose own block had been retired, so the
 * one-click path authorized the report under the wrong doctor's name. Passing no
 * `viewerUserId` keeps the old behaviour, which is what a caller that cannot know the
 * viewer's id must do — the server still refuses a block that is not the caller's.
 */
export function eligibleSigners(rows: readonly SignerRow[], viewerUserId?: number | null): SignerRow[] {
  const mine = viewerUserId == null
    ? rows
    : rows.filter((r) => r.userId == null || r.userId === viewerUserId);
  const active = mine.filter((r) => r.isActive !== false);
  const radiologists = active.filter((r) => r.role === RADIOLOGIST_ROLE);
  return radiologists.length > 0 ? radiologists : active;
}

export function resolveSignerChoice(
  rows: readonly SignerRow[],
  preferredSignatureId?: number | null,
  viewerUserId?: number | null,
): SignerChoice {
  const pool = eligibleSigners(rows, viewerUserId);
  if (preferredSignatureId != null) {
    return pool.some((r) => r.id === preferredSignatureId)
      ? { kind: "preferred", signatureId: preferredSignatureId }
      : { kind: "refused", reason: "not-eligible" };
  }
  if (pool.length === 0) return { kind: "none" };
  if (pool.length === 1) return { kind: "single", signatureId: pool[0]!.id };
  return { kind: "choose", candidates: pool };
}
