/**
 * Voice Report Composer API — structured change plans, no direct report mutation.
 */
import { Router } from "express";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { composeVoiceChangePlan, deterministicCompose } from "../lib/voiceReportComposer/composer";
import { resolveComposerRuntime } from "../lib/voiceReportComposer/runtimeConfig";
import { validateChangePlan } from "../lib/voiceReportComposer/validator";
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
  }, { allowDeterministicFallback: true });

  if (!result.ok) {
    res.json({
      ok: false,
      error: result.error,
      diagnostics: result.diagnostics,
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
    });
    return;
  }

  res.json({
    ok: true,
    plan: result.plan,
    diagnostics: result.diagnostics,
    provenance: {
      source: "radiologist-voice",
      composer: "local_ai",
      model: result.diagnostics?.model,
      fallbackUsed: result.diagnostics?.fallbackUsed ?? false,
    },
  });
});

/** Safe test — no patient data. */
voiceReportComposerRouter.post("/test", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const transcript =
    String(b.transcript ?? "").trim() ||
    "Disc desiccation at L3-4 and L4-5 with mild diffuse disc bulge at L4-5.";
  const modelOverride = b.model ? String(b.model).trim() : undefined;

  const runtime = await resolveComposerRuntime(true);
  const region = String(b.region ?? "LS Spine");

  const t0 = Date.now();
  if (modelOverride) {
    // Direct model test via compose path with temporary override isn't supported;
    // use deterministic + schema validation for benchmark baseline.
    const det = deterministicCompose({
      transcript,
      region,
      findingsText: "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.",
    });
    const valid = det && validateChangePlan({
      plan: det,
      findingsText: "Lumbar vertebrae show normal alignment. Disc spaces are maintained.",
      impressionText: "",
    }).ok;
    res.json({
      ok: valid,
      model: modelOverride,
      schemaValid: valid,
      latencyMs: Date.now() - t0,
      changePlan: det,
      message: valid ? "Schema validation passed (deterministic probe)" : "Schema validation failed",
    });
    return;
  }

  const result = await composeVoiceChangePlan({
    transcript,
    region,
    modality: "MR",
    findingsText: "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained.",
    generateImpressionOnly: b.generateImpressionOnly === true,
  }, { allowDeterministicFallback: true });

  res.json({
    ok: result.ok,
    model: result.diagnostics?.model ?? runtime.model,
    schemaValid: result.ok,
    latencyMs: result.diagnostics?.latencyMs ?? Date.now() - t0,
    validationMs: result.diagnostics?.validationMs ?? 0,
    changePlan: result.plan,
    error: result.error,
    configured: runtime.enabled,
    visionModel: runtime.visionModel,
    composerModel: runtime.model,
  });
});

/** Admin benchmark — same transcript, two models (no auto winner). */
voiceReportComposerRouter.post("/benchmark", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const transcript =
    String(b.transcript ?? "").trim() ||
    "Disc desiccation at L3-4 and L4-5 with mild diffuse disc bulge at L4-5.";
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
    const det = deterministicCompose({ transcript, region, findingsText });
    const valid = det && validateChangePlan({ plan: det, findingsText, impressionText: "" }).ok;
    return {
      model,
      latencyMs: Date.now() - t0,
      schemaValid: valid,
      changePlan: det,
      note: "Benchmark uses deterministic catalog for offline comparison; configure Ollama for live model runs",
    };
  });

  res.json({ ok: true, transcript, results });
});

voiceReportComposerRouter.get("/config", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ error: "AI reporting permission required" });
    return;
  }
  const runtime = await resolveComposerRuntime(true);
  res.json({
    enabled: runtime.enabled,
    visionModel: runtime.visionModel,
    composerModel: runtime.model,
    composerFallbackModel: runtime.fallbackModel,
    numCtx: runtime.numCtx,
    temperature: runtime.temperature,
    timeoutSeconds: runtime.timeoutMs / 1000,
  });
});
