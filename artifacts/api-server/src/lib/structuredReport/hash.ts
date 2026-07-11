// ─────────────────────────────────────────────────────────────────────────────
// content_sha256 computation — Ticket D2, implementing D1 §10's hash definition
// (docs/STRUCTURED_REPORT_JSON_SPEC_v1.md, frozen spec revision 2).
//
// D1 §10 (verbatim intent):
//   content_sha256 = SHA-256( JCS(document_root_with_exclusions) )
//   where the entire top-level document object is canonicalized with RFC 8785
//   JCS AFTER removing exactly two members by JSON Pointer:
//       /audit/content_sha256
//       /audit/signature/signed_content_sha256
//   EVERY other field — including signature.signed_by / signed_role / signed_at
//   / state / amends_document_id — IS part of the hashed content, so authorship
//   and signing metadata cannot be forged without invalidating the hash.
//
// The two-member exclusion is what lets the writer STAMP content_sha256 (and, at
// finalize, signed_content_sha256) into the document *after* computing the hash
// without changing it — those two fields are outside the preimage by
// construction. This is the property that makes the hash a fixed point, and the
// `hash.test.ts` exclusion tests pin it directly.
//
// `audit.hash_algorithm` ("jcs-sha256/1") names the scheme in every document so
// a future canonicalization change ships as a new algorithm id; a verifier
// always recomputes with the algorithm named in the document it is verifying.
// This module implements only "jcs-sha256/1".
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { jcsCanonicalize } from "./canonicalizer";

/** The only hash scheme this module implements, matching `audit.hash_algorithm`
 *  (D1 §18). New schemes get new suffixes; existing ids are never redefined. */
export const CONTENT_HASH_ALGORITHM = "jcs-sha256/1" as const;

/** Digest prefix used throughout the spec's fixtures (`"sha256:<64 lowercase hex>"`,
 *  matching `model_digest`/`prompt_digest`/`content_sha256` in the D1 §17 examples). */
export const CONTENT_HASH_PREFIX = "sha256:" as const;

/** The exact members removed from the hash preimage, by JSON Pointer (D1 §10). */
export const HASH_EXCLUDED_POINTERS = [
  "/audit/content_sha256",
  "/audit/signature/signed_content_sha256",
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Return a copy of `document` with exactly the two D1 §10 members removed. Only
 * the objects ON the path to those members are shallow-copied; everything else
 * is shared by reference — safe because JCS only READS the value. Never mutates
 * the input.
 */
export function stripHashExclusions(document: unknown): unknown {
  if (!isPlainObject(document)) return document;
  const top: Record<string, unknown> = { ...document };

  if (isPlainObject(top.audit)) {
    const audit: Record<string, unknown> = { ...top.audit };
    delete audit.content_sha256;

    if (isPlainObject(audit.signature)) {
      const signature: Record<string, unknown> = { ...audit.signature };
      delete signature.signed_content_sha256;
      audit.signature = signature;
    }
    top.audit = audit;
  }
  return top;
}

/**
 * The exact byte string SHA-256 is taken over (`JCS(document_without_exclusions)`).
 * Exposed for golden byte-for-byte fixtures and debugging; most callers want
 * {@link computeContentSha256}.
 */
export function contentHashPreimage(document: unknown): string {
  return jcsCanonicalize(stripHashExclusions(document));
}

/**
 * Compute `content_sha256` for a structured-report document per D1 §10.
 * Deterministic and pure. Returns `"sha256:<64 lowercase hex>"`.
 *
 * Stable under the two stamped fields: because `/audit/content_sha256` and
 * `/audit/signature/signed_content_sha256` are excluded from the preimage,
 * `computeContentSha256(doc)` is unchanged whether those fields are absent,
 * null, a placeholder, or already equal to the correct digest.
 */
export function computeContentSha256(document: unknown): string {
  const preimage = contentHashPreimage(document);
  const hex = createHash("sha256").update(preimage, "utf8").digest("hex");
  return CONTENT_HASH_PREFIX + hex;
}

export interface ContentHashVerification {
  ok: boolean;
  /** The digest recomputed from the document's current content. */
  computed: string;
  /** The digest stamped in `audit.content_sha256` (null if absent). */
  stored: string | null;
}

/**
 * Recompute the digest and compare it to the one stamped in
 * `audit.content_sha256`. Tamper-evidence check for a stored/received document
 * (D1 §10): any change to hashed content makes `computed` diverge from
 * `stored`. Note this is the CONTENT hash check; finalize-signature agreement
 * (`signed_content_sha256 === content_sha256`) is validator rule R14.
 */
export function verifyContentSha256(document: unknown): ContentHashVerification {
  const stored =
    isPlainObject(document) && isPlainObject(document.audit) && typeof document.audit.content_sha256 === "string"
      ? (document.audit.content_sha256 as string)
      : null;
  const computed = computeContentSha256(document);
  return { ok: stored !== null && stored === computed, computed, stored };
}
