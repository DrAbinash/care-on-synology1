/**
 * radiologyDepartments.ts — ONE place that decides whether a catalog
 * department belongs to the radiology workflow, which canonical name it
 * answers to, and — when the department is a billing counter rather than a
 * machine — whether the physical device the test is bound to puts it in.
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

/**
 * The radiology family a PHYSICAL DEVICE belongs to, or null when the machine
 * is not imaging equipment. Input is `modalities.name`.
 *
 * The department answers "which billing counter sold this", not "which machine
 * performs it". A billed test is bound to a machine through
 * diagnostic_tests.modality_id, and that binding is the clinic's own statement
 * of who does the examination. Two catalog rows — "ECHO" and " ECHO FETAL" —
 * sit under department Cardiology (correct: Dr. Sugandha's counter) while being
 * bound to device "USG GE E9 Voluson", the same machine, in the same room, that
 * performs every USG study. The department-keyed fan-out therefore made them no
 * study, and the Voluson's worklist never showed a patient who had paid for an
 * echo. Department moves are not a fix either: Cardiology also holds ECG,
 * ECG EMG and TMT, which are not imaging.
 *
 * `modalities.code` is a catalogue label ("USG-1", "X-RAY-2"), never a DICOM
 * modality, so the name carries the answer. Matching is on the LEADING token
 * only, so "MRI UNITED 3 Tesla" is MRI rather than whatever else its protocol
 * list mentions, and a machine named for something outside radiology — "OPG",
 * an ECG cart — keeps behaving exactly as it does today: no study.
 */
export function canonicalRadiologyDepartmentForDevice(
  deviceName: string | null | undefined,
): string | null {
  const words = (deviceName ?? "").trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let length = 1; length <= Math.min(3, words.length); length += 1) {
    const head = words.slice(0, length);
    // The same device can be typed "X-RAY GE", "X RAY GE" or "X_RAY GE", and
    // the alias table keys on all three, so try each separator.
    for (const candidate of [head.join(" "), head.join("-"), head.join("_")]) {
      const canonical = canonicalRadiologyDepartment(candidate);
      if (canonical) return canonical;
    }
  }
  return null;
}

/**
 * Whether one billed order-test belongs to the radiology workflow, and under
 * which canonical family: the catalog department first, then the machine the
 * test is bound to. Both the study fan-out and the missing-study reconciliation
 * ask this, so a test can never be created by one and skipped by the other —
 * the exact split that left paid bills with no study behind them.
 */
export function radiologyFamilyForOrderTest(test: {
  department?: string | null;
  deviceName?: string | null;
}): string | null {
  return (
    canonicalRadiologyDepartment(test.department) ??
    canonicalRadiologyDepartmentForDevice(test.deviceName)
  );
}

/**
 * The department a patient is QUEUED and CALLED under — deliberately not the
 * billing department. `test_tokens.department` is what the queue screens filter
 * on, what the daily token number series is counted within, and what the serving
 * desk calls, so it has to name the room the patient is sitting in.
 *
 * The two ECHO catalog rows are billed under Cardiology, which is correct for
 * the counter, and performed on "USG GE E9 Voluson" in "USG ROOM NO. 1". Their
 * tokens were therefore numbered in a Cardiology series and filtered for by a
 * Cardiology display: the production queue TVs are usg / mri / ct, so an echo
 * patient was called on no screen at all — about seven a day — while waiting in
 * the same room as every USG patient.
 *
 * The machine decides, the same rule the study fan-out uses. A test with no
 * device binding keeps its own department, so ECG, ECG EMG, TMT and EEG — all
 * Cardiology-departmented, none of them bound to a machine — queue exactly as
 * they do today.
 */
export function queueDepartmentForOrderTest(test: {
  department?: string | null;
  deviceName?: string | null;
}): string | null {
  return (
    canonicalRadiologyDepartmentForDevice(test.deviceName) ?? (test.department?.trim() || null)
  );
}
