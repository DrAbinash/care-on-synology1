import { Router } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { FULL_ACCESS_ROLES, normalizeRole } from "../middleware/requireStaffAuth";
import { db } from "@workspace/db";
import { PaymentEngine } from "../lib/payments/PaymentEngine";
import { resolveActiveGateway } from "../lib/payments/resolveActiveGateway";
import { getIciciPublicBaseUrl } from "../lib/payments/iciciPublicBaseUrl";
import { shareableOnlineBookingPaymentUrl } from "../lib/payments/shareableOnlineBookingPaymentUrl";
import { isReceptionPayAtCentre } from "../services/onlineBookingPayAtCentre";
import {
  onlineBookingsTable,
  patientsTable,
  testsTable,
  packagesTable,
  clinicSettingsTable,
} from "@workspace/db/schema";
import { eq, desc, and, or, ilike, inArray } from "drizzle-orm";
import { registerPatientSelfFlow } from "../services/self-registration";
import {
  computeCatalogAmount,
  createPendingOnlineBooking,
  getSlotAvailability,
  OnlineBookingError,
  parseIdList,
} from "../services/onlineBookingCreate";
import { BOOKING_SOURCES, parseBookingTimeSlots } from "../services/onlineBookingSlots";
import { canConfirmOnlineBooking, rupeesToPaise } from "../lib/financialIntegrity";

export const onlineBookingsRouter = Router();

// GET /api/online-bookings
onlineBookingsRouter.get("/", async (req, res): Promise<void> => {
  const { status, search, source, page = "1", limit = "30" } = req.query as Record<string, string>;
  const pg = Math.max(1, Number(page));
  const lim = Math.min(100, Math.max(1, Number(limit)));
  const offset = (pg - 1) * lim;

  let query = db
    .select()
    .from(onlineBookingsTable)
    .orderBy(desc(onlineBookingsTable.createdAt))
    .limit(lim)
    .offset(offset)
    .$dynamic();

  const conditions = [];
  if (status && status !== "all") {
    conditions.push(eq(onlineBookingsTable.status, status));
  }
  if (source && source !== "all" && (BOOKING_SOURCES as readonly string[]).includes(source)) {
    conditions.push(eq(onlineBookingsTable.source, source));
  }
  if (search?.trim()) {
    const pat = `%${search.trim().toLowerCase()}%`;
    conditions.push(
      or(
        ilike(onlineBookingsTable.name, pat),
        ilike(onlineBookingsTable.phone, pat),
        ilike(onlineBookingsTable.bookingRef, pat),
      ),
    );
  }
  if (conditions.length > 0) {
    query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions));
  }

  const rows = await query;
  res.json({ bookings: rows });
});

// GET /api/online-bookings/slots — same occupancy pool as the public form.
onlineBookingsRouter.get("/slots", async (req, res): Promise<void> => {
  const selectedDate = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    res.status(400).json({ error: "date (YYYY-MM-DD) is required." });
    return;
  }
  const parseIds = (raw: unknown) =>
    String(raw || "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  const result = await getSlotAvailability({
    selectedDate,
    testIds: parseIds(req.query.testIds),
    packageIds: parseIds(req.query.packageIds),
  });
  res.json(result);
});

// GET /api/online-bookings/catalog — same whitelist website/kiosk use.
onlineBookingsRouter.get("/catalog", async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(clinicSettingsTable).limit(1);
  const allowedTestIds = parseIdList(settings?.onlineBookingAllowedTestIds);
  const allowedPackageIds = parseIdList(settings?.onlineBookingAllowedPackageIds);
  const slots = parseBookingTimeSlots(settings?.bookingTimeSlots);

  const tests = allowedTestIds.length === 0
    ? []
    : await db
        .select({
          id: testsTable.id,
          code: testsTable.code,
          name: testsTable.name,
          category: testsTable.category,
          department: testsTable.department,
          price: testsTable.price,
        })
        .from(testsTable)
        .where(and(eq(testsTable.isActive, true), inArray(testsTable.id, allowedTestIds)));

  const packages = allowedPackageIds.length === 0
    ? []
    : await db
        .select({
          id: packagesTable.id,
          code: packagesTable.packageCode,
          name: packagesTable.name,
          price: packagesTable.price,
        })
        .from(packagesTable)
        .where(and(eq(packagesTable.isActive, true), inArray(packagesTable.id, allowedPackageIds)));

  res.json({
    tests,
    packages,
    slots,
    vipQueueEnabled: Boolean(settings?.vipQueueEnabled),
    vipPercentage: Number(settings?.vipPercentage || 50),
    onlineBookingEnabled: Boolean(settings?.onlineBookingEnabled),
  });
});

// POST /api/online-bookings — reception/phone booking through the same pipeline.
onlineBookingsRouter.post("/", async (req: StaffAuthRequest, res): Promise<void> => {
  const body = (req.body || {}) as Record<string, unknown>;
  const sourceRaw = String(body.source || "reception");
  if (sourceRaw !== "reception" && sourceRaw !== "phone") {
    res.status(400).json({ error: "source must be reception or phone." });
    return;
  }

  const overrideCapacity = Boolean(body.overrideCapacity);
  if (overrideCapacity) {
    const role = normalizeRole(req.staffSession?.role || "");
    if (!FULL_ACCESS_ROLES.has(role)) {
      res.status(403).json({ error: "Only an admin can override a full slot." });
      return;
    }
  }

  let name = String(body.name || "").trim();
  let phone = String(body.phone || "").trim();
  let gender = String(body.gender || "").trim();
  let ageValue = Number(body.ageValue);
  let ageUnit = String(body.ageUnit || "years");
  let email = String(body.email || "").trim();
  let patientId = body.patientId != null ? Number(body.patientId) : null;

  if (patientId && Number.isInteger(patientId) && patientId > 0) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
    if (!patient) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    if (!name) name = `${patient.firstName} ${patient.lastName}`.trim();
    if (!phone) phone = patient.phone;
    if (!gender) gender = patient.gender;
    if (!Number.isFinite(ageValue) || ageValue < 0) ageValue = Number(patient.ageValue || 0);
    if (!body.ageUnit && patient.ageUnit) ageUnit = patient.ageUnit;
    if (!email && patient.email) email = patient.email;
  } else {
    patientId = null;
  }

  const testIds = Array.isArray(body.testIds) ? (body.testIds as number[]) : [];
  const packageIds = Array.isArray(body.packageIds) ? (body.packageIds as number[]) : [];
  const isVip = Boolean(body.isVip);

  let totalAmount = Number(body.totalAmount);
  try {
    const computed = await computeCatalogAmount({ testIds, packageIds, isVip });
    if (computed > 0) totalAmount = computed;
  } catch {
    /* fall back to client amount */
  }

  try {
    const booking = await createPendingOnlineBooking({
      name,
      phone,
      email,
      selectedDate: String(body.selectedDate || ""),
      timeSlot: String(body.timeSlot || ""),
      slotModality: typeof body.slotModality === "string" ? body.slotModality : "",
      testIds,
      packageIds,
      totalAmount,
      notes: String(body.notes || ""),
      isVip,
      ageValue,
      ageUnit,
      gender,
      referringDoctorId: (body.referringDoctorId as number | null) ?? null,
      referringDoctorName: String(body.referringDoctorName || ""),
      source: sourceRaw,
      patientId,
      overrideCapacity,
      overrideReason: String(body.overrideReason || ""),
    });
    res.status(201).json({ booking });
  } catch (err) {
    if (err instanceof OnlineBookingError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: (err as Error).message || "Failed to create booking" });
  }
});

// GET /api/online-bookings/:id
onlineBookingsRouter.get("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Booking not found" }); return; }
  res.json(row);
});

// POST /api/online-bookings/:id/cancel
onlineBookingsRouter.post("/:id/cancel", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, id)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!["paid", "pending_payment"].includes(booking.status)) {
    res.status(400).json({ error: `Cannot cancel a booking with status '${booking.status}'` });
    return;
  }
  const [updated] = await db
    .update(onlineBookingsTable)
    .set({ status: "cancelled" })
    .where(eq(onlineBookingsTable.id, id))
    .returning();
  res.json(updated);
});

export { isReceptionPayAtCentre };

// Extracted confirmation helper for reuse in public-booking (auto-confirm) and manual staff confirm
export async function confirmBookingInternal(
  bookingId: number,
  staffName: string = "Super Admin",
  opts?: { autoConfirm?: boolean },
): Promise<{ booking: any; billId: number; patientId: number; dueAtCentre: boolean }> {
  const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, bookingId)).limit(1);
  if (!booking) throw new Error("Booking not found");
  if (booking.status === "confirmed") {
    return { booking, billId: booking.billId || 0, patientId: booking.patientId || 0, dueAtCentre: false };
  }

  // Parse test and package IDs
  let testIds: number[] = [];
  let packageIds: number[] = [];
  try {
    testIds = JSON.parse(booking.testIds) as number[];
    packageIds = JSON.parse(booking.packageIds) as number[];
  } catch { /* already empty arrays */ }

  // Resolve name
  const nameParts = booking.name.trim().split(/\s+/);
  const firstName = nameParts[0] || booking.name;
  const lastName = nameParts.slice(1).join(" ") || "";

  const autoConfirm = opts?.autoConfirm ?? (staffName === "Super Admin" || /webhook|reconcil/i.test(staffName));
  const payAtCentre = isReceptionPayAtCentre(booking);
  const frozen = Number(booking.totalAmount);
  // Staff desk/QR confirm of pending public booking asserts FULL frozen collection only.
  const staffCollectedAmount =
    !payAtCentre && !autoConfirm && booking.status !== "paid" && booking.status !== "confirmed"
      ? frozen
      : undefined;
  const confirmGate = canConfirmOnlineBooking({
    status: booking.status,
    frozenAmount: booking.totalAmount,
    payAtCentre,
    autoConfirm,
    staffCollectedAmount,
  });
  if (confirmGate) throw new Error(confirmGate);

  // Determine gateway and payment reference from booking record.
  // Pay-at-centre must NOT be labelled as ICICI/Razorpay/etc. Initiate-only
  // stamps (e.g. iciciTransactionId = bookingRef from Share Link) are not settlement.
  let paymentMethod = "Online";
  let paymentRef = booking.bookingRef;
  let paymentNotes = `Paid online. Booking ref: ${booking.bookingRef}`;
  let paymentAmount = Number(booking.totalAmount);

  if (payAtCentre) {
    paymentMethod = "due";
    paymentRef = booking.bookingRef;
    paymentNotes = `Pay at centre. Collect at Billing Desk. Booking ref: ${booking.bookingRef}`;
    paymentAmount = 0;
  } else if (booking.razorpayPaymentId || booking.razorpayOrderId) {
    paymentMethod = "Online (Razorpay)";
    paymentRef = booking.razorpayPaymentId || booking.razorpayOrderId || booking.bookingRef;
    paymentNotes = `Paid online via Razorpay. Booking ref: ${booking.bookingRef}`;
  } else if (booking.payuTxnId || booking.payuPaymentId) {
    paymentMethod = "Online (PayU)";
    paymentRef = booking.payuPaymentId || booking.payuTxnId || booking.bookingRef;
    paymentNotes = `Paid online via PayU. Booking ref: ${booking.bookingRef}`;
  } else if (booking.phonepeTransactionId || booking.phonepeProviderRefId) {
    paymentMethod = "Online (PhonePe)";
    paymentRef = booking.phonepeProviderRefId || booking.phonepeTransactionId || booking.bookingRef;
    paymentNotes = `Paid online via PhonePe. Booking ref: ${booking.bookingRef}`;
  } else if (booking.bharatpeTransactionId || booking.bharatpeProviderRefId) {
    paymentMethod = "Online (BharatPe)";
    paymentRef = booking.bharatpeProviderRefId || booking.bharatpeTransactionId || booking.bookingRef;
    paymentNotes = `Paid online via BharatPe. Booking ref: ${booking.bookingRef}`;
  } else if (booking.status === "paid" && (booking.iciciTransactionId || booking.iciciProviderRefId)) {
    paymentMethod = "Online (ICICI Orange Pay)";
    paymentRef = booking.iciciProviderRefId || booking.iciciTransactionId || booking.bookingRef;
    paymentNotes = `Paid online via ICICI Orange Pay. Booking ref: ${booking.bookingRef}`;
  } else {
    // Self-declared QR / BharatPe booking (website/kiosk staff-verified)
    if (staffName === "Super Admin") {
      paymentMethod = "Online (BharatPe - Unconfirmed)";
      paymentNotes = `Self-declared QR payment. Pending staff verification. Booking ref: ${booking.bookingRef}`;
    } else {
      paymentMethod = "Online (BharatPe)";
      paymentNotes = `UPI/QR Payment confirmed by staff ${staffName}. Booking ref: ${booking.bookingRef}`;
    }
  }

  // Non-pay-at-centre always posts the frozen full amount; staff-assertion path must match.
  if (!payAtCentre) {
    paymentAmount = frozen;
    if (staffCollectedAmount != null && rupeesToPaise(paymentAmount) !== rupeesToPaise(frozen)) {
      throw new Error("Staff-confirmed online booking payment must equal the frozen booking amount");
    }
  }

  const result = await registerPatientSelfFlow({
    firstName,
    lastName,
    phone: booking.phone,
    gender: booking.gender || "male",
    ageValue: booking.ageValue || 0,
    ageUnit: booking.ageUnit || "years",
    testIds,
    packageIds,
    paymentMethod,
    paymentReference: paymentRef,
    paymentAmount,
    isVip: !!booking.isVip,
    notes: payAtCentre
      ? [booking.notes, paymentNotes].filter(Boolean).join(" ").trim()
      : booking.notes || "",
    email: booking.email || "",
    source: "online",
    createdByName: `Online Booking (${staffName})`,
    // Referring doctor captured at booking time → order.doctor_id, so the
    // referral shows up on the bill just like a Billing Desk referral.
    doctorId: booking.referringDoctorId ?? null,
    authoritativeTotal: Number(booking.totalAmount),
  });

  // Mark booking confirmed. Pay-at-centre must not keep initiate-only ICICI
  // stamps (Share Link sets iciciTransactionId = bookingRef before money arrives).
  const [updated] = await db
    .update(onlineBookingsTable)
    .set({
      status: "confirmed",
      patientId: result.patientDbId,
      billId: result.billId,
      confirmedByName: staffName,
      confirmedAt: new Date(),
      ...(payAtCentre
        ? { iciciTransactionId: null, iciciProviderRefId: null }
        : {}),
    })
    .where(eq(onlineBookingsTable.id, booking.id))
    .returning();

  return {
    booking: updated,
    billId: result.billId,
    patientId: result.patientDbId,
    dueAtCentre: payAtCentre,
  };
}

// POST /api/online-bookings/:id/confirm
// Creates patient (if not existing), order, bill, and queue tokens
onlineBookingsRouter.post("/:id/confirm", async (req: StaffAuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const staffName = req.staffSession?.subjectName || "Staff";

  try {
    const result = await confirmBookingInternal(id, staffName, { autoConfirm: false });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to confirm booking" });
  }
});

// POST /api/online-bookings/:id/payment-link
// Same PaymentEngine / active-gateway path as website booking. Failures are
// 400 (not 502/503) so the ERP toast shows the gateway message instead of
// "Server temporarily unavailable" — billing desk is unaffected.
onlineBookingsRouter.post("/:id/payment-link", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, id)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const settings = await db.select().from(clinicSettingsTable).limit(1);
  const s = settings[0];
  const amount = Number(booking.totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid booking amount." });
    return;
  }

  const gateway = resolveActiveGateway(s || {});
  if (!gateway) {
    res.status(400).json({
      error: "No payment gateway is configured. Use Pay at Centre, or enable the clinic gateway in Settings → Payments.",
    });
    return;
  }

  const publicBase = gateway === "icici" || gateway === "hdfc"
    ? getIciciPublicBaseUrl()
    : `${req.protocol}://${req.get("host")}`;

  // Razorpay PaymentEngine is still a placeholder — keep the existing payment-links API.
  if (gateway === "razorpay") {
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || (s?.razorpayKeyId ?? "");
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
    if (!razorpayKeyId || !razorpayKeySecret) {
      res.status(400).json({ error: "Razorpay is selected but credentials are missing. Use Pay at Centre." });
      return;
    }
    const amountPaise = Math.round(amount * 100);
    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
    const callbackUrl = `${publicBase}/?booking=link_success&ref=${encodeURIComponent(booking.bookingRef)}`;
    try {
      const rpRes = await fetch("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          accept_partial: false,
          description: `Care Diagnostics booking ${booking.bookingRef}`,
          customer: {
            name: booking.name,
            contact: booking.phone.replace(/[^0-9]/g, "").slice(0, 10),
            email: booking.email || undefined,
          },
          notify: { sms: true, email: Boolean(booking.email) },
          reminder_enable: true,
          callback_url: callbackUrl,
          callback_method: "get",
        }),
      });
      if (!rpRes.ok) {
        const err = await rpRes.json().catch(() => ({}));
        const detail = (err as { error?: { description?: string } }).error?.description;
        res.status(400).json({ error: detail || "Razorpay could not create a payment link. Use Pay at Centre." });
        return;
      }
      const data = (await rpRes.json()) as { short_url: string; id: string };
      res.json({ url: data.short_url, linkId: data.id });
      return;
    } catch {
      res.status(400).json({ error: "Could not reach Razorpay. Use Pay at Centre, or try Share Link again." });
      return;
    }
  }

  try {
    const returnUrl = gateway === "icici" || gateway === "hdfc"
      ? `${publicBase}/api/public/booking/icici-callback`
      : gateway === "bharatpe"
        ? `${publicBase}/api/public/booking/bharatpe-callback`
        : `${publicBase}/api/public/booking/${gateway}-callback`;

    const result = await PaymentEngine.initiatePayment(gateway, {
      bookingRef: booking.bookingRef,
      name: booking.name.trim(),
      phone: booking.phone.trim(),
      email: booking.email?.trim() || "",
      amount,
      returnUrl,
    });

    if (!result.success || !result.redirectUrl) {
      res.status(400).json({
        error: result.errorMessage || `${gateway} could not create a shareable payment link. Use Pay at Centre.`,
      });
      return;
    }

    if (gateway === "icici" || gateway === "hdfc") {
      await db.update(onlineBookingsTable)
        .set({
          iciciTransactionId: booking.bookingRef,
          iciciProviderRefId: result.rawResponse?.tranCtx ?? null,
        })
        .where(eq(onlineBookingsTable.id, booking.id));
    }

    // ICICI/HDFC: share the bank-whitelisted bridge URL (same as Billing Desk QR),
    // not the raw HPP redirect — phones opening pgpay.icicibank.com directly often
    // fail domain validation, so staff resorted to pasting QR screenshots.
    const shareUrl = shareableOnlineBookingPaymentUrl(
      gateway,
      booking.bookingRef,
      result.redirectUrl,
    );

    res.json({ url: shareUrl, linkId: result.gatewayTxnId || booking.bookingRef });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not create payment link";
    res.status(400).json({ error: `${message}. Use Pay at Centre.` });
  }
});
