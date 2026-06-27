/**
 * radiologyMyAnalytics — Phase 5
 *
 * Personal reporting analytics for a logged-in radiologist.
 * Aggregates from existing tables — no new schema required.
 *
 * GET /api/radiology/my-analytics?days=30&radiologist=<name>
 *
 * Returns:
 *   tatStats        — TAT from radiology_studies (createdAt → finalReportedAt)
 *   modalityBreakdown — report counts by modality for this radiologist
 *   dailyVolume     — reports signed per day (last N days)
 *   measurementStats — measurements saved from radiology_measurements
 *   qaStats         — QA checklist results from mri_protocol_quality_results
 *   aiPromptUsage   — prompt library entries updated by this radiologist
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const radiologyMyAnalyticsRouter = Router();

radiologyMyAnalyticsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const days   = Math.min(Math.max(parseInt(String(req.query.days  ?? "30")), 1), 365);
  // Allow override for admin views; default to the logged-in radiologist
  const radiologist = (req.query.radiologist as string | undefined)?.trim()
    ?? sReq.staffSession?.subjectName
    ?? null;

  if (!radiologist) {
    res.status(400).json({ error: "radiologist name required" });
    return;
  }

  try {
    // ── 1. TAT stats (radiology_studies) ────────────────────────────────────
    // Only rows where finalReportedBy = radiologist AND finalReportedAt is set
    const tatRaw = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                AS total_signed,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (final_reported_at - created_at)) / 60
        )::numeric, 1)                                             AS avg_tat_minutes,
        ROUND(MIN(
          EXTRACT(EPOCH FROM (final_reported_at - created_at)) / 60
        )::numeric, 1)                                             AS min_tat_minutes,
        ROUND(MAX(
          EXTRACT(EPOCH FROM (final_reported_at - created_at)) / 60
        )::numeric, 1)                                             AS max_tat_minutes,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (final_reported_at - created_at)) / 60
        )::numeric, 1)                                             AS median_tat_minutes
      FROM radiology_studies
      WHERE final_reported_by = ${radiologist}
        AND final_reported_at IS NOT NULL
        AND final_reported_at >= NOW() - (${days} || ' days')::interval
    `);

    // ── 2. Modality breakdown ────────────────────────────────────────────────
    const modalityRaw = await db.execute(sql`
      SELECT
        modality,
        COUNT(*)::int AS count
      FROM radiology_studies
      WHERE final_reported_by = ${radiologist}
        AND final_reported_at IS NOT NULL
        AND final_reported_at >= NOW() - (${days} || ' days')::interval
      GROUP BY modality
      ORDER BY count DESC
    `);

    // ── 3. Daily volume (last N days) ────────────────────────────────────────
    const dailyRaw = await db.execute(sql`
      SELECT
        DATE(final_reported_at)::text AS date,
        COUNT(*)::int                 AS count
      FROM radiology_studies
      WHERE final_reported_by = ${radiologist}
        AND final_reported_at IS NOT NULL
        AND final_reported_at >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE(final_reported_at)
      ORDER BY date ASC
    `);

    // ── 4. Measurement stats (radiology_measurements) ────────────────────────
    const measureRaw = await db.execute(sql`
      SELECT
        COUNT(*)::int                         AS total_saved,
        COUNT(DISTINCT study_id)::int         AS studies_with_measurements,
        COUNT(CASE WHEN is_abnormal THEN 1 END)::int AS abnormal_count,
        COUNT(DISTINCT label)::int            AS unique_labels_used
      FROM radiology_measurements
      WHERE reported_by = ${radiologist}
        AND created_at >= NOW() - (${days} || ' days')::interval
    `);

    // ── 5. QA checklist results (mri_protocol_quality_results) ──────────────
    // Counts per overall_grade — tolerates table not existing yet
    let qaRaw: { rows: any[] } = { rows: [] };
    try {
      qaRaw = await db.execute(sql`
        SELECT
          overall_grade,
          COUNT(*)::int AS count
        FROM mri_protocol_quality_results
        WHERE completed_by = ${radiologist}
          AND completed_at >= NOW() - (${days} || ' days')::interval
        GROUP BY overall_grade
        ORDER BY count DESC
      `);
    } catch {
      // Table may not exist in all environments — return empty
    }

    // ── 6. AI prompt library usage ───────────────────────────────────────────
    // Counts how many prompt library entries this radiologist has edited/created
    let aiRaw: { rows: any[] } = { rows: [] };
    try {
      aiRaw = await db.execute(sql`
        SELECT
          COUNT(*)::int AS prompt_edits,
          COUNT(DISTINCT library_id)::int AS categories_edited
        FROM ai_prompt_library_versions
        WHERE created_by = ${radiologist}
          AND created_at >= NOW() - (${days} || ' days')::interval
      `);
    } catch {
      // Table may not exist — return empty
    }

    // ── 7. Priority breakdown ────────────────────────────────────────────────
    const priorityRaw = await db.execute(sql`
      SELECT
        priority,
        COUNT(*)::int AS count
      FROM radiology_studies
      WHERE final_reported_by = ${radiologist}
        AND final_reported_at IS NOT NULL
        AND final_reported_at >= NOW() - (${days} || ' days')::interval
      GROUP BY priority
      ORDER BY count DESC
    `);

    // ── Assemble response ────────────────────────────────────────────────────
    const tat = tatRaw.rows[0] ?? {};
    const measure = measureRaw.rows[0] ?? {};
    const ai = aiRaw.rows[0] ?? {};

    res.json({
      radiologist,
      periodDays: days,
      tatStats: {
        totalSigned:      Number(tat.total_signed      ?? 0),
        avgTatMinutes:    Number(tat.avg_tat_minutes    ?? 0),
        minTatMinutes:    Number(tat.min_tat_minutes    ?? 0),
        maxTatMinutes:    Number(tat.max_tat_minutes    ?? 0),
        medianTatMinutes: Number(tat.median_tat_minutes ?? 0),
      },
      modalityBreakdown: (modalityRaw.rows as any[]).map((r) => ({
        modality: r.modality as string,
        count:    Number(r.count),
      })),
      dailyVolume: (dailyRaw.rows as any[]).map((r) => ({
        date:  r.date as string,
        count: Number(r.count),
      })),
      measurementStats: {
        totalSaved:              Number(measure.total_saved               ?? 0),
        studiesWithMeasurements: Number(measure.studies_with_measurements ?? 0),
        abnormalCount:           Number(measure.abnormal_count            ?? 0),
        uniqueLabelsUsed:        Number(measure.unique_labels_used        ?? 0),
      },
      qaStats: (qaRaw.rows as any[]).map((r) => ({
        grade: r.overall_grade as string,
        count: Number(r.count),
      })),
      aiPromptStats: {
        promptEdits:       Number(ai.prompt_edits       ?? 0),
        categoriesEdited:  Number(ai.categories_edited  ?? 0),
      },
      priorityBreakdown: (priorityRaw.rows as any[]).map((r) => ({
        priority: r.priority as string,
        count:    Number(r.count),
      })),
    });
  } catch (err: any) {
    console.error("[my-analytics] query failed:", err.message);
    res.status(500).json({ error: "Analytics query failed", detail: err.message });
  }
});
