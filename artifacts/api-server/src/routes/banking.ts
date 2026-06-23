import { Router } from "express";
import { db } from "@workspace/db";
import {
  bankAccountsTable, bankTransactionsTable, paymentRequestsTable,
  webhookLogsTable, bankAuditLogsTable,
  reconciliationLogsTable, fraudAlertsTable, gatewayTransactionsTable,
  refundRequestsTable, shiftClosuresTable,
  BANK_PROVIDERS, BANK_ENVIRONMENTS, BANK_ACCOUNT_STATUS,
} from "@workspace/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { apiError, apiErrorFromZod } from "../lib/api-error";
import { requireStaffAuth, requireStaffPermission } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import {
  getBalance, fetchTransactions, importTransactions, getTransactionStatus,
  initiatePayment, getPaymentStatusFromProvider, handleWebhook,
  reconcileByUtr, getUnreconciledTransactions, getDayCloseBankSummary,
  logAudit,
} from "../services/banking/BankingService";
import { listProviders, isValidProvider } from "../services/banking/BankProviderFactory";

const router = Router();

// ---- Providers --------------------------------------------------------------

router.get("/providers", (_req, res) => {
  res.json({ providers: listProviders() });
});

// ---- Bank Accounts ----------------------------------------------------------

const AccountBody = z.object({
  provider: z.enum(BANK_PROVIDERS),
  bankName: z.string().trim().min(1),
  accountNickname: z.string().trim().optional().nullable(),
  maskedAccountNumber: z.string().trim().min(1),
  ifsc: z.string().trim().optional().nullable(),
  branch: z.string().trim().optional().nullable(),
  environment: z.enum(BANK_ENVIRONMENTS).optional().nullable(),
  status: z.enum(BANK_ACCOUNT_STATUS).optional().nullable(),
  credentialKey: z.string().trim().optional().nullable(),
  ledgerAccountId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/), z.null()]).optional().nullable().transform((v) => (v === null || v === undefined) ? null : Number(v)),
  providerConfig: z.any().optional().nullable(),
});

router.post("/accounts", async (req: StaffAuthRequest, res) => {
  const body = AccountBody.safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const [account] = await db.insert(bankAccountsTable).values({
    ...body.data,
    environment: body.data.environment ?? "sandbox",
    status: body.data.status ?? "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  await logAudit({
    action: "account_create",
    provider: account.provider,
    bankAccountId: account.id,
    status: "success",
    details: body.data,
    performedBy: req.staffSession?.subjectName || "staff",
  });
  res.status(201).json(account);
});

router.get("/accounts", async (_req, res) => {
  const rows = await db.select().from(bankAccountsTable).orderBy(desc(bankAccountsTable.createdAt));
  res.json(rows);
});

router.get("/accounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const [row] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, id));
  if (!row) { apiError(res, 404, "Bank account not found"); return; }
  res.json(row);
});

router.patch("/accounts/:id", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const body = AccountBody.partial().safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  // Strip nulls from optional enum fields so drizzle doesn't receive null for string columns
  if (updateData.status === null || updateData.status === undefined) delete updateData.status;
  if (updateData.environment === null || updateData.environment === undefined) delete updateData.environment;
  const [updated] = await db.update(bankAccountsTable).set(updateData).where(eq(bankAccountsTable.id, id)).returning();
  if (!updated) { apiError(res, 404, "Bank account not found"); return; }
  await logAudit({
    action: "account_update",
    provider: updated.provider,
    bankAccountId: updated.id,
    status: "success",
    details: body.data,
    performedBy: req.staffSession?.subjectName || "staff",
  });
  res.json(updated);
});

router.delete("/accounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const [deleted] = await db.delete(bankAccountsTable).where(eq(bankAccountsTable.id, id)).returning();
  if (!deleted) { apiError(res, 404, "Bank account not found"); return; }
  res.json({ deleted: true });
});

// ---- Balance ----------------------------------------------------------------

router.get("/accounts/:id/balance", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  try {
    const { account, balance } = await getBalance(id, req.staffSession?.subjectName || "staff");
    res.json({ account, balance });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Provider error: ${msg}`);
  }
});

router.post("/accounts/refresh-all", async (req: StaffAuthRequest, res) => {
  try {
    const { refreshAllBalances } = await import("../services/banking/BankingService");
    const results = await refreshAllBalances(req.staffSession?.subjectName || "staff");
    res.json({ refreshed: results.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, msg);
  }
});

// ---- Transactions -----------------------------------------------------------

router.get("/accounts/:id/transactions", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const fromDate = req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined;
  const toDate = req.query.toDate ? new Date(String(req.query.toDate)) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  try {
    const { account, transactions } = await fetchTransactions(
      id, { fromDate, toDate, limit }, req.staffSession?.subjectName || "staff",
    );
    res.json({ account, transactions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Provider error: ${msg}`);
  }
});

router.post("/accounts/:id/transactions/import", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const fromDate = req.body.fromDate ? new Date(String(req.body.fromDate)) : undefined;
  const toDate = req.body.toDate ? new Date(String(req.body.toDate)) : undefined;
  try {
    const { transactions } = await fetchTransactions(id, { fromDate, toDate, limit: 500 }, req.staffSession?.subjectName || "staff");
    const imported = await importTransactions(id, transactions, req.staffSession?.subjectName || "staff");
    res.json({ imported });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Import failed: ${msg}`);
  }
});

router.get("/transactions", async (req, res) => {
  const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (accountId) conditions.push(eq(bankTransactionsTable.bankAccountId, accountId));
  if (provider) conditions.push(eq(bankTransactionsTable.provider, provider));
  if (status) conditions.push(eq(bankTransactionsTable.reconciliationStatus, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(bankTransactionsTable).where(where).orderBy(desc(bankTransactionsTable.transactionDate)).limit(limit);
  res.json(rows);
});

router.get("/transactions/:id/status", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const [txn] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
  if (!txn) { apiError(res, 404, "Transaction not found"); return; }
  if (!txn.externalTransactionId) { apiError(res, 400, "No external transaction ID"); return; }
  try {
    const result = await getTransactionStatus(
      txn.bankAccountId, txn.externalTransactionId, req.staffSession?.subjectName || "staff",
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Provider error: ${msg}`);
  }
});

// ---- Payments ---------------------------------------------------------------

const PaymentBody = z.object({
  bankAccountId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(Number),
  amount: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).transform((v) => parseFloat(String(v))),
  currency: z.string().trim().optional().nullable(),
  purpose: z.string().trim().optional().nullable(),
  beneficiaryName: z.string().trim().optional().nullable(),
  beneficiaryAccount: z.string().trim().optional().nullable(),
  beneficiaryIfsc: z.string().trim().optional().nullable(),
  billId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/), z.null()]).optional().nullable().transform((v) => (v === null || v === undefined) ? null : Number(v)),
  voucherId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/), z.null()]).optional().nullable().transform((v) => (v === null || v === undefined) ? null : Number(v)),
});

router.post("/payments", async (req: StaffAuthRequest, res) => {
  const body = PaymentBody.safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const paymentData = {
    amount: body.data.amount,
    currency: body.data.currency || "INR",
    purpose: body.data.purpose || undefined,
    beneficiaryName: body.data.beneficiaryName || undefined,
    beneficiaryAccount: body.data.beneficiaryAccount || undefined,
    beneficiaryIfsc: body.data.beneficiaryIfsc || undefined,
    billId: body.data.billId ?? undefined,
    voucherId: body.data.voucherId ?? undefined,
  };
  try {
    const { account, result, dbPayment } = await initiatePayment(
      body.data.bankAccountId, paymentData, req.staffSession?.subjectName || "staff",
    );
    return res.status(201).json({ account, result, paymentId: dbPayment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(res, 502, `Payment failed: ${msg}`);
  }
});

router.get("/payments", async (req, res) => {
  const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (accountId) conditions.push(eq(paymentRequestsTable.bankAccountId, accountId));
  if (provider) conditions.push(eq(paymentRequestsTable.provider, provider));
  if (status) conditions.push(eq(paymentRequestsTable.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(paymentRequestsTable).where(where).orderBy(desc(paymentRequestsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.get("/payments/:id/status", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  try {
    const result = await getPaymentStatusFromProvider(id, req.staffSession?.subjectName || "staff");
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Status check failed: ${msg}`);
  }
});

// ---- Webhooks (public — mounted separately so banks can call without auth) ----

export const bankingWebhookRouter = Router();

bankingWebhookRouter.post("/:provider", async (req, res) => {
  const provider = String(req.params.provider).toLowerCase();
  if (!isValidProvider(provider)) {
    return apiError(res, 400, `Unknown provider: ${provider}`);
  }
  const rawBody = JSON.stringify(req.body);
  const signature = String(req.headers["x-webhook-signature"] || req.headers["x-signature"] || "");
  try {
    const { verified, payload, logId } = await handleWebhook(provider, rawBody, signature);
    return res.status(verified ? 200 : 400).json({ verified, logId, event: payload?.eventType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(res, 500, `Webhook processing failed: ${msg}`);
  }
});

// ---- Webhook Logs (staff-auth gated, lives inside main router) ---------------

router.get("/webhook-logs", async (req, res) => {
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (provider) conditions.push(eq(webhookLogsTable.provider, provider));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(webhookLogsTable).where(where).orderBy(desc(webhookLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ---- Reconciliation ---------------------------------------------------------

router.get("/reconciliation/unreconciled", async (req, res) => {
  const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const rows = await getUnreconciledTransactions(accountId, limit);
  res.json(rows);
});

router.post("/reconciliation/match", async (req: StaffAuthRequest, res) => {
  const body = z.object({
    utr: z.string().trim().min(1),
    voucherId: z.number().int().positive().optional().nullable(),
    paymentId: z.number().int().positive().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const txn = await reconcileByUtr(
    body.data.utr, body.data.voucherId ?? undefined,
    body.data.paymentId ?? undefined, req.staffSession?.subjectName || "staff",
  );
  if (!txn) { apiError(res, 404, "No transaction found with that UTR"); return; }
  res.json(txn);
});

// ---- Dashboard / Summary ------------------------------------------------------

router.get("/summary", async (req, res) => {
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const conditions = [eq(bankAccountsTable.status, "active")];
  if (provider) conditions.push(eq(bankAccountsTable.provider, provider));
  const accounts = await db.select().from(bankAccountsTable).where(and(...conditions));

  const totalAccounts = accounts.length;
  const totalByProvider: Record<string, number> = {};
  for (const a of accounts) {
    totalByProvider[a.provider] = (totalByProvider[a.provider] || 0) + 1;
  }

  const unreconciled = await db.select({ count: sql<number>`count(*)::int` }).from(bankTransactionsTable).where(eq(bankTransactionsTable.reconciliationStatus, "unreconciled"));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const webhooks = await db.select({ count: sql<number>`count(*)::int` }).from(webhookLogsTable).where(gte(webhookLogsTable.createdAt, since));

  const pendingPayments = await db.select({ count: sql<number>`count(*)::int` }).from(paymentRequestsTable).where(eq(paymentRequestsTable.status, "pending"));

  res.json({
    totalAccounts,
    byProvider: totalByProvider,
    unreconciledTransactions: unreconciled[0]?.count || 0,
    webhooks24h: webhooks[0]?.count || 0,
    pendingPayments: pendingPayments[0]?.count || 0,
    accounts,
  });
});

// ---- Day Close Integration ----------------------------------------------------

router.get("/day-close/:date", async (req: StaffAuthRequest, res) => {
  const date = String(req.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { apiError(res, 400, "date must be YYYY-MM-DD"); return; }
  try {
    const summary = await getDayCloseBankSummary(date);
    res.json({ date, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Summary failed: ${msg}`);
  }
});

// ---- Audit Logs -------------------------------------------------------------

router.get("/audit-logs", async (req, res) => {
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const action = req.query.action ? String(req.query.action) : undefined;
  const bankAccountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (provider) conditions.push(eq(bankAuditLogsTable.provider, provider));
  if (action) conditions.push(eq(bankAuditLogsTable.action, action));
  if (bankAccountId) conditions.push(eq(bankAuditLogsTable.bankAccountId, bankAccountId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(bankAuditLogsTable).where(where).orderBy(desc(bankAuditLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ---- Enterprise Reconciliation Engine (May 2026) ----------------------------

import { batchReconcile, manualReconcile } from "../services/banking/ReconciliationEngine";

router.post("/reconciliation/batch", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const body = z.object({
    fromDate: z.string().optional().nullable(),
    toDate: z.string().optional().nullable(),
    autoCloseThreshold: z.number().min(0).max(100).optional().default(80),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  try {
    const result = await batchReconcile({
      fromDate: body.data.fromDate ? new Date(body.data.fromDate) : undefined,
      toDate: body.data.toDate ? new Date(body.data.toDate) : undefined,
      autoCloseThreshold: body.data.autoCloseThreshold,
      performedBy: req.staffSession?.subjectName || "staff",
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Batch reconcile failed: ${msg}`);
  }
});

router.post("/reconciliation/manual", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const body = z.object({
    bankTransactionId: z.number().int().positive(),
    billId: z.number().int().positive().optional().nullable(),
    paymentId: z.number().int().positive().optional().nullable(),
    voucherId: z.number().int().positive().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const ok = await manualReconcile(
    body.data.bankTransactionId,
    body.data.billId ?? undefined,
    body.data.paymentId ?? undefined,
    body.data.voucherId ?? undefined,
    req.staffSession?.subjectName || "staff",
  );
  if (!ok) { apiError(res, 404, "Bank transaction not found"); return; }
  res.json({ reconciled: true });
});

router.get("/reconciliation/logs", requireStaffAuth, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const rows = await db.select().from(reconciliationLogsTable).orderBy(desc(reconciliationLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ---- Fraud Detection (May 2026) ---------------------------------------------

import { runFraudDetection } from "../services/banking/FraudDetectionEngine";

router.post("/fraud/run-check", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  try {
    const result = await runFraudDetection();
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 502, `Fraud check failed: ${msg}`);
  }
});

router.get("/fraud/alerts", requireStaffAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const severity = req.query.severity ? String(req.query.severity) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (status) conditions.push(eq(fraudAlertsTable.status, status));
  if (severity) conditions.push(eq(fraudAlertsTable.severity, severity));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(fraudAlertsTable).where(where).orderBy(desc(fraudAlertsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.patch("/fraud/alerts/:id", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const body = z.object({
    status: z.enum(["open", "investigating", "resolved", "false_positive", "escalated"]),
    resolutionNote: z.string().max(2000).optional(),
    resolutionAction: z.enum(["approved", "rejected", "adjusted", "escalated"]).optional(),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const [updated] = await db.update(fraudAlertsTable).set({
    status: body.data.status,
    resolutionNote: body.data.resolutionNote ?? null,
    resolutionAction: body.data.resolutionAction ?? null,
    resolvedBy: req.staffSession?.subjectName || "staff",
    resolvedAt: new Date(),
  }).where(eq(fraudAlertsTable.id, id)).returning();
  if (!updated) { apiError(res, 404, "Alert not found"); return; }
  res.json(updated);
});

// ---- Gateway Transactions (May 2026) ------------------------------------------

router.get("/gateway-transactions", requireStaffAuth, async (req, res) => {
  const provider = req.query.provider ? String(req.query.provider) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (provider) conditions.push(eq(gatewayTransactionsTable.provider, provider));
  if (status) conditions.push(eq(gatewayTransactionsTable.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(gatewayTransactionsTable).where(where).orderBy(desc(gatewayTransactionsTable.createdAt)).limit(limit);
  res.json(rows);
});

// ---- Refund Requests (May 2026) -----------------------------------------------

router.get("/refunds", requireStaffAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const conditions = [];
  if (status) conditions.push(eq(refundRequestsTable.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(refundRequestsTable).where(where).orderBy(desc(refundRequestsTable.createdAt)).limit(limit);
  res.json(rows);
});

router.post("/refunds", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const body = z.object({
    billId: z.number().int().positive(),
    paymentId: z.number().int().positive(),
    amount: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).transform((v) => parseFloat(String(v))),
    reason: z.string().trim().min(1),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const [inserted] = await db.insert(refundRequestsTable).values({
    billId: body.data.billId,
    paymentId: body.data.paymentId,
    amount: String(body.data.amount),
    reason: body.data.reason,
    requestedBy: req.staffSession?.subjectName || "staff",
    requestedById: req.staffSession?.subjectId ?? null,
    requestedAt: new Date(),
    status: "requested",
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  res.status(201).json(inserted);
});

router.patch("/refunds/:id/approve", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const body = z.object({ note: z.string().max(2000).optional() }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const [updated] = await db.update(refundRequestsTable).set({
    status: "approved",
    approvedBy: req.staffSession?.subjectName || "staff",
    approvedById: req.staffSession?.subjectId ?? null,
    approvedAt: new Date(),
    approvalNote: body.data.note ?? null,
    updatedAt: new Date(),
  }).where(and(eq(refundRequestsTable.id, id), eq(refundRequestsTable.status, "requested"))).returning();
  if (!updated) { apiError(res, 404, "Refund request not found or already processed"); return; }
  res.json(updated);
});

router.patch("/refunds/:id/reject", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const body = z.object({ reason: z.string().min(1).max(2000) }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const [updated] = await db.update(refundRequestsTable).set({
    status: "rejected",
    rejectedBy: req.staffSession?.subjectName || "staff",
    rejectedAt: new Date(),
    rejectionReason: body.data.reason,
    updatedAt: new Date(),
  }).where(and(eq(refundRequestsTable.id, id), eq(refundRequestsTable.status, "requested"))).returning();
  if (!updated) { apiError(res, 404, "Refund request not found or already processed"); return; }
  res.json(updated);
});

// ---- Shift Closures (May 2026) ----------------------------------------------

router.get("/shift-closures", requireStaffAuth, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const rows = await db.select().from(shiftClosuresTable).orderBy(desc(shiftClosuresTable.endedAt)).limit(limit);
  res.json(rows);
});

router.post("/shift-closures", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const body = z.object({
    shiftLabel: z.string().optional().default("Morning"),
    denominations: z.object({
      d500: z.number().int().min(0).optional().default(0),
      d200: z.number().int().min(0).optional().default(0),
      d100: z.number().int().min(0).optional().default(0),
      d50: z.number().int().min(0).optional().default(0),
      d20: z.number().int().min(0).optional().default(0),
      d10: z.number().int().min(0).optional().default(0),
      coins: z.number().int().min(0).optional().default(0),
    }),
    supervisorName: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }

  const d = body.data.denominations;
  const denomTotal =
    d.d500 * 500 + d.d200 * 200 + d.d100 * 100 +
    d.d50 * 50 + d.d20 * 20 + d.d10 * 10 + d.coins;

  const now = new Date();
  const [inserted] = await db.insert(shiftClosuresTable).values({
    userId: req.staffSession?.subjectId ?? 0,
    userName: req.staffSession?.subjectName || "staff",
    shiftLabel: body.data.shiftLabel,
    startedAt: now,
    endedAt: now,
    expectedCash: "0",
    expectedUpi: "0",
    expectedCard: "0",
    expectedCheque: "0",
    expectedOther: "0",
    expectedTotal: "0",
    actualCash: String(denomTotal),
    actualUpi: "0",
    actualCard: "0",
    actualCheque: "0",
    actualOther: "0",
    actualTotal: String(denomTotal),
    variance: String(denomTotal),
    varianceNote: "",
    denominations: d,
    denominationTotal: String(denomTotal),
    supervisorName: body.data.supervisorName ?? null,
    status: "closed",
    notes: body.data.notes ?? "",
    createdAt: now,
    updatedAt: now,
  }).returning();
  res.status(201).json(inserted);
});

router.patch("/shift-closures/:id", requireStaffAuth, async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { apiError(res, 400, "Invalid id"); return; }
  const body = z.object({
    status: z.enum(["open", "closing", "closed", "approved", "reopened"]).optional(),
    supervisorName: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { apiErrorFromZod(res, 400, "Validation failed", body.error); return; }
  const [updated] = await db.update(shiftClosuresTable).set({
    status: body.data.status ?? undefined,
    supervisorName: body.data.supervisorName ?? undefined,
    notes: body.data.notes ?? undefined,
    updatedAt: new Date(),
  }).where(eq(shiftClosuresTable.id, id)).returning();
  if (!updated) { apiError(res, 404, "Shift closure not found"); return; }
  res.json(updated);
});

router.get("/export", async (req: StaffAuthRequest, res) => {
  const format = String(req.query.format || "csv");
  const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
  const fromDate = req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined;
  const toDate = req.query.toDate ? new Date(String(req.query.toDate)) : undefined;
  const conditions = [];
  if (accountId) conditions.push(eq(bankTransactionsTable.bankAccountId, accountId));
  if (fromDate) conditions.push(gte(bankTransactionsTable.transactionDate, fromDate));
  if (toDate) conditions.push(gte(bankTransactionsTable.transactionDate, toDate));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(bankTransactionsTable).where(where).orderBy(desc(bankTransactionsTable.transactionDate)).limit(5000);
  const headers = ["Date", "Description", "Type", "Amount", "UTR", "Status", "Provider", "Account"];
  const data = rows.map((t) => ({
    Date: new Date(t.transactionDate).toLocaleDateString("en-IN"),
    Description: t.description || "",
    Type: t.type,
    Amount: t.amount,
    UTR: t.utr || "",
    Status: t.reconciliationStatus,
    Provider: t.provider,
    Account: String(t.bankAccountId),
  }));
  res.json({ format, count: rows.length, headers, rows: data });

  void auditFromRequest(req, {
    userId: req.staffSession?.subjectId ?? null,
    userName: req.staffSession?.subjectName ?? "staff",
    role: req.staffSession?.role ?? "staff",
    action: "export",
    module: "banking",
    entityType: "bank_transactions",
    entityId: accountId ? String(accountId) : "all",
    reason: `Banking export: ${rows.length} transactions, accountId=${accountId ?? "all"}, from=${req.query.fromDate ?? "all"} to=${req.query.toDate ?? "all"}`,
  });
});

export const bankingRouter = router;
export default router;
