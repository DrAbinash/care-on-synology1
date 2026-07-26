import { Router, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { db } from "@workspace/db";
import { radiologyReportAttachmentsTable, radiologyStudiesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";

// The clinic does not generate its radiology reports from this app — the
// in-app structured builder's own UI admits every finalize runs through the
// "LEGACY path" (no ff_radiology_* flag is enabled in any seed), and the
// "/pdf" endpoint on patient-reports is HTML wearing a PDF Content-Type.
// Reports are composed in Word and exported to PDF/DOCX outside the app.
//
// Until today there was nowhere for that finished document to go: the only
// external-report-attach path anywhere in the codebase
// (outsourced-labs.ts POST /orders/:orderId/reports) is scoped to reference
// -lab orders, not in-house radiology studies. This router is that missing
// landing spot for radiology.
//
// Deliberately NOT wired into patient_reports / reportPresentation.ts's
// versioned, amendment-chain, signature pipeline — that machinery exists to
// protect documents THIS app produced and needs to reason about over time.
// An already-finished external file doesn't participate in any of that; it
// just needs a place to live, be found, and be handed to the patient. Modeled
// directly on outsource_reports (same table shape, same upload path).
export const radiologyReportAttachmentsRouter = Router();

/** Must match uploads.ts's UPLOAD_BASE_DIR exactly — this is the tree every
 *  filePath here is required to resolve inside. */
const UPLOAD_BASE_DIR = path.join(process.cwd(), "data", "uploads");

/** Pure path math, no filesystem access — exported so traversal payloads
 *  (`../../etc/passwd`, absolute paths, etc.) can be tested against arbitrary
 *  base directories without depending on process.cwd() or real files.
 *  Returns the resolved absolute path if it stays inside baseDir, else null. */
export function resolveInsideUploadDir(baseDir: string, filePath: string): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, filePath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) return null;
  return resolved;
}

/** True if `filePath` (as returned by POST /api/uploads) resolves to a real
 *  file inside UPLOAD_BASE_DIR. Rejects traversal and a path that never
 *  actually got written, independent of client-supplied content — nothing
 *  here trusts filePath's shape, only where it resolves. */
function resolveUploadedFile(filePath: string): string | null {
  const resolved = resolveInsideUploadDir(UPLOAD_BASE_DIR, filePath);
  if (!resolved || !existsSync(resolved)) return null;
  return resolved;
}

const AttachSchema = z.object({
  studyId: z.number().int().positive(),
  // storagePath from POST /api/uploads's response — never a client-chosen path.
  filePath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(255),
});

// POST / — attach an externally-produced report (uploaded via the existing
// POST /api/uploads, module "reports") to a radiology study.
radiologyReportAttachmentsRouter.post("/", async (req: StaffAuthRequest, res: Response) => {
  const parsed = AttachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { studyId, filePath, fileName } = parsed.data;

  const [study] = await db
    .select({ id: radiologyStudiesTable.id, patientId: radiologyStudiesTable.patientId })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  if (!resolveUploadedFile(filePath)) {
    res.status(400).json({ error: "Uploaded file not found — upload it via POST /api/uploads first, then attach the returned storagePath." });
    return;
  }

  const [attachment] = await db
    .insert(radiologyReportAttachmentsTable)
    .values({
      studyId: study.id,
      patientId: study.patientId,
      filePath,
      fileName,
      uploadedBy: req.staffSession?.subjectName?.trim() || null,
    })
    .returning();

  logger.info({ studyId: study.id, attachmentId: attachment.id, uploadedBy: attachment.uploadedBy }, "Radiology report attached");
  res.status(201).json(attachment);
});

// GET /study/:studyId — attachments for a study, newest first.
radiologyReportAttachmentsRouter.get("/study/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  if (!Number.isFinite(studyId)) {
    res.status(400).json({ error: "Invalid studyId" });
    return;
  }
  const rows = await db
    .select()
    .from(radiologyReportAttachmentsTable)
    .where(eq(radiologyReportAttachmentsTable.studyId, studyId))
    .orderBy(desc(radiologyReportAttachmentsTable.createdAt));
  res.json(rows);
});

// GET /:id/download — stream the file to a logged-in staff member.
//
// Deliberately NOT served via the public, unauthenticated /uploads static
// path (app.ts) — that path exists for public site assets (photos, logos),
// and its only protection is an unguessable random filename. These are
// clinical documents; a staff-authed, permission-gated download (the same
// requireStaffAuth + requireStaffPermission("/radiology") every other route
// in this zone already requires) is the correct bar for that content, not a
// weaker one just because the underlying file happens to sit in the same
// upload tree.
radiologyReportAttachmentsRouter.get("/:id/download", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [attachment] = await db
    .select()
    .from(radiologyReportAttachmentsTable)
    .where(eq(radiologyReportAttachmentsTable.id, id));
  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  const resolved = resolveUploadedFile(attachment.filePath);
  if (!resolved) {
    logger.error({ attachmentId: attachment.id, filePath: attachment.filePath }, "Radiology report attachment: file missing on disk");
    res.status(404).json({ error: "File missing on disk" });
    return;
  }

  res.download(resolved, attachment.fileName);
});

export default radiologyReportAttachmentsRouter;
