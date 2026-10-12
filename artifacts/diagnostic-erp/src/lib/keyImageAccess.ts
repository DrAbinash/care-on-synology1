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

/**
 * One POST per image, however many components ask for it at the same moment.
 *
 * Three places read the same rail (`useWorkspaceClinicalUi` twice and the rail
 * itself), and each thumbnail is its own component that asks for just itself.
 * React runs a child's effect before its parent's, so the first render of a
 * study with four images issued four single-id POSTs and then the rail's own
 * whole-batch POST — 5 requests measured inside one 3.1 s mount, in a workspace
 * whose total budget is 300 requests per minute per IP. The cache can only
 * dedupe *after* a response lands, so what is needed is a collection window:
 * every id asked for in this tick is sent in one request, and every asker gets
 * its slice of that one answer.
 */
type Grant = KeyImageAccessUrls | null;
type Pending = { promise: Promise<Grant>; resolve: (grant: Grant) => void };

const inFlight = new Map<number, Pending>();
const collecting = new Set<number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function deferred(): Pending {
  let resolve!: (grant: Grant) => void;
  const promise = new Promise<Grant>((res) => { resolve = res; });
  return { promise, resolve };
}

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
  // Only the settled cache. A grant already on its way is still valid data, and
  // the caller awaiting it must be resolved — dropping its registration here
  // would leave that thumbnail waiting for an answer nobody owes it.
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

  const awaited: Array<[number, Promise<Grant>]> = [];
  for (const id of unique) {
    const cached = cache.get(id);
    if (isFresh(cached, now)) {
      out.set(id, cached!);
      continue;
    }
    let pending = inFlight.get(id);
    if (!pending) {
      pending = deferred();
      inFlight.set(id, pending);
      collecting.add(id);
      scheduleFlush();
    }
    awaited.push([id, pending.promise]);
  }

  const grants = await Promise.all(awaited.map(([, promise]) => promise));
  awaited.forEach(([id], index) => {
    const grant = grants[index];
    if (grant) out.set(id, grant);
  });
  return out;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  // A macrotask: every effect of the current render must have had its chance to
  // ask before the request leaves, or the tiles and the rail send two requests
  // for the same four images.
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 0);
}

async function flush(): Promise<void> {
  const ids = [...collecting];
  collecting.clear();
  const got = new Map<number, KeyImageAccessUrls>();
  try {
    const res = await api.post<AccessResponse>(
      "/api/radiology/report-generator/key-images/access-urls",
      { ids },
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
      got.set(entry.id, entry);
    }
  } catch {
    // No grant, no image. The report text and the study are untouched; the rail
    // shows an empty frame rather than an unauthenticated fetch.
  }
  // Unregister before resolving, so a caller that reacts to the grant by asking
  // again (a thumbnail that just loaded) is free to re-mint rather than being
  // handed the answer that is already on its way.
  for (const id of ids) {
    const pending = inFlight.get(id);
    if (!pending) continue;
    inFlight.delete(id);
    pending.resolve(got.get(id) ?? null);
  }
}
