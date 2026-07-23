// Pure, DB-free helpers for the recall / follow-up engine. Unit-tested.
// No database, no I/O — safe to import anywhere.

/** Format a Date (or ISO string) as an IST YYYY-MM-DD date string. */
export function istDateOnly(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Due-date for a recall = the report's delivery date + intervalDays,
 * returned as an IST YYYY-MM-DD string. IST has no DST, so a plain
 * millisecond add is exact.
 */
export function computeDueDate(deliveredAt: Date | string, intervalDays: number): string {
  const base = typeof deliveredAt === "string" ? new Date(deliveredAt) : deliveredAt;
  const due = new Date(base.getTime() + Math.max(0, Math.floor(intervalDays)) * 24 * 60 * 60 * 1000);
  return istDateOnly(due);
}

/** Does a report match a recall rule? 'all' matches everything; 'test' matches
 *  when the report title contains matchValue (case-insensitive). */
export function matchRule(report: { testName: string | null | undefined }, rule: { matchType: string; matchValue: string | null | undefined }): boolean {
  if (rule.matchType === "all") return true;
  if (rule.matchType === "test") {
    const needle = (rule.matchValue ?? "").trim().toLowerCase();
    if (!needle) return false;
    return (report.testName ?? "").toLowerCase().includes(needle);
  }
  return false;
}

/** A recall is due when its due date is on or before today (both YYYY-MM-DD). */
export function isRecallDue(dueDate: string, today: string): boolean {
  return dueDate <= today;
}

/** Compose the patient WhatsApp body from a template (falls back to a default). */
export function composeRecallMessage(
  template: string | null | undefined,
  vars: { name: string; testName: string; days: number },
): string {
  const tpl = (template ?? "").trim();
  if (!tpl) {
    return `Hello ${vars.name}, it's time for your follow-up${vars.testName ? ` for ${vars.testName}` : ""}. Please visit or call us to book your appointment. — Care Diagnostics`;
  }
  return tpl
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{testName\}\}/g, vars.testName)
    .replace(/\{\{days\}\}/g, String(vars.days));
}
