/**
 * usgObDoppler — P5 OB & Doppler canonical-section API (final-integration wiring).
 *
 *   GET /studies/:id/ob-section       → canonical OB section + impression (flag: ob_canonical)
 *   GET /studies/:id/doppler-section  → canonical Doppler section + impression (flag: doppler_canonical)
 *   GET /studies/:id/form-f-status    → PCPNDT Form-F status for display (ob_canonical)
 *
 * Each endpoint 404s when its flag is OFF (direct API gated, not just the UI).
 * Responses are canonical `{ section, impression }` payloads the workspace
 * merges into the draft via the normal save-draft path — nothing here writes a
 * report/draft. No fetal sex is ever produced; Form-F is display-only and the
 * canonical finalize gate stays the fail-closed enforcement point.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import {
  buildObSectionForStudy, buildDopplerSectionForStudy, formFStatusForStudy,
} from "../lib/usgObDopplerService";

const router = Router();

function requireFlag(flag: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    if (!(await isFeatureEnabledServer(flag))) { res.status(404).json({ error: "not_found" }); return; }
    next();
  };
}

function studyId(req: Request, res: Response): number | null {
  const id = Number(req.params.studyId);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_study_id" }); return null; }
  return id;
}

router.get("/studies/:studyId/ob-section", requireFlag("ff_radiology_usg_ob_canonical"), async (req, res) => {
  const id = studyId(req, res); if (id == null) return;
  const result = await buildObSectionForStudy(id);
  if ("error" in result) { res.status(404).json(result); return; }
  res.json(result);
});

router.get("/studies/:studyId/form-f-status", requireFlag("ff_radiology_usg_ob_canonical"), async (req, res) => {
  const id = studyId(req, res); if (id == null) return;
  const result = await formFStatusForStudy(id);
  if ("error" in result) { res.status(404).json(result); return; }
  res.json(result);
});

router.get("/studies/:studyId/doppler-section", requireFlag("ff_radiology_usg_doppler_canonical"), async (req, res) => {
  const id = studyId(req, res); if (id == null) return;
  const result = await buildDopplerSectionForStudy(id);
  if ("error" in result) { res.status(404).json(result); return; }
  res.json(result);
});

export default router;
