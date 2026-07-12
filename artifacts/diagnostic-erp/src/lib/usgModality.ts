/**
 * usgModality.ts — R2.0 Canonical Ultrasound Integration.
 *
 * PACS/DICOM sources send whatever free-text (or vendor-abbreviated) string
 * a modality is configured with — "US", "USG", "Doppler", "OB US",
 * "Fetal US", etc. RadiologyWorklist.tsx's MODALITY_OPTIONS filter only has
 * ONE ultrasound bucket, "US" (see MODALITY_OPTIONS, ~line 129), and the
 * comparison against entry.modality was previously exact string equality —
 * so any non-"US" spelling silently failed the "US" filter and the study
 * looked like it belonged to a phantom separate worklist.
 *
 * This module is deliberately zero-dependency (no React, no @/lib/fetchApi)
 * so it's unit-testable under the root vitest config with no path-alias
 * resolution needed — same reasoning as lib/radiologyDraftId.ts /
 * lib/quickFindingsMerge.ts.
 */

// Reasonably complete case-insensitive alias list for ultrasound / Doppler /
// obstetric-ultrasound modality spellings seen from PACS/DICOM sources.
// Comparison is done against the trimmed+uppercased raw value, so list
// entries here in already-uppercase form.
export const ULTRASOUND_MODALITY_ALIASES: string[] = [
  "US",
  "USG",
  "US-DOPPLER",
  "USDOPPLER",
  "DOPPLER",
  "OB US",
  "OB-US",
  "OBUS",
  "FETAL US",
  "FETAL-US",
  "4D US",
  "3D US",
  "US/DOPPLER",
  "COLOR DOPPLER",
  "ULTRASOUND",
];

/**
 * Normalizes a raw modality string. Returns "US" when the value is a known
 * ultrasound/Doppler alias (exact match), contains "ULTRASOUND", "DOPPLER",
 * or "USG" as a substring, or starts with "US" followed by a non-letter or
 * end-of-string (e.g. "US ABDOMEN", "US-PELVIS") — the trailing boundary
 * check exists specifically so words like "USER" don't false-match.
 * Anything else is returned trimmed + uppercased, unchanged otherwise.
 */
export function normalizeModality(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toUpperCase();
  if (!value) return value;

  if (ULTRASOUND_MODALITY_ALIASES.includes(value)) return "US";
  if (value.includes("ULTRASOUND") || value.includes("DOPPLER") || value.includes("USG")) return "US";
  if (/^US(?:[^A-Z]|$)/.test(value)) return "US";

  return value;
}

/** True when the raw modality string normalizes to the "US" bucket. */
export function isUltrasoundModality(raw: string | null | undefined): boolean {
  return normalizeModality(raw) === "US";
}
