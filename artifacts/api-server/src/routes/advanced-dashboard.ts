import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable } from "@workspace/db/schema";
import { sql, and, gte, lte, eq } from "drizzle-orm";
import { FULL_ACCESS_ROLES, requireStaffAuth } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { isDigitalSettlement, isPhysicalCash } from "../lib/paymentMethodClassifier";
import { computeDailySummaryCashMath } from "./daily-summary";

export const advancedDashboardRouter = Router();

advancedDashboardRouter.use(requireStaffAuth);

// Owner-only: admin / super_admin only
advancedDashboardRouter.use((req: StaffAuthRequest, res, next) => {
  const role = req.staffSession?.role ?? "";
  if (!FULL_ACCESS_ROLES.has(role)) {
    res.status(403).json({ error: "Owner Dashboard access requires admin or super_admin role." });
    return;
  }
  next();
});

function dayBoundsRange(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00+05:30`),
    end: new Date(`${to}T23:59:59.999+05:30`),
  };
}

advancedDashboardRouter.get("/", async (req: StaffAuthRequest, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = typeof req.query.from === "string" ? req.query.from : today;
  const to = typeof req.query.to === "string" ? req.query.to : from;
  const staffFilter =
    typeof req.query.staffName === "string" ? req.query.staffName.trim() : "";

  const { start, end } = dayBoundsRange(from, to);

  // ── 1. Bills grouped by staff ────────────────────────────────────────────
  const staffBillsRaw = await db.execute<{
    staff_name: string;
    bill_count: string;
    total_billing: string;
    discounts: string;
    cancellation_count: string;
    cancelled_amount: string;
  }>(sql`
    SELECT
      COALESCE(created_by_name, 'Unknown') AS staff_name,
      COUNT(*) FILTER (WHERE status <> 'cancelled')::text          AS bill_count,
      COALESCE(SUM(total_amount::numeric) FILTER (WHERE status <> 'cancelled'), 0)::text AS total_billing,
      COALESCE(SUM(discount::numeric)     FILTER (WHERE status <> 'cancelled'), 0)::text AS discounts,
      COUNT(*) FILTER (WHERE status = 'cancelled')::text           AS cancellation_count,
      COALESCE(SUM(total_amount::numeric) FILTER (WHERE status = 'cancelled'),  0)::text AS cancelled_amount
    FROM bills
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND created_by_name = ${staffFilter}` : sql``}
    GROUP BY COALESCE(created_by_name, 'Unknown')
    ORDER BY COALESCE(SUM(total_amount::numeric) FILTER (WHERE status <> 'cancelled'), 0) DESC
  `);

  // ── 2. Payments grouped by staff (classifier — same as Daily Summary) ──
  // Naive SQL LOWER(method)='cash' / IN ('upi','online',…) misses gateway
  // strings like "Online (ICICI Orange Pay)" and mis-buckets insurance.
  const paymentFilters = [
    gte(paymentsTable.createdAt, start),
    lte(paymentsTable.createdAt, end),
  ];
  if (staffFilter) paymentFilters.push(eq(paymentsTable.recordedByName, staffFilter));

  const allPayments = await db
    .select({
      amount: paymentsTable.amount,
      method: paymentsTable.method,
      recordedByName: paymentsTable.recordedByName,
    })
    .from(paymentsTable)
    .where(and(...paymentFilters));

  type PayAgg = {
    totalReceived: number;
    cashCollection: number;
    digitalCollection: number;
    refundAmount: number;
    cashRefunded: number;
  };
  const payByStaff = new Map<string, PayAgg>();
  const ensurePay = (name: string): PayAgg => {
    const key = (name && name.trim()) || "Unknown";
    if (!payByStaff.has(key)) {
      payByStaff.set(key, {
        totalReceived: 0,
        cashCollection: 0,
        digitalCollection: 0,
        refundAmount: 0,
        cashRefunded: 0,
      });
    }
    return payByStaff.get(key)!;
  };
  let overallTotalReceived = 0;
  let overallRefundAmount = 0;
  let overallDigitalCollection = 0;
  let overallCashCollection = 0;
  let overallCashRefunded = 0;

  for (const p of allPayments) {
    const amt = Number(p.amount);
    const staff = ensurePay(p.recordedByName ?? "Unknown");
    if (amt > 0) {
      staff.totalReceived += amt;
      overallTotalReceived += amt;
      if (isPhysicalCash(p.method)) {
        staff.cashCollection += amt;
        overallCashCollection += amt;
      } else if (isDigitalSettlement(p.method)) {
        staff.digitalCollection += amt;
        overallDigitalCollection += amt;
      }
      // unrecognized → suspense (excluded from cash/digital, same as daily-summary)
    } else if (amt < 0) {
      const abs = Math.abs(amt);
      staff.refundAmount += abs;
      overallRefundAmount += abs;
      if (isPhysicalCash(p.method)) {
        staff.cashRefunded += abs;
        overallCashRefunded += abs;
      }
    }
  }

  // ── 3. Bill audit counts by staff ────────────────────────────────────────
  const billAuditRaw = await db.execute<{ staff_name: string; edit_count: string }>(sql`
    SELECT COALESCE(edited_by, 'Unknown') AS staff_name, COUNT(*)::text AS edit_count
    FROM bill_audits
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND edited_by = ${staffFilter}` : sql``}
    GROUP BY COALESCE(edited_by, 'Unknown')
  `);

  // ── 4. Voucher audit counts by staff ─────────────────────────────────────
  const voucherAuditRaw = await db.execute<{ staff_name: string; edit_count: string }>(sql`
    SELECT COALESCE(edited_by, 'Unknown') AS staff_name, COUNT(*)::text AS edit_count
    FROM voucher_audits
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND edited_by = ${staffFilter}` : sql``}
    GROUP BY COALESCE(edited_by, 'Unknown')
  `);

  // ── 5. Cash expenses by staff — created_at (same axis as Daily Summary /
  // day-close). expense_date is editable and would move cash across days.
  const cashExpRaw = await db.execute<{ staff_name: string; cash_expenses: string }>(sql`
    SELECT
      COALESCE(approved_by, 'Unknown') AS staff_name,
      COALESCE(SUM(amount::numeric) FILTER (
        WHERE LOWER(COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash')) = 'cash'
      ), 0)::text AS cash_expenses
    FROM expenses
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND approved_by = ${staffFilter}` : sql``}
    GROUP BY COALESCE(approved_by, 'Unknown')
  `);

  // ── Merge into staff comparison map ─────────────────────────────────────
  type StaffRow = {
    staffName: string;
    billCount: number;
    totalBilling: number;
    totalReceived: number;
    cashCollection: number;
    digitalCollection: number;
    discountsGiven: number;
    refundAmount: number;
    cashRefunded: number;
    cancellationCount: number;
    cancelledAmount: number;
    billEditCount: number;
    voucherEditCount: number;
    cashExpenses: number;
    netCashHandled: number;
  };

  const staffMap = new Map<string, StaffRow>();
  const ensureStaff = (name: string): StaffRow => {
    const key = (name && name.trim()) || "Unknown";
    if (!staffMap.has(key)) {
      staffMap.set(key, {
        staffName: key,
        billCount: 0,
        totalBilling: 0,
        totalReceived: 0,
        cashCollection: 0,
        digitalCollection: 0,
        discountsGiven: 0,
        refundAmount: 0,
        cashRefunded: 0,
        cancellationCount: 0,
        cancelledAmount: 0,
        billEditCount: 0,
        voucherEditCount: 0,
        cashExpenses: 0,
        netCashHandled: 0,
      });
    }
    return staffMap.get(key)!;
  };

  for (const r of staffBillsRaw.rows) {
    const s = ensureStaff(r.staff_name);
    s.billCount = Number(r.bill_count);
    s.totalBilling = Number(r.total_billing);
    s.discountsGiven = Number(r.discounts);
    s.cancellationCount = Number(r.cancellation_count);
    s.cancelledAmount = Number(r.cancelled_amount);
  }
  for (const [name, pay] of payByStaff) {
    const s = ensureStaff(name);
    s.totalReceived = pay.totalReceived;
    s.cashCollection = pay.cashCollection;
    s.digitalCollection = pay.digitalCollection;
    s.refundAmount = pay.refundAmount;
    s.cashRefunded = pay.cashRefunded;
  }
  for (const r of billAuditRaw.rows) {
    const s = ensureStaff(r.staff_name);
    s.billEditCount = Number(r.edit_count);
  }
  for (const r of voucherAuditRaw.rows) {
    const s = ensureStaff(r.staff_name);
    s.voucherEditCount = Number(r.edit_count);
  }
  for (const r of cashExpRaw.rows) {
    const s = ensureStaff(r.staff_name);
    s.cashExpenses = Number(r.cash_expenses);
  }
  for (const s of staffMap.values()) {
    // Same drawer formula as Daily Summary / My Daily Summary
    s.netCashHandled = s.cashCollection - s.cashRefunded - s.cashExpenses;
  }

  const staffComparison = Array.from(staffMap.values()).sort(
    (a, b) => b.totalBilling - a.totalBilling,
  );

  // ── 6. Overall summary (all-staff aggregate for date range) ─────────────
  const billsAggRaw = await db.execute<{
    gross_billing: string;
    outstanding: string;
    cancelled_amount: string;
    discounts_given: string;
  }>(sql`
    SELECT
      COALESCE(SUM(total_amount::numeric) FILTER (WHERE status <> 'cancelled'), 0)::text  AS gross_billing,
      COALESCE(SUM(balance_amount::numeric) FILTER (WHERE status IN ('pending','partial') AND balance_amount::numeric > 0), 0)::text AS outstanding,
      COALESCE(SUM(total_amount::numeric) FILTER (WHERE status = 'cancelled'), 0)::text   AS cancelled_amount,
      COALESCE(SUM(discount::numeric)     FILTER (WHERE status <> 'cancelled'), 0)::text  AS discounts_given
    FROM bills
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND created_by_name = ${staffFilter}` : sql``}
  `);

  const expensesAggRaw = await db.execute<{ total_expenses: string; cash_expenses: string }>(sql`
    SELECT
      COALESCE(SUM(amount::numeric), 0)::text AS total_expenses,
      COALESCE(SUM(amount::numeric) FILTER (
        WHERE LOWER(COALESCE(NULLIF(TRIM(payment_mode), ''), 'cash')) = 'cash'
      ), 0)::text AS cash_expenses
    FROM expenses
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND approved_by = ${staffFilter}` : sql``}
  `);

  const pendingReportsRaw = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM order_tests
    WHERE status = 'active'
      AND (result_status IS NULL OR result_status NOT IN ('completed','verified','delivered','cancelled'))
  `);

  const grossBilling = Number(billsAggRaw.rows[0]?.gross_billing ?? 0);
  const outstanding = Number(billsAggRaw.rows[0]?.outstanding ?? 0);
  const cancelledAmount = Number(billsAggRaw.rows[0]?.cancelled_amount ?? 0);
  const discountsGiven = Number(billsAggRaw.rows[0]?.discounts_given ?? 0);
  const totalReceived = overallTotalReceived;
  const refundAmount = overallRefundAmount;
  const digitalCollection = overallDigitalCollection;
  const cashCollection = overallCashCollection;
  const cashRefunded = overallCashRefunded;
  const totalExpenses = Number(expensesAggRaw.rows[0]?.total_expenses ?? 0);
  const cashExpenses = Number(expensesAggRaw.rows[0]?.cash_expenses ?? 0);
  const refundsAndCancellations = refundAmount + cancelledAmount;
  const { netCollection, physicalCashInHand } = computeDailySummaryCashMath({
    totalReceived,
    totalRefunded: refundAmount,
    expenses: totalExpenses,
    cashCollection,
    cashRefunded,
    cashExpenses,
  });

  const overallSummary = {
    grossBilling,
    outstanding,
    refundsAndCancellations,
    refundAmount,
    cancelledAmount,
    totalReceived,
    digitalCollection,
    cashCollection,
    cashRefunded,
    totalExpenses,
    cashExpenses,
    discountsGiven,
    netCollection,
    physicalCashInHand,
    pendingReports: Number(pendingReportsRaw.rows[0]?.count ?? 0),
  };

  // ── 7. Modality summary ──────────────────────────────────────────────────
  const modalityRaw = await db.execute<{
    modality: string;
    test_count: string;
    gross_billing: string;
    completed_reports: string;
    pending_reports: string;
  }>(sql`
    SELECT
      COALESCE(dt.department, 'Other') AS modality,
      COUNT(ot.id)::text               AS test_count,
      COALESCE(SUM(ot.price::numeric), 0)::text AS gross_billing,
      COUNT(*) FILTER (
        WHERE ot.result_status IN ('completed', 'verified', 'delivered')
      )::text AS completed_reports,
      COUNT(*) FILTER (
        WHERE ot.result_status IS NULL
           OR ot.result_status NOT IN ('completed', 'verified', 'delivered', 'cancelled')
      )::text AS pending_reports
    FROM orders o
    JOIN order_tests ot ON ot.order_id = o.id AND ot.status = 'active'
    JOIN diagnostic_tests dt ON dt.id = ot.test_id
    WHERE o.created_at >= ${start} AND o.created_at <= ${end}
    GROUP BY COALESCE(dt.department, 'Other')
    ORDER BY gross_billing::numeric DESC
  `);

  const MODALITY_ORDER = ["MRI", "CT", "X-Ray", "USG", "Pathology"];
  const modalitySummary = modalityRaw.rows
    .map((r) => ({
      modality: r.modality,
      testCount: Number(r.test_count),
      grossBilling: Number(r.gross_billing),
      completedReports: Number(r.completed_reports),
      pendingReports: Number(r.pending_reports),
    }))
    .sort((a, b) => {
      const ia = MODALITY_ORDER.indexOf(a.modality);
      const ib = MODALITY_ORDER.indexOf(b.modality);
      if (ia === -1 && ib === -1) return b.grossBilling - a.grossBilling;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

  // ── 8. Alerts ────────────────────────────────────────────────────────────
  const alerts: {
    type: string;
    message: string;
    severity: "warning" | "info" | "critical";
    staffName?: string;
  }[] = [];

  for (const s of staffComparison) {
    const discountPct =
      s.totalBilling > 0 ? s.discountsGiven / s.totalBilling : 0;
    if (discountPct >= 0.2) {
      alerts.push({
        type: "high_discount",
        message: `${s.staffName} gave ${(discountPct * 100).toFixed(0)}% discounts (₹${s.discountsGiven.toFixed(0)} of ₹${s.totalBilling.toFixed(0)})`,
        severity: discountPct >= 0.35 ? "critical" : "warning",
        staffName: s.staffName,
      });
    }
    if (s.cancellationCount >= 3) {
      alerts.push({
        type: "frequent_cancellations",
        message: `${s.staffName} cancelled ${s.cancellationCount} bill${s.cancellationCount === 1 ? "" : "s"} (₹${s.cancelledAmount.toFixed(0)})`,
        severity: s.cancellationCount >= 5 ? "critical" : "warning",
        staffName: s.staffName,
      });
    }
    if (s.billEditCount + s.voucherEditCount >= 4) {
      alerts.push({
        type: "repeated_edits",
        message: `${s.staffName} made ${s.billEditCount + s.voucherEditCount} document edits`,
        severity: "warning",
        staffName: s.staffName,
      });
    }
    if (s.totalBilling > 1000 && s.totalReceived < s.totalBilling * 0.5) {
      alerts.push({
        type: "low_collection",
        message: `${s.staffName}: collected only ${((s.totalReceived / s.totalBilling) * 100).toFixed(0)}% of billing (₹${s.totalReceived.toFixed(0)} / ₹${s.totalBilling.toFixed(0)})`,
        severity: "info",
        staffName: s.staffName,
      });
    }
  }

  res.json({ from, to, overallSummary, staffComparison, modalitySummary, alerts });
});
