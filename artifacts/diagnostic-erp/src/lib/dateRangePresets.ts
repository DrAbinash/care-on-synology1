/**
 * dateRangePresets.ts
 *
 * Shared quick-select date-range helpers (Today / Yesterday /
 * Today + Yesterday / This Week / This Month) used by any list/queue that
 * filters rows by their received/created timestamp. All dates are computed
 * and compared as IST calendar days ("YYYY-MM-DD" strings) so the presets
 * line up with the same "day" the rest of the ERP (My Daily Summary,
 * day-close) uses, regardless of the browser's local timezone.
 */

export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function daysAgoISO(n: number): string {
  return shiftISODate(todayISO(), -n);
}

export function startOfWeekISO(): string {
  const [y, m, day] = todayISO().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  const diffFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffFromMonday);
  return d.toISOString().slice(0, 10);
}

export function startOfMonthISO(): string {
  const [y, m] = todayISO().split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Converts any ISO timestamp to its IST calendar-day string for comparison
 *  against the "YYYY-MM-DD" preset/date-input values above. */
export function toISTDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Shifts a "YYYY-MM-DD" calendar-day string by `days` (negative to go
 *  back). Anchored to UTC internally purely as a date-identity trick — the
 *  string never represents a real moment, so this never crosses a local- or
 *  IST-timezone boundary the way `new Date(iso + "T00:00:00")` (parsed as
 *  local midnight) followed by `.toISOString()` (re-serialized as UTC)
 *  would: IST midnight is 18:30 UTC the previous day, so that round-trip
 *  silently shifts every date by up to a day depending on the offset sign. */
export function shiftISODate(iso: string, days: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converts DICOM study date (YYYYMMDD or YYYY-MM-DD) to IST calendar-day "YYYY-MM-DD". */
export function studyDateToISO(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const compact = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return null;
}

/** True when study scan date (not received time) falls in [dateFrom, dateTo] (IST YYYY-MM-DD). */
export function studyDateInRange(
  studyDate: string | null | undefined,
  createdAt: string | null | undefined,
  dateFrom: string,
  dateTo: string,
): boolean {
  const iso = studyDateToISO(studyDate) ?? (createdAt ? toISTDateStr(createdAt) : null);
  if (!iso) return false;
  if (dateFrom && iso < dateFrom) return false;
  if (dateTo && iso > dateTo) return false;
  return true;
}

export const DATE_PRESETS = [
  { label: "Today", from: () => todayISO(), to: () => todayISO() },
  { label: "Yesterday", from: () => daysAgoISO(1), to: () => daysAgoISO(1) },
  /** Reporting Workspace default — last two IST calendar days. */
  { label: "Today + Yesterday", from: () => daysAgoISO(1), to: () => todayISO() },
  { label: "This Week", from: () => startOfWeekISO(), to: () => todayISO() },
  { label: "This Month", from: () => startOfMonthISO(), to: () => todayISO() },
];
