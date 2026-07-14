import { preprocessScanImage, SERVER_BLUR_WARNING_THRESHOLD } from "./idCardPipeline";

/**
 * Generates the three stored copies of every scanned document, per the
 * "Original / OCR-processed / Thumbnail" requirement:
 *   - original:  byte-for-byte as captured, never re-encoded — the legal-
 *                evidence copy. Always succeeds (it's just the input bytes).
 *   - processed: auto-oriented/trimmed/contrast-normalized/downscaled JPEG —
 *                better OCR input, always browser-viewable regardless of
 *                the original's format.
 *   - thumbnail: small JPEG (~300px wide) for fast ERP list/grid loading.
 *
 * processed/thumbnail generation can legitimately fail for some inputs
 * (PDFs — sharp cannot rasterize them; HEIC/HEIF — see the note below) and
 * this returns `null` for that variant plus a `variantsError` explaining
 * why, rather than blocking the whole upload. The original is always stored
 * regardless.
 *
 * HEIC/HEIF NOTE — UNVERIFIED IN THIS ENVIRONMENT, read before assuming it
 * works: standard prebuilt `sharp` binaries commonly ship with HEIC *decode*
 * disabled even when the underlying libheif reports HEIF support (AVIF
 * decode is usually still enabled — same container format, different,
 * unencumbered codec). This has NOT been confirmed against the actual
 * production Docker image's sharp build. If HEIC decode is unavailable,
 * this function catches the failure and returns a clear `variantsError`
 * instead of a generic crash — but the practical effect is that HEIC
 * uploads currently get NO processed/thumbnail copy, only the original.
 * See docs/IMAGE_NORMALIZATION.md for what a real test needs to confirm.
 */
export interface ImageVariant {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageVariants {
  original: ImageVariant;
  processed: (ImageVariant & { blurScore: number; isBlurred: boolean }) | null;
  thumbnail: ImageVariant | null;
  variantsError?: string;
}

const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_QUALITY = 70;

export async function generateImageVariants(
  imageBase64: string,
  mimeType: string,
  options: { maxWidth?: number; jpegQuality?: number } = {},
): Promise<ImageVariants> {
  const originalBuffer = Buffer.from(imageBase64, "base64");
  const original: ImageVariant = { buffer: originalBuffer, mimeType };

  if (mimeType.includes("pdf")) {
    return {
      original,
      processed: null,
      thumbnail: null,
      variantsError: "PDF preview/thumbnail generation is not implemented — sharp cannot rasterize PDF pages. The original PDF is stored and usable as-is.",
    };
  }

  try {
    const pre = await preprocessScanImage(imageBase64, mimeType, options);
    const processed: ImageVariant & { blurScore: number; isBlurred: boolean } = {
      buffer: pre.buffer,
      mimeType: pre.mimeType,
      blurScore: pre.blurScore,
      isBlurred: pre.isBlurred,
    };

    const sharp = (await import("sharp")).default;
    const thumbBuffer = await sharp(pre.buffer)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toBuffer();

    return { original, processed, thumbnail: { buffer: thumbBuffer, mimeType: "image/jpeg" } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const isHeic = mimeType.includes("heic") || mimeType.includes("heif");
    return {
      original,
      processed: null,
      thumbnail: null,
      variantsError: isHeic
        ? `Could not generate a processed/thumbnail copy for this HEIC/HEIF image — this server's image library may not have HEIC decode enabled (see docs/IMAGE_NORMALIZATION.md). Original stored as-is. Detail: ${detail}`
        : `Could not generate a processed/thumbnail copy for this image. Original stored as-is. Detail: ${detail}`,
    };
  }
}

export { SERVER_BLUR_WARNING_THRESHOLD };
