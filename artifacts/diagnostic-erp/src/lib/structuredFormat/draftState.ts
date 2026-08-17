/**
 * Client-side reader for radiology_report_drafts.structured_json.
 * Mirrors artifacts/api-server/src/lib/structuredJsonColumn.ts extractors.
 */

import {
  CARE_STRUCTURED_FORMAT_STATE_KIND,
  type StructuredFormatDraftState,
  type StructuredValues,
} from "./types";

const ENVELOPE_KIND = "care.structured_json_envelope";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function extractCareStructuredFormatState(column: unknown): StructuredFormatDraftState | null {
  if (!isRecord(column)) return null;
  if (column.kind === CARE_STRUCTURED_FORMAT_STATE_KIND && typeof column.formatId === "number") {
    return column as StructuredFormatDraftState;
  }
  const inner = column.careStructuredFormat;
  if (isRecord(inner) && inner.kind === CARE_STRUCTURED_FORMAT_STATE_KIND && typeof inner.formatId === "number") {
    return inner as StructuredFormatDraftState;
  }
  if (column.kind === ENVELOPE_KIND && isRecord(inner)) {
    return extractCareStructuredFormatState(inner);
  }
  return null;
}

export function toDraftFormatState(opts: {
  formatId: number;
  formatVersion: number;
  values: StructuredValues;
}): StructuredFormatDraftState {
  return {
    kind: CARE_STRUCTURED_FORMAT_STATE_KIND,
    formatId: opts.formatId,
    formatVersion: opts.formatVersion,
    values: opts.values,
    updatedAt: new Date().toISOString(),
  };
}
