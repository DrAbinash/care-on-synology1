import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { billsTable, paymentsTable, ordersTable, billAuditsTable, voucherAuditsTable } from "@workspace/db/schema";
import { sql, and, eq, gte, lt } from "drizzle-orm";
import { patientsTable } from "@workspace/db/schema";

import { todayIST } from "../lib/istDate";

export const dailySummaryRouter: IRouter = Router();

function dayBoundsIST(dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T00:00:00+05:30`),
    end: new Date(`${dateStr}T23:59:59.999+05:30`),
  };
}

dailySummaryRouter.get("/", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : todayIST();
  const staffName = typeof req.query.staffName === "string" ? req.query.staffName.trim() : "";

  const { start: dayStart, end: dayEnd } = dayBoundsIST(date);

  const paymentFilters = [gte(paymentsTable.createdAt, dayStart), lt(paymentsTable.createdAt, dayEnd)];
  if (staffName) paymentFilters.push(eq(paymentsTable.recordedByName, staffName));

  const allPaymentItems = await db
    .select({
      id: paymentsTable.id,
      billId: paymentsTable.billId,
      amount: paymentsTable.amount,
      method: paymentsTable.method,
      referenceNumber: paymentsTable.referenceNumber,
      recordedByName: paymentsTable.recordedByName,
      notes: paymentsTable.notes,
      createdAt: paymentsTable.createdAt,
    })
    .from(paymentsTable)
    .where(and(...paymentFilters))
    .orderBy(sql`${paymentsTable.createdAt} DESC`)
    .limit(500);

  const paymentItems = allPaymentItems.filter((p) => Number(p.amount) > 0);
  const refundItems = allPaymentItems.filter((p) => Number(p.amount) < 0);

  const billFilters = [gte(billsTable.createdAt, dayStart), lt(billsTable.createdAt, dayEnd)];
  if (staffName) billFilters.push(eq(billsTable.createdByName, staffName));

  const allBillRows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      discount: billsTable.discount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      createdByName: billsTable.createdByName,
      patientId: billsTable.patientId,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
    })
    .from(billsTable)
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(and(...billFilters))
    .orderBy(sql`${billsTable.createdAt} DESC`);

  const orderCount = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(and(gte(ordersTable.createdAt, dayStart), lt(ordersTable.createdAt, dayEnd)));

  const expenseRows = await db.execute<{ payment_mode: string; total: string }>(
    sql`SELECT payment_mode, COALESCE(SUM(amount::numeric), 0)::text AS total
        FROM expenses
        WHERE expense_date = ${date}
        GROUP BY payment_mode`
  );

  const allDuesResult = await db.execute<{ total: string }>(
    sql`SELECT COALESCE(SUM(balance_amount::numeric), 0)::text AS total
        FROM bills
        WHERE status IN ('pending','partial') AND balance_amount::numeric > 0`
  );
  const totalOutstandingDues = Number(allDuesResult.rows[0]?.total ?? 0);

  const activeBills = allBillRows.filter((r) => r.status !== "cancelled");
  const cancelledBills = allBillRows.filter((r) => r.status === "cancelled");

  const totalBilling = activeBills.reduce((s, r) => s + Number(r.totalAmount), 0);
  const outstanding = activeBills.reduce((s, r) => s + Math.max(0, Number(r.balanceAmount ?? 0)), 0);
  const totalRefunded = refundItems.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  const totalReceived = paymentItems.reduce((s, p) => s + Number(p.amount), 0);
  const digitalCollection = paymentItems.reduce((s, p) => {
    const m = (p.method ?? "other").toLowerCase();
    return s + (["upi", "card", "online", "bank", "cheque", "neft", "rtgs"].includes(m) ? Number(p.amount) : 0);
  }, 0);
  const cashCollection = totalReceived - digitalCollection;
  const expenses = expenseRows.rows.reduce((s, r) => s + Number(r.total), 0);
  const netCollection = totalBilling - outstanding - totalRefunded - cancelledBills.reduce((s, r) => s + Number(r.totalAmount), 0) - expenses;
  const physicalCashInHand = netCollection - digitalCollection;
  const refundsAndCancellations = totalRefunded + cancelledBills.reduce((s, r) => s + Number(r.totalAmount), 0);
  const discountsGiven = activeBills.reduce((s, r) => s + Number(r.discount ?? 0), 0);

  // ── Reconciliation: classify payments as new-billing vs old-dues ──────────
  // "Today's bills" = bills whose createdAt falls within this day's bounds.
  const todayBillIdSet = new Set(allBillRows.map((b) => b.id));

  // Old Dues Collected = payments today that belong to bills NOT created today
  const oldDuesCollected = paymentItems
    .filter((p) => p.billId !== null && !todayBillIdSet.has(p.billId!))
    .reduce((s, p) => s + Number(p.amount), 0);

  // New Billing Collected = payments today for bills created today
  const newBillingCollected = paymentItems
    .filter((p) => p.billId === null || todayBillIdSet.has(p.billId!))
    .reduce((s, p) => s + Number(p.amount), 0);

  // Backdated Refunds = refunds processed today where the linked bill is from a PRIOR day.
  // These are already included inside totalRefunded (no double-counting needed).
  // They are exposed for display/explanation purposes only.
  const backdatedRefunds = refundItems
    .filter((p) => p.billId !== null && !todayBillIdSet.has(p.billId!))
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);

  // Same-day refunds = refunds for bills also created today
  const sameDayRefunds = refundItems
    .filter((p) => p.billId === null || todayBillIdSet.has(p.billId!))
    .reduce((s, p) => s + Math.abs(Number(p.amount)), 0);

  // Expenses split by payment_mode: cash vs digital
  const cashExpenses = expenseRows.rows
    .filter((r) => (r.payment_mode ?? "cash").toLowerCase() === "cash")
    .reduce((s, r) => s + Number(r.total), 0);
  const digitalExpenses = expenses - cashExpenses;

  // Net Digital Collection = digital collected - digital refunds (digital refunds by method)
  const digitalRefunded = refundItems.reduce((s, p) => {
    const m = (p.method ?? "other").toLowerCase();
    return s + (["upi", "card", "online", "bank", "cheque", "neft", "rtgs"].includes(m) ? Math.abs(Number(p.amount)) : 0);
  }, 0);
  const netDigitalCollection = digitalCollection - digitalRefunded;

  const byMethod: Record<string, number> = {};
  for (const p of paymentItems) {
    const m = (p.method ?? "other").toLowerCase();
    byMethod[m] = (byMethod[m] ?? 0) + Number(p.amount);
  }

  const byRefundMethod: Record<string, number> = {};
  for (const p of refundItems) {
    const m = (p.method ?? "other").toLowerCase();
    byRefundMethod[m] = (byRefundMethod[m] ?? 0) + Math.abs(Number(p.amount));
  }

  const billsByStatus = {
    paid: activeBills.filter((r) => r.status === "paid").length,
    partial: activeBills.filter((r) => r.status === "partial").length,
    pending: activeBills.filter((r) => r.status === "pending").length,
    cancelled: cancelledBills.length,
  };

  type UserAgg = { userName: string; billCount: number; billed: number; received: number; methods: Record<string, number> };
  const byUserMap = new Map<string, UserAgg>();
  const ensureUser = (name: string | null | undefined): UserAgg => {
    const key = (name && name.trim()) || "Unknown User";
    let row = byUserMap.get(key);
    if (!row) {
      row = { userName: key, billCount: 0, billed: 0, received: 0, methods: {} };
      byUserMap.set(key, row);
    }
    return row;
  };

  for (const r of activeBills) {
    const fallbackName = paymentItems.find((p) => p.billId === r.id)?.recordedByName ?? null;
    const u = ensureUser(r.createdByName ?? fallbackName);
    u.billCount += 1;
    u.billed += Number(r.totalAmount);
  }

  for (const p of paymentItems) {
    const recorder = (p.recordedByName && p.recordedByName.trim()) ? p.recordedByName : (allBillRows.find((b) => b.id === p.billId)?.createdByName ?? null);
    const u = ensureUser(recorder);
    const amt = Number(p.amount);
    u.received += amt;
    const m = (p.method ?? "cash").toLowerCase();
    u.methods[m] = (u.methods[m] ?? 0) + amt;
  }

  const byUser = Array.from(byUserMap.values()).sort((a, b) => b.received - a.received);

  // ── Audit logs (bill + voucher edits within this day) ─────────────────
  const billAuditFilters = [gte(billAuditsTable.createdAt, dayStart), lt(billAuditsTable.createdAt, dayEnd)];
  if (staffName) billAuditFilters.push(eq(billAuditsTable.editedBy, staffName));
  const billEditsRaw = await db
    .select({
      id: billAuditsTable.id,
      billId: billAuditsTable.billId,
      editedBy: billAuditsTable.editedBy,
      reason: billAuditsTable.reason,
      changeType: billAuditsTable.changeType,
      oldValue: billAuditsTable.oldValue,
      newValue: billAuditsTable.newValue,
      createdAt: billAuditsTable.createdAt,
      billNumber: billsTable.billNumber,
      patientFirst: patientsTable.firstName,
      patientLast: patientsTable.lastName,
    })
    .from(billAuditsTable)
    .leftJoin(billsTable, eq(billAuditsTable.billId, billsTable.id))
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(and(...billAuditFilters))
    .orderBy(sql`${billAuditsTable.createdAt} DESC`)
    .limit(200);

  const voucherAuditFilters = [gte(voucherAuditsTable.createdAt, dayStart), lt(voucherAuditsTable.createdAt, dayEnd)];
  if (staffName) voucherAuditFilters.push(eq(voucherAuditsTable.editedBy, staffName));
  const voucherEditsRaw = await db
    .select()
    .from(voucherAuditsTable)
    .where(and(...voucherAuditFilters))
    .orderBy(sql`${voucherAuditsTable.createdAt} DESC`)
    .limit(200);

  res.json({
    date,
    staffName: staffName || null,
    summary: {
      totalBilling,
      outstanding,
      refundsAndCancellations,
      expenses,
      netCollection,
      digitalCollection,
      cashCollection,
      physicalCashInHand,
      discountsGiven,
      billCount: activeBills.length,
      orderCount: orderCount[0]?.count ?? 0,
      totalOutstandingDues,
      // Reconciliation fields (new, additive)
      newBillingCollected,
      oldDuesCollected,
      backdatedRefunds,
      sameDayRefunds,
      cashExpenses,
      digitalExpenses,
      netDigitalCollection,
      cancelledBillsAmount: cancelledBills.reduce((s, r) => s + Number(r.totalAmount), 0),
      totalRefunded,
    },
    byMethod,
    byRefundMethod,
    billsByStatus,
    byUser,
    totalExpense: expenses,
    grandTotal: physicalCashInHand,
    bills: allBillRows.map((r) => ({
      id: r.id,
      billNumber: r.billNumber,
      patientName: r.patientFirstName ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim() : "Unknown",
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      balanceAmount: Number(r.balanceAmount ?? 0),
      discount: Number(r.discount ?? 0),
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      createdByName: r.createdByName ?? "",
    })),
    payments: paymentItems.map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: Number(p.amount),
      method: p.method ?? "cash",
      referenceNumber: p.referenceNumber,
      recordedByName: p.recordedByName,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    })),
    refunds: refundItems.map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: Math.abs(Number(p.amount)),
      method: p.method ?? "cash",
      notes: p.notes,
      recordedByName: p.recordedByName,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    })),
    cancelledBillsDetail: cancelledBills.map((r) => ({
      id: r.id,
      billNumber: r.billNumber,
      patientName: r.patientFirstName ? `${r.patientFirstName} ${r.patientLastName ?? ""}`.trim() : "Unknown",
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      createdByName: r.createdByName ?? "",
    })),
    billEdits: billEditsRaw.map((r) => ({
      id: r.id,
      billId: r.billId,
      billNumber: r.billNumber ?? `#${r.billId}`,
      patientName: r.patientFirst ? `${r.patientFirst} ${r.patientLast ?? ""}`.trim() : "—",
      editedBy: r.editedBy,
      reason: r.reason,
      changeType: r.changeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
    voucherEdits: voucherEditsRaw.map((r) => ({
      id: r.id,
      voucherId: r.voucherId,
      voucherNumber: r.voucherNumber,
      editedBy: r.editedBy,
      reason: r.reason,
      changeType: r.changeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })),
  });
});
