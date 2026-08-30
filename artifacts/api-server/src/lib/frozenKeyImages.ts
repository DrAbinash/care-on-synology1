/**
 * frozenKeyImages.ts — Phase 1 frozen viewport artifacts for report print/PDF.
 *
 * Prefer radiology_report_key_images (disk-backed JPEG under the persistent
 * uploads volume) over Orthanc /rendered when any includeInReport frozen rows
 * exist for the draft. Finalized reprints must not depend on PACS availability
 * and must NEVER silently substitute live Orthanc pixels when frozen rows were
 * intended — missing/corrupt frozen files render an explicit placeholder.
 *
 * Storage durability (production): Docker named volume
 *   uploads_data → /app/data/uploads
 * covers …/radiology-key-images/. DB backup alone is insufficient for Phase 1
 * evidence; include the uploads volume in backup/restore.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { db } from "@workspace/db";
import { radiologyReportKeyImagesTable, radiologyReportDraftsTable } from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ReportKeyImageModel } from "./reportPresentation";
import { resolveDraftKeyImages } from "./reportImages";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FROZEN_KEY_IMAGE_DIR = path.resolve(PACKAGE_ROOT, "data", "uploads", "radiology-key-images");
export const FROZEN_KEY_IMAGE_URL_PREFIX = "/uploads/radiology-key-images/";

/** After server-side normalize, print inlining uses this ceiling (bytes). */
export const FROZEN_PRINT_MAX_INLINE_BYTES = 2_500_000;
/** Normalize policy — max edge and JPEG quality for stored print artifacts. */
export const FROZEN_STORE_MAX_EDGE_PX = 1800;
export const FROZEN_STORE_JPEG_QUALITY = 85;

export const FROZEN_UNAVAILABLE_CAPTION_PREFIX = "Frozen key image unavailable";

/** Explicit SVG placeholder — never empty src with a SOP uid (would Orthanc-hydrate). */
export const FROZEN_UNAVAILABLE_PLACEHOLDER_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">` +
      `<rect width="480" height="360" fill="#111"/>` +
      `<text x="240" y="170" text-anchor="middle" fill="#fbbf24" font-family="sans-serif" font-size="18" font-weight="700">Frozen key image unavailable</text>` +
      `<text x="240" y="200" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="12">Evidence file missing or unreadable</text>` +
      `</svg>`,
  );

export type FrozenKeyImageRow = typeof radiologyReportKeyImagesTable.$inferSelect;

export type FrozenPrintResolution = {
  images: ReportKeyImageModel[];
  /** frozen = includeInReport frozen rows drive print; legacy_orthanc = no such rows. */
  source: "frozen" | "legacy_orthanc";
  unavailableFrozenCount: number;
  /** False when any includeInReport frozen artifact could not be loaded. */
  integrityOk: boolean;
};

export function isSafeKeyImageFilename(name: string): boolean {
  return /^[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/i.test(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

/** Map public URL → absolute path under the controlled upload dir (or null). */
export function resolveKeyImageDiskPath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const trimmed = imageUrl.trim();
  if (!trimmed.startsWith(FROZEN_KEY_IMAGE_URL_PREFIX)) return null;
  const base = path.basename(trimmed);
  if (!isSafeKeyImageFilename(base)) return null;
  return path.join(FROZEN_KEY_IMAGE_DIR, base);
}

export async function listDraftFrozenKeyImages(draftId: number): Promise<FrozenKeyImageRow[]> {
  return db
    .select()
    .from(radiologyReportKeyImagesTable)
    .where(eq(radiologyReportKeyImagesTable.draftId, draftId))
    .orderBy(asc(radiologyReportKeyImagesTable.sortOrder), asc(radiologyReportKeyImagesTable.id));
}

/**
 * Autorotate + resize + JPEG re-encode so every accepted upload is printable.
 * Replaces the source file with a `.jpg` of the same UUID stem.
 */
export async function normalizeKeyImageForPrint(absPath: string): Promise<{
  absPath: string;
  filename: string;
  width: number;
  height: number;
  bytes: number;
}> {
  const dir = path.dirname(absPath);
  const stem = path.parse(absPath).name;
  const outFilename = `${stem}.jpg`;
  const outPath = path.join(dir, outFilename);
  const tmpPath = path.join(dir, `${stem}.norm.tmp.jpg`);

  await sharp(absPath, { failOn: "none" })
    .rotate()
    .resize({
      width: FROZEN_STORE_MAX_EDGE_PX,
      height: FROZEN_STORE_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: FROZEN_STORE_JPEG_QUALITY, mozjpeg: true })
    .toFile(tmpPath);

  // Replace source: remove original when it is a different path (png/webp) or
  // when it is the same .jpg path (so rename can take its place).
  if (path.resolve(absPath) !== path.resolve(tmpPath)) {
    await fs.unlink(absPath).catch(() => undefined);
  }
  if (path.resolve(outPath) !== path.resolve(tmpPath)) {
    await fs.unlink(outPath).catch(() => undefined);
  }
  await fs.rename(tmpPath, outPath);

  let meta = await sharp(outPath).metadata();
  let st = await fs.stat(outPath);
  if (st.size > FROZEN_PRINT_MAX_INLINE_BYTES) {
    const tighter = path.join(dir, `${stem}.tight.tmp.jpg`);
    await sharp(outPath)
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toFile(tighter);
    await fs.unlink(outPath).catch(() => undefined);
    await fs.rename(tighter, outPath);
    meta = await sharp(outPath).metadata();
    st = await fs.stat(outPath);
  }
  return {
    absPath: outPath,
    filename: outFilename,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: st.size,
  };
}

type FileLoadResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: "missing" | "unreadable" | "empty" | "oversized" };

async function fileToDataUrl(diskPath: string): Promise<FileLoadResult> {
  try {
    let buf = await fs.readFile(diskPath);
    if (buf.length === 0) return { ok: false, reason: "empty" };

    // Verify the bytes are a real image — corrupt files must not become silent
    // "valid-looking" data URLs that print blank.
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buf, { failOn: "none" }).metadata();
      if (!meta.width || !meta.height) return { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }

    if (buf.length > FROZEN_PRINT_MAX_INLINE_BYTES) {
      try {
        buf = await sharp(buf, { failOn: "none" })
          .rotate()
          .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 72, mozjpeg: true })
          .toBuffer();
      } catch {
        return { ok: false, reason: "unreadable" };
      }
      if (buf.length === 0 || buf.length > FROZEN_PRINT_MAX_INLINE_BYTES) {
        return { ok: false, reason: "oversized" };
      }
      return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}` };
    }
    const ext = path.extname(diskPath).toLowerCase();
    const format = (meta.format || "").toLowerCase();
    const mime =
      format === "png" || ext === ".png" ? "image/png"
      : format === "webp" || ext === ".webp" ? "image/webp"
      : "image/jpeg";
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
  } catch {
    return { ok: false, reason: "missing" };
  }
}

function unavailableModel(row: FrozenKeyImageRow): ReportKeyImageModel {
  const base = (row.caption || "").trim();
  const caption = base
    ? `${FROZEN_UNAVAILABLE_CAPTION_PREFIX} — ${base}`.slice(0, 500)
    : FROZEN_UNAVAILABLE_CAPTION_PREFIX;
  return {
    src: FROZEN_UNAVAILABLE_PLACEHOLDER_SRC,
    caption,
    displayOrder: row.sortOrder ?? 0,
    // CRITICAL: clear SOP so print hydrate cannot substitute live Orthanc pixels.
    sopInstanceUid: null,
    isKeyImage: true,
    framing: null,
  };
}

/** Convert frozen rows (includeInReport) into presentation models from disk. */
export async function frozenRowsToPresentationModels(
  rows: FrozenKeyImageRow[],
): Promise<{ images: ReportKeyImageModel[]; unavailableCount: number }> {
  const included = rows.filter((r) => r.includeInReport);
  const images: ReportKeyImageModel[] = [];
  let unavailableCount = 0;
  for (const row of included) {
    const disk = resolveKeyImageDiskPath(row.imageUrl);
    const loaded = disk ? await fileToDataUrl(disk) : { ok: false as const, reason: "missing" as const };
    if (!loaded.ok) {
      unavailableCount += 1;
      images.push(unavailableModel(row));
      continue;
    }
    images.push({
      src: loaded.dataUrl,
      caption: row.caption || "",
      displayOrder: row.sortOrder ?? 0,
      sopInstanceUid: row.sopInstanceUid,
      isKeyImage: true,
      framing: null,
    });
  }
  return { images, unavailableCount };
}

/**
 * Print/PDF image resolution for a draft:
 * A. No includeInReport frozen rows → legacy Orthanc image-references (older reports).
 * B. Any includeInReport frozen rows → ONLY frozen artifacts (placeholders if missing).
 *    Never silently fall back to live PACS pixels when frozen evidence was expected.
 */
export async function resolveDraftPrintKeyImagesDetailed(draftId: number): Promise<FrozenPrintResolution> {
  const frozen = await listDraftFrozenKeyImages(draftId);
  const printable = frozen.filter((r) => r.includeInReport);
  if (printable.length > 0) {
    const { images, unavailableCount } = await frozenRowsToPresentationModels(printable);
    return {
      images,
      source: "frozen",
      unavailableFrozenCount: unavailableCount,
      integrityOk: unavailableCount === 0,
    };
  }
  const legacy = await resolveDraftKeyImages(draftId);
  return {
    images: legacy,
    source: "legacy_orthanc",
    unavailableFrozenCount: 0,
    integrityOk: true,
  };
}

export async function resolveDraftPrintKeyImages(draftId: number): Promise<ReportKeyImageModel[]> {
  const result = await resolveDraftPrintKeyImagesDetailed(draftId);
  return result.images;
}

/** Same as resolveDraftPrintKeyImages but via final report id(s) → draft. */
export async function resolveReportPrintKeyImagesDetailed(reportIds: number[]): Promise<FrozenPrintResolution> {
  const ids = [...new Set(reportIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) {
    return { images: [], source: "legacy_orthanc", unavailableFrozenCount: 0, integrityOk: true };
  }
  const [draft] = await db
    .select({ id: radiologyReportDraftsTable.id })
    .from(radiologyReportDraftsTable)
    .where(inArray(radiologyReportDraftsTable.finalReportId, ids))
    .orderBy(asc(radiologyReportDraftsTable.id))
    .limit(1);
  if (!draft) {
    return { images: [], source: "legacy_orthanc", unavailableFrozenCount: 0, integrityOk: true };
  }
  return resolveDraftPrintKeyImagesDetailed(draft.id);
}

export async function resolveReportPrintKeyImages(reportIds: number[]): Promise<ReportKeyImageModel[]> {
  const result = await resolveReportPrintKeyImagesDetailed(reportIds);
  return result.images;
}

/** Banner HTML when finalized frozen evidence is incomplete. */
export function frozenIntegrityBannerHtml(unavailableCount: number): string {
  if (unavailableCount <= 0) return "";
  const n = unavailableCount === 1 ? "1 frozen key image is" : `${unavailableCount} frozen key images are`;
  return `<div class="version-warning" data-testid="frozen-integrity-warning">Report integrity: ${n} unavailable on disk. Live PACS pixels were not substituted.</div>`;
}

/** Detach all key images from an observation (report-level preservation). */
export async function detachKeyImagesFromObservation(opts: {
  draftId: number;
  observationId: string;
}): Promise<number> {
  const updated = await db
    .update(radiologyReportKeyImagesTable)
    .set({ observationId: null })
    .where(
      and(
        eq(radiologyReportKeyImagesTable.draftId, opts.draftId),
        eq(radiologyReportKeyImagesTable.observationId, opts.observationId),
      ),
    )
    .returning({ id: radiologyReportKeyImagesTable.id });
  return updated.length;
}

/** Pure caption builder from observation-like fields (shared with client tests). */
export function buildObservationCaption(obs: {
  level?: string | null;
  laterality?: string | null;
  findingsText?: string | null;
  lastRenderedFindings?: string | null;
  concept?: string | null;
  region?: string | null;
}): string {
  const finding = (obs.lastRenderedFindings || obs.findingsText || "").trim().replace(/\s+/g, " ");
  const locParts = [obs.level, obs.laterality].map((s) => (s ?? "").trim()).filter(Boolean);
  if (locParts.length && finding) {
    const loc = locParts.join(" ");
    const body = finding.endsWith(".") ? finding : `${finding}.`;
    return `${loc}: ${body}`.slice(0, 500);
  }
  if (finding) return finding.slice(0, 500);
  const fallback = [obs.level, obs.laterality, obs.concept || obs.region].filter(Boolean).join(" — ");
  return fallback.slice(0, 500);
}

/** Bounded DICOM UID: digits and dots, length 1–128. */
export function isReasonableDicomUid(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  if (value.length > 128) return false;
  return /^[0-9]+(\.[0-9]+)*$/.test(value);
}

const VIEWERS = new Set(["frames", "ohif", "weasis"]);

export function parseViewportSnapshotJson(raw: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, json: "" };
  const s = String(raw);
  if (s.length > 4000) return { ok: false, error: "viewportSnapshotJson too large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { ok: false, error: "viewportSnapshotJson must be valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "viewportSnapshotJson must be an object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 && obj.version !== "1") {
    return { ok: false, error: "viewportSnapshotJson.version must be 1" };
  }
  return { ok: true, json: JSON.stringify(obj).slice(0, 4000) };
}

export function parseAnnotationMetadataJson(raw: unknown): { ok: true; json: string | null } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, json: null };
  const s = String(raw);
  if (s.length > 8000) return { ok: false, error: "annotationMetadataJson too large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { ok: false, error: "annotationMetadataJson must be valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "annotationMetadataJson must be an object or array" };
  }
  return { ok: true, json: JSON.stringify(parsed).slice(0, 8000) };
}

export function parseCapturedAt(raw: unknown): { ok: true; date: Date } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, date: new Date() };
  const d = new Date(String(raw));
  if (!Number.isFinite(d.getTime())) return { ok: false, error: "capturedAt must be a valid date" };
  return { ok: true, date: d };
}

export function parseViewer(raw: unknown): { ok: true; viewer: string | null } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, viewer: null };
  const v = String(raw).trim().toLowerCase().slice(0, 16);
  if (!VIEWERS.has(v)) return { ok: false, error: "viewer must be frames, ohif, or weasis" };
  return { ok: true, viewer: v };
}

export function parseModality(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  return String(raw).trim().toUpperCase().slice(0, 16) || null;
}
