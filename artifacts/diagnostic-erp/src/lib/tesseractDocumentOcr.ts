/**
 * Same-origin Tesseract.js recognize for expense / bank / invoice scans.
 */
const TESSERACT_OPTS = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/tesseract-core.wasm.js",
  langPath: "/tesseract",
  cachePath: "/tesseract",
  gzip: true as const,
};

export async function recognizeDocumentText(
  imageBase64: string,
  mimeType = "image/jpeg",
): Promise<string> {
  const dataUrl = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;

  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", 1, TESSERACT_OPTS);
    const { data } = await worker.recognize(dataUrl);
    return (data.text || "").trim();
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* ignore */ }
    }
  }
}
