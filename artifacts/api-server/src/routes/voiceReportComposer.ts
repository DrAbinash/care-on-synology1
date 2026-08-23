/**
 * Voice Report Composer API — structured change plans, no direct report mutation.
 */
import { Router } from "express";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import {
  composeVoiceChangePlan,
  deterministicCompose,
  SYNTHETIC_TEST_TRANSCRIPT,
} from "../lib/voiceReportComposer/composer";
import { resolveComposerRuntime } from "../lib/voiceReportComposer/runtimeConfig";
import { validateChangePlan } from "../lib/voiceReportComposer/validator";
import { newComposerRequestId } from "../lib/voiceReportComposer/diagnostics";
import type { VoiceObservation } from "../lib/voiceReportComposer/schema";

export const voiceReportComposerRouter = Router();

function canUse(req: StaffAuthRequest): boolean {
  const s = req.staffSession;
  if (!s) return false;
  if (FULL_ACCESS_ROLES.has(s.role)) return true;
  return s.permissions?.includes("ai_reporting.use") ?? false;
}

voiceReportComposerRouter.post("/compose", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const transcript = String(b.transcript ?? "").trim();
  if (!transcript) {
    res.status(400).json({ ok: false, error: "transcript required" });
    return;
  }

  const requestId = newComposerRequestId();
  const priorObservations = Array.isArray(b.priorObservations)
    ? (b.priorObservations as VoiceObservation[])
    : undefined;

  const result = await composeVoiceChangePlan({
    modality: b.modality ? String(b.modality) : undefined,
    region: b.region ? String(b.region) : undefined,
    reportTitle: b.reportTitle ? String(b.reportTitle) : undefined,
    findingsText: b.findingsText ? String(b.findingsText) : undefined,
    impressionText: b.impressionText ? String(b.impressionText) : undefined,
    techniqueText: b.techniqueText ? String(b.techniqueText) : undefined,
    transcript,
    priorTranscript: b.priorTranscript ? String(b.priorTranscript) : undefined,
    priorObservations,
    generateImpressionOnly: b.generateImpressionOnly === true,
  }, {
    requestId,
    usePhraseFallback: b.usePhraseFallback === true,
  });

  if (!result.ok) {
    res.json({
      ok: false,
      error: result.error,
      diagnostics: result.diagnostics,
      phraseFallbackAvailable: !b.usePhraseFallback,
    });
    return;
  }

  const fieldProvenance = b.fieldProvenance as {
    findings?: Record<string, string[]>;
    impression?: Record<string, string[]>;
  } | undefined;

  const clientValidation = validateChangePlan({
    plan: result.plan!,
    findingsText: String(b.findingsText ?? ""),
    impressionText: String(b.impressionText ?? ""),
    fieldProvenance: fieldProvenance as Parameters<typeof validateChangePlan>[0]["fieldProvenance"],
    protectedQuickFindingLabels: Array.isArray(b.protectedQuickFindingLabels)
      ? (b.protectedQuickFindingLabels as string[])
      : undefined,
    generateImpressionOnly: b.generateImpressionOnly === true,
  });

  if (!clientValidation.ok) {
    res.json({
      ok: false,
      error: clientValidation.reason ?? "Validation failed",
      diagnostics: result.diagnostics,
      phraseFallbackAvailable: false,
    });
    return;
  }

  res.json({
    ok: true,
    plan: result.plan,
    diagnostics: result.diagnostics,
    provenance: {
      source: "radiologist-voice",
      composer: result.diagnostics?.phraseFallback ? "phrase_catalog" : "local_ai",
      model: result.diagnostics?.model,
      fallbackUsed: result.diagnostics?.fallbackUsed ?? false,
      requestId,
    },
  });
});

/** Safe test — synthetic non-PHI transcript only. */
voiceReportComposerRouter.post("/test", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const requestId = newComposerRequestId();
  const runtime = await resolveComposerRuntime(true);
  const region = String((req.body as Record<string, unknown>)?.region ?? "LS Spine");
  const t0 = Date.now();

  const result = await composeVoiceChangePlan({
    transcript: SYNTHETIC_TEST_TRANSCRIPT,
    region,
    modality: "MR",
    findingsText: "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.",
    generateImpressionOnly: (req.body as Record<string, unknown>)?.generateImpressionOnly === true,
  }, { requestId });

  res.json({
    ok: result.ok,
    endpoint: runtime.endpoint,
    endpointSource: runtime.endpointSource,
    model: result.diagnostics?.model ?? runtime.model,
    visionModel: runtime.visionModel,
    composerModel: runtime.model,
    configured: runtime.enabled,
    schemaValid: result.diagnostics?.schemaOk ?? false,
    validationOk: result.diagnostics?.validationOk ?? false,
    latencyMs: result.diagnostics?.latencyMs ?? Date.now() - t0,
    validationMs: result.diagnostics?.validationMs ?? 0,
    requestId,
    error: result.error,
    phraseFallback: result.diagnostics?.phraseFallback ?? false,
  });
});

/** Admin benchmark — deterministic catalog only (offline). */
voiceReportComposerRouter.post("/benchmark", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const models = Array.isArray(b.models) ? (b.models as string[]).slice(0, 2) : [];
  if (models.length < 2) {
    res.status(400).json({ ok: false, error: "Provide models array with 2 model names" });
    return;
  }

  const region = String(b.region ?? "LS Spine");
  const findingsText =
    "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.";

  const results = models.map((model) => {
    const t0 = Date.now();
    const det = deterministicCompose({
      transcript: SYNTHETIC_TEST_TRANSCRIPT,
      region,
      findingsText,
    });
    const valid = det && !det.clarificationRequired && validateChangePlan({
      plan: det,
      findingsText,
      impressionText: "",
    }).ok;
    return {
      model,
      latencyMs: Date.now() - t0,
      schemaValid: valid,
      note: "Offline phrase-catalog benchmark — live Ollama comparison requires configured endpoint",
    };
  });

  res.json({ ok: true, results });
});

voiceReportComposerRouter.get("/config", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ error: "AI reporting permission required" });
    return;
  }
  const runtime = await resolveComposerRuntime(true);
  res.json({
    enabled: runtime.enabled,
    endpoint: runtime.endpoint,
    endpointSource: runtime.endpointSource,
    visionModel: runtime.visionModel,
    composerModel: runtime.model,
    composerFallbackModel: runtime.fallbackModel,
    numCtx: runtime.numCtx,
    temperature: runtime.temperature,
    timeoutSeconds: runtime.timeoutMs / 1000,
  });
});
