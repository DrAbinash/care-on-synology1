/**
 * Impression stale-banner policy.
 * Manual radiologist edits keep the banner. Auto-derived provenance
 * (quick-select, system normal, templates) is refreshed silently.
 * Stored manual edits use source "manual"; "radiologist-manual" is accepted
 * as the same ownership.
 */

const RADIOLOGIST_MANUAL_SOURCES = new Set([
  "manual",
  "radiologist-manual",
  "radiologist-voice",
]);

export function impressionProvenanceIsRadiologistManual(
  provenance: Readonly<Record<string, readonly string[] | undefined>> | null | undefined,
): boolean {
  if (!provenance) return false;
  for (const sources of Object.values(provenance)) {
    if (!sources) continue;
    for (const source of sources) {
      if (RADIOLOGIST_MANUAL_SOURCES.has(source)) return true;
    }
  }
  return false;
}
