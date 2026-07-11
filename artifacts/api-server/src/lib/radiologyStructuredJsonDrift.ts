import { db } from "@workspace/db";
import { radiologyReportDraftsTable, reportFindingInstancesTable } from "@workspace/db/schema";
import { asc, eq, isNotNull } from "drizzle-orm";
import { isFeatureEnabledServer } from "./featureFlags";
import { buildStructuredJsonFromFindingInstances, type StructuredJsonCacheEntry } from "./radiologyStructuredJsonCache";

/**
 * radiologyStructuredJsonDrift.ts — Radiology Roadmap Ticket A5.
 *
 * Read-only drift detection between radiology_report_drafts.structured_json
 * (the cache, written by Ticket A4's regeneration) and report_finding_instances
 * (the source of truth, written by Ticket A3.2's dual-write). Detection only:
 * this module never writes to either table. Repair, if ever wanted, is a
 * separate, explicitly-invoked future ticket — not this one.
 *
 * Gated on ff_radiology_structured_core inside each exported function, same
 * convention as regenerateDraftStructuredJson.
 */

export type DriftStatus = "in_sync" | "missing_cache" | "stale_cache" | "empty_findings_stale_cache";

export interface DriftCheckResult {
  draftId: number;
  status: DriftStatus;
  driftDetected: boolean;
  cache: StructuredJsonCacheEntry[] | null;
  rebuilt: StructuredJsonCacheEntry[] | null;
}

export interface DriftScanEntry {
  draftId: number;
  status: DriftStatus;
  driftDetected: boolean;
}

export interface DriftScanSummary {
  checkedCount: number;
  driftCount: number;
  results: DriftScanEntry[];
}

/**
 * Structural deep-equality for the cache's JSON shape. Object key order is
 * NOT preserved by Postgres jsonb on read-back (arrays are), so a freshly
 * built-in-JS value and the same value read back from the drafts row can
 * differ in key order alone — comparing via JSON.stringify would then
 * report false drift. Arrays are compared by position (finding order is
 * meaningful and is expected to match when nothing has actually changed).
 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqualJson(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqualJson(aObj[key], bObj[key]))
  );
}

function classifyDrift(
  cache: StructuredJsonCacheEntry[] | null,
  rebuilt: StructuredJsonCacheEntry[] | null,
): DriftStatus {
  if (cache === null && rebuilt === null) return "in_sync";
  // Rebuilt has current findings, but the cache never picked them up (never
  // regenerated, or was explicitly cleared).
  if (cache === null && rebuilt !== null) return "missing_cache";
  // report_finding_instances currently has zero rows for this draft, but the
  // cache still shows a (now stale) non-empty snapshot — the "empty-finding"
  // case called out separately from a generic content mismatch, since the
  // source of truth has fully emptied out rather than merely changed.
  if (cache !== null && rebuilt === null) return "empty_findings_stale_cache";
  return deepEqualJson(cache, rebuilt) ? "in_sync" : "stale_cache";
}

/**
 * Compares one draft's cached structured_json against a freshly rebuilt
 * value from its current report_finding_instances rows. Read-only — never
 * writes to either table. No-op result (in_sync, both null) when the
 * feature flag is off, since with A3.2/A4 both gated on the same flag there
 * would be nothing to compare in practice; still returns a real result
 * rather than throwing, so callers don't need special-case handling.
 */
export async function checkDraftStructuredJsonDrift(draftId: number): Promise<DriftCheckResult> {
  if (!(await isFeatureEnabledServer("ff_radiology_structured_core"))) {
    return { draftId, status: "in_sync", driftDetected: false, cache: null, rebuilt: null };
  }

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

  const cache = (draftRow?.structuredJson ?? null) as StructuredJsonCacheEntry[] | null;
  const rebuilt = buildStructuredJsonFromFindingInstances(rows);
  const status = classifyDrift(cache, rebuilt);

  return { draftId, status, driftDetected: status !== "in_sync", cache, rebuilt };
}

/**
 * Scans every draft that could possibly be out of sync — i.e. every draft
 * with at least one report_finding_instances row, unioned with every draft
 * whose cache is currently non-null — and drift-checks each one. Drafts
 * with neither (null cache, zero FindingInstance rows) are trivially in
 * sync and are skipped rather than checked, since there is nothing to
 * compare. Sequential per-draft checks: this is an admin diagnostic for
 * periodic/on-demand use, not a hot path, so no batching optimization here.
 */
export async function scanDraftsForStructuredJsonDrift(): Promise<DriftScanSummary> {
  if (!(await isFeatureEnabledServer("ff_radiology_structured_core"))) {
    return { checkedCount: 0, driftCount: 0, results: [] };
  }

  const findingDraftIdRows = await db
    .selectDistinct({ draftId: reportFindingInstancesTable.draftId })
    .from(reportFindingInstancesTable)
    .where(isNotNull(reportFindingInstancesTable.draftId));

  const cachedDraftIdRows = await db
    .select({ id: radiologyReportDraftsTable.id })
    .from(radiologyReportDraftsTable)
    .where(isNotNull(radiologyReportDraftsTable.structuredJson));

  const candidateIds = new Set<number>();
  for (const row of findingDraftIdRows) {
    if (row.draftId !== null) candidateIds.add(row.draftId);
  }
  for (const row of cachedDraftIdRows) candidateIds.add(row.id);

  const results: DriftScanEntry[] = [];
  let driftCount = 0;
  for (const draftId of candidateIds) {
    const result = await checkDraftStructuredJsonDrift(draftId);
    results.push({ draftId: result.draftId, status: result.status, driftDetected: result.driftDetected });
    if (result.driftDetected) driftCount++;
  }

  return { checkedCount: results.length, driftCount, results };
}
