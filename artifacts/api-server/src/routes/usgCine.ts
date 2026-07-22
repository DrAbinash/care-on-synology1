/**
 * usgCine — P7 cine key-frame API (final-integration wiring).
 *
 *   POST /describe                     → clip playback capability + suggested key frame
 *   POST /studies/:id/key-frame        → capture a key frame (DICOM reference) into usg_key_images
 *   GET  /studies/:id/key-frames       → list captured key frames
 *
 * Gated by ff_radiology_usg_cine (404 when OFF). Persists DICOM references only
 * (SOP + real selected frame) — never pixel blobs, never a fabricated frame, and
 * only for a genuine multi-frame cine clip. Viewer PLAYBACK itself needs the live
 * OHIF viewer (documented) — this endpoint handles capture + persistence.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { describeCineClip, captureKeyFrame, listKeyFrames } from "../lib/usgCineService";

const router = Router();

router.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (!(await isFeatureEnabledServer("ff_radiology_usg_cine"))) { res.status(404).json({ error: "not_found" }); return; }
  next();
});

function staff(req: Request) { return (req as Request & { staffSession?: { subjectId?: number; subjectName?: string } }).staffSession ?? {}; }

router.post("/describe", (req, res) => {
  const body = (req.body ?? {}) as { clip?: unknown };
  if (!body.clip) { res.status(400).json({ error: "clip_required" }); return; }
  res.json(describeCineClip(body.clip as Record<string, unknown>));
});

router.post("/studies/:studyId/key-frame", async (req, res) => {
  const studyInstanceUID = String((req.body ?? {}).studyInstanceUID ?? "");
  const body = (req.body ?? {}) as { clip?: unknown; selectedFrame?: number; label?: string; patientId?: number; worklistId?: number; accessionNumber?: string };
  if (!body.clip || !studyInstanceUID) { res.status(400).json({ error: "clip_and_studyInstanceUID_required" }); return; }
  const s = staff(req);
  const result = await captureKeyFrame(body.clip as Record<string, unknown>, {
    studyInstanceUID, patientId: body.patientId ?? null, worklistId: body.worklistId ?? null,
    accessionNumber: body.accessionNumber ?? null, addedBy: s.subjectName ?? null, addedByUserId: s.subjectId ?? null,
  }, { selectedFrame: body.selectedFrame, label: body.label });
  if ("error" in result) { res.status(result.error === "not_cine" ? 422 : 400).json(result); return; }
  res.json(result);
});

router.get("/studies/:studyInstanceUID/key-frames", async (req, res) => {
  res.json({ keyFrames: await listKeyFrames(String(req.params.studyInstanceUID)) });
});

export default router;
