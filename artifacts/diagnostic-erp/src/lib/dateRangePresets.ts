/**
 * dateRangePresets.ts
 *
 * Shared quick-select date-range helpers (Today / Yesterday / Day Before /
 * This Week / This Month) used by any list/queue that filters rows by their
 * received/created timestamp. All dates are computed and compared as IST
 * calendar days ("YYYY-MM-DD" strings) so the presets line up with the same
 * "day" the rest of the ERP (My Daily Summary, day-close) uses, regardless
 * of the browser's local timezone.
 */

export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
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

export const DATE_PRESETS = [
  { label: "Today", from: () => todayISO(), to: () => todayISO() },
  { label: "Yesterday", from: () => daysAgoISO(1), to: () => daysAgoISO(1) },
  { label: "Day Before", from: () => daysAgoISO(2), to: () => daysAgoISO(2) },
  { label: "This Week", from: () => startOfWeekISO(), to: () => todayISO() },
  { label: "This Month", from: () => startOfMonthISO(), to: () => todayISO() },
];
