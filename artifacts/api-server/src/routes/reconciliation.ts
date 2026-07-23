// =============================================================================
// Owner Reconciliation Center — read-only consolidation endpoint.
//
// Purpose: the ERP already detects most financial exceptions, but the logic is
// scattered across several engines and pages (Books Sanity, Banking fraud
// alerts, Bank reconciliation, Day Close). The owner has to visit each one
// separately. This endpoint AGGREGATES those existing detectors into a single
// owner-facing exceptions feed, and adds the operations-vs-billing revenue-
// leakage check that did not exist anywhere.
//
// Design rules (see DEVELOPMENT_PRINCIPLES.md / FINANCIAL_FREEZE_RULEBOOK.md):
//   • READ-ONLY. This route never writes to any table.
//   • REUSE, don't duplicate. It calls the existing `runBooksSanity` and the
//     shared `classifyPaymentMethod` rather than re-implementing their logic.
//   • Each section is independent + defensive: a missing/empty banking table
//     degrades that one section (available:false) instead of failing the whole
//     response.
//   • Owner-only (admin / super_admin), mirroring advanced-dashboard.ts.
// =============================================================================

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { runBooksSanity } from "./books-sanity";
import { classifyPaymentMethod, PAYMENT_METHOD_CATEGORY_LABEL } from "../lib/paymentMethodClassifier";
import { todayIST } from "../lib/istDate";

export const reconciliationRouter = Router();

// Owner-only: admin / super_admin only (same gate as the Owner Dashboard).
reconciliationRouter.use((req: StaffAuthRequest, res, next) => {
  const role = req.staffSession?.role ?? "";
  if (!FULL_ACCESS_ROLES.has(role)) {
    res.status(403).json({ error: "Reconciliation Center access requires admin or super_admin role." });
    return;
  }
  next();
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Detection thresholds (grace windows). Kept as named constants — these are
// reconciliation tuning knobs, not deployment config; tune here or override
// per-request via query params.
const DEFAULT_UNBILLED_GRACE_HOURS = 2; // don't flag a just-created order as unbilled
const DEFAULT_BANK_AGING_DAYS = 2;      // bank line unreconciled this long = exception
const MAX_ROWS_PER_GROUP = 100;

export type ReconSeverity = "high" | "medium" | "low";

export interface ReconExceptionGroup {
  key: string;
  source: string;
  category: string;
  severity: ReconSeverity;
  count: number;
  totalAmount: number;
  description: string;
  /** Sample rows (capped). */
  rows: Record<string, unknown>[];
}

export interface ReconSourceStatus {
  source: string;
  available: boolean;
  error?: string;
}

export interface ReconciliationReport {
  generatedAt: string;
  range: { from: string; to: string };
  summary: {
    totalExceptions: number;
    groups: number;
    high: number;
    medium: number;
    low: number;
    totalAmountAtRisk: number;
  };
  sources: ReconSourceStatus[];
  exceptions: ReconExceptionGroup[];
}

/**
 * Pure roll-up of the exception groups into the summary block. Extracted so it
 * can be unit-tested without a database.
 */
export function summarizeReconciliation(groups: ReconExceptionGroup[]): ReconciliationReport["summary"] {
  let totalExceptions = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let totalAmountAtRisk = 0;
  for (const g of groups) {
    totalExceptions += g.count;
    totalAmountAtRisk += g.totalAmount;
    if (g.severity === "high") high += 1;
    else if (g.severity === "medium") medium += 1;
    else low += 1;
  }
  return { totalExceptions, groups: groups.length, high, medium, low, totalAmountAtRisk };
}

/** Normalize any upstream severity string (incl. fraud "critical") to our 3-level scale. */
export function normSeverity(s: string | null | undefined): ReconSeverity {
  const v = (s ?? "").toString().trim().toLowerCase();
  if (v === "critical" || v === "high") return "high";
  if (v === "medium") return "medium";
  return "low";
}

const SEVERITY_RANK: Record<ReconSeverity, number> = { high: 3, medium: 2, low: 1 };
function maxSeverity(a: ReconSeverity, b: ReconSeverity): ReconSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function num(v: unknown): number {
  return Number(v ?? 0) || 0;
}

reconciliationRouter.get("/", async (req: StaffAuthRequest, res) => {
  const fromRaw = typeof req.query.from === "string" && req.query.from ? req.query.from : null;
  const toRaw = typeof req.query.to === "string" && req.query.to ? req.query.to : null;
  if ((fromRaw && !ISO_DATE.test(fromRaw)) || (toRaw && !ISO_DATE.test(toRaw))) {
    res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
    return;
  }
  if (fromRaw && toRaw && fromRaw > toRaw) {
    res.status(400).json({ error: "'from' must be on or before 'to'" });
    return;
  }
  const to = toRaw ?? todayIST();
  // Default window: last 30 days.
  const from = fromRaw ?? (() => {
    const d = new Date(`${to}T00:00:00+05:30`);
    d.setDate(d.getDate() - 30);
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  })();

  const unbilledGraceHours = Number.isFinite(Number(req.query.unbilledGraceHours))
    ? Math.max(0, Number(req.query.unbilledGraceHours))
    : DEFAULT_UNBILLED_GRACE_HOURS;
  const bankAgingDays = Number.isFinite(Number(req.query.bankAgingDays))
    ? Math.max(0, Number(req.query.bankAgingDays))
    : DEFAULT_BANK_AGING_DAYS;

  const exceptions: ReconExceptionGroup[] = [];
  const sources: ReconSourceStatus[] = [];

  // Build interval literals as text params cast to ::interval — unambiguous in
  // Postgres and avoids any integer×interval operator-resolution surprises.
  const unbilledGraceInterval = `${unbilledGraceHours} hours`;
  const bankAgingInterval = `${bankAgingDays} days`;

  // ── Source 1: Financial integrity (REUSE books-sanity) ─────────────────────
  try {
    const report = await runBooksSanity({ from, to });
    for (const a of report.anomalies) {
      exceptions.push({
        key: `books:${a.category}`,
        source: "Financial Integrity",
        category: a.category,
        severity: normSeverity(a.severity),
        count: a.count,
        totalAmount: num(a.totalAmount),
        description: a.description,
        rows: a.rows.slice(0, MAX_ROWS_PER_GROUP),
      });
    }
    sources.push({ source: "Financial Integrity", available: true });
  } catch (err) {
    sources.push({ source: "Financial Integrity", available: false, error: errMsg(err) });
  }

  // ── Source 2: Fraud & control alerts (READ existing fraud_alerts) ──────────
  try {
    const alertRows = await db.execute<{
      id: number; alert_type: string; severity: string; title: string;
      description: string; affected_amount: string | null; bill_id: number | null;
      payment_id: number | null; created_at: string;
    }>(sql`
      SELECT id, alert_type, severity, title, description, affected_amount,
             bill_id, payment_id, created_at
        FROM fraud_alerts
       WHERE status IN ('open', 'investigating', 'escalated')
       ORDER BY created_at DESC
       LIMIT 500
    `);
    const byType = new Map<string, ReconExceptionGroup>();
    for (const r of alertRows.rows) {
      const key = `fraud:${r.alert_type}`;
      if (!byType.has(key)) {
        byType.set(key, {
          key,
          source: "Fraud & Control",
          category: humanizeAlertType(r.alert_type),
          severity: "low",
          count: 0,
          totalAmount: 0,
          description: r.description || `Open ${humanizeAlertType(r.alert_type)} alerts from continuous fraud detection.`,
          rows: [],
        });
      }
      const g = byType.get(key)!;
      g.count += 1;
      g.totalAmount += num(r.affected_amount);
      g.severity = maxSeverity(g.severity, normSeverity(r.severity));
      if (g.rows.length < MAX_ROWS_PER_GROUP) {
        g.rows.push({
          id: r.id, title: r.title, severity: r.severity,
          amount: num(r.affected_amount), billId: r.bill_id ?? "—",
          createdAt: r.created_at,
        });
      }
    }
    for (const g of byType.values()) exceptions.push(g);
    sources.push({ source: "Fraud & Control", available: true });
  } catch (err) {
    sources.push({ source: "Fraud & Control", available: false, error: errMsg(err) });
  }

  // ── Source 3: Bank reconciliation exceptions (READ banking tables) ─────────
  try {
    const unmatched = await db.execute<{
      id: number; transaction_date: string; amount: string; utr: string | null; description: string | null;
    }>(sql`
      SELECT id, transaction_date, amount, utr, description
        FROM bank_transactions
       WHERE reconciliation_status = 'unreconciled'
         AND transaction_date < NOW() - ${bankAgingInterval}::interval
       ORDER BY transaction_date DESC
       LIMIT ${MAX_ROWS_PER_GROUP}
    `);
    const unmatchedAgg = await db.execute<{ cnt: string; amount: string }>(sql`
      SELECT COUNT(*)::text AS cnt, COALESCE(SUM(amount::numeric), 0)::text AS amount
        FROM bank_transactions
       WHERE reconciliation_status = 'unreconciled'
         AND transaction_date < NOW() - ${bankAgingInterval}::interval
    `);
    const cnt = Number(unmatchedAgg.rows[0]?.cnt ?? 0);
    if (cnt > 0) {
      exceptions.push({
        key: "bank:unreconciled",
        source: "Bank Reconciliation",
        category: "Bank transactions not reconciled to any bill",
        severity: "medium",
        count: cnt,
        totalAmount: num(unmatchedAgg.rows[0]?.amount),
        description: `Bank statement lines older than ${bankAgingDays} day(s) that the auto-reconciliation engine could not match to an ERP payment/bill. Match them in Banking → Reconciliation, or they are money moved with no ERP counterpart.`,
        rows: unmatched.rows.map((r) => ({
          id: r.id, date: r.transaction_date, amount: num(r.amount),
          utr: r.utr ?? "—", description: r.description ?? "—",
        })),
      });
    }

    const failed = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt
        FROM reconciliation_logs
       WHERE status = 'failed'
    `);
    const failedCnt = Number(failed.rows[0]?.cnt ?? 0);
    if (failedCnt > 0) {
      exceptions.push({
        key: "bank:failed-recon",
        source: "Bank Reconciliation",
        category: "Failed reconciliation attempts needing manual review",
        severity: "low",
        count: failedCnt,
        totalAmount: 0,
        description: "Bank transactions the engine attempted but could not confidently match. Review and reconcile manually.",
        rows: [],
      });
    }
    sources.push({ source: "Bank Reconciliation", available: true });
  } catch (err) {
    sources.push({ source: "Bank Reconciliation", available: false, error: errMsg(err) });
  }

  // ── Source 4: Operations vs billing — unbilled service (NEW) ───────────────
  // Orders that have at least one active (non-cancelled) test but NO active
  // (non-cancelled) bill: a service was ordered/rendered but never billed =
  // direct revenue leakage. Aged by a grace window so an in-progress
  // registration isn't flagged mid-billing. bills.order_id is NOT NULL, so
  // "order with no non-cancelled bill" is a reliable signal.
  try {
    const unbilled = await db.execute<{
      order_id: number; order_number: string | null; created_at: string;
      test_count: string; amount: string;
    }>(sql`
      SELECT o.id AS order_id,
             o.order_number,
             o.created_at,
             COUNT(ot.id)::text AS test_count,
             COALESCE(SUM(ot.price::numeric), 0)::text AS amount
        FROM orders o
        JOIN order_tests ot ON ot.order_id = o.id AND ot.status <> 'cancelled'
        LEFT JOIN bills b ON b.order_id = o.id AND b.status <> 'cancelled'
       WHERE b.id IS NULL
         AND o.created_at >= ${from}::date
         AND o.created_at <  (${to}::date + INTERVAL '1 day')
         AND o.created_at <  NOW() - ${unbilledGraceInterval}::interval
       GROUP BY o.id, o.order_number, o.created_at
       ORDER BY SUM(ot.price::numeric) DESC NULLS LAST
       LIMIT ${MAX_ROWS_PER_GROUP}
    `);
    const totalAgg = await db.execute<{ cnt: string; amount: string }>(sql`
      SELECT COUNT(*)::text AS cnt, COALESCE(SUM(t.amt), 0)::text AS amount
        FROM (
          SELECT o.id, SUM(ot.price::numeric) AS amt
            FROM orders o
            JOIN order_tests ot ON ot.order_id = o.id AND ot.status <> 'cancelled'
            LEFT JOIN bills b ON b.order_id = o.id AND b.status <> 'cancelled'
           WHERE b.id IS NULL
             AND o.created_at >= ${from}::date
             AND o.created_at <  (${to}::date + INTERVAL '1 day')
             AND o.created_at <  NOW() - ${unbilledGraceInterval}::interval
           GROUP BY o.id
        ) t
    `);
    const cnt = Number(totalAgg.rows[0]?.cnt ?? 0);
    if (cnt > 0) {
      exceptions.push({
        key: "ops:unbilled-orders",
        source: "Operations vs Billing",
        category: "Completed/active tests with no bill (revenue leakage)",
        severity: "high",
        count: cnt,
        totalAmount: num(totalAgg.rows[0]?.amount),
        description: `Orders with active tests but no bill after a ${unbilledGraceHours}h grace window — service rendered that was never billed. Each row is an order that needs a bill raised or the tests cancelled.`,
        rows: unbilled.rows.map((r) => ({
          orderId: r.order_id, orderNumber: r.order_number ?? String(r.order_id),
          createdAt: r.created_at, tests: Number(r.test_count), amount: num(r.amount),
        })),
      });
    }
    sources.push({ source: "Operations vs Billing", available: true });
  } catch (err) {
    sources.push({ source: "Operations vs Billing", available: false, error: errMsg(err) });
  }

  // ── Source 5: Payment method exceptions (NEW, uses shared classifier) ──────
  // Surfaces payments whose method string the canonical classifier cannot
  // bucket (typos, a new gateway label not yet mapped). These are exactly the
  // rows that silently fall out of cash/digital totals on the older report
  // surfaces — here they are made visible instead.
  try {
    const methods = await db.execute<{ method: string | null; cnt: string; amount: string }>(sql`
      SELECT p.method AS method,
             COUNT(*)::text AS cnt,
             COALESCE(SUM(p.amount::numeric), 0)::text AS amount
        FROM payments p
       WHERE p.created_at >= ${from}::date
         AND p.created_at <  (${to}::date + INTERVAL '1 day')
         AND p.amount::numeric > 0
       GROUP BY p.method
    `);
    let unknownCount = 0;
    let unknownAmount = 0;
    const unknownRows: Record<string, unknown>[] = [];
    for (const r of methods.rows) {
      const classified = classifyPaymentMethod(r.method);
      if (classified.category === "unknown") {
        unknownCount += Number(r.cnt);
        unknownAmount += num(r.amount);
        unknownRows.push({
          method: r.method || "(blank)",
          classifiedAs: PAYMENT_METHOD_CATEGORY_LABEL.unknown,
          payments: Number(r.cnt),
          amount: num(r.amount),
        });
      }
    }
    if (unknownCount > 0) {
      exceptions.push({
        key: "payments:unclassified",
        source: "Payments",
        category: "Unclassified payment methods (excluded from cash & digital totals)",
        severity: "medium",
        count: unknownCount,
        totalAmount: unknownAmount,
        description: "Payments whose method is not recognized by the shared classifier. They are neither cash nor digital on the reconciliation surfaces and need their method corrected so the day's totals balance.",
        rows: unknownRows.slice(0, MAX_ROWS_PER_GROUP),
      });
    }
    sources.push({ source: "Payments", available: true });
  } catch (err) {
    sources.push({ source: "Payments", available: false, error: errMsg(err) });
  }

  // Order most-severe first, then by amount at risk.
  exceptions.sort((a, b) => {
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    return b.totalAmount - a.totalAmount;
  });

  const report: ReconciliationReport = {
    generatedAt: new Date().toISOString(),
    range: { from, to },
    summary: summarizeReconciliation(exceptions),
    sources,
    exceptions,
  };
  res.json(report);
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function humanizeAlertType(t: string): string {
  return (t || "alert")
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export default reconciliationRouter;
