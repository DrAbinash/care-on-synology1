/**
 * RIS/PACS Production Monitoring & Hardening — Phase 11
 * Mounted at /api/ris-monitor (staff-auth required)
 *
 * 1. DICOM Acquisition Monitor
 * 2. Auto Retry Queue
 * 3. Storage Dashboard
 * 4. Backup Verification
 * 5. Downtime Mode (offline sync)
 * 6. Audit Export
 * 7. Report Delivery Tracking
 * 8. Critical Result Escalation
 * 9. Daily Operations Dashboard
 * 10. System Health Watchdog
 *
 * Safety: All routes role-gated. Read-only where possible.
 */

import { Router, type Request } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  dicomRetryQueueTable, storageMetricsTable, backupVerificationTable,
  reportDeliveryTrackingTable, criticalEscalationTable, systemHealthSnapshotTable,
  dicomPullAgentStatusTable, dicomPullAgentLogsTable, dicomModalitiesTable,
  dicomStudiesTable, dicomPulledStudiesTable, dicomFailedRetrievalQueueTable,
  syncQueueTable, backupLogsTable, radiologyCriticalFindingsTable,
  dicomStudyAuditLogTable, drawerAuditLogTable, usgReportDraftsTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, asc, gte, lte, isNull, isNotNull } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { geminiGenerate } from "@workspace/integrations-gemini-ai";
import { auditFromRequest } from "../lib/audit";

const router = Router();

function staffOf(req: Request) {
  return (req as StaffAuthRequest).staffSession!;
}
function requireRole(req: Request, ...roles: string[]) {
  const s = staffOf(req);
  return !!s.role && roles.includes(s.role);
}
const requireRad = (req: Request) => requireRole(req, "radiologist", "admin", "super_admin");
const requireAdmin = (req: Request) => requireRole(req, "admin", "super_admin");
const requireStaff = (req: Request) => !!staffOf(req).subjectId;

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// ── 1. DICOM Acquisition Monitor ───────────────────────────────────────────────────────────────────────────────

router.get("/acquisition", async (_req, res) => {
  // Agent status
  const agents = await db.select().from(dicomPullAgentStatusTable).orderBy(desc(dicomPullAgentStatusTable.lastHeartbeatAt));
  // Modality health (imaging machines)
  const machines = await db.select().from(dicomModalitiesTable).where(eq(dicomModalitiesTable.isActive, true)).orderBy(asc(dicomModalitiesTable.machineName));
  // Last studies per machine
  const studies = await db.select({
    modality: dicomStudiesTable.modality,
    count: sql<number>`count(*)`,
    lastAt: sql<string>`max(${dicomStudiesTable.createdAt})`,
  }).from(dicomStudiesTable)
    .where(gte(dicomStudiesTable.createdAt, todayStart()))
    .groupBy(dicomStudiesTable.modality);

  // Failed transfers today
  const [failedToday] = await db.select({ count: sql<number>`count(*)` }).from(dicomFailedRetrievalQueueTable)
    .where(gte(dicomFailedRetrievalQueueTable.createdAt, todayStart()));

  res.json({ agents, machines, studiesToday: studies, failedTransfersToday: failedToday?.count ?? 0 });
});

// ── 2. Auto Retry Queue ──────────────────────────────────────────────────────────────────────────────────────

router.get("/retry-queue", async (req, res) => {
  const status = req.query.status as string | undefined;
  const q = status
    ? db.select().from(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.status, status)).orderBy(desc(dicomRetryQueueTable.createdAt))
    : db.select().from(dicomRetryQueueTable).orderBy(desc(dicomRetryQueueTable.createdAt));
  const rows = await q.limit(200);
  res.json(rows);
});

router.post("/retry-queue", async (req, res) => {
  const parsed = z.object({
    operationType: z.string(), entityId: z.number().optional(), entityType: z.string(),
    failureReason: z.string(), errorDetailsJson: z.string().optional(),
    maxRetries: z.number().default(5),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(dicomRetryQueueTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

router.patch("/retry-queue/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(dicomRetryQueueTable).set({
    status: "retrying", retryCount: sql`${dicomRetryQueueTable.retryCount} + 1`,
    lastAttemptedAt: new Date(), updatedAt: new Date(),
  }).where(eq(dicomRetryQueueTable.id, id)).returning();
  res.json(row);
});

router.patch("/retry-queue/:id/abandon", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const id = Number(req.params.id);
  const [row] = await db.update(dicomRetryQueueTable).set({ status: "abandoned", updatedAt: new Date() }).where(eq(dicomRetryQueueTable.id, id)).returning();
  res.json(row);
});

// ── 3. Storage Dashboard ──────────────────────────────────────────────────────────────────────────────────────────

router.get("/storage", async (_req, res) => {
  // Aggregate from dicomStudies
  const [total] = await db.select({
    count: sql<number>`count(*)`,
    totalImages: sql<number>`COALESCE(SUM(${dicomStudiesTable.numberOfImages}), 0)`,
  }).from(dicomStudiesTable);

  const byModality = await db.select({
    modality: dicomStudiesTable.modality,
    count: sql<number>`count(*)`,
    images: sql<number>`COALESCE(SUM(${dicomStudiesTable.numberOfImages}), 0)`,
  }).from(dicomStudiesTable).groupBy(dicomStudiesTable.modality);

  const todayCount = await db.select({ count: sql<number>`count(*)` }).from(dicomStudiesTable)
    .where(gte(dicomStudiesTable.createdAt, todayStart()));

  // Storage metrics snapshots
  const latest = await db.select().from(storageMetricsTable).orderBy(desc(storageMetricsTable.snapshotDate)).limit(1);

  res.json({
    totalStudies: total.count,
    totalImages: total.totalImages,
    studiesToday: todayCount[0]?.count ?? 0,
    byModality,
    latestSnapshot: latest[0] ?? null,
  });
});

router.post("/storage/snapshot", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const parsed = z.object({
    totalBytesUsed: z.number(), totalStudies: z.number(),
    studiesByModalityJson: z.string(), dailyGrowthBytes: z.number().optional(),
    archiveBytes: z.number().optional(), hotStorageBytes: z.number().optional(),
    thresholdPercent: z.number().default(80),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const b = parsed.data;
  const alertTriggered = b.thresholdPercent >= 80;
  const [row] = await db.insert(storageMetricsTable).values({
    totalBytesUsed: b.totalBytesUsed, totalStudies: b.totalStudies,
    studiesByModalityJson: b.studiesByModalityJson,
    dailyGrowthBytes: b.dailyGrowthBytes ?? 0,
    archiveBytes: b.archiveBytes ?? 0,
    hotStorageBytes: b.hotStorageBytes ?? 0,
    thresholdPercent: b.thresholdPercent,
    alertTriggered,
  }).returning();
  res.status(201).json(row);
});

// ── 4. Backup Verification ──────────────────────────────────────────────────────────────────────────────────────

router.get("/backup", async (_req, res) => {
  const backupLogs = await db.select().from(backupLogsTable).orderBy(desc(backupLogsTable.createdAt)).limit(20);
  const verifications = await db.select().from(backupVerificationTable).orderBy(desc(backupVerificationTable.lastAttemptedAt)).limit(20);
  res.json({ backupLogs, verifications });
});

router.post("/backup/verify", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const parsed = z.object({
    backupType: z.string(), status: z.string(), sizeBytes: z.number().optional(),
    rowCount: z.number().optional(), restoreTestStatus: z.string().optional(),
    restoreTestDetails: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const b = parsed.data;
  const alertSent = b.status !== "success";
  const lastSuccessfulAt = b.status === "success" ? new Date() : null;
  const [row] = await db.insert(backupVerificationTable).values({
    backupType: b.backupType, status: b.status, sizeBytes: b.sizeBytes ?? null,
    rowCount: b.rowCount ?? null, restoreTestStatus: b.restoreTestStatus ?? "not_tested",
    restoreTestDetails: b.restoreTestDetails ?? null,
    alertSent, lastSuccessfulAt, lastAttemptedAt: new Date(),
  }).returning();
  res.status(201).json(row);
});

// ── 5. Downtime Mode (offline sync queue) ─────────────────────────────────────────────────────────────────────────

router.get("/downtime/pending", async (_req, res) => {
  const pending = await db.select().from(syncQueueTable).where(eq(syncQueueTable.isSynced, false)).orderBy(asc(syncQueueTable.createdAt)).limit(200);
  res.json(pending);
});

router.get("/downtime/conflicts", async (_req, res) => {
  const conflicts = await db.select().from(syncQueueTable)
    .where(and(eq(syncQueueTable.isSynced, false), isNotNull(syncQueueTable.syncResult)))
    .orderBy(desc(syncQueueTable.createdAt)).limit(100);
  res.json(conflicts);
});

router.post("/downtime/resolve", async (req, res) => {
  if (!requireStaff(req)) { res.status(403).json({ error: "Staff access required" }); return; }
  const parsed = z.object({ queueId: z.number(), strategy: z.enum(["server_wins", "local_wins", "merge"] as [string, ...string[]]) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.update(syncQueueTable).set({
    conflictStrategy: parsed.data.strategy,
  }).where(eq(syncQueueTable.id, parsed.data.queueId)).returning();
  res.json(row);
});

// ── 6. Audit Export ─────────────────────────────────────────────────────────────────────────────────────────

router.get("/audit-export", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const from = req.query.from as string;
  const to = req.query.to as string;
  const user = req.query.user as string | undefined;
  const studyId = req.query.studyId as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 1000), 5000);

  const start = from ? new Date(from) : new Date(Date.now() - 86400000 * 7);
  const end = to ? new Date(to) : new Date();

  const base = and(
    gte(dicomStudyAuditLogTable.createdAt, start),
    lte(dicomStudyAuditLogTable.createdAt, end),
  );
  const conditions = [base];
  if (user) conditions.push(sql`${dicomStudyAuditLogTable.actorName} = ${user}`);
  if (studyId) conditions.push(eq(dicomStudyAuditLogTable.studyId, Number(studyId)));

  const rows = await db.select().from(dicomStudyAuditLogTable)
    .where(and(...conditions))
    .orderBy(desc(dicomStudyAuditLogTable.createdAt))
    .limit(limit);

  // CSV format if requested
  if (req.query.format === "csv") {
    const header = "timestamp,action,actor,role,studyId,details\n";
    const csv = header + rows.map(r =>
      `"${r.createdAt.toISOString()}","${r.action}","${r.actorName ?? ""}","${r.actorRole ?? ""}","${r.studyId ?? ""}","${(r.details ?? "").replace(/"/g, "'")}"`
    ).join("\n");
    const s = staffOf(req);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=audit-export.csv");
    res.send(csv);

    void auditFromRequest(req, {
      userId: s.subjectId,
      userName: s.subjectName,
      role: s.role,
      action: "export",
      module: "radiology",
      entityType: "dicom_audit",
      entityId: studyId ?? "all",
      reason: `RIS audit export: ${rows.length} rows, user=${user ?? "all"}, studyId=${studyId ?? "all"}`,
    });
    return;
  }

  res.json({ count: rows.length, from: start.toISOString(), to: end.toISOString(), rows });
  return;
});

// ── 7. Report Delivery Tracking ──────────────────────────────────────────────────────────────────────────────────────

router.get("/delivery", async (req, res) => {
  const reportDraftId = req.query.reportDraftId ? Number(req.query.reportDraftId) : undefined;
  const q = reportDraftId
    ? db.select().from(reportDeliveryTrackingTable).where(eq(reportDeliveryTrackingTable.reportDraftId, reportDraftId)).orderBy(desc(reportDeliveryTrackingTable.createdAt))
    : db.select().from(reportDeliveryTrackingTable).orderBy(desc(reportDeliveryTrackingTable.createdAt)).limit(200);
  const rows = await q;
  res.json(rows);
});

router.post("/delivery", async (req, res) => {
  const parsed = z.object({
    reportDraftId: z.number(), studyId: z.number().optional(), patientId: z.number().optional(),
    whatsappStatus: z.string().optional(), printStatus: z.string().optional(),
    portalViewedAt: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const b = parsed.data;
  const [existing] = await db.select().from(reportDeliveryTrackingTable).where(eq(reportDeliveryTrackingTable.reportDraftId, b.reportDraftId)).limit(1);
  if (existing) {
    const [row] = await db.update(reportDeliveryTrackingTable).set({
      whatsappStatus: b.whatsappStatus ?? existing.whatsappStatus,
      printStatus: b.printStatus ?? existing.printStatus,
      portalViewedAt: b.portalViewedAt ? new Date(b.portalViewedAt) : existing.portalViewedAt,
      portalViewCount: b.portalViewedAt ? sql`${reportDeliveryTrackingTable.portalViewCount} + 1` : existing.portalViewCount,
      lastUpdatedAt: new Date(),
    }).where(eq(reportDeliveryTrackingTable.id, existing.id)).returning();
    res.json(row);
  } else {
    const [row] = await db.insert(reportDeliveryTrackingTable).values({
      reportDraftId: b.reportDraftId, studyId: b.studyId ?? null, patientId: b.patientId ?? null,
      whatsappStatus: b.whatsappStatus ?? "pending",
      printStatus: b.printStatus ?? "pending",
      portalViewedAt: b.portalViewedAt ? new Date(b.portalViewedAt) : null,
    } as any).returning();
    res.status(201).json(row);
  }
});

// ── 8. Critical Result Escalation ────────────────────────────────────────────────────────────────────────────────────

router.get("/critical-escalation", async (_req, res) => {
  const findings = await db.select().from(radiologyCriticalFindingsTable)
    .where(isNull(radiologyCriticalFindingsTable.acknowledgedAt))
    .orderBy(desc(radiologyCriticalFindingsTable.createdAt)).limit(50);
  const escalations = await db.select().from(criticalEscalationTable)
    .where(eq(criticalEscalationTable.resolutionStatus, "open"))
    .orderBy(desc(criticalEscalationTable.escalatedAt)).limit(50);
  res.json({ openFindings: findings, openEscalations: escalations });
});

router.post("/critical-escalation", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const parsed = z.object({
    criticalFindingId: z.number(), escalatedTo: z.string(), escalatedToRole: z.string(),
    notificationMethod: z.string(), escalationLevel: z.number().default(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(criticalEscalationTable).values({
    ...parsed.data, resolutionStatus: "open",
  } as any).returning();
  res.status(201).json(row);
});

router.patch("/critical-escalation/:id/acknowledge", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const s = staffOf(req);
  const [row] = await db.update(criticalEscalationTable).set({
    acknowledgedAt: new Date(), acknowledgedBy: s.subjectName,
    resolutionStatus: "acknowledged", updatedAt: new Date(),
  }).where(eq(criticalEscalationTable.id, id)).returning();
  res.json(row);
});

router.patch("/critical-escalation/:id/escalate", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const id = Number(req.params.id);
  const parsed = z.object({ escalatedTo: z.string(), escalatedToRole: z.string(), notificationMethod: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [existing] = await db.select().from(criticalEscalationTable).where(eq(criticalEscalationTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.update(criticalEscalationTable).set({
    escalationLevel: existing.escalationLevel + 1,
    escalatedTo: parsed.data.escalatedTo,
    escalatedToRole: parsed.data.escalatedToRole,
    notificationMethod: parsed.data.notificationMethod,
    escalatedAt: new Date(),
    resolutionStatus: "escalated",
    updatedAt: new Date(),
  }).where(eq(criticalEscalationTable.id, id)).returning();
  res.json(row);
});

// ── 9. Daily Operations Dashboard ──────────────────────────────────────────────────────────────────────────────────────

router.get("/daily-ops", async (_req, res) => {
  const start = todayStart();
  const end = new Date();

  // Studies received today
  const [studiesToday] = await db.select({ count: sql<number>`count(*)` }).from(dicomStudiesTable).where(gte(dicomStudiesTable.createdAt, start));
  // Pending reports
  const [pendingReports] = await db.select({ count: sql<number>`count(*)` }).from(usgReportDraftsTable).where(eq(usgReportDraftsTable.status, "draft"));
  // Finalized today
  const [finalizedToday] = await db.select({ count: sql<number>`count(*)` }).from(usgReportDraftsTable).where(gte(usgReportDraftsTable.updatedAt, start));
  // Critical alerts today
  const [criticalToday] = await db.select({ count: sql<number>`count(*)` }).from(radiologyCriticalFindingsTable).where(gte(radiologyCriticalFindingsTable.createdAt, start));
  // Failed transfers today
  const [failedToday] = await db.select({ count: sql<number>`count(*)` }).from(dicomFailedRetrievalQueueTable).where(gte(dicomFailedRetrievalQueueTable.createdAt, start));
  // Backup status
  const [latestBackup] = await db.select().from(backupLogsTable).orderBy(desc(backupLogsTable.createdAt)).limit(1);
  // Storage latest
  const [latestStorage] = await db.select().from(storageMetricsTable).orderBy(desc(storageMetricsTable.snapshotDate)).limit(1);
  // Retry queue pending
  const [pendingRetries] = await db.select({ count: sql<number>`count(*)` }).from(dicomRetryQueueTable).where(eq(dicomRetryQueueTable.status, "pending"));

  // TAT average today
  const [avgTat] = await db.select({ avg: sql<number | null>`avg(${sql.raw("report_tat_minutes")})` }).from(sql.raw("study_tat_metrics")).where(sql`${sql.raw("report_finalized_at")} >= ${start}`);

  res.json({
    date: start.toISOString().split("T")[0],
    studiesReceived: studiesToday.count,
    reportsPending: pendingReports.count,
    reportsFinalized: finalizedToday.count,
    criticalAlerts: criticalToday.count,
    failedTransfers: failedToday.count,
    backupStatus: latestBackup?.status ?? "unknown",
    backupLastAt: latestBackup?.createdAt ?? null,
    storageAlert: latestStorage?.alertTriggered ?? false,
    storageUsedPercent: latestStorage?.thresholdPercent ?? 0,
    pendingRetries: pendingRetries.count,
    avgReportTatMinutes: avgTat?.avg ? Math.round(avgTat.avg) : null,
  });
});

// ── 10. System Health Watchdog ──────────────────────────────────────────────────────────────────────────────────────

router.get("/health", async (_req, res) => {
  const latest = await db.select().from(systemHealthSnapshotTable).orderBy(desc(systemHealthSnapshotTable.snapshotAt)).limit(1);
  const dbHealth = "ok"; // we just queried successfully
  const [pacsStatus] = await db.select().from(dicomPullAgentStatusTable).where(eq(dicomPullAgentStatusTable.isOnline, true)).limit(1);
  const pacsHealth = pacsStatus ? "ok" : "degraded";

  res.json({
    snapshot: latest[0] ?? null,
    liveChecks: {
      api: "ok",
      db: dbHealth,
      pacs: pacsHealth,
      aiService: latest[0]?.aiServiceHealth ?? "ok",
      frontend: latest[0]?.frontendHealth ?? "ok",
    },
    uptime: process.uptime(),
  });
});

router.post("/health", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const parsed = z.object({
    apiHealth: z.string().default("ok"),
    dbHealth: z.string().default("ok"),
    pacsHealth: z.string().default("ok"),
    aiServiceHealth: z.string().default("ok"),
    frontendHealth: z.string().default("ok"),
    diskUsagePercent: z.number().optional(),
    memoryUsagePercent: z.number().optional(),
    uptimeMinutes: z.number().optional(),
    detailsJson: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(systemHealthSnapshotTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

export default router;
