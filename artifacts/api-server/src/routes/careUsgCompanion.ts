/**
 * careUsgCompanion.ts — CARE USG Companion (Phase 1)
 * Mounted at: /api/care-usg-companion  (staff-auth + /radiology permission)
 *
 * A WORKFLOW-AUTOMATION surface that composes EXISTING radiology infrastructure
 * into one Companion payload for the Reporting Workspace. It builds no new
 * engine: study recognition reuses `suggestTemplate`, measurements come from the
 * existing usg_measurements / usg_doppler_measurements tables, priors come from
 * the existing patient_reports / usg_report_drafts data.
 *
 *   GET  /study/:studyInstanceUID  — assemble the Companion payload (never 500s;
 *                                    degrades gracefully to whatever is available)
 *   POST /runs                     — record/refresh Companion telemetry for a study
 *   GET  /dashboard-stats?days=N   — aggregate telemetry for the Dashboard card
 *
 * Reliability rule (matches the extraction pipeline): a failure in any part
 * returns a partial payload with `degraded: true` — the workspace keeps working.
 */

import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  radiologyWorklistTable,
  usgMeasurementsTable,
  usgDopplerMeasurementsTable,
  usgExtractionLogsTable,
  usgKeyImagesTable,
  usgReportDraftsTable,
  patientReportsTable,
  radiologyStudiesTable,
  companionRunsTable,
  type UsgMeasurement,
  type UsgDopplerMeasurement,
} from "@workspace/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  detectStudyType,
  summarizeMeasurements,
  extractMachine,
  estimateTimeSavedSeconds,
} from "../lib/usgCompanion";

const router = Router();

type ExtractionStatus = "completed" | "failed" | "running" | "none";

type ReqWithStaff = Request & { staffSession?: { subjectId?: number; subjectName?: string; role?: string } };
function staffOf(req: Request): { subjectId?: number; subjectName?: string; role?: string } {
  return (req as ReqWithStaff).staffSession ?? {};
}

/** normalise a DICOM modality code into a Companion prior bucket. */
function priorBucket(modality: string | null | undefined): "usg" | "mri" | "ct" | "other" {
  const m = (modality ?? "").toUpperCase();
  if (m === "US" || m.includes("US")) return "usg";
  if (m === "MR" || m.includes("MR")) return "mri";
  if (m === "CT") return "ct";
  return "other";
}

// ── GET /study/:studyInstanceUID ──────────────────────────────────────────────

router.get("/study/:studyInstanceUID", async (req, res) => {
  const studyInstanceUID = req.params.studyInstanceUID;
  let degraded = false;
  const degrade = (where: string, err: unknown) => {
    degraded = true;
    logger.warn({ err, studyInstanceUID, where }, "usg-companion assembly step failed");
  };

  // 1) worklist entry (the live USG study row)
  let worklist: typeof radiologyWorklistTable.$inferSelect | null = null;
  try {
    const [row] = await db.select().from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID)).limit(1);
    worklist = row ?? null;
  } catch (err) { degrade("worklist", err); }

  const modality = worklist?.modality ?? "US";
  const studyDescription = worklist?.studyDescription ?? "";

  // 2) latest extracted measurement row + doppler rows
  let measurement: UsgMeasurement | null = null;
  try {
    const [row] = await db.select().from(usgMeasurementsTable)
      .where(eq(usgMeasurementsTable.studyInstanceUID, studyInstanceUID))
      .orderBy(desc(usgMeasurementsTable.createdAt)).limit(1);
    measurement = row ?? null;
  } catch (err) { degrade("measurements", err); }

  let doppler: UsgDopplerMeasurement[] = [];
  try {
    doppler = await db.select().from(usgDopplerMeasurementsTable)
      .where(eq(usgDopplerMeasurementsTable.studyInstanceUID, studyInstanceUID))
      .orderBy(desc(usgDopplerMeasurementsTable.createdAt)).limit(50);
  } catch (err) { degrade("doppler", err); }

  // 3) latest extraction log (success/fail state)
  let extractionStatus: ExtractionStatus = "none";
  let lastRunAt: string | null = null;
  let framesProcessed = 0;
  let srFound = false;
  try {
    const [log] = await db.select().from(usgExtractionLogsTable)
      .where(eq(usgExtractionLogsTable.studyInstanceUID, studyInstanceUID))
      .orderBy(desc(usgExtractionLogsTable.createdAt)).limit(1);
    if (log) {
      extractionStatus = (["completed", "failed", "running"].includes(log.status) ? log.status : "none") as ExtractionStatus;
      lastRunAt = (log.completedAt ?? log.createdAt)?.toISOString?.() ?? null;
      framesProcessed = log.framesProcessed ?? 0;
      srFound = !!log.srFound;
    } else if (measurement) {
      extractionStatus = "completed";
    }
  } catch (err) { degrade("extraction-log", err); }

  // 4) key-image count
  let imageCount = 0;
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(usgKeyImagesTable)
      .where(eq(usgKeyImagesTable.studyInstanceUID, studyInstanceUID));
    imageCount = Number(row?.n ?? 0);
  } catch (err) { degrade("key-images", err); }

  // 5) recognise study type (reuse) + summarise measurements
  const detected = detectStudyType({ modality, studyDescription });
  const summary = summarizeMeasurements(detected.id, measurement, doppler);
  const machine = extractMachine(measurement, worklist?.dicomMetadata ?? null);

  // 6) previous studies (reuse existing report/draft data — cross-modality)
  const previousStudies: {
    usg: { label: string; dateIso: string | null; status: string | null }[];
    mri: { label: string; dateIso: string | null; status: string | null }[];
    ct: { label: string; dateIso: string | null; status: string | null }[];
    other: { label: string; dateIso: string | null; status: string | null }[];
    total: number;
  } = { usg: [], mri: [], ct: [], other: [], total: 0 };

  if (worklist?.patientId) {
    const patientId = worklist.patientId;
    try {
      const rows = await db.select({
        title: patientReportsTable.title,
        status: patientReportsTable.status,
        createdAt: patientReportsTable.createdAt,
        modality: radiologyStudiesTable.modality,
        studyDescription: radiologyStudiesTable.studyDescription,
        studyDate: radiologyStudiesTable.studyDate,
      })
        .from(patientReportsTable)
        .leftJoin(radiologyStudiesTable, eq(patientReportsTable.studyId, radiologyStudiesTable.id))
        .where(and(eq(patientReportsTable.patientId, patientId), eq(patientReportsTable.type, "radiology")))
        .orderBy(desc(patientReportsTable.createdAt))
        .limit(30);
      for (const r of rows) {
        const bucket = priorBucket(r.modality);
        previousStudies[bucket].push({
          label: r.studyDescription || r.title || "Report",
          dateIso: (r.studyDate ? new Date(r.studyDate).toISOString() : r.createdAt?.toISOString?.()) ?? null,
          status: r.status ?? null,
        });
      }
    } catch (err) { degrade("prior-reports", err); }

    // USG-specific finalised drafts (may not have patient_reports rows)
    try {
      const usgRows = await db.select({
        accessionNumber: usgReportDraftsTable.accessionNumber,
        templateType: usgReportDraftsTable.templateType,
        status: usgReportDraftsTable.status,
        finalizedAt: usgReportDraftsTable.finalizedAt,
        studyInstanceUID: usgReportDraftsTable.studyInstanceUID,
      })
        .from(usgReportDraftsTable)
        .where(and(eq(usgReportDraftsTable.patientId, patientId), isNotNull(usgReportDraftsTable.finalizedAt)))
        .orderBy(desc(usgReportDraftsTable.finalizedAt))
        .limit(10);
      for (const r of usgRows) {
        // skip the current study
        if (r.studyInstanceUID && r.studyInstanceUID === studyInstanceUID) continue;
        previousStudies.usg.push({
          label: r.templateType || "USG report",
          dateIso: r.finalizedAt?.toISOString?.() ?? null,
          status: r.status ?? null,
        });
      }
    } catch (err) { degrade("prior-usg", err); }

    previousStudies.total = previousStudies.usg.length + previousStudies.mri.length
      + previousStudies.ct.length + previousStudies.other.length;
  }

  // 7) warnings (workflow, not clinical)
  const warnings: string[] = [];
  if (!worklist) warnings.push("Study not found in the worklist — showing limited information.");
  if (extractionStatus === "failed") warnings.push("Automatic measurement extraction failed — enter measurements manually.");
  if (extractionStatus === "none" && !measurement) warnings.push("No machine measurements were imported for this study yet.");
  if (summary.missingCount > 0 && summary.expectedCount > 0) {
    warnings.push(`${summary.missingCount} of ${summary.expectedCount} expected measurement(s) not detected.`);
  }
  if (imageCount === 0) warnings.push("No key images linked to this study yet.");

  res.json({
    ok: true,
    degraded,
    study: {
      studyInstanceUID,
      worklistId: worklist?.id ?? null,
      patientId: worklist?.patientId ?? null,
      patientName: worklist?.patientName ?? null,
      accessionNumber: worklist?.accessionNumber ?? null,
      modality,
      studyDescription,
      studyDate: worklist?.studyDate ?? null,
      receivedAt: worklist?.createdAt?.toISOString?.() ?? null,
      referringDoctor: worklist?.referringDoctor ?? null,
      status: worklist?.status ?? null,
      reportId: worklist?.reportId ?? null,
      imageCount,
    },
    machine,
    detectedStudyType: detected.descriptor
      ?? { id: detected.id, label: detected.id, category: "Abdomen", description: "" },
    extraction: { status: extractionStatus, lastRunAt, framesProcessed, srFound },
    measurements: summary,
    previousStudies,
    warnings,
  });
});

// ── POST /runs — record/refresh Companion telemetry (best-effort) ──────────────

router.post("/runs", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const studyInstanceUID = typeof b.studyInstanceUID === "string" ? b.studyInstanceUID : null;
  if (!studyInstanceUID) {
    res.status(400).json({ error: "studyInstanceUID required" });
    return;
  }
  const s = staffOf(req);

  const asInt = (v: unknown, d = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : d;
  };
  const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const missing = Array.isArray(b.missingMeasurements) ? b.missingMeasurements.map(String) : [];
  const warnings = Array.isArray(b.warnings) ? b.warnings.map(String) : [];
  const importedCount = asInt(b.measurementsImported, 0);

  const values = {
    worklistId: b.worklistId != null ? asInt(b.worklistId) : null,
    studyInstanceUID,
    accessionNumber: asStr(b.accessionNumber),
    patientId: b.patientId != null ? asInt(b.patientId) : null,
    detectedStudyType: asStr(b.detectedStudyType),
    templateId: asStr(b.templateId),
    protocolApplied: asStr(b.protocolApplied),
    machineManufacturer: asStr(b.machineManufacturer),
    machineModel: asStr(b.machineModel),
    machineName: asStr(b.machineName),
    extractionStatus: asStr(b.extractionStatus) ?? "none",
    status: asStr(b.status) ?? "assembled",
    measurementsExpected: asInt(b.measurementsExpected),
    measurementsFound: asInt(b.measurementsFound),
    measurementsImported: importedCount,
    missingMeasurementsJson: JSON.stringify(missing),
    readinessScore: Math.max(0, Math.min(100, asInt(b.readinessScore))),
    timeSavedSeconds: b.timeSavedSeconds != null ? asInt(b.timeSavedSeconds) : estimateTimeSavedSeconds(importedCount),
    warningsJson: JSON.stringify(warnings),
    createdBy: s.subjectName ?? null,
    createdById: s.subjectId ?? null,
  };

  try {
    // Upsert by studyInstanceUID — one telemetry row per study.
    const [existing] = await db.select({ id: companionRunsTable.id }).from(companionRunsTable)
      .where(eq(companionRunsTable.studyInstanceUID, studyInstanceUID))
      .orderBy(desc(companionRunsTable.id)).limit(1);
    if (existing) {
      await db.update(companionRunsTable).set(values).where(eq(companionRunsTable.id, existing.id));
      res.json({ ok: true, id: existing.id, updated: true });
    } else {
      const [row] = await db.insert(companionRunsTable).values(values).returning({ id: companionRunsTable.id });
      res.json({ ok: true, id: row?.id ?? null, updated: false });
    }
  } catch (err) {
    // Telemetry must never break the workflow.
    logger.warn({ err, studyInstanceUID }, "companion run record failed");
    res.json({ ok: false });
  }
});

// ── GET /dashboard-stats?days=N — aggregate for the Companion Status card ───────

router.get("/dashboard-stats", async (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const empty = {
    windowDays: days,
    totalRuns: 0,
    extractionSuccessRate: 0,
    extractionFailureRate: 0,
    avgImportedMeasurements: 0,
    avgTimeSavedSeconds: 0,
    avgReadinessScore: 0,
    machineBreakdown: [] as { machine: string; runCount: number; successCount: number }[],
    mostCommonMissingMeasurements: [] as { key: string; count: number }[],
  };

  try {
    const runStats = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                                 AS total_runs,
        COUNT(*) FILTER (WHERE extraction_status = 'completed')::int                  AS success_count,
        COUNT(*) FILTER (WHERE extraction_status = 'failed')::int                     AS failed_count,
        COALESCE(ROUND(AVG(measurements_imported)::numeric, 1), 0)                    AS avg_imported,
        COALESCE(ROUND(AVG(time_saved_seconds)::numeric, 0), 0)                       AS avg_time_saved,
        COALESCE(ROUND(AVG(readiness_score)::numeric, 0), 0)                          AS avg_readiness
      FROM companion_runs
      WHERE created_at >= NOW() - (${days} || ' days')::interval
    `);
    const r = (runStats.rows?.[0] ?? {}) as Record<string, unknown>;
    const total = Number(r.total_runs ?? 0);
    const success = Number(r.success_count ?? 0);
    const failed = Number(r.failed_count ?? 0);
    const graded = success + failed;

    const machineStats = await db.execute(sql`
      SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', machine_manufacturer, machine_model)), ''), 'Unknown') AS machine,
             COUNT(*)::int AS run_count,
             COUNT(*) FILTER (WHERE extraction_status = 'completed')::int AS success_count
      FROM companion_runs
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY 1
      ORDER BY run_count DESC
      LIMIT 8
    `);

    const missingStats = await db.execute(sql`
      SELECT key AS missing_key, COUNT(*)::int AS missing_count
      FROM companion_runs, jsonb_array_elements_text(missing_measurements_json::jsonb) AS key
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY key
      ORDER BY missing_count DESC
      LIMIT 10
    `);

    res.json({
      windowDays: days,
      totalRuns: total,
      extractionSuccessRate: graded > 0 ? Math.round((success / graded) * 1000) / 10 : 0,
      extractionFailureRate: graded > 0 ? Math.round((failed / graded) * 1000) / 10 : 0,
      avgImportedMeasurements: Number(r.avg_imported ?? 0),
      avgTimeSavedSeconds: Number(r.avg_time_saved ?? 0),
      avgReadinessScore: Number(r.avg_readiness ?? 0),
      machineBreakdown: (machineStats.rows ?? []).map((m) => ({
        machine: String((m as Record<string, unknown>).machine ?? "Unknown"),
        runCount: Number((m as Record<string, unknown>).run_count ?? 0),
        successCount: Number((m as Record<string, unknown>).success_count ?? 0),
      })),
      mostCommonMissingMeasurements: (missingStats.rows ?? []).map((m) => ({
        key: String((m as Record<string, unknown>).missing_key ?? ""),
        count: Number((m as Record<string, unknown>).missing_count ?? 0),
      })),
    });
  } catch (err) {
    // Table may not be migrated yet in some environments — return empty stats.
    logger.warn({ err }, "companion dashboard-stats query failed (table may be pre-migration)");
    res.json(empty);
  }
});

export const careUsgCompanionRouter = router;
export default router;
