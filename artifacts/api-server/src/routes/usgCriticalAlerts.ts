/**
 * USG Critical Findings & Productivity Routes — Phase 9
 * Mounted at: /api/usg-critical  (staff-auth required)
 *
 * Reuses the existing `critical_findings_alerts` table but filters by
 * modality IN ('US','USG') for the USG / DOPPLER module surface.
 *
 * GET    /alerts                       — list active USG critical alerts
 * GET    /alerts/overdue               — alerts past escalation timer
 * POST   /alerts                       — flag a new critical finding
 * POST   /alerts/:id/acknowledge       — acknowledge
 * POST   /alerts/:id/resolve           — mark resolved
 * POST   /alerts/:id/escalate         — manual escalation
 *
 * GET    /productivity?period=daily&days=7 — radiologist productivity stats for USG
 * GET    /audit                        — audit-log feed (filterable)
 */

import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  criticalFindingsAlertsTable,
  usgAuditLogTable,
  usgReportDraftsTable,
  usgMeasurementsTable,
  usgDopplerMeasurementsTable,
} from "@workspace/db/schema";
import { eq, desc, and, sql, inArray, gte } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

type ReqWithStaff = Request & { staffSession?: { subjectId?: number; subjectName?: string; role?: string } };
function staffOf(req: Request): { subjectId?: number; subjectName?: string; role?: string } {
  return (req as ReqWithStaff).staffSession ?? {};
}

// Escalation timer in minutes (configurable via query or env; default 30)
const ESCALATION_MINUTES = 30;

// Placeholder notification hooks — no real sending unless credentials configured.
async function notifyEscalation(_alertId: number, _channels: string[]) {
  // Future: integrate WhatsApp Business API, SMS gateway, email SMTP here.
  logger.info({ alertId: _alertId, channels: _channels }, "Escalation notification placeholder");
}

// ── GET /alerts ────────────────────────────────────────────────────

router.get("/alerts", async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "active";
  const rows = await db.select()
    .from(criticalFindingsAlertsTable)
    .where(and(
      inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
      eq(criticalFindingsAlertsTable.status, status),
    ))
    .orderBy(desc(criticalFindingsAlertsTable.createdAt))
    .limit(100);
  res.json(rows);
});

// ── GET /alerts/overdue ────────────────────────────────────────────────────

router.get("/alerts/overdue", async (_req, res) => {
  const cutoff = new Date(Date.now() - ESCALATION_MINUTES * 60 * 1000);
  const rows = await db.select()
    .from(criticalFindingsAlertsTable)
    .where(and(
      inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
      eq(criticalFindingsAlertsTable.status, "active"),
      gte(criticalFindingsAlertsTable.createdAt, new Date(0)),
    ))
    .orderBy(desc(criticalFindingsAlertsTable.createdAt))
    .limit(100);

  const overdue = rows.filter((r) => new Date(r.createdAt) < cutoff);
  res.json({ overdue, escalationMinutes: ESCALATION_MINUTES });
});

// ── POST /alerts ────────────────────────────────────────────────────

router.post("/alerts", async (req, res) => {
  const b = (req.body ?? {}) as {
    worklistId?: number; studyId?: number; accessionNumber?: string;
    patientId?: number; patientName?: string; studyDescription?: string;
    severity?: string; findingType?: string; description?: string;
    flaggedBy?: string;
  };

  if (!b.accessionNumber || !b.patientName || !b.findingType || !b.description) {
    res.status(400).json({ error: "accessionNumber, patientName, findingType, description required" });
    return;
  }

  try {
    const [row] = await db.insert(criticalFindingsAlertsTable).values({
      worklistId:       b.worklistId ?? null,
      studyId:          b.studyId ?? null,
      accessionNumber:  b.accessionNumber,
      patientId:        b.patientId ?? null,
      patientName:      b.patientName,
      modality:         "USG",
      studyDescription: b.studyDescription ?? null,
      severity:         b.severity ?? "high",
      findingType:      b.findingType,
      description:      b.description,
      flaggedBy:        b.flaggedBy ?? staffOf(req).subjectName ?? "staff",
      flaggedById:      staffOf(req).subjectId ?? null,
      status:           "active",
    }).returning();

    void db.insert(usgAuditLogTable).values({
      entityType:    "critical_alert",
      entityId:      row.id,
      action:        "critical_flag",
      performedBy:   staffOf(req).subjectName ?? "staff",
      performedById: staffOf(req).subjectId ?? null,
      patientId:     b.patientId ?? null,
      details:       JSON.stringify({ findingType: b.findingType, severity: b.severity ?? "high" }),
    }).catch(() => { /* noop */ });

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "create USG critical alert failed");
    res.status(500).json({ error: "Failed to create alert" });
  }
});

// ── POST /alerts/:id/acknowledge ───────────────────────────────────────────────────

router.post("/alerts/:id/acknowledge", async (req, res) => {
  const id = Number(req.params.id);
  const ackBy = staffOf(req).subjectName ?? "staff";
  const [row] = await db.update(criticalFindingsAlertsTable)
    .set({ acknowledged: true, acknowledgedBy: ackBy, acknowledgedAt: new Date(), status: "acknowledged" })
    .where(and(
      eq(criticalFindingsAlertsTable.id, id),
      inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found or not a USG alert" }); return; }

  void db.insert(usgAuditLogTable).values({
    entityType: "critical_alert", entityId: id, action: "critical_ack",
    performedBy: ackBy, performedById: staffOf(req).subjectId ?? null,
    details: "{}",
  }).catch(() => { /* noop */ });
  res.json(row);
});

// ── POST /alerts/:id/resolve ───────────────────────────────────────────────────

router.post("/alerts/:id/resolve", async (req, res) => {
  const id = Number(req.params.id);
  const resolvedBy = staffOf(req).subjectName ?? "staff";
  const [row] = await db.update(criticalFindingsAlertsTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(and(
      eq(criticalFindingsAlertsTable.id, id),
      inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found or not a USG alert" }); return; }

  void db.insert(usgAuditLogTable).values({
    entityType: "critical_alert", entityId: id, action: "critical_resolve",
    performedBy: resolvedBy, performedById: staffOf(req).subjectId ?? null,
    details: "{}",
  }).catch(() => { /* noop */ });
  res.json(row);
});

// ── POST /alerts/:id/escalate ───────────────────────────────────────────────────

router.post("/alerts/:id/escalate", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { escalatedTo?: string; channels?: string[] };
  const [row] = await db.update(criticalFindingsAlertsTable)
    .set({
      status: "escalated",
      escalatedTo: b.escalatedTo ?? staffOf(req).subjectName ?? "staff",
      // notifyEscalation() below is a placeholder — it never confirms real
      // delivery over any channel (see its own comment) — so this must stay
      // false. Recording the escalation itself (status/escalatedTo) is an
      // honest manual event; claiming a notification was sent when nothing
      // dispatched is not.
      escalationSent: false,
    })
    .where(and(
      eq(criticalFindingsAlertsTable.id, id),
      inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found or not a USG alert" }); return; }

  void notifyEscalation(id, b.channels ?? ["push"]);

  void db.insert(usgAuditLogTable).values({
    entityType: "critical_alert", entityId: id, action: "critical_escalate",
    performedBy: staffOf(req).subjectName ?? "staff", performedById: staffOf(req).subjectId ?? null,
    details: JSON.stringify({ escalatedTo: b.escalatedTo }),
  }).catch(() => { /* noop */ });

  res.json(row);
});

// ── GET /productivity ────────────────────────────────────────────────────

router.get("/productivity", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 90);
  const since = new Date(Date.now() - days * 86400 * 1000);

  try {
    const perUser = await db.execute(sql`
      SELECT
        COALESCE(finalized_by, 'Unknown') AS finalized_by,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count,
        COUNT(*) FILTER (WHERE status IN ('draft','pending_review','verified')) AS open_count,
        AVG(EXTRACT(EPOCH FROM (finalized_at - created_at)) / 60)
          FILTER (WHERE finalized_at IS NOT NULL) AS avg_tat_min
      FROM usg_report_drafts
      WHERE created_at >= ${since.toISOString()}
      GROUP BY finalized_by
      ORDER BY finalized_count DESC
      LIMIT 50
    `);

    const [overall] = await db.select({
      drafts:    sql<number>`count(*) filter (where status = 'draft')`,
      pending:   sql<number>`count(*) filter (where status = 'pending_review')`,
      verified:  sql<number>`count(*) filter (where status = 'verified')`,
      finalized: sql<number>`count(*) filter (where status = 'finalized')`,
      amended:   sql<number>`count(*) filter (where status = 'amended')`,
      total:     sql<number>`count(*)`,
    })
      .from(usgReportDraftsTable)
      .where(gte(usgReportDraftsTable.createdAt, since));

    const [measStats] = await db.select({
      approved: sql<number>`count(*) filter (where status = 'approved')`,
      pending:  sql<number>`count(*) filter (where status = 'pending_review')`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')`,
    }).from(usgMeasurementsTable).where(gte(usgMeasurementsTable.createdAt, since));

    const [dopStats] = await db.select({
      approved: sql<number>`count(*) filter (where status = 'approved')`,
      pending:  sql<number>`count(*) filter (where status = 'pending_review')`,
    }).from(usgDopplerMeasurementsTable).where(gte(usgDopplerMeasurementsTable.createdAt, since));

    const [criticalCount] = await db.select({ total: sql<number>`count(*)` })
      .from(criticalFindingsAlertsTable)
      .where(and(
        inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
        gte(criticalFindingsAlertsTable.createdAt, since),
      ));

    res.json({
      windowDays: days,
      since: since.toISOString(),
      perUser: (perUser.rows as Array<{
        finalized_by: string;
        finalized_count: number | string;
        open_count: number | string;
        avg_tat_min: number | string | null;
      }>).map((r) => ({
        userName:       r.finalized_by,
        finalizedCount: Number(r.finalized_count ?? 0),
        openCount:      Number(r.open_count ?? 0),
        avgTatMinutes:  r.avg_tat_min === null ? null : Math.round(Number(r.avg_tat_min)),
      })),
      reports: {
        drafts:    Number(overall?.drafts    ?? 0),
        pending:   Number(overall?.pending   ?? 0),
        verified:  Number(overall?.verified  ?? 0),
        finalized: Number(overall?.finalized ?? 0),
        amended:   Number(overall?.amended   ?? 0),
        total:     Number(overall?.total     ?? 0),
      },
      measurements: {
        approved: Number(measStats?.approved ?? 0),
        pending:  Number(measStats?.pending  ?? 0),
        rejected: Number(measStats?.rejected ?? 0),
      },
      doppler: {
        approved: Number(dopStats?.approved ?? 0),
        pending:  Number(dopStats?.pending  ?? 0),
      },
      criticalAlerts: Number(criticalCount?.total ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "USG productivity stats failed");
    res.status(500).json({ error: "Failed to load productivity stats" });
  }
});

// ── GET /audit ────────────────────────────────────────────────────

router.get("/audit", async (req, res) => {
  const entityType = req.query.entityType as string | undefined;
  const studyUid   = req.query.studyUid   as string | undefined;
  const patientId  = req.query.patientId  as string | undefined;
  const limit      = Math.min(Number(req.query.limit ?? 100), 500);

  const conditions = [];
  if (entityType) conditions.push(eq(usgAuditLogTable.entityType, entityType));
  if (studyUid)   conditions.push(eq(usgAuditLogTable.studyInstanceUID, studyUid));
  if (patientId)  conditions.push(eq(usgAuditLogTable.patientId, Number(patientId)));

  let q = db.select().from(usgAuditLogTable).$dynamic();
  if (conditions.length) q = q.where(and(...conditions));
  const rows = await q.orderBy(desc(usgAuditLogTable.createdAt)).limit(limit);
  res.json(rows);
});

export const usgCriticalAlertsRouter = router;
