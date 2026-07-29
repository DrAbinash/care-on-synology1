/**
 * OCR orchestrator:
 * 1) Paddle fast → quality check → optional accurate retry
 * 2) Technical failure → optional Tesseract-fallback flag (client/offline) or vision path
 * Never silently return empty success.
 */

import { loadAiPipelineConfig } from "../aiPipeline/config";
import { parseDocumentFromOcr, type ParsedDocument } from "../aiPipeline/documentParser";
import { phiSafeOcrLog } from "../aiPipeline/phiSafeLog";
import { assessOcrQuality } from "./ocrQuality";
import { fetchPaddleHealth, runPaddleOcr, type PaddleOcrResponse } from "./paddleOcrClient";

export type OcrPhase =
  | "uploaded"
  | "preprocessing"
  | "ocr_fast"
  | "ocr_accurate_retry"
  | "parsing"
  | "completed"
  | "failed";

export interface OrchestratedOcrResult {
  ok: boolean;
  phase: OcrPhase;
  engine: "paddle" | "none";
  pathUsed: string;
  paddle?: PaddleOcrResponse;
  parsed?: ParsedDocument;
  timings: {
    ocrMs: number;
    parseMs: number;
    totalMs: number;
  };
  warnings: string[];
  tesseractFallbackSuggested: boolean;
  diagnosticsLog: Record<string, unknown>;
}

export async function orchestrateDocumentOcr(opts: {
  buffer: Buffer;
  mimeType?: string;
  filename?: string;
  expectedKeywords?: string[];
  profile?: "fast" | "accurate" | "auto";
}): Promise<OrchestratedOcrResult> {
  const cfg = loadAiPipelineConfig();
  const warnings: string[] = [];
  const t0 = Date.now();

  if (cfg.ocrEngine === "tesseract") {
    return {
      ok: false,
      phase: "failed",
      engine: "none",
      pathUsed: "rollback:tesseract",
      timings: { ocrMs: 0, parseMs: 0, totalMs: Date.now() - t0 },
      warnings: ["OCR_ENGINE=tesseract — server Paddle disabled; use client Tesseract or vision path"],
      tesseractFallbackSuggested: true,
      diagnosticsLog: phiSafeOcrLog({ engine: "tesseract", pathUsed: "rollback:tesseract" }),
    };
  }

  if (cfg.ocrEngine !== "paddle") {
    return {
      ok: false,
      phase: "failed",
      engine: "none",
      pathUsed: `engine:${cfg.ocrEngine}`,
      timings: { ocrMs: 0, parseMs: 0, totalMs: Date.now() - t0 },
      warnings: [`OCR_ENGINE=${cfg.ocrEngine} — orchestrator expects paddle`],
      tesseractFallbackSuggested: cfg.ocrTesseractFallback,
      diagnosticsLog: phiSafeOcrLog({ engine: cfg.ocrEngine }),
    };
  }

  const health = await fetchPaddleHealth();
  if (!health?.ok) {
    warnings.push("paddle_worker_unreachable");
    return {
      ok: false,
      phase: "failed",
      engine: "none",
      pathUsed: "paddle:unreachable",
      timings: { ocrMs: 0, parseMs: 0, totalMs: Date.now() - t0 },
      warnings,
      tesseractFallbackSuggested: cfg.ocrTesseractFallback,
      diagnosticsLog: phiSafeOcrLog({ engine: "paddle", pathUsed: "paddle:unreachable", warnings }),
    };
  }

  let phase: OcrPhase = "ocr_fast";
  let paddle: PaddleOcrResponse | undefined;
  const ocrStarted = Date.now();
  try {
    paddle = await runPaddleOcr({
      buffer: opts.buffer,
      mimeType: opts.mimeType,
      filename: opts.filename,
      profile: opts.profile ?? "auto",
      expectedKeywords: opts.expectedKeywords,
    });
  } catch (err) {
    warnings.push(`paddle_technical_failure:${err instanceof Error ? err.message : String(err)}`);
    return {
      ok: false,
      phase: "failed",
      engine: "none",
      pathUsed: "paddle:error",
      timings: { ocrMs: Date.now() - ocrStarted, parseMs: 0, totalMs: Date.now() - t0 },
      warnings,
      tesseractFallbackSuggested: cfg.ocrTesseractFallback,
      diagnosticsLog: phiSafeOcrLog({ engine: "paddle", pathUsed: "paddle:error", warnings }),
    };
  }
  const ocrMs = Date.now() - ocrStarted;

  if (paddle.empty || !paddle.text?.trim()) {
    warnings.push("empty_ocr_rejected", ...(paddle.warnings || []));
    return {
      ok: false,
      phase: "failed",
      engine: "paddle",
      pathUsed: paddle.path_used || "paddle:empty",
      paddle,
      timings: { ocrMs, parseMs: 0, totalMs: Date.now() - t0 },
      warnings,
      tesseractFallbackSuggested: cfg.ocrTesseractFallback,
      diagnosticsLog: phiSafeOcrLog({
        engine: "paddle",
        pathUsed: paddle.path_used,
        meanConfidence: paddle.mean_confidence,
        warnings,
      }),
    };
  }

  // Node-side quality gate (worker may already have retried accurate)
  const lineConfs = paddle.pages.flatMap((p) => p.lines.map((l) => l.confidence));
  const quality = assessOcrQuality({
    meanConfidence: paddle.mean_confidence,
    lineConfidences: lineConfs,
    text: paddle.text,
    lowConfidenceThreshold: cfg.ocrLowConfidenceThreshold,
    expectedKeywords: opts.expectedKeywords,
  });
  if (quality.isLowQuality) {
    warnings.push(...quality.reasons);
    phase = "ocr_accurate_retry";
  }

  const parseStarted = Date.now();
  phase = "parsing";
  const parsed = parseDocumentFromOcr(paddle.text, cfg.pipelineVersion);
  const parseMs = Date.now() - parseStarted;

  return {
    ok: true,
    phase: "completed",
    engine: "paddle",
    pathUsed: paddle.path_used,
    paddle,
    parsed,
    timings: { ocrMs, parseMs, totalMs: Date.now() - t0 },
    warnings: [...warnings, ...(paddle.warnings || [])],
    tesseractFallbackSuggested: false,
    diagnosticsLog: phiSafeOcrLog({
      engine: "paddle",
      pathUsed: paddle.path_used,
      meanConfidence: paddle.mean_confidence,
      pageCount: paddle.pages.length,
      charCount: paddle.text.length,
      warnings,
    }),
  };
}