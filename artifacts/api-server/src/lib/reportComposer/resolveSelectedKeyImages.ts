/**
 * Secure resolution of frozen key images for SELECTED_IMAGES compose mode.
 * Never trusts client URLs; never logs image bytes.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import { radiologyReportKeyImagesTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  COMPOSER_MAX_SELECTED_KEY_IMAGES,
  type ComposerInputSnapshot,
  type SelectedKeyImageRef,
} from "./types";
import {
  isSafeKeyImageFilename,
  resolveKeyImageDiskPath,
  FROZEN_KEY_IMAGE_URL_PREFIX,
} from "../frozenKeyImages";

export const COMPOSER_MAX_IMAGE_BYTES = 2_500_000;
export const COMPOSER_MAX_TOTAL_IMAGE_BYTES = 8_000_000;

export type ResolvedComposeImage = {
  keyImageId: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Raw base64 without data: prefix — for Ollama message.images only. */
  base64: string;
  bytes: number;
  observationId: string | null;
  caption: string;
};

export type ResolveComposeImagesResult =
  | {
      ok: true;
      images: ResolvedComposeImage[];
      selectedKeyImageIds: number[];
      linkedObservationIds: string[];
    }
  | {
      ok: false;
      safeError: string;
      detail?: string;
      selectedKeyImageIds: number[];
    };

function mimeFromFilename(name: string): "image/jpeg" | "image/png" | "image/webp" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

/**
 * Resolve and load selected frozen key images for a compose job.
 * Re-validates ownership against draftId / studyId / worklist linkage via draftId on rows.
 */
export async function resolveSelectedKeyImagesForCompose(opts: {
  snapshot: ComposerInputSnapshot;
  draftId?: number | null;
}): Promise<ResolveComposeImagesResult> {
  const refs = opts.snapshot.selectedKeyImages ?? [];
  const ids = refs.map((r) => r.keyImageId);
  const selectedKeyImageIds = [...ids];

  if (ids.length === 0) {
    return {
      ok: false,
      safeError: "selected_images_empty",
      detail: "SELECTED_IMAGES mode requires at least one selected key image.",
      selectedKeyImageIds,
    };
  }
  if (ids.length > COMPOSER_MAX_SELECTED_KEY_IMAGES) {
    return {
      ok: false,
      safeError: "selected_images_limit",
      detail: `At most ${COMPOSER_MAX_SELECTED_KEY_IMAGES} key images may be selected.`,
      selectedKeyImageIds,
    };
  }
  if (new Set(ids).size !== ids.length) {
    return {
      ok: false,
      safeError: "selected_images_duplicate",
      detail: "Duplicate key image IDs are not allowed.",
      selectedKeyImageIds,
    };
  }

  const rows = await db
    .select()
    .from(radiologyReportKeyImagesTable)
    .where(inArray(radiologyReportKeyImagesTable.id, ids));

  if (rows.length !== ids.length) {
    return {
      ok: false,
      safeError: "selected_images_unresolved",
      detail: "One or more selected key images were not found.",
      selectedKeyImageIds,
    };
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const studyId = opts.snapshot.studyId ?? null;
  const draftId = opts.draftId ?? null;

  const images: ResolvedComposeImage[] = [];
  const linkedObservationIds: string[] = [];
  let totalBytes = 0;

  for (const ref of refs) {
    const row = byId.get(ref.keyImageId);
    if (!row) {
      return {
        ok: false,
        safeError: "selected_images_unresolved",
        selectedKeyImageIds,
      };
    }

    // Ownership: must match study and/or draft from the frozen snapshot context.
    if (studyId != null && row.studyId != null && row.studyId !== studyId) {
      return {
        ok: false,
        safeError: "selected_images_cross_study",
        detail: "Selected key image does not belong to this study.",
        selectedKeyImageIds,
      };
    }
    if (draftId != null && row.draftId != null && row.draftId !== draftId) {
      return {
        ok: false,
        safeError: "selected_images_cross_draft",
        detail: "Selected key image does not belong to this draft.",
        selectedKeyImageIds,
      };
    }

    const abs = resolveKeyImageDiskPath(row.imageUrl);
    if (!abs) {
      return {
        ok: false,
        safeError: "selected_images_path_rejected",
        detail: "Key image path failed safety checks.",
        selectedKeyImageIds,
      };
    }
    const base = path.basename(abs);
    if (!isSafeKeyImageFilename(base) || !abs.includes("radiology-key-images")) {
      return {
        ok: false,
        safeError: "selected_images_path_rejected",
        selectedKeyImageIds,
      };
    }
    const mime = mimeFromFilename(base);
    if (!mime) {
      return {
        ok: false,
        safeError: "selected_images_mime",
        detail: "Unsupported key image MIME type.",
        selectedKeyImageIds,
      };
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      return {
        ok: false,
        safeError: "selected_images_unreadable",
        detail: "Selected key image file is missing or unreadable.",
        selectedKeyImageIds,
      };
    }
    if (buf.byteLength <= 0 || buf.byteLength > COMPOSER_MAX_IMAGE_BYTES) {
      return {
        ok: false,
        safeError: "selected_images_size",
        detail: "Selected key image exceeds per-image size limit.",
        selectedKeyImageIds,
      };
    }
    totalBytes += buf.byteLength;
    if (totalBytes > COMPOSER_MAX_TOTAL_IMAGE_BYTES) {
      return {
        ok: false,
        safeError: "selected_images_total_size",
        detail: "Total selected key image bytes exceed limit.",
        selectedKeyImageIds,
      };
    }

    const obsId = row.observationId ?? ref.observationId ?? null;
    if (obsId) linkedObservationIds.push(obsId);

    images.push({
      keyImageId: row.id,
      mimeType: mime,
      base64: buf.toString("base64"),
      bytes: buf.byteLength,
      observationId: obsId,
      caption: (ref.caption ?? row.caption ?? "").trim(),
    });
  }

  return {
    ok: true,
    images,
    selectedKeyImageIds,
    linkedObservationIds: [...new Set(linkedObservationIds)],
  };
}

/** Pure helpers exported for unit tests (no DB). */
export function assertSelectedKeyImageRefsSafe(refs: SelectedKeyImageRef[]): string | null {
  if (refs.length > COMPOSER_MAX_SELECTED_KEY_IMAGES) return "selected_images_limit";
  const ids = refs.map((r) => r.keyImageId);
  if (new Set(ids).size !== ids.length) return "selected_images_duplicate";
  for (const r of refs) {
    if (!Number.isFinite(r.keyImageId) || r.keyImageId <= 0) return "selected_images_invalid_id";
  }
  return null;
}

export function isComposerKeyImageUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith(FROZEN_KEY_IMAGE_URL_PREFIX);
}
