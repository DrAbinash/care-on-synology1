/**
 * useDocumentScan.ts — small convenience hook around UnifiedScanCapture's
 * result shape, so callers don't have to hand-roll the same
 * "convert to base64 for my existing OCR endpoint" boilerplate.
 *
 * This does NOT persist to the server on its own yet — the shared
 * `scanned_documents` metadata table (module/entityId/docType/scanSource/
 * ocrStatus tracking) lands in a later phase. Until then, each caller keeps
 * posting the returned base64 to its own existing OCR/save endpoint exactly
 * as it does today (e.g. /api/form-f/upload-id, /api/expenses/scan-bill) —
 * this hook only removes the repeated blob-to-base64 conversion.
 */
import { useCallback, useState } from "react";
import type { ScanCaptureResult } from "@/components/UnifiedScanCapture";

export interface DocumentScanState {
  base64: string;
  mimeType: string;
  dataUrl: string;
  source: ScanCaptureResult["source"];
  filename?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read captured file"));
    reader.readAsDataURL(blob);
  });
}

export function useDocumentScan() {
  const [scan, setScan] = useState<DocumentScanState | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCapture = useCallback(async (result: ScanCaptureResult): Promise<DocumentScanState> => {
    setBusy(true);
    try {
      const dataUrl = await blobToDataUrl(result.file);
      const base64 = dataUrl.split(",")[1] ?? "";
      const next: DocumentScanState = {
        base64,
        mimeType: result.mimeType,
        dataUrl,
        source: result.source,
        filename: result.filename,
      };
      setScan(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => setScan(null), []);

  return { scan, busy, handleCapture, clear };
}
