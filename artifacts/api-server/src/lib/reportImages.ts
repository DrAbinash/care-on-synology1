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
// R1.3 — a report supports 0…100 images. Per-image and whole-report byte
// budgets keep the printed artifact bounded: past the total budget the
// remaining images are skipped gracefully (same degradation as a PACS miss).
const MAX_IMAGES_PER_REPORT = 100;
const MAX_IMAGE_BYTES = 400_000; // ~400 KB per rendered JPEG is plenty for print
const TOTAL_IMAGE_BYTES_BUDGET = 8_000_000; // ~8 MB of JPEG across the document
const FETCH_CONCURRENCY = 4;

export interface ImageReferenceRow {
  id: number;
  draftId: number;
  description: string;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  frameNumber: number | null;
  displayOrder: number;
  isKeyImage: boolean;
  createdBy: string | null;
}

/** R1.3 — pure: rendered-viewport edge (px) adapted to how many images the
 *  report carries, so a 100-image report stays printable. Exported for tests.
 *  COMPAT BOUNDARY: R1.1 rendered up to 8 images, all at 800px — existing
 *  reports must reprint identically, so shrinking starts only at counts that
 *  were impossible before R1.3 (>8). */
export function viewportForImageCount(count: number): number {
  if (count <= 8) return 800;   // every pre-R1.3 report renders as before
  if (count <= 20) return 560;
  if (count <= 50) return 420;
  return 320;
}

/** Small in-process cache so reprints don't refetch identical instances.
 *  Keyed by path AND viewport (R1.3 — viewport is adaptive), evicted by
 *  total cached bytes so 100-image reports can't balloon server memory.
 *  Patient pixels are never cached publicly — this cache lives in server
 *  memory only and every HTTP surface that serves them is no-store. */
const renderedCache = new Map<string, { dataUrl: string; at: number }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 512;
const CACHE_MAX_BYTES = 24_000_000;
let cacheBytes = 0;

function cacheGet(key: string): string | null {
  const hit = renderedCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    renderedCache.delete(key);
    cacheBytes -= hit.dataUrl.length;
    return null;
  }
  return hit.dataUrl;
}

function cachePut(key: string, dataUrl: string): void {
  const existing = renderedCache.get(key);
  if (existing) { renderedCache.delete(key); cacheBytes -= existing.dataUrl.length; }
  while (renderedCache.size >= CACHE_MAX || cacheBytes + dataUrl.length > CACHE_MAX_BYTES) {
    const oldest = renderedCache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = renderedCache.get(oldest);
    renderedCache.delete(oldest);
    if (evicted) cacheBytes -= evicted.dataUrl.length;
  }
  renderedCache.set(key, { dataUrl, at: Date.now() });
  cacheBytes += dataUrl.length;
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

async function fetchRenderedDataUrl(path: string, viewport: number): Promise<string | null> {
  const key = `${path}@${viewport}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const base = await orthancServerBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}?quality=90&viewport=${viewport},${viewport}`, {
      headers: { ...orthancAuthHeaders(), Accept: "image/jpeg" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    cachePut(key, dataUrl);
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

/** Resolve a draft's image references to inlined key-image models.
 *  R1.3 — fetches run with bounded concurrency (a 100-image report must not
 *  serialize 100 PACS round-trips) and stop inlining once the whole-report
 *  byte budget is spent; document order stays displayOrder regardless. */
export async function resolveDraftKeyImages(draftId: number): Promise<ReportKeyImageModel[]> {
  const refs = (await listDraftImageReferences(draftId))
    .filter((r) => renderedPathForReference(r) != null)
    .slice(0, MAX_IMAGES_PER_REPORT);
  const viewport = viewportForImageCount(refs.length);
  const srcs: (string | null)[] = new Array(refs.length).fill(null);
  let budget = TOTAL_IMAGE_BYTES_BUDGET;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < refs.length) {
      const i = next++;
      // Reserve the per-image maximum up front so concurrent workers can
      // never overshoot the whole-report budget, then refund the unused part.
      // Budget units are data-URL characters (base64 ≈ 4/3 of JPEG bytes).
      const reserve = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64;
      if (budget < reserve) continue; // budget spent: skip gracefully, keep order
      budget -= reserve;
      const src = await fetchRenderedDataUrl(renderedPathForReference(refs[i])!, viewport);
      if (!src) { budget += reserve; continue; } // graceful: report still renders
      budget += reserve - src.length;
      srcs[i] = src;
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, refs.length) }, () => worker()));
  const out: ReportKeyImageModel[] = [];
  for (let i = 0; i < refs.length; i++) {
    const src = srcs[i];
    if (!src) continue;
    out.push({
      src,
      caption: refs[i].description || "",
      displayOrder: refs[i].displayOrder ?? 0,
      sopInstanceUid: refs[i].sopInstanceUid,
      isKeyImage: refs[i].isKeyImage === true,
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
