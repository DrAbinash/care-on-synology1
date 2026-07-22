/**
 * usgPacsReturn — P6 report→PACS return API (final-integration wiring).
 *
 *   GET  /studies/:id/eligibility → fail-closed eligibility + tags + block reasons
 *   POST /studies/:id/return      → enqueue the durable USG_PACS_RETURN_JOB (idempotent)
 *   GET  /studies/:id/status      → live PACS archive status + latest revision
 *
 * Gated by ff_radiology_usg_report_to_pacs (404 when OFF). Enqueue only — the
 * actual push runs in the durable job worker via the canonical archiveReportToPacs,
 * which re-checks eligibility at execution time. Draft reports and superseded /
 * PCPNDT-non-compliant obstetric reports are never enqueued.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { radiologyStudiesTable, radiologyPacsArchiveRevisionsTable, usgAuditLogTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { evaluateUsgPacsReturn } from "../lib/usgPacsReturnService";
import { enqueueRadiologyJob } from "../lib/radiologyJobs";
import { USG_PACS_RETURN_JOB as JOB_NAME } from "../lib/radiologyJobHandlers";
import { logger } from "../lib/logger";

const router = Router();

router.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (!(await isFeatureEnabledServer("ff_radiology_usg_report_to_pacs"))) { res.status(404).json({ error: "not_found" }); return; }
  next();
});

function studyId(req: Request, res: Response): number | null {
  const id = Number(req.params.studyId);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_study_id" }); return null; }
  return id;
}
function staff(req: Request) { return (req as Request & { staffSession?: { subjectId?: number; subjectName?: string; role?: string } }).staffSession ?? {}; }

router.get("/studies/:studyId/eligibility", async (req, res) => {
  const id = studyId(req, res); if (id == null) return;
  const evaln = await evaluateUsgPacsReturn(id);
  if ("error" in evaln) { res.status(404).json(evaln); return; }
  res.json(evaln);
});

router.post("/studies/:studyId/return", async (req, res) => {
  const id = studyId(req, res); if (id == null) return;
  const evaln = await evaluateUsgPacsReturn(id);
  if ("error" in evaln) { res.status(404).json(evaln); return; }
  if (!evaln.eligible) { res.status(409).json({ error: "ineligible", blockReasons: evaln.blockReasons, errors: evaln.errors }); return; }

  const job = await enqueueRadiologyJob({
    operationType: JOB_NAME,
    entityType: "radiology_study",
    entityId: id,
    payload: { studyId: id, reportId: evaln.reportId },
    idempotencyKey: evaln.idempotencyKey!,
    maxRetries: 3,
  });
  const s = staff(req);
  void db.insert(usgAuditLogTable).values({
    entityType: "usg_pacs_return", entityId: id, action: "usg_pacs_return_enqueued",
    performedBy: s.subjectName ?? "system", performedById: s.subjectId ?? null, performedByRole: s.role ?? null,
    studyInstanceUID: null, patientId: null,
    details: JSON.stringify({ studyId: id, reportId: evaln.reportId, jobId: job.id, created: job.created, idempotencyKey: evaln.idempotencyKey }),
  }).catch((err: unknown) => logger.warn({ err }, "usg pacs-return audit failed"));

  res.json({ enqueued: true, jobId: job.id, alreadyQueued: !job.created });
});

router.get("/studies/:studyId/status", async (req, res) => {
  const id = studyId(req, res); if (id == null) return;
  const [s] = await db.select({
    pacsArchiveStatus: radiologyStudiesTable.pacsArchiveStatus,
    pacsInstanceId: radiologyStudiesTable.pacsInstanceId,
  }).from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).limit(1);
  if (!s) { res.status(404).json({ error: "study_not_found" }); return; }
  const revisions = await db.select().from(radiologyPacsArchiveRevisionsTable)
    .where(eq(radiologyPacsArchiveRevisionsTable.studyId, id))
    .orderBy(desc(radiologyPacsArchiveRevisionsTable.id)).limit(10);
  res.json({ pacsArchiveStatus: s.pacsArchiveStatus, pacsInstanceId: s.pacsInstanceId, revisions });
});

export default router;
