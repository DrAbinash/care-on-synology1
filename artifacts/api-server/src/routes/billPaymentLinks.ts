// Online payment links for bills — additive scaffolding. FINANCIAL FREEZE SAFE:
// this router NEVER writes to bills / payments / vouchers / accounts. It only
// (a) READS bills + payment_logs, (b) calls the UNMODIFIED PaymentEngine to mint
// a gateway order keyed `BILLPAY-<billId>-<token>`, and (c) records the link in
// its own bill_payment_links table. When the patient pays, the EXISTING gateway
// webhook settles the bill and posts the voucher — no code here touches money.
//
// Mounted at /api/bill-payment-links behind requireStaffAuth +
// requireStaffPermission("/billing") and ff_online_payment_links (Shadow Mode,
// disabled). Books-affecting activation is gated behind that flag / owner
// sign-off. Audited + zod.
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { billPaymentLinksTable, billsTable, patientsTable, paymentLogsTable, clinicSettingsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { PaymentEngine } from "../lib/payments/PaymentEngine"; // import-only; not modified
import { sendPlainWhatsappText } from "./whatsapp";
import { logger } from "../lib/logger";

const LINK_EXPIRY_DAYS = 7;

export const billPaymentLinksRouter = Router();
billPaymentLinksRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_online_payment_links")) { next(); return; }
  res.status(503).json({ error: "Online payment links are disabled. Enable ff_online_payment_links." });
});

function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
const audit = (req: Request, e: { action: string; entityType?: string; entityId?: string; newValue?: string; reason?: string }) =>
  auditFromRequest(req, { ...actorOf(req), module: "bill_payment_links", ...e });

function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || "";
  return raw ? raw.replace(/\/+$/, "") : null;
}
const toNum = (v: string | null | undefined) => Number(v ?? 0) || 0;

/** Derive whether a link has been paid, from read-only sources (payment_logs +
 *  bill balance). Never writes anything. */
async function deriveStatus(link: { txnRef: string; billId: number; status: string }) {
  const logs = await db.select({ status: paymentLogsTable.status }).from(paymentLogsTable)
    .where(eq(paymentLogsTable.bookingRef, link.txnRef)).orderBy(desc(paymentLogsTable.createdAt)).limit(5);
  const gatewaySucceeded = logs.some((l) => l.status === "success");
  const [bill] = await db.select({ balanceAmount: billsTable.balanceAmount, status: billsTable.status }).from(billsTable).where(eq(billsTable.id, link.billId)).limit(1);
  const billPaid = bill ? (toNum(bill.balanceAmount) <= 0.01 || bill.status === "paid") : false;
  return {
    paid: gatewaySucceeded || billPaid,
    gatewaySucceeded,
    billBalance: bill ? toNum(bill.balanceAmount) : null,
    billStatus: bill?.status ?? null,
  };
}

// ── Bill lookup (read-only) for the UI ────────────────────────────────────────
billPaymentLinksRouter.get("/bill/:billNumber", async (req, res) => {
  const [bill] = await db.select().from(billsTable).where(eq(billsTable.billNumber, String(req.params.billNumber))).limit(1);
  if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId)).limit(1);
  res.json({
    id: bill.id, billNumber: bill.billNumber, status: bill.status,
    totalAmount: toNum(bill.totalAmount), paidAmount: toNum(bill.paidAmount), balanceAmount: toNum(bill.balanceAmount),
    patient: patient ? { id: patient.id, name: `${patient.firstName} ${patient.lastName}`.trim(), phone: patient.phone, email: patient.email } : null,
  });
});

// ── Create a payment link (mints a gateway order; NO bill/payment writes) ──────
billPaymentLinksRouter.post("/create", async (req, res) => {
  const p = z.object({ billId: z.number().int().positive(), amount: z.number().positive().optional() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, p.data.billId)).limit(1);
  if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
  const balance = toNum(bill.balanceAmount);
  if (balance <= 0) { res.status(400).json({ error: "Bill is already fully paid" }); return; }
  const amount = p.data.amount ?? balance;
  if (amount > balance + 0.01) { res.status(400).json({ error: `Amount exceeds outstanding balance (${balance})` }); return; }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId)).limit(1);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  const [settings] = await db.select({ g: clinicSettingsTable.activePaymentGateway }).from(clinicSettingsTable).where(eq(clinicSettingsTable.id, 1)).limit(1);
  const gateway = settings?.g || "icici";
  const base = publicBaseUrl();
  const token = crypto.randomBytes(18).toString("hex"); // hex → no '-', safe for the BILLPAY split
  const txnRef = `BILLPAY-${bill.id}-${token}`;

  let redirectUrl: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await PaymentEngine.initiatePayment(gateway, {
      bookingRef: txnRef,
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      phone: patient.phone,
      email: patient.email ?? undefined,
      amount,
      returnUrl: base ? `${base}/` : "/",
    });
    if (result.success) redirectUrl = result.redirectUrl ?? null;
    else errorMessage = result.errorMessage ?? "Gateway initiation failed";
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Gateway error";
    logger.warn({ err, txnRef }, "[bill-payment-links] initiate failed");
  }

  const createdBy = actorOf(req).userName;
  const [row] = await db.insert(billPaymentLinksTable).values({
    billId: bill.id, token, txnRef, gateway, amount: amount.toFixed(2),
    redirectUrl, status: redirectUrl ? "created" : "failed",
    sentTo: patient.phone, lastError: errorMessage,
    expiresAt: new Date(Date.now() + LINK_EXPIRY_DAYS * 864e5),
    createdBy,
  }).returning();

  // Stamp initiating staff on the payment log so BILLPAY webhook/callback
  // settle credits this user (same as Billing Desk online collection).
  if (createdBy && createdBy !== "system") {
    try {
      const [log] = await db.select({ requestPayload: paymentLogsTable.requestPayload })
        .from(paymentLogsTable)
        .where(eq(paymentLogsTable.bookingRef, txnRef))
        .limit(1);
      let existing: Record<string, unknown> = {};
      if (log?.requestPayload) {
        try { existing = JSON.parse(log.requestPayload); } catch { existing = {}; }
      }
      if (log) {
        await db.update(paymentLogsTable)
          .set({ requestPayload: JSON.stringify({ ...existing, initiatedByName: createdBy }) })
          .where(eq(paymentLogsTable.bookingRef, txnRef));
      }
    } catch (err) {
      logger.warn({ err, txnRef }, "[bill-payment-links] failed to stamp initiatedByName");
    }
  }

  await audit(req, { action: "create", entityType: "bill_payment_link", entityId: String(row.id), newValue: JSON.stringify({ billId: bill.id, amount, gateway }) });
  if (!redirectUrl) { res.status(502).json({ error: errorMessage || "Could not create payment link", link: row }); return; }
  res.status(201).json(row);
});

// ── Send the link to the patient via WhatsApp ─────────────────────────────────
billPaymentLinksRouter.post("/:id/send", async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [link] = await db.select().from(billPaymentLinksTable).where(eq(billPaymentLinksTable.id, id.data)).limit(1);
  if (!link) { res.status(404).json({ error: "Link not found" }); return; }
  if (!link.redirectUrl) { res.status(400).json({ error: "Link has no payment URL" }); return; }
  if (!link.sentTo) { res.status(400).json({ error: "No phone on file" }); return; }
  const body = `Payment link for your bill: pay ₹${toNum(link.amount)} securely here — ${link.redirectUrl}`;
  const r = await sendPlainWhatsappText(link.sentTo, body, "payment_link");
  if (r.skipped) { res.status(503).json({ error: "WhatsApp disabled" }); return; }
  await db.update(billPaymentLinksTable).set({
    status: r.ok ? "sent" : link.status, providerMessageId: r.messageId ?? null, lastError: r.ok ? null : (r.error ?? "send failed"),
  }).where(eq(billPaymentLinksTable.id, id.data));
  await audit(req, { action: "send", entityType: "bill_payment_link", entityId: String(id.data), newValue: JSON.stringify({ ok: r.ok }) });
  res.json({ ok: r.ok, error: r.ok ? undefined : r.error });
});

// ── List links for a bill (with derived paid status) ──────────────────────────
billPaymentLinksRouter.get("/by-bill/:billId", async (req, res) => {
  const billId = z.coerce.number().int().positive().safeParse(req.params.billId);
  if (!billId.success) { res.status(400).json({ error: "Invalid bill id" }); return; }
  const links = await db.select().from(billPaymentLinksTable).where(eq(billPaymentLinksTable.billId, billId.data)).orderBy(desc(billPaymentLinksTable.createdAt));
  const withStatus = await Promise.all(links.map(async (l) => ({ ...l, derived: await deriveStatus(l) })));
  res.json(withStatus);
});

// ── Single link status ────────────────────────────────────────────────────────
billPaymentLinksRouter.get("/:id/status", async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [link] = await db.select().from(billPaymentLinksTable).where(eq(billPaymentLinksTable.id, id.data)).limit(1);
  if (!link) { res.status(404).json({ error: "Link not found" }); return; }
  res.json({ ...link, derived: await deriveStatus(link) });
});

export default billPaymentLinksRouter;
