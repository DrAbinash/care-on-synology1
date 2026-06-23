/**
 * USG Doppler Measurement Routes
 * Mounted at: /api/usg-doppler  (staff-auth required)
 *
 * GET   /                         — list all Doppler measurements (optionally filtered by studyUID)
 * POST  /                         — create a new Doppler measurement
 * PATCH /:id/approve              — approve a Doppler measurement
 * PATCH /:id/reject               — reject a Doppler measurement
 * PATCH /:id                      — update fields (manual correction)
 * DELETE /:id                     — delete a Doppler measurement
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { usgDopplerMeasurementsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const studyUID   = req.query.studyInstanceUID as string | undefined;
  const worklistId = req.query.worklistId ? Number(req.query.worklistId) : null;

  let q = db.select().from(usgDopplerMeasurementsTable).$dynamic();
  if (studyUID)    q = q.where(eq(usgDopplerMeasurementsTable.studyInstanceUID, studyUID));
  else if (worklistId) q = q.where(eq(usgDopplerMeasurementsTable.worklistId, worklistId));

  const rows = await q.orderBy(desc(usgDopplerMeasurementsTable.createdAt)).limit(200);
  res.json(rows);
});

// ── POST / ────────────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const session = (req as unknown as Record<string, unknown>).staffSession as { user: { id?: number; name?: string } } | undefined;
  const b = (req.body ?? {}) as {
    worklistId?: number;
    studyInstanceUID?: string;
    accessionNumber?: string;
    patientId?: number;
    vesselName?: string;
    side?: string;
    psv?: string;
    edv?: string;
    ri?: string;
    pi?: string;
    sdRatio?: string;
    waveformLabel?: string;
    waveformDescription?: string;
    confidence?: string;
    source?: string;
  };

  if (!b.vesselName) {
    res.status(400).json({ error: "vesselName is required" });
    return;
  }

  try {
    const [row] = await db.insert(usgDopplerMeasurementsTable).values({
      worklistId:          b.worklistId ?? null,
      studyInstanceUID:    b.studyInstanceUID ?? null,
      accessionNumber:     b.accessionNumber ?? null,
      patientId:           b.patientId ?? null,
      vesselName:          b.vesselName,
      side:                b.side ?? "unknown",
      psv:                 b.psv ?? null,
      edv:                 b.edv ?? null,
      ri:                  b.ri ?? null,
      pi:                  b.pi ?? null,
      sdRatio:             b.sdRatio ?? null,
      waveformLabel:       b.waveformLabel ?? null,
      waveformDescription: b.waveformDescription ?? null,
      confidence:          b.confidence ?? "medium",
      source:              b.source ?? "manual",
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /usg-doppler failed");
    res.status(500).json({ error: "Failed to create Doppler measurement" });
  }
});

// ── PATCH /:id/approve ────────────────────────────────────────────────────────

router.patch("/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { reviewedBy?: string; reviewNotes?: string };

  const [row] = await db
    .update(usgDopplerMeasurementsTable)
    .set({
      status:     "approved",
      reviewedBy: b.reviewedBy ?? null,
      reviewNotes: b.reviewNotes ?? null,
      reviewedAt: new Date(),
      updatedAt:  new Date(),
    })
    .where(eq(usgDopplerMeasurementsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── PATCH /:id/reject ─────────────────────────────────────────────────────────

router.patch("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { reviewedBy?: string; reviewNotes?: string };

  const [row] = await db
    .update(usgDopplerMeasurementsTable)
    .set({
      status:      "rejected",
      reviewedBy:  b.reviewedBy ?? null,
      reviewNotes: b.reviewNotes ?? null,
      reviewedAt:  new Date(),
      updatedAt:   new Date(),
    })
    .where(eq(usgDopplerMeasurementsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── PATCH /:id (general update) ───────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Partial<{
    vesselName: string; side: string;
    psv: string; edv: string; ri: string; pi: string; sdRatio: string;
    waveformLabel: string; waveformDescription: string; confidence: string;
  }>;

  const [row] = await db
    .update(usgDopplerMeasurementsTable)
    .set({ ...b, updatedAt: new Date() })
    .where(eq(usgDopplerMeasurementsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db
    .delete(usgDopplerMeasurementsTable)
    .where(eq(usgDopplerMeasurementsTable.id, id))
    .returning({ id: usgDopplerMeasurementsTable.id });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

export const usgDopplerRouter = router;
