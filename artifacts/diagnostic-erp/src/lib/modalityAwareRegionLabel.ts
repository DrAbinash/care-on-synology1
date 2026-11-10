/**
 * modalityAwareRegionLabel.ts — P3-1.
 *
 * The composer's "Region:" label used to hard-code the "MRI " prefix for brain
 * and spine families regardless of what was actually scanned: a CT spine study
 * told the composer (and the AI input preview) it was an "MRI Dorsal Spine".
 * This pure function derives the prefix from the study's own modality and
 * keeps the historical label for every MRI study, so existing composer inputs
 * are byte-identical and only the mislabelled modalities change.
 */

export type ModalityAwareRegionInput = {
  /** The study's modality tag (DICOM vocabulary: MR, CT, US, XR, …). */
  modality?: string | null;
  family?: string | null;
  spineSegment?: string | null;
  region?: string | null;
  matchedStudyRegion?: string | null;
  studyRegions?: Array<string | null | undefined>;
};

/**
 * The label prefix a modality earns, or null when the modality is not one this
 * clinic names regions for (no prefix is invented for an unknown modality).
 * An ABSENT modality keeps the historical "MRI" default: the reporting
 * workspace's spine/brain families are MRI studies unless a row says otherwise.
 */
export function modalityLabelPrefix(modality: string | null | undefined): string | null {
  const m = (modality ?? "").trim().toUpperCase();
  if (!m) return "MRI";
  if (m === "MR" || m === "MRI") return "MRI";
  if (m === "CT") return "CT";
  if (m === "US" || m === "USG" || m === "ULTRASOUND") return "USG";
  if (m === "XR" || m === "CR" || m === "DX" || m === "XRAY" || m === "X-RAY") return "X-Ray";
  return null;
}

/** The region label the composer shows, derived from the study's own facts. */
export function modalityAwareRegionLabel(input: ModalityAwareRegionInput): string {
  const family = (input.family ?? "").toLowerCase();
  const segment = (input.spineSegment ?? "").toLowerCase();
  const prefix = modalityLabelPrefix(input.modality);
  const named = (base: string) => (prefix ? `${prefix} ${base}` : base);
  if (family === "brain") return named("Brain");
  if (family === "spine") {
    if (segment === "cervical") return named("Cervical Spine");
    if (segment === "dorsal") return named("Dorsal Spine");
    if (segment === "lumbar") return named("Lumbosacral Spine");
    // A Dorso-Lumbar booking is its own examination; naming it just "Spine"
    // would hand the composer a region no study was billed for.
    if (segment === "dorsolumbar") return named("Dorso-Lumbar Spine");
    return named("Spine");
  }
  return (
    input.region?.trim()
    || input.matchedStudyRegion?.trim()
    || input.studyRegions?.find((r) => (r ?? "").trim())?.trim()
    || "Unknown region"
  );
}
