/**
 * Admin Orthanc purge API — preview + execute by StudyDate period.
 * Mounted at /api/radiology with requireStaffAuth + requireAdminRole.
 */

import { Router } from "express";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  PURGE_CONFIRM_PHRASE,
  PURGE_HARD_CAP,
  PURGE_SAMPLE_LIMIT,
  findOrthancStudiesForPurge,
  resolvePurgePeriod,
  runOrthancPurge,
  type PurgePreset,
} from "../lib/pacs/orthancPurge";
import { logger } from "../lib/logger";

export const orthancPurgeRouter = Router();

orthancPurgeRouter.use(requireAdminRole);

function parseBody(req: StaffAuthRequest): {
  preset?: PurgePreset;
  dateFrom?: string;
  dateTo?: string;
  confirm?: boolean;
  confirmPhrase?: string;
  forceLarge?: boolean;
} {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return {
    preset: typeof body.preset === "string" ? (body.preset as PurgePreset) : undefined,
    dateFrom: typeof body.dateFrom === "string" ? body.dateFrom : undefined,
    dateTo: typeof body.dateTo === "string" ? body.dateTo : undefined,
    confirm: body.confirm === true,
    confirmPhrase: typeof body.confirmPhrase === "string" ? body.confirmPhrase : undefined,
    forceLarge: body.forceLarge === true,
  };
}

orthancPurgeRouter.post("/orthanc/purge/preview", async (req, res) => {
  try {
    const parsed = parseBody(req as StaffAuthRequest);
    const period = resolvePurgePeriod(parsed);
    const found = await findOrthancStudiesForPurge(period, { max: PURGE_HARD_CAP + 1 });
    if (found.error) {
      res.status(502).json({ error: found.error, period });
      return;
    }
    const overCap = found.hits.length > PURGE_HARD_CAP;
    res.json({
      period,
      count: overCap ? PURGE_HARD_CAP : found.hits.length,
      truncated: found.truncated || overCap,
      hardCap: PURGE_HARD_CAP,
      requiresForceLarge: overCap,
      sample: found.hits.slice(0, PURGE_SAMPLE_LIMIT).map((h) => ({
        orthancId: h.orthancId,
        studyInstanceUID: h.studyInstanceUID,
        accessionNumber: h.accessionNumber,
        patientName: h.patientName,
        modality: h.modality,
        studyDate: h.studyDate,
        studyDescription: h.studyDescription,
      })),
      note: overCap
        ? `More than ${PURGE_HARD_CAP} studies match. Narrow the range or confirm with forceLarge.`
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

orthancPurgeRouter.post("/orthanc/purge", async (req, res) => {
  const staffReq = req as StaffAuthRequest;
  try {
    const parsed = parseBody(staffReq);
    if (!parsed.confirm || parsed.confirmPhrase !== PURGE_CONFIRM_PHRASE) {
      res.status(400).json({
        error: `Confirmation required. Send confirm: true and confirmPhrase: "${PURGE_CONFIRM_PHRASE}"`,
      });
      return;
    }
    const period = resolvePurgePeriod(parsed);
    const result = await runOrthancPurge({
      period,
      forceLarge: parsed.forceLarge,
      actorUserId: staffReq.staffSession?.subjectId ?? null,
      actorName: staffReq.staffSession?.subjectName ?? null,
      actorRole: staffReq.staffSession?.role ?? null,
    });
    res.json({
      ok: true,
      ...result,
      confirmPhrase: PURGE_CONFIRM_PHRASE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Orthanc purge failed");
    const status = /more than|Narrow the date|forceLarge/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});
