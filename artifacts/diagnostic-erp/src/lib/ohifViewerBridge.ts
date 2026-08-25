/**
 * ohifViewerBridge.ts — listen for postMessage from OHIF (or Frames helper)
 * and forward measurements / key-image picks into ERP APIs.
 *
 * Contract (OHIF extension or bookmarklet must emit):
 *   { source: "care-ohif", type: "measurement",
 *     studyInstanceUID, seriesInstanceUID?, sopInstanceUID?, frameNumber?,
 *     label?, value, unit?, measurementType?, patientId? }
 *   { source: "care-ohif", type: "key-image",
 *     studyInstanceUID, seriesInstanceUID, sopInstanceUID, frameNumber?,
 *     caption?, draftId? }
 */

import { api } from "@/lib/fetchApi";
import { buildImageRefPayload, nextDisplayOrder, type ReportImageRef } from "@/lib/reportImageRefs";
import { discLevelFromLabel, parseCanalApNumber } from "@/lib/spineCanalAp";

export const CARE_OHIF_SOURCE = "care-ohif";

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

export type CareOhifMessage = CareOhifMeasurementMessage | CareOhifKeyImageMessage;

export function isCareOhifMessage(data: unknown): data is CareOhifMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.source === CARE_OHIF_SOURCE && (d.type === "measurement" || d.type === "key-image");
}

export type OhifBridgeContext = {
  studyInstanceUID: string | null | undefined;
  patientId: number | null | undefined;
  studyId: number | null | undefined;
  draftId: number | null | undefined;
  /** Existing image refs for displayOrder (optional). */
  getImageRefs?: () => ReportImageRef[];
  onMeasurementSaved?: () => void;
  onKeyImageSaved?: () => void;
};

export async function handleCareOhifMessage(
  msg: CareOhifMessage,
  ctx: OhifBridgeContext,
): Promise<"ok" | "ignored" | "error"> {
  if (ctx.studyInstanceUID && msg.studyInstanceUID !== ctx.studyInstanceUID) {
    return "ignored";
  }

  if (msg.type === "measurement") {
    const patientId = msg.patientId ?? ctx.patientId;
    if (!patientId) return "error";
    const label = msg.label ?? "";
    const level = discLevelFromLabel(label);
    const value = parseCanalApNumber(String(msg.value)) || String(msg.value);
    try {
      await api.post("/api/radiology-lesions/viewer-measurements", {
        patientId,
        studyId: msg.studyId ?? ctx.studyId ?? undefined,
        studyInstanceUID: msg.studyInstanceUID,
        seriesInstanceUID: msg.seriesInstanceUID,
        sopInstanceUID: msg.sopInstanceUID,
        frameNumber: msg.frameNumber,
        viewerName: "OHIF",
        measurementType: level || msg.measurementType || label || "linear",
        measurementId: level ? "CANAL_AP" : undefined,
        value,
        unit: msg.unit || "mm",
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
        studyId: msg.studyId ?? ctx.studyId ?? null,
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

/** Attach a window message listener; returns unsubscribe. */
export function subscribeCareOhifBridge(ctx: OhifBridgeContext): () => void {
  const handler = (ev: MessageEvent) => {
    if (!isCareOhifMessage(ev.data)) return;
    void handleCareOhifMessage(ev.data, ctx);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
