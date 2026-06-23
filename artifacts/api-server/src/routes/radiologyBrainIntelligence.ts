/**
 * Phase 10B: Brain Intelligence API
 * Endpoints for structured brain assessment with longitudinal trend data.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { radiologyBrainSessionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const radiologyBrainIntelligenceRouter = Router();

// ── Submit a brain session ───────────────────────────────────────────────────
radiologyBrainIntelligenceRouter.post("/sessions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId ?? null;
  const userName = sReq.staffSession?.subjectName ?? null;

  const b = (req.body ?? {}) as Record<string, unknown>;
  const patientId = Number(b.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const toNum = (v: unknown) => v != null && v !== "" ? String(v) : null;
  const toBool = (v: unknown, def = false) => v != null ? Boolean(v) : def;

  const [session] = await db.insert(radiologyBrainSessionsTable).values({
    patientId,
    orderId: b.orderId ? Number(b.orderId) : null,
    studyId: b.studyId ? Number(b.studyId) : null,
    studyInstanceUid: b.studyInstanceUid ? String(b.studyInstanceUid) : null,
    accessionNumber: b.accessionNumber ? String(b.accessionNumber) : null,
    modality: b.modality ? String(b.modality) : null,
    technique: b.technique ? String(b.technique) : null,
    contrastUsed: toBool(b.contrastUsed),
    clinicalIndication: b.clinicalIndication ? String(b.clinicalIndication) : null,
    midlineShift: toNum(b.midlineShift),
    midlineShiftDirection: b.midlineShiftDirection ? String(b.midlineShiftDirection) : null,
    ventricleSizeStatus: b.ventricleSizeStatus ? String(b.ventricleSizeStatus) : null,
    hydrocephalus: b.hydrocephalus ? String(b.hydrocephalus) : null,
    infarctPresent: toBool(b.infarctPresent),
    infarctSizeMm: toNum(b.infarctSizeMm),
    infarctTerritory: b.infarctTerritory ? String(b.infarctTerritory) : null,
    infarctPhase: b.infarctPhase ? String(b.infarctPhase) : null,
    hemorrhagePresent: toBool(b.hemorrhagePresent),
    hemorrhageSizeMm: toNum(b.hemorrhageSizeMm),
    hemorrhageType: b.hemorrhageType ? String(b.hemorrhageType) : null,
    hemorrhageLocation: b.hemorrhageLocation ? String(b.hemorrhageLocation) : null,
    massPresent: toBool(b.massPresent),
    massVolumeCc: toNum(b.massVolumeCc),
    massLocation: b.massLocation ? String(b.massLocation) : null,
    massEnhancement: b.massEnhancement ? String(b.massEnhancement) : null,
    edemaPresent: toBool(b.edemaPresent),
    edemaSeverity: b.edemaSeverity ? String(b.edemaSeverity) : null,
    edemaType: b.edemaType ? String(b.edemaType) : null,
    massEffect: b.massEffect ? String(b.massEffect) : null,
    sulcalEfacement: b.sulcalEfacement ? String(b.sulcalEfacement) : null,
    corticalAtrophy: b.corticalAtrophy ? String(b.corticalAtrophy) : null,
    wmChanges: b.wmChanges ? String(b.wmChanges) : null,
    cerebellumNormal: toBool(b.cerebellumNormal, true),
    brainstemNormal: toBool(b.brainstemNormal, true),
    overallImpression: b.overallImpression ? String(b.overallImpression) : null,
    recordedById: userId,
    recordedByName: userName,
    studyDate: b.studyDate ? new Date(String(b.studyDate)) : null,
  }).returning();

  res.json({ session });
});

// ── Get session history for a patient ────────────────────────────────────────
radiologyBrainIntelligenceRouter.get("/sessions", async (req, res): Promise<void> => {
  const patientId = Number(req.query.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }
  const limitN = Math.min(Number(req.query.limit ?? 10), 20);

  const sessions = await db
    .select()
    .from(radiologyBrainSessionsTable)
    .where(eq(radiologyBrainSessionsTable.patientId, patientId))
    .orderBy(desc(radiologyBrainSessionsTable.createdAt))
    .limit(limitN);

  res.json({ sessions });
});

// ── Trend data — return numeric parameters over time for sparklines ──────────
radiologyBrainIntelligenceRouter.get("/trends", async (req, res): Promise<void> => {
  const patientId = Number(req.query.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const sessions = await db
    .select({
      id: radiologyBrainSessionsTable.id,
      studyDate: radiologyBrainSessionsTable.studyDate,
      createdAt: radiologyBrainSessionsTable.createdAt,
      midlineShift: radiologyBrainSessionsTable.midlineShift,
      infarctSizeMm: radiologyBrainSessionsTable.infarctSizeMm,
      hemorrhageSizeMm: radiologyBrainSessionsTable.hemorrhageSizeMm,
      massVolumeCc: radiologyBrainSessionsTable.massVolumeCc,
      hydrocephalus: radiologyBrainSessionsTable.hydrocephalus,
      massEffect: radiologyBrainSessionsTable.massEffect,
      ventricleSizeStatus: radiologyBrainSessionsTable.ventricleSizeStatus,
    })
    .from(radiologyBrainSessionsTable)
    .where(eq(radiologyBrainSessionsTable.patientId, patientId))
    .orderBy(radiologyBrainSessionsTable.studyDate);

  res.json({ trends: sessions });
});
