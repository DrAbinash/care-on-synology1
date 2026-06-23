/**
 * IST (Indian Standard Time) date helpers.
 *
 * Problem: the server container runs UTC.  Between 00:00 UTC and 05:30 IST,
 * `new Date().toISOString().slice(0, 10)` returns the *previous* day's date.
 * `new Date().getFullYear()` etc. are also UTC-based without TZ set.
 *
 * Fix: every route that needs "today" in the clinic's timezone must use these
 * helpers, which explicitly convert to Asia/Kolkata via toLocaleDateString.
 */

export function todayIST(d?: Date | string | null | undefined): string {
  const date = d == null
    ? new Date()
    : typeof d === "string"
    ? new Date(d)
    : d;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function dateToISTString(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function nowIST(): Date {
  const s = new Date().toLocaleString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(s.replace(",", "T") + ":00+05:30");
}
