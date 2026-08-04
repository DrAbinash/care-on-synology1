/** Display buckets for billed-vs-PACS reconciliation on Daily Summary. */
export const IMAGING_BUCKETS = ["MRI", "USG", "CT", "X-Ray", "OPG"] as const;
export type ImagingBucket = (typeof IMAGING_BUCKETS)[number];

export type ImagingBucketInput = {
  modality?: string | null;
  department?: string | null;
  studyDescription?: string | null;
  testName?: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

function haystack(input: ImagingBucketInput): string {
  return [input.modality, input.department, input.studyDescription, input.testName]
    .map(norm)
    .filter(Boolean)
    .join(" ");
}

/** OPG is often filed under X-Ray department with CR modality. */
function isOpg(input: ImagingBucketInput): boolean {
  const h = haystack(input);
  return /\bOPG\b/.test(h) || h.includes("ORTHOPANTOM") || h.includes("PANORAM");
}

/**
 * Map a billed study or PACS worklist row into MRI / USG / CT / X-Ray / OPG.
 * Returns null when the row is not an imaging modality we track.
 */
export function classifyImagingBucket(input: ImagingBucketInput): ImagingBucket | null {
  if (isOpg(input)) return "OPG";

  const mod = norm(input.modality);
  const dept = norm(input.department);

  if (mod === "MR" || dept === "MRI" || dept.includes("MRI")) return "MRI";
  if (mod === "US" || mod === "USG" || dept === "USG" || dept.includes("ULTRASOUND")) return "USG";
  if (mod === "CT" || dept === "CT") return "CT";
  if (mod === "CR" || mod === "DX" || mod === "XR" || dept === "X-RAY" || dept === "XRAY" || dept.includes("X-RAY")) {
    return "X-Ray";
  }

  return null;
}

export function emptyBucketCounts(): Record<ImagingBucket, number> {
  return { MRI: 0, USG: 0, CT: 0, "X-Ray": 0, OPG: 0 };
}
