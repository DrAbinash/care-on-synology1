/**
 * usgAi — P8 advisory AI assistant API (final-integration wiring).
 *
 *   POST /studies/:id/suggest → advisory suggestions (honest hidden/unavailable states)
 *   POST /accept              → apply an accepted suggestion to a DRAFT (write-guard enforced)
 *
 * Gated by ff_radiology_usg_ai_assistant (404 when OFF). AI is advisory only:
 * suggestions are accept-only and fetal-sex content is refused at build; the
 * accept endpoint is the ONLY write path and it is a draft, never a signed
 * report (the write-guard throws otherwise). When the model gateway is not
 * configured, /suggest returns an honest "unavailable" state — never fabricated
 * output. Normal reporting is unaffected either way.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import {
  generateUsgSuggestions, acceptUsgSuggestion, type RawAiSuggestion,
} from "../lib/usgAiService";
import { AiWriteViolationError, type UsgAiSuggestion } from "../lib/usgAiAssistant";
import { resolveAiEnablementForUser } from "../lib/ai/clinicalConfigService";
import { usgGatewayProvider } from "../lib/ai/usgGatewayProvider";
import { buildGrowthNotes } from "../lib/usgGrowthAssistant";
import { pregnancyTimelineForPatient } from "../lib/usgPriorDataService";
import { logger } from "../lib/logger";

const router = Router();

router.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (!(await isFeatureEnabledServer("ff_radiology_usg_ai_assistant"))) { res.status(404).json({ error: "not_found" }); return; }
  next();
});

/**
 * Deterministic growth notes over the P4 timeline — gated by the growth flag and
 * requiring a patientId to build the timeline. Never throws into the request.
 */
async function growthNotesFor(patientId: number | null | undefined): Promise<RawAiSuggestion[]> {
  if (!patientId) return [];
  if (!(await isFeatureEnabledServer("ff_radiology_usg_ai_growth"))) return [];
  try {
    const { timeline } = await pregnancyTimelineForPatient(patientId);
    return buildGrowthNotes(timeline);
  } catch (err) {
    logger.warn({ err }, "usg growth notes failed");
    return [];
  }
}

router.post("/studies/:studyId/suggest", async (req, res) => {
  const staff = (req as Request & { staffSession?: { subjectId?: number; role?: string } }).staffSession ?? {};
  const body = (req.body ?? {}) as Record<string, unknown> & { patientId?: number };
  // Canonical enablement (AI master flag + per-scope policies), not a raw literal.
  const enablement = await resolveAiEnablementForUser({ staffId: staff.subjectId ?? null, modality: "US" });
  const deterministic = await growthNotesFor(body.patientId);
  // The provider routes through the canonical AI provider layer (Ollama/OpenAI/…
  // as configured in AI Provider Settings + Model Routing); no bespoke gateway.
  const result = await generateUsgSuggestions(usgGatewayProvider, enablement, body, deterministic);
  res.json(result);
});

router.post("/accept", (req, res) => {
  const body = (req.body ?? {}) as { currentText?: string; suggestion?: UsgAiSuggestion; accepted?: boolean };
  if (!body.suggestion) { res.status(400).json({ error: "suggestion_required" }); return; }
  try {
    // The write-guard inside acceptUsgSuggestion throws if the suggestion's
    // target is anything other than draft_suggestion — AI can never reach a
    // signed report through this endpoint.
    const result = acceptUsgSuggestion(body.currentText ?? "", body.suggestion, body.accepted === true);
    res.json(result);
  } catch (err) {
    if (err instanceof AiWriteViolationError) { res.status(403).json({ error: "ai_write_violation", message: err.message }); return; }
    throw err;
  }
});

export default router;
