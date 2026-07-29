/**
 * Unified AI/OCR pipeline health + diagnostics + non-PHI smoke test.
 * Uses resolveLocalAiRuntime() — the same canonical config as Form F / Local AI.
 */

import { Router } from "express";
import { resolveLocalAiRuntime } from "../lib/aiPipeline/runtimeConfig";
import { buildModelRegistry, isLikelyTooLargeForRtx3050 } from "../lib/aiPipeline/modelRegistry";
import { routeAiModel } from "../lib/aiPipeline/modelRouter";
import { PROMPTS, PROMPT_VERSION } from "../lib/aiPipeline/prompts";
import { parseDocumentFromOcr } from "../lib/aiPipeline/documentParser";
import { validateDraftReport, parseJsonFromModel } from "../lib/aiPipeline/schemaValidation";
import { fetchPaddleHealth, runPaddleOcr } from "../lib/ocr/paddleOcrClient";
import { probeOllamaReachable } from "@workspace/ai-providers";

export const aiPipelineHealthRouter = Router();

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    return (json.models || []).map((m) => m.name || "").filter(Boolean);
  } catch {
    return [];
  }
}

aiPipelineHealthRouter.get("/health", async (_req, res) => {
  const cfg = await resolveLocalAiRuntime();
  const paddle = await fetchPaddleHealth();
  const ollamaProbe = await probeOllamaReachable(cfg.ollamaBaseUrl);
  const installed = ollamaProbe.reachable ? await listOllamaModels(cfg.ollamaBaseUrl) : [];
  const registry = buildModelRegistry();

  const selected = {
    fast: cfg.modelFast,
    standard: cfg.modelStandard,
    large: cfg.modelLarge,
    vision: cfg.modelVision,
  };
  const availability = Object.fromEntries(
    Object.entries(selected).map(([k, model]) => [
      k,
      {
        model,
        installed: installed.length === 0 ? null : installed.some((m) => m === model || m.startsWith(model + "-")),
        likelyTooLargeForRtx3050: isLikelyTooLargeForRtx3050(model),
      },
    ]),
  );

  res.json({
    ok: true,
    pipelineVersion: cfg.pipelineVersion,
    promptVersion: PROMPT_VERSION,
    canonicalRuntime: {
      ollamaUrl: cfg.ollamaBaseUrl,
      ollamaUrlSource: cfg.ollamaUrlSource,
      aiMode: cfg.aiMode,
      modelFast: cfg.modelFast,
      modelStandard: cfg.modelStandard,
      modelStandardSource: cfg.modelStandardSource,
      modelLarge: cfg.modelLarge,
      modelVision: cfg.modelVision,
      ollamaEnabled: cfg.ollamaEnabled,
    },
    ollama: {
      reachable: ollamaProbe.reachable,
      baseUrl: cfg.ollamaBaseUrl,
      error: ollamaProbe.error,
      installedModels: installed,
      selected,
      availability,
    },
    paddle: paddle ?? {
      ok: false,
      paddle_loaded: false,
      profiles_ready: [],
      device_requested: cfg.ocrDevice,
      device_actual: "unknown",
      gpu_available: false,
      active_jobs: 0,
      success_count: 0,
      failure_count: 0,
    },
    config: {
      ocrEngine: cfg.ocrEngine,
      ocrProfile: cfg.ocrProfile,
      ocrDevice: cfg.ocrDevice,
      ocrLowConfidenceThreshold: cfg.ocrLowConfidenceThreshold,
      ocrRetryAccurate: cfg.ocrRetryAccurate,
      ocrTesseractFallback: cfg.ocrTesseractFallback,
      ocrVisionFallback: cfg.ocrVisionFallback,
      ocrWorkerUrl: cfg.ocrWorkerUrl,
      ocrWorkerTokenConfigured: !!cfg.ocrWorkerToken,
      aiMode: cfg.aiMode,
      aiConcurrency: cfg.aiConcurrency,
      ocrWorkerConcurrency: cfg.ocrWorkerConcurrency,
    },
    modelRegistry: registry,
  });
});

aiPipelineHealthRouter.post("/test", async (req, res) => {
  const cfg = await resolveLocalAiRuntime();
  const mode = String(req.body?.mode || cfg.aiMode).toUpperCase();
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const dryRun = Boolean(req.body?.dryRun) || req.query.dryRun === "1";

  let ocrResult: Awaited<ReturnType<typeof runPaddleOcr>> | null = null;
  let ocrError: string | null = null;

  if (!dryRun && cfg.ocrEngine === "paddle") {
    const tOcr = Date.now();
    try {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC",
        "base64",
      );
      ocrResult = await runPaddleOcr({
        buffer: png,
        filename: "pipeline-test.png",
        mimeType: "image/png",
        profile: "fast",
        preprocess: true,
      });
    } catch (e) {
      ocrError = e instanceof Error ? e.message : String(e);
    }
    timings.ocrMs = Date.now() - tOcr;
  }

  const sampleText =
    ocrResult?.text?.trim() ||
    [
      "Patient Details: Test Patient",
      "Clinical History: Routine check",
      "Technique: USG abdomen",
      "Findings: Liver appears normal. No free fluid.",
      "Impression: Normal study.",
      "Advice: None.",
    ].join("\n");

  const tParse = Date.now();
  const parsed = parseDocumentFromOcr(sampleText, cfg.pipelineVersion);
  timings.parseMs = Date.now() - tParse;

  const installed = await listOllamaModels(cfg.ollamaBaseUrl);
  const ollamaProbe = await probeOllamaReachable(cfg.ollamaBaseUrl);
  const routing = routeAiModel({
    mode: mode as "AUTO" | "FAST" | "STANDARD" | "DEEP" | "OCR_ONLY",
    task: mode === "OCR_ONLY" ? "ocr_only" : "demographic_extraction",
    ocrConfidence: ocrResult?.mean_confidence ?? 0.95,
    documentLength: sampleText.length,
    pageCount: 1,
    imageUnderstandingRequired: false,
    structuredExtractionSucceeded: true,
    installedModels: installed,
    ollamaReachable: ollamaProbe.reachable,
  });

  const v = validateDraftReport({
    status: "DRAFT",
    findings: parsed.sections.findings || "Liver appears normal.",
    impression: parsed.sections.impression || "Normal study.",
    advice: "",
    warnings: ["AI output is DRAFT — radiologist approval required"],
    uncertainty: [],
    evidenceNotes: ["from OCR evidence only"],
  });

  timings.totalMs = Date.now() - t0;
  res.json({
    ok: !ocrError || dryRun,
    dryRun,
    ocr: ocrResult
      ? {
          ok: ocrResult.ok,
          confidence: ocrResult.mean_confidence,
          pathUsed: ocrResult.path_used,
          device: ocrResult.device,
          profile: ocrResult.profile,
          empty: ocrResult.empty,
          warnings: ocrResult.warnings,
          charCount: ocrResult.text.length,
        }
      : { skipped: true, error: ocrError },
    routing: {
      useLlm: routing.useLlm,
      model: routing.model,
      reason: routing.reason,
      warnings: routing.warnings,
      mode: routing.mode,
    },
    draft: {
      status: "DRAFT",
      labeledDraft: true,
      validation: v.ok ? { ok: true, status: "DRAFT" } : { ok: false, error: !v.ok ? v.error : undefined },
    },
    expectedModel: cfg.modelStandard,
    selectedModel: routing.model,
    canonicalRuntime: {
      ollamaUrl: cfg.ollamaBaseUrl,
      aiMode: cfg.aiMode,
      modelFast: cfg.modelFast,
      modelStandard: cfg.modelStandard,
      modelLarge: cfg.modelLarge,
      modelVision: cfg.modelVision,
    },
    parsedSections: Object.keys(parsed.sections),
    promptCatalog: Object.keys(PROMPTS),
    timings,
    note: "AI output is always DRAFT and requires radiologist approval. This endpoint uses non-PHI samples only.",
  });
});

aiPipelineHealthRouter.get("/models", async (_req, res) => {
  const cfg = await resolveLocalAiRuntime();
  const installed = await listOllamaModels(cfg.ollamaBaseUrl);
  res.json({
    registry: buildModelRegistry().map((e) => {
      const name =
        e.id === "fast" ? cfg.modelFast
          : e.id === "standard" ? cfg.modelStandard
            : e.id === "large" ? cfg.modelLarge
              : cfg.modelVision;
      return {
        ...e,
        ollamaName: name,
        installed: installed.length === 0 ? null : installed.includes(name),
        likelyTooLargeForRtx3050: isLikelyTooLargeForRtx3050(name),
      };
    }),
    installed,
    defaults: {
      AI_MODEL_FAST: cfg.modelFast,
      AI_MODEL_STANDARD: cfg.modelStandard,
      AI_MODEL_LARGE: cfg.modelLarge,
      AI_MODEL_VISION: cfg.modelVision,
      AI_MODE: cfg.aiMode,
      ollamaUrlSource: cfg.ollamaUrlSource,
      modelStandardSource: cfg.modelStandardSource,
    },
  });
});

void parseJsonFromModel;
