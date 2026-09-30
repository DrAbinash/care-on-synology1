import { CARE_BUSINESS_TIMEZONE, clinicDayBoundsIST } from "./istDate";

/**
 * Stage 1A — the CARE business-time response contract.
 *
 * Lives in `lib/` rather than in the router so the midnight behaviour is
 * unit-testable without importing `middleware/requireStaffAuth`, which imports
 * `@workspace/db` and therefore opens a Postgres pool. The route is transport;
 * this is the contract.
 *
 * Pure by construction: it takes the instant and returns the mapping. It never
 * reads a request, a body, a query string or a header — the trusted CARE date
 * cannot be talked into agreeing with whatever clock the caller is holding.
 */
export type CareTimeResponse = {
  zone: string;
  clinicDateIst: string;
  serverNowIso: string;
  businessDayStartUtcIso: string;
  businessDayEndUtcIso: string;
  source: string;
};

export function careTimeResponse(serverNow: Date): CareTimeResponse {
  const { clinicDate, startUtc, endUtc } = clinicDayBoundsIST(serverNow);
  return {
    zone: CARE_BUSINESS_TIMEZONE,
    /** The CARE business date a blank new form should default to. */
    clinicDateIst: clinicDate,
    /** Trusted CARE server instant. An instant carries no timezone; the
     *  calendar interpretation is exactly and only `clinicDateIst`. */
    serverNowIso: serverNow.toISOString(),
    /** CARE business day containing it: 00:00:00.000 IST … */
    businessDayStartUtcIso: startUtc.toISOString(),
    /** … 23:59:59.999 IST, inclusive. Lets the client schedule a single
     *  re-fetch at rollover instead of polling for a date it may never need. */
    businessDayEndUtcIso: endUtc.toISOString(),
    /** Which clock answered, so a later two-clock cross-check has a named
     *  source. Postgres is deliberately not consulted on this path. */
    source: "care-api-node-clock",
  };
}
