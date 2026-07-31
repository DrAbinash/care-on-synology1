/**
 * Map worklist / DICOM modality codes to structured-template catalog codes.
 * Worklist uses short forms ("MR", "US"); template rows use "MRI", "USG", etc.
 */
export function templateCatalogModality(raw: string | null | undefined): string {
  const u = (raw || "").toUpperCase().trim();
  if (u === "MR" || u === "MRI") return "MRI";
  if (u === "US" || u === "USG" || u === "USE") return "USG";
  if (u === "XR" || u === "XRAY" || u === "X-RAY") return "X-RAY";
  return u;
}

export function templateModalityMatches(
  studyModality: string | null | undefined,
  catalogModality: string | null | undefined,
): boolean {
  if (!studyModality || !catalogModality) return false;
  return templateCatalogModality(studyModality) === templateCatalogModality(catalogModality);
}
