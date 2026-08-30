/**
 * Structured viewer measurements — draft-scoped model persisted in structured_json
 * (care.viewer_measurements.v1). Idempotent on viewerAnnotationId.
 *
 * Ingest modes:
 *   - historical: bulk hydration/refetch — never uses live Measure toolbar state
 *   - new_event: immediate post-measurement path — may stamp live intent/level/obs
 */

import type { ObservationAnchor } from "@/lib/observationAnchor";
import { discLevelFromLabel } from "@/lib/spineCanalAp";

export const CARE_VIEWER_MEASUREMENTS_KIND = "care.viewer_measurements.v1";

export type MeasurementIntent =
  | "CANAL_AP"
  | "LESION"
  | "MIDLINE_SHIFT"
  | "OTHER";

export type ViewerRowIngestMode = "historical" | "new_event";

/**
 * Classify a viewer_measurements row for structured ingest.
 *
 * hydrationComplete must flip true only after the study's FIRST successful
 * query resolution (including empty [] or ignored-only). Do not infer from
 * knownRowIds.size — an empty first fetch leaves the set empty and would
 * otherwise mis-label the first real measurement as historical.
 */
export function classifyViewerRowIngestMode(opts: {
  hydrationComplete: boolean;
  rowId: number;
  knownRowIds: ReadonlySet<number>;
  hasPriorStructured: boolean;
}): ViewerRowIngestMode {
  if (!opts.hydrationComplete) return "historical";
  if (opts.knownRowIds.has(opts.rowId) || opts.hasPriorStructured) return "historical";
  return "new_event";
}

export type StructuredMeasurementValue = {
  /** Primary linear dimension (mm) or first axis. */
  primary?: number | null;
  secondary?: number | null;
  tertiary?: number | null;
  area?: number | null;
  raw?: string | null;
  unit: string;
};

export type StructuredMeasurement = {
  id: string;
  concept: MeasurementIntent | string;
  toolType?: string | null;
  values: StructuredMeasurementValue;
  laterality?: string | null;
  anatomicalRegion?: string | null;
  spinalLevel?: string | null;
  observationId?: string | null;
  anchor?: ObservationAnchor | null;
  viewerAnnotationId?: string | null;
  viewerMeasurementRowId?: number | null;
  label?: string | null;
  createdAt: string;
  updatedAt: string;
  manualOverride: boolean;
};

export type ViewerMeasurementsState = {
  kind: typeof CARE_VIEWER_MEASUREMENTS_KIND;
  version: 1;
  items: StructuredMeasurement[];
};

export type ViewerMeasurementApiRow = {
  id: number;
  measurementType?: string | null;
  measurementId?: string | null;
  value: string;
  unit?: string | null;
  studyInstanceUID?: string | null;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  frameNumber?: number | null;
  viewerName?: string | null;
  imageCoordinates?: string | null;
  createdAt?: string;
};

export function emptyViewerMeasurementsState(): ViewerMeasurementsState {
  return { kind: CARE_VIEWER_MEASUREMENTS_KIND, version: 1, items: [] };
}

export function isViewerMeasurementsState(raw: unknown): raw is ViewerMeasurementsState {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return o.kind === CARE_VIEWER_MEASUREMENTS_KIND && o.version === 1 && Array.isArray(o.items);
}

function newId(): string {
  return `svm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseNumericAxes(raw: string | number | null | undefined): {
  primary?: number;
  secondary?: number;
  tertiary?: number;
  raw: string;
} {
  if (raw == null) return { raw: "" };
  const s = String(raw).trim();
  const nums = [...s.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  const finite = nums.filter((n) => Number.isFinite(n));
  return {
    primary: finite[0],
    secondary: finite[1],
    tertiary: finite[2],
    raw: s,
  };
}

export function formatMeasurementChip(m: StructuredMeasurement): string {
  const u = m.values.unit || "mm";
  const parts = [m.values.primary, m.values.secondary, m.values.tertiary]
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "")));
  if (parts.length >= 2) return `${parts.join(" × ")} ${u}`;
  if (parts.length === 1) {
    if (m.concept === "CANAL_AP" || m.spinalLevel) return `AP ${parts[0]} ${u}`;
    if (m.concept === "MIDLINE_SHIFT") return `Shift ${parts[0]} ${u}`;
    return `${parts[0]} ${u}`;
  }
  if (m.values.area != null && Number.isFinite(m.values.area)) {
    return `${m.values.area} ${u}²`;
  }
  return (m.values.raw || "").trim();
}

/**
 * Upsert by viewerAnnotationId when present; otherwise append.
 * Never duplicates the same annotation.
 */
export function upsertStructuredMeasurement(
  state: ViewerMeasurementsState,
  incoming: Omit<StructuredMeasurement, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  },
): ViewerMeasurementsState {
  const now = new Date().toISOString();
  const items = [...state.items];
  const ann = incoming.viewerAnnotationId?.trim() || null;

  if (ann) {
    const idx = items.findIndex((x) => x.viewerAnnotationId === ann);
    if (idx >= 0) {
      const prev = items[idx];
      if (prev.manualOverride && incoming.manualOverride !== false) {
        items[idx] = {
          ...prev,
          updatedAt: now,
          anchor: incoming.anchor ?? prev.anchor,
        };
        return { ...state, items };
      }
      items[idx] = {
        ...prev,
        ...incoming,
        id: prev.id,
        createdAt: prev.createdAt,
        updatedAt: now,
        manualOverride: incoming.manualOverride ?? prev.manualOverride,
      };
      return { ...state, items };
    }
  }

  if (incoming.viewerMeasurementRowId != null) {
    const idx = items.findIndex((x) => x.viewerMeasurementRowId === incoming.viewerMeasurementRowId);
    if (idx >= 0) {
      const prev = items[idx];
      if (prev.manualOverride && incoming.manualOverride !== false) {
        items[idx] = { ...prev, updatedAt: now, anchor: incoming.anchor ?? prev.anchor };
        return { ...state, items };
      }
      items[idx] = {
        ...prev,
        ...incoming,
        id: prev.id,
        createdAt: prev.createdAt,
        updatedAt: now,
        manualOverride: incoming.manualOverride ?? prev.manualOverride,
      };
      return { ...state, items };
    }
  }

  const row: StructuredMeasurement = {
    id: incoming.id || newId(),
    concept: incoming.concept,
    toolType: incoming.toolType ?? null,
    values: incoming.values,
    laterality: incoming.laterality ?? null,
    anatomicalRegion: incoming.anatomicalRegion ?? null,
    spinalLevel: incoming.spinalLevel ?? null,
    observationId: incoming.observationId ?? null,
    anchor: incoming.anchor ?? null,
    viewerAnnotationId: ann,
    viewerMeasurementRowId: incoming.viewerMeasurementRowId ?? null,
    label: incoming.label ?? null,
    createdAt: incoming.createdAt || now,
    updatedAt: now,
    manualOverride: incoming.manualOverride ?? false,
  };
  items.push(row);
  return { ...state, items };
}

export function removeStructuredMeasurementByAnnotation(
  state: ViewerMeasurementsState,
  annotationId: string,
): ViewerMeasurementsState {
  const id = annotationId.trim();
  if (!id) return state;
  return {
    ...state,
    items: state.items.filter((x) => x.viewerAnnotationId !== id),
  };
}

export function detachStructuredMeasurementsFromObservation(
  state: ViewerMeasurementsState,
  observationId: string,
): { state: ViewerMeasurementsState; detached: number } {
  let detached = 0;
  const items = state.items.map((x) => {
    if (x.observationId !== observationId) return x;
    detached += 1;
    return { ...x, observationId: null };
  });
  return { state: { ...state, items }, detached };
}

/**
 * Decide whether a viewer measurement may auto-populate a canal cell / field.
 * Unknown rulers without explicit CANAL_AP intent → no auto-populate.
 */
export function shouldAutoPopulateCanal(opts: {
  intent: MeasurementIntent | null | undefined;
  spinalLevel: string | null | undefined;
  measurementId?: string | null;
  label?: string | null;
}): boolean {
  if (opts.intent === "CANAL_AP" && opts.spinalLevel) return true;
  if (opts.measurementId === "CANAL_AP" && opts.spinalLevel) return true;
  if (!opts.intent || opts.intent === "CANAL_AP") {
    if (opts.spinalLevel && opts.label && /canal|ap\b/i.test(opts.label)) return true;
  }
  return false;
}

/**
 * Attach to selected observation only for explicit lesion-like intents.
 * Unknown/null intent must NOT attach (historical hydration safety).
 * New-event path stamps observationId explicitly at creation when intended.
 */
export function shouldAttachToSelectedObservation(opts: {
  intent: MeasurementIntent | null | undefined;
  selectedObservationId: string | null | undefined;
}): boolean {
  if (!opts.selectedObservationId) return false;
  if (opts.intent === "LESION" || opts.intent === "MIDLINE_SHIFT" || opts.intent === "OTHER") {
    return true;
  }
  if (opts.intent === "CANAL_AP") return false;
  return false;
}

/** Extract care.viewer_measurements.v1 from draft structured_json (envelope or bare). */
export function extractCareViewerMeasurements(column: unknown): ViewerMeasurementsState | null {
  if (!column || typeof column !== "object") return null;
  const rec = column as Record<string, unknown>;
  const raw = rec.careViewerMeasurements ?? (isViewerMeasurementsState(rec) ? rec : null);
  if (!isViewerMeasurementsState(raw)) return null;
  return raw;
}

export function extractCareCanalApProvenance(column: unknown): Record<string, unknown> | null {
  if (!column || typeof column !== "object") return null;
  const rec = column as Record<string, unknown>;
  const raw = rec.careCanalApProvenance;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Parse annotationId from viewer_measurements.imageCoordinates JSON blob. */
export function annotationIdFromCoordinates(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { annotationId?: unknown };
    const id = typeof o.annotationId === "string" ? o.annotationId.trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

/** Parse explicit CARE intent from imageCoordinates (persisted at event time). */
export function intentFromCoordinates(raw: string | null | undefined): MeasurementIntent | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { intent?: unknown };
    const i = o.intent;
    if (i === "CANAL_AP" || i === "LESION" || i === "MIDLINE_SHIFT" || i === "OTHER") return i;
    return null;
  } catch {
    return null;
  }
}

/** Intent from persisted row only — never live toolbar state. */
export function resolvePersistedIntent(row: ViewerMeasurementApiRow): MeasurementIntent | null {
  const fromCoords = intentFromCoordinates(row.imageCoordinates);
  if (fromCoords) return fromCoords;
  if (row.measurementId === "CANAL_AP") return "CANAL_AP";
  return null;
}

/** Disc level from persisted row labels only. */
export function resolvePersistedCanalLevel(row: ViewerMeasurementApiRow): string | null {
  const label = [row.measurementId, row.measurementType].filter(Boolean).join(" ");
  return discLevelFromLabel(label) || discLevelFromLabel(row.measurementType) || null;
}

/** Build DICOM anchor from the row itself (canonical provenance). */
export function rowDerivedAnchor(row: ViewerMeasurementApiRow): ObservationAnchor | null {
  if (!row.studyInstanceUID) return null;
  return {
    studyInstanceUID: row.studyInstanceUID,
    seriesInstanceUID: row.seriesInstanceUID ?? undefined,
    sopInstanceUID: row.sopInstanceUID ?? undefined,
    frameNumber: row.frameNumber ?? undefined,
    viewer: (row.viewerName?.toLowerCase().includes("ohif") ? "ohif" : "frames") as "ohif" | "frames",
    capturedAt: row.createdAt || new Date().toISOString(),
  };
}

/**
 * Build a structured measurement upsert payload from a viewer_measurements API row.
 *
 * mode=historical: never uses live Measure toolbar / selected observation / activeAnchor.
 * mode=new_event: may stamp live intent/level/observation; activeAnchor only if row lacks SOP/series.
 */
export function structuredFromViewerRow(opts: {
  row: ViewerMeasurementApiRow;
  mode: ViewerRowIngestMode;
  /** Live Measure intent — new_event only. */
  liveIntent?: MeasurementIntent | null;
  /** Live canal target level — new_event only. */
  liveCanalLevel?: string | null;
  /** Live selected observation — new_event only. */
  liveSelectedObservationId?: string | null;
  /** Live viewport — new_event fallback only when row has no image UIDs. */
  liveActiveAnchor?: ObservationAnchor | null;
  /** Prior structured row when updating an already-known measurement. */
  prior?: StructuredMeasurement | null;
}): Omit<StructuredMeasurement, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
} {
  const axes = parseNumericAxes(opts.row.value);
  const label = [opts.row.measurementId, opts.row.measurementType].filter(Boolean).join(" ");
  const persistedIntent = resolvePersistedIntent(opts.row);
  const fromLabel = resolvePersistedCanalLevel(opts.row);

  const intent: MeasurementIntent | null =
    opts.mode === "new_event"
      ? (persistedIntent ?? opts.liveIntent ?? null)
      : persistedIntent;

  const spinalLevel =
    opts.mode === "new_event" && intent === "CANAL_AP"
      ? (fromLabel || opts.liveCanalLevel || null)
      : fromLabel;

  const concept: MeasurementIntent | string =
    opts.prior?.concept
    ?? intent
    ?? (opts.row.measurementId === "CANAL_AP" ? "CANAL_AP" : "OTHER");

  const liveObs =
    opts.mode === "new_event" ? (opts.liveSelectedObservationId ?? null) : null;
  const attach = shouldAttachToSelectedObservation({
    intent,
    selectedObservationId: liveObs,
  });
  const observationId =
    opts.prior?.observationId
    ?? (attach ? liveObs : null);

  const fromRow = rowDerivedAnchor(opts.row);
  let anchor: ObservationAnchor | null = fromRow;
  if (
    !fromRow
    && opts.mode === "new_event"
    && opts.liveActiveAnchor
    && (!opts.liveActiveAnchor.studyInstanceUID
      || !opts.row.studyInstanceUID
      || opts.liveActiveAnchor.studyInstanceUID === opts.row.studyInstanceUID)
  ) {
    // Proven new event with no row SOP/series — allow live viewport fallback.
    if (!opts.row.sopInstanceUID && !opts.row.seriesInstanceUID) {
      anchor = opts.liveActiveAnchor;
    }
  }

  return {
    concept: opts.prior?.concept ?? concept,
    toolType: opts.row.measurementType ?? null,
    values: {
      primary: axes.primary ?? null,
      secondary: axes.secondary ?? null,
      tertiary: axes.tertiary ?? null,
      raw: axes.raw || String(opts.row.value),
      unit: opts.row.unit || "mm",
    },
    spinalLevel: opts.prior?.spinalLevel ?? spinalLevel ?? null,
    observationId,
    anchor,
    viewerAnnotationId: annotationIdFromCoordinates(opts.row.imageCoordinates),
    viewerMeasurementRowId: opts.row.id,
    label: label || null,
    createdAt: opts.row.createdAt,
    manualOverride: opts.prior?.manualOverride ?? false,
  };
}
