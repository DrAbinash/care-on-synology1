/**
 * onlineBookingSlots.ts — shared slot config + capacity rules for Online Bookings.
 *
 * Used by website, kiosk, and reception/phone. Pure helpers live here so unit
 * tests can cover capacity semantics without a database.
 *
 * Occupying statuses (hold a seat):
 *   - paid, confirmed: always
 *   - pending_payment: website/kiosk hold for PENDING_PAYMENT_HOLD_MS (payment
 *     in flight). reception/phone hold until cancelled/failed/confirmed
 *     (Pay at Centre).
 *   - cancelled, payment_failed: released
 */

import { DEFAULT_BOOKING_TIME_SLOTS } from "@workspace/db/schema";

export const BOOKING_SOURCES = ["website", "kiosk", "reception", "phone"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const PENDING_PAYMENT_HOLD_MS = 30 * 60 * 1000;

export const BOOKING_SLOT_MODALITIES = [
  { value: "", label: "All services" },
  { value: "mri", label: "MRI" },
  { value: "ct", label: "CT" },
  { value: "usg", label: "USG" },
  { value: "xray", label: "X-Ray" },
  { value: "pathology", label: "Pathology" },
] as const;

export type BookingSlotModality = (typeof BOOKING_SLOT_MODALITIES)[number]["value"];

export type BookingTimeSlotConfig = {
  value: string;
  label: string;
  maxBookings?: number | null;
  modality?: string;
};

export type BookingTimeSlotAvailability = BookingTimeSlotConfig & {
  booked: number;
  remaining: number | null;
  available: boolean;
};

export class OnlineBookingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "OnlineBookingError";
    this.statusCode = statusCode;
  }
}

export function validateSelfRegistration(params: {
  name: string;
  phone: string;
  gender: string;
  ageValue: number | null | undefined;
  ageUnit: string;
}): string | null {
  if (!params.name?.trim()) {
    return "Please enter your name.";
  }
  const cleanPhone = params.phone?.trim().replace(/\D/g, "");
  if (!params.phone?.trim() || cleanPhone.length !== 10) {
    return "Please enter a valid mobile number.";
  }
  if (!params.gender || !["male", "female", "other"].includes(params.gender.toLowerCase())) {
    return "Please select gender.";
  }
  if (params.ageValue === undefined || params.ageValue === null || Number.isNaN(Number(params.ageValue)) || Number(params.ageValue) < 0) {
    return "Please enter age.";
  }
  if (!params.ageUnit || !["years", "months", "days"].includes(params.ageUnit.toLowerCase())) {
    return "Please select a valid age unit.";
  }
  return null;
}

const KNOWN_MODALITY = new Set<string>(BOOKING_SLOT_MODALITIES.map((m) => m.value));

export function isBookingSource(v: unknown): v is BookingSource {
  return typeof v === "string" && (BOOKING_SOURCES as readonly string[]).includes(v);
}

export function normalizeBookingSource(raw: unknown, fallback: BookingSource = "website"): BookingSource {
  if (isBookingSource(raw)) return raw;
  return fallback;
}

export function normalizeSlotModality(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim().toLowerCase();
  return KNOWN_MODALITY.has(v) ? v : "";
}

/** Encode a slot option so two slots can share a clock window but differ by modality. */
export function slotOptionValue(slot: { value: string; modality?: string | null }): string {
  const modality = (slot.modality || "").trim();
  return modality ? `${modality}::${slot.value}` : slot.value;
}

export function parseSlotSelection(raw: string | null | undefined): { timeSlot: string; slotModality: string } {
  const s = (raw || "").trim();
  if (!s) return { timeSlot: "", slotModality: "" };
  const idx = s.indexOf("::");
  if (idx > 0) {
    const modality = normalizeSlotModality(s.slice(0, idx));
    const value = s.slice(idx + 2).trim();
    if (modality && value) return { timeSlot: value, slotModality: modality };
  }
  return { timeSlot: s, slotModality: "" };
}

export function parseBookingTimeSlots(raw: string | null | undefined): BookingTimeSlotConfig[] {
  if (!raw || !raw.trim()) return [...DEFAULT_BOOKING_TIME_SLOTS];
  try {
    const sanitized = sanitizeBookingTimeSlots(raw);
    return sanitized.length > 0 ? sanitized : [...DEFAULT_BOOKING_TIME_SLOTS];
  } catch {
    return [...DEFAULT_BOOKING_TIME_SLOTS];
  }
}

export function sanitizeBookingTimeSlots(raw: string | null | undefined): BookingTimeSlotConfig[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OnlineBookingError("bookingTimeSlots must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new OnlineBookingError("bookingTimeSlots must be an array of { value, label } objects.");
  }
  const out: BookingTimeSlotConfig[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      throw new OnlineBookingError("bookingTimeSlots must be an array of { value, label } objects.");
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.value !== "string" || typeof rec.label !== "string") {
      throw new OnlineBookingError("bookingTimeSlots must be an array of { value, label } objects.");
    }
    const value = rec.value.trim();
    const label = rec.label.trim();
    if (!value || !label) continue;

    let maxBookings: number | null = null;
    if (rec.maxBookings !== undefined && rec.maxBookings !== null && rec.maxBookings !== "") {
      const n = Number(rec.maxBookings);
      if (!Number.isInteger(n) || n < 0) {
        throw new OnlineBookingError("Each slot maxBookings must be a whole number ≥ 0 (0 = unlimited).");
      }
      maxBookings = n > 0 ? n : null;
    }

    const modality = normalizeSlotModality(rec.modality);
    const slot: BookingTimeSlotConfig = { value, label };
    if (maxBookings) slot.maxBookings = maxBookings;
    if (modality) slot.modality = modality;
    out.push(slot);
  }
  return out;
}

export function findSlotConfig(
  slots: BookingTimeSlotConfig[],
  timeSlot: string,
  slotModality: string,
): BookingTimeSlotConfig | undefined {
  const modality = normalizeSlotModality(slotModality);
  return slots.find((s) => s.value === timeSlot && normalizeSlotModality(s.modality) === modality);
}

export function holdsCapacity(params: {
  status: string;
  source?: string | null;
  createdAt: Date | string | null;
  now?: Date;
}): boolean {
  const status = (params.status || "").toLowerCase();
  if (status === "paid" || status === "confirmed") return true;
  if (status === "cancelled" || status === "payment_failed") return false;
  if (status !== "pending_payment") return false;

  const source = (params.source || "website").toLowerCase();
  if (source === "reception" || source === "phone") return true;

  const created = params.createdAt instanceof Date
    ? params.createdAt
    : params.createdAt
      ? new Date(params.createdAt)
      : null;
  if (!created || Number.isNaN(created.getTime())) return true;
  const now = params.now ?? new Date();
  return now.getTime() - created.getTime() < PENDING_PAYMENT_HOLD_MS;
}

/**
 * Infer booking-slot modalities from a test's category/department.
 * Keywords match the public booking service filter in public-booking.ts.
 */
export function inferTestModalities(category: string, department: string): string[] {
  const cat = (category || "").toLowerCase().trim();
  const dept = (department || "").toLowerCase().trim();
  const matches = (keywords: string[]) => keywords.some((k) => cat.includes(k) || dept.includes(k));
  const found: string[] = [];
  if (matches(["mri"])) found.push("mri");
  if (matches(["ct scan", "ct-scan", "computed tomography"]) || cat === "ct" || dept === "ct") found.push("ct");
  if (matches(["usg", "ultrasound", "sonar", "doppler"])) found.push("usg");
  if (matches(["xray", "x-ray", "x ray", "mammography"])) found.push("xray");
  if (matches([
    "pathology", "haematology", "biochemistry", "microbiology", "serology",
    "clinical pathology", "cytopathology", "histopathology", "blood", "urine",
    "stool", "sputum", "semen", "cbc", "lft", "kft",
  ])) found.push("pathology");
  return found;
}

export function slotMatchesSelectedModalities(
  slot: BookingTimeSlotConfig,
  selectedModalities: Set<string>,
): boolean {
  const modality = normalizeSlotModality(slot.modality);
  if (!modality) return true;
  if (selectedModalities.size === 0) return true;
  return selectedModalities.has(modality);
}

export function remainingForSlot(maxBookings: number | null | undefined, booked: number): number | null {
  if (!maxBookings || maxBookings <= 0) return null;
  return Math.max(0, maxBookings - booked);
}
