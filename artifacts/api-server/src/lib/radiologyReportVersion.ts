import { db } from "@workspace/db";
import { patientReportsTable, patientReportAmendmentsTable } from "@workspace/db/schema";
import { asc, eq, inArray } from "drizzle-orm";

/**
 * Ticket D8 — canonical amendment-chain resolution for every report-reading
 * and delivery surface (viewer GET, print, PDF, public token, WhatsApp/email
 * share, PACS archive). One shared, strictly READ-ONLY service:
 *
 *   - default clinical display/delivery resolves to the LATEST signed version;
 *   - explicit historical access stays possible (mode "specific"/"root");
 *   - a corrupt chain (fork, cycle, gap, missing row, cross-patient link)
 *     fails SAFELY to the specifically requested immutable row, with the
 *     corruption surfaced as warnings — never a guess, never a mutation.
 *
 * The pure analysis core (analyzeChain) is separated from the db-backed
 * resolver so chain-validation logic is unit-testable without a database and
 * is never duplicated across routes.
 */

export interface ChainLinkRow {
  originalReportId: number;
  amendedReportId: number;
  rootReportId: number;
  originalDocumentId: string;
  amendedDocumentId: string;
  sequenceNumber: number;
  reason: string;
  amendedByName: string;
  createdAt: Date;
}

/** Minimal projection of a patient_reports row — everything resolution and
 *  banners need, nothing more. Callers hydrate full rows themselves. */
export interface VersionRow {
  id: number;
  patientId: number;
  status: string;
  reportNumber: string;
  signedByName: string | null;
  signedAt: Date | null;
  createdAt: Date;
}

export interface ChainAnalysis {
  ok: boolean;
  warnings: string[];
  /** Links ordered by sequenceNumber (as stored; validation reports gaps). */
  orderedLinks: ChainLinkRow[];
  /** Every version in order: [root, amendment1, amendment2, ...]. */
  versionIds: number[];
  rootReportId: number;
  latestReportId: number;
}

/**
 * Pure: order and validate one chain's linkage rows. `anchorReportId` is the
 * report the caller started from; on a corrupt chain the caller must fall
 * back to it. UNIQUE(original_report_id)/UNIQUE(amended_report_id) make
 * forks/cycles impossible to WRITE (D7), so any violation seen here is data
 * corruption — detected, reported, never repaired silently.
 */
export function analyzeChain(links: ChainLinkRow[], anchorReportId: number): ChainAnalysis {
  const warnings: string[] = [];
  if (links.length === 0) {
    return { ok: true, warnings, orderedLinks: [], versionIds: [anchorReportId], rootReportId: anchorReportId, latestReportId: anchorReportId };
  }

  const rootReportId = links[0].rootReportId;
  for (const l of links) {
    if (l.rootReportId !== rootReportId) warnings.push(`chain_mixed_roots:${l.rootReportId}!=${rootReportId}`);
    if (l.originalReportId === l.amendedReportId) warnings.push(`chain_self_link:${l.originalReportId}`);
  }

  const ordered = [...links].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // Sequence numbers must be exactly 1..n — a duplicate is a fork, a gap is a
  // missing link.
  const seen = new Set<number>();
  for (const l of ordered) {
    if (seen.has(l.sequenceNumber)) warnings.push(`chain_fork_duplicate_sequence:${l.sequenceNumber}`);
    seen.add(l.sequenceNumber);
  }
  for (let i = 0; i < ordered.length; i++) {
    if (!seen.has(i + 1)) warnings.push(`chain_missing_sequence:${i + 1}`);
  }

  // Continuity: link N's original must be link N-1's amended (link 1's
  // original must be the root). A break means a missing/foreign link.
  for (let i = 0; i < ordered.length; i++) {
    const expectedOriginal = i === 0 ? rootReportId : ordered[i - 1].amendedReportId;
    if (ordered[i].originalReportId !== expectedOriginal) {
      warnings.push(`chain_broken_link:seq${ordered[i].sequenceNumber}_original${ordered[i].originalReportId}_expected${expectedOriginal}`);
    }
  }

  // Cycle: any report id appearing twice along the walk.
  const versionIds = [rootReportId, ...ordered.map((l) => l.amendedReportId)];
  const idSet = new Set<number>();
  for (const id of versionIds) {
    if (idSet.has(id)) warnings.push(`chain_cycle:${id}`);
    idSet.add(id);
  }

  if (!idSet.has(anchorReportId)) warnings.push(`chain_anchor_not_in_chain:${anchorReportId}`);

  const ok = warnings.length === 0;
  return {
    ok,
    warnings,
    orderedLinks: ordered,
    versionIds,
    rootReportId,
    latestReportId: ok ? versionIds[versionIds.length - 1] : anchorReportId,
  };
}

export type ResolveMode = "latest" | "specific" | "root";

export interface ResolveReportVersionOptions {
  mode?: ResolveMode;
  /** Explicit historical access (mode "specific"/"root" on a superseded row)
   *  is always possible; this flag only labels it in resolutionReason. */
  allowHistorical?: boolean;
  /** Include the per-version chain summary in the result. */
  includeChain?: boolean;
  /** For patient-facing delivery: only resolve "latest" to a row whose status
   *  is in this list (e.g. ["verified","delivered"]). When the newest
   *  version(s) fail the gate, the newest QUALIFYING version at or after the
   *  requested one is served; if none qualifies the requested row itself is
   *  served — always with `superseded` truthfully set so the caller can
   *  watermark it. Never resolves to a version OLDER than the requested one. */
  deliverableStatuses?: string[];
}

export interface ChainSummaryEntry {
  sequenceNumber: number;
  reportId: number;
  reportNumber: string | null;
  status: string | null;
  isLatest: boolean;
  amendedByName: string | null;
  amendedAt: string | null;
  reason: string | null;
}

export interface ResolvedReportVersion {
  requestedReportId: number;
  resolvedReportId: number;
  rootReportId: number;
  latestReportId: number;
  requestedReport: VersionRow;
  resolvedReport: VersionRow;
  rootReport: VersionRow | null;
  latestReport: VersionRow | null;
  /** True when the REQUESTED row has a newer signed version. */
  superseded: boolean;
  /** True when the row actually being SERVED is not the newest version —
   *  the caller must watermark/banner it. */
  resolvedSuperseded: boolean;
  /** 1-based position of the resolved row (1 = original/root). */
  sequenceNumber: number;
  totalVersions: number;
  /** Amendment reason of the RESOLVED row (null for the root). */
  amendmentReason: string | null;
  /** Reason of the newest amendment in the chain (what superseded banners cite). */
  latestAmendmentReason: string | null;
  resolutionReason:
    | "no_chain"
    | "already_latest"
    | "resolved_to_latest"
    | "explicit_specific"
    | "explicit_root"
    | "latest_not_deliverable"
    | "chain_corrupt_fallback";
  warnings: string[];
  chain?: ChainSummaryEntry[];
  /** Raw ordered linkage rows (includeChain only) — lets callers preserve
   *  pre-D8 response shapes without re-querying the chain. */
  links?: ChainLinkRow[];
}

const versionColumns = {
  id: patientReportsTable.id,
  patientId: patientReportsTable.patientId,
  status: patientReportsTable.status,
  reportNumber: patientReportsTable.reportNumber,
  signedByName: patientReportsTable.signedByName,
  signedAt: patientReportsTable.signedAt,
  createdAt: patientReportsTable.createdAt,
} as const;

/**
 * Resolve which version of a report an id should serve. Read-only: performs
 * only SELECTs; never mutates any report or linkage row. Returns null when
 * the requested report does not exist at all.
 */
export async function resolveReportVersion(
  reportId: number,
  options: ResolveReportVersionOptions = {},
): Promise<ResolvedReportVersion | null> {
  const mode: ResolveMode = options.mode ?? "latest";

  const [requested] = await db
    .select(versionColumns)
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, reportId))
    .limit(1);
  if (!requested) return null;

  // Anchor into the chain: the row is either an amendment, a root, or both
  // (middle of a chain). Two cheap indexed lookups — the no-chain common case
  // costs nothing more than D7's loadAmendmentChain did.
  const [asAmendment] = await db
    .select()
    .from(patientReportAmendmentsTable)
    .where(eq(patientReportAmendmentsTable.amendedReportId, reportId))
    .limit(1);
  const [asOriginal] = await db
    .select()
    .from(patientReportAmendmentsTable)
    .where(eq(patientReportAmendmentsTable.originalReportId, reportId))
    .limit(1);
  const anyLink = asAmendment ?? asOriginal;

  const base = {
    requestedReportId: reportId,
    requestedReport: requested,
    warnings: [] as string[],
  };

  if (!anyLink) {
    return {
      ...base,
      resolvedReportId: reportId,
      rootReportId: reportId,
      latestReportId: reportId,
      resolvedReport: requested,
      rootReport: requested,
      latestReport: requested,
      superseded: false,
      resolvedSuperseded: false,
      sequenceNumber: 1,
      totalVersions: 1,
      amendmentReason: null,
      latestAmendmentReason: null,
      resolutionReason: "no_chain",
      ...(options.includeChain ? { chain: [] as ChainSummaryEntry[], links: [] as ChainLinkRow[] } : {}),
    };
  }

  const links = (await db
    .select()
    .from(patientReportAmendmentsTable)
    .where(eq(patientReportAmendmentsTable.rootReportId, anyLink.rootReportId))
    .orderBy(asc(patientReportAmendmentsTable.sequenceNumber))) as ChainLinkRow[];

  const analysis = analyzeChain(links, reportId);
  const warnings = [...analysis.warnings];

  // Hydrate minimal rows for every version: cross-patient + status gating +
  // missing-row detection, one IN query.
  const rows = await db
    .select(versionColumns)
    .from(patientReportsTable)
    .where(inArray(patientReportsTable.id, analysis.versionIds));
  const rowById = new Map<number, VersionRow>(rows.map((r) => [r.id, r]));
  for (const id of analysis.versionIds) {
    if (!rowById.has(id)) warnings.push(`chain_missing_report_row:${id}`);
  }
  for (const r of rows) {
    if (r.patientId !== requested.patientId) warnings.push(`chain_cross_patient:${r.id}`);
  }

  const corrupt = warnings.length > 0;
  const chainSummary: ChainSummaryEntry[] = analysis.versionIds.map((id, i) => {
    const row = rowById.get(id) ?? null;
    const link = i === 0 ? null : analysis.orderedLinks[i - 1];
    return {
      sequenceNumber: i + 1,
      reportId: id,
      reportNumber: row?.reportNumber ?? null,
      status: row?.status ?? null,
      isLatest: !corrupt && id === analysis.latestReportId,
      amendedByName: link?.amendedByName ?? null,
      amendedAt: link ? new Date(link.createdAt).toISOString() : null,
      reason: link?.reason ?? null,
    };
  });

  const finish = (
    resolved: VersionRow,
    resolutionReason: ResolvedReportVersion["resolutionReason"],
  ): ResolvedReportVersion => {
    const latestId = corrupt ? reportId : analysis.latestReportId;
    const position = analysis.versionIds.indexOf(resolved.id);
    const link = position > 0 ? analysis.orderedLinks[position - 1] : null;
    const lastLink = analysis.orderedLinks[analysis.orderedLinks.length - 1] ?? null;
    return {
      ...base,
      warnings,
      resolvedReportId: resolved.id,
      rootReportId: analysis.rootReportId,
      latestReportId: latestId,
      resolvedReport: resolved,
      rootReport: rowById.get(analysis.rootReportId) ?? null,
      latestReport: rowById.get(latestId) ?? null,
      superseded: !corrupt && reportId !== analysis.latestReportId,
      resolvedSuperseded: !corrupt && resolved.id !== analysis.latestReportId,
      sequenceNumber: position >= 0 ? position + 1 : 1,
      totalVersions: analysis.versionIds.length,
      amendmentReason: link?.reason ?? null,
      latestAmendmentReason: lastLink?.reason ?? null,
      resolutionReason,
      ...(options.includeChain ? { chain: chainSummary, links: analysis.orderedLinks } : {}),
    };
  };

  // Corrupt chain → fail safely to the specifically requested immutable row.
  if (corrupt) return finish(requested, "chain_corrupt_fallback");

  if (mode === "specific") return finish(requested, "explicit_specific");

  if (mode === "root") {
    const root = rowById.get(analysis.rootReportId);
    return finish(root ?? requested, "explicit_root");
  }

  // mode === "latest"
  if (reportId === analysis.latestReportId) return finish(requested, "already_latest");

  const requestedPos = analysis.versionIds.indexOf(reportId);
  if (options.deliverableStatuses && options.deliverableStatuses.length > 0) {
    // Walk newest → requested; serve the newest version this surface is
    // allowed to deliver. Never older than the requested row.
    for (let i = analysis.versionIds.length - 1; i > requestedPos; i--) {
      const candidate = rowById.get(analysis.versionIds[i]);
      if (candidate && options.deliverableStatuses.includes(candidate.status)) {
        return finish(candidate, "resolved_to_latest");
      }
    }
    return finish(requested, "latest_not_deliverable");
  }

  const latest = rowById.get(analysis.latestReportId);
  if (!latest) return finish(requested, "chain_corrupt_fallback"); // defensive; missing-row already warned
  return finish(latest, "resolved_to_latest");
}
