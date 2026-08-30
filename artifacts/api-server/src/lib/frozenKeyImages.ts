/**
 * frozenKeyImages.ts — Phase 1 frozen viewport artifacts for report print/PDF.
 *
 * Prefer radiology_report_key_images (disk-backed JPEG/WebP) over Orthanc
 * /rendered when any includeInReport frozen rows exist for the draft.
 * Finalized reprints must not depend on PACS availability.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@workspace/db";
import { radiologyReportKeyImagesTable, radiologyReportDraftsTable } from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ReportKeyImageModel } from "./reportPresentation";
import { resolveDraftKeyImages } from "./reportImages";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FROZEN_KEY_IMAGE_DIR = path.resolve(PACKAGE_ROOT, "data", "uploads", "radiology-key-images");
export const FROZEN_KEY_IMAGE_URL_PREFIX = "/uploads/radiology-key-images/";

const MAX_INLINE_BYTES = 1_500_000;

export type FrozenKeyImageRow = typeof radiologyReportKeyImagesTable.$inferSelect;

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

async function fileToDataUrl(diskPath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(diskPath);
    if (buf.length === 0 || buf.length > MAX_INLINE_BYTES) return null;
    const ext = path.extname(diskPath).toLowerCase();
    const mime =
      ext === ".png" ? "image/png"
      : ext === ".webp" ? "image/webp"
      : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Convert frozen rows (includeInReport) into presentation models from disk. */
export async function frozenRowsToPresentationModels(
  rows: FrozenKeyImageRow[],
): Promise<ReportKeyImageModel[]> {
  const included = rows.filter((r) => r.includeInReport);
  const out: ReportKeyImageModel[] = [];
  for (const row of included) {
    const disk = resolveKeyImageDiskPath(row.imageUrl);
    const src = disk ? await fileToDataUrl(disk) : null;
    if (!src) continue;
    out.push({
      src,
      caption: row.caption || "",
      displayOrder: row.sortOrder ?? 0,
      sopInstanceUid: row.sopInstanceUid,
      isKeyImage: true,
      framing: null,
    });
  }
  return out;
}

/**
 * Print/PDF image resolution for a draft:
 * 1. If any includeInReport frozen artifacts exist → use ONLY those (disk).
 * 2. Else fall back to legacy DICOM image-references + Orthanc render.
 */
export async function resolveDraftPrintKeyImages(draftId: number): Promise<ReportKeyImageModel[]> {
  const frozen = await listDraftFrozenKeyImages(draftId);
  const printable = frozen.filter((r) => r.includeInReport);
  if (printable.length > 0) {
    return frozenRowsToPresentationModels(printable);
  }
  return resolveDraftKeyImages(draftId);
}

/** Same as resolveDraftPrintKeyImages but via final report id(s) → draft. */
export async function resolveReportPrintKeyImages(reportIds: number[]): Promise<ReportKeyImageModel[]> {
  const ids = [...new Set(reportIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  const [draft] = await db
    .select({ id: radiologyReportDraftsTable.id })
    .from(radiologyReportDraftsTable)
    .where(inArray(radiologyReportDraftsTable.finalReportId, ids))
    .orderBy(asc(radiologyReportDraftsTable.id))
    .limit(1);
  if (!draft) return [];
  return resolveDraftPrintKeyImages(draft.id);
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
