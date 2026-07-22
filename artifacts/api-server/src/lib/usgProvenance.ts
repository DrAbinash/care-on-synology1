/**
 * usgProvenance — measurement provenance model with HONEST degradation (P3.5).
 *
 * Encodes exactly how much we know about where a measurement came from, so the
 * UI can offer only the viewer actions that are actually possible and label the
 * source truthfully. Frame numbers are never fabricated. Pure + testable.
 */

import type { SrCode, SrImageRef, SrScoord } from "./usgSrContentTree";

export const USG_PROVENANCE_PARSER_VERSION = "p3.1";

export type ProvenanceSourceType =
  | "dicom_sr"
  | "ge_private_tag"
  | "encapsulated_pdf"
  | "ocr"
  | "manual";

export type ProvenanceLevel =
  | "exact_frame_caliper"   // exact image + frame + caliper overlay
  | "source_image"          // exact image (frame if known), no caliper
  | "ocr_image"             // an image the OCR ran on
  | "sr_document"           // only the SR document reference
  | "series_only"           // only the series is known
  | "manual"                // manually entered
  | "unavailable";          // no source reference at all

export interface MeasurementProvenance {
  sourceType: ProvenanceSourceType;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  imageRef?: SrImageRef;      // referenced image SOP + frame (SR SCOORD/IMAGE or OCR frame)
  srDocumentSop?: string;     // the SR document's own SOP UID, when that's all we have
  scoord?: SrScoord | null;   // caliper endpoints, when present
  conceptCode?: SrCode;
  unit?: string;
  confidence: number;         // 0..1
  parserVersion: string;
  extractedAt?: string | null;
}

/** Truthful provenance level from what the record actually carries. */
export function provenanceLevel(p: MeasurementProvenance): ProvenanceLevel {
  if (p.sourceType === "manual") return "manual";
  const hasImage = !!p.imageRef?.sopInstanceUID;
  const hasFrame = p.imageRef?.frameNumber != null;
  const hasCaliper = !!(p.scoord && p.scoord.graphicData && p.scoord.graphicData.length > 0);

  if (hasImage && hasFrame && hasCaliper) return "exact_frame_caliper";
  if (hasImage && p.sourceType === "ocr") return "ocr_image";
  if (hasImage) return "source_image";
  if (p.srDocumentSop) return "sr_document";
  if (p.seriesInstanceUID) return "series_only";
  return "unavailable";
}

/** Human, honest label per level. */
export function provenanceLabel(level: ProvenanceLevel): string {
  switch (level) {
    case "exact_frame_caliper": return "Exact frame and caliper available";
    case "source_image": return "Source image available";
    case "ocr_image": return "OCR image reference";
    case "sr_document": return "SR document reference only";
    case "series_only": return "Series-level source only";
    case "manual": return "Manually entered";
    case "unavailable": return "Source unavailable";
  }
}

export interface ViewerActions {
  goToStudy: boolean;
  goToSeries: boolean;
  goToInstance: boolean;
  goToFrame: boolean;
  showOverlay: boolean;
}

/** Which viewer navigations are genuinely possible for this provenance. */
export function viewerActions(p: MeasurementProvenance): ViewerActions {
  return {
    goToStudy: !!p.studyInstanceUID,
    goToSeries: !!p.seriesInstanceUID,
    goToInstance: !!p.imageRef?.sopInstanceUID,
    goToFrame: p.imageRef?.frameNumber != null,
    showOverlay: !!(p.scoord && p.scoord.graphicData?.length),
  };
}

/** Shape for populating viewer_measurements.imageCoordinates (JSON string). */
export function toImageCoordinates(p: MeasurementProvenance): string | null {
  if (!p.scoord || !p.scoord.graphicData?.length) return null;
  return JSON.stringify({ graphicType: p.scoord.graphicType, graphicData: p.scoord.graphicData });
}
