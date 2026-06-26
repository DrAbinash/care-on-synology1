import { Router } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { db } from "@workspace/db";
import { PaymentEngine } from "../lib/payments/PaymentEngine";
import {
  onlineBookingsTable,
  patientsTable,
  patientCounterTable,
  ordersTable,
  orderTestsTable,
  testsTable,
  packagesTable,
  packageTestsTable,
  billsTable,
  paymentsTable,
  clinicSettingsTable,
} from "@workspace/db/schema";
import { eq, desc, and, or, ilike, sql, inArray } from "drizzle-orm";
import { generateBillNumber } from "./bills";
import { generateTokenForBill } from "./tokens";
import { generateTestTokensForOrder } from "./test-tokens";
import crypto from "node:crypto";
import { calculateDobFromAge } from "./public-booking";
import { registerPatientSelfFlow } from "../services/self-registration";

export const onlineBookingsRouter = Router();

async function generatePatientId(): Promise<string> {
  const [counter] = await db.select().from(patientCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db.update(patientCounterTable).set({ counter: seq }).where(eq(patientCounterTable.id, counter.id));
  } else {
    await db.insert(patientCounterTable).values({ counter: 1 });
  }
  return `P${String(seq).padStart(5, "0")}`;
}

// GET /api/online-bookings
onlineBookingsRouter.get("/", async (req, res): Promise<void> => {
  const { status, search, page = "1", limit = "30" } = req.query as Record<string, string>;
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

// Extracted confirmation helper for reuse in public-booking (auto-confirm) and manual staff confirm
export async function confirmBookingInternal(bookingId: number, staffName: string = "Super Admin"): Promise<{ booking: any; billId: number; patientId: number }> {
  const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, bookingId)).limit(1);
  if (!booking) throw new Error("Booking not found");
  if (booking.status === "confirmed") {
    return { booking, billId: booking.billId || 0, patientId: booking.patientId || 0 };
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

  // Determine gateway and payment reference from booking record
  let paymentMethod = "Online";
  let paymentRef = booking.bookingRef;
  let paymentNotes = `Paid online. Booking ref: ${booking.bookingRef}`;

  if (booking.razorpayPaymentId || booking.razorpayOrderId) {
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
  } else if (booking.iciciTransactionId || booking.iciciProviderRefId) {
    paymentMethod = "Online (ICICI Orange Pay)";
    paymentRef = booking.iciciProviderRefId || booking.iciciTransactionId || booking.bookingRef;
    paymentNotes = `Paid online via ICICI Orange Pay. Booking ref: ${booking.bookingRef}`;
  } else {
    // Self-declared QR / BharatPe booking
    if (staffName === "Super Admin") {
      paymentMethod = "Online (BharatPe - Unconfirmed)";
      paymentNotes = `Self-declared QR payment. Pending staff verification. Booking ref: ${booking.bookingRef}`;
    } else {
      paymentMethod = "Online (BharatPe)";
      paymentNotes = `UPI/QR Payment confirmed by staff ${staffName}. Booking ref: ${booking.bookingRef}`;
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
    paymentAmount: Number(booking.totalAmount),
    isVip: !!booking.isVip,
    notes: booking.notes || "",
    email: booking.email || "",
    source: "online",
    createdByName: `Online Booking (${staffName})`,
  });

  // Mark booking confirmed
  const [updated] = await db
    .update(onlineBookingsTable)
    .set({
      status: "confirmed",
      patientId: result.patientDbId,
      billId: result.billId,
      confirmedByName: staffName,
      confirmedAt: new Date(),
    })
    .where(eq(onlineBookingsTable.id, booking.id))
    .returning();

  return { booking: updated, billId: result.billId, patientId: result.patientDbId };
}

// POST /api/online-bookings/:id/confirm
// Creates patient (if not existing), order, bill, and queue tokens
onlineBookingsRouter.post("/:id/confirm", async (req: StaffAuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const staffName = req.staffSession?.subjectName || "Staff";

  try {
    const result = await confirmBookingInternal(id, staffName);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to confirm booking" });
  }
});

// POST /api/online-bookings/:id/payment-link
// Creates a payment link for an existing booking using the active gateway.
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

  const base = `${req.protocol}://${req.get("host")}`;

  // Determine active gateway
  const bharatpeApiKey = process.env.BHARATPE_API_KEY || "";
  const bharatpeApiSecret = process.env.BHARATPE_API_SECRET || "";
  const bharatpeMerchantId = process.env.BHARATPE_MERCHANT_ID || (s?.bharatpeMerchantId ?? "");
  const iciciMerchantId = process.env.ICICI_MERCHANT_ID || (s?.iciciMerchantId ?? "");
  const iciciSecretKey = process.env.ICICI_SECRET_KEY || (s?.iciciSecretKey ?? "");
  const iciciAggregatorId = process.env.ICICI_AGGREGATOR_ID || (s?.iciciAggregatorId ?? "");

  // 1. Try BharatPe
  if (s?.bharatpeEnabled && bharatpeMerchantId && bharatpeApiKey && bharatpeApiSecret) {
    const amountPaise = Math.round(amount * 100);
    const timestamp = String(Date.now());
    const authPayload = `${bharatpeMerchantId}:${timestamp}`;
    const authHash = crypto.createHmac("sha256", bharatpeApiSecret).update(authPayload).digest("hex");
    const authToken = `${bharatpeApiKey}:${authHash}:${timestamp}`;
    const isStaging = process.env.NODE_ENV !== "production";
    const bpBase = isStaging ? "https://uat-api.bharatpe.in/api/v1" : "https://api.bharatpe.in/api/v1";
    const callbackUrl = `${base}/api/public/booking/bharatpe-callback`;
    const redirectUrl = `${base}/?booking=bharatpe_done&ref=${encodeURIComponent(booking.bookingRef)}`;

    try {
      const bpRes = await fetch(`${bpBase}/merchant/checkout/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-KEY": bharatpeApiKey,
          "X-MERCHANT-ID": bharatpeMerchantId,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          merchantId: bharatpeMerchantId,
          merchantTransactionId: booking.bookingRef,
          amount: amountPaise,
          currency: "INR",
          customerName: booking.name.trim(),
          customerMobile: booking.phone.replace(/\D/g, "").slice(-10),
          customerEmail: booking.email?.trim() || "",
          description: `Care Diagnostics booking ${booking.bookingRef}`,
          callbackUrl,
          redirectUrl,
        }),
      });
      if (!bpRes.ok) {
        const errText = await bpRes.text().catch(() => "");
        res.status(502).json({ error: "BharatPe gateway error.", details: errText });
        return;
      }
      const bpData = (await bpRes.json()) as { success: boolean; code: string; data?: { redirectUrl?: string; transactionId?: string } };
      if (!bpData.success || !bpData.data?.redirectUrl) {
        res.status(502).json({ error: "Could not initiate BharatPe payment.", code: bpData.code });
        return;
      }
      res.json({ url: bpData.data.redirectUrl, linkId: bpData.data.transactionId || booking.bookingRef });
      return;
    } catch {
      res.status(502).json({ error: "Could not connect to BharatPe." });
      return;
    }
  }

  // 2. Try ICICI (Orange Pay)
  if (s?.iciciEnabled) {
    try {
      const result = await PaymentEngine.initiatePayment("icici", {
        bookingRef: booking.bookingRef,
        name: booking.name.trim(),
        phone: booking.phone.trim(),
        email: booking.email?.trim() || "",
        amount,
        returnUrl: `${base}/api/public/booking/icici-callback`,
      });

      if (!result.success) {
        res.status(502).json({ error: "ICICI gateway error.", details: result.errorMessage });
        return;
      }

      await db.update(onlineBookingsTable)
        .set({
          iciciTransactionId: booking.bookingRef,
          iciciProviderRefId: result.rawResponse.tranCtx,
        })
        .where(eq(onlineBookingsTable.id, booking.id));

      res.json({ url: result.redirectUrl, linkId: result.rawResponse.tranCtx });
      return;
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Could not connect to ICICI gateway." });
      return;
    }
  }

  // 3. Fallback to Razorpay
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID || (s?.razorpayKeyId ?? "");
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
  if (razorpayKeyId && razorpayKeySecret) {
    const amountPaise = Math.round(amount * 100);
    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
    const callbackUrl = `${base}/?booking=link_success&ref=${encodeURIComponent(booking.bookingRef)}`;
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
        res.status(502).json({ error: "Razorpay error.", details: (err as { error?: { description?: string } }).error?.description });
        return;
      }
      const data = (await rpRes.json()) as { short_url: string; id: string };
      res.json({ url: data.short_url, linkId: data.id });
      return;
    } catch {
      res.status(502).json({ error: "Could not connect to Razorpay." });
      return;
    }
  }

  res.status(503).json({ error: "No payment gateway is configured. Enable BharatPe, ICICI (Orange Pay), or Razorpay in Settings." });
});
