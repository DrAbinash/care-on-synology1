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
export const CARE_REPORT_FORMAT_IDENTITY_KIND = "care.report_format_identity.v1";

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
  /**
   * MRI Brain vascular acquisition state (mra/mrv reporting): what the technique
   * actually performed, as derived from the Technique field and manually overridden
   * by the radiologist. Gates strong vascular wording, so it must round-trip.
   */
  careVascularTechnique?: unknown;
  /** Applied whole-report format identity (care.report_format_identity.v1). */
  careReportFormatIdentity?: unknown;
  /** Second worklist row combined into this draft. */
  linkedStudyId?: number | string | null;
  careLinkedStudy?: CareLinkedStudy | null;
  /** Abnormal-pattern apply markers (suggestion confirm). Version is frozen at apply time. */
  careAppliedPatterns?: CareAppliedPattern[] | null;
};

export type CareAppliedPattern = {
  patternId: string;
  version: number;
  bundleId: string;
  appliedAt: string;
};

export type CareLinkedStudy = {
  studyId: number | string;
  title: string;
  modality?: string | null;
  studyDescription?: string | null;
  region?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
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

export function extractCareVascularTechnique(column: unknown): unknown {
  if (!isRecord(column)) return null;
  if (isStructuredJsonEnvelope(column)) return column.careVascularTechnique ?? null;
  if (column.careVascularTechnique) return column.careVascularTechnique;
  return null;
}

export function isCareReportFormatIdentity(v: unknown): v is CareReportFormatIdentity {
  return isRecord(v) && v.kind === CARE_REPORT_FORMAT_IDENTITY_KIND && typeof v.name === "string" && v.name.trim() !== "";
}

/** Applied whole-report format identity (baseline banner / re-bootstrap guard). */
export type CareReportFormatIdentity = {
  kind: typeof CARE_REPORT_FORMAT_IDENTITY_KIND;
  name: string;
  reportTitle?: string;
  appliedAt: string;
  formatId?: string;
  formatRevision?: string;
  baselineManifestVersion?: number;
  baselineManifestRevision?: string;
};

export function extractCareLinkedStudy(column: unknown): CareLinkedStudy | null {
  if (!isRecord(column)) return null;
  const raw = isRecord(column.careLinkedStudy) ? column.careLinkedStudy : null;
  const id = column.linkedStudyId ?? raw?.studyId;
  if (id == null || (typeof id !== "number" && typeof id !== "string") || id === "") return null;
  const studyId = typeof raw?.studyId === "number" || typeof raw?.studyId === "string" ? raw.studyId : id;
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  return {
    studyId,
    title,
    modality: typeof raw?.modality === "string" ? raw.modality : null,
    studyDescription: typeof raw?.studyDescription === "string" ? raw.studyDescription : null,
    region: typeof raw?.region === "string" ? raw.region : null,
    accessionNumber: typeof raw?.accessionNumber === "string" ? raw.accessionNumber : null,
    studyInstanceUID: typeof raw?.studyInstanceUID === "string" ? raw.studyInstanceUID : null,
  };
}

export function extractCareAppliedPatterns(column: unknown): CareAppliedPattern[] {
  if (!isRecord(column) || !Array.isArray(column.careAppliedPatterns)) return [];
  const out: CareAppliedPattern[] = [];
  for (const item of column.careAppliedPatterns) {
    if (!isRecord(item)) continue;
    const patternId = typeof item.patternId === "string" ? item.patternId.trim() : "";
    const bundleId = typeof item.bundleId === "string" ? item.bundleId.trim() : "";
    const appliedAt = typeof item.appliedAt === "string" ? item.appliedAt.trim() : "";
    const version = typeof item.version === "number" ? item.version : Number.NaN;
    if (!patternId || !bundleId || !appliedAt || !Number.isInteger(version) || version < 1) continue;
    out.push({ patternId, version, bundleId, appliedAt });
  }
  return out;
}

export function extractCareReportFormatIdentity(column: unknown): CareReportFormatIdentity | null {
  if (!isRecord(column)) return null;
  if (isCareReportFormatIdentity(column)) return column;
  if (isCareReportFormatIdentity(column.careReportFormatIdentity)) {
    return column.careReportFormatIdentity as CareReportFormatIdentity;
  }
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
  vascularTechnique?: unknown;
  reportFormatIdentity?: unknown;
  /** undefined keeps the existing linked study; null clears it. */
  linkedStudy?: CareLinkedStudy | null;
  /** undefined keeps existing markers; [] clears them. */
  appliedPatterns?: CareAppliedPattern[] | null;
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
  const vascularTech = opts.vascularTechnique !== undefined
    ? opts.vascularTechnique
    : extractCareVascularTechnique(opts.existing);
  const reportFormatIdentity = opts.reportFormatIdentity !== undefined
    ? opts.reportFormatIdentity
    : extractCareReportFormatIdentity(opts.existing);
  const linkedStudy = opts.linkedStudy !== undefined
    ? opts.linkedStudy
    : extractCareLinkedStudy(opts.existing);
  const appliedPatterns = opts.appliedPatterns !== undefined
    ? (opts.appliedPatterns ?? [])
    : extractCareAppliedPatterns(opts.existing);
  const hasApplied = appliedPatterns.length > 0;
  if (!format && !ledger && !viewerMs && !canalProv && !vascularTech && !reportFormatIdentity && !linkedStudy && !hasApplied) return a4 ?? null;
  const env: StructuredJsonEnvelope = {
    kind: STRUCTURED_JSON_ENVELOPE_KIND,
    a4Cache: a4 ?? null,
    careStructuredFormat: format,
  };
  if (ledger) env.careObservationLedger = ledger;
  if (viewerMs) env.careViewerMeasurements = viewerMs;
  if (canalProv) env.careCanalApProvenance = canalProv;
  if (vascularTech) env.careVascularTechnique = vascularTech;
  if (reportFormatIdentity) env.careReportFormatIdentity = reportFormatIdentity;
  if (linkedStudy && linkedStudy.studyId !== "" && linkedStudy.studyId != null) {
    env.linkedStudyId = linkedStudy.studyId;
    env.careLinkedStudy = linkedStudy;
  }
  if (hasApplied) env.careAppliedPatterns = appliedPatterns;
  return env;
}
