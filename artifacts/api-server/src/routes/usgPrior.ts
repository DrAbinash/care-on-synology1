/**
 * usgPrior — P4 prior-study intelligence API (final-integration wiring).
 *
 * Read-only endpoints that drive the merged P4 cores over canonical data:
 *   GET /studies/:studyId/priors          → comparable prior studies (same patient)
 *   GET /studies/:studyId/compare/:priorId → structured current-vs-prior comparison
 *   GET /patients/:patientId/timeline      → pregnancy episodes + GA/EFW timeline
 *
 * Every endpoint is gated behind ff_radiology_usg_prior_intelligence (returns
 * 404 when OFF, so a direct API call is also gated — not just the UI). The
 * timeline endpoint additionally requires ff_radiology_usg_pregnancy_timeline.
 * Nothing here writes to a report or a draft; comparison suggestions are
 * read-only drafts the radiologist may accept in the editor.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import {
  findPriorStudies, compareStudies, pregnancyTimelineForPatient,
} from "../lib/usgPriorDataService";

const router = Router();

/** Flag gate as middleware — 404 when OFF so direct API calls are gated too. */
function requireFlag(flag: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    if (!(await isFeatureEnabledServer(flag))) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    next();
  };
}

router.use(requireFlag("ff_radiology_usg_prior_intelligence"));

router.get("/studies/:studyId/priors", async (req, res) => {
  const studyId = Number(req.params.studyId);
  if (!Number.isFinite(studyId)) { res.status(400).json({ error: "bad_study_id" }); return; }
  res.json({ priors: await findPriorStudies(studyId) });
});

router.get("/studies/:studyId/compare/:priorId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const priorId = Number(req.params.priorId);
  if (!Number.isFinite(studyId) || !Number.isFinite(priorId)) { res.status(400).json({ error: "bad_id" }); return; }
  const result = await compareStudies(studyId, priorId);
  if ("error" in result) { res.status(result.error === "cross_patient_comparison_blocked" ? 403 : 404).json(result); return; }
  res.json(result);
});

router.get(
  "/patients/:patientId/timeline",
  requireFlag("ff_radiology_usg_pregnancy_timeline"),
  async (req, res) => {
    const patientId = Number(req.params.patientId);
    if (!Number.isFinite(patientId)) { res.status(400).json({ error: "bad_patient_id" }); return; }
    res.json(await pregnancyTimelineForPatient(patientId));
  },
);

export default router;
