import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { todayIST } from "../lib/istDate";

export const booksSanityRouter = Router();

export type BooksSanityAnomaly = {
  category: string;
  severity: "high" | "medium" | "low";
  count: number;
  totalAmount: number;
  description: string;
  rows: Record<string, unknown>[];
};

export type BooksSanityReport = {
  range: { from: string; to: string };
  generatedAt: string;
  periodTotals: Record<string, string | number>;
  anomalies: BooksSanityAnomaly[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reusable: produces the same payload as GET /api/books-sanity. Called from
 * both the HTTP route and from the monthly cron snapshot job.
 *
 * `from` / `to` are optional ISO YYYY-MM-DD strings; when both are missing the
 * report covers the last 90 days. Validation must be done by the caller.
 */
export async function runBooksSanity(opts: { from: string | null; to: string | null }): Promise<BooksSanityReport> {
  const { from: fromRaw, to: toRaw } = opts;
  const dateFilter = fromRaw && toRaw
    ? sql`b.created_at >= ${fromRaw}::date AND b.created_at < (${toRaw}::date + INTERVAL '1 day')`
    : sql`b.created_at >= NOW() - INTERVAL '90 days'`;

  const anomalies: BooksSanityAnomaly[] = [];

  // ── 1. Cancelled bill, but order_tests still active (commission leak) ──────
  const leak = await db.execute(sql`
    SELECT b.id, b.bill_number, b.total_amount, b.cancelled_at, b.cancelled_by_name,
           COUNT(ot.id) AS active_tests
      FROM bills b
      JOIN order_tests ot ON ot.order_id = b.order_id
     WHERE b.status = 'cancelled' AND ot.status <> 'cancelled' AND ${dateFilter}
     GROUP BY b.id, b.bill_number, b.total_amount, b.cancelled_at, b.cancelled_by_name
     ORDER BY b.cancelled_at DESC
  `);
  if (leak.rows.length > 0) {
    anomalies.push({
      category: "Commission leak: cancelled bills with active tests",
      severity: "high",
      count: leak.rows.length,
      totalAmount: leak.rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0),
      description: "These bills are cancelled in the books but their order_tests rows are still 'active', so the referral commission report keeps paying the doctor on them. The May 2026 cascade-fix + backfill closes this on creation; rows shown here either pre-date the fix or were edited manually.",
      rows: leak.rows,
    });
  }

  // ── 2. Total != subtotal − discount + tax (arithmetic drift) ───────────────
  const arith = await db.execute(sql`
    SELECT b.id, b.bill_number, b.subtotal, b.discount, b.tax_amount, b.total_amount,
           ROUND((b.subtotal - b.discount + b.tax_amount - b.total_amount)::numeric, 2) AS diff
      FROM bills b
     WHERE ABS(b.subtotal - b.discount + b.tax_amount - b.total_amount) > 0.01
       AND ${dateFilter}
     ORDER BY ABS(b.subtotal - b.discount + b.tax_amount - b.total_amount) DESC
     LIMIT 200
  `);
  if (arith.rows.length > 0) {
    anomalies.push({
      category: "Arithmetic drift: total ≠ subtotal − discount + tax",
      severity: "high",
      count: arith.rows.length,
      totalAmount: arith.rows.reduce((s, r) => s + Math.abs(Number(r.diff ?? 0)), 0),
      description: "The bill's stored total does not equal subtotal − discount + tax. Usually the result of a super-admin edit that did not propagate.",
      rows: arith.rows,
    });
  }

  // ── 3. paid_amount ≠ SUM(payments.amount) (payment ledger drift) ───────────
  const paySum = await db.execute(sql`
    SELECT b.id, b.bill_number, b.paid_amount, COALESCE(SUM(p.amount), 0) AS sum_payments,
           ROUND((b.paid_amount - COALESCE(SUM(p.amount), 0))::numeric, 2) AS diff
      FROM bills b
      LEFT JOIN payments p ON p.bill_id = b.id
     WHERE ${dateFilter}
     GROUP BY b.id, b.bill_number, b.paid_amount
    HAVING ABS(b.paid_amount - COALESCE(SUM(p.amount), 0)) > 0.01
     ORDER BY ABS(b.paid_amount - COALESCE(SUM(p.amount), 0)) DESC
     LIMIT 200
  `);
  if (paySum.rows.length > 0) {
    anomalies.push({
      category: "Payment ledger drift: paid_amount ≠ Σ(payments)",
      severity: "high",
      count: paySum.rows.length,
      totalAmount: paySum.rows.reduce((s, r) => s + Math.abs(Number(r.diff ?? 0)), 0),
      description: "The bill's stored paid_amount does not match the sum of payment rows for that bill (refunds count as negative). Indicates a payment was inserted/edited/deleted without the bill being recomputed.",
      rows: paySum.rows,
    });
  }

  // ── 4. Cancelled bill still showing positive paid_amount (un-refunded) ─────
  const unrefunded = await db.execute(sql`
    SELECT b.id, b.bill_number, b.total_amount, b.paid_amount, b.refund_amount,
           b.cancelled_at, b.cancelled_by_name
      FROM bills b
     WHERE b.status = 'cancelled' AND b.paid_amount > 0.01 AND ${dateFilter}
     ORDER BY b.cancelled_at DESC
     LIMIT 200
  `);
  if (unrefunded.rows.length > 0) {
    anomalies.push({
      category: "Cancelled-but-not-refunded: money still on the books",
      severity: "medium",
      count: unrefunded.rows.length,
      totalAmount: unrefunded.rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0),
      description: "These bills are cancelled but the patient's payment was never refunded — the original Receipt voucher still sits in revenue. Use Cancel & Refund to auto-issue a Payment voucher in one step.",
      rows: unrefunded.rows,
    });
  }

  // ── 5. Discount > 50% (manual override worth reviewing) ────────────────────
  const bigDisc = await db.execute(sql`
    SELECT b.id, b.bill_number, b.subtotal, b.discount, b.created_by_name,
           ROUND((b.discount * 100.0 / NULLIF(b.subtotal, 0))::numeric, 2) AS pct
      FROM bills b
     WHERE b.discount > 0 AND b.subtotal > 0
       AND (b.discount * 100.0 / NULLIF(b.subtotal, 0)) > 50
       AND ${dateFilter}
     ORDER BY (b.discount / NULLIF(b.subtotal, 0)) DESC
     LIMIT 200
  `);
  if (bigDisc.rows.length > 0) {
    anomalies.push({
      category: "High discount (>50% of subtotal)",
      severity: "low",
      count: bigDisc.rows.length,
      totalAmount: bigDisc.rows.reduce((s, r) => s + Number(r.discount ?? 0), 0),
      description: "Bills where the applied discount exceeds 50% of subtotal. Usually approved by an admin but worth a CA spot-check.",
      rows: bigDisc.rows,
    });
  }

  // ── 6. Super-admin / override audit trail ──────────────────────────────────
  const sEdits = await db.execute(sql`
    SELECT ba.id, ba.bill_id, ba.edited_by, ba.reason, ba.change_type,
           ba.old_value, ba.new_value, ba.created_at, b.bill_number
      FROM bill_audits ba
      LEFT JOIN bills b ON b.id = ba.bill_id
     WHERE ba.change_type IN ('subtotal','taxAmount','totalAmount','deleted','subtotal_mismatch_warning','discount_override_warning')
       AND ba.created_at >= COALESCE((${fromRaw})::date, NOW() - INTERVAL '90 days')
       AND ba.created_at <  COALESCE((${toRaw})::date + INTERVAL '1 day', NOW() + INTERVAL '1 day')
     ORDER BY ba.created_at DESC
     LIMIT 500
  `);
  if (sEdits.rows.length > 0) {
    anomalies.push({
      category: "Super-admin / override audit trail",
      severity: "low",
      count: sEdits.rows.length,
      totalAmount: 0,
      description: "Every super-admin edit, deletion, and discount-override warning recorded in the period. Provided as-is for the CA's manual review.",
      rows: sEdits.rows,
    });
  }

  // ── Period totals ──────────────────────────────────────────────────────────
  const periodTotals = await db.execute(sql`
    SELECT
      COUNT(*)                                           AS bill_count,
      COALESCE(SUM(b.subtotal), 0)                       AS subtotal_sum,
      COALESCE(SUM(b.discount), 0)                       AS discount_sum,
      COALESCE(SUM(b.tax_amount), 0)                     AS tax_sum,
      COALESCE(SUM(b.total_amount), 0)                   AS total_sum,
      COALESCE(SUM(b.paid_amount), 0)                    AS paid_sum,
      COALESCE(SUM(b.refund_amount), 0)                  AS refund_sum,
      COALESCE(SUM(b.balance_amount), 0)                 AS balance_sum,
      SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
      COALESCE(SUM(CASE WHEN b.status = 'cancelled' THEN b.total_amount ELSE 0 END), 0) AS cancelled_amount
      FROM bills b
     WHERE ${dateFilter}
  `);

  return {
    range: {
      from: fromRaw ?? "(last 90 days)",
      to: toRaw ?? todayIST(),
    },
    generatedAt: new Date().toISOString(),
    periodTotals: (periodTotals.rows[0] ?? {}) as Record<string, string | number>,
    anomalies,
  };
}

booksSanityRouter.get("/", async (req, res) => {
  const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
  const toRaw = typeof req.query.to === "string" ? req.query.to : null;
  if ((fromRaw && !ISO_DATE.test(fromRaw)) || (toRaw && !ISO_DATE.test(toRaw))) {
    res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
    return;
  }
  if (fromRaw && toRaw && fromRaw > toRaw) {
    res.status(400).json({ error: "'from' must be on or before 'to'" });
    return;
  }
  const report = await runBooksSanity({ from: fromRaw, to: toRaw });
  res.json(report);
});

export default booksSanityRouter;
