/**
 * Client side of the guarded key-image delivery (server: `radiologyKeyImageStatic.ts`).
 *
 * A stored key image is PHI-bearing pixels, so its URL is not public. The
 * reporting workspace needs those pixels in `<img>` tags, which cannot send an
 * Authorization header — so instead of putting the staff session token in the
 * URL (long-lived, unlocks the whole session, unrelated to any one file), the
 * client asks for a short-lived grant per image and renders what comes back.
 *
 * Grants are cached for slightly less than their server-side lifetime, so a
 * rail of twelve thumbnails is one request, opening the preview modal is zero,
 * and a re-render does not re-mint.
 */
import { api } from "@/lib/fetchApi";

export const KEY_IMAGE_URL_PREFIX = "/uploads/radiology-key-images/";

export type KeyImageAccessUrls = {
  id: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  /** Epoch ms from the server's own expiry; `null` when the row is not a guarded file. */
  expiresAtMs: number | null;
};

/** Refresh a little early so a still-open workspace never shows an expired link. */
const EXPIRY_SLACK_MS = 60_000;

const cache = new Map<number, KeyImageAccessUrls>();

/** True when this URL is served by the guarded prefix and therefore needs a grant. */
export function isGuardedKeyImageUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(KEY_IMAGE_URL_PREFIX);
}

function isFresh(entry: KeyImageAccessUrls | undefined, now = Date.now()): boolean {
  if (!entry) return false;
  if (entry.expiresAtMs == null) return true; // untouched URL (DICOMweb/data:/legacy)
  return entry.expiresAtMs - EXPIRY_SLACK_MS > now;
}

/** Cached URL for one image, or `undefined` when nothing fresh is cached yet. */
export function cachedKeyImageUrls(id: number): KeyImageAccessUrls | undefined {
  const entry = cache.get(id);
  return isFresh(entry) ? entry : undefined;
}

export function invalidateKeyImageUrls(id?: number): void {
  if (id == null) cache.clear();
  else cache.delete(id);
}

type AccessResponse = {
  success: boolean;
  expiresAt?: string | null;
  items?: Array<{ id: number; imageUrl: string | null; thumbnailUrl: string | null }>;
};

/**
 * Fetch (or reuse) access URLs for a set of key-image rows. One request covers
 * the whole batch; ids already cached fresh are dropped from the call.
 * Failures are returned as an empty map — a missing grant means the caller
 * shows no image, which is the correct outcome, not a thrown error in a render.
 */
export async function fetchKeyImageAccessUrls(
  ids: number[],
  opts?: { now?: number },
): Promise<Map<number, KeyImageAccessUrls>> {
  const now = opts?.now ?? Date.now();
  const out = new Map<number, KeyImageAccessUrls>();
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return out;

  const missing: number[] = [];
  for (const id of unique) {
    const cached = cache.get(id);
    if (isFresh(cached, now)) out.set(id, cached!);
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  try {
    const res = await api.post<AccessResponse>(
      "/api/radiology/report-generator/key-images/access-urls",
      { ids: missing },
    );
    const expiresAtMs = res?.expiresAt ? Date.parse(res.expiresAt) : null;
    for (const item of res?.items ?? []) {
      const entry: KeyImageAccessUrls = {
        id: item.id,
        imageUrl: item.imageUrl ?? null,
        thumbnailUrl: item.thumbnailUrl ?? null,
        expiresAtMs: Number.isFinite(expiresAtMs) ? (expiresAtMs as number) : null,
      };
      cache.set(entry.id, entry);
      out.set(entry.id, entry);
    }
  } catch {
    // No grant, no image. The report text and the study are untouched; the rail
    // shows an empty frame rather than an unauthenticated fetch.
  }
  return out;
}
