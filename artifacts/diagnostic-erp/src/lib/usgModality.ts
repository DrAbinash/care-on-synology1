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

/**
 * PR B follow-up — PCPNDT safety guard. Free-text study-description pattern
 * for an obstetric/fetal ultrasound: the study category the PCPNDT Act's
 * Form F compliance lock applies to. Deliberately broad/inclusive — a false
 * positive here just sends a non-obstetric study through an extra Form F
 * check unnecessarily; a false negative would let a PCPNDT-relevant study
 * finalize with no compliance check at all, which is the failure mode this
 * exists to prevent. Shared by the canonical workspace's finalize guard
 * (RadiologyReportingWorkspace.tsx) and the usg-obstetric Copilot module —
 * ONE classification, not two independently-maintained regexes.
 */
export const OBSTETRIC_USG_STUDY_PATTERN =
  /obstet|pregnan|fetal|gestation|nuchal|nt\s*scan|anomaly\s*scan|growth\s*scan|tiffa/i;

/**
 * True when a study is ultrasound AND matches the obstetric/fetal pattern —
 * i.e. a study the PCPNDT Act's Form F compliance lock applies to. This is a
 * classification helper only; it does not itself enforce anything and does
 * not duplicate the PCPNDT Form F check (that check lives solely in
 * artifacts/api-server/src/routes/usgReports.ts, the legacy compliant
 * pipeline — see docs/usg-reporting/platform-consolidation-pr-b.md §17-18).
 */
export function isObstetricUsgStudy(
  modality: string | null | undefined,
  studyDescription: string | null | undefined,
): boolean {
  if (!isUltrasoundModality(modality)) return false;
  return OBSTETRIC_USG_STUDY_PATTERN.test(studyDescription ?? "");
}
