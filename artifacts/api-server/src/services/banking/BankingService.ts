import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bankAccountsTable, bankTransactionsTable, paymentRequestsTable,
  webhookLogsTable, bankAuditLogsTable,
} from "@workspace/db/schema";
import { createProvider } from "./BankProviderFactory";
import type { BankTransaction, PaymentInitiation, PaymentResult, WebhookPayload } from "./BankProvider";

export async function getProviderForAccount(bankAccountId: number) {
  const [account] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, bankAccountId));
  if (!account) throw new Error(`Bank account ${bankAccountId} not found`);
  const config = (account.providerConfig as Record<string, unknown> | null) ?? undefined;
  return { account, provider: await createProvider(account.provider, config) };
}

export async function logAudit(entry: {
  action: string; provider: string; bankAccountId?: number | null;
  externalId?: string | null; amount?: number | null;
  status: string; details?: unknown; performedBy: string;
}) {
  await db.insert(bankAuditLogsTable).values({
    action: entry.action,
    provider: entry.provider,
    bankAccountId: entry.bankAccountId ?? null,
    externalId: entry.externalId ?? null,
    amount: entry.amount != null ? String(entry.amount) : null,
    status: entry.status,
    details: entry.details ?? null,
    performedBy: entry.performedBy,
    createdAt: new Date(),
  });
}

// ---- Balance ---------------------------------------------------------------

export async function getBalance(bankAccountId: number, performedBy?: string) {
  const { account, provider } = await getProviderForAccount(bankAccountId);
  try {
    const balance = await provider.getBalance(account.maskedAccountNumber);
    await logAudit({
      action: "balance_check",
      provider: account.provider,
      bankAccountId: account.id,
      status: "success",
      amount: balance.available,
      details: { balance },
      performedBy: performedBy || "system",
    });
    return { account, balance };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAudit({
      action: "balance_check",
      provider: account.provider,
      bankAccountId: account.id,
      status: "error",
      details: { error: msg },
      performedBy: performedBy || "system",
    });
    throw err;
  }
}

// ---- Transactions ----------------------------------------------------------

export async function fetchTransactions(
  bankAccountId: number,
  options?: { fromDate?: Date; toDate?: Date; limit?: number },
  performedBy?: string,
): Promise<{ account: typeof bankAccountsTable.$inferSelect; transactions: BankTransaction[] }> {
  const { account, provider } = await getProviderForAccount(bankAccountId);
  try {
    const txs = await provider.getTransactions(account.maskedAccountNumber, options);
    await logAudit({
      action: "transaction_fetch",
      provider: account.provider,
      bankAccountId: account.id,
      status: "success",
      details: { count: txs.length },
      performedBy: performedBy || "system",
    });
    return { account, transactions: txs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAudit({
      action: "transaction_fetch",
      provider: account.provider,
      bankAccountId: account.id,
      status: "error",
      details: { error: msg },
      performedBy: performedBy || "system",
    });
    throw err;
  }
}

export async function importTransactions(
  bankAccountId: number,
  txs: BankTransaction[],
  performedBy?: string,
) {
  const { account } = await getProviderForAccount(bankAccountId);
  const values = txs.map((t) => ({
    bankAccountId,
    provider: account.provider,
    externalTransactionId: t.externalTransactionId,
    transactionDate: t.transactionDate,
    description: t.description,
    amount: String(t.amount),
    type: t.type,
    balanceAfter: t.balanceAfter !== undefined ? String(t.balanceAfter) : null,
    utr: t.utr ?? null,
    referenceNumber: t.referenceNumber ?? null,
    rawPayload: t.rawPayload ?? null,
    reconciliationStatus: "unreconciled" as const,
  }));
  if (values.length === 0) return 0;
  await db.insert(bankTransactionsTable).values(values).onConflictDoNothing();
  await logAudit({
    action: "transaction_fetch",
    provider: account.provider,
    bankAccountId,
    status: "success",
    details: { imported: values.length },
    performedBy: performedBy || "system",
  });
  return values.length;
}

// ---- Transaction Status ----------------------------------------------------

export async function getTransactionStatus(bankAccountId: number, externalTransactionId: string, performedBy?: string) {
  const { account, provider } = await getProviderForAccount(bankAccountId);
  const result = await provider.getTransactionStatus(externalTransactionId);
  await logAudit({
    action: "transaction_fetch",
    provider: account.provider,
    bankAccountId: account.id,
    externalId: externalTransactionId,
    status: "success",
    details: { status: result.status },
    performedBy: performedBy || "system",
  });
  return result;
}

// ---- Payments --------------------------------------------------------------

export async function initiatePayment(
  bankAccountId: number,
  payment: PaymentInitiation & { purpose?: string; billId?: number; voucherId?: number },
  performedBy?: string,
): Promise<{ account: typeof bankAccountsTable.$inferSelect; result: PaymentResult; dbPayment: number }> {
  const { account, provider } = await getProviderForAccount(bankAccountId);
  try {
    const result = await provider.initiatePayment(account.maskedAccountNumber, payment);
    const [inserted] = await db.insert(paymentRequestsTable).values({
      bankAccountId,
      provider: account.provider,
      amount: String(payment.amount),
      currency: payment.currency || "INR",
      purpose: payment.purpose || null,
      beneficiaryName: payment.beneficiaryName || null,
      beneficiaryAccount: payment.beneficiaryAccount || null,
      beneficiaryIfsc: payment.beneficiaryIfsc || null,
      externalRequestId: result.externalRequestId || null,
      externalTransactionId: result.externalTransactionId || null,
      status: result.status,
      failureReason: result.failureReason || null,
      billId: payment.billId ?? null,
      voucherId: payment.voucherId ?? null,
      performedBy: performedBy || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    await logAudit({
      action: "payment_initiate",
      provider: account.provider,
      bankAccountId: account.id,
      externalId: result.externalRequestId,
      amount: payment.amount,
      status: result.success ? "success" : "error",
      details: { result },
      performedBy: performedBy || "system",
    });
    return { account, result, dbPayment: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAudit({
      action: "payment_initiate",
      provider: account.provider,
      bankAccountId: account.id,
      amount: payment.amount,
      status: "error",
      details: { error: msg },
      performedBy: performedBy || "system",
    });
    throw err;
  }
}

export async function getPaymentStatusFromProvider(dbPaymentId: number, performedBy?: string) {
  const [row] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, dbPaymentId));
  if (!row) throw new Error(`Payment request ${dbPaymentId} not found`);
  if (!row.externalRequestId) throw new Error("No external request ID to check status");
  const { account, provider } = await getProviderForAccount(row.bankAccountId);
  const result = await provider.getPaymentStatus(row.externalRequestId);
  await db.update(paymentRequestsTable)
    .set({ status: result.status, externalTransactionId: result.externalTransactionId || row.externalTransactionId, updatedAt: new Date() })
    .where(eq(paymentRequestsTable.id, dbPaymentId));
  await logAudit({
    action: "payment_status",
    provider: account.provider,
    bankAccountId: account.id,
    externalId: row.externalRequestId,
    amount: result.amount ?? null,
    status: "success",
    details: { result },
    performedBy: performedBy || "system",
  });
  return result;
}

// ---- Webhooks --------------------------------------------------------------

export async function handleWebhook(
  providerName: string,
  rawBody: string,
  signature: string,
): Promise<{ verified: boolean; payload?: WebhookPayload; logId: number }> {
  const provider = await createProvider(providerName);
  let verified = false;
  let processingError: string | null = null;
  let payload: WebhookPayload | undefined;
  try {
    const v = await provider.verifyWebhook(rawBody, signature);
    verified = v.valid;
    if (verified) {
      payload = await provider.parseWebhookPayload(rawBody);
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err);
  }
  const [log] = await db.insert(webhookLogsTable).values({
    provider: providerName,
    eventType: payload?.eventType ?? null,
    payload: payload ?? null,
    rawBody,
    signatureValid: verified,
    processed: !!payload,
    processingError,
    createdAt: new Date(),
  }).returning();
  return { verified, payload, logId: log.id };
}

// ---- Reconciliation --------------------------------------------------------

export async function reconcileByUtr(utr: string, voucherId?: number, paymentId?: number, performedBy?: string) {
  const [txn] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.utr, utr));
  if (!txn) return null;
  await db.update(bankTransactionsTable)
    .set({
      reconciliationStatus: "matched",
      voucherId: voucherId ?? txn.voucherId,
      paymentId: paymentId ?? txn.paymentId,
    })
    .where(eq(bankTransactionsTable.id, txn.id));
  const [updated] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, txn.id));
  const { account } = await getProviderForAccount(txn.bankAccountId);
  await logAudit({
    action: "reconciliation",
    provider: account.provider,
    bankAccountId: txn.bankAccountId,
    externalId: txn.externalTransactionId,
    amount: parseFloat(String(txn.amount)),
    status: "success",
    details: { utr, voucherId, paymentId },
    performedBy: performedBy || "system",
  });
  return updated ?? txn;
}

export async function refreshAllBalances(performedBy?: string): Promise<{ accountId: number; balance: number | null; error?: string }[]> {
  const accounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.status, "active"));
  const results: { accountId: number; balance: number | null; error?: string }[] = [];
  for (const acct of accounts) {
    try {
      const { account, provider } = await getProviderForAccount(acct.id);
      const bal = await provider.getBalance(account.maskedAccountNumber);
      await logAudit({
        action: "balance_check", provider: account.provider, bankAccountId: account.id,
        status: "success", amount: bal.available, details: { balance: bal }, performedBy: performedBy || "system",
      });
      results.push({ accountId: acct.id, balance: bal.available });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logAudit({
        action: "balance_check", provider: acct.provider, bankAccountId: acct.id,
        status: "error", details: { error: msg }, performedBy: performedBy || "system",
      });
      results.push({ accountId: acct.id, balance: null, error: msg });
    }
  }
  return results;
}

export async function getUnreconciledTransactions(bankAccountId?: number, limit = 100) {
  const conditions = [eq(bankTransactionsTable.reconciliationStatus, "unreconciled")];
  if (bankAccountId) conditions.push(eq(bankTransactionsTable.bankAccountId, bankAccountId));
  return db.select().from(bankTransactionsTable).where(and(...conditions)).orderBy(desc(bankTransactionsTable.transactionDate)).limit(limit);
}

// ---- Day Close Integration -------------------------------------------------

export async function getDayCloseBankSummary(date: string, _performedBy?: string) {
  const accounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.status, "active"));
  const summary = [];
  for (const acct of accounts) {
    const { provider } = await getProviderForAccount(acct.id);
    try {
      const balance = await provider.getBalance(acct.maskedAccountNumber);
      const from = new Date(date);
      const to = new Date(date);
      to.setDate(to.getDate() + 1);
      const txs = await provider.getTransactions(acct.maskedAccountNumber, { fromDate: from, toDate: to });
      const credits = txs.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0);
      const debits = txs.filter((t) => t.type === "debit").reduce((s, t) => s + t.amount, 0);
      summary.push({
        accountId: acct.id,
        provider: acct.provider,
        bankName: acct.bankName,
        nickname: acct.accountNickname,
        balance: balance.available,
        credits,
        debits,
        net: credits - debits,
        transactionCount: txs.length,
      });
    } catch {
      summary.push({
        accountId: acct.id,
        provider: acct.provider,
        bankName: acct.bankName,
        nickname: acct.accountNickname,
        balance: null,
        credits: 0,
        debits: 0,
        net: 0,
        transactionCount: 0,
        error: "Could not fetch from provider",
      });
    }
  }
  return summary;
}
