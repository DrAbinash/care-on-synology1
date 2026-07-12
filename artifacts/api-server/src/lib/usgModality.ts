/**
 * usgModality.ts — R2.0 Canonical Ultrasound Integration (server-side).
 *
 * Mirrors artifacts/diagnostic-erp/src/lib/usgModality.ts exactly. The two
 * packages don't share a lib, so this is a deliberate, documented duplicate
 * rather than a cross-package import — keep both in sync when the alias
 * list changes. Used wherever the backend decides "is this study
 * ultrasound" (auto-extraction trigger at intake, worklist modality filter,
 * USG dashboard stats) so a PACS source sending "USG"/"Doppler"/"OB US"
 * etc. instead of the literal DICOM "US" is recognized consistently with
 * what the frontend now shows.
 */

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

export function normalizeModality(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toUpperCase();
  if (!value) return value;

  if (ULTRASOUND_MODALITY_ALIASES.includes(value)) return "US";
  if (value.includes("ULTRASOUND") || value.includes("DOPPLER") || value.includes("USG")) return "US";
  if (/^US(?:[^A-Z]|$)/.test(value)) return "US";

  return value;
}

export function isUltrasoundModality(raw: string | null | undefined): boolean {
  return normalizeModality(raw) === "US";
}
