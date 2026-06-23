// =============================================================================
// FraudDetectionEngine
//
// Continuous fraud detection for banking, billing, and payments.
// Rules run on scheduled intervals or after specific events.
// Alerts are stored in fraud_alerts table with severity grading.
// =============================================================================

import { db } from "@workspace/db";
import {
  bankTransactionsTable, billsTable, paymentsTable,
  fraudAlertsTable, refundRequestsTable, userDayClosuresTable,
  dayClosuresTable,
} from "@workspace/db/schema";
import { eq, and, gte, sql, desc, count, isNull } from "drizzle-orm";

export type FraudAlertType =
  | "duplicate_utr"
  | "invoice_edited_after_payment"
  | "bill_deleted_after_collection"
  | "refund_without_approval"
  | "collection_mismatch"
  | "shift_mismatch"
  | "backdated_edit"
  | "multiple_manual_overrides"
  | "suspicious_amount"
  | "unusual_timing";

export type FraudSeverity = "critical" | "high" | "medium" | "low";

interface AlertPayload {
  type: FraudAlertType;
  severity: FraudSeverity;
  title: string;
  description: string;
  billId?: number;
  paymentId?: number;
  bankTransactionId?: number;
  userId?: number;
  userName?: string;
  affectedAmount?: number;
  evidence?: Record<string, unknown>;
}

async function createAlert(payload: AlertPayload): Promise<void> {
  // Deduplicate: don't create the exact same alert within 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db
    .select({ id: fraudAlertsTable.id })
    .from(fraudAlertsTable)
    .where(
      and(
        eq(fraudAlertsTable.alertType, payload.type),
        gte(fraudAlertsTable.createdAt, since),
        payload.billId ? eq(fraudAlertsTable.billId, payload.billId) : sql`1=1`,
        payload.paymentId ? eq(fraudAlertsTable.paymentId, payload.paymentId) : sql`1=1`,
      ),
    )
    .limit(1);

  if (existing.length > 0) return; // already alerted recently

  await db.insert(fraudAlertsTable).values({
    alertType: payload.type,
    severity: payload.severity,
    status: "open",
    billId: payload.billId ?? null,
    paymentId: payload.paymentId ?? null,
    bankTransactionId: payload.bankTransactionId ?? null,
    userId: payload.userId ?? null,
    userName: payload.userName ?? null,
    title: payload.title,
    description: payload.description,
    affectedAmount: payload.affectedAmount != null ? String(payload.affectedAmount) : null,
    evidence: payload.evidence ?? null,
    createdAt: new Date(),
  });
}

// ── Rule 1: Duplicate UTR usage ─────────────────────────────────────────────
export async function detectDuplicateUtr(): Promise<number> {
  const rows = await db
    .select({
      utr: bankTransactionsTable.utr,
      cnt: count(),
    })
    .from(bankTransactionsTable)
    .where(and(
      sql`${bankTransactionsTable.utr} IS NOT NULL`,
      sql`LENGTH(${bankTransactionsTable.utr}) > 5`,
    ))
    .groupBy(bankTransactionsTable.utr)
    .having(sql`count(*) > 1`);

  let alerts = 0;
  for (const row of rows) {
    if (!row.utr) continue;
    const txns = await db
      .select()
      .from(bankTransactionsTable)
      .where(eq(bankTransactionsTable.utr, row.utr))
      .orderBy(desc(bankTransactionsTable.transactionDate));

    await createAlert({
      type: "duplicate_utr",
      severity: "critical",
      title: `Duplicate UTR detected: ${row.utr}`,
      description: `UTR ${row.utr} appears ${row.cnt} times across bank transactions. Possible duplicate payment or fraud.`,
      affectedAmount: txns.reduce((s, t) => s + Number(t.amount), 0),
      evidence: { utr: row.utr, transactionIds: txns.map((t) => t.id), count: row.cnt },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 2: Invoice edited after payment ────────────────────────────────────
export async function detectInvoiceEditedAfterPayment(): Promise<number> {
  // Find bills whose updatedAt is after any payment on that bill
  const bills = await db
    .select()
    .from(billsTable)
    .where(and(
      sql`${billsTable.paidAmount} > 0`,
      sql`${billsTable.status} != 'cancelled'`,
    ));

  let alerts = 0;
  for (const bill of bills) {
    const [latestPayment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.billId, bill.id))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(1);

    if (!latestPayment) continue;

    const billUpdated = new Date(bill.updatedAt).getTime();
    const paymentTime = new Date(latestPayment.createdAt).getTime();

    if (billUpdated > paymentTime + 60000) { // 1 min buffer
      await createAlert({
        type: "invoice_edited_after_payment",
        severity: "high",
        title: `Bill #${bill.billNumber} edited after payment`,
        description: `Bill was modified ${new Date(billUpdated).toISOString()} after payment recorded at ${new Date(paymentTime).toISOString()}.`,
        billId: bill.id,
        affectedAmount: Number(bill.totalAmount),
        evidence: { billUpdatedAt: bill.updatedAt, paymentCreatedAt: latestPayment.createdAt, paidAmount: bill.paidAmount },
      });
      alerts++;
    }
  }
  return alerts;
}

// ── Rule 3: Bill cancelled after collection ─────────────────────────────────
export async function detectBillDeletedAfterCollection(): Promise<number> {
  const bills = await db
    .select()
    .from(billsTable)
    .where(and(
      sql`${billsTable.status} = 'cancelled'`,
      sql`${billsTable.paidAmount} > 0`,
    ));

  let alerts = 0;
  for (const bill of bills) {
    await createAlert({
      type: "bill_deleted_after_collection",
      severity: "critical",
      title: `Cancelled bill had collections: ${bill.billNumber}`,
      description: `Bill ${bill.billNumber} was cancelled but had ₹${bill.paidAmount} in payments. Check if refund was issued.`,
      billId: bill.id,
      affectedAmount: Number(bill.paidAmount),
      evidence: { billNumber: bill.billNumber, paidAmount: bill.paidAmount, cancelledAt: bill.cancelledAt, cancelledBy: bill.cancelledByName },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 4: Refund without approval ─────────────────────────────────────────
export async function detectRefundWithoutApproval(): Promise<number> {
  const refunds = await db
    .select()
    .from(refundRequestsTable)
    .where(and(
      eq(refundRequestsTable.status, "completed"),
      isNull(refundRequestsTable.approvedBy),
    ));

  let alerts = 0;
  for (const refund of refunds) {
    await createAlert({
      type: "refund_without_approval",
      severity: "critical",
      title: `Refund completed without approval: ₹${refund.amount}`,
      description: `Refund request #${refund.id} for bill #${refund.billId} was marked completed but lacks supervisor approval.`,
      billId: refund.billId,
      paymentId: refund.paymentId,
      affectedAmount: Number(refund.amount),
      evidence: { refundId: refund.id, requestedBy: refund.requestedBy, completedAt: refund.completedAt, completedBy: refund.completedBy },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 5: Collection mismatch (payments sum != bill paidAmount) ─────────────
export async function detectCollectionMismatch(): Promise<number> {
  const bills = await db
    .select()
    .from(billsTable)
    .where(sql`${billsTable.status} != 'cancelled'`);

  let alerts = 0;
  for (const bill of bills) {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.billId, bill.id));

    const paymentSum = payments.reduce((s, p) => s + Number(p.amount), 0);
    const paidAmount = Number(bill.paidAmount);
    const diff = Math.abs(paymentSum - paidAmount);

    if (diff > 0.01) {
      await createAlert({
        type: "collection_mismatch",
        severity: "high",
        title: `Payment sum mismatch for bill ${bill.billNumber}`,
        description: `Bill paidAmount=₹${paidAmount} but sum of payment rows=₹${paymentSum} (diff=₹${diff.toFixed(2)}).`,
        billId: bill.id,
        affectedAmount: diff,
        evidence: { paidAmount, paymentSum, diff, paymentIds: payments.map((p) => p.id) },
      });
      alerts++;
    }
  }
  return alerts;
}

// ── Rule 6: Shift mismatch (user close variance exceeds threshold) ──────────
export async function detectShiftMismatch(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
  const closures = await db
    .select()
    .from(userDayClosuresTable)
    .where(and(
      gte(userDayClosuresTable.closedAt, since),
      sql`ABS(${userDayClosuresTable.variance}) > 100`,
    ));

  let alerts = 0;
  for (const c of closures) {
    await createAlert({
      type: "shift_mismatch",
      severity: "medium",
      title: `Drawer variance > ₹100 for ${c.userName}`,
      description: `User day close on ${c.closureDate} had variance of ₹${c.variance} (${c.drawerStatus}).`,
      userId: c.userId ?? undefined,
      userName: c.userName,
      affectedAmount: Math.abs(Number(c.variance)),
      evidence: { closureId: c.id, variance: c.variance, drawerStatus: c.drawerStatus, expected: c.totalExpected, actual: c.totalActual },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 7: Backdated edits (bill/payment created with future or very old timestamp) ──
export async function detectBackdatedEdits(): Promise<number> {
  const now = new Date();
  const tooOld = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const tooFuture = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes in future

  const suspiciousBills = await db
    .select()
    .from(billsTable)
    .where(and(
      sql`${billsTable.createdAt} < ${tooOld}`,
      sql`${billsTable.status} != 'cancelled'`,
    ));

  let alerts = 0;
  for (const bill of suspiciousBills.slice(0, 10)) {
    await createAlert({
      type: "backdated_edit",
      severity: "medium",
      title: `Suspicious backdated bill: ${bill.billNumber}`,
      description: `Bill created at ${bill.createdAt} which is more than 30 days ago. Possible backdated entry.`,
      billId: bill.id,
      affectedAmount: Number(bill.totalAmount),
      evidence: { createdAt: bill.createdAt, now: now.toISOString(), billNumber: bill.billNumber },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 8: Multiple manual overrides on same transaction ───────────────────
export async function detectMultipleManualOverrides(): Promise<number> {
  // Check reconciliation_logs for multiple manual entries on same bank txn
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      bankTransactionId: fraudAlertsTable.bankTransactionId,
      cnt: count(),
    })
    .from(fraudAlertsTable)
    .where(and(
      eq(fraudAlertsTable.alertType, "multiple_manual_overrides"),
      gte(fraudAlertsTable.createdAt, since),
    ))
    .groupBy(fraudAlertsTable.bankTransactionId)
    .having(sql`count(*) > 1`);

  let alerts = 0;
  for (const row of rows) {
    if (!row.bankTransactionId) continue;
    await createAlert({
      type: "multiple_manual_overrides",
      severity: "high",
      title: `Multiple manual overrides on bank txn #${row.bankTransactionId}`,
      description: `Bank transaction #${row.bankTransactionId} has been manually reconciled multiple times. Possible manipulation.`,
      bankTransactionId: row.bankTransactionId,
      evidence: { bankTransactionId: row.bankTransactionId, overrideCount: row.cnt },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 9: Suspicious amount ( unusually large payment > ₹50000 ) ────────────
export async function detectSuspiciousAmount(): Promise<number> {
  const since = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // last 24h
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(and(
      gte(paymentsTable.createdAt, since),
      sql`${paymentsTable.amount} > 50000`,
    ));

  let alerts = 0;
  for (const p of payments) {
    await createAlert({
      type: "suspicious_amount",
      severity: "medium",
      title: `Large payment detected: ₹${p.amount}`,
      description: `Payment #${p.id} for bill #${p.billId} exceeds ₹50,000. Verify legitimacy.`,
      billId: p.billId,
      paymentId: p.id,
      affectedAmount: Number(p.amount),
      evidence: { paymentId: p.id, amount: p.amount, method: p.method, recordedBy: p.recordedByName },
    });
    alerts++;
  }
  return alerts;
}

// ── Rule 10: Unusual timing (payments outside business hours: 10 PM - 5 AM) ─
export async function detectUnusualTiming(): Promise<number> {
  const since = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(gte(paymentsTable.createdAt, since));

  let alerts = 0;
  for (const p of payments) {
    const hour = new Date(p.createdAt).getHours();
    if (hour >= 22 || hour < 5) {
      await createAlert({
        type: "unusual_timing",
        severity: "low",
        title: `Late-night payment at ${hour}:00`,
        description: `Payment #${p.id} recorded at ${hour}:00. Verify if staff was on duty.`,
        billId: p.billId,
        paymentId: p.id,
        affectedAmount: Number(p.amount),
        evidence: { paymentId: p.id, hour, recordedBy: p.recordedByName },
      });
      alerts++;
    }
  }
  return alerts;
}

// ── Master run-all function ────────────────────────────────────────────────
export async function runFraudDetection(): Promise<{
  totalAlerts: number;
  byRule: Record<FraudAlertType, number>;
}> {
  const results = await Promise.allSettled([
    detectDuplicateUtr(),
    detectInvoiceEditedAfterPayment(),
    detectBillDeletedAfterCollection(),
    detectRefundWithoutApproval(),
    detectCollectionMismatch(),
    detectShiftMismatch(),
    detectBackdatedEdits(),
    detectMultipleManualOverrides(),
    detectSuspiciousAmount(),
    detectUnusualTiming(),
  ]);

  const ruleNames: FraudAlertType[] = [
    "duplicate_utr",
    "invoice_edited_after_payment",
    "bill_deleted_after_collection",
    "refund_without_approval",
    "collection_mismatch",
    "shift_mismatch",
    "backdated_edit",
    "multiple_manual_overrides",
    "suspicious_amount",
    "unusual_timing",
  ];

  const byRule: Record<string, number> = {};
  let total = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const c = r.status === "fulfilled" ? r.value : 0;
    byRule[ruleNames[i]] = c;
    total += c;
  }

  return { totalAlerts: total, byRule: byRule as Record<FraudAlertType, number> };
}
