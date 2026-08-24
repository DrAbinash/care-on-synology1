/**
 * Canonical Online Booking create + slot occupancy.
 *
 * Website, kiosk, and reception/phone all insert through createPendingOnlineBooking
 * so capacity is enforced in one place. Payment still uses the existing gateway
 * initiate / payment-link / confirmBookingInternal pipeline.
 */
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  clinicSettingsTable,
  onlineBookingsTable,
  testsTable,
  packagesTable,
  packageTestsTable,
  patientsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  BOOKING_SOURCES,
  type BookingSource,
  type BookingTimeSlotAvailability,
  type BookingTimeSlotConfig,
  OnlineBookingError,
  findSlotConfig,
  holdsCapacity,
  inferTestModalities,
  normalizeBookingSource,
  normalizeSlotModality,
  parseBookingTimeSlots,
  parseSlotSelection,
  remainingForSlot,
  slotMatchesSelectedModalities,
  validateSelfRegistration,
} from "./onlineBookingSlots";
import { moneyAdd } from "../lib/money";
import { applyVipMultiplier, packageEffectivePrice } from "../lib/financialIntegrity";

export { OnlineBookingError, parseBookingTimeSlots } from "./onlineBookingSlots";
export type { BookingSource, BookingTimeSlotAvailability, BookingTimeSlotConfig };

export type CreatePendingBookingInput = {
  name: string;
  phone: string;
  email?: string;
  selectedDate: string;
  timeSlot?: string;
  slotModality?: string;
  testIds?: number[];
  packageIds?: number[];
  totalAmount: number;
  notes?: string;
  isVip?: boolean;
  ageValue: number;
  ageUnit?: string;
  gender: string;
  referringDoctorId?: number | null;
  referringDoctorName?: string;
  source?: string;
  patientId?: number | null;
  bookingRef?: string;
  overrideCapacity?: boolean;
  overrideReason?: string;
  /** Gateway txn ids stamped at insert (PayU/PhonePe/etc.). */
  gateway?: Partial<Pick<
    typeof onlineBookingsTable.$inferInsert,
    | "payuTxnId"
    | "phonepeTransactionId"
    | "bharatpeTransactionId"
    | "iciciTransactionId"
    | "razorpayOrderId"
  >>;
};

export function generateBookingRef(): string {
  const now = new Date();
  const prefix = `OB${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${rand}`;
}

export function parseIdList(raw: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0)
      : [];
  } catch {
    return [];
  }
}

function lockKey(date: string, timeSlot: string, slotModality: string): string {
  return `online_booking_slot:${date}|${timeSlot}|${slotModality || ""}`;
}

export async function failPendingBooking(bookingId: number, reason: string): Promise<void> {
  await db
    .update(onlineBookingsTable)
    .set({ status: "payment_failed", failureReason: reason || "Payment not completed" })
    .where(and(eq(onlineBookingsTable.id, bookingId), eq(onlineBookingsTable.status, "pending_payment")));
}

async function loadSettings() {
  const [row] = await db.select().from(clinicSettingsTable).limit(1);
  return row ?? null;
}

async function modalitiesForSelection(testIds: number[], packageIds: number[]): Promise<Set<string>> {
  const resolved = [...testIds];
  if (packageIds.length > 0) {
    const pkgTests = await db
      .select({ testId: packageTestsTable.testId })
      .from(packageTestsTable)
      .where(inArray(packageTestsTable.packageId, packageIds));
    for (const pt of pkgTests) resolved.push(pt.testId);
  }
  const unique = [...new Set(resolved)];
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ category: testsTable.category, department: testsTable.department })
    .from(testsTable)
    .where(inArray(testsTable.id, unique));
  const set = new Set<string>();
  for (const r of rows) {
    for (const m of inferTestModalities(r.category, r.department)) set.add(m);
  }
  return set;
}

export async function countOccupyingBookings(params: {
  selectedDate: string;
  timeSlot: string;
  slotModality: string;
  tx?: typeof db;
}): Promise<number> {
  const client = params.tx ?? db;
  const rows = await client
    .select({
      status: onlineBookingsTable.status,
      source: onlineBookingsTable.source,
      createdAt: onlineBookingsTable.createdAt,
    })
    .from(onlineBookingsTable)
    .where(
      and(
        eq(onlineBookingsTable.selectedDate, params.selectedDate),
        eq(onlineBookingsTable.timeSlot, params.timeSlot),
        eq(onlineBookingsTable.slotModality, params.slotModality || ""),
      ),
    );
  const now = new Date();
  return rows.filter((r: { status: string; source: string | null; createdAt: Date | null }) =>
    holdsCapacity({ status: r.status, source: r.source, createdAt: r.createdAt, now }),
  ).length;
}

export async function getSlotAvailability(params: {
  selectedDate: string;
  testIds?: number[];
  packageIds?: number[];
}): Promise<{ slots: BookingTimeSlotAvailability[]; selectedDate: string }> {
  const settings = await loadSettings();
  const slots = parseBookingTimeSlots(settings?.bookingTimeSlots);
  const selectedModalities = await modalitiesForSelection(params.testIds ?? [], params.packageIds ?? []);

  const occupancy = await Promise.all(
    slots.map((slot) =>
      countOccupyingBookings({
        selectedDate: params.selectedDate,
        timeSlot: slot.value,
        slotModality: slot.modality || "",
      }),
    ),
  );

  const available = slots
    .map((slot, idx) => {
      const booked = occupancy[idx] ?? 0;
      const remaining = remainingForSlot(slot.maxBookings, booked);
      return {
        ...slot,
        booked,
        remaining,
        available: remaining === null || remaining > 0,
      };
    })
    .filter((slot) => slotMatchesSelectedModalities(slot, selectedModalities));

  return { slots: available, selectedDate: params.selectedDate };
}

function normalizeReferringDoctor(
  rawId: unknown,
  rawName: unknown,
): { referringDoctorId: number | null; referringDoctorName: string | null } {
  const id = Number(rawId);
  const validId = Number.isInteger(id) && id > 0 ? id : null;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  return { referringDoctorId: validId, referringDoctorName: validId && name ? name : null };
}

export async function createPendingOnlineBooking(input: CreatePendingBookingInput) {
  const validationError = validateSelfRegistration({
    name: input.name,
    phone: input.phone,
    gender: input.gender,
    ageValue: input.ageValue,
    ageUnit: input.ageUnit || "years",
  });
  if (validationError) throw new OnlineBookingError(validationError);

  const selectedDate = String(input.selectedDate || "").trim();
  if (!selectedDate) throw new OnlineBookingError("Selected date is required.");

  const testIds = Array.isArray(input.testIds) ? input.testIds.filter((n) => Number.isInteger(n) && n > 0) : [];
  const packageIds = Array.isArray(input.packageIds) ? input.packageIds.filter((n) => Number.isInteger(n) && n > 0) : [];
  if (testIds.length + packageIds.length === 0) {
    throw new OnlineBookingError("Please select at least one test or package.");
  }

  const settings = await loadSettings();
  const slots = parseBookingTimeSlots(settings?.bookingTimeSlots);
  const parsedSel = parseSlotSelection(input.timeSlot);
  const timeSlot = parsedSel.timeSlot;
  const slotModality = normalizeSlotModality(input.slotModality || parsedSel.slotModality);
  const anyCapped = slots.some((s) => (s.maxBookings ?? 0) > 0);

  if (anyCapped && !timeSlot) {
    throw new OnlineBookingError("Please select a time slot.");
  }
  if (timeSlot) {
    const cfg = findSlotConfig(slots, timeSlot, slotModality);
    if (!cfg) {
      throw new OnlineBookingError("Please select a valid time slot.");
    }
    if (cfg.modality) {
      const selectedModalities = await modalitiesForSelection(testIds, packageIds);
      if (selectedModalities.size > 0 && !selectedModalities.has(cfg.modality)) {
        throw new OnlineBookingError(
          `The "${cfg.label}" slot is for ${cfg.modality.toUpperCase()}. Choose another slot or add a matching investigation.`,
        );
      }
    }
  }

  const source = normalizeBookingSource(input.source, "website");
  if (!(BOOKING_SOURCES as readonly string[]).includes(source)) {
    throw new OnlineBookingError("Invalid booking source.");
  }

  const override = Boolean(input.overrideCapacity);
  const overrideReason = typeof input.overrideReason === "string" ? input.overrideReason.trim() : "";
  if (override && overrideReason.length < 3) {
    throw new OnlineBookingError("A reason is required to override a full slot.");
  }

  let patientId = input.patientId ?? null;
  if (patientId) {
    const [p] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
    if (!p) throw new OnlineBookingError("Patient not found.");
  }

  const bookingRef = input.bookingRef || generateBookingRef();
  const vipOk = Boolean(input.isVip) && Boolean(settings?.vipQueueEnabled);
  // Server catalog is authoritative — ignore client totalAmount for stored amount.
  const catalogAmount = await computeCatalogAmount({ testIds, packageIds, isVip: vipOk });
  const amount = catalogAmount;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new OnlineBookingError("Invalid total amount.");
  }
  const referring = normalizeReferringDoctor(input.referringDoctorId, input.referringDoctorName);

  const inserted = await db.transaction(async (tx) => {
    if (timeSlot) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(selectedDate, timeSlot, slotModality)}))`);
      const cfg = findSlotConfig(slots, timeSlot, slotModality);
      const max = cfg?.maxBookings ?? null;
      if (max && max > 0) {
        const booked = await countOccupyingBookings({
          selectedDate,
          timeSlot,
          slotModality,
          tx: tx as unknown as typeof db,
        });
        if (booked >= max && !override) {
          throw new OnlineBookingError(
            "This time slot is full. Please choose another slot.",
            409,
          );
        }
      }
    }

    const [row] = await tx
      .insert(onlineBookingsTable)
      .values({
        bookingRef,
        name: input.name.trim().toUpperCase(),
        phone: input.phone.trim(),
        email: (input.email || "").trim(),
        selectedDate,
        timeSlot,
        slotModality: slotModality || "",
        source,
        patientId,
        capacityOverrideReason: override ? overrideReason : null,
        ...referring,
        testIds: JSON.stringify(testIds),
        packageIds: JSON.stringify(packageIds),
        totalAmount: String(amount),
        notes: (input.notes || "").trim(),
        isVip: vipOk,
        ageValue: Number(input.ageValue),
        ageUnit: (input.ageUnit || "years").toLowerCase(),
        gender: input.gender.toLowerCase(),
        status: "pending_payment",
        ...(input.gateway?.payuTxnId ? { payuTxnId: input.gateway.payuTxnId } : {}),
        ...(input.gateway?.phonepeTransactionId ? { phonepeTransactionId: input.gateway.phonepeTransactionId } : {}),
        ...(input.gateway?.bharatpeTransactionId ? { bharatpeTransactionId: input.gateway.bharatpeTransactionId } : {}),
        ...(input.gateway?.iciciTransactionId ? { iciciTransactionId: input.gateway.iciciTransactionId } : {}),
        ...(input.gateway?.razorpayOrderId ? { razorpayOrderId: input.gateway.razorpayOrderId } : {}),
      })
      .returning();
    return row;
  });

  return inserted;
}

export async function computeCatalogAmount(params: {
  testIds: number[];
  packageIds: number[];
  isVip: boolean;
}): Promise<number> {
  const parts: number[] = [];
  if (params.testIds.length > 0) {
    const tests = await db
      .select({ id: testsTable.id, price: testsTable.price })
      .from(testsTable)
      .where(inArray(testsTable.id, params.testIds));
    for (const t of tests) parts.push(Number(t.price));
  }
  if (params.packageIds.length > 0) {
    const pkgs = await db
      .select({
        id: packagesTable.id,
        price: packagesTable.price,
        discountPct: packagesTable.discountPct,
        discountAmount: packagesTable.discountAmount,
      })
      .from(packagesTable)
      .where(inArray(packagesTable.id, params.packageIds));
    for (const p of pkgs) {
      parts.push(packageEffectivePrice(p));
    }
  }
  let total = moneyAdd(...parts);
  if (params.isVip) {
    const settings = await loadSettings();
    const pct = Number(settings?.vipPercentage || 50);
    total = applyVipMultiplier(total, true, pct);
  }
  return total;
}
