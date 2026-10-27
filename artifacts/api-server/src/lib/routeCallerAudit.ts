/**
 * S1 — who calls the internal radiology routes, and how they authenticated.
 *
 * `router.use(requireStaffOrInternalAuth)` (routes/internal-radiology.ts) is the
 * only gate in front of this router's 23 routes, and it accepts EITHER the
 * server-to-server `INTERNAL_API_KEY` OR any valid staff session — every role,
 * every permission set, including routes that write a worklist row, flip report
 * status, claim a DICOM pull job, or read the LAN dicom-agent configuration.
 * The comment above it claimed permissions "are not weakened"; the gate never
 * consulted a permission, so that was not true.
 *
 * Narrowing it is an authorization-policy decision, and a policy decision needs
 * to know what the clinic actually does today — which roles hit which routes,
 * and whether any human caller is using a route that only automation should.
 * NOTHING in this file enforces or refuses anything: it only produces the fields
 * that answer the question, so the evidence can be gathered before any gate moves.
 *
 * Deliberately absent: the bearer token, the session id, the staff user's name or
 * id, and any part of a request body or query string. Present: the method, the
 * route with identifiers masked, the caller category (internal key, or the staff
 * ROLE — the role is what the policy question needs, not the individual), and the
 * authentication outcome.
 */

export type RouteCallerOutcome =
  /** The request passed the gate. */
  | "allowed"
  /** No Authorization header at all. */
  | "no-credential"
  /** A credential was presented and matched neither the internal key nor a live staff session. */
  | "unknown-credential"
  /** A valid session, but the staff account is inactive. */
  | "inactive-account"
  /** The session lookup itself failed — the request is refused with 500. */
  | "auth-db-error";

/** No credential was presented at all. */
export const CALLER_ANONYMOUS = "anonymous";

/**
 * Something was presented and this gate could not resolve it to an identity:
 * neither the internal key nor a live staff session, or the session lookup
 * itself failed. Guessing "staff" here would mislabel an outside probe as an
 * employee, which is the opposite of what the clinic needs to see.
 */
export const CALLER_UNRECOGNISED = "unrecognised-credential";

/**
 * The caller category for a request this gate recognised. A staff role is
 * normalised to the same `[a-z0-9_]` alphabet `normalizeRole` produces, and
 * anything unexpected is reduced to a fixed label rather than echoed: a role
 * string is operator data, and an echoed one would put free text into the log.
 */
export function callerCategoryOf(input: {
  viaInternalKey?: boolean;
  staffRole?: string | null;
}): string {
  if (input.viaInternalKey) return "internal-key";
  const role = String(input.staffRole ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return role ? `staff:${role}` : "staff:unknown-role";
}

/**
 * Segments that name a person are followed by that person's identifier, which at
 * CARE can be an alphabetic UHID with no digit in it at all.
 */
const PERSON_COLLECTION = new Set(["patient", "patients"]);

/**
 * `GET /api/internal/radiology/patients/214/contact?uhid=ABH77` becomes
 * `GET /api/internal/radiology/patients/:id/contact`.
 *
 * Query and fragment are dropped outright — the accession number, the UHID and
 * the patient name all travel as query parameters on this router, and a path
 * segment is masked by shape (contains a digit) with the person-collection rule
 * above covering the one identifier that has no digits.
 */
export function routeForAudit(method: string, url: string): string {
  const path = String(url ?? "").split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean);
  const masked: string[] = [];
  segments.forEach((segment, index) => {
    const previous = (masked[index - 1] ?? "").toLowerCase();
    const isIdentifier = /\d/.test(segment) || PERSON_COLLECTION.has(previous);
    masked.push(isIdentifier ? ":id" : segment);
  });
  return `${String(method ?? "").toUpperCase()} /${masked.join("/")}`;
}

/**
 * The log fields for one authentication decision. The key set is closed on
 * purpose: a caller that wants to add "body" or "token" to this line has to
 * change this signature, which is where the review happens.
 */
export function routeCallerFields(input: {
  method: string;
  url: string;
  caller: string;
  outcome: RouteCallerOutcome;
}): { route: string; caller: string; outcome: RouteCallerOutcome } {
  return {
    route: routeForAudit(input.method, input.url),
    caller: input.caller,
    outcome: input.outcome,
  };
}
