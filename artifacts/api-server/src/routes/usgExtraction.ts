/**
 * USG Auto-Measurement Extraction Routes
 * Mounted at: /api/usg-extraction  (staff-auth required)
 *
 * GET   /stats                            — dashboard counts
 * POST  /extract                          — trigger extraction for a study
 * GET   /study/:studyInstanceUID          — get latest measurements for a study
 * GET   /worklist/:worklistId             — get measurements for a worklist entry
 * PATCH /measurements/:id/approve        — radiologist approves a measurement set
 * PATCH /measurements/:id/reject         — radiologist rejects a measurement set
 * PATCH /measurements/:id/field          — update a single field (manual correction)
 * GET   /study/:studyInstanceUID/logs     — extraction run history
 * GET   /study/:studyInstanceUID/key-images — list key images
 * POST  /study/:studyInstanceUID/key-images — add a key image
 * GET   /key-images/all                  — all key images across studies
 * DELETE /key-images/:id                 — remove a key image
 * GET   /settings                        — get admin settings
 * PUT   /settings                        — save admin settings (admin/super_admin only)
 * POST  /sample-test                     — test extraction with sample DICOM metadata
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  usgMeasurementsTable,
  usgExtractionLogsTable,
  usgKeyImagesTable,
  usgDopplerMeasurementsTable,
  usgReportDraftsTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import {
  runUsgExtraction,
  getUsgAdminSettings,
  saveUsgAdminSettings,
  extractDicomMetadata,
  parseDicomSr,
} from "../lib/usgExtractor";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /stats ────────────────────────────────────────────────────────────────
// Returns counts for the USG/DOPPLER dashboard cards.

router.get("/stats", async (_req, res) => {
  try {
    const [measStats] = await db
      .select({
        pending:  sql<number>`count(*) filter (where status = 'pending_review')`,
        approved: sql<number>`count(*) filter (where status = 'approved')`,
      })
      .from(usgMeasurementsTable);

    const [dopplerStats] = await db
      .select({
        pending: sql<number>`count(*) filter (where status = 'pending_review')`,
      })
      .from(usgDopplerMeasurementsTable);

    const [draftStats] = await db
      .select({
        draft:     sql<number>`count(*) filter (where status = 'draft')`,
        finalized: sql<number>`count(*) filter (where status = 'finalized')`,
      })
      .from(usgReportDraftsTable);

    const [keyImgCount] = await db
      .select({ total: count() })
      .from(usgKeyImagesTable);

    const [worklistCount] = await db
      .select({ total: sql<number>`count(*)` })
      .from(radiologyWorklistTable)
      .where(sql`modality IN ('US', 'USG') AND status IN ('pending', 'in_progress')`);

    res.json({
      pendingWorklist:      Number(worklistCount?.total   ?? 0),
      pendingMeasurements:  Number(measStats?.pending     ?? 0),
      approvedMeasurements: Number(measStats?.approved    ?? 0),
      draftReports:         Number(draftStats?.draft      ?? 0),
      finalizedReports:     Number(draftStats?.finalized  ?? 0),
      keyImages:            Number(keyImgCount?.total     ?? 0),
      pendingDoppler:       Number(dopplerStats?.pending  ?? 0),
    });
  } catch {
    res.json({ pendingWorklist:0, pendingMeasurements:0, approvedMeasurements:0, draftReports:0, finalizedReports:0, keyImages:0, pendingDoppler:0 });
  }
});

// ── GET /key-images/all ───────────────────────────────────────────────────────
// All key images across all studies (for the gallery page).

router.get("/key-images/all", async (_req, res) => {
  const rows = await db
    .select()
    .from(usgKeyImagesTable)
    .orderBy(desc(usgKeyImagesTable.createdAt))
    .limit(300);
  res.json(rows);
});

// ── POST /extract ─────────────────────────────────────────────────────────────
// Trigger an extraction for a study. Idempotent — re-runs create a new log
// but always returns the LATEST measurement row.

router.post("/extract", async (req, res) => {
  const session = (req as unknown as Record<string, unknown>).staffSession as { user: { id: number; role: string } } | undefined;
  const b = (req.body ?? {}) as {
    studyInstanceUID?: string;
    accessionNumber?: string;
    worklistId?: number;
    studyId?: number;
    patientId?: number;
  };

  if (!b.studyInstanceUID && !b.worklistId) {
    res.status(400).json({ error: "studyInstanceUID or worklistId required" });
    return;
  }

  // Resolve worklist row for DICOM metadata
  let wlRow: typeof radiologyWorklistTable.$inferSelect | undefined;
  if (b.worklistId) {
    const [row] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, b.worklistId));
    wlRow = row;
  } else if (b.studyInstanceUID) {
    const [row] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.studyInstanceUID, b.studyInstanceUID!));
    wlRow = row;
  }

  const studyInstanceUID = b.studyInstanceUID ?? wlRow?.studyInstanceUID ?? "";
  if (!studyInstanceUID) {
    res.status(400).json({ error: "studyInstanceUID could not be resolved" });
    return;
  }

  try {
    const result = await runUsgExtraction({
      worklistId:        b.worklistId ?? wlRow?.id,
      studyId:           b.studyId ?? wlRow?.studyId ?? undefined,
      studyInstanceUID,
      accessionNumber:   b.accessionNumber ?? wlRow?.accessionNumber ?? undefined,
      patientId:         b.patientId ?? wlRow?.patientId ?? undefined,
      dicomMetadataJson: wlRow?.dicomMetadata ?? undefined,
      triggeredBy: "manual",
      triggeredByUserId: session?.user.id,
    });

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "POST /usg-extraction/extract failed");
    res.status(500).json({ error: msg });
  }
});

// ── GET /study/:studyInstanceUID ──────────────────────────────────────────────

router.get("/study/:studyInstanceUID", async (req, res) => {
  const { studyInstanceUID } = req.params;
  const rows = await db
    .select()
    .from(usgMeasurementsTable)
    .where(eq(usgMeasurementsTable.studyInstanceUID, studyInstanceUID))
    .orderBy(desc(usgMeasurementsTable.createdAt))
    .limit(10);
  res.json(rows);
});

// ── GET /worklist/:worklistId ─────────────────────────────────────────────────

router.get("/worklist/:worklistId", async (req, res) => {
  const id = Number(req.params.worklistId);
  if (!id) { res.status(400).json({ error: "Invalid worklistId" }); return; }
  const rows = await db
    .select()
    .from(usgMeasurementsTable)
    .where(eq(usgMeasurementsTable.worklistId, id))
    .orderBy(desc(usgMeasurementsTable.createdAt))
    .limit(10);
  res.json(rows);
});

// ── PATCH /measurements/:id/approve ──────────────────────────────────────────
// SAFETY: This is the ONLY path that transitions a measurement to `approved`.
// It must be called explicitly by a radiologist. The system never auto-approves.

router.patch("/measurements/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const session = (req as unknown as Record<string, unknown>).staffSession as { user: { name?: string; username?: string } } | undefined;
  const b = (req.body ?? {}) as { reviewNotes?: string };

  const [row] = await db
    .update(usgMeasurementsTable)
    .set({
      status: "approved",
      reviewedBy: session?.user.name ?? session?.user.username ?? "radiologist",
      reviewedAt: new Date(),
      reviewNotes: b.reviewNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(usgMeasurementsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Measurement not found" }); return; }
  res.json(row);
});

// ── PATCH /measurements/:id/reject ───────────────────────────────────────────

router.patch("/measurements/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const session = (req as unknown as Record<string, unknown>).staffSession as { user: { name?: string; username?: string } } | undefined;
  const b = (req.body ?? {}) as { reviewNotes?: string };

  const [row] = await db
    .update(usgMeasurementsTable)
    .set({
      status: "rejected",
      reviewedBy: session?.user.name ?? session?.user.username ?? "radiologist",
      reviewedAt: new Date(),
      reviewNotes: b.reviewNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(usgMeasurementsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Measurement not found" }); return; }
  res.json(row);
});

// ── PATCH /measurements/:id/field ─────────────────────────────────────────────
// Allows radiologist to correct individual field values before approving.

const ALLOWED_FIELDS = new Set([
  "bpd","hc","ac","fl","crl","efw","ga","edd","fhr",
  "placentaPosition","liquorAfi","fetalPresentation",
  "uterusSize","endometrium","rightOvary","leftOvary","follicles","adnexalLesion",
  "liverSize","spleenSize","rightKidney","leftKidney","cbd","gbWall","prostateVolume",
]);

router.patch("/measurements/:id/field", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, string>;

  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) {
    if (ALLOWED_FIELDS.has(k) && typeof v === "string") {
      // Convert camelCase to snake_case for Drizzle column names
      updates[k.replace(/([A-Z])/g, "_$1").toLowerCase()] = v;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  // Use raw SQL update for dynamic field list
  const [row] = await db
    .select()
    .from(usgMeasurementsTable)
    .where(eq(usgMeasurementsTable.id, id));
  if (!row) { res.status(404).json({ error: "Measurement not found" }); return; }

  // Build update values using the table columns we know
  const fieldMap: Record<string, keyof typeof usgMeasurementsTable.$inferInsert> = {
    bpd: "bpd", hc: "hc", ac: "ac", fl: "fl", crl: "crl", efw: "efw",
    ga: "ga", edd: "edd", fhr: "fhr",
    placenta_position: "placentaPosition", liquor_afi: "liquorAfi",
    fetal_presentation: "fetalPresentation",
    uterus_size: "uterusSize", endometrium: "endometrium",
    right_ovary: "rightOvary", left_ovary: "leftOvary",
    follicles: "follicles", adnexal_lesion: "adnexalLesion",
    liver_size: "liverSize", spleen_size: "spleenSize",
    right_kidney: "rightKidney", left_kidney: "leftKidney",
    cbd: "cbd", gb_wall: "gbWall", prostate_volume: "prostateVolume",
  };

  const drizzleUpdates: Partial<typeof usgMeasurementsTable.$inferInsert> = { updatedAt: new Date() };
  for (const [snakeKey, val] of Object.entries(updates)) {
    const drizzleKey = fieldMap[snakeKey] ?? snakeKey;
    (drizzleUpdates as Record<string, unknown>)[drizzleKey] = val;
  }

  const [updated] = await db
    .update(usgMeasurementsTable)
    .set(drizzleUpdates)
    .where(eq(usgMeasurementsTable.id, id))
    .returning();

  res.json(updated);
});

// ── GET /study/:studyInstanceUID/logs ─────────────────────────────────────────

router.get("/study/:studyInstanceUID/logs", async (req, res) => {
  const { studyInstanceUID } = req.params;
  const rows = await db
    .select()
    .from(usgExtractionLogsTable)
    .where(eq(usgExtractionLogsTable.studyInstanceUID, studyInstanceUID))
    .orderBy(desc(usgExtractionLogsTable.createdAt))
    .limit(20);
  res.json(rows);
});

// ── Key images ────────────────────────────────────────────────────────────────

router.get("/study/:studyInstanceUID/key-images", async (req, res) => {
  const { studyInstanceUID } = req.params;
  const rows = await db
    .select()
    .from(usgKeyImagesTable)
    .where(eq(usgKeyImagesTable.studyInstanceUID, studyInstanceUID))
    .orderBy(usgKeyImagesTable.sortOrder, usgKeyImagesTable.createdAt);
  res.json(rows);
});

router.post("/study/:studyInstanceUID/key-images", async (req, res) => {
  const { studyInstanceUID } = req.params;
  const session = (req as unknown as Record<string, unknown>).staffSession as { user: { id?: number; name?: string } } | undefined;
  const b = (req.body ?? {}) as {
    seriesInstanceUID?: string;
    sopInstanceUID?: string;
    seriesNumber?: string;
    imageNumber?: string;
    frameNumber?: number;
    label?: string;
    wadoUrl?: string;
    thumbnailBase64?: string;
    sortOrder?: number;
    worklistId?: number;
    accessionNumber?: string;
    patientId?: number;
  };

  const [row] = await db
    .insert(usgKeyImagesTable)
    .values({
      studyInstanceUID,
      worklistId: b.worklistId ?? null,
      accessionNumber: b.accessionNumber ?? null,
      patientId: b.patientId ?? null,
      seriesInstanceUID: b.seriesInstanceUID ?? null,
      sopInstanceUID: b.sopInstanceUID ?? null,
      seriesNumber: b.seriesNumber ?? null,
      imageNumber: b.imageNumber ?? null,
      frameNumber: b.frameNumber ?? 1,
      label: b.label ?? "",
      wadoUrl: b.wadoUrl ?? null,
      thumbnailBase64: b.thumbnailBase64 ?? null,
      sortOrder: b.sortOrder ?? 0,
      addedBy: session?.user.name ?? null,
      addedByUserId: session?.user.id ?? null,
    })
    .returning();

  res.status(201).json(row);
});

router.delete("/key-images/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .delete(usgKeyImagesTable)
    .where(eq(usgKeyImagesTable.id, id))
    .returning({ id: usgKeyImagesTable.id });
  if (!row) { res.status(404).json({ error: "Key image not found" }); return; }
  res.json({ success: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get("/settings", async (_req, res) => {
  const s = await getUsgAdminSettings();
  res.json(s);
});

router.put("/settings", requireStaffPermission("/settings"), async (req, res) => {
  const session = (req as unknown as Record<string, unknown>).staffSession as { user: { role: string } } | undefined;
  if (!FULL_ACCESS_ROLES.has(session?.user.role ?? "")) {
    res.status(403).json({ error: "Admin or super-admin role required to change USG extraction settings" });
    return;
  }
  const b = (req.body ?? {}) as Partial<{
    ocrEnabled: boolean;
    aiNormalizeEnabled: boolean;
    srPriorityMode: boolean;
    autoRejectLowConfidence: boolean;
    humanReviewRequired: boolean;
    autoFinalize: boolean;
    confidenceThreshold: number;
    lowConfidenceCutoff: number;
    maxFramesToOcr: number;
    geAeTitle: string;
    geIp: string;
    gePort: string;
  }>;
  await saveUsgAdminSettings(b);
  const updated = await getUsgAdminSettings();
  res.json(updated);
});

// ── Sample test (demo extraction from provided metadata) ──────────────────────

router.post("/sample-test", async (req, res) => {
  const b = (req.body ?? {}) as { dicomMetadataJson?: string; rawText?: string };

  try {
    const meta = b.dicomMetadataJson ? extractDicomMetadata(b.dicomMetadataJson) : {};
    const srItems = b.dicomMetadataJson ? parseDicomSr(b.dicomMetadataJson) : [];

    res.json({
      metadata: meta,
      srMeasurements: srItems,
      srCount: srItems.length,
      message: srItems.length > 0
        ? `Found ${srItems.length} DICOM SR measurements`
        : "No DICOM SR measurements found in metadata",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export const usgExtractionRouter = router;
