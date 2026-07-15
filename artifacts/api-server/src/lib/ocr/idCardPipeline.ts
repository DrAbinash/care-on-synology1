import { geminiOcrIdCard, type IdCardOcrResult } from "@workspace/integrations-gemini-ai";
import { ollamaOcrIdCard } from "./idCardOcrOllama";
import { type OcrProviderChoice } from "./ocrProviderResolver";

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
 *     Trim + normalize + auto-orient are real, working improvements; deskew/
 *     perspective-correction are not — do not claim otherwise downstream.
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
  /** Downscale-if-larger-than, in pixels (width). Default 2000 — prevents an
   * unnecessarily huge phone/camera capture (e.g. 12MP+) from bloating
   * storage and slowing OCR/page-load; never enlarges a smaller image. */
  maxWidth?: number;
  /** JPEG re-encode quality, 1-100. Default 88 — a reasonable balance of
   * file size vs. OCR-relevant detail; tune per deployment if needed. */
  jpegQuality?: number;
}

export async function preprocessScanImage(
  imageBase64: string,
  mimeType: string,
  options: PreprocessOptions = {},
): Promise<PreprocessResult> {
  const inputBuffer = Buffer.from(imageBase64, "base64");
  const appliedSteps: string[] = [];
  const maxWidth = options.maxWidth ?? 2000;
  const jpegQuality = options.jpegQuality ?? 88;

  if (mimeType.includes("pdf")) {
    // Sharp cannot process PDFs; return as-is with a neutral (non-blurred)
    // score rather than misleadingly running pixel analysis on non-image bytes.
    return { buffer: inputBuffer, mimeType, blurScore: SERVER_BLUR_WARNING_THRESHOLD, isBlurred: false, appliedSteps: [] };
  }

  try {
    const sharp = (await import("sharp")).default;
    let pipeline = sharp(inputBuffer).rotate(); // auto-orient via EXIF
    appliedSteps.push("auto-orient");
    pipeline = pipeline.trim();
    appliedSteps.push("trim");
    pipeline = pipeline.normalize();
    appliedSteps.push("normalize");
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
}

/**
 * Full ID-card OCR pipeline: pre-process, then dispatch to whichever
 * provider ocrProviderResolver.ts already decided on (Ollama or Gemini —
 * see resolveOcrProvider()'s Ollama-first/Gemini-fallback policy). This
 * function no longer picks a provider itself; it only executes against the
 * one it's handed, so preprocessing (EXIF-orient/trim/normalize/downscale)
 * is applied identically regardless of which provider runs the actual OCR
 * call. Manual verification of the extracted fields before they're saved
 * remains the caller's responsibility (Form F shows OCR output in editable
 * form fields rather than auto-committing it).
 */
export async function runIdCardOcrPipeline(
  imageBase64: string,
  mimeType: string,
  provider: OcrProviderChoice,
): Promise<IdCardPipelineResult> {
  const pre = await preprocessScanImage(imageBase64, mimeType);
  const processedBase64 = pre.buffer.toString("base64");

  if (pre.isBlurred) {
    // Still attempt OCR (a blur warning shouldn't silently withhold results —
    // the caller decides whether to show/trust them), but the caller can use
    // isBlurred to surface a "too blurred, consider retaking" message.
  }

  if (provider.provider === "none") {
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
