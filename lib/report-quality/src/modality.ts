// modality.ts — the single canonical modality normalizer.
//
// The platform has three inconsistent modality vocabularies (per the audit):
//   - DICOM/PACS codes:  MR, CT, US, CR, DX, MG, NM, PT
//   - draft/template:    MRI, CT, USG, X-RAY
//   - template families: CT_BRAIN, MRI_SPINE, …
// Rules declare their scope in ONE canonical vocabulary; the runner maps every
// raw value through here before matching. This supersedes the scattered
// per-feature normalizers (e.g. usgModality.normalizeModality); later phases
// migrate those callers onto this one.

export type CanonicalModality =
  | "MR"
  | "CT"
  | "US"
  | "XR"
  | "MG"
  | "NM"
  | "PT"
  | "OTHER";

/** Map any raw modality/study string to a canonical code. */
export function normalizeModality(raw: string | null | undefined): CanonicalModality {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return "OTHER";

  // Order matters: check the more specific / longer tokens first.
  if (s.startsWith("MR") || s.includes("MAGNETIC RESONANCE")) return "MR";
  if (s.startsWith("CT") || s.includes("COMPUTED TOMOGRAPH") || s.includes("CECT") || s.includes("NCCT")) return "CT";
  if (
    s.startsWith("US") ||
    s.startsWith("USG") ||
    s.includes("ULTRASOUND") ||
    s.includes("SONOGRAP") ||
    s.includes("DOPPLER")
  ) {
    return "US";
  }
  if (s.startsWith("MG") || s.includes("MAMMOGRAP")) return "MG";
  if (
    s.startsWith("XR") ||
    s.startsWith("X-RAY") ||
    s.startsWith("XRAY") ||
    s.startsWith("CR") ||
    s.startsWith("DX") ||
    s.includes("RADIOGRAPH")
  ) {
    return "XR";
  }
  if (s.startsWith("PT") || s.includes("PET")) return "PT";
  if (s.startsWith("NM") || s.includes("NUCLEAR")) return "NM";
  return "OTHER";
}

/** Does a rule's declared scope apply to this (already-canonical) modality? */
export function modalityMatches(
  ruleModalities: "*" | string[],
  canonical: CanonicalModality,
): boolean {
  if (ruleModalities === "*") return true;
  return ruleModalities.some((m) => normalizeModality(m) === canonical);
}
