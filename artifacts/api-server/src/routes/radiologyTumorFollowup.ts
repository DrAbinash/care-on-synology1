/**
 * Phase 10B: Tumor Follow-up API
 * RECIST-like longitudinal tumor tracking with timeline and response classification.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { radiologyTumorFollowupsTable } from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const radiologyTumorFollowupRouter = Router();

// ── Add a tumor follow-up entry ──────────────────────────────────────────────
radiologyTumorFollowupRouter.post("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId ?? null;
  const userName = sReq.staffSession?.subjectName ?? null;

  const b = (req.body ?? {}) as Record<string, unknown>;
  const patientId = Number(b.patientId);
  const tumorLabel = String(b.tumorLabel ?? "").trim();
  if (!patientId || !tumorLabel) {
    res.status(400).json({ error: "patientId and tumorLabel required" }); return;
  }

  const toNum = (v: unknown) => v != null && v !== "" ? String(v) : null;

  const [entry] = await db.insert(radiologyTumorFollowupsTable).values({
    patientId,
    lesionId: b.lesionId ? Number(b.lesionId) : null,
    orderId: b.orderId ? Number(b.orderId) : null,
    studyId: b.studyId ? Number(b.studyId) : null,
    studyInstanceUid: b.studyInstanceUid ? String(b.studyInstanceUid) : null,
    accessionNumber: b.accessionNumber ? String(b.accessionNumber) : null,
    studyDate: b.studyDate ? new Date(String(b.studyDate)) : null,
    modality: b.modality ? String(b.modality) : null,
    tumorLabel,
    tumorLocation: b.tumorLocation ? String(b.tumorLocation) : null,
    histologyType: b.histologyType ? String(b.histologyType) : null,
    sizeMmAxis1: toNum(b.sizeMmAxis1),
    sizeMmAxis2: toNum(b.sizeMmAxis2),
    sizeMmAxis3: toNum(b.sizeMmAxis3),
    volumeCc: toNum(b.volumeCc),
    changePct: toNum(b.changePct),
    changeStatus: b.changeStatus ? String(b.changeStatus) : null,
    responseStatus: b.responseStatus ? String(b.responseStatus) : null,
    enhancementStatus: b.enhancementStatus ? String(b.enhancementStatus) : null,
    treatmentPhase: b.treatmentPhase ? String(b.treatmentPhase) : null,
    concurrentTreatment: b.concurrentTreatment ? String(b.concurrentTreatment) : null,
    notes: b.notes ? String(b.notes) : null,
    recordedById: userId,
    recordedByName: userName,
    isBaseline: Boolean(b.isBaseline),
  }).returning();

  res.json({ entry });
});

// ── Get timeline for a patient (optionally filtered by tumor label) ───────────
radiologyTumorFollowupRouter.get("/timeline", async (req, res): Promise<void> => {
  const patientId = Number(req.query.patientId);
  if (!patientId) { res.status(400).json({ error: "patientId required" }); return; }

  const rows = await db
    .select()
    .from(radiologyTumorFollowupsTable)
    .where(eq(radiologyTumorFollowupsTable.patientId, patientId))
    .orderBy(asc(radiologyTumorFollowupsTable.studyDate), asc(radiologyTumorFollowupsTable.createdAt));

  // Group by tumorLabel
  const byLabel: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!byLabel[row.tumorLabel]) byLabel[row.tumorLabel] = [];
    byLabel[row.tumorLabel].push(row);
  }

  // Auto-calculate changePct vs baseline if not already stored
  for (const entries of Object.values(byLabel)) {
    const baseline = entries.find((e) => e.isBaseline) ?? entries[0];
    const baselineSize = baseline ? Number(baseline.sizeMmAxis1 ?? 0) : 0;
    for (const e of entries) {
      if (e.changePct == null && baselineSize > 0 && e.sizeMmAxis1 != null) {
        const current = Number(e.sizeMmAxis1);
        (e as Record<string, unknown>).calculatedChangePct =
          (((current - baselineSize) / baselineSize) * 100).toFixed(1);
      }
    }
  }

  res.json({ timeline: rows, byLabel });
});

// ── Update an entry (e.g. fix response status) ───────────────────────────────
// Tumor followup measurements are shared clinical data for any authorized radiologist;
// they have no per-creator column. Access is limited to authenticated staff via
// the requireStaffAuth middleware already applied to this router.
radiologyTumorFollowupRouter.patch("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;

  const toNum = (v: unknown) => v != null && v !== "" ? String(v) : null;

  // Verify record exists before updating
  const existing = await db
    .select({ id: radiologyTumorFollowupsTable.id })
    .from(radiologyTumorFollowupsTable)
    .where(eq(radiologyTumorFollowupsTable.id, id))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "entry not found" }); return; }

  const updates: Partial<typeof radiologyTumorFollowupsTable.$inferInsert> = {};
  if (b.responseStatus !== undefined) updates.responseStatus = String(b.responseStatus);
  if (b.changeStatus !== undefined) updates.changeStatus = String(b.changeStatus);
  if (b.notes !== undefined) updates.notes = String(b.notes);
  if (b.isBaseline !== undefined) updates.isBaseline = Boolean(b.isBaseline);
  if (b.sizeMmAxis1 !== undefined) updates.sizeMmAxis1 = toNum(b.sizeMmAxis1);
  if (b.volumeCc !== undefined) updates.volumeCc = toNum(b.volumeCc);

  const [updated] = await db
    .update(radiologyTumorFollowupsTable)
    .set(updates)
    .where(eq(radiologyTumorFollowupsTable.id, id))
    .returning();

  res.json({ entry: updated });
});

// ── Delete an entry ───────────────────────────────────────────────────────────
radiologyTumorFollowupRouter.delete("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);

  // Verify record exists before deleting
  const existing = await db
    .select({ id: radiologyTumorFollowupsTable.id })
    .from(radiologyTumorFollowupsTable)
    .where(eq(radiologyTumorFollowupsTable.id, id))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "entry not found" }); return; }

  await db
    .delete(radiologyTumorFollowupsTable)
    .where(eq(radiologyTumorFollowupsTable.id, id));
  res.json({ ok: true });
});
