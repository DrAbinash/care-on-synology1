// =============================================================================
// ReconciliationEngine
//
// Enterprise-grade auto-reconciliation engine with confidence scoring.
// Match bank transactions to ERP bills/payments using multiple strategies.
// Auto-close dues above configurable confidence threshold (default 80%).
// =============================================================================

import { db } from "@workspace/db";
import {
  bankTransactionsTable, billsTable, paymentsTable,
  reconciliationLogsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, isNull, sql, desc } from "drizzle-orm";

export type MatchStrategy =
  | "exact_utr"
  | "exact_invoice_ref"
  | "exact_amount_time"
  | "mobile_amount"
  | "patient_id_amount"
  | "manual"
  | "none";

interface MatchResult {
  bankTransactionId: number;
  billId: number | null;
  paymentId: number | null;
  confidenceScore: number;
  strategy: MatchStrategy;
  matchedFields: string[];
  differences?: Record<string, { expected: unknown; actual: unknown }>;
}

interface ReconcileOptions {
  fromDate?: Date;
  toDate?: Date;
  autoCloseThreshold?: number; // default 80
  performedBy?: string;
}

const STRATEGY_SCORES: Record<MatchStrategy, number> = {
  exact_utr: 100,
  exact_invoice_ref: 90,
  exact_amount_time: 80,
  mobile_amount: 70,
  patient_id_amount: 60,
  manual: 100,
  none: 0,
};

/**
 * Reconcile a single unreconciled bank transaction against all candidate bills/payments.
 */
export async function reconcileSingleTransaction(
  bankTxnId: number,
  options?: { autoCloseThreshold?: number; performedBy?: string },
): Promise<MatchResult | null> {
  const [bankTxn] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTxnId));
  if (!bankTxn) return null;
  if (bankTxn.reconciliationStatus !== "unreconciled") return null;

  // Fetch candidate payments in a +/- 3 day window around the transaction date
  const txnDate = new Date(bankTxn.transactionDate);
  const from = new Date(txnDate); from.setDate(from.getDate() - 3);
  const to = new Date(txnDate); to.setDate(to.getDate() + 3);

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(and(
      gte(paymentsTable.createdAt, from),
      lte(paymentsTable.createdAt, to),
    ));

  const bills = await db
    .select()
    .from(billsTable)
    .where(and(
      gte(billsTable.createdAt, from),
      lte(billsTable.createdAt, to),
      sql`${billsTable.status} != 'cancelled'`,
    ));

  let bestMatch: MatchResult | null = null;

  // Strategy 1: Exact UTR match against payment referenceNumber or bill billNumber
  if (bankTxn.utr) {
    for (const p of payments) {
      if (p.referenceNumber && p.referenceNumber.trim() === bankTxn.utr.trim()) {
        const score = STRATEGY_SCORES.exact_utr;
        if (!bestMatch || score > bestMatch.confidenceScore) {
          bestMatch = {
            bankTransactionId: bankTxn.id,
            billId: p.billId,
            paymentId: p.id,
            confidenceScore: score,
            strategy: "exact_utr",
            matchedFields: ["utr", "referenceNumber"],
          };
        }
      }
    }
  }

  // Strategy 2: Exact invoice/bill number in description
  if (!bestMatch && bankTxn.description) {
    const billNumberMatch = bankTxn.description.match(/(?:BILL|INV|ORDER)[\s-]*(\d+)/i);
    if (billNumberMatch) {
      const refNum = billNumberMatch[1];
      const matchedBill = bills.find((b) => b.billNumber.includes(refNum));
      if (matchedBill) {
        const billPayments = payments.filter((p) => p.billId === matchedBill.id);
        const p = billPayments[0];
        if (p) {
          bestMatch = {
            bankTransactionId: bankTxn.id,
            billId: matchedBill.id,
            paymentId: p.id,
            confidenceScore: STRATEGY_SCORES.exact_invoice_ref,
            strategy: "exact_invoice_ref",
            matchedFields: ["billNumber", "description"],
          };
        }
      }
    }
  }

  // Strategy 3: Exact amount + time proximity
  if (!bestMatch) {
    const txnAmount = Number(bankTxn.amount);
    for (const p of payments) {
      const pAmt = Number(p.amount);
      // Within 1% amount tolerance and 30 minutes time difference
      const amountDiff = Math.abs(txnAmount - pAmt);
      const amountTolerance = Math.max(txnAmount * 0.01, 1);
      const timeDiff = Math.abs(new Date(p.createdAt).getTime() - txnDate.getTime());
      if (amountDiff <= amountTolerance && timeDiff <= 30 * 60 * 1000) {
        const score = STRATEGY_SCORES.exact_amount_time;
        if (!bestMatch || score > bestMatch.confidenceScore) {
          bestMatch = {
            bankTransactionId: bankTxn.id,
            billId: p.billId,
            paymentId: p.id,
            confidenceScore: score,
            strategy: "exact_amount_time",
            matchedFields: ["amount", "time"],
            differences: { amount: { expected: pAmt, actual: txnAmount }, timeMs: { expected: 0, actual: timeDiff } },
          };
        }
      }
    }
  }

  // Strategy 4: Mobile number in description + amount
  if (!bestMatch && bankTxn.description) {
    const phoneMatch = bankTxn.description.match(/\b(?:\+91)?(\d{10})\b/);
    if (phoneMatch) {
      const phone = phoneMatch[1];
      // Look for payments with notes containing the phone number
      for (const p of payments) {
        if (p.notes?.includes(phone)) {
          const pAmt = Number(p.amount);
          const txnAmount = Number(bankTxn.amount);
          const amountDiff = Math.abs(txnAmount - pAmt);
          const amountTolerance = Math.max(txnAmount * 0.05, 1);
          if (amountDiff <= amountTolerance) {
            const score = STRATEGY_SCORES.mobile_amount;
            if (!bestMatch || score > bestMatch.confidenceScore) {
              bestMatch = {
                bankTransactionId: bankTxn.id,
                billId: p.billId,
                paymentId: p.id,
                confidenceScore: score,
                strategy: "mobile_amount",
                matchedFields: ["mobile", "amount"],
              };
            }
          }
        }
      }
    }
  }

  // If we found a match, record it
  if (bestMatch) {
    const threshold = options?.autoCloseThreshold ?? 80;
    const autoClose = bestMatch.confidenceScore >= threshold;

    await db.insert(reconciliationLogsTable).values({
      bankTransactionId: bestMatch.bankTransactionId,
      billId: bestMatch.billId,
      paymentId: bestMatch.paymentId,
      confidenceScore: bestMatch.confidenceScore,
      matchStrategy: bestMatch.strategy,
      status: autoClose ? "auto_matched" : "pending",
      autoClosed: autoClose,
      autoClosedAmount: autoClose ? String(bankTxn.amount) : null,
      matchMetadata: {
        matchedFields: bestMatch.matchedFields,
        differences: bestMatch.differences ?? null,
        algorithmVersion: "v1.0",
        performedBy: options?.performedBy || "system",
      },
      createdAt: new Date(),
    });

    // Update bank transaction status
    await db.update(bankTransactionsTable)
      .set({
        reconciliationStatus: autoClose ? "matched" : "unreconciled",
        paymentId: bestMatch.paymentId ?? null,
      })
      .where(eq(bankTransactionsTable.id, bestMatch.bankTransactionId));

    // Auto-close dues on the bill if high-confidence
    if (autoClose && bestMatch.billId) {
      const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, bestMatch.billId));
      if (bill && bill.status === "pending" || bill.status === "partial") {
        const paidSoFar = Number(bill.paidAmount);
        const txnAmt = Number(bankTxn.amount);
        const newPaid = paidSoFar + txnAmt;
        const total = Number(bill.totalAmount);
        const newStatus = newPaid >= total ? "paid" : "partial";
        const newBalance = Math.max(0, total - newPaid);
        await db.update(billsTable)
          .set({
            paidAmount: String(newPaid),
            balanceAmount: String(newBalance),
            status: newStatus,
          })
          .where(eq(billsTable.id, bestMatch.billId));
      }
    }
  } else {
    // Record a failed reconciliation attempt
    await db.insert(reconciliationLogsTable).values({
      bankTransactionId: bankTxn.id,
      confidenceScore: 0,
      matchStrategy: "none",
      status: "failed",
      reviewReason: "No matching bill or payment found",
      matchMetadata: { algorithmVersion: "v1.0", performedBy: options?.performedBy || "system" },
      createdAt: new Date(),
    });
  }

  return bestMatch;
}

/**
 * Batch reconcile all unreconciled transactions.
 */
export async function batchReconcile(options?: ReconcileOptions): Promise<{
  processed: number;
  matched: number;
  autoClosed: number;
  failed: number;
  details: MatchResult[];
}> {
  const from = options?.fromDate;
  const to = options?.toDate;

  const conditions = [eq(bankTransactionsTable.reconciliationStatus, "unreconciled")];
  if (from) conditions.push(gte(bankTransactionsTable.transactionDate, from));
  if (to) conditions.push(lte(bankTransactionsTable.transactionDate, to));

  const txns = await db
    .select()
    .from(bankTransactionsTable)
    .where(and(...conditions))
    .orderBy(desc(bankTransactionsTable.transactionDate))
    .limit(500);

  let matched = 0;
  let autoClosed = 0;
  let failed = 0;
  const details: MatchResult[] = [];

  for (const txn of txns) {
    const result = await reconcileSingleTransaction(txn.id, {
      autoCloseThreshold: options?.autoCloseThreshold,
      performedBy: options?.performedBy,
    });
    if (result) {
      matched++;
      details.push(result);
      if (result.confidenceScore >= (options?.autoCloseThreshold ?? 80)) autoClosed++;
    } else {
      failed++;
    }
  }

  return { processed: txns.length, matched, autoClosed, failed, details };
}

/**
 * Manual reconcile a bank transaction with a specific bill or payment.
 */
export async function manualReconcile(
  bankTransactionId: number,
  billId?: number,
  paymentId?: number,
  voucherId?: number,
  performedBy?: string,
): Promise<boolean> {
  const [txn] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, bankTransactionId));
  if (!txn) return false;

  await db.insert(reconciliationLogsTable).values({
    bankTransactionId,
    billId: billId ?? null,
    paymentId: paymentId ?? null,
    voucherId: voucherId ?? null,
    confidenceScore: 100,
    matchStrategy: "manual",
    status: "manual_matched",
    resolvedBy: performedBy || "staff",
    resolvedAt: new Date(),
    matchMetadata: { algorithmVersion: "v1.0", performedBy: performedBy || "staff" },
    createdAt: new Date(),
  });

  await db.update(bankTransactionsTable)
    .set({
      reconciliationStatus: "matched",
      paymentId: paymentId ?? txn.paymentId ?? null,
      voucherId: voucherId ?? txn.voucherId ?? null,
    })
    .where(eq(bankTransactionsTable.id, bankTransactionId));

  return true;
}
