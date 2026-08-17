// =============================================================================
// FraudDetectionEngine
//
// Continuous fraud detection for banking, billing, and payments.
// Rules run on scheduled intervals or after specific events.
// Alerts are stored in fraud_alerts table with severity grading.
//
// IMPORTANT: detectors must return the count of *newly inserted* alerts, not
// candidate matches. Cron logs that count; inflated "alerts raised" from
// false-positive rules (e.g. treating every bill older than 30 days as
// backdated, or treating QR/PDF counter bumps as invoice edits) caused noisy
// production alerts without corresponding fraud.
// =============================================================================

import { db } from "@workspace/db";
import {
  bankTransactionsTable, billsTable, paymentsTable,
  fraudAlertsTable, refundRequestsTable, userDayClosuresTable,
  reconciliationLogsTable,
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

/** Clinic local timezone for "unusual timing" (late-night) checks. */
export const CLINIC_TIME_ZONE = "Asia/Kolkata";

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

/** Hour of day (0–23) in the given IANA timezone. Exported for unit tests. */
export function hourInTimeZone(date: Date, timeZone: string = CLINIC_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "hour")?.value ?? "0";
  // Some engines emit "24" for midnight.
  const n = Number(raw);
  return n === 24 ? 0 : n;
}

/** True when clock is outside clinic business hours (22:00–04:59 local). */
export function isUnusualPaymentHour(date: Date, timeZone: string = CLINIC_TIME_ZONE): boolean {
  const hour = hourInTimeZone(date, timeZone);
  return hour >= 22 || hour < 5;
}

/**
 * Insert an alert unless an equivalent open/recent alert already exists (24h).
 * @returns true when a new row was inserted
 */
async function createAlert(payload: AlertPayload): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const conditions = [
    eq(fraudAlertsTable.alertType, payload.type),
    gte(fraudAlertsTable.createdAt, since),
  ];

  if (payload.billId != null) {
    conditions.push(eq(fraudAlertsTable.billId, payload.billId));
  }
  if (payload.paymentId != null) {
    conditions.push(eq(fraudAlertsTable.paymentId, payload.paymentId));
  }
  if (payload.bankTransactionId != null) {
    conditions.push(eq(fraudAlertsTable.bankTransactionId, payload.bankTransactionId));
  }
  // Entity-less alerts (e.g. duplicate UTR) dedupe on title so distinct UTRs
  // still raise separate alerts within the window.
  if (payload.billId == null && payload.paymentId == null && payload.bankTransactionId == null) {
    conditions.push(eq(fraudAlertsTable.title, payload.title));
  }

  const existing = await db
    .select({ id: fraudAlertsTable.id })
    .from(fraudAlertsTable)
    .where(and(...conditions))
    .limit(1);

  if (existing.length > 0) return false;

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
  return true;
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

    const inserted = await createAlert({
      type: "duplicate_utr",
      severity: "critical",
      title: `Duplicate UTR detected: ${row.utr}`,
      description: `UTR ${row.utr} appears ${row.cnt} times across bank transactions. Possible duplicate payment or fraud.`,
      affectedAmount: txns.reduce((s, t) => s + Number(t.amount), 0),
      evidence: { utr: row.utr, transactionIds: txns.map((t) => t.id), count: row.cnt },
    });
    if (inserted) alerts++;
  }
  return alerts;
}

// ── Rule 2: Invoice reduced after collection ────────────────────────────────
//
// Do NOT use bills.updatedAt — QR scans, PDF downloads, receipt verification,
// and paidAmount syncs all bump updatedAt via $onUpdate and are not fraud.
// Signal: current total is materially below amount already collected.
export async function detectInvoiceEditedAfterPayment(): Promise<number> {
  const bills = await db
    .select()
    .from(billsTable)
    .where(and(
      sql`${billsTable.paidAmount} > 0`,
      sql`${billsTable.status} != 'cancelled'`,
      sql`CAST(${billsTable.totalAmount} AS numeric) + 0.01 < CAST(${billsTable.paidAmount} AS numeric)`,
    ));

  let alerts = 0;
  for (const bill of bills) {
    const paidAmount = Number(bill.paidAmount);
    const totalAmount = Number(bill.totalAmount);
    const inserted = await createAlert({
      type: "invoice_edited_after_payment",
      severity: "high",
      title: `Bill #${bill.billNumber} total below collections`,
      description: `Bill total ₹${totalAmount} is below paid ₹${paidAmount}. Invoice may have been reduced after payment.`,
      billId: bill.id,
      affectedAmount: paidAmount - totalAmount,
      evidence: {
        totalAmount,
        paidAmount,
        originalTotal: bill.originalTotal,
        billUpdatedAt: bill.updatedAt,
      },
    });
    if (inserted) alerts++;
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
    const inserted = await createAlert({
      type: "bill_deleted_after_collection",
      severity: "critical",
      title: `Cancelled bill had collections: ${bill.billNumber}`,
      description: `Bill ${bill.billNumber} was cancelled but had ₹${bill.paidAmount} in payments. Check if refund was issued.`,
      billId: bill.id,
      affectedAmount: Number(bill.paidAmount),
      evidence: { billNumber: bill.billNumber, paidAmount: bill.paidAmount, cancelledAt: bill.cancelledAt, cancelledBy: bill.cancelledByName },
    });
    if (inserted) alerts++;
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
    const inserted = await createAlert({
      type: "refund_without_approval",
      severity: "critical",
      title: `Refund completed without approval: ₹${refund.amount}`,
      description: `Refund request #${refund.id} for bill #${refund.billId} was marked completed but lacks supervisor approval.`,
      billId: refund.billId,
      paymentId: refund.paymentId,
      affectedAmount: Number(refund.amount),
      evidence: { refundId: refund.id, requestedBy: refund.requestedBy, completedAt: refund.completedAt, completedBy: refund.completedBy },
    });
    if (inserted) alerts++;
  }
  return alerts;
}

// ── Rule 5: Collection mismatch (payments sum != bill paidAmount) ─────────────
// Scoped to recent bills so cron does not full-scan historic ledgers every 30m.
export async function detectCollectionMismatch(): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const bills = await db
    .select()
    .from(billsTable)
    .where(and(
      sql`${billsTable.status} != 'cancelled'`,
      gte(billsTable.updatedAt, since),
    ));

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
      const inserted = await createAlert({
        type: "collection_mismatch",
        severity: "high",
        title: `Payment sum mismatch for bill ${bill.billNumber}`,
        description: `Bill paidAmount=₹${paidAmount} but sum of payment rows=₹${paymentSum} (diff=₹${diff.toFixed(2)}).`,
        billId: bill.id,
        affectedAmount: diff,
        evidence: { paidAmount, paymentSum, diff, paymentIds: payments.map((p) => p.id) },
      });
      if (inserted) alerts++;
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
    const inserted = await createAlert({
      type: "shift_mismatch",
      severity: "medium",
      title: `Drawer variance > ₹100 for ${c.userName}`,
      description: `User day close on ${c.closureDate} had variance of ₹${c.variance} (${c.drawerStatus}).`,
      userId: c.userId ?? undefined,
      userName: c.userName,
      affectedAmount: Math.abs(Number(c.variance)),
      evidence: { closureId: c.id, variance: c.variance, drawerStatus: c.drawerStatus, expected: c.totalExpected, actual: c.totalActual },
    });
    if (inserted) alerts++;
  }
  return alerts;
}

// ── Rule 7: Future-dated bill/payment timestamps ────────────────────────────
//
// Historical bills older than 30 days are NORMAL — do not alert on age alone.
// Flag only rows whose createdAt is materially in the future (clock skew /
// manual timestamp tampering).
export async function detectBackdatedEdits(): Promise<number> {
  const tooFuture = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes ahead

  const suspiciousBills = await db
    .select()
    .from(billsTable)
    .where(and(
      sql`${billsTable.createdAt} > ${tooFuture}`,
      sql`${billsTable.status} != 'cancelled'`,
    ))
    .limit(50);

  const suspiciousPayments = await db
    .select()
    .from(paymentsTable)
    .where(sql`${paymentsTable.createdAt} > ${tooFuture}`)
    .limit(50);

  let alerts = 0;
  for (const bill of suspiciousBills) {
    const inserted = await createAlert({
      type: "backdated_edit",
      severity: "medium",
      title: `Future-dated bill: ${bill.billNumber}`,
      description: `Bill createdAt ${bill.createdAt?.toISOString?.() ?? bill.createdAt} is in the future. Possible clock skew or timestamp tampering.`,
      billId: bill.id,
      affectedAmount: Number(bill.totalAmount),
      evidence: { createdAt: bill.createdAt, billNumber: bill.billNumber },
    });
    if (inserted) alerts++;
  }
  for (const p of suspiciousPayments) {
    const inserted = await createAlert({
      type: "backdated_edit",
      severity: "medium",
      title: `Future-dated payment #${p.id}`,
      description: `Payment createdAt ${p.createdAt?.toISOString?.() ?? p.createdAt} is in the future. Possible clock skew or timestamp tampering.`,
      billId: p.billId,
      paymentId: p.id,
      affectedAmount: Number(p.amount),
      evidence: { createdAt: p.createdAt, paymentId: p.id },
    });
    if (inserted) alerts++;
  }
  return alerts;
}

// ── Rule 8: Multiple manual overrides on same bank transaction ──────────────
export async function detectMultipleManualOverrides(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      bankTransactionId: reconciliationLogsTable.bankTransactionId,
      cnt: count(),
    })
    .from(reconciliationLogsTable)
    .where(and(
      eq(reconciliationLogsTable.matchStrategy, "manual"),
      gte(reconciliationLogsTable.createdAt, since),
    ))
    .groupBy(reconciliationLogsTable.bankTransactionId)
    .having(sql`count(*) > 1`);

  let alerts = 0;
  for (const row of rows) {
    if (!row.bankTransactionId) continue;
    const inserted = await createAlert({
      type: "multiple_manual_overrides",
      severity: "high",
      title: `Multiple manual overrides on bank txn #${row.bankTransactionId}`,
      description: `Bank transaction #${row.bankTransactionId} has been manually reconciled ${row.cnt} times in 7 days. Possible manipulation.`,
      bankTransactionId: row.bankTransactionId,
      evidence: { bankTransactionId: row.bankTransactionId, overrideCount: row.cnt },
    });
    if (inserted) alerts++;
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
    const inserted = await createAlert({
      type: "suspicious_amount",
      severity: "medium",
      title: `Large payment detected: ₹${p.amount}`,
      description: `Payment #${p.id} for bill #${p.billId} exceeds ₹50,000. Verify legitimacy.`,
      billId: p.billId,
      paymentId: p.id,
      affectedAmount: Number(p.amount),
      evidence: { paymentId: p.id, amount: p.amount, method: p.method, recordedBy: p.recordedByName },
    });
    if (inserted) alerts++;
  }
  return alerts;
}

// ── Rule 10: Unusual timing (clinic-local late night: 10 PM - 5 AM) ─────────
export async function detectUnusualTiming(): Promise<number> {
  const since = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(gte(paymentsTable.createdAt, since));

  let alerts = 0;
  for (const p of payments) {
    if (!isUnusualPaymentHour(new Date(p.createdAt))) continue;
    const hour = hourInTimeZone(new Date(p.createdAt));
    const inserted = await createAlert({
      type: "unusual_timing",
      severity: "low",
      title: `Late-night payment at ${hour}:00 ${CLINIC_TIME_ZONE}`,
      description: `Payment #${p.id} recorded at ${hour}:00 clinic local time. Verify if staff was on duty.`,
      billId: p.billId,
      paymentId: p.id,
      affectedAmount: Number(p.amount),
      evidence: { paymentId: p.id, hour, timeZone: CLINIC_TIME_ZONE, recordedBy: p.recordedByName },
    });
    if (inserted) alerts++;
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
