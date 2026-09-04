/**
 * Reading-queue modality deep-link resolution for Reporting Workspace.
 * Reuses normalizeModality; invalid/ambiguous values fall back safely —
 * never invent a modality that is not in the queue selector.
 */
import { normalizeModality } from "@/lib/usgModality";

/** Values accepted by WorklistStrip's queue modality <select>. */
export const READING_QUEUE_MODALITY_OPTIONS = [
  "MR",
  "CT",
  "XR",
  "US",
  "all",
] as const;

export type ReadingQueueModality = (typeof READING_QUEUE_MODALITY_OPTIONS)[number];

export const READING_QUEUE_MODALITY_STORAGE_KEY = "care_reading_queue_modality";

const OPTION_SET = new Set<string>(READING_QUEUE_MODALITY_OPTIONS);

export function isReadingQueueModality(value: string): value is ReadingQueueModality {
  return OPTION_SET.has(value);
}

/**
 * Map a raw URL modality (MR|CT|XR|USG|…) to a queue option.
 * Returns null when the value is missing, empty, or not a known queue choice
 * after normalization (caller must fall back — no guessing).
 */
export function readingQueueModalityFromParam(
  raw: string | null | undefined,
): ReadingQueueModality | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const normalized = normalizeModality(trimmed);
  if (!normalized) return null;
  // normalizeModality maps USG/Doppler → "US"; leave MR/CT/XR/all alone.
  if (isReadingQueueModality(normalized)) return normalized;
  // Ambiguous leftovers (e.g. "OT", "NM", free text) — refuse.
  return null;
}

export function readStoredReadingQueueModality(
  storage: Pick<Storage, "getItem"> | null | undefined,
  fallback: ReadingQueueModality = "MR",
): ReadingQueueModality {
  try {
    const v = storage?.getItem(READING_QUEUE_MODALITY_STORAGE_KEY);
    if (v && isReadingQueueModality(v)) return v;
  } catch {
    /* private mode */
  }
  return fallback;
}

export function writeStoredReadingQueueModality(
  storage: Pick<Storage, "setItem"> | null | undefined,
  value: ReadingQueueModality,
): void {
  try {
    storage?.setItem(READING_QUEUE_MODALITY_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve initial/updated queue modality from URL search + storage.
 * Deep-link wins when valid; otherwise stored preference; otherwise "MR".
 */
export function resolveReadingQueueModality(opts: {
  search: string;
  storage?: Pick<Storage, "getItem"> | null;
  fallback?: ReadingQueueModality;
}): { modality: ReadingQueueModality; fromDeepLink: boolean } {
  const params = new URLSearchParams(
    opts.search.startsWith("?") ? opts.search.slice(1) : opts.search,
  );
  const fromUrl = readingQueueModalityFromParam(params.get("modality"));
  if (fromUrl) return { modality: fromUrl, fromDeepLink: true };
  return {
    modality: readStoredReadingQueueModality(opts.storage ?? null, opts.fallback ?? "MR"),
    fromDeepLink: false,
  };
}
