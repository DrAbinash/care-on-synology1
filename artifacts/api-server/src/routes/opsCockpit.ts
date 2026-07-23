// Unified operational-health cockpit + proactive anomaly detection. Mounted at
// /api/ops-cockpit behind requireStaffAuth + requireAdminRole and ff_ops_cockpit
// (Shadow Mode). Read-only aggregation across existing tables + a detector that
// raises anomaly_alerts (the existing, UI-backed alert model) and nudges admins
// via the in-app notify() rail. Additive, non-financial — no new tables.
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  patientReportsTable, billsTable, anomalyAlertsTable, operationalHealthRunsTable,
  reportDeliveryReceiptsTable, recallQueueTable, usersTable,
} from "@workspace/db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { notify } from "../lib/notifications";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { evaluateMetrics, DEFAULT_OPS_THRESHOLDS, type AlertCandidate } from "../lib/opsAnomalyDetectors";
import { istDateOnly } from "../lib/recallEngine";
import { logger } from "../lib/logger";

export const opsCockpitRouter = Router();
opsCockpitRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_ops_cockpit")) { next(); return; }
  res.status(503).json({ error: "Operational cockpit is disabled. Enable ff_ops_cockpit." });
});

function startOfDay(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
const num = (v: unknown) => Number(v ?? 0) || 0;

async function countWhere(table: any, where: any): Promise<number> {
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(table).where(where);
  return num(r?.c);
}

// ── Unified KPI summary ───────────────────────────────────────────────────────
opsCockpitRouter.get("/summary", async (_req, res) => {
  const dayStart = startOfDay();

  const pendingReports = await countWhere(patientReportsTable, inArray(patientReportsTable.status, ["draft", "pending_verification"]));
  const deliveredToday = await countWhere(patientReportsTable, gte(patientReportsTable.deliveredAt, dayStart));
  const deliveryFailuresToday = await countWhere(reportDeliveryReceiptsTable, and(eq(reportDeliveryReceiptsTable.status, "failed"), gte(reportDeliveryReceiptsTable.sentAt, dayStart)));
  const pendingRecalls = await countWhere(recallQueueTable, eq(recallQueueTable.status, "pending"));

  const [bills] = await db.select({
    countToday: sql<number>`count(*) FILTER (WHERE ${billsTable.createdAt} >= ${dayStart})::int`,
    revenueToday: sql<string>`COALESCE(SUM(${billsTable.totalAmount}) FILTER (WHERE ${billsTable.createdAt} >= ${dayStart}), 0)`,
    outstanding: sql<string>`COALESCE(SUM(${billsTable.balanceAmount}) FILTER (WHERE ${billsTable.status} NOT IN ('paid','cancelled')), 0)`,
  }).from(billsTable);

  const alertRows = await db.select({ severity: anomalyAlertsTable.severity, c: sql<number>`count(*)::int` })
    .from(anomalyAlertsTable).where(eq(anomalyAlertsTable.status, "open")).groupBy(anomalyAlertsTable.severity);
  const openAlerts = { low: 0, medium: 0, high: 0, critical: 0, total: 0 };
  for (const a of alertRows) { if (a.severity in openAlerts) (openAlerts as Record<string, number>)[a.severity] = num(a.c); openAlerts.total += num(a.c); }

  const [smoke] = await db.select({ overallStatus: operationalHealthRunsTable.overallStatus, finishedAt: operationalHealthRunsTable.finishedAt, createdAt: operationalHealthRunsTable.createdAt })
    .from(operationalHealthRunsTable).orderBy(desc(operationalHealthRunsTable.createdAt)).limit(1);

  res.json({
    reports: { pending: pendingReports, deliveredToday },
    delivery: { failuresToday: deliveryFailuresToday },
    recall: { pending: pendingRecalls },
    billing: { billsToday: num(bills?.countToday), revenueToday: num(bills?.revenueToday), outstanding: num(bills?.outstanding) },
    alerts: openAlerts,
    smokeTest: smoke ? { status: smoke.overallStatus, at: smoke.finishedAt ?? smoke.createdAt } : null,
    generatedAt: new Date().toISOString(),
  });
});

// ── Open alerts list (cockpit view) ───────────────────────────────────────────
opsCockpitRouter.get("/alerts", async (_req, res) => {
  const rows = await db.select().from(anomalyAlertsTable)
    .where(eq(anomalyAlertsTable.status, "open"))
    .orderBy(desc(anomalyAlertsTable.createdAt)).limit(100);
  res.json(rows);
});

// ── Manual scan trigger ───────────────────────────────────────────────────────
opsCockpitRouter.post("/scan", async (req, res) => {
  const r = await runOpsAnomalyScan();
  const s = (req as StaffAuthRequest).staffSession;
  auditFromRequest(req, { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system", module: "ops_cockpit", action: "scan", newValue: JSON.stringify(r) });
  res.json(r);
});

/**
 * Gather live metrics, evaluate thresholds, and raise anomaly_alerts for any
 * breach that isn't already open today (dedupe by alertType+scope). Notifies
 * admins in-app for high/critical. Never throws.
 */
export async function runOpsAnomalyScan(): Promise<{ skipped?: boolean; reason?: string; scanned: number; created: number; deduped: number }> {
  if (!(await isFeatureEnabledServer("ff_ops_cockpit"))) return { skipped: true, reason: "disabled", scanned: 0, created: 0, deduped: 0 };
  try {
    const today = istDateOnly(new Date());
    const pendingReports = await countWhere(patientReportsTable, inArray(patientReportsTable.status, ["draft", "pending_verification"]));
    const deliveryFailures = await countWhere(reportDeliveryReceiptsTable, and(eq(reportDeliveryReceiptsTable.status, "failed"), gte(reportDeliveryReceiptsTable.sentAt, startOfDay())));
    const overdueRecalls = await countWhere(recallQueueTable, and(eq(recallQueueTable.status, "pending"), lte(recallQueueTable.dueDate, today)));

    const candidates = evaluateMetrics([
      { ...DEFAULT_OPS_THRESHOLDS.pendingReports, value: pendingReports },
      { ...DEFAULT_OPS_THRESHOLDS.deliveryFailures, value: deliveryFailures },
      { ...DEFAULT_OPS_THRESHOLDS.overdueRecalls, value: overdueRecalls },
    ]);

    const dayStart = startOfDay();
    let created = 0, deduped = 0;
    for (const c of candidates) {
      const existing = await countWhere(anomalyAlertsTable, and(
        eq(anomalyAlertsTable.alertType, c.alertType),
        eq(anomalyAlertsTable.scope, c.scope),
        eq(anomalyAlertsTable.status, "open"),
        gte(anomalyAlertsTable.createdAt, dayStart),
      ));
      if (existing > 0) { deduped++; continue; }
      const [row] = await db.insert(anomalyAlertsTable).values({ alertType: c.alertType, severity: c.severity, message: c.message, scope: c.scope, status: "open" }).returning({ id: anomalyAlertsTable.id });
      created++;
      if ((c.severity === "high" || c.severity === "critical") && row) await notifyAdmins(c, row.id);
    }
    return { scanned: candidates.length, created, deduped };
  } catch (err) {
    logger.warn({ err }, "[ops-cockpit] scan failed (non-fatal)");
    return { scanned: 0, created: 0, deduped: 0 };
  }
}

async function notifyAdmins(c: AlertCandidate, alertId: number): Promise<void> {
  try {
    const admins = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(inArray(usersTable.role, ["admin", "super_admin"]), eq(usersTable.isActive, true)));
    for (const a of admins) {
      await notify({ userId: a.id, type: "ops_alert", title: `Operational alert: ${c.alertType}`, body: c.message, refType: "anomaly_alert", refId: String(alertId) });
    }
  } catch { /* best-effort */ }
}

export default opsCockpitRouter;
