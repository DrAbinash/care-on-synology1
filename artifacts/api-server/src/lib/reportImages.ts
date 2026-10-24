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
 *
 * fetchPrintImageBytes below serves a second consumer of the same "get pixels
 * for a reference from Orthanc, from the server" responsibility: the DICOM
 * print bridge integration (routes/pacsEnterprise.ts POST /print-images),
 * which wants raw bytes to forward rather than an inlined data: URL.
 */

import { db } from "@workspace/db";
import { radiologyImageReferencesTable, radiologyReportDraftsTable } from "@workspace/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
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
  presentationJson?: string | null;
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
  // Prefer container/LAN Orthanc (same order as pacsEnterprise + warmer).
  const fromEnv = (process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "")
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const cfg = await getRadiologyConfig();
  const fromDicomWeb = (cfg.orthanc.dicomWebUrl || "").replace(/\/dicom-web\/?$/, "").replace(/\/+$/, "");
  // Browser-relative proxy paths (/api/radiology/dicom-web) are not reachable
  // as a server-side Orthanc base — skip them so we don't silently no-op.
  if (fromDicomWeb && /^https?:\/\//i.test(fromDicomWeb)) return fromDicomWeb;
  return null;
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

/** Outcome of one rendered-frame fetch — the reason travels with the miss
 *  because "the PACS returned 500" and "this image is bigger than the per-image
 *  budget" demand different fixes, and until now neither was even logged. */
export type RenderedFetchOutcome =
  | { ok: true; src: string }
  | { ok: false; reason: string };

async function fetchRenderedDataUrl(path: string, viewport: number): Promise<RenderedFetchOutcome> {
  const key = `${path}@${viewport}`;
  const cached = cacheGet(key);
  if (cached) return { ok: true, src: cached };
  const base = await orthancServerBase();
  if (!base) return { ok: false, reason: "orthanc_base_unconfigured" };
  try {
    const res = await fetch(`${base}${path}?quality=90&viewport=${viewport},${viewport}`, {
      headers: { ...orthancAuthHeaders(), Accept: "image/jpeg" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "report key image fetch failed (Orthanc non-OK)");
      return { ok: false, reason: `orthanc_http_${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
      logger.warn({ path, bytes: buf.length }, "report key image rejected (empty or over per-image budget)");
      return { ok: false, reason: buf.length === 0 ? "empty_body" : "over_per_image_budget" };
    }
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    cachePut(key, dataUrl);
    return { ok: true, src: dataUrl };
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network_error";
    logger.warn({ err, path, reason }, "report key image fetch failed");
    return { ok: false, reason };
  }
}

const PRINT_FETCH_TIMEOUT_MS = 8000;
const PRINT_VIEWPORT_PX = 2000; // photo-paper print quality needs more than a report thumbnail
// Exported so routes/pacsEnterprise.ts can reserve against the SAME per-image
// worst case when budgeting the total request size sent to the print bridge.
export const PRINT_MAX_IMAGE_BYTES = 3_000_000;

/** Fetch a single instance/frame as raw rendered-JPEG bytes for the DICOM
 *  print bridge (drabinash/dicomtowindows) to forward as-is — not an inlined
 *  data: URL (that's what fetchRenderedDataUrl above is for) and not routed
 *  through the report-thumbnail cache above (print images are fetched at
 *  print-quality resolution, one-shot, so sharing that small cache's budget
 *  here would just evict real report thumbnails for no benefit). */
export async function fetchPrintImageBytes(ref: {
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  frameNumber: number | null;
}): Promise<{ bytes: Buffer; mime: string } | null> {
  const path = renderedPathForReference(ref);
  if (!path) return null;
  const base = await orthancServerBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}?quality=95&viewport=${PRINT_VIEWPORT_PX},${PRINT_VIEWPORT_PX}`, {
      headers: { ...orthancAuthHeaders(), Accept: "image/jpeg" },
      signal: AbortSignal.timeout(PRINT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "print-bridge image fetch failed (Orthanc non-OK)");
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PRINT_MAX_IMAGE_BYTES) {
      logger.warn({ path, bytes: bytes.length }, "print-bridge image rejected (empty or over budget)");
      return null;
    }
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return { bytes, mime };
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network_error";
    logger.warn({ err, path, reason }, "print-bridge image fetch failed");
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

/** Identity of one picture, shared by the frozen and the reference paths so a
 *  print resolution can tell "the same image twice" from "two images". A frame
 *  number is part of it: an 8-frame object is 8 different pictures. */
export function imageIdentityKey(sopInstanceUid: string | null | undefined, frameNumber: number | null | undefined): string {
  return `${sopInstanceUid ?? ""}|${frameNumber ?? ""}`;
}

/** Resolve a draft's image references to inlined key-image models.
 *  R1.3 — fetches run with bounded concurrency (a 100-image report must not
 *  serialize 100 PACS round-trips) and stop inlining once the whole-report
 *  byte budget is spent; document order stays displayOrder regardless.
 *  `excludeKeys` drops references a frozen artifact already covers, so a report
 *  that mixes frozen captures and picker images prints each picture once. */
export async function resolveDraftKeyImages(
  draftId: number,
  excludeKeys?: Set<string>,
): Promise<ReportKeyImageModel[]> {
  const refs = (await listDraftImageReferences(draftId))
    .filter((r) => renderedPathForReference(r) != null)
    .filter((r) => !excludeKeys || !excludeKeys.has(imageIdentityKey(r.sopInstanceUid, r.frameNumber)))
    .slice(0, MAX_IMAGES_PER_REPORT);
  const viewport = viewportForImageCount(refs.length);
  const srcs: (string | null)[] = new Array(refs.length).fill(null);
  // Why a cell has no pixels — surfaced on the model so the reader/print can
  // say "this image could not be read" (a PACS failure worth investigating)
  // instead of conflating it with "this image was skipped to keep the export
  // loadable" (the budget doing its job). "failed" only ever means: we
  // TRIED, and Orthanc said no.
  const failures: ("failed" | "budget" | null)[] = new Array(refs.length).fill(null);
  let budget = TOTAL_IMAGE_BYTES_BUDGET;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < refs.length) {
      const i = next++;
      // Reserve the per-image maximum up front so concurrent workers can
      // never overshoot the whole-report budget, then refund the unused part.
      // Budget units are data-URL characters (base64 ≈ 4/3 of JPEG bytes).
      const reserve = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64;
      if (budget < reserve) {
        failures[i] = "budget"; // graceful: report still renders
        continue;
      }
      budget -= reserve;
      const outcome = await fetchRenderedDataUrl(renderedPathForReference(refs[i])!, viewport);
      if (!outcome.ok) { budget += reserve; failures[i] = "failed"; continue; } // graceful: report still renders
      budget += reserve - outcome.src.length;
      srcs[i] = outcome.src;
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, refs.length) }, () => worker()));
  const out: ReportKeyImageModel[] = [];
  for (let i = 0; i < refs.length; i++) {
    out.push(buildKeyImageModel(refs[i], srcs[i], failures[i]));
  }
  return out;
}

/** One reference → its printed/reader model, including the honest no-pixels
 *  status. Exported for tests; the shape it stamps is the contract. */
export function buildKeyImageModel(
  ref: ImageReferenceRow,
  src: string | null,
  fetchStatus: "failed" | "budget" | null,
): ReportKeyImageModel {
  // Keep a placeholder cell when Orthanc is unreachable so the print HTML
  // still exposes data-sop-instance-uid for browser-side hydrate. Empty src
  // renders as a black square until the client fills pixels.
  return {
    src: src ?? "",
    caption: ref.description || "",
    displayOrder: ref.displayOrder ?? 0,
    sopInstanceUid: ref.sopInstanceUid,
    frameNumber: ref.frameNumber ?? null,
    isKeyImage: ref.isKeyImage === true,
    framing: ref.presentationJson ?? "{}",
    imageFetchStatus: fetchStatus,
  };
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
