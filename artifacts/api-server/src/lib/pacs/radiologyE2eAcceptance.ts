/**
 * Radiology end-to-end acceptance helpers (pure / test-environment only).
 *
 * Encodes the expected Billing → ERP → MWL → Orthanc → matching → reporting
 * chain for MRI Brain, MRI Whole Spine, USG Whole Abdomen, and cancellation.
 *
 * Production UI must NEVER invent patients/bills from these helpers — they are
 * for automated Vitest suites and the read-only Acceptance Tests panel copy.
 */

import {
  assertValidMwlDump,
  buildMwlDumpText,
  formatMwlPersonName,
  mwlAccession,
  DICOM_SH_MAX_BYTES,
  mwlSeriesInstanceUid,
  mwlSopInstanceUid,
  mwlStudyInstanceUid,
  MWL_TERMINAL_STATUSES,
  type MwlProcedure,
} from "./mwlWorklistWriter";
import { classifyImagingBucket } from "./imagingModalityBucket";
import { calculateMatchScore, type BilledTestInput, type DicomInput } from "./matchingEngine";
import { isObstetricUsgStudy, isUltrasoundModality, normalizeModality } from "../usgModality";
import { isActiveMwlStatus } from "./cancelRadiologyMwlRules";

/** Same department → DICOM modality map used by generateStudiesForOrder. */
export const BILLING_DEPARTMENT_TO_MODALITY: Record<string, string> = {
  "X-Ray": "CR",
  USG: "US",
  MRI: "MR",
  CT: "CT",
  Mammography: "MG",
  DEXA: "BMD",
};

export type AcceptanceCardId = "mri_brain" | "mri_whole_spine" | "usg_abdomen" | "cancellation";

export type AcceptanceScenario = {
  id: AcceptanceCardId;
  title: string;
  /** DICOM PN for manual hardware cards */
  testPatientPn: string;
  /** ERP-style Given Family name */
  patientNameErp: string;
  patientId: string;
  patientSex: "M" | "F" | "O";
  patientDob: string; // YYYYMMDD
  billingDepartment: keyof typeof BILLING_DEPARTMENT_TO_MODALITY | string;
  expectedModality: string;
  procedureDescription: string;
  accessionNumber: string;
  expectedBucket: "MRI" | "USG" | "CT" | "X-Ray" | "OPG";
  chain: string[];
  /** USG only */
  expectUsgQueue?: boolean;
  obstetric?: boolean;
};

/** Deterministic fixtures — never written to production DB by these helpers. */
export const ACCEPTANCE_SCENARIOS: AcceptanceScenario[] = [
  {
    id: "mri_brain",
    title: "MRI Brain",
    testPatientPn: "TEST^MRI^BRAIN",
    patientNameErp: "MRI BRAIN Test",
    patientId: "UHID-TEST-MRI-BRAIN",
    patientSex: "M",
    patientDob: "19800115",
    billingDepartment: "MRI",
    expectedModality: "MR",
    procedureDescription: "MRI Brain",
    accessionNumber: "ACC-20990101-MR-001",
    expectedBucket: "MRI",
    chain: [
      "Billing selects MRI Brain",
      "ERP radiology_studies created (modality MR)",
      "publishRadiologyStudyToMwl → radiology_scheduled_procedures",
      "writeWorklistFile → dump2dcm → atomic rename → SENT_TO_MWL",
      "Orthanc worklists plugin C-FIND",
      "Modality selects patient → scan",
      "PACS intake matches by accession",
      "Reporting workspace receives normalized patient object",
    ],
  },
  {
    id: "mri_whole_spine",
    title: "MRI Whole Spine",
    testPatientPn: "TEST^MRI^WHOLESPINE",
    patientNameErp: "MRI WHOLESPINE Test",
    patientId: "UHID-TEST-MRI-SPINE",
    patientSex: "F",
    patientDob: "19750520",
    billingDepartment: "MRI",
    expectedModality: "MR",
    procedureDescription: "MRI Whole Spine",
    accessionNumber: "ACC-20990101-MR-002",
    expectedBucket: "MRI",
    chain: [
      "Billing selects MRI Whole Spine",
      "Same pipeline as MRI Brain (no split studies)",
      "Procedure description survives untruncated",
      "Unique accession; valid MWL metadata",
      "Matching + reporting workspace",
    ],
  },
  {
    id: "usg_abdomen",
    title: "USG Whole Abdomen",
    testPatientPn: "TEST^USG^ABDOMEN",
    patientNameErp: "USG ABDOMEN Test",
    patientId: "UHID-TEST-USG-ABD",
    patientSex: "F",
    patientDob: "19900310",
    billingDepartment: "USG",
    expectedModality: "US",
    procedureDescription: "USG Whole Abdomen",
    accessionNumber: "ACC-20990101-US-001",
    expectedBucket: "USG",
    expectUsgQueue: true,
    obstetric: false,
    chain: [
      "Billing selects USG Whole Abdomen",
      "Modality resolves to US (same generateStudiesForOrder path)",
      "MWL + test_tokens TV/operator queue (USG room)",
      "Operator selects patient — demographics from ERP/MWL (no retype)",
      "Intake → radiology_worklist → reporting (US filter via isUltrasoundModality)",
      "Non-obstetric classification preserved",
    ],
  },
  {
    id: "cancellation",
    title: "Cancellation / Void",
    testPatientPn: "TEST^CANCEL^CASE",
    patientNameErp: "CANCEL Case Test",
    patientId: "UHID-TEST-CANCEL",
    patientSex: "M",
    patientDob: "19880808",
    billingDepartment: "MRI",
    expectedModality: "MR",
    procedureDescription: "MRI Brain",
    accessionNumber: "ACC-20990101-MR-099",
    expectedBucket: "MRI",
    chain: [
      "Bill MRI/USG → active MWL + .wl",
      "Cancel/void procedure or bill",
      "radiology_scheduled_procedures → CANCELLED",
      ".wl removed / excluded from active sync",
      "Modality no longer sees the exam",
      "No orphan USG queue token",
    ],
  },
];

export function scenarioById(id: AcceptanceCardId): AcceptanceScenario {
  const s = ACCEPTANCE_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown acceptance scenario: ${id}`);
  return s;
}

/** Map billing department the same way generateStudiesForOrder does. */
export function modalityFromBillingDepartment(department: string): string {
  return BILLING_DEPARTMENT_TO_MODALITY[department] ?? "OT";
}

export function buildAcceptanceMwlProcedure(s: AcceptanceScenario): MwlProcedure {
  return {
    accessionNumber: s.accessionNumber,
    patientId: s.patientId,
    patientName: s.patientNameErp,
    patientSex: s.patientSex,
    patientDob: s.patientDob,
    modality: s.expectedModality,
    studyDescription: s.procedureDescription,
    procedureName: s.procedureDescription,
    referringDoctor: "Dr Test Referring",
    scheduledDate: "20990101",
    scheduledTime: "090000",
    stationAeTitle: "TEST_AE",
    bodyPartExamined: s.id.startsWith("mri") ? "BRAIN" : "ABDOMEN",
    sourceBillId: "999001",
    sourceOrderId: "999002",
  };
}

export type MwlDumpValidation = {
  ok: boolean;
  errors: string[];
  dump: string;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  patientNamePn: string;
};

/** Validate mandatory MWL identifiers using the real dump builder + assertValidMwlDump. */
export function validateAcceptanceMwlDump(s: AcceptanceScenario): MwlDumpValidation {
  const proc = buildAcceptanceMwlProcedure(s);
  const dump = buildMwlDumpText(proc);
  const errors: string[] = [];

  try {
    assertValidMwlDump(dump);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const studyInstanceUid = mwlStudyInstanceUid(s.accessionNumber);
  const seriesInstanceUid = mwlSeriesInstanceUid(s.accessionNumber);
  const sopInstanceUid = mwlSopInstanceUid(s.accessionNumber);
  const patientNamePn = formatMwlPersonName(s.patientNameErp);

  const mustContain: Array<[string, string]> = [
    // The SH field carries the 16-byte-safe form, not the canonical 19. The
    // canonical string is still asserted below in the LO comments, where CARE
    // actually owns it.
    ["accession", `(0008,0050) SH [${mwlAccession(s.accessionNumber)}]`],
    ["patient id", `(0010,0020) LO [${s.patientId}]`],
    ["patient sex", `(0010,0040) CS [${s.patientSex}]`],
    ["patient dob", `(0010,0030) DA [${s.patientDob}]`],
    ["modality", `(0008,0060) CS [${s.expectedModality}]`],
    // Capitals on the wire (owner request 7 Nov 2026), so this checks the value
    // the console is actually handed — the case is no longer evidence of a
    // truncation bug, presence and length are.
    ["procedure desc", `[${s.procedureDescription.toUpperCase()}]`],
    ["study UID", studyInstanceUid],
    ["series UID", seriesInstanceUid],
    ["sop UID", sopInstanceUid],
    ["CARE-ACC", `CARE-ACC:${s.accessionNumber}`],
  ];

  for (const [label, needle] of mustContain) {
    if (!dump.includes(needle)) {
      errors.push(`Missing ${label}: expected dump to contain ${needle}`);
    }
  }

  // Every SH value in the dump must fit the 16 bytes DICOM allows. CARE's own
  // canonical accession is 19, and this is the check that catches it: the live
  // PACS truncated three SH fields to the day, so 453 November ultrasound
  // studies came back carrying 5 distinct accessions.
  for (const [, tag, value] of dump.matchAll(/\((\d{4},\d{4})\) SH \[(.*)\]/g)) {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > DICOM_SH_MAX_BYTES) {
      errors.push(`(${tag}) SH is ${bytes} bytes — the modality truncates it to ${DICOM_SH_MAX_BYTES}`);
    }
  }

  // Whole Spine must not truncate or bucket incorrectly
  if (s.id === "mri_whole_spine") {
    if (!dump.includes("MRI WHOLE SPINE")) {
      errors.push("MRI Whole Spine description truncated or missing");
    }
    if (classifyImagingBucket({ modality: s.expectedModality, testName: s.procedureDescription }) !== "MRI") {
      errors.push("MRI Whole Spine incorrectly bucketed");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    dump,
    studyInstanceUid,
    seriesInstanceUid,
    sopInstanceUid,
    patientNamePn,
  };
}

/** Simulate PACS return matching by accession (production calculateMatchScore). */
export function validateAccessionMatch(s: AcceptanceScenario): {
  score: string;
  points: number;
  accessionMatched: boolean;
} {
  const dicom: DicomInput = {
    patientName: formatMwlPersonName(s.patientNameErp),
    dicomPatientId: s.patientId,
    sex: s.patientSex,
    modality: s.expectedModality,
    studyDescription: s.procedureDescription,
    // What the unit actually sends back on return: the SH-safe form it was
    // given. Production compares after stripping separators, so this still
    // matches the canonical accession on the bill — which the truncated value
    // it used to send did not.
    accessionNumber: mwlAccession(s.accessionNumber),
    studyInstanceUID: mwlStudyInstanceUid(s.accessionNumber),
  };
  const bill: BilledTestInput = {
    id: 1,
    patientId: 1,
    patientName: s.patientNameErp,
    patientUHID: s.patientId,
    sex: s.patientSex,
    testName: s.procedureDescription,
    modality: s.expectedModality,
    accessionNumber: s.accessionNumber,
  };
  const result = calculateMatchScore(dicom, bill);
  return {
    score: result.score,
    points: result.points,
    accessionMatched: result.reasons.some((r) => r.includes("Accession number matches exactly")),
  };
}

/** Pure cancellation state machine assertions. */
export function validateCancellationState(beforeStatus: string, afterStatus: string): {
  wasActive: boolean;
  isActiveAfter: boolean;
  terminalOk: boolean;
} {
  const wasActive = isActiveMwlStatus(beforeStatus);
  const isActiveAfter = isActiveMwlStatus(afterStatus);
  const terminalOk = MWL_TERMINAL_STATUSES.has(afterStatus.toUpperCase()) || afterStatus.toUpperCase() === "CANCELLED";
  return { wasActive, isActiveAfter, terminalOk };
}

/** USG modality + obstetric classification checks for acceptance. */
export function validateUsgClassification(s: AcceptanceScenario): {
  modalityOk: boolean;
  isUsg: boolean;
  obstetricOk: boolean;
  queueFilterOk: boolean;
} {
  const mapped = modalityFromBillingDepartment(s.billingDepartment);
  const normalized = normalizeModality(mapped);
  const isUsg = isUltrasoundModality(mapped) && isUltrasoundModality("USG");
  const obstetric = isObstetricUsgStudy(mapped, s.procedureDescription);
  return {
    modalityOk: mapped === "US" && normalized === "US",
    isUsg,
    obstetricOk: obstetric === Boolean(s.obstetric),
    // Reporting queue US filter uses isUltrasoundModality — same SoT as intake.
    queueFilterOk: isUltrasoundModality("US") && isUltrasoundModality("USG") && isUltrasoundModality("ULTRASOUND"),
  };
}

/**
 * Read-only payload for Settings → Radiology → Diagnostics Acceptance panel.
 * Never creates patients, bills, or .wl files.
 */
export function getAcceptanceChecklistMeta(): {
  readOnly: true;
  warning: string;
  scenarios: Array<{
    id: AcceptanceCardId;
    title: string;
    testPatientPn: string;
    expectedModality: string;
    procedureDescription: string;
    chain: string[];
    manualDoc: string;
  }>;
} {
  return {
    readOnly: true,
    warning:
      "Manual hardware acceptance only. Production UI never creates fake patients or bills as part of health checking.",
    scenarios: ACCEPTANCE_SCENARIOS.map((s) => ({
      id: s.id,
      title: s.title,
      testPatientPn: s.testPatientPn,
      expectedModality: s.expectedModality,
      procedureDescription: s.procedureDescription,
      chain: s.chain,
      manualDoc: "docs/RADIOLOGY_END_TO_END_ACCEPTANCE.md",
    })),
  };
}
