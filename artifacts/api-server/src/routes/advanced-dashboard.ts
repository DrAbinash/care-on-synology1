import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FULL_ACCESS_ROLES, requireStaffAuth } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

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

  // ── 2. Payments grouped by staff ─────────────────────────────────────────
  const staffPaymentsRaw = await db.execute<{
    staff_name: string;
    total_received: string;
    cash_collection: string;
    digital_collection: string;
    refund_amount: string;
  }>(sql`
    SELECT
      COALESCE(recorded_by_name, 'Unknown') AS staff_name,
      COALESCE(SUM(amount::numeric) FILTER (WHERE amount::numeric > 0), 0)::text                                                                         AS total_received,
      COALESCE(SUM(amount::numeric) FILTER (WHERE amount::numeric > 0 AND LOWER(method) = 'cash'), 0)::text                                              AS cash_collection,
      COALESCE(SUM(amount::numeric) FILTER (WHERE amount::numeric > 0 AND LOWER(method) IN ('upi','card','online','bank','cheque','neft','rtgs')), 0)::text AS digital_collection,
      COALESCE(SUM(ABS(amount::numeric)) FILTER (WHERE amount::numeric < 0), 0)::text                                                                    AS refund_amount
    FROM payments
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND recorded_by_name = ${staffFilter}` : sql``}
    GROUP BY COALESCE(recorded_by_name, 'Unknown')
  `);

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

  // ── 5. Cash expenses attributed to staff (via approved_by) ───────────────
  const cashExpRaw = await db.execute<{ staff_name: string; cash_expenses: string }>(sql`
    SELECT
      COALESCE(approved_by, 'Unknown') AS staff_name,
      COALESCE(SUM(amount::numeric) FILTER (WHERE LOWER(payment_mode) = 'cash'), 0)::text AS cash_expenses
    FROM expenses
    WHERE expense_date >= ${from} AND expense_date <= ${to}
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
  for (const r of staffPaymentsRaw.rows) {
    const s = ensureStaff(r.staff_name);
    s.totalReceived = Number(r.total_received);
    s.cashCollection = Number(r.cash_collection);
    s.digitalCollection = Number(r.digital_collection);
    s.refundAmount = Number(r.refund_amount);
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
    s.netCashHandled = s.cashCollection - s.cashExpenses;
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

  const paymentsAggRaw = await db.execute<{
    total_received: string;
    refund_amount: string;
    digital_collection: string;
    cash_collection: string;
  }>(sql`
    SELECT
      COALESCE(SUM(amount::numeric) FILTER (WHERE amount::numeric > 0), 0)::text AS total_received,
      COALESCE(SUM(ABS(amount::numeric)) FILTER (WHERE amount::numeric < 0), 0)::text AS refund_amount,
      COALESCE(SUM(amount::numeric) FILTER (WHERE amount::numeric > 0 AND LOWER(method) IN ('upi','card','online','bank','cheque','neft','rtgs')), 0)::text AS digital_collection,
      COALESCE(SUM(amount::numeric) FILTER (WHERE amount::numeric > 0 AND LOWER(method) = 'cash'), 0)::text AS cash_collection
    FROM payments
    WHERE created_at >= ${start} AND created_at <= ${end}
    ${staffFilter ? sql`AND recorded_by_name = ${staffFilter}` : sql``}
  `);

  const expensesAggRaw = await db.execute<{ total_expenses: string }>(sql`
    SELECT COALESCE(SUM(amount::numeric), 0)::text AS total_expenses
    FROM expenses
    WHERE expense_date >= ${from} AND expense_date <= ${to}
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
  const totalReceived = Number(paymentsAggRaw.rows[0]?.total_received ?? 0);
  const refundAmount = Number(paymentsAggRaw.rows[0]?.refund_amount ?? 0);
  const digitalCollection = Number(paymentsAggRaw.rows[0]?.digital_collection ?? 0);
  const cashCollection = Number(paymentsAggRaw.rows[0]?.cash_collection ?? 0);
  const totalExpenses = Number(expensesAggRaw.rows[0]?.total_expenses ?? 0);
  const refundsAndCancellations = refundAmount + cancelledAmount;
  const netCollection = grossBilling - outstanding - refundsAndCancellations - totalExpenses;
  const physicalCashInHand = netCollection - digitalCollection;

  const overallSummary = {
    grossBilling,
    outstanding,
    refundsAndCancellations,
    refundAmount,
    cancelledAmount,
    totalReceived,
    digitalCollection,
    cashCollection,
    totalExpenses,
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
