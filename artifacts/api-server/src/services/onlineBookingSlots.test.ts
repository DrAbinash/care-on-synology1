import { describe, expect, test } from "vitest";
import {
  findSlotConfig,
  holdsCapacity,
  inferTestModalities,
  normalizeBookingSource,
  parseBookingTimeSlots,
  parseSlotSelection,
  remainingForSlot,
  sanitizeBookingTimeSlots,
  slotMatchesSelectedModalities,
  slotOptionValue,
  PENDING_PAYMENT_HOLD_MS,
} from "./onlineBookingSlots";

describe("onlineBookingSlots", () => {
  test("sanitize keeps maxBookings and modality", () => {
    const json = JSON.stringify([
      { value: "10:00 – 11:00", label: "MRI 10–11", maxBookings: 3, modality: "mri", extra: "drop" },
      { value: "  ", label: "skip" },
    ]);
    const slots = sanitizeBookingTimeSlots(json);
    expect(slots).toEqual([
      { value: "10:00 – 11:00", label: "MRI 10–11", maxBookings: 3, modality: "mri" },
    ]);
  });

  test("maxBookings 0 is unlimited (omitted)", () => {
    const slots = sanitizeBookingTimeSlots(JSON.stringify([
      { value: "07:00 – 10:00", label: "Morning", maxBookings: 0 },
    ]));
    expect(slots[0].maxBookings).toBeUndefined();
  });

  test("parseSlotSelection splits modality-prefixed values", () => {
    expect(parseSlotSelection("mri::10:00 – 11:00")).toEqual({
      timeSlot: "10:00 – 11:00",
      slotModality: "mri",
    });
    expect(parseSlotSelection("10:00 – 11:00")).toEqual({
      timeSlot: "10:00 – 11:00",
      slotModality: "",
    });
  });

  test("slotOptionValue round-trips with parseSlotSelection", () => {
    const encoded = slotOptionValue({ value: "10:00 – 11:00", modality: "ct" });
    expect(parseSlotSelection(encoded)).toEqual({ timeSlot: "10:00 – 11:00", slotModality: "ct" });
  });

  test("findSlotConfig matches value + modality", () => {
    const slots = parseBookingTimeSlots(JSON.stringify([
      { value: "10:00 – 11:00", label: "General" },
      { value: "10:00 – 11:00", label: "MRI", maxBookings: 3, modality: "mri" },
    ]));
    expect(findSlotConfig(slots, "10:00 – 11:00", "mri")?.label).toBe("MRI");
    expect(findSlotConfig(slots, "10:00 – 11:00", "")?.label).toBe("General");
  });

  test("holdsCapacity: paid/confirmed always; cancelled/failed never", () => {
    const now = new Date();
    expect(holdsCapacity({ status: "paid", createdAt: now, now })).toBe(true);
    expect(holdsCapacity({ status: "confirmed", createdAt: now, now })).toBe(true);
    expect(holdsCapacity({ status: "cancelled", createdAt: now, now })).toBe(false);
    expect(holdsCapacity({ status: "payment_failed", createdAt: now, now })).toBe(false);
  });

  test("pending_payment from website expires after hold window", () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 5 * 60 * 1000);
    const stale = new Date(now.getTime() - PENDING_PAYMENT_HOLD_MS - 1000);
    expect(holdsCapacity({ status: "pending_payment", source: "website", createdAt: fresh, now })).toBe(true);
    expect(holdsCapacity({ status: "pending_payment", source: "kiosk", createdAt: stale, now })).toBe(false);
    expect(holdsCapacity({ status: "pending_payment", source: "phone", createdAt: stale, now })).toBe(true);
    expect(holdsCapacity({ status: "pending_payment", source: "reception", createdAt: stale, now })).toBe(true);
  });

  test("inferTestModalities maps MRI/CT/USG/X-ray/pathology", () => {
    expect(inferTestModalities("MRI Brain", "Radiology")).toContain("mri");
    expect(inferTestModalities("CT", "CT")).toContain("ct");
    expect(inferTestModalities("Ultrasound Abdomen", "USG")).toContain("usg");
    expect(inferTestModalities("Chest X-Ray", "")).toContain("xray");
    expect(inferTestModalities("CBC", "Pathology")).toContain("pathology");
  });

  test("modality-scoped slots hide when selected tests do not match", () => {
    const mriSlot = { value: "10:00 – 11:00", label: "MRI", modality: "mri" };
    const general = { value: "07:00 – 10:00", label: "Morning" };
    expect(slotMatchesSelectedModalities(mriSlot, new Set(["pathology"]))).toBe(false);
    expect(slotMatchesSelectedModalities(mriSlot, new Set(["mri"]))).toBe(true);
    expect(slotMatchesSelectedModalities(general, new Set(["pathology"]))).toBe(true);
  });

  test("remainingForSlot treats missing max as unlimited", () => {
    expect(remainingForSlot(null, 99)).toBeNull();
    expect(remainingForSlot(3, 2)).toBe(1);
    expect(remainingForSlot(3, 3)).toBe(0);
  });

  test("normalizeBookingSource falls back to website", () => {
    expect(normalizeBookingSource("phone")).toBe("phone");
    expect(normalizeBookingSource("nope")).toBe("website");
  });
});
