/**
 * The signed-artifact trust model, as pure decisions.
 *
 * Extracted from the patient-reports routes so the rules can be executed by a
 * test instead of being inferred from source text. Everything here is a
 * function of the stored row and the request payload — no database, no session
 * object, no Express.
 *
 * The invariant this exists to hold:
 *
 *   SIGNED ARTIFACT = exact signed content
 *                   + authoritative signer
 *                   + authoritative signing time
 *                   + immutable signed state
 *                   + auditable subsequent amendment history
 *
 * A finalized report must never silently become a different report. Correction
 * goes through the amendment chain (POST /:id/amend) or through an explicit,
 * attributed withdrawal of the signature — never through an ordinary update.
 */

/** Lifecycle states in which a report has already been signed by somebody. */
export const SIGNED_REPORT_STATUSES = ["pending_verification", "verified", "delivered"] as const;

/**
 * The clinical content of the report. Once signed, these are the signed bytes:
 * changing one of them in place makes the artifact say something its signer
 * never said, while still carrying their name and the original timestamp.
 */
export const PROTECTED_SIGNED_FIELDS = ["body", "parameters", "title", "impression"] as const;

export type SignedArtifactRow = {
  status?: string | null;
  signedAt?: Date | string | null;
  structuredJson?: unknown;
};

/**
 * Whether this row is a signed medico-legal artifact.
 *
 * Three independent witnesses, any one of which is sufficient:
 *  - `signedAt` is set (the legacy path stamps it at POST /:id/sign);
 *  - the lifecycle status is at or past signing. `pending_verification` is
 *    included deliberately: it means "signed, awaiting counter-signature", and
 *    it was the one signed state the old guard omitted, so a signed report's
 *    body stayed editable in place right up to verification;
 *  - the row carries a signed-FINAL structured document (the D5 path keeps the
 *    schema-default status "draft", so status alone cannot see it).
 */
export function isSignedArtifact(row: SignedArtifactRow): boolean {
  if (row.signedAt != null) return true;
  if (SIGNED_REPORT_STATUSES.includes(row.status as (typeof SIGNED_REPORT_STATUSES)[number])) return true;
  const doc = row.structuredJson as { audit?: { signature?: { state?: string } } } | null;
  return doc?.audit?.signature?.state === "final";
}

export type SignedPatchDecision =
  | { allow: true }
  | {
      allow: false;
      code: "signed_report_immutable" | "critical_state_immutable";
      message: string;
      fields: string[];
    };

function isPresent(body: Record<string, unknown>, key: string): boolean {
  return typeof body[key] !== "undefined";
}

/**
 * Whether an ordinary PATCH may proceed.
 *
 * Two separate refusals, because they protect two different things:
 *
 * 1. Signed clinical content is immutable. `verified` and `delivered` were
 *    already refused; this extends the same contract to every signed state, so
 *    there is no window in which a signed report can be rewritten under its own
 *    signature.
 *
 * 2. A critical-result flag and its acknowledgement cannot be cleared. Setting
 *    `isCritical: false` also nulls `criticalNote`, `criticalAcknowledgedAt`
 *    and `criticalAcknowledgedBy` — so it silently deletes the record that
 *    somebody was told about a life-threatening finding, with no actor and no
 *    audit row. That is refused on a signed report, and also on any report that
 *    has already been acknowledged even if it is still a draft: the
 *    acknowledgement is a fact about the world, not a property of the report's
 *    lifecycle stage. Escalating a report TO critical is always allowed —
 *    that direction adds a safety obligation rather than removing one.
 */
export function classifySignedReportPatch(opts: {
  signed: boolean;
  criticalAcknowledgedAt?: Date | string | null;
  body: Record<string, unknown>;
}): SignedPatchDecision {
  const { signed, criticalAcknowledgedAt, body } = opts;

  const touchedProtected = PROTECTED_SIGNED_FIELDS.filter((f) => isPresent(body, f));
  if (signed && touchedProtected.length > 0) {
    return {
      allow: false,
      code: "signed_report_immutable",
      message: "A signed report cannot be edited in place. Use Amend to create a corrected version, or withdraw the signature first.",
      fields: touchedProtected,
    };
  }

  const acknowledged = criticalAcknowledgedAt != null;
  const clearsFlag = body.isCritical === false;
  const clearsNote =
    body.criticalNote === null ||
    (typeof body.criticalNote === "string" && body.criticalNote.trim() === "");
  if ((signed || acknowledged) && (clearsFlag || (acknowledged && clearsNote))) {
    return {
      allow: false,
      code: "critical_state_immutable",
      message: acknowledged
        ? "This critical result has been acknowledged. The flag, the note and the acknowledgement cannot be cleared."
        : "The critical flag on a signed report cannot be cleared. Escalating it is allowed; removing it is not.",
      fields: [clearsFlag ? "isCritical" : "criticalNote"],
    };
  }

  return { allow: true };
}

export type SignerIdentity = {
  name: string;
  /** Where the authoritative name came from. Never "caller". */
  source: "signature_record" | "session";
  /** The name the caller asserted, when it differs from the authoritative one. */
  rejectedCallerName: string | null;
};

/**
 * Resolve the signer of record from server-side facts only.
 *
 * A `signatureId` selects which uploaded signature block is applied; its name
 * is read from that database row. With no signature chosen, the signer is the
 * authenticated session subject. A name typed into the request body is never
 * used — it is returned separately so the route can audit the attempt, because
 * a client asserting a colleague's name is exactly the mis-attribution this
 * exists to prevent.
 */
export function resolveSignerIdentity(opts: {
  sessionName?: string | null;
  signatureName?: string | null;
  callerSuppliedName?: unknown;
}): SignerIdentity {
  const caller = typeof opts.callerSuppliedName === "string" ? opts.callerSuppliedName.trim() : "";
  const sessionName = opts.sessionName?.trim() ?? "";
  const signatureName = opts.signatureName?.trim() ?? "";

  const name = signatureName || sessionName;
  const source: SignerIdentity["source"] = signatureName ? "signature_record" : "session";
  const rejectedCallerName = caller && caller !== name ? caller : null;
  return { name, source, rejectedCallerName };
}

/** A relayed person name is bounded so it cannot smuggle content or overflow. */
export const MAX_RELAYED_PERSON_NAME = 200;

export function boundRelayedPersonName(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  const name = text.slice(0, MAX_RELAYED_PERSON_NAME);
  return name || fallback;
}

/** How far ahead of the server clock a relayed instant is still believable. */
export const MAX_RELAYED_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type RelayedInstant = {
  at: Date;
  source: "relay" | "server";
  /** Why the caller's value was not used, when it was not. */
  rejected: "absent" | "unparseable" | "future_dated" | null;
};

/**
 * Bound an instant relayed by a machine-to-machine integration.
 *
 * The reporting-studio and boundary bridges authenticate with a shared service
 * key, so there is no person and no session to derive a time from — the relay's
 * own value is the only candidate. It is accepted only if it parses and is not
 * in the future beyond clock skew; a future-dated signature is the dangerous
 * direction, since it post-dates the evidence for whatever it signs. A past
 * value is kept (a service relaying yesterday's finalized report is normal) and
 * the route records the server's receipt time beside it, so there is always an
 * authoritative instant even when the relay's is stored.
 */
export function resolveRelayedInstant(raw: unknown, now: Date): RelayedInstant {
  if (typeof raw !== "string" || !raw.trim()) return { at: now, source: "server", rejected: "absent" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { at: now, source: "server", rejected: "unparseable" };
  if (parsed.getTime() > now.getTime() + MAX_RELAYED_FUTURE_SKEW_MS) {
    return { at: now, source: "server", rejected: "future_dated" };
  }
  return { at: parsed, source: "relay", rejected: null };
}
