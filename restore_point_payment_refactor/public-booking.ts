import { Router } from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  clinicSettingsTable,
  testsTable,
  packagesTable,
  packageTestsTable,
  onlineBookingsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { PaymentEngine } from "../lib/payments/PaymentEngine";

const otpStore = new Map<string, { code: string; name: string; expiresAt: number }>();

export let lastIciciTransaction: {
  txnRef?: string;
  responseCode?: string;
  respDescription?: string;
  timestamp?: string;
} | null = null;

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const publicBookingRouter = Router();

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking attempts. Please try again later." },
});

const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many order attempts. Please try again in 15 minutes." },
});

async function getSettings() {
  const [row] = await db.select().from(clinicSettingsTable).limit(1);
  return row;
}

function generateBookingRef(): string {
  const now = new Date();
  const prefix = `OB${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${rand}`;
}

// ── PayU helpers ──────────────────────────────────────────────────────────────

const PAYU_PROD_URL = "https://secure.payu.in/_payment";
const PAYU_TEST_URL = "https://test.payu.in/_payment";

function payuRequestHash(params: {
  key: string; txnid: string; amount: string; productinfo: string;
  firstname: string; email: string; salt: string;
}): string {
  const { key, txnid, amount, productinfo, firstname, email, salt } = params;
  const str = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||${salt}`;
  return crypto.createHash("sha512").update(str).digest("hex");
}

function payuResponseHash(params: {
  key: string; txnid: string; amount: string; productinfo: string;
  firstname: string; email: string; status: string; salt: string;
}): string {
  const { key, txnid, amount, productinfo, firstname, email, status, salt } = params;
  const str = `${salt}|${status}||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  return crypto.createHash("sha512").update(str).digest("hex");
}

function getPublicBase(req: { headers: Record<string, string | string[] | undefined> }): string {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL;
  if (publicBaseUrl) return publicBaseUrl.replace(/\/$/, "");
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0]}`;
  const host = String(req.headers["host"] || "localhost");
  const proto = String(req.headers["x-forwarded-proto"] || "http");
  return `${proto}://${host}`;
}

// ── GET /api/public/booking/config ────────────────────────────────────────────
publicBookingRouter.get("/config", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings) {
    res.json({ enabled: false, keyId: "", vipEnabled: false, gateway: null });
    return;
  }

  const razorpayKeyId = settings.razorpayKeyId || "";
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || "";
  const payuSalt = process.env.PAYU_MERCHANT_SALT || "";
  const payuKey = settings.payuMerchantKey || "";

  const phonepeSalt = process.env.PHONEPE_API_SECRET || "";
  const phonepeMerchantId = process.env.PHONEPE_MERCHANT_ID || settings.phonepeMerchantId || "";

  const bharatpeApiKey = process.env.BHARATPE_API_KEY || "";
  const bharatpeMerchantId = process.env.BHARATPE_MERCHANT_ID || settings.bharatpeMerchantId || "";

  const iciciMerchantId = process.env.ICICI_MERCHANT_ID || settings.iciciMerchantId || "";
  const iciciSecretKey = process.env.ICICI_SECRET_KEY || settings.iciciSecretKey || "";

  let gateway: "razorpay" | "payu" | "phonepe" | "bharatpe" | "icici" | null = null;
  const configuredGateway = settings.activePaymentGateway as "razorpay" | "payu" | "phonepe" | "bharatpe" | "icici";

  if (configuredGateway === "icici" && settings.iciciEnabled && iciciMerchantId && iciciSecretKey) gateway = "icici";
  else if (configuredGateway === "bharatpe" && settings.bharatpeEnabled && bharatpeMerchantId && bharatpeApiKey) gateway = "bharatpe";
  else if (configuredGateway === "payu" && settings.payuEnabled && payuKey && payuSalt) gateway = "payu";
  else if (configuredGateway === "phonepe" && settings.phonepeEnabled && phonepeMerchantId && phonepeSalt) gateway = "phonepe";
  else if (configuredGateway === "razorpay" && razorpayKeyId && razorpaySecret) gateway = "razorpay";
  else {
    if (settings.iciciEnabled && iciciMerchantId && iciciSecretKey) gateway = "icici";
    else if (settings.bharatpeEnabled && bharatpeMerchantId && bharatpeApiKey) gateway = "bharatpe";
    else if (settings.payuEnabled && payuKey && payuSalt) gateway = "payu";
    else if (settings.phonepeEnabled && phonepeMerchantId && phonepeSalt) gateway = "phonepe";
    else if (razorpayKeyId && razorpaySecret) gateway = "razorpay";
  }

  let allowedTestIds: number[] = [];
  try {
    const parsed = JSON.parse(settings?.onlineBookingAllowedTestIds || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      allowedTestIds = parsed.filter((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0);
    }
  } catch { /* ignore */ }

  res.json({
    enabled: settings.onlineBookingEnabled,
    keyId: razorpayKeyId,
    vipEnabled: settings.vipQueueEnabled,
    gateway,
    payuMerchantKey: payuKey,
    phonepeMerchantId: settings.phonepeEnabled ? phonepeMerchantId : "",
    bharatpeMerchantId: settings.bharatpeEnabled ? bharatpeMerchantId : "",
    iciciMerchantId: settings.iciciEnabled ? iciciMerchantId : "",
    kioskUpiVpa: settings.kioskUpiVpa,
    kioskUpiName: settings.kioskUpiName,
    upiQrEnabled: settings.upiQrEnabled,
    upiVpa: settings.upiVpa || settings.kioskUpiVpa || "",
    upiQrImageUrl: settings.upiQrImageUrl || "",
    allowedTestIds,
    vipPercentage: Number(settings.vipPercentage || 50),
    disclaimerRefundPercentage: settings.disclaimerRefundPercentage ?? 90,
    activePaymentGateway: gateway || settings.activePaymentGateway,
    enableCardPayment: settings.enableCardPayment,
    enableQrPayment: settings.enableQrPayment,
    enableVipBooking: settings.enableVipBooking,
    enablePaymentLogos: settings.enablePaymentLogos,
    enablePaymentTimer: settings.enablePaymentTimer,
    customIciciBannerUrl: settings.customIciciBannerUrl,
    customPhonepeBannerUrl: settings.customPhonepeBannerUrl,
    customBharatpeBannerUrl: settings.customBharatpeBannerUrl,
    customPayuBannerUrl: settings.customPayuBannerUrl,
  });
});

// GET /api/public/booking/by-ref?ref=...
publicBookingRouter.get("/by-ref", async (req, res): Promise<void> => {
  const ref = String(req.query.ref || "").trim();
  if (!ref) { res.status(400).json({ error: "ref is required" }); return; }
  const [row] = await db.select().from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.bookingRef, ref))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Booking not found" }); return; }
  res.json({ booking: row });
});

// GET /api/public/booking/my-bookings
publicBookingRouter.get("/my-bookings", async (req, res): Promise<void> => {
  const phone = String(req.query.phone || "");
  if (!phone) { res.json({ bookings: [] }); return; }
  const rows = await db.select()
    .from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.phone, phone))
    .orderBy(onlineBookingsTable.id)
    .limit(50);
  res.json({ bookings: rows });
});

// GET /api/public/booking/my-reports
publicBookingRouter.get("/my-reports", async (req, res): Promise<void> => {
  const phone = String(req.query.phone || "");
  if (!phone) { res.json({ reports: [] }); return; }
  // Stub: return empty for now; reports table integration is future work
  res.json({ reports: [] });
});

// GET /api/public/booking/tests
publicBookingRouter.get("/tests", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  let allowedTestIds: number[] = [];
  try {
    const parsed = JSON.parse(settings?.onlineBookingAllowedTestIds || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      allowedTestIds = parsed.filter((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0);
    }
  } catch { /* ignore */ }

  const baseQuery = db
    .select({
      id: testsTable.id,
      code: testsTable.code,
      name: testsTable.name,
      category: testsTable.category,
      department: testsTable.department,
      price: testsTable.price,
      duration: testsTable.duration,
    })
    .from(testsTable)
    .where(and(eq(testsTable.isActive, true)))
    .orderBy(testsTable.category, testsTable.name);

  const tests = await baseQuery;

  // If whitelist is configured, only return those tests; otherwise return all active tests
  const filtered = allowedTestIds.length > 0
    ? tests.filter((t) => allowedTestIds.includes(t.id))
    : tests;

  res.json({ tests: filtered });
});

// GET /api/public/booking/packages
publicBookingRouter.get("/packages", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  let allowedPkgIds: number[] = [];
  try {
    const parsed = JSON.parse(settings?.onlineBookingAllowedPackageIds || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      allowedPkgIds = parsed.filter((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0);
    }
  } catch { /* ignore */ }

  const pkgs = await db
    .select({
      id: packagesTable.id,
      code: packagesTable.packageCode,
      name: packagesTable.name,
      price: packagesTable.price,
      description: packagesTable.description,
    })
    .from(packagesTable)
    .where(eq(packagesTable.isActive, true))
    .orderBy(packagesTable.name);

  const filtered = allowedPkgIds.length > 0
    ? pkgs.filter((p) => allowedPkgIds.includes(p.id))
    : pkgs;

  res.json({ packages: filtered });
});

// ── POST /api/public/booking/payu-initiate ────────────────────────────────────
// Creates a pending booking and returns PayU form fields for the frontend to submit.
publicBookingRouter.post("/payu-initiate", createOrderLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const {
    name: rawName, phone, email = "", selectedDate, timeSlot = "",
    testIds = [], packageIds = [], totalAmount,
    notes = "", isVip = false,
  } = req.body as {
    name: string; phone: string; email?: string; selectedDate: string; timeSlot?: string;
    testIds?: number[]; packageIds?: number[]; totalAmount: number;
    notes?: string; isVip?: boolean;
  };

  if (!rawName?.trim() || !phone?.trim() || !selectedDate) {
    res.status(400).json({ error: "Name, phone, and selected date are required." });
    return;
  }
  const name = rawName.trim().toUpperCase();
  if (!Array.isArray(testIds) || !Array.isArray(packageIds) || (testIds.length + packageIds.length) === 0) {
    res.status(400).json({ error: "Please select at least one test or package." });
    return;
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid total amount." });
    return;
  }

  const bookingRef = generateBookingRef();
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);
  const returnUrl = `${base}/api/public/booking/payu-callback`;

  try {
    const result = await PaymentEngine.initiatePayment("payu", {
      bookingRef,
      name,
      phone: phone.trim(),
      email: email.trim(),
      amount,
      returnUrl,
    });

    if (!result.success) {
      res.status(400).json({ error: "Could not initiate PayU payment. Please try again.", details: result.errorMessage });
      return;
    }

    await db.insert(onlineBookingsTable).values({
      bookingRef,
      name: name,
      phone: phone.trim(),
      email: email.trim(),
      selectedDate,
      timeSlot: timeSlot.trim(),
      testIds: JSON.stringify(testIds),
      packageIds: JSON.stringify(packageIds),
      totalAmount: String(amount),
      notes: notes.trim(),
      isVip: Boolean(isVip) && Boolean(settings.vipQueueEnabled),
      payuTxnId: bookingRef,
      status: "pending_payment",
    });

    res.json(result.rawResponse); // PayU returns { fields, actionUrl }
  } catch (err: any) {
    logger.error({ err, bookingRef }, "PayU initiate exception");
    res.status(400).json({ error: "Could not connect to PayU. Please try again." });
  }
});

// ── POST /api/public/booking/payu-success ─────────────────────────────────────
// PayU redirects here after successful payment (form POST, urlencoded body).
// Must be reachable publicly without CSRF.
publicBookingRouter.post("/payu-success", async (req, res): Promise<void> => {
  const body = req.body as Record<string, string>;
  const { txnid, mihpayid, status, hash: returnedHash, amount, productinfo, firstname, email } = body;

  const salt = process.env.PAYU_MERCHANT_SALT || "";
  const settings = await getSettings();
  const merchantKey = settings?.payuMerchantKey || "";

  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);

  // Verify hash
  if (salt && merchantKey && txnid) {
    const expected = payuResponseHash({ key: merchantKey, txnid, amount: amount ?? "", productinfo: productinfo ?? "", firstname: firstname ?? "", email: email ?? "", status: status ?? "", salt });
    if (expected !== returnedHash) {
      res.redirect(getBookingConfirmationUrl(base, "", "payu", true, "hash_mismatch"));
      return;
    }
  }

  if (status !== "success") {
    res.redirect(getBookingConfirmationUrl(base, "", "payu", true, status ?? "unknown"));
    return;
  }

  // Find booking by txnid
  const [booking] = await db
    .select()
    .from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.payuTxnId, txnid))
    .limit(1);

  if (!booking) {
    res.redirect(getBookingConfirmationUrl(base, "", "payu", true, "not_found"));
    return;
  }

  if (booking.status === "paid" || booking.status === "confirmed") {
    res.redirect(getBookingConfirmationUrl(base, booking.bookingRef, "payu"));
    return;
  }

  await db
    .update(onlineBookingsTable)
    .set({ payuPaymentId: mihpayid ?? "", status: "paid" })
    .where(eq(onlineBookingsTable.id, booking.id));

  res.redirect(getBookingConfirmationUrl(base, booking.bookingRef, "payu"));
});

// ── POST /api/public/booking/payu-failure ─────────────────────────────────────
publicBookingRouter.post("/payu-failure", async (req, res): Promise<void> => {
  const body = req.body as Record<string, string>;
  const { txnid, error_Message } = body;

  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);

  if (txnid) {
    const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.payuTxnId, txnid)).limit(1);
    if (booking && booking.status === "pending_payment") {
      await db.update(onlineBookingsTable).set({ status: "payment_failed", failureReason: error_Message || "Payment cancelled" }).where(eq(onlineBookingsTable.id, booking.id));
    }
  }

  res.redirect(getBookingConfirmationUrl(base, "", "payu", true, error_Message ?? "Payment cancelled"));
});

// ── PhonePe helpers ───────────────────────────────────────────────────────────

const PHONEPE_PROD_BASE = "https://api.phonepe.com/apis/hermes";
const PHONEPE_STAGING_BASE = "https://api-preprod.phonepe.com/apis/hermes";

function phonepeXVerify(base64Payload: string, endpoint: string, saltKey: string, saltIndex: string): string {
  const hash = crypto.createHash("sha256").update(base64Payload + endpoint + saltKey).digest("hex");
  return `${hash}###${saltIndex}`;
}

// ── POST /api/public/booking/phonepe-initiate ─────────────────────────────────
// Creates a pending booking and returns the PhonePe redirect URL.
publicBookingRouter.post("/phonepe-initiate", createOrderLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const {
    name: rawName, phone, email = "", selectedDate, timeSlot = "",
    testIds = [], packageIds = [], totalAmount,
    notes = "", isVip = false,
  } = req.body as {
    name: string; phone: string; email?: string; selectedDate: string; timeSlot?: string;
    testIds?: number[]; packageIds?: number[]; totalAmount: number;
    notes?: string; isVip?: boolean;
  };

  if (!rawName?.trim() || !phone?.trim() || !selectedDate) {
    res.status(400).json({ error: "Name, phone, and selected date are required." });
    return;
  }
  const name = rawName.trim().toUpperCase();
  if (!Array.isArray(testIds) || !Array.isArray(packageIds) || (testIds.length + packageIds.length) === 0) {
    res.status(400).json({ error: "Please select at least one test or package." });
    return;
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid total amount." });
    return;
  }

  const bookingRef = generateBookingRef();
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);
  const returnUrl = `${base}/api/public/booking/phonepe-callback`;

  try {
    const result = await PaymentEngine.initiatePayment("phonepe", {
      bookingRef,
      name,
      phone: phone.trim(),
      email: email.trim(),
      amount,
      returnUrl,
    });

    if (!result.success) {
      res.status(400).json({ error: "Could not initiate PhonePe payment. Please try again.", details: result.errorMessage });
      return;
    }

    await db.insert(onlineBookingsTable).values({
      bookingRef,
      name: name,
      phone: phone.trim(),
      email: email.trim(),
      selectedDate,
      timeSlot: timeSlot.trim(),
      testIds: JSON.stringify(testIds),
      packageIds: JSON.stringify(packageIds),
      totalAmount: String(amount),
      notes: notes.trim(),
      isVip: Boolean(isVip) && Boolean(settings.vipQueueEnabled),
      phonepeTransactionId: bookingRef,
      phonepeProviderRefId: result.gatewayTxnId || "",
      status: "pending_payment",
    });

    res.json({ bookingRef, redirectUrl: result.redirectUrl });
  } catch (err: any) {
    logger.error({ err, bookingRef }, "PhonePe initiate exception");
    res.status(400).json({ error: "Could not connect to PhonePe. Please try again." });
  }
});

// ── GET /api/public/booking/phonepe-callback ──────────────────────────────────
// PhonePe redirects browser here after payment attempt.
publicBookingRouter.get("/phonepe-callback", async (req, res): Promise<void> => {
  const settings = await getSettings();
  const saltKey = process.env.PHONEPE_API_SECRET || "";
  const saltIndex = process.env.PHONEPE_SALT_INDEX || "1";
  const merchantId = process.env.PHONEPE_MERCHANT_ID || settings?.phonepeMerchantId || "";

  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);

  const { merchantTransactionId, code } = req.query as Record<string, string>;
  if (!merchantTransactionId) {
    res.redirect(getBookingConfirmationUrl(base, "", "phonepe", true, "missing_txn_id"));
    return;
  }

  // Check status with PhonePe server-side
  const isStaging = process.env.NODE_ENV !== "production";
  const baseUrl = isStaging ? PHONEPE_STAGING_BASE : PHONEPE_PROD_BASE;
  const endpoint = `/pg/v1/status/${encodeURIComponent(merchantId)}/${encodeURIComponent(merchantTransactionId)}`;
  const statusVerify = phonepeXVerify("" , endpoint, saltKey, saltIndex);

  try {
    const statusRes = await fetch(`${baseUrl}${endpoint}`, {
      method: "GET",
      headers: { Accept: "application/json", "X-VERIFY": statusVerify, "X-MERCHANT-ID": merchantId },
    });
    const statusData = (await statusRes.json()) as {
      success: boolean;
      code: string;
      data?: { state?: string; responseCode?: string; transactionId?: string };
    };

    const state = statusData.data?.state || "";
    if (state === "COMPLETED" || statusData.data?.responseCode === "SUCCESS") {
      const [booking] = await db.select().from(onlineBookingsTable)
        .where(eq(onlineBookingsTable.phonepeTransactionId, merchantTransactionId))
        .limit(1);
      if (booking && booking.status === "pending_payment") {
        await db.update(onlineBookingsTable)
          .set({ status: "paid", phonepeProviderRefId: statusData.data?.transactionId || booking.phonepeProviderRefId })
          .where(eq(onlineBookingsTable.id, booking.id));
      }
      res.redirect(getBookingConfirmationUrl(base, merchantTransactionId, "phonepe"));
      return;
    }
  } catch { /* fall through to failure */ }

  // Mark failed
  const [booking] = await db.select().from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.phonepeTransactionId, merchantTransactionId))
    .limit(1);
  if (booking && booking.status === "pending_payment") {
    await db.update(onlineBookingsTable).set({ status: "payment_failed", failureReason: code || "Payment not completed" }).where(eq(onlineBookingsTable.id, booking.id));
  }
  res.redirect(getBookingConfirmationUrl(base, merchantTransactionId, "phonepe", true, code || "Payment not completed"));
});

// ── BharatPe helpers ─────────────────────────────────────────────────────────────────────────

const BHARATPE_PROD_BASE = "https://api.bharatpe.in/api/v1";
const BHARATPE_STAGING_BASE = "https://uat-api.bharatpe.in/api/v1";

// ── POST /api/public/booking/bharatpe-initiate ───────────────────────────────────────────────────
// Creates a pending booking and returns the BharatPe checkout redirect URL.
publicBookingRouter.post("/bharatpe-initiate", createOrderLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const {
    name: rawName, phone, email = "", selectedDate, timeSlot = "",
    testIds = [], packageIds = [], totalAmount,
    notes = "", isVip = false,
  } = req.body as {
    name: string; phone: string; email?: string; selectedDate: string; timeSlot?: string;
    testIds?: number[]; packageIds?: number[]; totalAmount: number;
    notes?: string; isVip?: boolean;
  };

  if (!rawName?.trim() || !phone?.trim() || !selectedDate) {
    res.status(400).json({ error: "Name, phone, and selected date are required." });
    return;
  }
  const name = rawName.trim().toUpperCase();
  if (!Array.isArray(testIds) || !Array.isArray(packageIds) || (testIds.length + packageIds.length) === 0) {
    res.status(400).json({ error: "Please select at least one test or package." });
    return;
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid total amount." });
    return;
  }

  const bookingRef = generateBookingRef();
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);
  const returnUrl = `${base}/api/public/booking/bharatpe-callback`;

  try {
    const result = await PaymentEngine.initiatePayment("bharatpe", {
      bookingRef,
      name,
      phone: phone.trim(),
      email: email.trim(),
      amount,
      returnUrl,
    });

    if (!result.success) {
      res.status(400).json({ error: "Could not initiate BharatPe payment. Please try again.", details: result.errorMessage });
      return;
    }

    await db.insert(onlineBookingsTable).values({
      bookingRef,
      name: name,
      phone: phone.trim(),
      email: email.trim(),
      selectedDate,
      timeSlot: timeSlot.trim(),
      testIds: JSON.stringify(testIds),
      packageIds: JSON.stringify(packageIds),
      totalAmount: String(amount),
      notes: notes.trim(),
      isVip: Boolean(isVip) && Boolean(settings.vipQueueEnabled),
      bharatpeTransactionId: bookingRef,
      bharatpeProviderRefId: result.gatewayTxnId || null,
      status: "pending_payment",
    });

    res.json({ bookingRef, redirectUrl: result.redirectUrl });
  } catch {
    res.status(400).json({ error: "Could not connect to BharatPe. Please try again." });
    return;
  }
});

// ── GET /api/public/booking/bharatpe-callback ────────────────────────────────────────────────────────────
// BharatPe redirects browser here after payment attempt.
publicBookingRouter.get("/bharatpe-callback", async (req, res): Promise<void> => {
  const settings = await getSettings();
  const apiKey = process.env.BHARATPE_API_KEY || "";
  const apiSecret = process.env.BHARATPE_API_SECRET || "";
  const merchantId = process.env.BHARATPE_MERCHANT_ID || settings?.bharatpeMerchantId || "";

  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);

  const { merchantTransactionId, status, code } = req.query as Record<string, string>;
  if (!merchantTransactionId) {
    res.redirect(getBookingConfirmationUrl(base, "", "bharatpe", true, "missing_txn_id"));
    return;
  }

  // Verify status server-side with BharatPe
  const isStaging = process.env.NODE_ENV !== "production";
  const bpBase = isStaging ? BHARATPE_STAGING_BASE : BHARATPE_PROD_BASE;
  const timestamp = String(Date.now());
  const authPayload = `${merchantId}:${timestamp}`;
  const authHash = crypto.createHmac("sha256", apiSecret).update(authPayload).digest("hex");
  const authToken = `${apiKey}:${authHash}:${timestamp}`;

  try {
    const statusRes = await fetch(`${bpBase}/merchant/transaction/${encodeURIComponent(merchantTransactionId)}/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
        "X-MERCHANT-ID": merchantId,
        Authorization: `Bearer ${authToken}`,
      },
    });
    const statusData = (await statusRes.json()) as {
      success: boolean;
      code: string;
      data?: { status?: string; transactionId?: string };
    };

    if (statusData.data?.status === "SUCCESS" || status === "success") {
      const [booking] = await db.select().from(onlineBookingsTable)
        .where(eq(onlineBookingsTable.bharatpeTransactionId, merchantTransactionId))
        .limit(1);
      if (booking && booking.status === "pending_payment") {
        await db.update(onlineBookingsTable)
          .set({ status: "paid", bharatpeProviderRefId: statusData.data?.transactionId || booking.bharatpeProviderRefId })
          .where(eq(onlineBookingsTable.id, booking.id));
      }
      res.redirect(getBookingConfirmationUrl(base, merchantTransactionId, "bharatpe"));
      return;
    }
  } catch { /* fall through to failure */ }

  const [booking] = await db.select().from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.bharatpeTransactionId, merchantTransactionId))
    .limit(1);
  if (booking && booking.status === "pending_payment") {
    await db.update(onlineBookingsTable).set({ status: "payment_failed", failureReason: code || "Payment not completed" }).where(eq(onlineBookingsTable.id, booking.id));
  }
  res.redirect(getBookingConfirmationUrl(base, merchantTransactionId, "bharatpe", true, code || "Payment not completed"));
});

// ── ICICI Orange PG helpers ─────────────────────────────────────────────────

const ICICI_UAT_BASE = "https://pgpayuat.icicibank.com";
const ICICI_PROD_BASE = "https://pgpay.icicibank.com";

function getIciciBase() {
  return process.env.ICICI_BASE_URL || (process.env.NODE_ENV === "production" ? ICICI_PROD_BASE : ICICI_UAT_BASE);
}

function getIciciPrefix() {
  const prefix = process.env.ICICI_URL_PREFIX !== undefined ? process.env.ICICI_URL_PREFIX : "/tsp";
  if (!prefix) return "";
  const start = prefix.startsWith("/") ? "" : "/";
  const end = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return `${start}${end}`;
}

function generateIciciSecureHash(params: Record<string, string>, secretKey: string): string {
  const keys = Object.keys(params).sort();
  const hashText = keys.map((k) => params[k]).join("");
  return crypto.createHmac("sha256", secretKey).update(hashText).digest("hex");
}

function formatTxnDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ── POST /api/public/booking/icici-initiate ──────────────────────────────────
publicBookingRouter.post("/icici-initiate", createOrderLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const {
    name: rawName, phone, email = "", selectedDate, timeSlot = "",
    testIds = [], packageIds = [], totalAmount,
    notes = "", isVip = false,
  } = req.body as {
    name: string; phone: string; email?: string; selectedDate: string; timeSlot?: string;
    testIds?: number[]; packageIds?: number[]; totalAmount: number;
    notes?: string; isVip?: boolean;
  };

  if (!rawName?.trim() || !phone?.trim() || !selectedDate) {
    res.status(400).json({ error: "Name, phone, and selected date are required." });
    return;
  }
  const name = rawName.trim().toUpperCase();
  if (!Array.isArray(testIds) || !Array.isArray(packageIds) || (testIds.length + packageIds.length) === 0) {
    res.status(400).json({ error: "Please select at least one test or package." });
    return;
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid total amount." });
    return;
  }

  const bookingRef = generateBookingRef();
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);
  const returnUrl = `${base}/api/public/booking/icici-callback`;

  try {
    const result = await PaymentEngine.initiatePayment("icici", {
      bookingRef,
      name,
      phone: phone.trim(),
      email: email.trim(),
      amount,
      returnUrl,
    });

    if (!result.success) {
      res.status(400).json({ error: "Could not initiate ICICI payment. Please try again.", details: result.errorMessage });
      return;
    }

    await db.insert(onlineBookingsTable).values({
      bookingRef,
      name: name,
      phone: phone.trim(),
      email: email.trim(),
      selectedDate,
      timeSlot: timeSlot.trim(),
      testIds: JSON.stringify(testIds),
      packageIds: JSON.stringify(packageIds),
      totalAmount: String(amount),
      notes: notes.trim(),
      isVip: Boolean(isVip) && Boolean(settings.vipQueueEnabled),
      iciciTransactionId: bookingRef,
      iciciProviderRefId: result.rawResponse.tranCtx,
      status: "pending_payment",
    });

    res.json({ bookingRef, redirectUrl: result.redirectUrl, tranCtx: result.rawResponse.tranCtx });
  } catch (err: any) {
    logger.error({ err, bookingRef }, "ICICI initiateSale exception");
    res.status(400).json({ error: "Could not connect to ICICI payment gateway. Please try again." });
  }
});

// ── ICICI callback handler (shared for GET and POST) ─────────────────────────

function getBookingConfirmationUrl(base: string, ref: string, gateway: string, failed?: boolean, reason?: string): string {
  const path = `${base}/book`;
  if (failed) {
    return `${path}?failed=1&reason=${encodeURIComponent(reason || "Payment not completed")}`;
  }
  return `${path}?confirmed=1&ref=${encodeURIComponent(ref)}&gateway=${encodeURIComponent(gateway)}`;
}

async function handleIciciCallback(req: any, res: any, queryOrBody: Record<string, string>): Promise<void> {
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);

  logger.info({ keys: Object.keys(queryOrBody), queryOrBody }, "ICICI callback received");

  const { merchantTxnNo, responseCode, respDescription, txnID, status } = queryOrBody;
  
  if (merchantTxnNo) {
    lastIciciTransaction = {
      txnRef: merchantTxnNo,
      responseCode: responseCode || status || "unknown",
      respDescription: respDescription || "callback",
      timestamp: new Date().toISOString(),
    };
  }

  if (!merchantTxnNo) {
    res.redirect(getBookingConfirmationUrl(base, "", "icici", true, "missing_txn_id"));
    return;
  }

  const [booking] = await db.select().from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.iciciTransactionId, merchantTxnNo))
    .limit(1);

  if (!booking) {
    res.redirect(getBookingConfirmationUrl(base, "", "icici", true, "booking_not_found"));
    return;
  }

  // If already paid, skip verification
  if (booking.status === "paid" || booking.status === "confirmed") {
    res.redirect(getBookingConfirmationUrl(base, booking.bookingRef, "icici"));
    return;
  }

  const settings = await getSettings();
  const merchantId = process.env.ICICI_MERCHANT_ID || settings?.iciciMerchantId || "";
  const aggregatorId = process.env.ICICI_AGGREGATOR_ID || settings?.iciciAggregatorId || "";
  const secretKey = process.env.ICICI_SECRET_KEY || settings?.iciciSecretKey || "";

  // Server-side status verification
  if (secretKey && merchantId) {
    try {
      const statusHashParams: Record<string, string> = {
        aggregatorID: aggregatorId,
        merchantId,
        merchantTxnNo,
        originalTxnNo: merchantTxnNo,
        transactionType: "STATUS",
      };
       const statusHash = generateIciciSecureHash(statusHashParams, secretKey);
      const statusRes = await fetch(`${getIciciBase()}${getIciciPrefix()}/pg/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          merchantId,
          aggregatorID: aggregatorId,
          merchantTxnNo,
          originalTxnNo: merchantTxnNo,
          transactionType: "STATUS",
          secureHash: statusHash,
        }),
      });
      const statusData = (await statusRes.json()) as {
        txnStatus?: string;
        txnResponseCode?: string;
        responseCode?: string;
        respDescription?: string;
      };
      if (statusData.txnStatus === "SUC" || statusData.txnResponseCode === "0000" || statusData.responseCode === "000") {
        await db.update(onlineBookingsTable)
          .set({ status: "paid", iciciProviderRefId: txnID || booking.iciciProviderRefId })
          .where(eq(onlineBookingsTable.id, booking.id));
        res.redirect(getBookingConfirmationUrl(base, booking.bookingRef, "icici"));
        return;
      }
    } catch { /* fall through to failure */ }
  }

  // Also mark as paid if callback query/body indicates success (defensive)
  const successCodes = ["0000", "000", "success", "SUCCESS", "SUC", "TXN_SUCCESS"];
  const isSuccessByCode = successCodes.includes(responseCode) || successCodes.includes(status);
  if (isSuccessByCode) {
    logger.info({ merchantTxnNo, responseCode, status }, "ICICI callback marking as paid (success code)");
    await db.update(onlineBookingsTable)
      .set({ status: "paid", iciciProviderRefId: txnID || booking.iciciProviderRefId })
      .where(eq(onlineBookingsTable.id, booking.id));
    res.redirect(getBookingConfirmationUrl(base, booking.bookingRef, "icici"));
    return;
  }

  if (booking.status === "pending_payment") {
    logger.info({ merchantTxnNo, responseCode, status, respDescription }, "ICICI callback marking as payment_failed");
    await db.update(onlineBookingsTable)
      .set({ status: "payment_failed", failureReason: respDescription || "Payment not completed" })
      .where(eq(onlineBookingsTable.id, booking.id));
  }
  res.redirect(getBookingConfirmationUrl(base, booking.bookingRef, "icici", true, respDescription || "Payment not completed"));
}

publicBookingRouter.get("/icici-callback", async (req, res): Promise<void> => {
  const merged = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
  await handleIciciCallback(req, res, merged);
});

publicBookingRouter.post("/icici-callback", async (req, res): Promise<void> => {
  const merged = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
  await handleIciciCallback(req, res, merged);
});

// ── POST /api/public/booking/create-order (Razorpay ─ kept for backwards compat) ──
publicBookingRouter.post("/create-order", createOrderLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const keyId = process.env.RAZORPAY_KEY_ID || settings.razorpayKeyId;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!keyId || !keySecret) {
    res.status(503).json({ error: "Payment gateway not configured. Please contact the clinic." });
    return;
  }

  const {
    name: rawName, phone, email = "", selectedDate, timeSlot = "",
    testIds = [], packageIds = [], totalAmount,
    notes = "", isVip = false,
  } = req.body as {
    name: string; phone: string; email?: string; selectedDate: string; timeSlot?: string;
    testIds?: number[]; packageIds?: number[]; totalAmount: number;
    notes?: string; isVip?: boolean;
  };

  if (!rawName?.trim() || !phone?.trim() || !selectedDate) {
    res.status(400).json({ error: "Name, phone, and selected date are required." });
    return;
  }
  const name = rawName.trim().toUpperCase();
  if (!Array.isArray(testIds) || !Array.isArray(packageIds) || (testIds.length + packageIds.length) === 0) {
    res.status(400).json({ error: "Please select at least one test or package." });
    return;
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid total amount." });
    return;
  }

  const bookingRef = generateBookingRef();
  const amountPaise = Math.round(amount * 100);

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  let razorpayOrderId = "";
  try {
    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: amountPaise, currency: "INR", receipt: bookingRef,
        notes: { patient_name: name, patient_phone: phone, booking_ref: bookingRef },
      }),
    });
    if (!rpRes.ok) {
      const err = await rpRes.json().catch(() => ({}));
      res.status(400).json({ error: "Payment gateway error. Please try again.", details: (err as { error?: { description?: string } }).error?.description });
      return;
    }
    const rpData = (await rpRes.json()) as { id: string };
    razorpayOrderId = rpData.id;
  } catch {
    res.status(400).json({ error: "Could not connect to payment gateway. Please try again." });
    return;
  }

  await db.insert(onlineBookingsTable).values({
    bookingRef, name: name, phone: phone.trim(), email: email.trim(),
    selectedDate, timeSlot: timeSlot.trim(), testIds: JSON.stringify(testIds), packageIds: JSON.stringify(packageIds),
    totalAmount: String(amount), notes: notes.trim(),
    isVip: Boolean(isVip) && Boolean(settings.vipQueueEnabled),
    razorpayOrderId, status: "pending_payment",
  });

  res.json({ bookingRef, razorpayOrderId, amountPaise, keyId });
});

// ── POST /api/public/booking/verify-payment (Razorpay) ───────────────────────
publicBookingRouter.post("/verify-payment", bookingLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!keySecret) {
    res.status(503).json({ error: "Payment gateway not configured." });
    return;
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
    razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string;
  };

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    res.status(400).json({ error: "Missing payment details." });
    return;
  }

  const expected = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expected !== razorpaySignature) {
    res.status(400).json({ error: "Payment verification failed. Please contact the clinic." });
    return;
  }

  const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.razorpayOrderId, razorpayOrderId)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found." }); return; }
  if (booking.status === "paid" || booking.status === "confirmed") {
    res.json({ success: true, bookingRef: booking.bookingRef, alreadyPaid: true });
    return;
  }

  await db.update(onlineBookingsTable).set({ razorpayPaymentId, razorpaySignature, status: "paid" }).where(eq(onlineBookingsTable.id, booking.id));
  res.json({ success: true, bookingRef: booking.bookingRef });
});

// ── OTP endpoints (mobile login) ─────────────────────────────────────────────
publicBookingRouter.post("/send-otp", bookingLimiter, async (req, res): Promise<void> => {
  const { phone, name } = req.body || {};
  if (!phone || typeof phone !== "string" || !/^\d{10}$/.test(phone)) {
    res.status(400).json({ error: "Valid 10-digit phone number required" });
    return;
  }
  const code = generateOtp();
  otpStore.set(phone, { code, name: name || "", expiresAt: Date.now() + 5 * 60 * 1000 });
  res.json({ sent: true, phone, code });
});

publicBookingRouter.post("/verify-otp", bookingLimiter, async (req, res): Promise<void> => {
  const { phone, code, name } = req.body || {};
  if (!phone || !code) { res.status(400).json({ error: "Phone and OTP required" }); return; }
  const record = otpStore.get(phone);
  if (!record || record.expiresAt < Date.now()) {
    res.status(400).json({ error: "OTP expired or not found" });
    return;
  }
  if (record.code !== String(code)) {
    res.status(400).json({ error: "Invalid OTP" });
    return;
  }
  otpStore.delete(phone);
  res.json({ verified: true, phone, name: name || record.name });
});

// ── POST /api/public/booking/qr-initiate ─────────────────────────────────────
// Creates a pending booking for QR/UPI payment. The user scans the QR and pays,
// then a staff member confirms the booking from the ERP. This allows working
// online bookings even before payment-gateway credentials are approved.
publicBookingRouter.post("/qr-initiate", createOrderLimiter, async (req, res): Promise<void> => {
  const settings = await getSettings();
  if (!settings?.onlineBookingEnabled) {
    res.status(403).json({ error: "Online booking is not enabled." });
    return;
  }

  const {
    name: rawName, phone, email = "", selectedDate, timeSlot = "",
    testIds = [], packageIds = [], totalAmount, notes = "", isVip = false,
  } = req.body || {};
  const amount = Number(totalAmount);

  if (!rawName || !phone || !selectedDate || !amount || amount <= 0) {
    res.status(400).json({ error: "Please fill all required fields and select at least one test." });
    return;
  }
  const name = String(rawName).trim().toUpperCase();

  const bookingRef = generateBookingRef();

  await db.insert(onlineBookingsTable).values({
    bookingRef,
    name: name,
    phone: phone.trim(),
    email: email.trim(),
    selectedDate,
    timeSlot: timeSlot.trim(),
    testIds: JSON.stringify(testIds),
    packageIds: JSON.stringify(packageIds),
    totalAmount: String(amount),
    notes: notes.trim(),
    isVip: Boolean(isVip) && Boolean(settings.vipQueueEnabled),
    status: "pending_payment",
  });

  // Build a dynamic UPI intent URL for the exact amount
  const vpa = settings.upiVpa || settings.kioskUpiVpa || "";
  const upiName = settings.kioskUpiName || settings.name || "Care Diagnostics";
  const upiUrl = vpa
    ? `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(upiName)}&am=${encodeURIComponent(String(amount.toFixed(2)))}&cu=INR&tn=${encodeURIComponent("Care Diagnostics booking " + bookingRef)}`
    : "";

  res.json({
    bookingRef,
    amount,
    upiVpa: vpa,
    upiName,
    upiUrl,
    upiQrImageUrl: settings.upiQrImageUrl || "",
    clinicName: settings.name || "Care Diagnostics",
  });
});

// ── POST /api/public/booking/qr-confirm ─────────────────────────────────────
// Simulated confirmation for QR bookings (used during demo/demo approvals).
// In production, staff uses the ERP /api/online-bookings/:id/confirm endpoint.
publicBookingRouter.post("/qr-confirm", bookingLimiter, async (req, res): Promise<void> => {
  const { bookingRef } = req.body || {};
  if (!bookingRef) { res.status(400).json({ error: "Booking reference required" }); return; }

  const [booking] = await db.select().from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.bookingRef, bookingRef)).limit(1);

  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (booking.status === "paid" || booking.status === "confirmed") {
    res.json({ success: true, alreadyPaid: true, bookingRef, status: booking.status });
    return;
  }

  await db.update(onlineBookingsTable)
    .set({ status: "paid" })
    .where(eq(onlineBookingsTable.id, booking.id));

  res.json({ success: true, bookingRef, status: "paid" });
});

// ── ICICI Diagnostics routes ──────────────────────────────────────────────────
import { requireStaffAuth } from "../middleware/requireStaffAuth";

publicBookingRouter.get("/icici-diagnostics", requireStaffAuth, async (req, res): Promise<void> => {
  const settings = await getSettings();
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);
  const returnUrl = `${base}/api/public/booking/icici-callback`;
  const iciciBase = getIciciBase();
  const initiateSaleUrl = `${iciciBase}${getIciciPrefix()}/pg/api/v2/initiateSale`;
  
  const merchantId = process.env.ICICI_MERCHANT_ID || settings?.iciciMerchantId || "";
  const aggregatorId = process.env.ICICI_AGGREGATOR_ID || settings?.iciciAggregatorId || "";

  res.json({
    publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.BASE_URL || null,
    resolvedPublicBaseUrl: base,
    iciciMode: process.env.NODE_ENV === "production" ? "production" : "uat/test",
    initiateSaleUrl,
    returnUrl,
    callbackUrl: returnUrl,
    merchantId,
    aggregatorId,
    lastTransaction: lastIciciTransaction,
  });
});

publicBookingRouter.post("/icici-diagnostics/run", requireStaffAuth, async (req, res): Promise<void> => {
  const base = getPublicBase(req as Parameters<typeof getPublicBase>[0]);
  const returnUrl = `${base}/api/public/booking/icici-callback`;
  
  let reachabilityStatus = "unknown";
  let reachabilityError = null;
  
  try {
    const checkRes = await fetch(returnUrl, {
      method: "GET",
      headers: { "User-Agent": "ERP-Diagnostic-Check" }
    });
    reachabilityStatus = `reachable (status: ${checkRes.status})`;
  } catch (err: any) {
    reachabilityStatus = "unreachable";
    reachabilityError = err.message || String(err);
  }

  res.json({
    success: reachabilityStatus.startsWith("reachable"),
    reachabilityStatus,
    reachabilityError,
    timestamp: new Date().toISOString(),
  });
});

