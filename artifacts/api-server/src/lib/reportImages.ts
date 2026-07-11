/**
 * reportImages.ts — Ticket R1.1 Phase 10/11: selected report images.
 *
 * Persistence is REFERENCE-ONLY (radiology_image_references: study / series /
 * SOP instance UIDs + frame + caption + display order — never browser blob
 * URLs). At artifact-build time this module resolves each reference to pixels
 * by fetching Orthanc's DICOMweb "rendered" endpoint FROM THE SERVER
 * (ORTHANC_INTERNAL_URL vantage, server-held credentials) and inlining the
 * JPEG as a data: URL. No public PACS URL ever appears in a document, so the
 * same artifact works for staff print, patient token links, email and the
 * PACS archive copy without any extra auth plumbing.
 *
 * Read-only; failures degrade gracefully (the report renders without the
 * failed image — a report must never fail to print because the PACS is slow).
 */

import { db } from "@workspace/db";
import { radiologyImageReferencesTable, radiologyReportDraftsTable } from "@workspace/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { getRadiologyConfig } from "./pacs/pacsConfig";
import type { ReportKeyImageModel } from "./reportPresentation";

const FETCH_TIMEOUT_MS = 4000;
const MAX_IMAGES_PER_REPORT = 8;
const MAX_IMAGE_BYTES = 400_000; // ~400 KB per rendered JPEG is plenty for print

export interface ImageReferenceRow {
  id: number;
  draftId: number;
  description: string;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  frameNumber: number | null;
  displayOrder: number;
}

/** Small in-process cache so reprints don't refetch identical instances. */
const renderedCache = new Map<string, { dataUrl: string; at: number }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 64;

function cacheGet(key: string): string | null {
  const hit = renderedCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { renderedCache.delete(key); return null; }
  return hit.dataUrl;
}

function cachePut(key: string, dataUrl: string): void {
  if (renderedCache.size >= CACHE_MAX) {
    const oldest = renderedCache.keys().next().value;
    if (oldest !== undefined) renderedCache.delete(oldest);
  }
  renderedCache.set(key, { dataUrl, at: Date.now() });
}

/** Server-vantage Orthanc base — same preference order as the diagnostics
 *  service: internal Docker name first, else configured DICOMweb root. */
async function orthancServerBase(): Promise<string | null> {
  const internal = process.env.ORTHANC_INTERNAL_URL?.replace(/\/+$/, "");
  if (internal) return internal;
  const cfg = await getRadiologyConfig();
  const fromDicomWeb = cfg.orthanc.dicomWebUrl?.replace(/\/dicom-web\/?$/, "");
  return fromDicomWeb ? fromDicomWeb.replace(/\/+$/, "") : null;
}

function orthancAuthHeaders(): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  if (!user || !pass) return {};
  return { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

/** Pure: DICOMweb rendered-frame path for a reference (exported for tests). */
export function renderedPathForReference(ref: {
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  frameNumber: number | null;
}): string | null {
  const { studyInstanceUid: st, seriesInstanceUid: se, sopInstanceUid: so } = ref;
  const UID = /^[0-9.]{1,128}$/;
  if (!st || !se || !so || !UID.test(st) || !UID.test(se) || !UID.test(so)) return null;
  const base = `/dicom-web/studies/${st}/series/${se}/instances/${so}`;
  const frame = ref.frameNumber != null && ref.frameNumber >= 1 ? Math.floor(ref.frameNumber) : null;
  return frame ? `${base}/frames/${frame}/rendered` : `${base}/rendered`;
}

async function fetchRenderedDataUrl(path: string): Promise<string | null> {
  const cached = cacheGet(path);
  if (cached) return cached;
  const base = await orthancServerBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}?quality=90&viewport=800,800`, {
      headers: { ...orthancAuthHeaders(), Accept: "image/jpeg" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    cachePut(path, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** Image references for a draft, in display order (UID-complete rows only). */
export async function listDraftImageReferences(draftId: number): Promise<ImageReferenceRow[]> {
  const rows = await db
    .select()
    .from(radiologyImageReferencesTable)
    .where(eq(radiologyImageReferencesTable.draftId, draftId))
    .orderBy(asc(radiologyImageReferencesTable.displayOrder), asc(radiologyImageReferencesTable.id));
  return rows as ImageReferenceRow[];
}

/** Resolve a draft's image references to inlined key-image models. */
export async function resolveDraftKeyImages(draftId: number): Promise<ReportKeyImageModel[]> {
  const refs = (await listDraftImageReferences(draftId))
    .filter((r) => renderedPathForReference(r) != null)
    .slice(0, MAX_IMAGES_PER_REPORT);
  const out: ReportKeyImageModel[] = [];
  for (const ref of refs) {
    const path = renderedPathForReference(ref)!;
    const src = await fetchRenderedDataUrl(path);
    if (!src) continue; // graceful: report still renders
    out.push({
      src,
      caption: ref.description || "",
      displayOrder: ref.displayOrder ?? 0,
      sopInstanceUid: ref.sopInstanceUid,
    });
  }
  return out;
}

/** Resolve the key images for a FINAL report: the report row was produced
 *  from a draft (radiology_report_drafts.final_report_id); amendments share
 *  the root's draft, so we look up by every id in the resolution set. */
export async function resolveReportKeyImages(reportIds: number[]): Promise<ReportKeyImageModel[]> {
  const ids = [...new Set(reportIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  const [draft] = await db
    .select({ id: radiologyReportDraftsTable.id })
    .from(radiologyReportDraftsTable)
    .where(inArray(radiologyReportDraftsTable.finalReportId, ids))
    .orderBy(asc(radiologyReportDraftsTable.id))
    .limit(1);
  if (!draft) return [];
  return resolveDraftKeyImages(draft.id);
}
