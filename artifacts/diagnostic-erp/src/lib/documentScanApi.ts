import { api } from "./fetchApi";

export type DocumentScanModule = "form-f" | "patients" | "expenses" | "banking";
export type DocumentScanDocType = "id-card" | "bill" | "bank-statement" | "photo" | "other";
export type DocumentScanSource = "tvs" | "bridge" | "upload" | "mobile" | "webcam";

export interface PersistDocumentScanInput {
  module: DocumentScanModule;
  entityType: string;
  entityId?: number;
  docType: DocumentScanDocType;
  fileName: string;
  mimeType: string;
  base64Data: string;
  scanSource: DocumentScanSource;
  deviceLabel?: string;
}

export interface PersistDocumentScanResult {
  id: number;
  storagePath: string;
  url: string;
  mimeType: string;
  processedUrl: string | null;
  thumbnailUrl: string | null;
  isLinked: boolean;
}

export async function persistDocumentScan(input: PersistDocumentScanInput): Promise<PersistDocumentScanResult> {
  return api.post<PersistDocumentScanResult>("/api/scans", input);
}

export async function linkDocumentScan(scanId: number, entityId: number): Promise<void> {
  await api.post(`/api/scans/${scanId}/link`, { entityId });
}

export async function blobToScanBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

/** Fire-and-forget scan persistence — never blocks the caller's primary workflow. */
export async function persistDocumentScanFromBlob(
  blob: Blob,
  opts: Omit<PersistDocumentScanInput, "base64Data" | "mimeType" | "fileName"> & {
    mimeType?: string;
    fileName?: string;
  },
): Promise<PersistDocumentScanResult | null> {
  try {
    const base64Data = await blobToScanBase64(blob);
    if (!base64Data) return null;
    const mimeType = opts.mimeType || blob.type || "image/jpeg";
    const fileName = opts.fileName || `scan-${Date.now()}.jpg`;
    return await persistDocumentScan({
      ...opts,
      base64Data,
      mimeType,
      fileName,
    });
  } catch {
    return null;
  }
}
