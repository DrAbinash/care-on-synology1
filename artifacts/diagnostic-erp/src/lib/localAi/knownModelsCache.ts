/**
 * Client-side cache for Ollama /api/tags model discovery (Local AI settings).
 * Sticky clinic_settings.ollamaKnownModels remains the durable backup;
 * this cache avoids hammering Ollama on every Local AI page open.
 */

export const KNOWN_MODELS_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const KNOWN_MODELS_CACHE_KEY = "care.localAi.knownModels.v1";

export type KnownModelsCacheEntry = {
  endpoint: string;
  models: string[];
  /** Unix ms when models were last successfully fetched from Ollama. */
  fetchedAt: number;
  /** Models preserved across refresh (composer/vision/manual tags not in /api/tags). */
  preserved?: string[];
};

export function normalizeEndpointKey(endpoint: string): string {
  return (endpoint || "").trim().replace(/\/$/, "").toLowerCase();
}

export function readKnownModelsCache(endpoint: string): KnownModelsCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KNOWN_MODELS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KnownModelsCacheEntry;
    if (!parsed || typeof parsed !== "object") return null;
    if (normalizeEndpointKey(parsed.endpoint) !== normalizeEndpointKey(endpoint)) return null;
    if (!Array.isArray(parsed.models)) return null;
    if (typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeKnownModelsCache(entry: KnownModelsCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KNOWN_MODELS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore quota */
  }
}

export function isKnownModelsCacheFresh(
  entry: KnownModelsCacheEntry | null,
  now = Date.now(),
  ttlMs = KNOWN_MODELS_CACHE_TTL_MS,
): boolean {
  if (!entry) return false;
  return now - entry.fetchedAt < ttlMs;
}

/** Merge discovered tags with pinned/manual models so cloud tags are not wiped. */
export function mergeDiscoveredModels(
  discovered: string[],
  preserve: Array<string | null | undefined>,
): string[] {
  const out = new Set<string>();
  for (const m of discovered) {
    const t = (m ?? "").trim();
    if (t) out.add(t);
  }
  for (const m of preserve) {
    const t = (m ?? "").trim();
    if (t) out.add(t);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export function cacheAgeLabel(fetchedAt: number, now = Date.now()): string {
  const ageMs = Math.max(0, now - fetchedAt);
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
