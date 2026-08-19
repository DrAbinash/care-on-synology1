/**
 * DICOM PatientSex (0010,0040) — parse and sanitize CS values.
 * Rejects patient names or other non-coded strings that modalities sometimes echo back.
 */

export type DicomSexCode = "M" | "F" | "O";

const VALID = new Set(["M", "F", "O", "MALE", "FEMALE", "OTHER", "UNKNOWN"]);

/** True when raw looks like a DICOM sex code, not a person name or garbage. */
export function isPlausibleDicomSex(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 16) return false;
  if (/\s/.test(s)) return false;
  return VALID.has(s.toUpperCase());
}

/** Normalize to M | F | O, or null when input is blank / not a valid code. */
export function sanitizeDicomSex(raw: string | null | undefined): DicomSexCode | null {
  const s = String(raw ?? "").trim();
  if (!s || !isPlausibleDicomSex(s)) return null;
  const u = s.toUpperCase();
  if (u === "M" || u === "MALE") return "M";
  if (u === "F" || u === "FEMALE") return "F";
  return "O";
}

/** Like sanitizeDicomSex but returns "" for display fallbacks. */
export function dicomSexForDisplay(raw: string | null | undefined): string {
  return sanitizeDicomSex(raw) ?? "";
}

/** Map ERP patient.gender ("male"/"female"/…) to DICOM CS; never guess from names. */
export function genderToDicomSex(gender: string | null | undefined): DicomSexCode | null {
  return sanitizeDicomSex(gender);
}
