/**
 * DICOM Smart Workflow Routes — Phase 10
 * Mounted at: /api/dicom-workflow (staff-auth required)
 * Technician workflow, radiologist queue, modality routing, AI/OCR review.
 */

import { Router, type Request } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  dicomStudiesTable, technicianWorkflowTable, aiExtractionResultsTable,
  dicomStudyAuditLogTable, usgReportDraftsTable,
} from "@workspace/db/schema";
import { eq, desc, and, sql, isNull, ne, or, asc } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();

function staffOf(req: Request) {
  return (req as StaffAuthRequest).staffSession!;
}
function requireRole(req: Request, ...roles: string[]) {
  const s = staffOf(req);
  return !!s.role && roles.includes(s.role);
}
const requireTech = (req: Request) => requireRole(req, "technician", "radiologist", "admin", "super_admin");
const requireRad = (req: Request) => requireRole(req, "radiologist", "admin", "super_admin");
const requireAdmin = (req: Request) => requireRole(req, "admin", "super_admin");

async function audit(req: Request, params: { studyId: number; action: string; details?: Record<string, unknown> }) {
  const s = staffOf(req);
  const [study] = await db.select({ studyInstanceUID: dicomStudiesTable.studyInstanceUID })
    .from(dicomStudiesTable).where(eq(dicomStudiesTable.id, params.studyId)).limit(1);
  await db.insert(dicomStudyAuditLogTable).values({
    studyId: params.studyId, studyInstanceUID: study?.studyInstanceUID ?? null,
    action: params.action, actorId: s.subjectId ?? null,
    actorName: s.subjectName ?? "system", actorRole: s.role ?? "unknown",
    details: params.details ? JSON.stringify(params.details) : null,
  });
}

// ── GET /technician/:studyId ── Workflow record for a study
router.get("/technician/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const [row] = await db.select().from(technicianWorkflowTable).where(eq(technicianWorkflowTable.studyId, studyId)).limit(1);
  res.json(row ?? null);
});

// ── POST /technician/:studyId ── Save technician workflow
const TechSchema = z.object({
  technicianNotes: z.string().optional(),
  imageQuality: z.enum(["good", "acceptable", "repeat_needed"]).optional(),
  repeatReason: z.string().optional(),
  patientCooperation: z.enum(["good", "poor", "sedated", "emergency"]).optional(),
  contrastUsed: z.boolean().optional(),
  contrastName: z.string().optional(),
  contrastDose: z.string().optional(),
  adverseReaction: z.boolean().optional(),
  reactionNotes: z.string().optional(),
});

router.post("/technician/:studyId", async (req, res) => {
  if (!requireTech(req)) { res.status(403).json({ error: "Technician access required" }); return; }
  const studyId = Number(req.params.studyId);
  const parsed = TechSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const b = parsed.data;

  const [study] = await db.select().from(dicomStudiesTable).where(eq(dicomStudiesTable.id, studyId)).limit(1);
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  const s = staffOf(req);
  const existing = await db.select().from(technicianWorkflowTable).where(eq(technicianWorkflowTable.studyId, studyId)).limit(1);

  if (existing.length > 0) {
    const [row] = await db.update(technicianWorkflowTable)
      .set({ ...b, updatedAt: new Date() })
      .where(eq(technicianWorkflowTable.studyId, studyId))
      .returning();
    await audit(req, { studyId, action: "technician_scan_updated", details: { fields: Object.keys(b) } });
    res.json(row);
  } else {
    const [row] = await db.insert(technicianWorkflowTable).values({
      studyId, ...b,
      technicianId: s.subjectId ?? null,
      technicianName: s.subjectName ?? null,
    }).returning();
    await audit(req, { studyId, action: "technician_scan_completed", details: { fields: Object.keys(b) } });
    res.status(201).json(row);
  }
});

// ── POST /technician/:studyId/complete ── Mark scan complete
router.post("/technician/:studyId/complete", async (req, res) => {
  if (!requireTech(req)) { res.status(403).json({ error: "Technician access required" }); return; }
  const studyId = Number(req.params.studyId);
  const [study] = await db.select().from(dicomStudiesTable).where(eq(dicomStudiesTable.id, studyId)).limit(1);
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  const s = staffOf(req);
  const now = new Date();
  const [existing] = await db.select().from(technicianWorkflowTable).where(eq(technicianWorkflowTable.studyId, studyId)).limit(1);

  if (existing) {
    const [row] = await db.update(technicianWorkflowTable)
      .set({ scanCompletedAt: now, updatedAt: now })
      .where(eq(technicianWorkflowTable.studyId, studyId))
      .returning();
    res.json(row);
  } else {
    const [row] = await db.insert(technicianWorkflowTable).values({
      studyId, scanStartedAt: now, scanCompletedAt: now,
      technicianId: s.subjectId ?? null, technicianName: s.subjectName ?? null,
    }).returning();
    res.status(201).json(row);
  }
  await audit(req, { studyId, action: "technician_scan_completed", details: { scanCompletedAt: now.toISOString() } });
});

// ── GET /radiologist-queue ── Smart queue with filters
const QueueQuery = z.object({
  filter: z.enum(["pending", "verified_not_finalized", "critical", "stat", "oldest_first", "assigned_to_me", "unassigned"]).optional(),
  radiologistId: z.string().optional(),
  modality: z.string().optional(),
  limit: z.coerce.number().max(200).default(50),
  offset: z.coerce.number().default(0),
});

router.get("/radiologist-queue", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const parsed = QueueQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const q = parsed.data;
  const s = staffOf(req);

  const conditions = [];
  if (q.modality) conditions.push(eq(dicomStudiesTable.modality, q.modality));

  if (q.filter === "pending") {
    conditions.push(eq(dicomStudiesTable.reportStatus, "not_started"));
  } else if (q.filter === "verified_not_finalized") {
    conditions.push(eq(dicomStudiesTable.reportStatus, "verified"));
  } else if (q.filter === "critical") {
    conditions.push(or(
      eq(dicomStudiesTable.priority, "emergency"),
      eq(dicomStudiesTable.priority, "stat"),
      eq(dicomStudiesTable.priority, "icu"),
    ));
  } else if (q.filter === "stat") {
    conditions.push(eq(dicomStudiesTable.priority, "stat"));
  } else if (q.filter === "assigned_to_me") {
    if (!s.subjectId) { res.status(400).json({ error: "No radiologist ID in session" }); return; }
    conditions.push(eq(dicomStudiesTable.assignedRadiologistId, s.subjectId));
  } else if (q.filter === "unassigned") {
    conditions.push(isNull(dicomStudiesTable.assignedRadiologistId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = q.filter === "oldest_first"
    ? asc(dicomStudiesTable.createdAt)
    : desc(dicomStudiesTable.priority); // emergency first, then by createdAt

  const rows = await db.select().from(dicomStudiesTable)
    .where(whereClause)
    .orderBy(orderBy, desc(dicomStudiesTable.createdAt))
    .limit(q.limit).offset(q.offset);

  const [countRow] = await db.select({ c: sql<number>`count(*)` }).from(dicomStudiesTable).where(whereClause ?? sql`true`);

  res.json({ studies: rows, total: countRow?.c ?? 0, limit: q.limit, offset: q.offset });
});

// ── POST /:studyId/create-report ── Create USG draft from study (no auto-finalize)
router.post("/:studyId/create-report", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const studyId = Number(req.params.studyId);
  const [study] = await db.select().from(dicomStudiesTable).where(eq(dicomStudiesTable.id, studyId)).limit(1);
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  const s = staffOf(req);
  const [draft] = await db.insert(usgReportDraftsTable).values({
    studyInstanceUID: study.studyInstanceUID,
    patientId: study.patientId,
    accessionNumber: study.accessionNumber,
    templateType: "WHOLE_ABDOMEN",
    draftContent: "",
    status: "draft",
    createdBy: s.subjectName ?? "system",
  }).returning();

  await db.update(dicomStudiesTable)
    .set({ reportStatus: "draft", reportId: draft.id, updatedAt: new Date() })
    .where(eq(dicomStudiesTable.id, studyId));

  await audit(req, { studyId, action: "report_created", details: { reportId: draft.id, templateType: "WHOLE_ABDOMEN" } });
  res.status(201).json({ draft, studyId });
});

// ── POST /ai-extract/:studyId ── Disabled (fail closed); mock clinical extraction not configured
const AI_TYPES = [
  "dicom_metadata", "key_images", "measurements_from_overlay",
  "report_template_suggestion", "findings_suggestion", "prior_comparison", "quality_check",
] as const;

router.post("/ai-extract/:studyId", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const studyId = Number(req.params.studyId);
  const [study] = await db.select().from(dicomStudiesTable).where(eq(dicomStudiesTable.id, studyId)).limit(1);
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  // Mock clinical interpretation generator is intentionally disabled.
  // Previously returned canned findings/impression (e.g. "No significant abnormality").
  res.status(501).json({
    error: "DICOM AI extraction is not configured. No clinical findings were generated.",
    code: "dicom_ai_extraction_not_configured",
  });
});


// ── GET /ocr-review/:studyId ── OCR extraction results for review
router.get("/ocr-review/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const rows = await db.select().from(aiExtractionResultsTable)
    .where(and(eq(aiExtractionResultsTable.studyId, studyId), eq(aiExtractionResultsTable.extractionType, "measurements_from_overlay")))
    .orderBy(desc(aiExtractionResultsTable.createdAt));
  res.json(rows);
});

// ── POST /ocr-review/:id/accept ── Accept OCR value (writes audit log)
router.post("/ocr-review/:id/accept", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const s = staffOf(req);
  const [row] = await db.update(aiExtractionResultsTable)
    .set({ reviewStatus: "accepted", reviewedById: s.subjectId ?? null, reviewedByName: s.subjectName ?? null, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiExtractionResultsTable.id, id))
    .returning();
  await audit(req, { studyId: row.studyId, action: "ocr_value_accepted", details: { extractionId: id, extractionType: row.extractionType } });
  res.json(row);
});

router.post("/ocr-review/:id/reject", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const s = staffOf(req);
  const [row] = await db.update(aiExtractionResultsTable)
    .set({ reviewStatus: "rejected", reviewedById: s.subjectId ?? null, reviewedByName: s.subjectName ?? null, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiExtractionResultsTable.id, id))
    .returning();
  await audit(req, { studyId: row.studyId, action: "ocr_value_rejected", details: { extractionId: id, extractionType: row.extractionType } });
  res.json(row);
});

export default router;
