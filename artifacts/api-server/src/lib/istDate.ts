/**
 * CARE canonical business-time helpers — the single surface that names a CARE
 * calendar day from an instant (remediation plan, Stage 1 item 1).
 *
 * Five concepts, deliberately kept apart:
 *   TRUSTED ACTION INSTANT  when CARE received/performed something.
 *                           Postgres `DEFAULT now()` for stored rows, the Node
 *                           clock at request time for derived values. UTC on
 *                           the wire is correct here — an instant has no
 *                           timezone, only a calendar mapping does.
 *   CARE BUSINESS DATE      `YYYY-MM-DD` in Asia/Kolkata: the day a record
 *                           belongs to. `clinicDateOf()` / `todayIST()`.
 *   CARE BUSINESS DAY       00:00:00.000–23:59:59.999 IST, expressed as UTC
 *                           instants by `clinicDayBoundsIST()`.
 *   DISPLAY TIME            formatting only; never an authority.
 *   EXTERNAL EVENT TIME     DICOM/modality/kiosk/agent clocks. Must stay
 *                           identifiable as external; never silently converted
 *                           into a CARE audit timestamp.
 *
 * Why these exist: the container runs with `TZ=Asia/Kolkata` pinned in
 * `src/index.ts`, but `toISOString()` is always UTC regardless. Between 00:00
 * and 05:29:59.999 IST (= 18:30–23:59:59.999 UTC) a UTC slice names the
 * previous clinic day — see Stage 0 §13 of
 * docs/audits/business-time-stage0-runtime-verification-2026-09-30.md.
 *
 * Every helper takes an explicit instant and uses an explicit `timeZone:` so
 * the result cannot depend on the server process's own timezone: a lost TZ pin
 * changes nothing here. IST has no DST and is a fixed +05:30 offset, so the
 * day-boundary arithmetic below is exact.
 */

export const CARE_BUSINESS_TIMEZONE = "Asia/Kolkata";

/**
 * The CARE business date — the clinic calendar day that contains `instant`.
 * Pass the instant explicitly wherever the answer must be reproducible
 * (routes, tests, backfills of *new* writes); omit it to mean "right now".
 */
export function clinicDateOf(instant?: Date | string | null | undefined): string {
  const date = instant == null
    ? new Date()
    : typeof instant === "string"
    ? new Date(instant)
    : instant;
  return date.toLocaleDateString("en-CA", { timeZone: CARE_BUSINESS_TIMEZONE });
}

/**
 * The CARE business day containing `instant`, as UTC instants, so it can be
 * compared against a `timestamptz` column without relying on the database
 * session timezone (which is UTC — Stage 0 U-1).
 *
 * `endUtc` is inclusive: 23:59:59.999 IST. Callers building SQL ranges should
 * pair it with `lte`, or use `endUtc + 1ms` as an exclusive upper bound.
 */
export function clinicDayBoundsIST(instant?: Date | string | null | undefined): {
  clinicDate: string;
  startUtc: Date;
  endUtc: Date;
} {
  const clinicDate = clinicDateOf(instant);
  const startUtc = new Date(`${clinicDate}T00:00:00+05:30`);
  return { clinicDate, startUtc, endUtc: new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

/**
 * The historical name for {@link clinicDateOf}, kept because ~30 server call
 * sites already use it. Same function, same semantics — the name change is not
 * a behaviour change, and new code should prefer `clinicDateOf(instant)`.
 */
export function todayIST(d?: Date | string | null | undefined): string {
  return clinicDateOf(d);
}

export function dateToISTString(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-CA", { timeZone: CARE_BUSINESS_TIMEZONE });
}

// Current hour/minute in IST, independent of the server process's own
// timezone. Uses hourCycle "h23" (not hour12: false) to avoid the Intl
// quirk where some engines report midnight as hour "24" instead of "00".
export function istHourMinute(d: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CARE_BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

// `nowIST()` was removed in Stage 1A. It round-tripped a locale string through
// `new Date(...)` and returned Invalid Date, and it had zero callers; the
// concept it pretended to expose ("the current instant in IST") is a category
// error — an instant is a instant, and `clinicDateOf(now)` is how it becomes a
// CARE calendar day. Stage-0 characterization test converted in place.
