/**
 * Client-side Tesseract.js OCR for Form F ID cards.
 *
 * Used as an automatic fallback when the AI path (Ollama → Gemini via
 * POST /api/form-f/upload-id) fails or returns empty fields. Assets are
 * served same-origin from /tesseract/ (see scripts/copy-tesseract-assets.mjs)
 * — identical setup to PurchaseInvoiceScannerPanel's offline scan.
 *
 * Preprocesses the image (grayscale + contrast stretch + mild upscale) and
 * tries a couple of page-segmentation modes before parsing — raw JPEG
 * recognize() alone misses a lot of thin Aadhaar print.
 */

import { parseIdCardText, type ParsedIdCardText } from "./idCardTextParser";

export type IdCardTesseractResult = ParsedIdCardText & {
  ocrProvider: "tesseract";
  rawText: string;
};

const TESSERACT_OPTS = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/tesseract-core.wasm.js",
  langPath: "/tesseract",
  cachePath: "/tesseract",
  gzip: true as const,
};

/** Prefer SINGLE_BLOCK for card bodies, then SINGLE_COLUMN, then AUTO. */
const PSM_CANDIDATES = ["SINGLE_BLOCK", "SINGLE_COLUMN", "AUTO"] as const;

/**
 * Build a Tesseract-friendly data URL: grayscale, contrast-stretched, and
 * mildly upscaled when the crop is narrow (common after auto-crop of a
 * card that only filled part of a webcam frame).
 */
async function prepareImageForTesseract(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const minWidth = 1400;
        const scale = img.naturalWidth > 0 && img.naturalWidth < minWidth
          ? minWidth / img.naturalWidth
          : 1;
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        const luma = new Float32Array(w * h);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          luma[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
        // 2nd–98th percentile stretch — same idea as IdCardScanPanel document mode
        const sorted = Float32Array.from(luma).sort();
        const lo = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
        const hi = sorted[Math.floor(sorted.length * 0.98)] ?? 255;
        const range = Math.max(1, hi - lo);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const v = Math.max(0, Math.min(255, ((luma[p] - lo) / range) * 255));
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.95));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function scoreRawText(text: string): number {
  const t = text.trim();
  if (t.length < 8) return 0;
  let score = Math.min(t.length, 400);
  if (/\b(?:aadhaar|uidai|father|husband|s\/o|w\/o|d\/o|address|dob)\b/i.test(t)) score += 80;
  if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(t)) score += 60;
  if (/\b(?:male|female|gender|sex)\b/i.test(t)) score += 20;
  return score;
}

/**
 * Run Tesseract on a data URL or raw base64 (+ mime). Returns parsed ID
 * fields, or null when nothing useful was extracted.
 */
export async function runIdCardTesseractOcr(
  imageBase64OrDataUrl: string,
  mimeType = "image/jpeg",
  onProgress?: (pct: number) => void,
): Promise<IdCardTesseractResult | null> {
  const dataUrl = imageBase64OrDataUrl.startsWith("data:")
    ? imageBase64OrDataUrl
    : `data:${mimeType};base64,${imageBase64OrDataUrl}`;
  const prepared = await prepareImageForTesseract(dataUrl);

  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    worker = await createWorker("eng", 1, {
      ...TESSERACT_OPTS,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    let bestText = "";
    let bestScore = 0;
    for (let i = 0; i < PSM_CANDIDATES.length; i++) {
      const key = PSM_CANDIDATES[i];
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM[key],
          preserve_interword_spaces: "1",
        });
      } catch {
        // Older builds may reject unknown params — still try recognize().
      }
      const { data } = await worker.recognize(prepared);
      const rawText = (data.text || "").trim();
      const score = scoreRawText(rawText);
      if (score > bestScore) {
        bestScore = score;
        bestText = rawText;
      }
      // Early exit when we already have a strong Aadhaar-like read
      if (bestScore >= 200) break;
      if (onProgress) onProgress(Math.round(((i + 1) / PSM_CANDIDATES.length) * 100));
    }

    if (bestText.length < 8) return null;

    const parsed = parseIdCardText(bestText);
    if (!parsed.guardianName && !parsed.address && !parsed.idNumber) return null;

    return { ...parsed, ocrProvider: "tesseract", rawText: bestText };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* best-effort */ }
    }
  }
}
