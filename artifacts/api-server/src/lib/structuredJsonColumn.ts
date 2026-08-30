/**
 * radiology_report_drafts.structured_json is shared by:
 *   - Ticket A4: denormalized FindingInstance cache (array | null)
 *   - P1 structured format: radiologist field values (care.structured_format_state)
 *
 * When both are present the column is an envelope. A4/A5 must read the cache
 * through extractA4Cache so drift checks still see the array. Never write
 * format state into structured_json_d1 (D1 catalog — out of scope).
 */

export const STRUCTURED_JSON_ENVELOPE_KIND = "care.structured_json_envelope";
export const CARE_STRUCTURED_FORMAT_STATE_KIND = "care.structured_format_state";

/** Cap draft-scoped care.viewer_measurements.v1 items (matches ERP autosave bound). */
export const MAX_CARE_VIEWER_MEASUREMENT_ITEMS = 400;

export type CareStructuredFormatState = {
  kind: typeof CARE_STRUCTURED_FORMAT_STATE_KIND;
  formatId: number;
  formatVersion: number;
  values: Record<string, unknown>;
  updatedAt: string;
};

export type StructuredJsonEnvelope = {
  kind: typeof STRUCTURED_JSON_ENVELOPE_KIND;
  a4Cache: unknown[] | null;
  careStructuredFormat: CareStructuredFormatState | null;
  careObservationLedger?: unknown;
  /** Draft-scoped structured viewer measurements (care.viewer_measurements.v1). */
  careViewerMeasurements?: unknown;
  /** Canal AP cell provenance map (manualOverride + DICOM UIDs). */
  careCanalApProvenance?: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keep the newest N items when a draft payload is oversized. */
export function boundCareViewerMeasurements(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const items = raw.items;
  if (!Array.isArray(items) || items.length <= MAX_CARE_VIEWER_MEASUREMENT_ITEMS) return raw;
  return { ...raw, items: items.slice(-MAX_CARE_VIEWER_MEASUREMENT_ITEMS) };
}

export function isStructuredJsonEnvelope(v: unknown): v is StructuredJsonEnvelope {
  return isRecord(v) && v.kind === STRUCTURED_JSON_ENVELOPE_KIND;
}

export function isCareStructuredFormatState(v: unknown): v is CareStructuredFormatState {
  return isRecord(v) && v.kind === CARE_STRUCTURED_FORMAT_STATE_KIND && typeof v.formatId === "number";
}

/** A4/A5: the FindingInstance cache array, regardless of envelope wrapping. */
export function extractA4Cache(column: unknown): unknown[] | null {
  if (column == null) return null;
  if (Array.isArray(column)) return column;
  if (isStructuredJsonEnvelope(column)) {
    return Array.isArray(column.a4Cache) ? column.a4Cache : null;
  }
  return null;
}

export function extractCareStructuredFormat(column: unknown): CareStructuredFormatState | null {
  if (!isRecord(column)) return null;
  if (isCareStructuredFormatState(column)) return column;
  if (isCareStructuredFormatState(column.careStructuredFormat)) return column.careStructuredFormat;
  return null;
}

export function extractCareObservationLedger(column: unknown): unknown {
  if (!isRecord(column)) return null;
  if (isStructuredJsonEnvelope(column)) return column.careObservationLedger ?? null;
  if (column.careObservationLedger) return column.careObservationLedger;
  return null;
}

export function extractCareViewerMeasurements(column: unknown): unknown {
  if (!isRecord(column)) return null;
  if (isStructuredJsonEnvelope(column)) return column.careViewerMeasurements ?? null;
  if (column.careViewerMeasurements) return column.careViewerMeasurements;
  return null;
}

export function extractCareCanalApProvenance(column: unknown): unknown {
  if (!isRecord(column)) return null;
  if (isStructuredJsonEnvelope(column)) return column.careCanalApProvenance ?? null;
  if (column.careCanalApProvenance) return column.careCanalApProvenance;
  return null;
}

/**
 * Compose the column value. `undefined` means "keep whatever was in existing".
 * When there is no format state, returns the legacy A4 shape (array | null)
 * so existing A4 tests and readers stay unchanged.
 */
export function composeStructuredJsonColumn(opts: {
  existing: unknown;
  a4Cache?: unknown[] | null;
  formatState?: CareStructuredFormatState | null;
  observationLedger?: unknown;
  viewerMeasurements?: unknown;
  canalApProvenance?: unknown;
}): unknown {
  const a4 = opts.a4Cache !== undefined ? opts.a4Cache : extractA4Cache(opts.existing);
  const format = opts.formatState !== undefined ? opts.formatState : extractCareStructuredFormat(opts.existing);
  const ledger = opts.observationLedger !== undefined
    ? opts.observationLedger
    : extractCareObservationLedger(opts.existing);
  const viewerMs = opts.viewerMeasurements !== undefined
    ? boundCareViewerMeasurements(opts.viewerMeasurements)
    : extractCareViewerMeasurements(opts.existing);
  const canalProv = opts.canalApProvenance !== undefined
    ? opts.canalApProvenance
    : extractCareCanalApProvenance(opts.existing);
  if (!format && !ledger && !viewerMs && !canalProv) return a4 ?? null;
  const env: StructuredJsonEnvelope = {
    kind: STRUCTURED_JSON_ENVELOPE_KIND,
    a4Cache: a4 ?? null,
    careStructuredFormat: format,
  };
  if (ledger) env.careObservationLedger = ledger;
  if (viewerMs) env.careViewerMeasurements = viewerMs;
  if (canalProv) env.careCanalApProvenance = canalProv;
  return env;
}
