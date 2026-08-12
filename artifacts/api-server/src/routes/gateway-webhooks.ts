/**
 * gateway-webhooks.ts
 *
 * Server-side (S2S) payment webhook receivers for ICICI Orange Pay and HDFC SmartGateway.
 *
 * WHY A SEPARATE FILE:
 *   The browser redirect callbacks already live in public-booking.ts.
 *   These server-to-server webhooks are fired by the gateway independently of the
 *   browser session — they fire even when the user closes the tab, network drops,
 *   or the browser redirect never completes. This closes the reconciliation gap.
 *
 * HOW IT WORKS:
 *   1. Gateway POSTs to /api/gateway/icici-webhook or /api/gateway/hdfc-webhook
 *   2. We verify the signature (HMAC-SHA256 for ICICI, SHA256 for HDFC)
 *   3. We look up the bill or online_booking by the transaction reference
 *   4. If payment is confirmed: insert payments row, update bill, fire auto-voucher
 *   5. Return 200 immediately — gateways require a 200 within 5 seconds
 *
 * ADMIN RECONCILIATION:
 *   POST /api/gateway/reconcile   — re-check status of any pending online bill/booking
 *
 * ENV VARS REQUIRED:
 *   ICICI_SECRET_KEY   — used for HMAC verification
 *   HDFC_SECRET_KEY    — used for SHA256 verification
 *   HDFC_MERCHANT_ID   — HDFC merchant ID for status check
 *   HDFC_BASE_URL      — HDFC gateway base URL (default: https://smartgateway.hdfcbank.com)
 */

import { Router } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  billsTable,
  paymentsTable,
  onlineBookingsTable,
  paymentLogsTable,
  clinicSettingsTable,
} from "@workspace/db/schema";
import { eq, and, or, inArray, like, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { autoVoucherForPayment } from "../lib/auto-voucher";
import { PaymentEngine } from "../lib/payments/PaymentEngine";
import { resolveBillDeskCollectorFromTxnRef } from "../lib/payments/resolveBillDeskCollectorFromDb";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const gatewayWebhookRouter = Router();

// ─── Signature verification (extracted for unit testing) ─────────────────────
//
// SECURITY: both of these previously verified the signature only when one
// happened to be present in the payload (`if (hash && secret) { verify }`),
// which meant a forged request that simply omitted the signature field skipped
// verification entirely and fell through to being trusted. Both now return
// `false` (reject) whenever the signature or secret is missing, not just when
// a present signature fails to match. See gatewayWebhookRouter.post handlers
// below for where these are used — this is the exact logic, only extracted so
// it can be tested without spinning up the full route + DB.

/** ICICI Orange Pay HMAC-SHA256 webhook signature check. */
export function verifyIciciWebhookSignature(body: Record<string, string>, secretKey: string | undefined | null): boolean {
  const secureHash = body.secureHash || "";
  if (!secureHash || !secretKey) return false;
  const hashParams = { ...body };
  delete hashParams.secureHash;
  const keys = Object.keys(hashParams).sort();
  const hashText = keys.map((k) => hashParams[k]).join("");
  const expected = crypto.createHmac("sha256", secretKey).update(hashText).digest("hex");
  return expected === secureHash;
}

/**
 * HDFC SmartGateway SHA256 webhook signature check.
 *
 * SECURITY FIX: the signed string previously omitted `amount`, so a hash
 * computed over merchantId|orderId|status|secret was equally valid for ANY
 * amount value in the request body — an attacker who observed (or guessed)
 * one genuine webhook for an orderId could replay it with a modified amount
 * and the signature would still verify. `amount` is now part of the signed
 * payload so tampering with it invalidates the signature, matching the ICICI
 * check above (full-body HMAC) which already binds amount.
 */
export function verifyHdfcWebhookSignature(
  params: {
    orderId: string;
    status: string;
    amount: string;
    receivedSignature: string | undefined | null;
    merchantId: string | undefined | null;
    secretKey: string | undefined | null;
  },
): boolean {
  const { orderId, status, amount, receivedSignature, merchantId, secretKey } = params;
  if (!receivedSignature || !merchantId || !secretKey) return false;
  const signatureInput = `${merchantId}|${orderId}|${status}|${amount}|${secretKey}`;
  const expected = crypto.createHash("sha256").update(signatureInput).digest("hex");
  return expected === receivedSignature;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Settle a bill from a confirmed gateway payment.
 *
 * F1 canonical idempotency: reference_number is OUR merchant reference
 * (BILLPAY-… / booking ref) — the SAME key the callback and polling paths
 * key on — and the provider's transaction id goes into gateway_txn_id.
 * (Previously this path keyed reference_number by the provider txnID, so
 * a webhook and a callback could post the SAME payment twice under two
 * different keys.) The guard matches on either identifier in either column
 * so rows recorded before this change still dedupe.
 */
async function settleBill(opts: {
  billId: number;
  amount: number;
  method: string;
  /** Our merchant reference (merchantTxnNo / BILLPAY ref). */
  merchantRef: string;
  /** The provider's transaction id (may be empty when not supplied). */
  gatewayTxnId: string;
  gatewayName: string;
  patientName?: string | null;
  performedBy?: string;
}): Promise<{ settled: boolean; alreadySettled: boolean; paymentId: number | null }> {
  const { billId, amount, method, merchantRef, gatewayTxnId, gatewayName, patientName, performedBy = "Gateway Webhook" } = opts;

  const referenceNumber = merchantRef || gatewayTxnId;
  const knownRefs = [merchantRef, gatewayTxnId].filter((r): r is string => Boolean(r));

  return await db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(billsTable)
      .where(eq(billsTable.id, billId))
      .for("update")
      .limit(1);
    if (!bill) return { settled: false, alreadySettled: false, paymentId: null };

    // Idempotency guard — don't double-post the same gateway transaction,
    // whichever path (webhook/callback/poll) or era (pre/post-F1 keying)
    // recorded it first. The bill row-lock above serializes same-bill races;
    // the (bill_id, reference_number) and (bill_id, gateway_txn_id) unique
    // indexes are the DB-level backstop.
    const [existing] = await tx
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.billId, billId),
          or(
            inArray(paymentsTable.referenceNumber, knownRefs),
            inArray(paymentsTable.gatewayTxnId, knownRefs),
          ),
        ),
      )
      .limit(1);

    if (existing) return { settled: false, alreadySettled: true, paymentId: existing.id };

    // Insert payment row
    const [inserted] = await tx.insert(paymentsTable).values({
      billId,
      amount: amount.toFixed(2),
      method,
      referenceNumber,
      gatewayTxnId: gatewayTxnId || null,
      settlementStatus: "captured",
      notes: `Settled via ${gatewayName} S2S webhook. Ref: ${referenceNumber}${gatewayTxnId ? ` / gateway txn ${gatewayTxnId}` : ""}`,
      recordedByName: performedBy,
    }).returning({ id: paymentsTable.id });

    const newPaid = Number(bill.paidAmount) + amount;
    // FIX: subtract existing refund_amount so balance = total − paid − refund
    // (same invariant enforced by the manual refund route in bills.ts).
    const existingRefund = Number(bill.refundAmount ?? 0);
    const newBalance = Math.max(0, Number(bill.totalAmount) - newPaid - existingRefund);
    const newStatus = newBalance <= 0.01 ? "paid" : "partial";

    await tx
      .update(billsTable)
      .set({
        paidAmount: newPaid.toFixed(2),
        balanceAmount: newBalance.toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(billsTable.id, billId));

    return { settled: true, alreadySettled: false, paymentId: inserted?.id ?? null };
  });
}

/** Log the raw webhook payload to paymentLogsTable for audit */
async function logWebhookPayload(opts: {
  bookingRef: string;
  gateway: string;
  amount: string;
  payload: unknown;
  status: string;
}) {
  try {
    await db.insert(paymentLogsTable).values({
      bookingRef: opts.bookingRef,
      patientName: "",
      gateway: opts.gateway,
      amount: opts.amount,
      status: opts.status,
      requestPayload: JSON.stringify(opts.payload),
    });
  } catch (err) {
    logger.warn({ err }, "[gateway-webhook] Failed to log payload (non-fatal)");
  }
}

// ─── ICICI Orange Pay — Server-to-Server Webhook ─────────────────────────────
//
// ICICI posts to this URL when a transaction completes (success or failure).
// This fires independently of the browser redirect — it's the reliable fallback.
//
// ICICI Webhook Payload (JSON):
//   { merchantTxnNo, txnID, amount, txnStatus, responseCode, respDescription,
//     addlParam1 (= bookingRef), secureHash, ... }
//
// Docs: ICICI Orange Pay Integration Guide § Webhook Notification

gatewayWebhookRouter.post("/icici-webhook", async (req, res): Promise<void> => {
  // Always acknowledge immediately — ICICI requires 200 within 5s
  res.status(200).json({ status: "received" });

  const body = req.body as Record<string, string>;
  const merchantTxnNo: string = body.merchantTxnNo || body.addlParam1 || "";
  const txnID: string = body.txnID || body.txnId || "";
  const rawAmount = body.amount || "0";
  const txnStatus: string = body.txnStatus || body.responseCode || "";
  const secureHash: string = body.secureHash || "";

  logger.info({ merchantTxnNo, txnStatus, txnID }, "[icici-webhook] Received S2S notification");

  // ── 1. Verify ICICI HMAC-SHA256 signature (MANDATORY — see security fix
  // below; this used to be conditional and silently skippable) ─────────────
  const secretKey =
    process.env.ICICI_SECRET_KEY ||
    (await db.select({ v: clinicSettingsTable.iciciSecretKey })
      .from(clinicSettingsTable).limit(1)
      .then((r) => r[0]?.v || ""));

  // SECURITY FIX: previously `if (secureHash && secretKey) { ...verify... }`
  // — if an attacker's forged POST simply omitted secureHash, this whole
  // block was skipped and the code fell straight through to trusting the
  // attacker-supplied txnStatus/amount. Since this endpoint has no other
  // authentication (S2S webhooks must be publicly reachable) and bookingRef/
  // billId values are obtainable or guessable by anyone, this allowed
  // forging a "payment successful" notification for any booking or bill
  // without paying. Verification is now mandatory: missing secureHash,
  // missing secretKey, or a hash mismatch are ALL rejected the same way.
  // See verifyIciciWebhookSignature() above (unit-tested in
  // gateway-webhooks.test.ts) for the exact check.
  if (!verifyIciciWebhookSignature(body, secretKey)) {
    logger.warn(
      { merchantTxnNo, hasSecureHash: Boolean(secureHash), hasSecretKey: Boolean(secretKey) },
      "[icici-webhook] Signature missing or invalid — rejecting (cannot verify authenticity)",
    );
    await logWebhookPayload({ bookingRef: merchantTxnNo, gateway: "icici", amount: rawAmount, payload: body, status: secureHash ? "signature_mismatch" : "signature_missing" });
    return;
  }

  // ── 2. Check transaction is successful ───────────────────────────────────
  const isSuccess =
    txnStatus === "SUC" ||
    txnStatus === "0000" ||
    txnStatus === "000" ||
    body.responseCode === "R1000" ||
    body.txnResponseCode === "0000";

  await logWebhookPayload({
    bookingRef: merchantTxnNo,
    gateway: "icici",
    amount: rawAmount,
    payload: body,
    status: isSuccess ? "webhook_success" : "webhook_failed",
  });

  if (!isSuccess) {
    logger.info({ merchantTxnNo, txnStatus }, "[icici-webhook] Transaction not successful — no action");
    return;
  }

  const amount = parseFloat(rawAmount) || 0;
  if (amount <= 0) {
    logger.warn({ merchantTxnNo, rawAmount }, "[icici-webhook] Amount is zero or invalid — skipping");
    return;
  }

  // ── 3a. Check if this is a direct bill payment (BILLPAY-<id>-...) ─────────
  if (merchantTxnNo.startsWith("BILLPAY-")) {
    const billId = Number(merchantTxnNo.split("-")[1]);
    if (!billId || Number.isNaN(billId)) {
      logger.warn({ merchantTxnNo }, "[icici-webhook] Cannot parse billId from BILLPAY ref");
      return;
    }
    const [billForActor] = await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1);
    const collectorName = await resolveBillDeskCollectorFromTxnRef(merchantTxnNo, {
      billCreatedByName: billForActor?.createdByName,
      fallback: "ICICI S2S Webhook",
    });
    const { settled, alreadySettled, paymentId } = await settleBill({
      billId,
      amount,
      method: "Online (ICICI Orange Pay)",
      merchantRef: merchantTxnNo,
      gatewayTxnId: txnID,
      gatewayName: "ICICI Orange Pay",
      performedBy: collectorName,
    });
    if (settled) {
      const bill = billForActor ?? (await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1))[0];
      if (bill) {
        autoVoucherForPayment({
          billId,
          amount,
          method: "online",
          billNumber: bill.billNumber,
          patientName: null,
          performedBy: collectorName,
          paymentId: paymentId ?? undefined,
        }).catch(() => {});
      }
      logger.info({ billId, amount, merchantTxnNo }, "[icici-webhook] Bill settled via S2S");
    } else if (alreadySettled) {
      logger.info({ billId, merchantTxnNo }, "[icici-webhook] Bill already settled — idempotent skip");
    }
    return;
  }

  // ── 3b. Check if this is an online booking ────────────────────────────────
  const [booking] = await db
    .select()
    .from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.iciciTransactionId, merchantTxnNo))
    .limit(1);

  if (!booking) {
    logger.warn({ merchantTxnNo }, "[icici-webhook] No matching booking or bill found");
    return;
  }

  if (booking.status === "paid" || booking.status === "confirmed") {
    logger.info({ merchantTxnNo, bookingId: booking.id }, "[icici-webhook] Booking already paid — idempotent skip");
    return;
  }

  // Mark booking as paid and trigger bill creation
  await db
    .update(onlineBookingsTable)
    .set({ status: "paid", iciciProviderRefId: txnID || booking.iciciProviderRefId })
    .where(eq(onlineBookingsTable.id, booking.id));

  // Trigger booking confirmation (creates bill + accounting)
  try {
    const { confirmBookingInternal } = await import("./online-bookings");
    await confirmBookingInternal(booking.id, "ICICI S2S Webhook");
    logger.info({ bookingId: booking.id, merchantTxnNo }, "[icici-webhook] Booking confirmed via S2S");
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, "[icici-webhook] Booking confirmation failed");
  }
});

// ─── HDFC SmartGateway — Server-to-Server Webhook ────────────────────────────
//
// HDFC posts to this endpoint when a transaction completes.
// Payload format (form-encoded or JSON depending on HDFC configuration):
//   { orderId, txnId, status, amount, signature, ... }
//
// Signature verification: SHA256(merchantId + "|" + orderId + "|" + status + "|" + secretKey)
//
// Docs: HDFC SmartGateway Integration Manual § Notification URL

gatewayWebhookRouter.post("/hdfc-webhook", async (req, res): Promise<void> => {
  // Always acknowledge immediately — HDFC requires 200 within 5s
  res.status(200).json({ status: "received" });

  const body = req.body as Record<string, string>;
  const orderId: string = body.orderId || body.order_id || body.merchantTxnNo || "";
  const txnId: string = body.txnId || body.txn_id || "";
  const status: string = (body.status || "").toUpperCase();
  const rawAmount = body.amount || body.amt || "0";
  const receivedSignature = body.signature || body.checksum || "";

  logger.info({ orderId, status, txnId }, "[hdfc-webhook] Received S2S notification");

  // ── 1. Verify HDFC signature (MANDATORY — see ICICI webhook fix above for
  // the full rationale; same "silently skippable" defect existed here).
  // See verifyHdfcWebhookSignature() above (unit-tested in
  // gateway-webhooks.test.ts) for the exact check. ─────────────────────────
  const merchantId =
    process.env.HDFC_MERCHANT_ID || "";

  const secretKey = process.env.HDFC_SECRET_KEY || "";

  if (!verifyHdfcWebhookSignature({ orderId, status, amount: rawAmount, receivedSignature, merchantId, secretKey })) {
    logger.warn(
      { orderId, hasSignature: Boolean(receivedSignature), hasMerchantId: Boolean(merchantId), hasSecretKey: Boolean(secretKey) },
      "[hdfc-webhook] Signature missing or invalid — rejecting (cannot verify authenticity)",
    );
    await logWebhookPayload({ bookingRef: orderId, gateway: "hdfc", amount: rawAmount, payload: body, status: receivedSignature ? "signature_mismatch" : "signature_missing" });
    return;
  }

  // ── 2. Check transaction is successful ───────────────────────────────────
  const isSuccess = status === "SUCCESS" || status === "CAPTURED" || status === "CHARGED";

  await logWebhookPayload({
    bookingRef: orderId,
    gateway: "hdfc",
    amount: rawAmount,
    payload: body,
    status: isSuccess ? "webhook_success" : "webhook_failed",
  });

  if (!isSuccess) {
    logger.info({ orderId, status }, "[hdfc-webhook] Transaction not successful — no action");
    return;
  }

  const amount = parseFloat(rawAmount) || 0;
  if (amount <= 0) {
    logger.warn({ orderId, rawAmount }, "[hdfc-webhook] Amount is zero or invalid — skipping");
    return;
  }

  // ── 3a. Direct bill payment (BILLPAY-<id>-...) ───────────────────────────
  if (orderId.startsWith("BILLPAY-")) {
    const billId = Number(orderId.split("-")[1]);
    if (!billId || Number.isNaN(billId)) {
      logger.warn({ orderId }, "[hdfc-webhook] Cannot parse billId from BILLPAY ref");
      return;
    }
    const [billForActor] = await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1);
    const collectorName = await resolveBillDeskCollectorFromTxnRef(orderId, {
      billCreatedByName: billForActor?.createdByName,
      fallback: "HDFC S2S Webhook",
    });
    const { settled, alreadySettled, paymentId } = await settleBill({
      billId,
      amount,
      method: "Online (HDFC SmartGateway)",
      merchantRef: orderId,
      gatewayTxnId: txnId,
      gatewayName: "HDFC SmartGateway",
      performedBy: collectorName,
    });
    if (settled) {
      const bill = billForActor ?? (await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1))[0];
      if (bill) {
        autoVoucherForPayment({
          billId,
          amount,
          method: "online",
          billNumber: bill.billNumber,
          patientName: null,
          performedBy: collectorName,
          paymentId: paymentId ?? undefined,
        }).catch(() => {});
      }
      logger.info({ billId, amount, orderId }, "[hdfc-webhook] Bill settled via S2S");
    } else if (alreadySettled) {
      logger.info({ billId, orderId }, "[hdfc-webhook] Bill already settled — idempotent skip");
    }
    return;
  }

  // ── 3b. Online booking ────────────────────────────────────────────────────
  const [booking] = await db
    .select()
    .from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.iciciTransactionId, orderId))
    .limit(1);

  if (!booking) {
    logger.warn({ orderId }, "[hdfc-webhook] No matching booking found");
    return;
  }

  if (booking.status === "paid" || booking.status === "confirmed") {
    logger.info({ orderId, bookingId: booking.id }, "[hdfc-webhook] Already paid — skip");
    return;
  }

  await db
    .update(onlineBookingsTable)
    .set({ status: "paid" })
    .where(eq(onlineBookingsTable.id, booking.id));

  try {
    const { confirmBookingInternal } = await import("./online-bookings");
    await confirmBookingInternal(booking.id, "HDFC S2S Webhook");
    logger.info({ bookingId: booking.id, orderId }, "[hdfc-webhook] Booking confirmed via S2S");
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, "[hdfc-webhook] Booking confirmation failed");
  }
});

// ─── Admin: Manual Reconciliation ─────────────────────────────────────────────
//
// POST /api/gateway/reconcile
// Body: { type: "bill" | "booking", id: number, gateway?: string }
//
// Calls the gateway's checkStatus API and settles if paid.
// Used when the webhook was missed (network issue, server restart, etc.)

gatewayWebhookRouter.post("/reconcile", requireStaffAuth, async (req: StaffAuthRequest, res): Promise<void> => {
  const { type, id, gateway: forceGateway } = req.body as {
    type?: string;
    id?: number;
    gateway?: string;
  };

  if (!type || !id || !["bill", "booking"].includes(type)) {
    res.status(400).json({ error: "type (bill|booking) and id are required" });
    return;
  }

  let bookingRef: string;
  let amount: number;
  let billId: number | null = null;
  let patientName: string | null = null;
  let billNumber: string | null = null;
  let billCreatedByName: string | null = null;

  if (type === "bill") {
    const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id)).limit(1);
    if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }

    // Desk txn refs are BILLPAY-<id>-<hex>; match the newest initiate log.
    const [log] = await db
      .select()
      .from(paymentLogsTable)
      .where(like(paymentLogsTable.bookingRef, `BILLPAY-${id}-%`))
      .orderBy(desc(paymentLogsTable.createdAt))
      .limit(1);

    bookingRef = log?.bookingRef || `BILLPAY-${id}`;
    amount = log ? Number(log.amount) : Number(bill.balanceAmount);
    billId = id;
    billNumber = bill.billNumber;
    billCreatedByName = bill.createdByName ?? null;
  } else {
    const [booking] = await db.select().from(onlineBookingsTable).where(eq(onlineBookingsTable.id, id)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
    bookingRef = booking.iciciTransactionId || booking.bookingRef;
    amount = Number(booking.totalAmount);
    patientName = booking.name;
  }

  const [settings] = await db.select().from(clinicSettingsTable).limit(1);
  const gatewayId = forceGateway || settings?.activePaymentGateway || "icici";

  try {
    const provider = await PaymentEngine.getProvider(gatewayId);
    const statusResult = await provider.checkStatus({ bookingRef });

    if (!statusResult.success || statusResult.status !== "paid") {
      res.json({
        reconciled: false,
        status: statusResult.status,
        message: statusResult.errorMessage || "Gateway reports payment not completed",
        gateway: gatewayId,
        bookingRef,
      });
      return;
    }

    // Payment confirmed — settle
    if (type === "bill" && billId) {
      const collectorName = await resolveBillDeskCollectorFromTxnRef(bookingRef, {
        sessionName: req.staffSession?.subjectName,
        billCreatedByName,
        fallback: "Manual Reconciliation",
      });
      const { settled, alreadySettled, paymentId } = await settleBill({
        billId,
        amount,
        method: `Online (${provider.displayName})`,
        merchantRef: bookingRef,
        gatewayTxnId: "",
        gatewayName: provider.displayName,
        performedBy: collectorName,
      });

      if (settled && billNumber) {
        autoVoucherForPayment({
          billId,
          amount,
          method: "online",
          billNumber,
          patientName,
          performedBy: collectorName,
          paymentId: paymentId ?? undefined,
        }).catch(() => {});
      }

      res.json({
        reconciled: settled,
        alreadySettled,
        gateway: gatewayId,
        bookingRef,
        amount,
      });
      return;
    }

    if (type === "booking") {
      const [booking] = await db
        .select()
        .from(onlineBookingsTable)
        .where(eq(onlineBookingsTable.id, id))
        .limit(1);

      if (booking?.status === "paid" || booking?.status === "confirmed") {
        res.json({ reconciled: false, alreadySettled: true, gateway: gatewayId, bookingRef });
        return;
      }

      await db
        .update(onlineBookingsTable)
        .set({ status: "paid" })
        .where(eq(onlineBookingsTable.id, id));

      const { confirmBookingInternal } = await import("./online-bookings");
      await confirmBookingInternal(id, "Manual Reconciliation");

      res.json({ reconciled: true, gateway: gatewayId, bookingRef, amount });
      return;
    }

    res.json({ reconciled: false, message: "Unhandled type" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, bookingRef, gatewayId }, "[reconcile] Failed");
    res.status(500).json({ error: "Reconciliation failed: " + msg });
  }
});

// ─── GET /api/gateway/pending-online-bills ────────────────────────────────────
// Returns all bills with status=pending and method=online for admin reconciliation UI

gatewayWebhookRouter.get("/pending-online-bills", requireStaffAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
    })
    .from(billsTable)
    .where(eq(billsTable.status, "pending"))
    .orderBy(billsTable.createdAt)
    .limit(200);

  // Filter to only bills that have a payment log with gateway="icici"|"hdfc"|"online"
  const logs = await db
    .select({ bookingRef: paymentLogsTable.bookingRef, gateway: paymentLogsTable.gateway })
    .from(paymentLogsTable)
    .where(eq(paymentLogsTable.status, "initiated"));

  const billPayRefs = new Set(logs.map((l) => l.bookingRef));
  const pending = rows.filter((b) =>
    billPayRefs.has(`BILLPAY-${b.id}`) ||
    billPayRefs.has(`BILLPAY-${b.id}-`) ||
    Number(b.balanceAmount) > 0,
  );

  res.json(pending.map((b) => ({
    ...b,
    totalAmount: Number(b.totalAmount),
    paidAmount: Number(b.paidAmount),
    balanceAmount: Number(b.balanceAmount),
  })));
});
