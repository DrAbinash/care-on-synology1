/**
 * useDocumentScan.ts — small convenience hook around UnifiedScanCapture's
 * result shape, so callers don't have to hand-roll the same
 * "convert to base64 for my existing OCR endpoint" boilerplate.
 *
 * This hook optionally persists captures via POST /api/scans when `persist`
 * options are supplied; otherwise callers keep posting base64 to module OCR
 * endpoints exactly as before.
 */
import { useCallback, useState } from "react";
import type { ScanCaptureResult } from "@/components/UnifiedScanCapture";
import {
  type DocumentScanDocType,
  type DocumentScanModule,
  persistDocumentScanFromBlob,
} from "@/lib/documentScanApi";

export interface DocumentScanState {
  base64: string;
  mimeType: string;
  dataUrl: string;
  source: ScanCaptureResult["source"];
  filename?: string;
  scanId?: number;
}

export interface UseDocumentScanOptions {
  persist?: {
    module: DocumentScanModule;
    entityType: string;
    docType: DocumentScanDocType;
    entityId?: number;
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read captured file"));
    reader.readAsDataURL(blob);
  });
}

export function useDocumentScan(options?: UseDocumentScanOptions) {
  const [scan, setScan] = useState<DocumentScanState | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCapture = useCallback(async (result: ScanCaptureResult): Promise<DocumentScanState> => {
    setBusy(true);
    try {
      const dataUrl = await blobToDataUrl(result.file);
      const base64 = dataUrl.split(",")[1] ?? "";
      let scanId: number | undefined;
      if (options?.persist) {
        const persisted = await persistDocumentScanFromBlob(result.file, {
          module: options.persist.module,
          entityType: options.persist.entityType,
          docType: options.persist.docType,
          entityId: options.persist.entityId,
          scanSource: result.source,
          deviceLabel: result.deviceLabel,
          fileName: result.filename,
          mimeType: result.mimeType,
        });
        scanId = persisted?.id;
      }
      const next: DocumentScanState = {
        base64,
        mimeType: result.mimeType,
        dataUrl,
        source: result.source,
        filename: result.filename,
        scanId,
      };
      setScan(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, [options?.persist]);

  const clear = useCallback(() => setScan(null), []);

  return { scan, busy, handleCapture, clear };
}
