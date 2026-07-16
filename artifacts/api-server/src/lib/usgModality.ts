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

/**
 * PCPNDT server-side finalize guard (see routes/patient-reports.ts and
 * routes/internal-radiology.ts). Mirrors the frontend's
 * artifacts/diagnostic-erp/src/lib/usgModality.ts#isObstetricUsgStudy
 * exactly — same reasoning as the rest of this file's header comment: the
 * two packages don't share a lib, so this is a deliberate, documented
 * duplicate of the CLASSIFICATION only, not of the PCPNDT Form F check
 * itself (that check lives solely in routes/usgReports.ts, the legacy
 * compliant pipeline). Deliberately broad/inclusive — a false positive here
 * just routes a non-obstetric study through an extra compliance check
 * unnecessarily; a false negative would let a PCPNDT-relevant study
 * finalize with zero compliance check, which is the failure mode this
 * exists to prevent.
 */
export const OBSTETRIC_USG_STUDY_PATTERN =
  /obstet|pregnan|fetal|gestation|nuchal|nt\s*scan|anomaly\s*scan|growth\s*scan|tiffa/i;

export function isObstetricUsgStudy(
  modality: string | null | undefined,
  studyDescription: string | null | undefined,
): boolean {
  if (!isUltrasoundModality(modality)) return false;
  return OBSTETRIC_USG_STUDY_PATTERN.test(studyDescription ?? "");
}
