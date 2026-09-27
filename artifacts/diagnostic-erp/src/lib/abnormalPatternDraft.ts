/**
 * Draft markers for applied abnormal patterns.
 * Mirrors extractLinkedStudyFromStructuredJson: additive structuredJson key,
 * never a new route. A stored marker keeps the version captured at apply time.
 */

export type AppliedPatternMarker = {
  patternId: string;
  version: number;
  bundleId: string;
  appliedAt: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseMarker(raw: unknown): AppliedPatternMarker | null {
  if (!isRecord(raw)) return null;
  const patternId = typeof raw.patternId === "string" ? raw.patternId.trim() : "";
  const bundleId = typeof raw.bundleId === "string" ? raw.bundleId.trim() : "";
  const appliedAt = typeof raw.appliedAt === "string" ? raw.appliedAt.trim() : "";
  const version = typeof raw.version === "number" ? raw.version : Number.NaN;
  if (!patternId || !bundleId || !appliedAt || !Number.isInteger(version) || version < 1) return null;
  return { patternId, version, bundleId, appliedAt };
}

/** Read careAppliedPatterns from a draft envelope. Unknown shapes → []. */
export function extractAppliedPatternsFromStructuredJson(column: unknown): AppliedPatternMarker[] {
  if (!isRecord(column)) return [];
  const raw = column.careAppliedPatterns;
  if (!Array.isArray(raw)) return [];
  const out: AppliedPatternMarker[] = [];
  for (const item of raw) {
    const marker = parseMarker(item);
    if (marker) out.push(marker);
  }
  return out;
}

export function appliedPatternMarker(pattern: { id: string; version: number }, appliedAt = new Date().toISOString()): AppliedPatternMarker {
  return {
    patternId: pattern.id,
    version: pattern.version,
    bundleId: `pattern-${pattern.id}-v${pattern.version}`,
    appliedAt,
  };
}

/** Replace the marker for the same pattern id. Does not rewrite other markers' versions. */
export function upsertAppliedPatternMarker(
  existing: readonly AppliedPatternMarker[],
  marker: AppliedPatternMarker,
): AppliedPatternMarker[] {
  return [...existing.filter((m) => m.patternId !== marker.patternId), marker];
}

/**
 * Library version bumps must not mutate a marker already stored on the draft.
 * Returns the original marker object unchanged.
 */
export function storedMarkerAfterLibraryVersionBump(
  marker: AppliedPatternMarker,
  _nextLibraryVersion: number,
): AppliedPatternMarker {
  return marker;
}
