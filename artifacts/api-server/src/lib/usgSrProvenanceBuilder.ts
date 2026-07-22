/**
 * usgSrProvenanceBuilder — bridge SR measurements → provenance + viewer_measurements
 * rows (P3.5 integration helpers). Pure; the caller performs the DB insert (behind
 * ff_radiology_usg_exact_provenance). Never fabricates a frame number: when the SR
 * carries no referenced frame, frameNumber is null, not 1.
 */

import type { SrFlatMeasurement } from "./usgSrContentTree";
import {
  USG_PROVENANCE_PARSER_VERSION, toImageCoordinates,
  type MeasurementProvenance,
} from "./usgProvenance";

export interface SrProvenanceContext {
  studyInstanceUID: string;
  seriesInstanceUID?: string | null;   // image series (if known); SR series differs
  srDocumentSop?: string | null;
  extractedAt?: string | null;
}

export function srMeasurementToProvenance(m: SrFlatMeasurement, ctx: SrProvenanceContext): MeasurementProvenance {
  return {
    sourceType: "dicom_sr",
    studyInstanceUID: ctx.studyInstanceUID,
    seriesInstanceUID: ctx.seriesInstanceUID ?? undefined,
    imageRef: m.imageRef,
    srDocumentSop: ctx.srDocumentSop ?? undefined,
    scoord: m.scoord ?? null,
    conceptCode: m.concept,
    unit: m.unitText || m.unit?.value || undefined,
    confidence: 0.98,
    parserVersion: USG_PROVENANCE_PARSER_VERSION,
    extractedAt: ctx.extractedAt ?? null,
  };
}

/** DICOM caliper graphic type → viewer measurement_type. */
export function measurementTypeFromGraphic(graphicType?: string): "linear" | "area" | "point" {
  const g = (graphicType ?? "").toUpperCase();
  if (g === "CIRCLE" || g === "ELLIPSE") return "area";
  if (g === "POINT" || g === "MULTIPOINT") return "point";
  return "linear"; // POLYLINE / default
}

/** A row shaped for the canonical viewer_measurements table. `frameNumber` is
 *  null (NOT 1) when the SR did not reference a frame — honest degradation. */
export interface ViewerMeasurementRow {
  patientId: number;
  studyId: number | null;
  studyInstanceUID: string;
  seriesInstanceUID: string | null;
  sopInstanceUID: string | null;
  frameNumber: number | null;
  viewerName: "DICOM SR";
  measurementType: "linear" | "area" | "point";
  measurementId: string | null;  // canonical Universal Measurement Registry id (null until mapped)
  value: string;
  unit: string;
  imageCoordinates: string | null;
  confidence: number;
  status: "pending";
}

export function srMeasurementToViewerRow(
  m: SrFlatMeasurement,
  ctx: SrProvenanceContext & { patientId: number; studyId?: number | null; canonicalId?: string | null },
): ViewerMeasurementRow {
  const prov = srMeasurementToProvenance(m, ctx);
  return {
    patientId: ctx.patientId,
    studyId: ctx.studyId ?? null,
    studyInstanceUID: ctx.studyInstanceUID,
    seriesInstanceUID: ctx.seriesInstanceUID ?? null,
    sopInstanceUID: m.imageRef?.sopInstanceUID ?? null,
    frameNumber: m.imageRef?.frameNumber ?? null,   // never fabricated
    viewerName: "DICOM SR",
    measurementType: measurementTypeFromGraphic(m.scoord?.graphicType),
    measurementId: ctx.canonicalId ?? null,
    value: String(m.value),
    unit: m.unitText || m.unit?.value || "",
    imageCoordinates: toImageCoordinates(prov),
    confidence: prov.confidence,
    status: "pending",
  };
}
