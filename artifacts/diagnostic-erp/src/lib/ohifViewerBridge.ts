/**
 * ohifViewerBridge.ts — listen for postMessage from OHIF (or Frames helper)
 * and forward measurements / key-image picks / capture results into ERP APIs.
 *
 * Contract (OHIF extension or bookmarklet must emit):
 *   { source: "care-ohif", type: "measurement", … annotationId?, intent? }
 *   { source: "care-ohif", type: "key-image", … }
 *   { source: "care-ohif", type: "active-anchor", … }
 *   { source: "care-ohif", type: "viewport-capture-result", … }  // annotated freeze
 *   { source: "care-ohif", type: "measurement-deleted", annotationId }
 *
 * CARE → OHIF (outbound, when iframe same-policy allows):
 *   { source: "care-reporting", type: "viewport-capture-request", version: 1, requestId }
 *   { source: "care-reporting", type: "navigate-to-anchor", version: 1, …UIDs }
 *
 * Security: validate event.origin against allowlist when configured; always
 * validate source + type + requestId for capture results. No iframe DOM access.
 */

import { api } from "@/lib/fetchApi";
import { buildImageRefPayload, nextDisplayOrder, type ReportImageRef } from "@/lib/reportImageRefs";
import { discLevelFromLabel, parseCanalApNumber } from "@/lib/spineCanalAp";
import type { ViewportContext } from "@/lib/observationAnchor";
import type { MeasurementIntent } from "@/lib/structuredViewerMeasurements";

export const CARE_OHIF_SOURCE = "care-ohif";
export const CARE_REPORTING_SOURCE = "care-reporting";

const MAX_CAPTURE_DATA_URL_CHARS = 8_000_000; // ~6 MB base64 JPEG budget

export type CareOhifMeasurementMessage = {
  source: typeof CARE_OHIF_SOURCE;
  type: "measurement";
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number;
  label?: string;
  value: string | number;
  unit?: string;
  measurementType?: string;
  /** Stable OHIF/Cornerstone annotation id for idempotent upserts. */
  annotationId?: string;
  /** Explicit CARE intent when the extension knows it. */
  intent?: MeasurementIntent;
  patientId?: number;
  studyId?: number;
};

export type CareOhifKeyImageMessage = {
  source: typeof CARE_OHIF_SOURCE;
  type: "key-image";
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  frameNumber?: number;
  caption?: string;
  draftId?: number;
  studyId?: number;
};

export type CareOhifActiveAnchorMessage = {
  source: typeof CARE_OHIF_SOURCE;
  type: "active-anchor";
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number;
  seriesDescription?: string;
};

export type CareOhifViewportCaptureResult = {
  source: typeof CARE_OHIF_SOURCE;
  type: "viewport-capture-result";
  version: 1;
  requestId: string;
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number;
  mimeType?: string;
  /** data:image/jpeg;base64,… or raw base64 */
  imageData: string;
  annotations?: unknown;
  error?: string;
};

export type CareOhifMeasurementDeleted = {
  source: typeof CARE_OHIF_SOURCE;
  type: "measurement-deleted";
  annotationId: string;
  studyInstanceUID?: string;
};

export type CareOhifMessage =
  | CareOhifMeasurementMessage
  | CareOhifKeyImageMessage
  | CareOhifActiveAnchorMessage
  | CareOhifViewportCaptureResult
  | CareOhifMeasurementDeleted;

export function isCareOhifMessage(data: unknown): data is CareOhifMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.source !== CARE_OHIF_SOURCE) return false;
  return (
    d.type === "measurement"
    || d.type === "key-image"
    || d.type === "active-anchor"
    || d.type === "viewport-capture-result"
    || d.type === "measurement-deleted"
  );
}

/** Optional origin allowlist — empty means accept any (dev / same-host embeds). */
export function isAllowedOhifOrigin(origin: string, allowlist: string[] | null | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.some((o) => o === origin || o === "*");
}

export function ohifActiveAnchorToViewport(msg: CareOhifActiveAnchorMessage): ViewportContext {
  return {
    studyInstanceUID: msg.studyInstanceUID,
    seriesInstanceUID: msg.seriesInstanceUID,
    sopInstanceUID: msg.sopInstanceUID,
    frameNumber: msg.frameNumber,
    seriesDescription: msg.seriesDescription,
    viewer: "ohif",
  };
}

export type OhifBridgeContext = {
  studyInstanceUID: string | null | undefined;
  patientId: number | null | undefined;
  studyId: number | null | undefined;
  draftId: number | null | undefined;
  getImageRefs?: () => ReportImageRef[];
  onMeasurementSaved?: () => void;
  onKeyImageSaved?: () => void;
  onActiveAnchor?: (ctx: ViewportContext) => void;
  /** Pending capture request ids (reject stale/unknown). */
  pendingCaptureRequestIds?: Set<string>;
  onViewportCaptureResult?: (msg: CareOhifViewportCaptureResult) => void | Promise<void>;
  onMeasurementDeleted?: (annotationId: string) => void;
  allowedOrigins?: string[] | null;
  /** When false, ignore mutating OHIF events (measurement/key-image/capture/delete). */
  mutationsAllowed?: boolean;
};

export async function handleCareOhifMessage(
  msg: CareOhifMessage,
  ctx: OhifBridgeContext,
): Promise<"ok" | "ignored" | "error"> {
  // Finalize / lock gate — refuse mutating events after report is locked.
  if (ctx.mutationsAllowed === false) {
    if (
      msg.type === "measurement"
      || msg.type === "key-image"
      || msg.type === "viewport-capture-result"
      || msg.type === "measurement-deleted"
    ) {
      return "ignored";
    }
  }

  if (ctx.studyInstanceUID && "studyInstanceUID" in msg && msg.studyInstanceUID
    && msg.type !== "measurement-deleted"
    && msg.studyInstanceUID !== ctx.studyInstanceUID) {
    return "ignored";
  }

  if (msg.type === "active-anchor") {
    ctx.onActiveAnchor?.(ohifActiveAnchorToViewport(msg));
    return "ok";
  }

  if (msg.type === "measurement-deleted") {
    const id = String(msg.annotationId || "").trim();
    if (!id) return "error";
    ctx.onMeasurementDeleted?.(id);
    return "ok";
  }

  if (msg.type === "viewport-capture-result") {
    if (msg.version !== 1) return "error";
    const rid = String(msg.requestId || "").trim();
    if (!rid) return "error";
    if (ctx.pendingCaptureRequestIds && !ctx.pendingCaptureRequestIds.has(rid)) {
      return "ignored"; // stale / unknown
    }
    if (msg.error) {
      ctx.pendingCaptureRequestIds?.delete(rid);
      return "error";
    }
    if (!msg.imageData || typeof msg.imageData !== "string") return "error";
    if (msg.imageData.length > MAX_CAPTURE_DATA_URL_CHARS) return "error";
    const mime = (msg.mimeType || "image/jpeg").toLowerCase();
    if (!mime.startsWith("image/jpeg") && !mime.startsWith("image/png") && !mime.startsWith("image/webp")) {
      return "error";
    }
    try {
      await ctx.onViewportCaptureResult?.(msg);
      ctx.pendingCaptureRequestIds?.delete(rid);
      return "ok";
    } catch {
      return "error";
    }
  }

  if (msg.type === "measurement") {
    // Never trust iframe-supplied patient/study ids — bind to CARE session context.
    const patientId = ctx.patientId;
    if (!patientId) return "error";
    const label = msg.label ?? "";
    const level = discLevelFromLabel(label);
    const value = parseCanalApNumber(String(msg.value)) || String(msg.value);
    const intent = msg.intent;
    // Explicit Canal AP intent only — never infer canal from a bare disc-level label.
    const isCanal = intent === "CANAL_AP";
    const coords = JSON.stringify({
      annotationId: msg.annotationId ?? null,
      intent: intent ?? null,
      label: label || null,
    });
    try {
      await api.post("/api/radiology-lesions/viewer-measurements", {
        patientId,
        studyId: ctx.studyId ?? undefined,
        studyInstanceUID: msg.studyInstanceUID,
        seriesInstanceUID: msg.seriesInstanceUID,
        sopInstanceUID: msg.sopInstanceUID,
        frameNumber: msg.frameNumber,
        viewerName: "OHIF",
        measurementType: level || msg.measurementType || label || "linear",
        measurementId: isCanal ? "CANAL_AP" : undefined,
        value,
        unit: msg.unit || "mm",
        imageCoordinates: coords,
        status: "pending",
      });
      ctx.onMeasurementSaved?.();
      return "ok";
    } catch {
      return "error";
    }
  }

  const draftId = msg.draftId ?? ctx.draftId;
  if (!draftId) return "error";
  try {
    const refs = ctx.getImageRefs?.() ?? [];
    await api.post(
      "/api/radiology/report-generator/image-references",
      buildImageRefPayload({
        draftId,
        studyId: ctx.studyId ?? null,
        studyInstanceUID: msg.studyInstanceUID,
        seriesInstanceUID: msg.seriesInstanceUID,
        sopInstanceUID: msg.sopInstanceUID,
        frameNumber: msg.frameNumber ?? null,
        caption: msg.caption || "Key image (OHIF)",
        displayOrder: nextDisplayOrder(refs),
        isKeyImage: true,
      }),
    );
    ctx.onKeyImageSaved?.();
    return "ok";
  } catch {
    return "error";
  }
}

export function subscribeCareOhifBridge(
  ctx: OhifBridgeContext,
): () => void {
  const handler = (ev: MessageEvent) => {
    if (!isAllowedOhifOrigin(ev.origin, ctx.allowedOrigins)) return;
    if (!isCareOhifMessage(ev.data)) return;
    // Prefer event.source Window for capture replies; we do not touch iframe DOM.
    void handleCareOhifMessage(ev.data, ctx);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/** Outbound: ask OHIF extension to capture annotated viewport. */
export function requestOhifViewportCapture(opts: {
  target: Window | null | undefined;
  requestId: string;
  targetOrigin?: string;
}): boolean {
  if (!opts.target || !opts.requestId) return false;
  opts.target.postMessage(
    {
      source: CARE_REPORTING_SOURCE,
      type: "viewport-capture-request",
      version: 1,
      requestId: opts.requestId,
    },
    opts.targetOrigin || "*",
  );
  return true;
}

/** Outbound: navigate OHIF to provenance anchor (best-effort). */
export function requestOhifNavigateToAnchor(opts: {
  target: Window | null | undefined;
  studyInstanceUID: string;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  frameNumber?: number | null;
  targetOrigin?: string;
}): boolean {
  if (!opts.target || !opts.studyInstanceUID) return false;
  opts.target.postMessage(
    {
      source: CARE_REPORTING_SOURCE,
      type: "navigate-to-anchor",
      version: 1,
      studyInstanceUID: opts.studyInstanceUID,
      seriesInstanceUID: opts.seriesInstanceUID ?? undefined,
      sopInstanceUID: opts.sopInstanceUID ?? undefined,
      frameNumber: opts.frameNumber ?? undefined,
    },
    opts.targetOrigin || "*",
  );
  return true;
}

/** Decode capture imageData to a Blob for Phase 1 upload. */
export function captureResultToBlob(msg: CareOhifViewportCaptureResult): Blob | null {
  try {
    let dataUrl = msg.imageData;
    if (!dataUrl.startsWith("data:")) {
      const mime = msg.mimeType || "image/jpeg";
      dataUrl = `data:${mime};base64,${dataUrl}`;
    }
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mimeMatch = /data:([^;]+)/.exec(header);
    const mime = mimeMatch?.[1] || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}
