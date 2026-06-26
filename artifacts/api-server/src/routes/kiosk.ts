import { Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { db, pool } from "@workspace/db";
import {
  clinicSettingsTable, testsTable, patientsTable, ordersTable,
  orderTestsTable, billsTable, paymentsTable, ledgersTable,
} from "@workspace/db/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { generateTokenForBill } from "./tokens";
import { generateTestTokensForOrder } from "./test-tokens";
import { z } from "zod";
import { logger } from "../lib/logger";
import { PaymentEngine } from "../lib/payments/PaymentEngine";
import { calculateDobFromAge } from "./public-booking";
import { SelfRegistrationSchema } from "@workspace/api-zod";
import { registerPatientSelfFlow } from "../services/self-registration";

export const kioskRouter = Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests. Please try again later." },
});

// ── ICICI Helpers ─────────────────────────────────────────────────────────────

const ICICI_UAT_BASE = "https://pgpayuat.icicibank.com";
const ICICI_PROD_BASE = "https://pgpay.icicibank.com";

function getIciciBase() {
  return process.env.ICICI_BASE_URL || (process.env.NODE_ENV === "production" ? ICICI_PROD_BASE : ICICI_UAT_BASE);
}

function getIciciPrefix() {
  const base = getIciciBase();
  const defaultPrefix = base.includes("pgpayuat") ? "/tsp" : "";
  const prefix = process.env.ICICI_URL_PREFIX !== undefined ? process.env.ICICI_URL_PREFIX : defaultPrefix;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getKioskSettings() {
  const [s] = await db.select().from(clinicSettingsTable).limit(1);
  return s ?? null;
}

function razorpayAuth(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function generateKioskPatientId(): Promise<string> {
  // max(patient_id) is WRONG because string comparison is lexicographic:
  // 'P-00009' > 'P-00010' in Postgres, so the max string is not the latest number.
  const [row] = await db
    .select({ max: sql<number | null>`MAX(REGEXP_REPLACE(patient_id, '[^0-9]', '', 'g')::int)` })
    .from(patientsTable);
  const next = (row?.max ?? 0) + 1;
  return `P-${String(next).padStart(5, "0")}`;
}

async function generateKioskBillNumber(): Promise<string> {
  const date = new Date();
  const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  const [row] = await db
    .select({ maxBill: sql<string | null>`MAX(bill_number)` })
    .from(billsTable)
    .where(sql`bill_number ~ '^[0-9]+$'`);
  let seq = 1;
  if (row?.maxBill) {
    const legacy = row.maxBill.match(/^BILL-(\d{6})-(\d+)$/);
    const numeric = row.maxBill.match(/^(\d{6})(\d{4,})$/);
    if (legacy) seq = Number(legacy[2]) + 1;
    else if (numeric) seq = Number(numeric[2]) + 1;
  }
  return `${yyyymm}${String(seq).padStart(4, "0")}`;
}

/** Shared patient + order + bill + token creation logic */
async function createPatientBillAndTokens(params: {
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  testIds: number[];
  paymentMethod: string;
  paymentReference: string;
  paymentAmount: number;
  ageValue?: number;
  ageUnit?: string;
}) {
  const { firstName, lastName, phone, gender, dateOfBirth, testIds, paymentMethod, paymentReference, paymentAmount, ageValue, ageUnit } = params;

  const tests = await db
    .select({ id: testsTable.id, name: testsTable.name, price: testsTable.price })
    .from(testsTable)
    .where(and(eq(testsTable.isActive, true), inArray(testsTable.id, testIds)));

  const subtotal = tests.reduce((s, t) => s + Number(t.price), 0);

  const [firstLedger] = await db
    .select({ id: ledgersTable.id })
    .from(ledgersTable)
    .orderBy(ledgersTable.id)
    .limit(1);
  const ledgerId = firstLedger?.id ?? 1;

  // Find or create patient by phone
  const [existing] = await db.select().from(patientsTable).where(eq(patientsTable.phone, phone)).limit(1);
  let patientDbId: number;
  let patientCode: string;
  let isNewPatient: boolean;

  if (existing) {
    patientDbId = existing.id;
    patientCode = existing.patientId;
    isNewPatient = false;
  } else {
    const patientId = await generateKioskPatientId();
    const [newPat] = await db.insert(patientsTable).values({
      patientId,
      firstName,
      lastName,
      phone,
      gender,
      dateOfBirth: dateOfBirth || "",
      ageValue: ageValue ?? null,
      ageUnit: ageUnit ?? null,
    }).returning();
    patientDbId = newPat.id;
    patientCode = newPat.patientId;
    isNewPatient = true;
  }

  // Create order
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const orderNumber = `KIOSK-${stamp}-${rand}`;

  const [orderRow] = await db.insert(ordersTable).values({
    orderNumber,
    patientId: patientDbId,
    status: "pending",
    totalAmount: subtotal.toFixed(2),
    ledgerId,
    notes: `Kiosk self-registration | ${paymentMethod.toUpperCase()} ref: ${paymentReference}`,
  }).returning();

  for (const t of tests) {
    await db.insert(orderTestsTable).values({
      orderId: orderRow.id,
      testId: t.id,
      price: Number(t.price).toFixed(2),
    });
  }

  const billNumber = await generateKioskBillNumber();
  const [billRow] = await db.insert(billsTable).values({
    billNumber,
    orderId: orderRow.id,
    patientId: patientDbId,
    subtotal: subtotal.toFixed(2),
    discount: "0.00",
    taxAmount: "0.00",
    totalAmount: subtotal.toFixed(2),
    paidAmount: paymentAmount.toFixed(2),
    balanceAmount: Math.max(0, subtotal - paymentAmount).toFixed(2),
    status: paymentAmount >= subtotal ? "paid" : "partial",
    ledgerId,
    createdByName: "Kiosk Self-Registration",
  }).returning();

  await db.insert(paymentsTable).values({
    billId: billRow.id,
    amount: paymentAmount.toFixed(2),
    method: paymentMethod,
    referenceNumber: paymentReference,
    recordedByName: "Kiosk",
    notes: `Kiosk self-registration ${paymentMethod} payment`,
  });

  await db.update(patientsTable).set({ ledgerId }).where(
    and(eq(patientsTable.id, patientDbId), sql`${patientsTable.ledgerId} IS NULL`),
  );

  let tokenInfo: { tokenNo: number; tokenDate: string } | null = null;
  try {
    tokenInfo = await generateTokenForBill({ ledgerId, billId: billRow.id, patientId: patientDbId, source: "kiosk" });
  } catch { /* non-blocking */ }

  let testTokens: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; tokenNo: number }> = [];
  try {
    testTokens = await generateTestTokensForOrder({ ledgerId, billId: billRow.id, orderId: orderRow.id, patientId: patientDbId, source: "kiosk" });
  } catch { /* non-blocking */ }

  return {
    success: true,
    billNumber: billRow.billNumber,
    billId: billRow.id,
    totalAmount: subtotal,
    patientCode,
    patientName: `${firstName} ${lastName}`.trim(),
    isNewPatient,
    tokenNo: tokenInfo?.tokenNo ?? null,
    tokenDate: tokenInfo?.tokenDate ?? null,
    testTokens,
  };
}

function getKioskBase(req: { headers: Record<string, string | string[] | undefined> }): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0]}`;
  const host = String(req.headers["host"] || "localhost");
  return `${host.startsWith("localhost") || host.startsWith("127.0.0") || host.startsWith("192.168.") ? "http" : "https"}://${host}`;
}

// ── GET /api/kiosk/config ─────────────────────────────────────────────────────
kioskRouter.get("/config", async (_req, res): Promise<void> => {
  const s = await getKioskSettings();
  if (!s) {
    res.json({ enabled: false, clinicName: "Care Diagnostics", tagline: "", logoDataUrl: null, upiVpa: "", upiName: "", welcomeMessage: "", razorpayEnabled: false, vipQueueEnabled: false });
    return;
  }
  const settings = s as Record<string, unknown>;
  const keyId = process.env.RAZORPAY_KEY_ID || (s.razorpayKeyId ?? "");
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const payuKey = s.payuMerchantKey ?? "";
  const payuSalt = process.env.PAYU_MERCHANT_SALT ?? "";
  const iciciMerchantId = process.env.ICICI_MERCHANT_ID || (s.iciciMerchantId ?? "");
  const iciciSecretKey = process.env.ICICI_SECRET_KEY || (s.iciciSecretKey ?? "");
  const activeGateway = s.activePaymentGateway || "icici";
  const cardEnabled = activeGateway === "icici"
    ? Boolean(s.iciciEnabled && iciciMerchantId && iciciSecretKey)
    : (activeGateway === "hdfc" ? true : false);

  res.json({
    enabled: (settings["kioskEnabled"] as boolean | null) ?? false,
    paymentGateway: (settings["kioskPaymentGateway"] as string | null) ?? "upi",
    upiVpa: (settings["kioskUpiVpa"] as string | null) ?? "",
    upiName: (settings["kioskUpiName"] as string | null) ?? "",
    welcomeMessage: (settings["kioskWelcomeMessage"] as string | null) ?? "",
    clinicName: s.name,
    tagline: s.tagline,
    logoDataUrl: s.logoDataUrl ?? null,
    address: s.address ?? "",
    phone: s.phone ?? "",
    razorpayEnabled: Boolean(keyId && keySecret),
    payuEnabled: Boolean(s.payuEnabled && payuKey && payuSalt),
    iciciEnabled: cardEnabled,
    activeGateway,
    vipQueueEnabled: s.vipQueueEnabled ?? false,
  });
});

// ── GET /api/kiosk/tests ──────────────────────────────────────────────────────
kioskRouter.get("/tests", async (_req, res): Promise<void> => {
  const s = await getKioskSettings();
  const settings = (s ?? {}) as Record<string, unknown>;
  const allowedRaw = (settings["kioskAllowedTestIds"] as string | null) ?? "[]";
  let allowedIds: number[] = [];
  try { allowedIds = JSON.parse(allowedRaw); } catch { allowedIds = []; }

  const rows = await db
    .select({
      id: testsTable.id,
      code: testsTable.code,
      name: testsTable.name,
      category: testsTable.category,
      price: testsTable.price,
      department: testsTable.department,
      duration: testsTable.duration,
    })
    .from(testsTable)
    .where(eq(testsTable.isActive, true))
    .orderBy(testsTable.category, testsTable.name);

  const tests = allowedIds.length > 0 ? rows.filter(t => allowedIds.includes(t.id)) : rows;
  res.json({ tests: tests.map(t => ({ ...t, price: Number(t.price) })) });
});

// ── POST /api/kiosk/create-payment ───────────────────────────────────────────
// Creates a Razorpay payment link; stores a pending session in kiosk_payment_sessions.
// Rate-limited; public.
const CreatePaymentBody = z.object({
  testIds: z.array(z.number().int().positive()).min(1).max(30),
  patientName: z.string().min(1).max(150),
  phone: z.string().min(7).max(15),
});

kioskRouter.post("/create-payment", paymentLimiter, async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const { testIds, patientName, phone } = parsed.data;

  const s = await getKioskSettings();
  const keyId = process.env.RAZORPAY_KEY_ID || (s?.razorpayKeyId ?? "");
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";

  if (!keyId || !keySecret) {
    res.status(503).json({ error: "Payment gateway not configured. Please ask staff for assistance.", fallbackMode: true });
    return;
  }

  // Calculate authoritative amount from DB
  const tests = await db
    .select({ id: testsTable.id, price: testsTable.price })
    .from(testsTable)
    .where(and(eq(testsTable.isActive, true), inArray(testsTable.id, testIds)));

  if (tests.length !== testIds.length) {
    res.status(400).json({ error: "One or more selected tests are no longer available. Please go back and reselect." });
    return;
  }

  const subtotal = tests.reduce((acc, t) => acc + Number(t.price), 0);
  const amountPaise = Math.round(subtotal * 100);

  if (amountPaise <= 0) {
    res.status(400).json({ error: "Amount must be greater than zero." });
    return;
  }

  const sessionRef = `KIOSK${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  // Create Razorpay payment link
  let paymentLinkId = "";
  let paymentLinkUrl = "";
  try {
    const rpRes = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: razorpayAuth(keyId, keySecret),
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        description: `Kiosk Registration — ${patientName}`,
        reference_id: sessionRef,
        customer: { name: patientName, contact: phone },
        notes: { session_ref: sessionRef, kiosk: "true" },
        reminder_enable: false,
        expire_by: Math.floor(Date.now() / 1000) + 1800,
      }),
    });
    if (!rpRes.ok) {
      const err = await rpRes.json().catch(() => ({})) as { error?: { description?: string } };
      res.status(502).json({ error: `Payment gateway error: ${err.error?.description ?? "unknown"}` });
      return;
    }
    const rpData = await rpRes.json() as { id: string; short_url: string };
    paymentLinkId = rpData.id;
    paymentLinkUrl = rpData.short_url;
  } catch {
    res.status(502).json({ error: "Could not reach payment gateway. Please try again or ask staff." });
    return;
  }

  // Persist session
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO kiosk_payment_sessions (payment_link_id, session_ref, test_ids, amount_paise, patient_name, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW() + INTERVAL '30 minutes')`,
      [paymentLinkId, sessionRef, JSON.stringify(testIds), amountPaise, patientName],
    );
  } finally {
    client.release();
  }

  res.json({ paymentLinkId, paymentLinkUrl, amountPaise, subtotal });
});

// ── GET /api/kiosk/payment-status/:paymentLinkId ──────────────────────────────
// Polls Razorpay for the status of a payment link. Called every ~4 s from kiosk UI.
kioskRouter.get("/payment-status/:paymentLinkId", async (req, res): Promise<void> => {
  const { paymentLinkId } = req.params;
  if (!paymentLinkId || paymentLinkId.length > 60) {
    res.status(400).json({ error: "Invalid payment link ID" });
    return;
  }

  const s = await getKioskSettings();
  const keyId = process.env.RAZORPAY_KEY_ID || (s?.razorpayKeyId ?? "");
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";

  if (!keyId || !keySecret) {
    res.status(503).json({ error: "Payment gateway not configured." });
    return;
  }

  try {
    const rpRes = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}`, {
      headers: { Authorization: razorpayAuth(keyId, keySecret) },
    });
    if (!rpRes.ok) {
      res.status(502).json({ error: "Payment gateway error while checking status." });
      return;
    }
    const rpData = await rpRes.json() as {
      status: string;
      amount_paid: number;
      amount: number;
      payments?: Array<{ payment_id: string; status: string }>;
    };

    const paid = rpData.status === "paid";
    const razorpayPaymentId = paid
      ? (rpData.payments?.find(p => p.status === "captured")?.payment_id ?? rpData.payments?.[0]?.payment_id ?? "")
      : "";

    res.json({ status: rpData.status, paid, razorpayPaymentId, amountPaid: rpData.amount_paid });
  } catch {
    res.status(502).json({ error: "Could not reach payment gateway." });
  }
});

// ── POST /api/kiosk/register ──────────────────────────────────────────────────
// Two modes:
//   - razorpay: paymentLinkId provided → verify payment via Razorpay → create records
//   - upi (fallback): testIds + utrReference + clientTotal → create records with UTR note

const RegisterBody = SelfRegistrationSchema.extend({
  // Razorpay mode (mutually exclusive with testIds/utrReference)
  paymentLinkId: z.string().max(80).optional(),
  razorpayPaymentId: z.string().max(80).optional(),
  // Fallback UPI mode
  testIds: z.array(z.number().int().positive()).min(1).max(30).optional(),
  utrReference: z.string().max(100).optional(),
  clientTotal: z.number().optional(),
});

kioskRouter.post("/register", registerLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    const firstMsg = parsed.error.issues[0]?.message || "Invalid input";
    res.status(400).json({ error: firstMsg, details: parsed.error.issues });
    return;
  }

  const { firstName, lastName, phone, gender, ageValue, ageUnit, paymentLinkId, razorpayPaymentId, testIds, utrReference, clientTotal, isVip } = parsed.data;

  if (paymentLinkId) {
    // ── GATEWAY-AWARE MODE (Razorpay or ICICI) ──────────────────────────────────
    const client = await pool.connect();
    let sessionTestIds: number[] = [];
    let sessionAmountPaise = 0;
    let sessionGateway: string = "razorpay";
    let sessionStatus: string = "";
    let sessionRazorpayId: string | null = null;
    let sessionIciciRef: string | null = null;
    let sessionPatientName = "";
    try {
      const r = await client.query<{
        test_ids: string; amount_paise: number; status: string;
        gateway: string; razorpay_payment_id: string | null; icici_provider_ref_id: string | null;
        patient_name: string;
      }>(
        `SELECT test_ids, amount_paise, status, gateway, razorpay_payment_id, icici_provider_ref_id, patient_name
         FROM kiosk_payment_sessions WHERE payment_link_id = $1`,
        [paymentLinkId],
      );
      if (r.rowCount === 0) {
        res.status(404).json({ error: "Session not found. Please restart registration." });
        return;
      }
      const session = r.rows[0]!;
      sessionStatus = session.status;
      sessionGateway = session.gateway || "razorpay";
      sessionTestIds = JSON.parse(session.test_ids) as number[];
      sessionAmountPaise = session.amount_paise;
      sessionRazorpayId = session.razorpay_payment_id;
      sessionIciciRef = session.icici_provider_ref_id;
      sessionPatientName = session.patient_name || "";
    } finally {
      client.release();
    }

    if (sessionStatus === "completed") {
      res.status(409).json({ error: "This payment has already been registered. Please see staff." });
      return;
    }

    if (sessionGateway !== "razorpay") {
      // ── Server-side Verification Gateways (ICICI, HDFC, PhonePe, etc.) ──
      const provider = await PaymentEngine.getProvider(sessionGateway);
      let verified = false;
      let providerRef = "";
      try {
        const verification = await PaymentEngine.verifyPayment(
          sessionGateway,
          {
            bookingRef: paymentLinkId,
            payload: {},
          },
          sessionPatientName,
          sessionAmountPaise / 100
        );
        verified = verification.success && verification.status === "paid";
        providerRef = verification.providerRefId || "";
      } catch (err) {
        logger.error({ err, paymentLinkId }, `Kiosk ${provider.displayName} registration status verification exception`);
      }
      if (!verified) {
        res.status(402).json({ error: "Payment verification failed. Please complete the payment and try again." });
        return;
      }
      {
        const c2 = await pool.connect();
        try {
          await c2.query(
            `UPDATE kiosk_payment_sessions SET status = 'completed', icici_provider_ref_id = $2 WHERE payment_link_id = $1`,
            [paymentLinkId, providerRef],
          );
        } finally { c2.release(); }
      }
      const result = await registerPatientSelfFlow({
        firstName,
        lastName,
        phone,
        gender,
        ageValue,
        ageUnit,
        testIds: sessionTestIds,
        paymentMethod: sessionGateway,
        paymentReference: paymentLinkId,
        paymentAmount: sessionAmountPaise / 100,
        source: "kiosk",
        isVip,
      });
      res.status(201).json(result);
      return;
    }

    // ── RAZORPAY MODE ──
    const s = await getKioskSettings();
    const keyId = process.env.RAZORPAY_KEY_ID || (s?.razorpayKeyId ?? "");
    const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
    if (!keyId || !keySecret) {
      res.status(503).json({ error: "Payment gateway not configured." });
      return;
    }
    let amountPaisePaid = 0;
    try {
      const rpRes = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}`, {
        headers: { Authorization: razorpayAuth(keyId, keySecret) },
      });
      if (!rpRes.ok) {
        res.status(502).json({ error: "Payment verification failed. Please ask staff for assistance." });
        return;
      }
      const rpData = await rpRes.json() as { status: string; amount_paid: number; amount: number };
      if (rpData.status !== "paid" || rpData.amount_paid < rpData.amount) {
        res.status(402).json({ error: "Payment has not been confirmed yet. Please complete the payment and wait for confirmation." });
        return;
      }
      amountPaisePaid = rpData.amount_paid;
    } catch {
      res.status(502).json({ error: "Could not verify payment. Please ask staff for assistance." });
      return;
    }
    if (amountPaisePaid < sessionAmountPaise) {
      res.status(402).json({ error: "Payment amount does not match. Please ask staff for assistance." });
      return;
    }
    {
      const c2 = await pool.connect();
      try {
        await c2.query(
          `UPDATE kiosk_payment_sessions SET status = 'completed', razorpay_payment_id = $2 WHERE payment_link_id = $1`,
          [paymentLinkId, razorpayPaymentId ?? ""],
        );
      } finally { c2.release(); }
    }
    const result = await registerPatientSelfFlow({
      firstName,
      lastName,
      phone,
      gender,
      ageValue,
      ageUnit,
      testIds: sessionTestIds,
      paymentMethod: "razorpay",
      paymentReference: razorpayPaymentId ?? paymentLinkId,
      paymentAmount: amountPaisePaid / 100,
      source: "kiosk",
      isVip,
    });
    res.status(201).json(result);
    return;
  }

  // ── UPI FALLBACK MODE ─────────────────────────────────────────────────────
  if (!testIds || !utrReference || !clientTotal) {
    res.status(400).json({ error: "Either paymentLinkId (Razorpay) or testIds + utrReference + clientTotal (UPI fallback) are required." });
    return;
  }

  // Verify tests exist and total matches
  const tests = await db
    .select({ id: testsTable.id, price: testsTable.price })
    .from(testsTable)
    .where(and(eq(testsTable.isActive, true), inArray(testsTable.id, testIds)));

  if (tests.length !== testIds.length) {
    res.status(400).json({ error: "One or more selected tests are no longer available." });
    return;
  }

  const subtotal = tests.reduce((s, t) => s + Number(t.price), 0);
  if (Math.abs(subtotal - clientTotal) > 1) {
    res.status(400).json({ error: "Total mismatch — please restart and try again." });
    return;
  }

  const result = await registerPatientSelfFlow({
    firstName,
    lastName,
    phone,
    gender,
    ageValue,
    ageUnit,
    isVip,
    testIds,
    paymentMethod: "upi",
    paymentReference: utrReference,
    paymentAmount: subtotal,
    source: "kiosk",
  });
  res.status(201).json(result);
});

// ── POST /api/kiosk/icici-initiate ────────────────────────────────────────────────────────
kioskRouter.post("/icici-initiate", paymentLimiter, async (req, res): Promise<void> => {
  const settings = await getKioskSettings();
  if (!settings || !settings.kioskEnabled) {
    res.status(403).json({ error: "Kiosk payments not enabled." });
    return;
  }

  const activeGateway = settings.activePaymentGateway || "icici";
  const gatewayEnabled = activeGateway === "icici" ? settings.iciciEnabled : true;
  if (!gatewayEnabled) {
    res.status(403).json({ error: `${activeGateway.toUpperCase()} payments not enabled.` });
    return;
  }

  const body = req.body as {
    firstName: string; lastName: string; phone: string; email?: string;
    testIds: number[]; totalAmount: number;
  };
  const { firstName, lastName, phone, email = "", testIds, totalAmount } = body;

  if (!firstName?.trim() || !phone?.trim()) {
    res.status(400).json({ error: "Name and phone are required." });
    return;
  }
  if (!Array.isArray(testIds) || testIds.length === 0) {
    res.status(400).json({ error: "Please select at least one test." });
    return;
  }
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid total amount." });
    return;
  }

  // Validate amount against DB
  const tests = await db
    .select({ id: testsTable.id, price: testsTable.price })
    .from(testsTable)
    .where(and(eq(testsTable.isActive, true), inArray(testsTable.id, testIds)));
  if (tests.length !== testIds.length) {
    res.status(400).json({ error: "One or more selected tests are no longer available." });
    return;
  }
  const dbSubtotal = tests.reduce((acc, t) => acc + Number(t.price), 0);
  if (Math.abs(dbSubtotal - amount) > 1) {
    res.status(400).json({ error: "Total mismatch — please restart and try again." });
    return;
  }

  const sessionRef = `KIOSK${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const base = getKioskBase(req);
  const returnUrl = `${base}/api/kiosk/icici-callback`;
  const patientName = `${firstName} ${lastName}`.trim();

  try {
    const result = await PaymentEngine.initiatePayment(activeGateway, {
      bookingRef: sessionRef,
      name: patientName,
      phone: phone.trim(),
      email: email.trim(),
      amount,
      returnUrl,
    });

    if (!result.success) {
      res.status(502).json({ error: `Could not initiate ${activeGateway.toUpperCase()} payment. Please try again.`, details: result.errorMessage });
      return;
    }

    const redirectTo = result.redirectUrl;
    const amountPaise = Math.round(amount * 100);

    // Persist session
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO kiosk_payment_sessions (payment_link_id, session_ref, test_ids, amount_paise, patient_name, patient_details, status, gateway, icici_transaction_id, icici_provider_ref_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionRef, sessionRef, JSON.stringify(testIds), amountPaise, patientName,
         JSON.stringify({ firstName, lastName, phone, email }), activeGateway, sessionRef, result.rawResponse.tranCtx || ""],
      );
    } finally {
      client.release();
    }

    res.json({ sessionRef, redirectUrl: redirectTo, tranCtx: result.rawResponse.tranCtx || "" });
  } catch (err: any) {
    logger.error({ err, sessionRef }, `Kiosk ${activeGateway.toUpperCase()} initiate exception`);
    res.status(502).json({ error: `Could not connect to ${activeGateway.toUpperCase()} payment gateway. Please try again.` });
  }
});

// ── ICICI callback handler (shared GET + POST) ──────────────────────────────────

async function handleKioskIciciCallback(req: any, res: any, queryOrBody: Record<string, string>): Promise<void> {
  const base = getKioskBase(req);
  const erpBase = `${base}/erp`;

  logger.info({ keys: Object.keys(queryOrBody), queryOrBody }, "Kiosk ICICI callback received");

  const { merchantTxnNo, txnID, respDescription } = queryOrBody;
  if (!merchantTxnNo) {
    res.redirect(`${erpBase}/kiosk?failed=1&reason=missing_txn_id`);
    return;
  }

  const client = await pool.connect();
  let session: { session_ref: string; test_ids: string; amount_paise: number; patient_name: string; patient_details: string; status: string; gateway: string } | null = null;
  try {
    const r = await client.query<{ session_ref: string; test_ids: string; amount_paise: number; patient_name: string; patient_details: string; status: string; gateway: string }>(
      `SELECT session_ref, test_ids, amount_paise, patient_name, patient_details, status, gateway FROM kiosk_payment_sessions WHERE payment_link_id = $1`,
      [merchantTxnNo],
    );
    if (r.rowCount === 0) {
      session = null;
    } else {
      session = r.rows[0]!;
    }
  } catch { /* fall through */ }

  if (!session) {
    client.release();
    res.redirect(`${erpBase}/kiosk?failed=1&reason=session_not_found`);
    return;
  }

  const gateway = session.gateway || "icici";

  // Already completed
  if (session.status === "completed") {
    client.release();
    res.redirect(`${erpBase}/kiosk?success=1&ref=${encodeURIComponent(session.session_ref)}&gateway=${gateway}`);
    return;
  }

  try {
    const verification = await PaymentEngine.verifyPayment(
      gateway,
      {
        bookingRef: merchantTxnNo,
        payload: queryOrBody,
      },
      session.patient_name,
      session.amount_paise / 100
    );

    if (verification.success && verification.status === "paid") {
      await client.query(
        `UPDATE kiosk_payment_sessions SET status = 'completed', icici_provider_ref_id = $2 WHERE payment_link_id = $1`,
        [merchantTxnNo, verification.providerRefId || ""],
      );
      client.release();
      res.redirect(`${erpBase}/kiosk?success=1&ref=${encodeURIComponent(session.session_ref)}&gateway=${gateway}`);
      return;
    } else {
      await client.query(
        `UPDATE kiosk_payment_sessions SET status = 'failed' WHERE payment_link_id = $1`,
        [merchantTxnNo],
      );
      client.release();
      res.redirect(`${erpBase}/kiosk?failed=1&reason=${encodeURIComponent(verification.errorMessage || "Payment not completed")}`);
      return;
    }
  } catch (err: any) {
    logger.error({ err, merchantTxnNo }, `Kiosk ${gateway.toUpperCase()} callback verification exception`);
    await client.query(
      `UPDATE kiosk_payment_sessions SET status = 'failed' WHERE payment_link_id = $1`,
      [merchantTxnNo],
    );
    client.release();
    res.redirect(`${erpBase}/kiosk?failed=1&reason=${encodeURIComponent(err.message || "Payment verification error")}`);
    return;
  }
}

kioskRouter.get("/icici-callback", async (req, res): Promise<void> => {
  const merged = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
  await handleKioskIciciCallback(req, res, merged);
});

kioskRouter.post("/icici-callback", async (req, res): Promise<void> => {
  const merged = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
  await handleKioskIciciCallback(req, res, merged);
});

// ── GET /api/kiosk/icici-status/:sessionRef ──────────────────────────────────────────
kioskRouter.get("/icici-status/:sessionRef", async (req, res): Promise<void> => {
  const { sessionRef } = req.params;
  if (!sessionRef || sessionRef.length > 60) {
    res.status(400).json({ error: "Invalid session reference" });
    return;
  }

  const client = await pool.connect();
  try {
    const r = await client.query<{ status: string; icici_transaction_id: string | null; icici_provider_ref_id: string | null }>(
      `SELECT status, icici_transaction_id, icici_provider_ref_id FROM kiosk_payment_sessions WHERE session_ref = $1`,
      [sessionRef],
    );
    if (r.rowCount === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const row = r.rows[0]!;
    const completed = row.status === "completed";
    res.json({ status: row.status, completed, sessionRef: row.icici_transaction_id, providerRef: row.icici_provider_ref_id });
  } finally {
    client.release();
  }
});
