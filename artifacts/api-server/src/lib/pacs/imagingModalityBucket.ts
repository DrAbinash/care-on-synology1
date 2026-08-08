/** Display buckets for billed-vs-PACS reconciliation on Daily Summary. */
export const IMAGING_BUCKETS = ["MRI", "USG", "CT", "X-Ray", "OPG"] as const;
export type ImagingBucket = (typeof IMAGING_BUCKETS)[number];

/** Primary modalities shown on the Daily Summary billed report. */
export const MODALITY_REPORT_KEYS = ["MRI", "CT", "USG", "X-Ray"] as const;
export type ModalityReportKey = (typeof MODALITY_REPORT_KEYS)[number];

export const MODALITY_DISPLAY_LABEL: Record<ImagingBucket, string> = {
  MRI: "MRI",
  CT: "CT Scan",
  USG: "USG",
  "X-Ray": "X-Ray",
  OPG: "OPG",
};

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
  // Catalog seeds department as "CT Scan"; DICOM / older maps use "CT".
  if (mod === "CT" || dept === "CT" || dept === "CT SCAN" || dept.includes("CT SCAN") || dept.startsWith("CT ")) {
    return "CT";
  }
  if (
    mod === "CR" || mod === "DX" || mod === "XR" ||
    dept === "X-RAY" || dept === "XRAY" || dept === "X RAY" ||
    dept.includes("X-RAY") || dept.includes("XRAY")
  ) {
    return "X-Ray";
  }

  return null;
}

/** Parse API / UI modality query into a known imaging bucket. */
export function resolveModalityQuery(raw: string | undefined | null): ImagingBucket | null {
  if (!raw) return null;
  const n = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (n === "MRI") return "MRI";
  if (n === "USG" || n === "ULTRASOUND") return "USG";
  if (n === "CT" || n === "CT SCAN" || n === "CTSCAN") return "CT";
  if (n === "X-RAY" || n === "XRAY" || n === "X RAY") return "X-Ray";
  if (n === "OPG") return "OPG";
  return null;
}

export function emptyBucketCounts(): Record<ImagingBucket, number> {
  return { MRI: 0, USG: 0, CT: 0, "X-Ray": 0, OPG: 0 };
}
