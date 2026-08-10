import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  billsTable, paymentsTable, ordersTable, billAuditsTable, voucherAuditsTable,
  orderTestsTable, testsTable,
} from "@workspace/db/schema";
import { sql, and, eq, gte, lt, ne, isNull, or, isNotNull, notInArray } from "drizzle-orm";
import { patientsTable } from "@workspace/db/schema";

import { todayIST } from "../lib/istDate";
import { classifyPaymentMethod, isDigitalSettlement, isPhysicalCash } from "../lib/paymentMethodClassifier";
import { BILL_AUDIT_OPERATIONAL_CHANGE_TYPES } from "../lib/staffActivityAttribution";

export const dailySummaryRouter: IRouter = Router();

/**
 * Payment-axis cash math (RPT-03 fix), extracted as a pure function so the
 * arithmetic can be unit-tested without a database connection — see
 * daily-summary.cashMath.test.ts.
 *
 * Previously netCollection/physicalCashInHand mixed the bill axis
 * (totalBilling/outstanding, which already EXCLUDES cancelled bills) with a
 * second subtraction of cancelledBills, and also subtracted totalRefunded —
 * a bill that was cancelled AND refunded the same day had its amount removed
 * twice, understating cash and sometimes going negative. Cash math must be
 * computed from money that actually moved (payments/refunds/expenses), not
 * from billed amounts. totalReceived already includes old-dues payments
 * collected today, so no separate addition is needed.
 */
export function computeDailySummaryCashMath(inputs: {
  totalReceived: number;
  totalRefunded: number;
  expenses: number;
  cashCollection: number;
  cashRefunded: number;
  cashExpenses: number;
}): { netCollection: number; physicalCashInHand: number } {
  return {
    netCollection: inputs.totalReceived - inputs.totalRefunded - inputs.expenses,
    physicalCashInHand: inputs.cashCollection - inputs.cashRefunded - inputs.cashExpenses,
  };
}

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

  // RECONCILIATION POSTING-DATE RULE (see DAILY_FINANCIAL_RECONCILIATION_
  // SPECIFICATION.md §16.5): expense_date is a free-text, backdatable
  // display/accounting field. Reconciliation must key off `created_at`,
  // the immutable timestamp of when the expense was actually posted — the
  // same instant the cash physically left the drawer — so a backdated
  // entry cannot retroactively change an already-closed day's totals.
  // This matches day-close.ts, which already windows expenses this way.
  const expenseRows = await db.execute<{ payment_mode: string; total: string }>(
    sql`SELECT payment_mode, COALESCE(SUM(amount::numeric), 0)::text AS total
        FROM expenses
        WHERE created_at >= ${dayStart.toISOString()} AND created_at < ${dayEnd.toISOString()}
        GROUP BY payment_mode`
  );

  const allDuesResult = await db.execute<{ total: string }>(
    // balance_amount = total − paid − refund (see bills.ts refund route).
    // SUM(balance_amount) is the correct net outstanding — no further
    // refund adjustment needed here.
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

  // ── Suspense / exception bucket (LOCKED BUSINESS RULE #6) ──────────────
  // A payment/refund whose method string is not recognized by the shared
  // classifier (../lib/paymentMethodClassifier.ts) must NEVER be silently
  // folded into cash or digital totals. It is isolated here and reported
  // separately so an admin can correct the row.
  const suspensePaymentItems = paymentItems.filter((p) => !classifyPaymentMethod(p.method).isKnown);
  const suspenseRefundItems = refundItems.filter((p) => !classifyPaymentMethod(p.method).isKnown);
  const suspensePaymentAmount = suspensePaymentItems.reduce((s, p) => s + Number(p.amount), 0);
  const suspenseRefundAmount = suspenseRefundItems.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);

  // digitalCollection uses the shared classifier so gateway-qualified method
  // strings such as "Online (ICICI Orange Pay)" / "Online (Razorpay)" /
  // "Online (PhonePe)" / "Online (BharatPe)" and "insurance" are correctly
  // recognized as digital — the critical defect being fixed here previously
  // let these fall through an exact "online"-only match and get silently
  // counted as cash below (cashCollection = totalReceived − digitalCollection).
  const digitalCollection = paymentItems.reduce(
    (s, p) => s + (isDigitalSettlement(p.method) ? Number(p.amount) : 0),
    0,
  );
  // "Known received" excludes suspense amounts from the cash/digital split so
  // an unrecognized method can never default into the cash bucket via this
  // subtraction — it is carved out explicitly instead.
  const knownReceived = totalReceived - suspensePaymentAmount;
  const cashCollection = knownReceived - digitalCollection;
  const expenses = expenseRows.rows.reduce((s, r) => s + Number(r.total), 0);

  // Expenses split by payment_mode: cash vs digital. Delegates to the
  // shared classifier's cash check (Approved Fix #5), with the same
  // explicit missing-value exception as day-close.ts's splitCashExpenses:
  // expenses.payment_mode is NOT NULL DEFAULT 'cash' in the schema, so a
  // missing/blank value here means cash, not "unknown" — see day-close.ts
  // for the full rationale.
  const isCashExpenseMode = (mode: string | null | undefined) => {
    const trimmed = (mode ?? "").trim();
    if (!trimmed) return true;
    return isPhysicalCash(trimmed);
  };
  const cashExpenses = expenseRows.rows
    .filter((r) => isCashExpenseMode(r.payment_mode))
    .reduce((s, r) => s + Number(r.total), 0);
  const digitalExpenses = expenses - cashExpenses;

  // ── Payment-axis cash math (RPT-03 fix) ────────────────────────────────
  // The previous formula mixed the bill axis (totalBilling/outstanding,
  // which already EXCLUDES cancelled bills) with a second subtraction of
  // cancelledBills, and also subtracted totalRefunded — a bill that is
  // cancelled AND refunded the same day had its amount removed twice,
  // understating cash and sometimes going negative. Cash math must be
  // computed from money that actually moved (payments/refunds/expenses),
  // exactly mirroring the per-staff formula in my-daily-summary.ts, not
  // from billed amounts. totalReceived already includes old-dues payments
  // collected today, so no separate addition is needed here.
  const cashRefunded = refundItems.reduce(
    (s, p) => s + (isPhysicalCash(p.method) ? Math.abs(Number(p.amount)) : 0),
    0,
  );
  const { netCollection, physicalCashInHand } = computeDailySummaryCashMath({
    totalReceived, totalRefunded, expenses, cashCollection, cashRefunded, cashExpenses,
  });
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

  // Net Digital Collection = digital collected - digital refunds (digital refunds by method).
  // Same shared classifier used above — fixes the identical exact-match bug
  // for gateway-qualified refund method strings and "insurance".
  const digitalRefunded = refundItems.reduce(
    (s, p) => s + (isDigitalSettlement(p.method) ? Math.abs(Number(p.amount)) : 0),
    0,
  );
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
  const billAuditFilters = [
    gte(billAuditsTable.createdAt, dayStart),
    lt(billAuditsTable.createdAt, dayEnd),
    notInArray(billAuditsTable.changeType, [...BILL_AUDIT_OPERATIONAL_CHANGE_TYPES]),
  ];
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
      // Payment-axis inputs to netCollection/physicalCashInHand — exposed so
      // the UI's displayed formula strings match what the server actually
      // computed (see RPT-03 fix above).
      totalReceived,
      cashRefunded,
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
      // ── Suspense / exception bucket (LOCKED BUSINESS RULE #6) ──────────
      // Excluded from cashCollection/digitalCollection above. Surfaced here
      // for admin correction — see suspensePayments below for row detail.
      suspensePaymentCount: suspensePaymentItems.length,
      suspensePaymentAmount,
      suspenseRefundCount: suspenseRefundItems.length,
      suspenseRefundAmount,
    },
    byMethod,
    byRefundMethod,
    billsByStatus,
    byUser,
    totalExpense: expenses,
    grandTotal: physicalCashInHand,
    suspensePayments: [...suspensePaymentItems, ...suspenseRefundItems].map((p) => ({
      id: p.id,
      billId: p.billId,
      amount: Number(p.amount),
      rawMethod: p.method,
      recordedByName: p.recordedByName,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    })),
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-summary/category-test-summary
//
// Returns category-wise and test-wise test counts for a date range.
//
// Logic:
//   - Joins bills → orders → order_tests → diagnostic_tests
//   - Uses stable testId (NOT displayName which can be edited post-billing)
//   - Excludes: bills with status='cancelled' OR cancelledAt IS NOT NULL
//   - Excludes: order_tests with status='cancelled'
//   - Category is sourced from diagnostic_tests.category (authoritative)
//   - Test name is sourced from diagnostic_tests.name (authoritative, not
//     order_tests.displayName which is a free-text override only for printing)
//   - Category total = exact SUM of its test counts (never rounded or inferred)
//
// Params:
//   from  — ISO date string YYYY-MM-DD (start of range, IST)
//   to    — ISO date string YYYY-MM-DD (end of range, IST)
//   staffName — optional, not applied to test counts (test counts are clinic-wide)
// ─────────────────────────────────────────────────────────────────────────────
dailySummaryRouter.get("/category-test-summary", async (req, res) => {
  const fromStr = typeof req.query.from === "string" ? req.query.from : todayIST();
  const toStr   = typeof req.query.to   === "string" ? req.query.to   : fromStr;

  // IST midnight-to-midnight bounds for the full range
  const rangeStart = new Date(`${fromStr}T00:00:00+05:30`);
  const rangeEnd   = new Date(`${toStr}T23:59:59.999+05:30`);

  // Core query:
  //   bills (date-filtered, not cancelled)
  //   → orders (via bills.orderId)
  //   → order_tests (not cancelled)
  //   → diagnostic_tests (stable name + category from master)
  //
  // COUNT(*) per (testId, testName, category) — one row per distinct test type
  // seen in valid bills in this range.
  //
  // Why JOIN diagnostic_tests and not use order_tests.displayName:
  //   displayName is an editable free-text override for printing only.
  //   A test renamed after billing would produce different bucket names for
  //   the same test depending on when the bill was created — violating the
  //   requirement to "count correctly even if test name was edited later."
  //   testsTable.name + testsTable.category are the stable master values.
  const rows = await db
    .select({
      testId:       orderTestsTable.testId,
      testName:     testsTable.name,
      category:     testsTable.category,
      count:        sql<number>`COUNT(*)::int`,
    })
    .from(billsTable)
    .innerJoin(ordersTable,     eq(billsTable.orderId,      ordersTable.id))
    .innerJoin(orderTestsTable, eq(orderTestsTable.orderId, ordersTable.id))
    .innerJoin(testsTable,      eq(orderTestsTable.testId,  testsTable.id))
    .where(
      and(
        // Date range on the bill (IST-aware)
        gte(billsTable.createdAt, rangeStart),
        lt( billsTable.createdAt, new Date(rangeEnd.getTime() + 1)),
        // Exclude cancelled bills — two signals: status field and hard timestamp
        ne(  billsTable.status,      "cancelled"),
        isNull(billsTable.cancelledAt),
        // Exclude individually-cancelled test line items
        ne(orderTestsTable.status, "cancelled"),
      )
    )
    .groupBy(orderTestsTable.testId, testsTable.name, testsTable.category)
    .orderBy(testsTable.category, testsTable.name);

  // Group into category → tests structure
  // Category total = sum of its test counts (guaranteed by construction —
  // we group by testId so every test count is exact, and we sum here in JS,
  // never deriving the category total any other way).
  const categoryMap = new Map<string, {
    categoryName: string;
    total: number;
    tests: { testId: number; testName: string; count: number }[];
  }>();

  for (const row of rows) {
    const cat = row.category || "Uncategorised";
    let entry = categoryMap.get(cat);
    if (!entry) {
      entry = { categoryName: cat, total: 0, tests: [] };
      categoryMap.set(cat, entry);
    }
    entry.tests.push({ testId: row.testId, testName: row.testName, count: row.count });
    entry.total += row.count;
  }

  // Sort categories by total descending (most-used first)
  const categories = Array.from(categoryMap.values())
    .sort((a, b) => b.total - a.total);

  res.json({
    from:  fromStr,
    to:    toStr,
    total: categories.reduce((s, c) => s + c.total, 0),
    categories,
  });
});
