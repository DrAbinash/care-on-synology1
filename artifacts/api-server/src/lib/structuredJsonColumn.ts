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
  /**
   * Spine reporting capture state: vertebral numbering, the sequences the study
   * actually has, the screening selections, and `impressionOrderFrozen`.
   *
   * The key is spelled `spineReporting`, not `careSpineReporting`, because the
   * reader that asks for it is already shipped on the client
   * (`mriSpineDraftState.extractSpineReportingState` reads exactly this key), and
   * inventing a second spelling would leave that reader blind to the value this
   * route stores.
   *
   * `impressionOrderFrozen` is why this is not cosmetic: spec §37 makes it the
   * radiologist's own arrangement of the Impression, and the priority sorter must
   * stop touching the report once it is set. Lost across a save, a reopen lets the
   * engine re-shuffle lines the author ordered by hand.
   */
  spineReporting?: unknown;
  /** Applied whole-report format identity (care.report_format_identity.v1). */
  careReportFormatIdentity?: unknown;
  /**
   * ADR-004 — the region transitions this report has been through, oldest first. Each entry
   * names the sentences that left the report and who decided it. It is provenance, not prose:
   * nothing renders it, but a reload that cannot see it reports the retired normals as a lost
   * draft instead of a decision somebody made.
   */
  careRegionTransitions?: CareRegionTransition[];
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

/**
 * The spine reporting capture state, read back from the stored column. A save that
 * carries none keeps this value rather than clearing it: the client sends the key on
 * every save, and an autosave that happens to carry none must not wipe the state the
 * radiologist set.
 */
export function extractSpineReporting(column: unknown): unknown {
  if (!isRecord(column)) return null;
  const raw = column.spineReporting;
  return isRecord(raw) ? raw : null;
}

export const CARE_REGION_TRANSITION_KIND = "care.region_transition.v1";

/**
 * One confirmed narrowing of the reporting region (docs/ADR/ADR-004).
 *
 * `retired` and `keptAbnormalities` are kept as the client sent them (each row is
 * `{ id, concept, segment, text }`): the server neither re-derives nor edits them, because
 * the sentences they quote are the point of the record. Structural validation is deliberately
 * shallow — the fields that decide whether the row is a transition at all are checked, the
 * prose is stored as authored.
 */
export type CareRegionTransition = {
  kind: typeof CARE_REGION_TRANSITION_KIND;
  fromRegion: string | null;
  toRegion: string;
  retired: unknown[];
  keptAbnormalities: unknown[];
  manualLinesPreserved: number;
  decidedBy: string;
  at: string;
};

function isCareRegionTransitionRow(item: unknown): item is CareRegionTransition {
  if (!isRecord(item)) return false;
  if (item.kind !== CARE_REGION_TRANSITION_KIND) return false;
  if (typeof item.toRegion !== "string" || item.toRegion.trim() === "") return false;
  return Array.isArray(item.retired);
}

/**
 * Read the transition history back. Rows that do not carry the contract are dropped rather
 * than coerced: a half-parsed record on screen would state who removed a sentence that was
 * never provably removed.
 */
export function extractCareRegionTransitions(column: unknown): CareRegionTransition[] {
  if (!isRecord(column)) return [];
  const raw = Array.isArray(column.careRegionTransitions)
    ? column.careRegionTransitions
    : Array.isArray(column.regionTransitions)
      ? column.regionTransitions
      : null;
  if (!raw) return [];
  return raw.filter(isCareRegionTransitionRow).map((row) => ({
    kind: CARE_REGION_TRANSITION_KIND,
    fromRegion: typeof row.fromRegion === "string" ? row.fromRegion : null,
    toRegion: row.toRegion,
    retired: Array.isArray(row.retired) ? row.retired : [],
    keptAbnormalities: Array.isArray(row.keptAbnormalities) ? row.keptAbnormalities : [],
    manualLinesPreserved: typeof row.manualLinesPreserved === "number" ? row.manualLinesPreserved : 0,
    decidedBy: typeof row.decidedBy === "string" ? row.decidedBy : "",
    at: typeof row.at === "string" ? row.at : "",
  }));
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
  spineReporting?: unknown;
  regionTransitions?: CareRegionTransition[] | null;
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
  const spine = opts.spineReporting !== undefined
    ? opts.spineReporting
    : extractSpineReporting(opts.existing);
  // `undefined` keeps the stored history. A save that carries no transition never rewrites
  // it, and a save that carries an empty array is not a client that sent nothing — the
  // client omits the key entirely when the history is empty (regionTransitionPayload), so
  // the only writer that can clear it is one that explicitly says so.
  const regionTransitions = opts.regionTransitions !== undefined
    ? (opts.regionTransitions ?? [])
    : extractCareRegionTransitions(opts.existing);
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
  const hasTransitions = regionTransitions.length > 0;
  if (!format && !ledger && !viewerMs && !canalProv && !vascularTech && !spine && !reportFormatIdentity && !linkedStudy && !hasApplied && !hasTransitions) return a4 ?? null;
  const env: StructuredJsonEnvelope = {
    kind: STRUCTURED_JSON_ENVELOPE_KIND,
    a4Cache: a4 ?? null,
    careStructuredFormat: format,
  };
  if (ledger) env.careObservationLedger = ledger;
  if (viewerMs) env.careViewerMeasurements = viewerMs;
  if (canalProv) env.careCanalApProvenance = canalProv;
  if (vascularTech) env.careVascularTechnique = vascularTech;
  if (spine) env.spineReporting = spine;
  if (reportFormatIdentity) env.careReportFormatIdentity = reportFormatIdentity;
  if (linkedStudy && linkedStudy.studyId !== "" && linkedStudy.studyId != null) {
    env.linkedStudyId = linkedStudy.studyId;
    env.careLinkedStudy = linkedStudy;
  }
  if (hasApplied) env.careAppliedPatterns = appliedPatterns;
  if (hasTransitions) env.careRegionTransitions = regionTransitions;
  return env;
}

/** Every key composeStructuredJsonColumn accepts except the row it merges into. */
export type StructuredJsonPatch = Omit<
  Parameters<typeof composeStructuredJsonColumn>[0],
  "existing"
>;

/** The save-draft request fields that land in the structured_json envelope. */
export type StructuredJsonPatchInput = {
  structuredFormatState?: {
    formatId: number;
    formatVersion?: number;
    values: Record<string, unknown>;
    updatedAt?: string;
  } | null;
  observationLedger?: unknown;
  viewerMeasurements?: unknown;
  canalApProvenance?: unknown;
  vascularTechnique?: unknown;
  spineReporting?: unknown;
  regionTransitions?: unknown;
  appliedPatterns?: CareAppliedPattern[] | null;
  linkedStudy?: CareLinkedStudy | null;
  reportFormatIdentity?: Record<string, unknown> | null;
};

/**
 * Which envelope keys one save-draft request intends to write, as a single
 * patch for one composeStructuredJsonColumn call. Returns {} when the request
 * carries none of them, so the caller can skip the write entirely.
 *
 * The `undefined`-vs-`null` distinctions below are the wire contract and are
 * not interchangeable:
 *
 *   - `observationLedger` uses `!= null`, so a client that omits it or sends
 *     null leaves the stored ledger alone.
 *   - `appliedPatterns` and `linkedStudy` use `!== undefined`, so an explicit
 *     null is a real instruction to CLEAR (deselect-everything, unlink the
 *     second study). Treating null as "no signal" would leave stale markers
 *     behind after a legitimate clear.
 *   - the three measurement fields are copied individually with `?? undefined`
 *     so an autosave carrying only one of them preserves the other two.
 *
 * `now` is injectable only so the timestamp defaults are assertable.
 */
export function buildCareStructuredJsonPatch(
  input: StructuredJsonPatchInput,
  now: () => string = () => new Date().toISOString(),
): StructuredJsonPatch {
  const patch: StructuredJsonPatch = {};

  if (input.structuredFormatState != null) {
    patch.formatState = {
      kind: CARE_STRUCTURED_FORMAT_STATE_KIND,
      formatId: input.structuredFormatState.formatId,
      formatVersion: input.structuredFormatState.formatVersion ?? 1,
      values: input.structuredFormatState.values,
      updatedAt: input.structuredFormatState.updatedAt ?? now(),
    };
  }

  if (input.observationLedger != null) {
    patch.observationLedger = input.observationLedger;
  }

  if (
    input.viewerMeasurements != null
    || input.canalApProvenance != null
    || input.vascularTechnique != null
    || input.spineReporting != null
  ) {
    // Absent members are written as `undefined`, which composeStructuredJsonColumn
    // reads as "keep what is stored", so a save carrying only one of these four
    // preserves the other three.
    patch.viewerMeasurements = input.viewerMeasurements ?? undefined;
    patch.canalApProvenance = input.canalApProvenance ?? undefined;
    patch.vascularTechnique = input.vascularTechnique ?? undefined;
    patch.spineReporting = input.spineReporting ?? undefined;
  }

  // ADR-004. Only an array of transition records is a write signal: an absent or null field
  // keeps the stored history, because a report that has been through a transition cannot be
  // un-transitioned by an unrelated autosave.
  if (Array.isArray(input.regionTransitions)) {
    patch.regionTransitions = extractCareRegionTransitions({ careRegionTransitions: input.regionTransitions });
  }

  if (input.appliedPatterns !== undefined) {
    patch.appliedPatterns = input.appliedPatterns ?? [];
  }

  if (input.linkedStudy !== undefined) {
    patch.linkedStudy = input.linkedStudy ?? null;
  }

  if (input.reportFormatIdentity != null) {
    patch.reportFormatIdentity = {
      ...input.reportFormatIdentity,
      appliedAt: input.reportFormatIdentity.appliedAt ?? now(),
    };
  }

  return patch;
}
