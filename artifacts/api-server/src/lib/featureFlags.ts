import { db, featureFlagsTable } from "@workspace/db";
import { getCached, setCached, invalidateCached } from "./ttlCache";

// Ticket T0.1 — server-side feature flag backbone. Backs isFeatureEnabledServer(),
// consulted by routes/featureFlags.ts and, going forward, by any Radiology
// Roadmap strand that needs to gate backend behavior (dual-write, render
// path, etc.) rather than just UI visibility.
//
// Single-process cache is safe here: care-api runs as one container with no
// horizontal scaling (see ttlCache.ts's own header), so an admin PATCH and
// the very next isFeatureEnabledServer() call in the same process always see
// the fresh value because invalidateFeatureFlagCache() runs synchronously
// before the PATCH response is sent. The TTL is only a safety net.
const CACHE_KEY = "feature-flags:all";
const CACHE_TTL_MS = 30_000;

async function loadAllFlags(): Promise<Record<string, boolean>> {
  const rows = await db.select().from(featureFlagsTable);
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
}

/**
 * Returns whether a server-side feature flag is enabled. Unknown keys
 * (not yet seeded, or a typo) default to false — never throws, never blocks
 * the caller's request.
 */
export async function isFeatureEnabledServer(key: string): Promise<boolean> {
  let flags = getCached<Record<string, boolean>>(CACHE_KEY);
  if (flags === undefined) {
    flags = await loadAllFlags();
    setCached(CACHE_KEY, flags, CACHE_TTL_MS);
  }
  return flags[key] ?? false;
}

/** Call after any write to feature_flags so the next read is fresh. */
export function invalidateFeatureFlagCache(): void {
  invalidateCached(CACHE_KEY);
}
