import { geminiOcrIdCard, type IdCardOcrResult } from "@workspace/integrations-gemini-ai";
import { loadAiPipelineConfig } from "../aiPipeline/config";
import { ollamaOcrIdCard } from "./idCardOcrOllama";
import { type OcrProviderChoice } from "./ocrProviderResolver";
import { orchestrateDocumentOcr } from "./ocrOrchestrator";
import { idFieldsToOcrResult, parseIdCardTextServer } from "./idCardTextFromOcr";

/**
 * Shared image pre-processing applied before OCR, reused by both the ID-card
 * pipeline (below) and the expense-bill scan flow (routes/expenses.ts).
 *
 * WHAT THIS ACTUALLY DOES (implemented with `sharp`, already a dependency):
 *   - Auto-orient: applies the image's EXIF orientation tag so a photo taken
 *     sideways/upside-down is corrected before OCR sees it.
 *   - Trim: removes uniform-colored borders (approximates auto-crop when the
 *     capture has a plain background around the document/card).
 *   - Normalize: stretches the contrast histogram, helping OCR read faint or
 *     low-contrast text/print.
 *   - Mild sharpen: unsharp-mask so thin Aadhaar/PAN glyphs stay crisp after
 *     JPEG re-encode (webcam captures benefit most).
 *   - Blur detection: Laplacian-variance sharpness score on the final image,
 *     returned to the caller so it can warn "too blurred" before accepting
 *     OCR output, and so the manual-verification step can be shown a
 *     confidence signal.
 *
 * WHAT THIS DOES NOT DO YET (documented gap, not silently claimed as done):
 *   - True deskew (rotating a tilted-but-not-90°-off document to level) and
 *     full perspective correction (warping a document photographed at an
 *     angle into a flat rectangle) require contour/corner detection that
 *     `sharp` does not provide — that class of correction needs a proper
 *     computer-vision library (e.g. OpenCV) and has not been implemented.
 *     Trim + normalize + sharpen + auto-orient are real, working improvements;
 *     deskew/perspective-correction are not — do not claim otherwise downstream.
 */
export interface PreprocessResult {
  buffer: Buffer;
  mimeType: string;
  blurScore: number;
  isBlurred: boolean;
  appliedSteps: string[];
}

// Below this Laplacian-variance score, the image is flagged as too blurred
// for reliable OCR. Same heuristic/threshold family as the client-side
// tvsDeviceProfile.ts blur check — untuned against real hardware captures,
// treat as a starting point.
export const SERVER_BLUR_WARNING_THRESHOLD = 60;

export interface PreprocessOptions {
  /** Downscale-if-larger-than, in pixels (width). Default 2400 — keeps enough
   * glyph detail for Indian ID cards after crop without bloating a 12MP phone
   * capture into OCR latency. Never enlarges a smaller image. */
  maxWidth?: number;
  /** JPEG re-encode quality, 1-100. Default 92 — OCR accuracy prefers detail
   * over a few KB of savings on ID-card payloads. */
  jpegQuality?: number;
}

export async function preprocessScanImage(
  imageBase64: string,
  mimeType: string,
  options: PreprocessOptions = {},
): Promise<PreprocessResult> {
  const inputBuffer = Buffer.from(imageBase64, "base64");
  const appliedSteps: string[] = [];
  const maxWidth = options.maxWidth ?? 2400;
  const jpegQuality = options.jpegQuality ?? 92;

  if (mimeType.includes("pdf")) {
    // Sharp cannot process PDFs; return as-is with a neutral (non-blurred)
    // score rather than misleadingly running pixel analysis on non-image bytes.
    return { buffer: inputBuffer, mimeType, blurScore: SERVER_BLUR_WARNING_THRESHOLD, isBlurred: false, appliedSteps: [] };
  }

  try {
    const sharp = (await import("sharp")).default;
    let pipeline = sharp(inputBuffer).rotate(); // auto-orient via EXIF
    appliedSteps.push("auto-orient");
    // Tolerate slightly noisy borders so trim still fires on flatbed mats /
    // desk backgrounds without eating into the card itself.
    pipeline = pipeline.trim({ threshold: 16 });
    appliedSteps.push("trim");
    pipeline = pipeline.normalize();
    appliedSteps.push("normalize");
    // Mild unsharp — enough to recover thin printed digits after normalize +
    // JPEG, not so strong that webcam noise becomes "text".
    pipeline = pipeline.sharpen({ sigma: 0.8, m1: 0.6, m2: 0.3 });
    appliedSteps.push("sharpen");
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    appliedSteps.push(`downscale-max-${maxWidth}px`);

    const processed = await pipeline.jpeg({ quality: jpegQuality, mozjpeg: true }).toBuffer();

    // Blur score on a downsampled grayscale copy of the PROCESSED image —
    // same Laplacian-variance approach as the client-side check, computed
    // server-side against the final bytes that will actually go to OCR.
    const { data, info } = await sharp(processed)
      .resize({ width: 240, withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const blurScore = laplacianVariance(data, info.width, info.height);

    return {
      buffer: processed,
      mimeType: "image/jpeg",
      blurScore,
      isBlurred: blurScore < SERVER_BLUR_WARNING_THRESHOLD,
      appliedSteps,
    };
  } catch {
    // sharp unavailable or processing failed — fall back to the raw image
    // rather than blocking OCR entirely.
    return { buffer: inputBuffer, mimeType, blurScore: SERVER_BLUR_WARNING_THRESHOLD, isBlurred: false, appliedSteps: [] };
  }
}

function laplacianVariance(gray: Buffer, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - width] - gray[idx + width];
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export interface IdCardPipelineResult {
  ocrResult: IdCardOcrResult | null;
  blurScore: number;
  isBlurred: boolean;
  preprocessApplied: string[];
  /** Set when PaddleOCR path ran — diagnostics for Form F /admin health. */
  paddleMeta?: {
    pathUsed: string;
    meanConfidence?: number;
    warnings: string[];
    tesseractFallbackSuggested: boolean;
  };
}

/**
 * Full ID-card OCR pipeline.
 *
 * Default (OCR_ENGINE=paddle): PaddleOCR worker → deterministic text parse.
 * Does NOT send the image to an LLM when OCR text is sufficient.
 *
 * Fallback order when Paddle is unavailable / empty:
 *   1) Vision LLM (Ollama / Gemini) if resolver provided one
 *   2) Client Tesseract suggested via paddleMeta.tesseractFallbackSuggested
 *
 * Rollback: OCR_ENGINE=tesseract|vision skips Paddle and uses the legacy
 * vision path only.
 *
 * Manual verification of extracted fields remains the caller's responsibility
 * (Form F shows OCR output in editable fields — never auto-commits as final).
 */
export async function runIdCardOcrPipeline(
  imageBase64: string,
  mimeType: string,
  provider: OcrProviderChoice,
): Promise<IdCardPipelineResult> {
  const pre = await preprocessScanImage(imageBase64, mimeType);
  const processedBase64 = pre.buffer.toString("base64");
  const cfg = loadAiPipelineConfig();

  // ── Paddle-first path (production default) ──────────────────────────────
  if (cfg.ocrEngine === "paddle") {
    const orch = await orchestrateDocumentOcr({
      buffer: pre.buffer,
      mimeType: pre.mimeType,
      filename: "id-card.jpg",
      expectedKeywords: ["name", "address"],
    });
    if (orch.ok && orch.paddle?.text) {
      const fields = parseIdCardTextServer(orch.paddle.text);
      const ocrResult = idFieldsToOcrResult(fields, {
        ocrProvider: "paddle",
        meanConfidence: orch.paddle.mean_confidence,
      });
      ocrResult.rawText = orch.parsed?.normalizedText ?? orch.paddle.text;
      return {
        ocrResult,
        blurScore: pre.blurScore,
        isBlurred: pre.isBlurred,
        preprocessApplied: pre.appliedSteps,
        paddleMeta: {
          pathUsed: orch.pathUsed,
          meanConfidence: orch.paddle.mean_confidence,
          warnings: orch.warnings,
          tesseractFallbackSuggested: orch.tesseractFallbackSuggested,
        },
      };
    }
    // Paddle failed — fall through to vision if available
  }

  if (provider.provider === "none") {
    // Preserve previous behavior: throw when nothing can run
    if (cfg.ocrTesseractFallback) {
      return {
        ocrResult: null,
        blurScore: pre.blurScore,
        isBlurred: pre.isBlurred,
        preprocessApplied: pre.appliedSteps,
        paddleMeta: {
          pathUsed: "none",
          warnings: ["no_vision_provider", "suggest_client_tesseract"],
          tesseractFallbackSuggested: true,
        },
      };
    }
    throw new Error("No OCR provider available");
  }

  const ocrResult = provider.provider === "ollama"
    ? await ollamaOcrIdCard(processedBase64, { endpointUrl: provider.endpointUrl, model: provider.model })
    : await geminiOcrIdCard(processedBase64, pre.mimeType, { apiKey: provider.apiKey });

  return {
    ocrResult,
    blurScore: pre.blurScore,
    isBlurred: pre.isBlurred,
    preprocessApplied: pre.appliedSteps,
  };
}
