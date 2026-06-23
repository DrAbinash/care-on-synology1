/**
 * USG / DOPPLER Analytics Routes
 * Mounted at: /api/usg-analytics  (staff-auth required)
 *
 * GET /dashboard          — all KPI cards for the USG module landing page
 * GET /by-radiologist   — radiologist-wise report count + TAT
 * GET /by-template      — template-wise usage + correction rate
 * GET /prior-comparison/:patientId — smart prior delta for a patient
 */

import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  usgReportDraftsTable,
  usgMeasurementsTable,
  usgDopplerMeasurementsTable,
  criticalFindingsAlertsTable,
} from "@workspace/db/schema";
import { eq, desc, and, sql, gte, inArray, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

type ReqWithStaff = Request & { staffSession?: { subjectId?: number; subjectName?: string; role?: string } };
function staffOf(req: Request): { subjectId?: number; subjectName?: string; role?: string } {
  return (req as ReqWithStaff).staffSession ?? {};
}

// ── GET /dashboard ─────────────────────────────────────────────────────────────

router.get("/dashboard", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 1), 1), 90);
  const since = new Date(Date.now() - days * 86400 * 1000);

  try {
    // Today-only counts
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayReports] = await db.select({
      drafts:    sql<number>`count(*) filter (where status = 'draft' and created_at >= ${todayStart.toISOString()})`,
      verified:  sql<number>`count(*) filter (where status = 'verified' and verified_at >= ${todayStart.toISOString()})`,
      finalized: sql<number>`count(*) filter (where status = 'finalized' and finalized_at >= ${todayStart.toISOString()})`,
      amended:   sql<number>`count(*) filter (where status = 'amended' and amended_at >= ${todayStart.toISOString()})`,
    }).from(usgReportDraftsTable);

    const [windowReports] = await db.select({
      drafts:    sql<number>`count(*) filter (where status = 'draft')`,
      pending:   sql<number>`count(*) filter (where status = 'pending_review')`,
      verified:  sql<number>`count(*) filter (where status = 'verified')`,
      finalized: sql<number>`count(*) filter (where status = 'finalized')`,
      amended:   sql<number>`count(*) filter (where status = 'amended')`,
      archived:  sql<number>`count(*) filter (where status = 'archived')`,
      total:     sql<number>`count(*)`,
    }).from(usgReportDraftsTable).where(gte(usgReportDraftsTable.createdAt, since));

    const [measStats] = await db.select({
      approved: sql<number>`count(*) filter (where status = 'approved')`,
      pending:  sql<number>`count(*) filter (where status = 'pending_review')`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')`,
    }).from(usgMeasurementsTable).where(gte(usgMeasurementsTable.createdAt, since));

    const [dopStats] = await db.select({
      approved: sql<number>`count(*) filter (where status = 'approved')`,
      pending:  sql<number>`count(*) filter (where status = 'pending_review')`,
    }).from(usgDopplerMeasurementsTable).where(gte(usgDopplerMeasurementsTable.createdAt, since));

    const [criticalPending] = await db.select({ total: sql<number>`count(*)` })
      .from(criticalFindingsAlertsTable)
      .where(and(
        inArray(criticalFindingsAlertsTable.modality, ["US", "USG"]),
        eq(criticalFindingsAlertsTable.status, "active"),
      ));

    const avgTat = await db.execute(sql`
      SELECT AVG(EXTRACT(EPOCH FROM (finalized_at - created_at)) / 60) AS avg_tat_min
      FROM usg_report_drafts
      WHERE finalized_at IS NOT NULL AND created_at >= ${since.toISOString()}
    `);

    res.json({
      windowDays: days,
      today: {
        draftsCreated: Number(todayReports?.drafts ?? 0),
        verified:      Number(todayReports?.verified ?? 0),
        finalized:     Number(todayReports?.finalized ?? 0),
        amended:       Number(todayReports?.amended ?? 0),
      },
      window: {
        drafts:    Number(windowReports?.drafts ?? 0),
        pending:   Number(windowReports?.pending ?? 0),
        verified:  Number(windowReports?.verified ?? 0),
        finalized: Number(windowReports?.finalized ?? 0),
        amended:   Number(windowReports?.amended ?? 0),
        archived:  Number(windowReports?.archived ?? 0),
        total:     Number(windowReports?.total ?? 0),
      },
      measurements: {
        approved: Number(measStats?.approved ?? 0),
        pending:  Number(measStats?.pending ?? 0),
        rejected: Number(measStats?.rejected ?? 0),
      },
      doppler: {
        approved: Number(dopStats?.approved ?? 0),
        pending:  Number(dopStats?.pending ?? 0),
      },
      criticalAlertsPending: Number(criticalPending?.total ?? 0),
      avgTatMinutes: avgTat.rows[0]?.avg_tat_min == null
        ? null
        : Math.round(Number(avgTat.rows[0].avg_tat_min)),
    });
  } catch (err) {
    logger.error({ err }, "USG analytics dashboard failed");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ── GET /by-radiologist ──────────────────────────────────────────────────────

router.get("/by-radiologist", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 90);
  const since = new Date(Date.now() - days * 86400 * 1000);

  try {
    const rows = await db.execute(sql`
      SELECT
        COALESCE(finalized_by, 'Unknown') AS radiologist,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count,
        COUNT(*) FILTER (WHERE status = 'amended')   AS amended_count,
        COUNT(*) FILTER (WHERE status IN ('draft','pending_review','verified')) AS open_count,
        AVG(EXTRACT(EPOCH FROM (finalized_at - created_at)) / 60)
          FILTER (WHERE finalized_at IS NOT NULL) AS avg_tat_min
      FROM usg_report_drafts
      WHERE created_at >= ${since.toISOString()}
      GROUP BY finalized_by
      ORDER BY finalized_count DESC
      LIMIT 50
    `);

    res.json({
      windowDays: days,
      radiologists: (rows.rows as Array<{
        radiologist: string;
        finalized_count: number | string;
        amended_count: number | string;
        open_count: number | string;
        avg_tat_min: number | string | null;
      }>).map((r) => ({
        name: r.radiologist,
        finalizedCount: Number(r.finalized_count ?? 0),
        amendedCount: Number(r.amended_count ?? 0),
        openCount: Number(r.open_count ?? 0),
        avgTatMinutes: r.avg_tat_min == null ? null : Math.round(Number(r.avg_tat_min)),
      })),
    });
  } catch (err) {
    logger.error({ err }, "USG by-radiologist failed");
    res.status(500).json({ error: "Failed to load radiologist stats" });
  }
});

// ── GET /by-template ───────────────────────────────────────────────────────────

router.get("/by-template", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 90);
  const since = new Date(Date.now() - days * 86400 * 1000);

  try {
    const rows = await db.execute(sql`
      SELECT
        template_type,
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count,
        COUNT(*) FILTER (WHERE status = 'amended')   AS amended_count,
        COUNT(*) FILTER (WHERE status = 'verified')  AS verified_count,
        COUNT(*) FILTER (WHERE status = 'draft')     AS draft_count
      FROM usg_report_drafts
      WHERE created_at >= ${since.toISOString()}
      GROUP BY template_type
      ORDER BY total_count DESC
    `);

    res.json({
      windowDays: days,
      templates: (rows.rows as Array<{
        template_type: string;
        total_count: number | string;
        finalized_count: number | string;
        amended_count: number | string;
        verified_count: number | string;
        draft_count: number | string;
      }>).map((r) => ({
        templateType: r.template_type,
        total: Number(r.total_count ?? 0),
        finalized: Number(r.finalized_count ?? 0),
        amended: Number(r.amended_count ?? 0),
        verified: Number(r.verified_count ?? 0),
        draft: Number(r.draft_count ?? 0),
        amendmentRate: Number(r.total_count ?? 0) > 0
          ? Math.round((Number(r.amended_count ?? 0) / Number(r.total_count ?? 0)) * 1000) / 10
          : 0,
      })),
    });
  } catch (err) {
    logger.error({ err }, "USG by-template failed");
    res.status(500).json({ error: "Failed to load template stats" });
  }
});

// ── GET /prior-comparison/:patientId ─────────────────────────────────────────────────

router.get("/prior-comparison/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const limit = Math.min(Number(req.query.limit ?? 5), 20);

  try {
    const rows = await db.select({
      id: usgReportDraftsTable.id,
      templateType: usgReportDraftsTable.templateType,
      status: usgReportDraftsTable.status,
      finalizedAt: usgReportDraftsTable.finalizedAt,
      accessionNumber: usgReportDraftsTable.accessionNumber,
      studyInstanceUID: usgReportDraftsTable.studyInstanceUID,
      finalizedBy: usgReportDraftsTable.finalizedBy,
    })
      .from(usgReportDraftsTable)
      .where(and(
        eq(usgReportDraftsTable.patientId, patientId),
        isNotNull(usgReportDraftsTable.finalizedAt),
      ))
      .orderBy(desc(usgReportDraftsTable.finalizedAt))
      .limit(limit);

    const comparisons = rows.map((r, i) => {
      if (i === 0) return { report: r, delta: "current" };
      const prev = rows[i - 1];
      return { report: r, delta: r.templateType !== prev.templateType ? "new_type" : "stable" };
    });

    res.json({ patientId, comparisons });
  } catch (err) {
    logger.error({ err }, "USG prior-comparison failed");
    res.status(500).json({ error: "Failed to load prior comparison" });
  }
});

export const usgAnalyticsRouter = router;
