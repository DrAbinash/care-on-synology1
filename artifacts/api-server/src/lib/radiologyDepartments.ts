/**
 * radiologyDepartments.ts — ONE place that decides whether a catalog
 * department belongs to the radiology workflow, and which canonical name it
 * answers to.
 *
 * The study fan-out (radiology.ts generateStudiesForOrder) used to match the
 * department against an exact list — byte-identical keys only. A catalog row
 * imported as "x-ray " or "Mri" (CSV imports, legacy free text) was SILENTLY
 * skipped: the bill saved, the patient paid, and no radiology_studies row —
 * and no MWL file — ever existed. The safety net (reconcileMissingStudies)
 * filtered with the same exact list, so such rows were never reconciled
 * either. Trimming and case-folding here closes both doors at once, and the
 * tests-catalog routes reuse the same canonicalization so entries are stored
 * clean at the source.
 */

/** The departments that map to a radiology workflow + their DICOM modality codes. */
export const RADIOLOGY_MODALITY_MAP: Record<string, string> = {
  "X-Ray": "CR",
  USG: "US",
  MRI: "MR",
  CT: "CT",
  Mammography: "MG",
  DEXA: "BMD",
};

/** The exact spellings a human (or a CSV) actually produces for these keys. */
const DEPARTMENT_ALIASES: Record<string, string> = {
  xray: "X-Ray",
  "x ray": "X-Ray",
  "x-ray": "X-Ray",
  x_ray: "X-Ray",
  usg: "USG",
  "u s g": "USG",
  mri: "MRI",
  ct: "CT",
  mammography: "Mammography",
  "mammo": "Mammography",
  dexa: "DEXA",
  "dexa scan": "DEXA",
  "bmd": "DEXA",
};

/**
 * Every raw spelling an SQL `IN` needs to catch for reconciliation: the
 * canonical keys, their lowercase forms, and the known aliases. The reconcile
 * safety net used to filter with the canonical keys alone, so a catalog row
 * stored as "x-ray " (skipped by the fan-out with the SAME exact list) was
 * never reconciled either — a bill with no study, forever.
 */
export const RADIOLOGY_DEPARTMENT_SQL_VARIANTS: string[] = [
  ...Object.keys(RADIOLOGY_MODALITY_MAP),
  ...Object.keys(RADIOLOGY_MODALITY_MAP).map((d) => d.toLowerCase()),
  ...Object.keys(DEPARTMENT_ALIASES),
];

/**
 * The canonical department name, or null when the department is not part of
 * the radiology workflow. Trimmed and case-insensitive; recognized aliases
 * ("XRay", "x ray") resolve to their canonical spelling.
 */
export function canonicalRadiologyDepartment(department: string | null | undefined): string | null {
  const trimmed = (department ?? "").trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  const canonicalKey = Object.keys(RADIOLOGY_MODALITY_MAP).find((k) => k.toLowerCase() === key);
  if (canonicalKey) return canonicalKey;
  const aliased = DEPARTMENT_ALIASES[key];
  if (aliased) return aliased;
  return null;
}
