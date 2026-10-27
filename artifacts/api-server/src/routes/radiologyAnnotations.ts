/**
 * Phase 10C: Image Annotation Layer
 * CRUD for DICOM image overlay annotations linked to teaching files.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { radiologyAnnotationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { chainColumnsFor, verifyInstanceChain } from "../lib/imageIdentity";
import { loadBilledStudy, resolveWorklistFromStudyRef } from "../lib/radiologyIdentity";

export const radiologyAnnotationsRouter = Router();

// ── List annotations for a study ─────────────────────────────────────────────
radiologyAnnotationsRouter.get("/", async (req, res): Promise<void> => {
  const studyUid = req.query.studyInstanceUid ? String(req.query.studyInstanceUid) : null;
  const seriesUid = req.query.seriesInstanceUid ? String(req.query.seriesInstanceUid) : null;
  const orderId = req.query.orderId ? Number(req.query.orderId) : null;

  if (!studyUid && !orderId) {
    res.status(400).json({ error: "studyInstanceUid or orderId required" }); return;
  }

  let rows;
  if (studyUid) {
    rows = await db
      .select()
      .from(radiologyAnnotationsTable)
      .where(eq(radiologyAnnotationsTable.studyInstanceUid, studyUid));
  } else {
    rows = await db
      .select()
      .from(radiologyAnnotationsTable)
      .where(eq(radiologyAnnotationsTable.orderId, orderId!));
  }

  if (seriesUid) {
    rows = rows.filter((r) => r.seriesInstanceUid === seriesUid);
  }

  res.json({ annotations: rows });
});

// ── Create an annotation ──────────────────────────────────────────────────────
radiologyAnnotationsRouter.post("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId;
  const userName = sReq.staffSession?.subjectName;

  if (!userId) { res.status(401).json({ error: "authentication required" }); return; }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const studyInstanceUid = String(b.studyInstanceUid ?? "").trim();
  const annotationType = String(b.annotationType ?? "").trim();

  if (!studyInstanceUid || !annotationType) {
    res.status(400).json({ error: "studyInstanceUid and annotationType required" }); return;
  }

  const studyIdRef = b.studyId ? Number(b.studyId) : null;
  // D2-I1/D2-I5: the four DICOM columns below are durable image identity arriving
  // as browser claims, and an annotation can be bound to a CARE study by id. That
  // id lives in either id space (radiology_studies or radiology_worklist), so it
  // is resolved the same way a viewer measurement resolves it — whichever record
  // answers, and only its DICOM UID is treated as the expected study.
  const billed = await loadBilledStudy(studyIdRef);
  const wl = await resolveWorklistFromStudyRef(studyIdRef);
  const expectedUid = billed?.studyInstanceUid || wl?.studyInstanceUID || null;

  const chain = await verifyInstanceChain({
    studyInstanceUID: studyInstanceUid,
    seriesInstanceUID: b.seriesInstanceUid ? String(b.seriesInstanceUid) : null,
    sopInstanceUID: b.sopInstanceUid ? String(b.sopInstanceUid) : null,
    frameNumber: b.frameNumber ? Number(b.frameNumber) : null,
    expectedStudyInstanceUID: expectedUid,
  });
  if (chain.status === "contradicted") {
    res.status(409).json({ error: chain.message, code: chain.code }); return;
  }
  const columns = chainColumnsFor(chain);

  const [annotation] = await db.insert(radiologyAnnotationsTable).values({
    studyInstanceUid: columns.studyInstanceUid,
    seriesInstanceUid: columns.seriesInstanceUid,
    sopInstanceUid: columns.sopInstanceUid,
    frameNumber: columns.frameNumber,
    annotationType,
    coordinates: b.coordinates ?? null,
    labelText: b.labelText ? String(b.labelText) : null,
    color: b.color ? String(b.color) : "#FFFF00",
    strokeWidth: b.strokeWidth ? Number(b.strokeWidth) : 2,
    linkedTeachingCaseId: b.linkedTeachingCaseId ? Number(b.linkedTeachingCaseId) : null,
    isKeyAnnotation: Boolean(b.isKeyAnnotation),
    orderId: b.orderId ? Number(b.orderId) : null,
    studyId: studyIdRef,
    patientId: b.patientId ? Number(b.patientId) : null,
    createdById: userId,
    createdByName: userName ?? null,
  }).returning();

  res.status(201).json({
    annotation,
    ...(chain.status === "unverifiable" ? { warningCode: chain.code, warning: chain.message } : {}),
  });
});

// ── Update an annotation (label, coordinates, color) ─────────────────────────
radiologyAnnotationsRouter.patch("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "authentication required" }); return; }

  const id = Number(req.params.id);

  // Fetch first to verify existence and ownership
  const existing = await db
    .select({ createdById: radiologyAnnotationsTable.createdById })
    .from(radiologyAnnotationsTable)
    .where(eq(radiologyAnnotationsTable.id, id))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "annotation not found" }); return; }
  if (existing[0].createdById !== userId) {
    res.status(403).json({ error: "not authorized to modify this annotation" }); return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<typeof radiologyAnnotationsTable.$inferInsert> = {};
  if (b.labelText !== undefined) updates.labelText = String(b.labelText);
  if (b.color !== undefined) updates.color = String(b.color);
  if (b.strokeWidth !== undefined) updates.strokeWidth = Number(b.strokeWidth);
  if (b.coordinates !== undefined) updates.coordinates = b.coordinates;
  if (b.isKeyAnnotation !== undefined) updates.isKeyAnnotation = Boolean(b.isKeyAnnotation);
  if (b.linkedTeachingCaseId !== undefined)
    updates.linkedTeachingCaseId = b.linkedTeachingCaseId ? Number(b.linkedTeachingCaseId) : null;

  const [updated] = await db
    .update(radiologyAnnotationsTable)
    .set(updates)
    .where(and(eq(radiologyAnnotationsTable.id, id), eq(radiologyAnnotationsTable.createdById, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "annotation not found" }); return; }
  res.json({ annotation: updated });
});

// ── Delete an annotation ─────────────────────────────────────────────────────
radiologyAnnotationsRouter.delete("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = sReq.staffSession?.subjectId;
  if (!userId) { res.status(401).json({ error: "authentication required" }); return; }

  const id = Number(req.params.id);

  // Fetch first to verify existence and ownership
  const existing = await db
    .select({ createdById: radiologyAnnotationsTable.createdById })
    .from(radiologyAnnotationsTable)
    .where(eq(radiologyAnnotationsTable.id, id))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "annotation not found" }); return; }
  if (existing[0].createdById !== userId) {
    res.status(403).json({ error: "not authorized to delete this annotation" }); return;
  }

  await db
    .delete(radiologyAnnotationsTable)
    .where(and(eq(radiologyAnnotationsTable.id, id), eq(radiologyAnnotationsTable.createdById, userId)));
  res.json({ ok: true });
});
