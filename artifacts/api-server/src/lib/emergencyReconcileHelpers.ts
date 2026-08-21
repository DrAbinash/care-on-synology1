import { SOURCE, type EmergencyTransaction } from "@workspace/emergency-billing";

/** Emergency phone-collision scope: day = only patients active on the clinic day (IST). */
export type EmergencyPhoneMatchScope = "day" | "all";

export function parseEmergencyPhoneMatchScope(raw: unknown): EmergencyPhoneMatchScope {
  return raw === "all" ? "all" : "day";
}

/**
 * Asia/Kolkata calendar-day bounds as UTC instants for the emergency bill's createdAt.
 * Phone conflicts for emergency sync are scoped to this window by default.
 */
export function clinicDayBoundsIst(anchor: Date | string): { dayKey: string; startUtc: Date; endUtc: Date } {
  const at = typeof anchor === "string" ? new Date(anchor) : anchor;
  const safe = Number.isFinite(at.getTime()) ? at : new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = fmt.format(safe); // YYYY-MM-DD
  // IST = UTC+5:30 — day start 00:00 IST = previous day 18:30 UTC
  const startUtc = new Date(`${dayKey}T00:00:00+05:30`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { dayKey, startUtc, endUtc };
}

export function emergencyClientRef(uuid: string): string {
  return `emg:${uuid}`;
}

export function emergencyOrderClientRef(uuid: string): string {
  return `emg-ord:${uuid}`;
}

export function mapEmergencyGender(sex: string | null | undefined): string {
  const s = String(sex ?? "").trim().toLowerCase();
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  return "other";
}

export function synthesizeDob(opts: {
  dateOfBirth: string | null;
  ageValue: number | null;
  ageUnit: string | null;
  at?: Date;
}): string {
  if (opts.dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(opts.dateOfBirth)) {
    return opts.dateOfBirth.slice(0, 10);
  }
  const at = opts.at ?? new Date();
  const d = new Date(at.getTime());
  const age = Number(opts.ageValue ?? 0);
  const unit = String(opts.ageUnit ?? "years").toLowerCase();
  if (unit.startsWith("month")) d.setMonth(d.getMonth() - (Number.isFinite(age) ? age : 0));
  else if (unit.startsWith("day")) d.setDate(d.getDate() - (Number.isFinite(age) ? age : 0));
  else d.setFullYear(d.getFullYear() - (Number.isFinite(age) ? age : 0));
  return d.toISOString().slice(0, 10);
}

export function buildEmergencyOrderNotes(t: EmergencyTransaction): string {
  return [
    `source=${SOURCE}`,
    `emergency_transaction_uuid=${t.emergencyTransactionUuid}`,
    `original_emg_bill_number=${t.emergencyBillNumber}`,
    `emergency_session_uuid=${t.emergencySessionUuid}`,
    `original_created_at=${t.createdAt}`,
    `original_staff=${t.createdByStaffName}`,
  ].join("; ");
}
