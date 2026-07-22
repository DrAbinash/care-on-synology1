/**
 * usgProvenanceIngest — P3 exact-provenance persistence bridge (final-integration
 * wiring). Turns a DICOM SR dataset into canonical `viewer_measurements` rows
 * using the merged P3 core (parseSrContentTree → collectSrMeasurements →
 * srMeasurementToViewerRow) and writes them, idempotently.
 *
 * Guarantees:
 *   - a missing frame stays NULL — the row-builder never fabricates frame 1, and
 *     this ingest inserts `frame_number: null` EXPLICITLY so the column default
 *     (1) can never silently fabricate one;
 *   - idempotent: a row already present for (study, sop, value, unit) is skipped,
 *     so re-running extraction never duplicates provenance;
 *   - additive-only: it writes provenance rows into the shared viewer_measurements
 *     table; it never touches usg_measurements or the report/draft stores.
 *
 * Gated by ff_radiology_usg_exact_provenance at the call site.
 */

import { db } from "@workspace/db";
import { viewerMeasurementsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { parseSrContentTree, collectSrMeasurements } from "./usgSrContentTree";
import { srMeasurementToViewerRow, type ViewerMeasurementRow } from "./usgSrProvenanceBuilder";

export interface ProvenanceIngestContext {
  studyInstanceUID: string;
  seriesInstanceUID?: string | null;
  srDocumentSop?: string | null;
  patientId: number;
  studyId?: number | null;
  extractedAt?: string | null;
}

/** Pure: DICOM SR dataset → canonical viewer_measurements rows (never inserts). */
export function buildSrViewerRows(srDataset: string | Record<string, unknown>, ctx: ProvenanceIngestContext): ViewerMeasurementRow[] {
  const roots = parseSrContentTree(srDataset);
  const measurements = collectSrMeasurements(roots);
  return measurements.map((m) => srMeasurementToViewerRow(m, {
    studyInstanceUID: ctx.studyInstanceUID,
    seriesInstanceUID: ctx.seriesInstanceUID ?? null,
    srDocumentSop: ctx.srDocumentSop ?? null,
    extractedAt: ctx.extractedAt ?? null,
    patientId: ctx.patientId,
    studyId: ctx.studyId ?? null,
  }));
}

export interface IngestResult {
  built: number;
  inserted: number;
  skippedExisting: number;
}

/** Idempotently persist SR provenance rows into viewer_measurements. */
export async function ingestSrProvenance(srDataset: string | Record<string, unknown>, ctx: ProvenanceIngestContext): Promise<IngestResult> {
  const rows = buildSrViewerRows(srDataset, ctx);
  if (rows.length === 0) return { built: 0, inserted: 0, skippedExisting: 0 };

  // Existing DICOM-SR rows for this study — dedup key (sop|value|unit).
  const existing = await db.select().from(viewerMeasurementsTable)
    .where(and(
      eq(viewerMeasurementsTable.studyInstanceUID, ctx.studyInstanceUID),
      eq(viewerMeasurementsTable.viewerName, "DICOM SR"),
    ));
  const seen = new Set(existing.map((e) => `${e.sopInstanceUID ?? ""}|${e.value}|${e.unit}`));

  let inserted = 0, skippedExisting = 0;
  for (const r of rows) {
    const key = `${r.sopInstanceUID ?? ""}|${r.value}|${r.unit}`;
    if (seen.has(key)) { skippedExisting++; continue; }
    await db.insert(viewerMeasurementsTable).values({
      patientId: r.patientId,
      studyId: r.studyId ?? null,
      studyInstanceUID: r.studyInstanceUID,
      seriesInstanceUID: r.seriesInstanceUID ?? null,
      sopInstanceUID: r.sopInstanceUID ?? null,
      // Explicit null — do NOT let the column default (1) fabricate a frame.
      frameNumber: r.frameNumber ?? null,
      viewerName: r.viewerName,
      measurementType: r.measurementType,
      measurementId: r.measurementId ?? null,
      value: r.value,
      unit: r.unit,
      imageCoordinates: r.imageCoordinates ?? null,
      confidence: r.confidence,
      status: r.status,
    });
    seen.add(key);
    inserted++;
  }
  return { built: rows.length, inserted, skippedExisting };
}
