/**
 * Representative MRI image selection — DESIGN / AUDIT only.
 *
 * DO NOT hard-code clinical sequence rules (DWI/FLAIR/…) into production
 * selection until live SeriesDescription / SequenceName distributions are
 * reviewed against Orthanc studies at the site.
 *
 * Current overnight path (shadowPipeline + studyImageSelection):
 *   - strategy "modality-aware"
 *   - for MR: up to 3 evenly spaced slices PER SERIES (by seriesNumber order)
 *   - hardCap historically 20; now also capped by maxImagesForContextBudget(num_ctx)
 *   - InstanceRef has NO seriesDescription / sequenceName — selection is blind
 *     to protocol metadata
 *
 * Interactive draft / self-test path:
 *   - middle instance per series, max 6, resized to width≤512 JPEG q80
 *   - seriesDescription is captured for diagnostics only
 *
 * Target architecture (eventual):
 *   Study → identify relevant sequences (from SeriesDescription/SequenceName)
 *        → select representative slices per sequence
 *        → fit within context/GPU budget
 *        → qwen → draft
 *
 * For Brain MRI, DWI/ADC/FLAIR/SWI/T2/T1 may beat six arbitrary middles from
 * early series — but that requires metadata-aware ranking, not a fixed 20→6 cut.
 */

export interface SeriesSelectionAuditRow {
  seriesUid: string;
  seriesNumber: number | null;
  seriesDescription: string | null;
  instanceCount: number;
  /** What current modality-aware logic would pick from this series. */
  wouldPickCount: number;
  selectionNote: string;
}

export interface OvernightSelectionAudit {
  strategy: "modality-aware";
  maxSlicesPerSeries: 3;
  historicalHardCap: 20;
  contextBudgetCap: number;
  effectiveMaxImages: number;
  seriesAudited: SeriesSelectionAuditRow[];
  totalWouldSelect: number;
  warnings: string[];
  proposedNextSteps: string[];
}

const CROSS_SECTIONAL = new Set(["CT", "MR", "MRI", "PT", "NM"]);
const MAX_SLICES_PER_SERIES = 3;

/**
 * Audit what the CURRENT overnight selector would do given series metadata.
 * Pure — does not fetch Orthanc or call Ollama.
 */
export function auditOvernightImageSelection(opts: {
  modality: string;
  contextBudgetMaxImages: number;
  series: Array<{
    seriesUid: string;
    seriesNumber?: number | null;
    seriesDescription?: string | null;
    instanceCount: number;
  }>;
}): OvernightSelectionAudit {
  const modality = (opts.modality || "").toUpperCase();
  const cross = CROSS_SECTIONAL.has(modality);
  const effectiveMaxImages = Math.min(20, Math.max(1, opts.contextBudgetMaxImages));

  const sorted = [...opts.series].sort(
    (a, b) =>
      (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0) ||
      a.seriesUid.localeCompare(b.seriesUid),
  );

  const seriesAudited: SeriesSelectionAuditRow[] = [];
  let remaining = effectiveMaxImages;
  let totalWouldSelect = 0;

  for (const s of sorted) {
    const n = Math.max(0, Math.floor(s.instanceCount));
    let would = 0;
    let note = "";
    if (n <= 0) {
      note = "empty series — skipped";
    } else if (cross && n > MAX_SLICES_PER_SERIES) {
      would = Math.min(MAX_SLICES_PER_SERIES, remaining);
      note = `cross-sectional: up to ${MAX_SLICES_PER_SERIES} evenly spaced (budget left ${remaining})`;
    } else {
      would = Math.min(1, remaining);
      note = `single middle instance (budget left ${remaining})`;
    }
    would = Math.min(would, remaining);
    remaining -= would;
    totalWouldSelect += would;
    seriesAudited.push({
      seriesUid: s.seriesUid,
      seriesNumber: s.seriesNumber ?? null,
      seriesDescription: s.seriesDescription ?? null,
      instanceCount: n,
      wouldPickCount: would,
      selectionNote: note,
    });
  }

  const warnings: string[] = [];
  if (effectiveMaxImages >= 13) {
    warnings.push(
      `effectiveMaxImages=${effectiveMaxImages}: live 6-image MRI ≈6453 tokens / ~219s at num_ctx=16384 — large caps are latency- and VRAM-hostile`,
    );
  }
  if (sorted.length > 0 && !sorted.some((s) => (s.seriesDescription ?? "").trim())) {
    warnings.push(
      "SeriesDescription absent on audited rows — cannot do sequence-aware selection yet; InstanceRef lacks description fields in overnight list path",
    );
  }
  const earlySeriesBias =
    totalWouldSelect > 0 &&
    seriesAudited.filter((r) => r.wouldPickCount > 0).every((r, _i, arr) => {
      const first = arr[0];
      return first != null && (r.seriesNumber ?? 0) <= (first.seriesNumber ?? 0) + 2;
    });
  if (cross && earlySeriesBias && sorted.length > 4) {
    warnings.push(
      "Selection walks seriesNumber order and stops at cap — late but clinically useful sequences (e.g. DWI/SWI) may be dropped entirely",
    );
  }

  return {
    strategy: "modality-aware",
    maxSlicesPerSeries: MAX_SLICES_PER_SERIES,
    historicalHardCap: 20,
    contextBudgetCap: opts.contextBudgetMaxImages,
    effectiveMaxImages,
    seriesAudited,
    totalWouldSelect,
    warnings,
    proposedNextSteps: [
      "Extend InstanceRef + DICOMweb list with SeriesDescription (0008,103E) and SequenceName (0018,0024) when present",
      "Add a metadata-ranking stage before slice picking; keep clinical keyword tables site-reviewed, not hard-coded blindly",
      "Budget gate: select sequences first, then 1–2 slices each until estimateVisionPromptTokens fits num_ctx and GPU admission",
      "Do not retry overnight backlog at 20 images; keep context budget cap and measure 1/2/3/4/6 latency on one GPU",
      "Do not set production num_ctx=16384 as the fix for 8192 CUDA OOM until /api/ps proves no runner stacking",
    ],
  };
}
