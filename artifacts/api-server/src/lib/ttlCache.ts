/**
 * ttlCache.ts — tiny reusable short-TTL in-memory cache.
 *
 * Purpose: avoid re-querying Postgres for data that barely changes
 * (clinic settings, doctors list, test/tariff master, departments, etc.)
 * on every single page load / dropdown fetch, while still auto-expiring
 * so edits show up quickly without needing a manual cache-bust anywhere
 * that isn't already covered.
 *
 * This is intentionally simple and process-local (no Redis):
 *   - Care ERP runs as a single `care-api` container on the Synology NAS
 *     (see docker-compose.yml — no horizontal scaling), so a per-process
 *     cache is coherent across all requests.
 *   - Values live only in memory and vanish on container restart —
 *     exactly like requestMetrics.ts's diagnostics buffer. No new
 *     infrastructure, no migration, nothing to configure.
 *
 * NOT for: patient records, bills, payments, orders, or any per-record
 * transactional data — those must always read live. This cache is only
 * ever applied to whole-table "reference/settings" reads.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Returns the cached value for `key` if present and not expired.
 * Callers should JSON.parse/stringify or clone as needed if they intend
 * to mutate the returned value — this cache returns the same reference.
 */
export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Deletes one key (e.g. after a create/update/delete mutation). */
export function invalidateCached(key: string): void {
  store.delete(key);
}

/** Deletes every key starting with `prefix` — used when a mutation should
 *  invalidate several cached variants at once (e.g. all cached search
 *  results for a list endpoint, keyed "doctors:list:<querystring>"). */
export function invalidateCachedPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Wraps an async loader with cache-aside behavior:
 *   cached ? return cached : load(), cache it, return it.
 */
export async function withCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== undefined) return cached;
  const fresh = await loader();
  setCached(key, fresh, ttlMs);
  return fresh;
}

// Common TTL presets (ms) — pick one per the "how often does this change"
// judgment call for each endpoint, matching the 5-15 min guidance.
export const TTL = {
  SHORT: 5 * 60_000,   // 5 min  — settings, doctors, tests/tariff
  MEDIUM: 10 * 60_000, // 10 min — departments, rooms, roles/permissions
  LONG: 15 * 60_000,   // 15 min — rarely-changing config (sidebar/menu)
} as const;
