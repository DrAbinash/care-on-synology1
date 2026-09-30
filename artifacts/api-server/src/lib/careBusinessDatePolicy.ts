/**
 * CARE trusted business-date enforcement primitive — final business-time policy,
 * Phase C. The single server-side place that decides whether a submitted
 * business date may be written.
 *
 * THE RULE IT IMPLEMENTS (management policy §0/§2/§3, no exceptions invented):
 *   CREATE — an ordinary staff entry's Class-A business date must equal the
 *            current trusted CARE clinic date. A date is not corrected
 *            silently and not substituted: any explicit value that is not
 *            today's CARE date is rejected with a validation error.
 *   UPDATE — once the row exists, its Class-A business date is not editable by
 *            ordinary staff at all. Not into the past, not into the future, and
 *            not into today either: a record created 30 seconds ago keeps the
 *            date it was created with.
 *   NOTHING ELSE — a field that is a historical clinical fact (Class B), a
 *            planned date (Class C) or a system instant (Class D) is refused
 *            enforcement. This is what keeps the financial rule from becoming
 *            a same-day-only `dateOfBirth`.
 *
 * WHY IT IS FORWARD-ONLY BY CONSTRUCTION (§17): the guard is called from write
 * handlers, so it can only ever act on a new action. It compares an UPDATE
 * against the value already stored on that row, never against "today", which
 * is why a pre-cutover row keeps its date and no historical value is
 * reinterpreted. It performs no database access of any kind — no select, no
 * update, no delete — and cannot rewrite a row in order to satisfy itself.
 *
 * WHY THE AUTHORITY IS INJECTED: `clinicDateAuthority()` reads the CARE server
 * clock. Every decision function takes the authority as a parameter instead of
 * calling `new Date()` internally, so the midnight behaviour is testable at a
 * fixed instant and a caller cannot accidentally mix two clocks inside one
 * request.
 */

import { CARE_CLASS_A_DATE_FIELDS, careDateFieldKey, isCareClassAField, isCareNeverBusinessDate } from "./careDateFieldRegistry";
import { CARE_BUSINESS_TIMEZONE, clinicDayBoundsIST } from "./istDate";

/** CARE business dates are `YYYY-MM-DD`. Anything else is malformed, not a
 *  date in another format — Stage 0 measured that `''::date` and
 *  `'30/09/2026'::date` raise, so a loose string must never reach the column. */
const CARE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ClinicDateAuthority = {
  readonly zone: string;
  readonly clinicDate: string;
  readonly instantIso: string;
  readonly businessDayStartUtcIso: string;
  readonly businessDayEndUtcIso: string;
  /** Which clock answered. Mirrors Stage 1A's `/api/time/now` contract so a
   *  later two-clock cross-check has one name for it in both places. */
  readonly clockSource: "care-server-clock";
};

/** The trusted CARE clinic date for "now", derived from the same helpers the
 *  client is served. No new time arithmetic exists in this file. */
export function clinicDateAuthority(now: Date = new Date()): ClinicDateAuthority {
  const { clinicDate, startUtc, endUtc } = clinicDayBoundsIST(now);
  return {
    zone: CARE_BUSINESS_TIMEZONE,
    clinicDate,
    instantIso: now.toISOString(),
    businessDayStartUtcIso: startUtc.toISOString(),
    businessDayEndUtcIso: endUtc.toISOString(),
    clockSource: "care-server-clock",
  };
}

export type CareBusinessDateRejectionCode =
  | "CARE_BUSINESS_DATE_NOT_CURRENT"
  | "CARE_BUSINESS_DATE_IMMUTABLE"
  | "CARE_BUSINESS_DATE_MALFORMED";

export type BusinessDateRejection = {
  readonly ok: false;
  readonly code: CareBusinessDateRejectionCode;
  /** Shown to the operator. Wording deliberately states the permitted value
   *  rather than only refusing, so a rejected form is recoverable. */
  readonly message: string;
  readonly field: string;
  readonly attempted: string | null;
  readonly careBusinessDate: string;
  readonly trustedInstantIso: string;
  readonly zone: string;
  readonly direction: "past" | "future" | "unparseable";
};

export type CreateBusinessDateDecision =
  | { readonly ok: true; readonly origin: "server-derived" | "client-matches-trusted"; readonly businessDate: string }
  | { readonly ok: true; readonly origin: "not-policed"; readonly businessDate: string | null; readonly reason: string }
  | BusinessDateRejection;

export type UpdateBusinessDateDecision =
  | { readonly ok: true; readonly changed: false; readonly origin: "absent" | "identical"; readonly businessDate: string }
  | { readonly ok: true; readonly origin: "not-policed"; readonly businessDate: string | null; readonly reason: string }
  | BusinessDateRejection;

function reject(
  authority: ClinicDateAuthority,
  field: string,
  attempted: string | null,
  code: CareBusinessDateRejectionCode,
  message: string,
  direction: BusinessDateRejection["direction"],
): BusinessDateRejection {
  return {
    ok: false,
    code,
    message,
    field,
    attempted,
    careBusinessDate: authority.clinicDate,
    trustedInstantIso: authority.instantIso,
    zone: authority.zone,
    direction,
  };
}

/** `2026-10-01` < `2026-09-30` is a string comparison, which is why the format
 *  is verified before the ordering is trusted. */
function directionOf(attempted: string, trusted: string): "past" | "future" {
  return attempted < trusted ? "past" : "future";
}

function notPoliced(field: string, submitted: string | null, reason: string) {
  return { ok: true, origin: "not-policed", businessDate: submitted, reason } as const;
}

/**
 * A CREATE decision. `submitted` is whatever the request body carried — the
 * caller passes `undefined`/`null`/`""` when the field was absent, which is
 * answered with the trusted clinic date (Stage 1A's server-authoritative
 * default, now enforced server-side rather than only suggested to the browser).
 */
export function resolveCreateBusinessDate(input: {
  table: string;
  column: string;
  submitted?: string | null;
  authority: ClinicDateAuthority;
}): CreateBusinessDateDecision {
  const field = careDateFieldKey(input.table, input.column);
  const { authority } = input;
  const raw = input.submitted ?? null;

  // A field the registry says is not a business date is returned exactly as it
  // arrived, including "" — a legitimate stored value for the Form F consent
  // and MTP dates. Normalising it here would make the guard a silent editor of
  // clinical data, which is the failure §9 exists to prevent.
  if (isCareNeverBusinessDate(input.table, input.column)) {
    return notPoliced(field, raw, `${field} is not a CARE business date; it is refused enforcement by the registry`);
  }
  if (!isCareClassAField(input.table, input.column)) {
    return notPoliced(field, raw, `${field} is not registered as Class A; add evidence to careDateFieldRegistry.ts before policing it`);
  }

  const submitted = raw === "" ? null : raw;
  if (submitted === null) {
    return { ok: true, origin: "server-derived", businessDate: authority.clinicDate };
  }
  if (!CARE_DATE_PATTERN.test(submitted)) {
    return reject(
      authority,
      field,
      submitted,
      "CARE_BUSINESS_DATE_MALFORMED",
      `Entry date must be the current CARE business date (${authority.clinicDate}).`,
      "unparseable",
    );
  }
  if (submitted === authority.clinicDate) {
    return { ok: true, origin: "client-matches-trusted", businessDate: authority.clinicDate };
  }
  return reject(
    authority,
    field,
    submitted,
    "CARE_BUSINESS_DATE_NOT_CURRENT",
    `Entry date must be the current CARE business date (${authority.clinicDate}). A ${field} for any other day requires the authorized correction workflow, which ordinary staff accounts cannot use.`,
    directionOf(submitted, authority.clinicDate),
  );
}

/**
 * An UPDATE decision for a row that already exists. `stored` must be the value
 * read from the database, never a value reconstructed from the request: the
 * comparison is what makes a re-date attempt visible even when the submitted
 * date is a perfectly valid CARE date.
 */
export function resolveUpdateBusinessDate(input: {
  table: string;
  column: string;
  stored: string | null;
  submitted?: string | null;
  authority: ClinicDateAuthority;
}): UpdateBusinessDateDecision {
  const field = careDateFieldKey(input.table, input.column);
  const { authority, stored } = input;
  const submitted = input.submitted;

  if (isCareNeverBusinessDate(input.table, input.column) || !isCareClassAField(input.table, input.column)) {
    const reason = isCareNeverBusinessDate(input.table, input.column)
      ? `${field} is not a CARE business date; it is refused enforcement by the registry`
      : `${field} is not registered as Class A; add evidence to careDateFieldRegistry.ts before policing it`;
    return notPoliced(field, typeof submitted === "string" ? submitted : null, reason);
  }

  // Field not mentioned: nothing to decide. The caller must not write the
  // column, and the stored value stands.
  if (submitted === undefined || submitted === null) {
    return { ok: true, changed: false, origin: "absent", businessDate: stored ?? "" };
  }

  // Identical value, including a pre-cutover date: a no-op, and the row keeps
  // its own history. This branch is why enforcement is forward-only — an old
  // row resent with its own date is never treated as a violation.
  if (submitted === stored) {
    return { ok: true, changed: false, origin: "identical", businessDate: stored ?? "" };
  }

  if (!CARE_DATE_PATTERN.test(submitted)) {
    return reject(
      authority,
      field,
      submitted,
      "CARE_BUSINESS_DATE_MALFORMED",
      `The business date of an existing ${input.table} record cannot be changed. It stays ${stored ?? "unset"}.`,
      "unparseable",
    );
  }

  return reject(
    authority,
    field,
    submitted,
    "CARE_BUSINESS_DATE_IMMUTABLE",
    `The business date of an existing ${input.table} record cannot be changed — not to ${submitted}, not to today's CARE date (${authority.clinicDate}). It stays ${stored ?? "unset"}. Correcting a historical record requires the authorized correction workflow.`,
    directionOf(submitted, stored ?? authority.clinicDate),
  );
}

/** The rejection body an API route returns. `error` is the key existing ERP
 *  clients already render, so a rejected save shows the reason instead of a
 *  blank toast; the machine-readable fields ride alongside it. */
export function careBusinessDateErrorBody(rejection: BusinessDateRejection): Record<string, unknown> {
  return {
    error: rejection.message,
    code: rejection.code,
    field: rejection.field,
    attemptedBusinessDate: rejection.attempted,
    careBusinessDate: rejection.careBusinessDate,
    zone: rejection.zone,
    trustedInstant: rejection.trustedInstantIso,
    direction: rejection.direction,
  };
}

/**
 * An actor as the server knows them. There is intentionally no way to
 * construct this from a display name alone: `subjectId` and `role` come from
 * the authenticated session, which is the property policy §6 needs and the
 * thing several existing routes get wrong by reading `editedBy`/`userName`/
 * `approvedBy` out of the body.
 */
export type CareSessionActor = {
  readonly subjectId: string;
  readonly role: string;
  readonly displayName?: string;
  readonly sessionId?: string;
};

export type BusinessDateRejectionEvidence = {
  readonly action: "care-business-date.rejected";
  readonly entity: string;
  readonly endpoint: string;
  readonly method: string;
  readonly actorSubjectId: string;
  readonly actorRole: string;
  readonly identitySource: "authenticated-session";
  readonly attemptedBusinessDate: string | null;
  readonly careBusinessDate: string;
  readonly trustedInstant: string;
  readonly outcome: "rejected";
  readonly code: CareBusinessDateRejectionCode;
  readonly recordedAt: string;
};

/**
 * The evidence record for a rejected attempt (policy §19). It describes the
 * action, not the payload: no request body, no token, no patient identifier.
 * Persisting it is Phase G's job — this function only fixes the shape, so the
 * audit table and the guard cannot drift apart.
 */
export function describeBusinessDateRejection(input: {
  rejection: BusinessDateRejection;
  actor: CareSessionActor;
  endpoint: string;
  method: string;
  entity?: string | number | null;
  now?: Date;
}): BusinessDateRejectionEvidence {
  const { rejection, actor } = input;
  return {
    action: "care-business-date.rejected",
    entity: input.entity == null ? rejection.field : `${rejection.field.split(".")[0]}#${String(input.entity)}`,
    endpoint: input.endpoint,
    method: input.method,
    actorSubjectId: actor.subjectId,
    actorRole: actor.role,
    identitySource: "authenticated-session",
    attemptedBusinessDate: rejection.attempted,
    careBusinessDate: rejection.careBusinessDate,
    trustedInstant: rejection.trustedInstantIso,
    outcome: "rejected",
    code: rejection.code,
    recordedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** For tests and Phase-2 review: the exact set the guard will police, from the
 *  registry, so an accidental registry edit is visible in one call. */
export function policedCareBusinessDateFields(): string[] {
  return Object.keys(CARE_CLASS_A_DATE_FIELDS).filter((key) => {
    const [table, column] = key.split(".");
    return isCareClassAField(table, column) && !isCareNeverBusinessDate(table, column);
  });
}
