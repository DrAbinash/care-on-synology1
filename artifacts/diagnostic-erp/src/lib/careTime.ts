/**
 * Client-side holder for the CARE business date (Stage 1A).
 *
 * CARE's business date is authoritative only when the server says it is.
 * Before this module existed, blank ERP forms filled their own date fields with
 * `new Date().toISOString().slice(0, 10)` — the workstation clock read through
 * a UTC lens — so any form opened between 00:00 and 05:29:59 IST silently
 * pre-filled *yesterday* (Stage 0 report §13). This module holds the value the
 * CARE API derived from trusted server time, and nothing else may fill that
 * role.
 *
 * The deliberate constraints:
 *  - **Never falls back to the browser clock.** When the server value is not
 *    loaded, `getClinicDateIst()` returns `null` and the caller must leave the
 *    field blank. A blank field the operator can still fill in is honest; a
 *    browser-derived date in a CARE business-date field is not.
 *  - **Never persisted to localStorage or any cache.** A stored clinic date is
 *    a stale authority: it would silently survive into the next day, which is
 *    the exact defect this module removes. Memory-only, by design — the
 *    service worker also lists `/api/time/now` as network-only.
 *  - **One request per app shell, not one per form.** `useCareTime()` in
 *    Layout hydrates this once and re-fetches at the business-day rollover the
 *    server told us about; forms read it synchronously through
 *    `useClinicDateIst()`.
 *  - **Not a control.** This is a *default*, not a validation rule. Whether an
 *    operator may enter a different date at all is Stage 2/3 (D-2/D-3, still
 *    deferred).
 */

import { api } from "@/lib/fetchApi";

export type CareTimePayload = {
  zone: string;
  clinicDateIst: string;
  serverNowIso: string;
  businessDayStartUtcIso: string;
  businessDayEndUtcIso: string;
  source: string;
};

export const CARE_TIME_CHANGED = "careTimeChanged";
export const CARE_TIME_ENDPOINT = "/api/time/now";

let current: CareTimePayload | null = null;
let inFlight: Promise<CareTimePayload | null> | null = null;

function looksLikeCareTime(v: unknown): v is CareTimePayload {
  const p = v as Partial<CareTimePayload> | null;
  return !!p
    && typeof p.clinicDateIst === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(p.clinicDateIst)
    && typeof p.serverNowIso === "string"
    && typeof p.businessDayEndUtcIso === "string";
}

/** The authoritative payload, or `null` when the server has not answered yet. */
export function getCareTime(): CareTimePayload | null {
  return current;
}

/**
 * The CARE business date to seed a brand-new, blank form with.
 * `null` means "authority unavailable" — callers must NOT substitute a
 * browser-derived date.
 */
export function getClinicDateIst(): string | null {
  return current?.clinicDateIst ?? null;
}

/**
 * Applies a server answer. Dispatches `careTimeChanged` only when the clinic
 * date itself changed, so a routine re-fetch cannot cause a re-render storm
 * (the feature-flag hydrator learned that the hard way: an unconditional
 * dispatch created a self-sustaining poll that starved Save & Print).
 */
export function setCareTime(payload: unknown): boolean {
  if (!looksLikeCareTime(payload)) return false;
  const changed = current?.clinicDateIst !== payload.clinicDateIst;
  current = payload;
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CARE_TIME_CHANGED, { detail: { clinicDateIst: payload.clinicDateIst } }));
  }
  return changed;
}

export type GetLike = (path: string) => Promise<unknown>;

/**
 * Fetches the authoritative business date through the app's authenticated API
 * client (`api.get`), which is the only way this app carries its staff token —
 * there is no cookie-session fallback, so a bare `fetch` here would 401.
 *
 * `getImpl` exists so the rollover and availability behaviour can be tested
 * deterministically, without a workstation clock or a network. Fails soft: a
 * rejected, offline or malformed answer leaves the value `null`, which renders
 * blank date defaults — never a browser guess.
 */
export function refreshCareTime(deps: { getImpl?: GetLike; force?: boolean } = {}): Promise<CareTimePayload | null> {
  if (inFlight && !deps.force) return inFlight;
  const get = deps.getImpl ?? ((path: string) => api.get<unknown>(path));
  const run = (async () => {
    try {
      setCareTime(await get(CARE_TIME_ENDPOINT));
      return current;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  inFlight = run;
  return run;
}

/**
 * Milliseconds until the CARE business day the server described rolls over,
 * clamped so a badly-set workstation clock can neither spin the refetch loop
 * nor let a stale date sit for long. Uses the browser clock for *scheduling
 * only* — the value it triggers a re-fetch for still comes from the server.
 */
export function msUntilBusinessDayRollover(now: number = Date.now()): number | null {
  const end = current ? Date.parse(current.businessDayEndUtcIso) : Number.NaN;
  if (Number.isNaN(end)) return null;
  const MIN_MS = 30_000;
  const MAX_MS = 24 * 60 * 60 * 1000;
  return Math.min(Math.max(end - now + 2000, MIN_MS), MAX_MS);
}

/** Test/reset seam — the app shell never calls this. */
export function resetCareTimeForTests(): void {
  current = null;
  inFlight = null;
}
