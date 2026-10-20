/**
 * draftAwarePrintSettings.ts — a document nobody has authorized must not
 * leave the building looking final.
 *
 * CARE's PDF generator has carried a print-settings watermark for years: a
 * 45-degree text drawn across every page when `settings.watermark` is set.
 * Nothing ever set it for the radiology export, so an unsigned draft exported
 * through Download PDF was pixel-identical to a signed report apart from the
 * configured signature block — a draft could be handed out as final, and the
 * only thing distinguishing it was the absence of a name (D-06).
 *
 * This helper is deliberately ONE job: the watermark. Who may SIGN the
 * document — the signer's identity, eligibility, and what an unsigned export
 * may print in the signature block's place — belongs to the signer-authority
 * system (PR #1085's signatures-from-records, open PR #1088's
 * signer-of-record/unsigned selection). This module does not touch
 * `settings.signature` and composes with both: they decide who is on the
 * document, this decides whether the document says DRAFT.
 *
 * `authorized.unsigned` follows #1088's semantics: true when nothing has
 * authorized the document (a draft, or a finalized row whose signature never
 * happened), false when a signature is on record. Omitted counts as
 * UNSIGNED — a caller that did not ask about authorization has no basis to
 * print a clean document.
 */

export type DraftAwarePrintSettings = { watermark: string };

export type DraftAuthorization = {
  /**
   * True when nothing has authorized this document. `false` means a signature
   * is on record. Omitted/null is read as unsigned on purpose.
   */
  unsigned?: boolean | null;
};

/** The watermark an unauthorized radiology export carries. */
export const DRAFT_WATERMARK_TEXT = "DRAFT";

export function draftAwarePrintSettings<T extends DraftAwarePrintSettings>(
  settings: T,
  authorized: DraftAuthorization,
): T {
  const signed = authorized.unsigned === false;
  if (signed) return settings;
  // The clinic's own configured watermark (any text) outranks ours: it is a
  // deliberate print setting, not an absence of one.
  if ((settings.watermark ?? "").trim()) return settings;
  return { ...settings, watermark: DRAFT_WATERMARK_TEXT };
}
