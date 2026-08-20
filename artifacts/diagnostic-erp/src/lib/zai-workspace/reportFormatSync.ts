/**
 * Pure helpers for whole-report format localStorage → server migration.
 * No I/O — unit-tested; used by report-formats-library + migrate API client.
 */

export type FormatIdentity = {
  name: string;
  modality: string;
  bodyPart: string;
};

export function formatDedupeKey(f: FormatIdentity): string {
  return `${f.name.trim().toLowerCase()}|${f.modality.trim().toLowerCase()}|${f.bodyPart.trim().toLowerCase()}`;
}

/** Formats present locally but not on server (by name+modality+bodyPart). */
export function formatsMissingOnServer<T extends FormatIdentity>(
  local: T[],
  server: FormatIdentity[],
): T[] {
  const seen = new Set(server.map(formatDedupeKey));
  return local.filter((f) => f.name.trim() && !seen.has(formatDedupeKey(f)));
}

/**
 * After server becomes authoritative, cache may hold browser-only ids.
 * Prefer server list; keep local-only rows only when offlineFallback=true.
 */
export function mergeAuthoritativeFormats<T extends FormatIdentity & { id: string }>(
  server: T[],
  localCache: T[],
  opts?: { offlineFallback?: boolean },
): T[] {
  if (server.length > 0) return server.map((f) => ({ ...f }));
  if (opts?.offlineFallback) return localCache.map((f) => ({ ...f }));
  return [];
}
