/**
 * Phase 10B: Spine Intelligence API
 * Endpoints for structured per-level spine assessment with longitudinal comparison.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologySpineSessionsTable,
  radiologySpineLevelsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const radiologySpineIntelligenceRouter = Router();

// ── Submit a spine session with per-level findings ───────────────────────────
radiologySpineIntelligenceRouter.post("/sessions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId ?? null;
  const userName = sReq.staffSession?.subjectName ?? null;

  const b = (req.body ?? {}) as Record<string, unknown>;
  const patientId = Number(b.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const levels = Array.isArray(b.levels) ? b.levels as Record<string, unknown>[] : [];

  const [session] = await db.insert(radiologySpineSessionsTable).values({
    patientId,
    orderId: b.orderId ? Number(b.orderId) : null,
    studyId: b.studyId ? Number(b.studyId) : null,
    studyInstanceUid: b.studyInstanceUid ? String(b.studyInstanceUid) : null,
    accessionNumber: b.accessionNumber ? String(b.accessionNumber) : null,
    modality: b.modality ? String(b.modality) : null,
    region: b.region ? String(b.region) : null,
    technique: b.technique ? String(b.technique) : null,
    contrastUsed: Boolean(b.contrastUsed),
    clinicalIndication: b.clinicalIndication ? String(b.clinicalIndication) : null,
    overallImpression: b.overallImpression ? String(b.overallImpression) : null,
    recordedById: userId,
    recordedByName: userName,
    studyDate: b.studyDate ? new Date(String(b.studyDate)) : null,
  }).returning();

  if (levels.length > 0) {
    await db.insert(radiologySpineLevelsTable).values(
      levels.map((lv) => ({
        sessionId: session.id,
        patientId,
        level: String(lv.level ?? ""),
        discStatus: lv.discStatus ? String(lv.discStatus) : null,
        discHeight: lv.discHeight ? String(lv.discHeight) : null,
        canalDiameter: lv.canalDiameter != null ? String(lv.canalDiameter) : null,
        canalStenosis: lv.canalStenosis ? String(lv.canalStenosis) : null,
        foraminalStenosis: lv.foraminalStenosis ? String(lv.foraminalStenosis) : null,
        cordCompression: Boolean(lv.cordCompression),
        cordSignalChange: Boolean(lv.cordSignalChange),
        nerveRootCompression: lv.nerveRootCompression ? String(lv.nerveRootCompression) : null,
        vertebralCollapse: Boolean(lv.vertebralCollapse),
        compressionFracture: Boolean(lv.compressionFracture),
        fractureSeverity: lv.fractureSeverity ? String(lv.fractureSeverity) : null,
        modicChange: lv.modicChange ? String(lv.modicChange) : null,
        schmorlNode: Boolean(lv.schmorlNode),
        spondylolisthesis: lv.spondylolisthesis ? String(lv.spondylolisthesis) : null,
        facetArthrosis: lv.facetArthrosis ? String(lv.facetArthrosis) : null,
        notes: lv.notes ? String(lv.notes) : null,
      }))
    );
  }

  res.json({ session, levelCount: levels.length });
});

// ── Get session history for a patient ────────────────────────────────────────
radiologySpineIntelligenceRouter.get("/sessions", async (req, res): Promise<void> => {
  const patientId = Number(req.query.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const sessions = await db
    .select()
    .from(radiologySpineSessionsTable)
    .where(eq(radiologySpineSessionsTable.patientId, patientId))
    .orderBy(desc(radiologySpineSessionsTable.createdAt));

  res.json({ sessions });
});

// ── Get levels for a specific session ────────────────────────────────────────
radiologySpineIntelligenceRouter.get("/sessions/:id/levels", async (req, res): Promise<void> => {
  const sessionId = Number(req.params.id);
  if (!sessionId) { res.status(400).json({ error: "invalid session id" }); return; }

  const levels = await db
    .select()
    .from(radiologySpineLevelsTable)
    .where(eq(radiologySpineLevelsTable.sessionId, sessionId))
    .orderBy(radiologySpineLevelsTable.level);

  res.json({ levels });
});

// ── Get comparison across sessions for a patient (last N sessions with levels) ─
radiologySpineIntelligenceRouter.get("/compare", async (req, res): Promise<void> => {
  const patientId = Number(req.query.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }
  const limitN = Math.min(Number(req.query.limit ?? 3), 5);

  const sessions = await db
    .select()
    .from(radiologySpineSessionsTable)
    .where(eq(radiologySpineSessionsTable.patientId, patientId))
    .orderBy(desc(radiologySpineSessionsTable.createdAt))
    .limit(limitN);

  if (sessions.length === 0) { res.json({ sessions: [], levels: {} }); return; }

  const sessionIds = sessions.map((s) => s.id);
  const levels = await db
    .select()
    .from(radiologySpineLevelsTable)
    .where(inArray(radiologySpineLevelsTable.sessionId, sessionIds));

  const levelsBySession: Record<number, typeof levels> = {};
  for (const lv of levels) {
    if (!levelsBySession[lv.sessionId]) levelsBySession[lv.sessionId] = [];
    levelsBySession[lv.sessionId].push(lv);
  }

  res.json({ sessions, levelsBySession });
});
