import { db } from "@workspace/db";
import {
  radiologyReportDraftsTable,
  reportFindingInstancesTable,
  type ReportFindingInstance,
} from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { isFeatureEnabledServer } from "./featureFlags";
import { composeStructuredJsonColumn } from "./structuredJsonColumn";

/**
 * radiologyStructuredJsonCache.ts — Radiology Roadmap Ticket A4.
 *
 * Regenerates radiology_report_drafts.structured_json — a denormalized
 * CACHE, not a source of truth — from report_finding_instances, which
 * Ticket A3.2's dual-write keeps current for draft rows. Draft-only:
 * patient_reports (signed/final reports) has its own structured_json column
 * (Ticket A2) that this module never reads or writes.
 *
 * Gated on ff_radiology_structured_core inside regenerateDraftStructuredJson
 * itself, so it stays safe to call from any future call site without the
 * caller needing to remember the guard.
 */

export interface StructuredJsonCacheEntry {
  findingId: number;
  anatomicZoneId: number | null;
  structureId: number | null;
  category: string;
  modality: string;
  structuredJson: unknown;
  catalogVersion: string;
  source: string;
  confirmed: boolean;
}

/**
 * Pure mapping from report_finding_instances rows to the cache shape stored
 * in radiology_report_drafts.structured_json. Zero findings maps to null
 * (an empty cache reads the same as a never-generated one) rather than `[]`,
 * so "no structured findings for this draft" has one representation.
 *
 * Deterministic only if `rows` is already in a stable order — the caller
 * (regenerateDraftStructuredJson) is responsible for that via ORDER BY id.
 */
export function buildStructuredJsonFromFindingInstances(
  rows: ReportFindingInstance[],
): StructuredJsonCacheEntry[] | null {
  if (rows.length === 0) return null;
  return rows.map((row) => ({
    findingId: row.findingId,
    anatomicZoneId: row.anatomicZoneId,
    structureId: row.structureId,
    category: row.category,
    modality: row.modality,
    structuredJson: row.structuredJson,
    catalogVersion: row.catalogVersion,
    source: row.source,
    confirmed: row.confirmed,
  }));
}

/**
 * Regenerates radiology_report_drafts.structured_json for one draft from its
 * current report_finding_instances rows. No-op unless
 * ff_radiology_structured_core is enabled. Idempotent: re-running against
 * unchanged rows produces the same cache and the same UPDATE every time.
 *
 * Deliberately does not catch its own errors — isolating a caller's draft
 * save from a regeneration failure is the caller's responsibility (see
 * radiology-report-generator.ts's save-draft handler, which wraps this call
 * in its own try/catch, matching how it isolates A3.2's dual-write).
 */
export async function regenerateDraftStructuredJson(draftId: number): Promise<void> {
  if (!(await isFeatureEnabledServer("ff_radiology_structured_core"))) return;

  const [draftRow] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);

  const rows = await db
    .select()
    .from(reportFindingInstancesTable)
    .where(eq(reportFindingInstancesTable.draftId, draftId))
    .orderBy(asc(reportFindingInstancesTable.id));

  const cache = buildStructuredJsonFromFindingInstances(rows);
  const next = composeStructuredJsonColumn({
    existing: draftRow?.structuredJson ?? null,
    a4Cache: cache,
  });

  await db
    .update(radiologyReportDraftsTable)
    .set({ structuredJson: next })
    .where(eq(radiologyReportDraftsTable.id, draftId));
}
