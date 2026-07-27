/**
 * Client-side Tesseract.js OCR for Form F ID cards.
 *
 * Used as an automatic fallback when the AI path (Ollama → Gemini via
 * POST /api/form-f/upload-id) fails or returns empty fields. Assets are
 * served same-origin from /tesseract/ (see scripts/copy-tesseract-assets.mjs)
 * — identical setup to PurchaseInvoiceScannerPanel's offline scan.
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

  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", 1, {
      ...TESSERACT_OPTS,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });
    const { data } = await worker.recognize(dataUrl);
    const rawText = (data.text || "").trim();
    if (rawText.length < 8) return null;

    const parsed = parseIdCardText(rawText);
    if (!parsed.guardianName && !parsed.address && !parsed.idNumber) return null;

    return { ...parsed, ocrProvider: "tesseract", rawText };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* best-effort */ }
    }
  }
}
