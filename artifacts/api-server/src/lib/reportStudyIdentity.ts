/**
 * Which accession a printed report may name.
 *
 * The Reporting Workspace preview, the browser print and the Download PDF all
 * name the study (`UHID` and `ACC:`) because that path still holds the worklist
 * row in memory. The durable builder (`renderReportVersionHtml`) serves Report
 * Hub print and PDF, the public and WhatsApp share, email delivery and the PACS
 * archive from a `patient_reports` row alone — and it named no accession at all,
 * so the copy a referring clinician receives cannot be tied back to the images.
 *
 * The obvious join is the dangerous one. `patient_reports.study_id` is a shared
 * id space:
 *
 *   • the radiology finalize writers store `radiology_worklist.id`
 *     (routes/patient-reports.ts:2182, :2234 — `bound?.worklistId ?? …`), and the
 *     schema says so (lib/db/src/schema/patientReports.ts:26);
 *   • `radiology_studies.id` is a DIFFERENT serial, and other readers already
 *     treat this column as that (careUsgCompanion.ts:167, teleradiology.ts:55,
 *     usgPriorDataService.ts:79).
 *
 * So `SELECT … FROM radiology_worklist WHERE id = study_id` returns a real row
 * for the wrong study whenever the two sequences collide — which they do, by
 * design, on the same database. An unguarded join therefore prints a different
 * patient's accession on a patient-facing document: a cross-patient disclosure
 * in the one artefact that leaves the building.
 *
 * The rule below is therefore refusal-first, in this order:
 *
 *   1. only a radiology report can have an accession at all;
 *   2. a report with no study reference has no accession — that is absence, not
 *      a blank to fill in;
 *   3. a candidate row may only speak for the report when its own `patient_id`
 *      equals the report's. A null on either side is not a match;
 *   4. of the surviving candidates the worklist row wins, because it is what the
 *      finalize path stored;
 *   5. an empty accession stays empty — no placeholder, no invented value;
 *   6. the caller renders NO ROW when nothing resolved. An "Accession:" label
 *      with nothing after it tells a clinician the study has no accession, which
 *      is a claim this code is not entitled to make.
 *
 * `resolveWorklistFromStudyRef` (radiologyIdentity.ts:58) does the two-shape
 * lookup; nothing here re-implements it.
 *
 * ── From "which accession" to "which study identity" ────────────────────────
 * The same six rules decide every other study field a report may name, because
 * the danger is identical: the durable builder used to left-join the LIVE
 * `patients` row and read no radiology table at all, so a signed report printed
 * its own `created_at` in the slot a clinician reads as the examination date, no
 * referring physician at all, and an age recomputed from `Date.now()` on every
 * reprint. The candidate picker below is therefore shared: one verification, one
 * priority order, and `resolveReportAccession` keeps the exact verdicts it had.
 *
 * Fields are then folded across the verified candidates — worklist first — so a
 * blank on the row that wins does not hide a value the other row holds. That is
 * the same gap-filling the Reporting Workspace's own `mergeReportDemography`
 * does for the preview, which is what makes the preview and the signed artifact
 * agree. An empty field stays empty: no placeholder, and never a substitution
 * (no "Self" referrer, no current time as an examination date).
 */
import {
  isRadiologyReportType,
  loadBilledStudy,
  resolveWorklistFromStudyRef,
} from "./radiologyIdentity";
import { db } from "@workspace/db";
import { patientsTable } from "@workspace/db/schema";
import { genderToDicomSex } from "@workspace/pathology";
import { eq } from "drizzle-orm";
import { formatAgeAtExamination } from "./reportAge";
import type { CareDemographyOverrides } from "./structuredJsonColumn";

/** The label `reportPresentation.ts:313` already harvests into `Accession:`. */
export const ACCESSION_ROW_LABEL = "Accession No.";

/**
 * One radiology row that might be this report's study. Both shapes are accepted:
 * the worklist row spells the DICOM UID `studyInstanceUID` and stores `studyDate`
 * as DICOM text, the billed study spells it `studyInstanceUid` and stores a real
 * `date` column. Optional-and-partial on purpose so either row satisfies it.
 */
export type StudyIdentityCandidate = {
  accessionNumber?: string | null;
  patientId?: number | null;
  studyDate?: string | Date | null;
  modality?: string | null;
  studyDescription?: string | null;
  referringDoctor?: string | null;
  studyInstanceUid?: string | null;
  studyInstanceUID?: string | null;
  /** The study row's own age text, in whatever shape DICOM sent it. */
  age?: string | null;
  sex?: string | null;
};

/** Kept as the name PR #992 exported; it is the same shape, widened. */
export type AccessionCandidate = StudyIdentityCandidate;

export type AccessionSource = "worklist" | "billed-study";

export type ResolvedReportAccession =
  | { status: "resolved"; accession: string; source: AccessionSource }
  | {
      status: "absent";
      reason: "not-radiology" | "no-study-reference" | "no-candidate" | "patient-mismatch" | "blank-accession";
      /** Candidates seen and why each was not used — diagnostic only, never printed. */
      rejected: { source: AccessionSource; why: string }[];
    };

const positiveId = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/**
 * The patient cross-check, in one place, because every study field a report may
 * name depends on it. Rules 3 and 4 of the header: a candidate row may speak for
 * the report only when its own `patient_id` equals the report's (a null on either
 * side is not a match), and of the survivors the worklist row is tried first
 * because it is what the finalize path stored.
 */
function verifiedCandidates(input: {
  reportPatientId: number;
  worklist?: StudyIdentityCandidate | null;
  billedStudy?: StudyIdentityCandidate | null;
}): {
  verified: { source: AccessionSource; row: StudyIdentityCandidate }[];
  rejected: { source: AccessionSource; why: string }[];
} {
  const ordered: { source: AccessionSource; row: StudyIdentityCandidate }[] = [];
  if (input.worklist) ordered.push({ source: "worklist", row: input.worklist });
  if (input.billedStudy) ordered.push({ source: "billed-study", row: input.billedStudy });

  const verified: { source: AccessionSource; row: StudyIdentityCandidate }[] = [];
  const rejected: { source: AccessionSource; why: string }[] = [];
  for (const candidate of ordered) {
    const candidatePatientId = positiveId(candidate.row.patientId);
    if (candidatePatientId === null) {
      rejected.push({ source: candidate.source, why: "candidate row names no patient" });
      continue;
    }
    if (candidatePatientId !== input.reportPatientId) {
      // The id-space collision this exists to catch.
      rejected.push({ source: candidate.source, why: `belongs to patient ${candidatePatientId}, not ${input.reportPatientId}` });
      continue;
    }
    verified.push(candidate);
  }
  return { verified, rejected };
}

/**
 * The decision, with no database in it, so every refusal is testable by name.
 */
export function resolveReportAccession(input: {
  isRadiology: boolean;
  studyId: number | null | undefined;
  reportPatientId: number | null | undefined;
  worklist?: AccessionCandidate | null;
  billedStudy?: AccessionCandidate | null;
}): ResolvedReportAccession {
  const rejected: { source: AccessionSource; why: string }[] = [];

  if (!input.isRadiology) {
    // A pathology or blood-work report has no accession to name. This is not a
    // lookup failure, so it must not be reported as one.
    return { status: "absent", reason: "not-radiology", rejected };
  }

  const reportPatientId = positiveId(input.reportPatientId);
  if (reportPatientId === null) {
    // Without a patient on the report there is nothing to verify a candidate
    // against, and an unverified accession is the leak. Refuse.
    return { status: "absent", reason: "patient-mismatch", rejected: [{ source: "worklist", why: "report has no patient id to verify against" }] };
  }

  if (positiveId(input.studyId) === null) {
    return { status: "absent", reason: "no-study-reference", rejected };
  }

  if (!input.worklist && !input.billedStudy) {
    return { status: "absent", reason: "no-candidate", rejected };
  }

  const { verified, rejected: unverified } = verifiedCandidates({
    reportPatientId,
    worklist: input.worklist,
    billedStudy: input.billedStudy,
  });
  rejected.push(...unverified);

  let chosen: { source: AccessionSource; accession: string } | null = null;
  for (const candidate of verified) {
    const accession = trimmed(candidate.row.accessionNumber);
    if (!accession) {
      rejected.push({ source: candidate.source, why: "patient matches but the row carries no accession" });
      continue;
    }
    chosen = { source: candidate.source, accession };
    break;
  }

  if (chosen) return { status: "resolved", accession: chosen.accession, source: chosen.source };

  const blankOnly = rejected.length > 0 && rejected.every((r) => r.why.includes("no accession"));
  return { status: "absent", reason: blankOnly ? "blank-accession" : "patient-mismatch", rejected };
}

/**
 * The printed row, or nothing at all. `null` is the point: the caller must omit
 * the label rather than draw "Accession:" and leave it blank.
 */
export function accessionPrintRow(
  resolved: ResolvedReportAccession,
): { label: string; value: string } | null {
  return resolved.status === "resolved"
    ? { label: ACCESSION_ROW_LABEL, value: resolved.accession }
    : null;
}

// ── The rest of the study identity ──────────────────────────────────────────

/**
 * Every study-side fact a report may name, resolved once. Empty means "not
 * recorded" and must stay empty: the caller omits the row rather than printing a
 * label with nothing after it, and never substitutes another field for it.
 */
export type ReportStudyIdentity = {
  accessionNumber: string;
  /** `YYYY-MM-DD` when the source could be read as a real day; otherwise the raw text. */
  studyDate: string;
  modality: string;
  studyDescription: string;
  referringDoctor: string;
  studyInstanceUid: string;
  /** The study row's own age text, unconverted — `reportAge.ts` reads it. */
  documentedAge: string;
  sex: string;
};

export type ResolvedReportStudyIdentity =
  | { status: "resolved"; identity: ReportStudyIdentity; sources: AccessionSource[] }
  | {
      status: "absent";
      reason: "not-radiology" | "no-study-reference" | "no-candidate" | "patient-mismatch" | "no-identity";
      rejected: { source: AccessionSource; why: string }[];
    };

const IDENTITY_FIELDS = [
  "accessionNumber",
  "studyDate",
  "modality",
  "studyDescription",
  "referringDoctor",
  "studyInstanceUid",
  "documentedAge",
  "sex",
] as const satisfies readonly (keyof ReportStudyIdentity)[];

/**
 * A `date` column arrives as a `Date`, a DICOM `study_date` arrives as text
 * (`20250110`), and a Demography card can hold `10/01/2025`. Normalized to
 * `YYYY-MM-DD` when the day is unambiguous so a frozen snapshot cannot later be
 * re-read differently; anything else is passed through for
 * `reportPresentation.formatReportDateShort` to render or refuse.
 */
export function normalizeStudyDate(raw: unknown): string {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  }
  const text = trimmed(raw);
  if (!text) return "";
  const dicom = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (dicom) return `${dicom[1]}-${dicom[2]}-${dicom[3]}`;
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slashed) {
    const pad = (n: string) => n.padStart(2, "0");
    return `${slashed[3]}-${pad(slashed[2]!)}-${pad(slashed[1]!)}`;
  }
  // Slashed and not DD/MM/YYYY: refuse rather than pick an order, matching
  // `reportPresentation.readStudyDate`. A wrongly ordered day is a wrong age at
  // examination, which is a fabricated clinical value.
  if (text.includes("/")) return "";
  return text;
}

function candidateField(row: StudyIdentityCandidate, field: keyof ReportStudyIdentity): string {
  switch (field) {
    case "studyDate":
      return normalizeStudyDate(row.studyDate);
    case "studyInstanceUid":
      return trimmed(row.studyInstanceUid) || trimmed(row.studyInstanceUID);
    case "documentedAge":
      return trimmed(row.age);
    default:
      return trimmed(row[field]);
  }
}

/**
 * Fold the verified candidates field by field, worklist first. A field the
 * winning row leaves blank is taken from the next verified row rather than
 * dropped — the two rows describe the same study, and the workspace preview
 * already gap-fills the same way.
 */
export function resolveReportStudyIdentity(input: {
  isRadiology: boolean;
  studyId: number | null | undefined;
  reportPatientId: number | null | undefined;
  worklist?: StudyIdentityCandidate | null;
  billedStudy?: StudyIdentityCandidate | null;
}): ResolvedReportStudyIdentity {
  if (!input.isRadiology) {
    return { status: "absent", reason: "not-radiology", rejected: [] };
  }
  const reportPatientId = positiveId(input.reportPatientId);
  if (reportPatientId === null) {
    return {
      status: "absent",
      reason: "patient-mismatch",
      rejected: [{ source: "worklist", why: "report has no patient id to verify against" }],
    };
  }
  if (positiveId(input.studyId) === null) {
    return { status: "absent", reason: "no-study-reference", rejected: [] };
  }
  if (!input.worklist && !input.billedStudy) {
    return { status: "absent", reason: "no-candidate", rejected: [] };
  }

  const { verified, rejected } = verifiedCandidates({
    reportPatientId,
    worklist: input.worklist,
    billedStudy: input.billedStudy,
  });

  const identity: Record<(typeof IDENTITY_FIELDS)[number], string> = { ...EMPTY_STUDY_IDENTITY };
  const sources = new Set<AccessionSource>();
  for (const candidate of verified) {
    for (const field of IDENTITY_FIELDS) {
      if (identity[field]) continue;
      const value = candidateField(candidate.row, field);
      if (!value) continue;
      identity[field] = value;
      sources.add(candidate.source);
    }
  }

  if (IDENTITY_FIELDS.every((field) => !identity[field])) {
    // Verified rows that say nothing about the study. Absence, not a blank to fill.
    return { status: "absent", reason: "no-identity", rejected };
  }
  return { status: "resolved", identity: identity as ReportStudyIdentity, sources: [...sources] };
}

/**
 * Load the candidates for one report and decide BOTH questions — which accession
 * and which study identity — from a single pair of reads. Reads only.
 *
 * The worklist row is resolved through `resolveWorklistFromStudyRef`, which
 * already knows that this column holds a worklist id on the finalize path and a
 * billed-study id on older rows. When a worklist exists, only its billed-study
 * link may fill gaps: a same-number billed row can be another examination for
 * the same patient. `verifiedCandidates` still cross-checks each row's patient.
 */
export type ReportStudyIdentityVerdict = {
  accession: ResolvedReportAccession;
  study: ResolvedReportStudyIdentity;
};

export async function loadReportStudyIdentityForReport(report: {
  type?: string | null;
  studyId?: number | null;
  patientId?: number | null;
}): Promise<ReportStudyIdentityVerdict> {
  // Every radiology writer stores the literal "radiology" (patient-reports.ts:1150,
  // :1807, :3671, internal-reporting-studio.ts:878), so the type column alone is
  // authoritative here. A row typed otherwise has no study identity to name.
  const isRadiology = isRadiologyReportType(String(report.type ?? ""));
  const studyRef = positiveId(report.studyId);
  if (!isRadiology || studyRef === null) {
    const shape = { isRadiology, studyId: studyRef, reportPatientId: report.patientId };
    return {
      accession: resolveReportAccession(shape),
      study: resolveReportStudyIdentity(shape),
    };
  }

  const worklist = await resolveWorklistFromStudyRef(studyRef);
  let billedStudy = null;
  if (worklist) {
    const linkedStudyId = positiveId(worklist.studyId);
    if (linkedStudyId !== null) billedStudy = await loadBilledStudy(linkedStudyId);
  } else {
    // Legacy billed references are supported only when no worklist resolves.
    billedStudy = await loadBilledStudy(studyRef);
  }

  const shape = { isRadiology, studyId: studyRef, reportPatientId: report.patientId, worklist, billedStudy };
  return {
    accession: resolveReportAccession(shape),
    study: resolveReportStudyIdentity(shape),
  };
}

export async function loadReportAccessionForReport(report: {
  type?: string | null;
  studyId?: number | null;
  patientId?: number | null;
}): Promise<ResolvedReportAccession> {
  return (await loadReportStudyIdentityForReport(report)).accession;
}

// ── The identity a signed report renders from ───────────────────────────────

/** Every study field absent. Used instead of `null` so a caller cannot
 *  accidentally print "undefined" into a header. */
export const EMPTY_STUDY_IDENTITY: ReportStudyIdentity = {
  accessionNumber: "",
  studyDate: "",
  modality: "",
  studyDescription: "",
  referringDoctor: "",
  studyInstanceUid: "",
  documentedAge: "",
  sex: "",
};

/**
 * What one report prints for who and when, resolved once and rendered from
 * everywhere. Patient identity, study identity and report identity are kept
 * apart: the patient half comes from the registration master (or from the
 * snapshot taken at signing), the study half only ever from a radiology row that
 * passed the patient cross-check, and the report half — number, created, signed,
 * signer — is left on the report row itself, which is already immutable.
 */
export type ReportIdentityForRender = {
  patientName: string;
  /** The clinic's patient index number. Never a database primary key. */
  uhid: string;
  sex: string;
  /** Display string, already evaluated at the examination date. */
  ageAtExamination: string;
  study: ReportStudyIdentity;
  /** "frozen" once the report was signed with its identity captured. */
  source: "frozen" | "live";
};

/**
 * The identity as captured at the signing event. Stored inside the existing
 * `radiology_report_presentation_freeze.snapshot` jsonb, so freezing it needs no
 * migration and inherits that table's guarantees: one row per report, written
 * once, never updated, never deleted.
 */
export type FrozenReportIdentity = Omit<ReportIdentityForRender, "source"> & {
  /** The instant this was captured — evidence, never printed. */
  capturedAt: string;
};

/**
 * A signed report renders from its frozen identity, whole. Mixing frozen and
 * live fields field-by-field would produce a document that is partly what was
 * signed and partly what the master says today, which is worse than either.
 * Reports signed before identity was captured have no frozen half and fall back
 * to live resolution — the same documented fallback the template snapshot uses.
 */
export function effectiveReportIdentity(
  frozen: FrozenReportIdentity | null | undefined,
  live: Omit<ReportIdentityForRender, "source">,
): ReportIdentityForRender {
  if (!frozen) return { ...live, source: "live" };
  return {
    patientName: frozen.patientName ?? "",
    uhid: frozen.uhid ?? "",
    sex: frozen.sex ?? "",
    ageAtExamination: frozen.ageAtExamination ?? "",
    study: { ...EMPTY_STUDY_IDENTITY, ...(frozen.study ?? {}) },
    source: "frozen",
  };
}

/** The patient-master columns the identity block reads. */
export type PatientIdentityFacts = {
  name: string;
  /** `patients.patient_id` — the clinic's UHID text. Never the numeric primary key. */
  uhid: string;
  sex: string;
  dateOfBirth: string | null;
  ageValue: number | null;
  ageUnit: string | null;
};

export type ReportIdentityTarget = {
  type?: string | null;
  studyId?: number | null;
  patientId?: number | null;
};

/**
 * Resolve the whole identity a report may print, live.
 *
 * The age is evaluated against the EXAMINATION date, never the render instant, so
 * reprinting a 2025 report in 2027 prints the 2025 age. When no examination date
 * could be verified there is no as-of to evaluate against and the age falls back
 * to a documented value or to nothing — `reportAge.formatAgeAtExamination` never
 * reads the clock, and this never hands it one.
 *
 * `patient` may be supplied by a caller that already joined the master (the
 * durable renderer does); otherwise it is read here.
 */
export async function loadReportIdentityForRender(
  report: ReportIdentityTarget,
  patient?: PatientIdentityFacts | null,
): Promise<Omit<ReportIdentityForRender, "source">> {
  const verdict = await loadReportStudyIdentityForReport(report);
  const study = verdict.study.status === "resolved" ? verdict.study.identity : EMPTY_STUDY_IDENTITY;

  let master = patient ?? null;
  if (!master) {
    const patientId = positiveId(report.patientId);
    if (patientId !== null) {
      const [row] = await db
        .select({
          firstName: patientsTable.firstName,
          lastName: patientsTable.lastName,
          uhid: patientsTable.patientId,
          gender: patientsTable.gender,
          dateOfBirth: patientsTable.dateOfBirth,
          ageValue: patientsTable.ageValue,
          ageUnit: patientsTable.ageUnit,
        })
        .from(patientsTable)
        .where(eq(patientsTable.id, patientId))
        .limit(1);
      master = row ? patientFactsFromMaster(row) : null;
    }
  }

  return {
    patientName: master?.name ?? "",
    uhid: master?.uhid ?? "",
    sex: master?.sex ?? "",
    ageAtExamination: formatAgeAtExamination({
      dateOfBirth: master?.dateOfBirth ?? null,
      ageValue: master?.ageValue ?? null,
      ageUnit: master?.ageUnit ?? null,
      documentedAge: study.documentedAge,
      asOf: study.studyDate || null,
    }),
    study,
  };
}

export function patientFactsFromMaster(row: {
  firstName?: string | null;
  lastName?: string | null;
  uhid?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  ageValue?: number | null;
  ageUnit?: string | null;
}): PatientIdentityFacts {
  return {
    name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
    uhid: trimmed(row.uhid),
    // The master's `gender` is free text ("Mrs" is a real registration value,
    // per the request-test fixtures). The draft preview prints the worklist
    // row's sanitized M/F/O; the signed artifact printed this raw string, so
    // one patient read "M" before signing and "male" — or free text — after.
    // One vocabulary on every surface; junk refuses to print rather than
    // guessing.
    sex: genderToDicomSex(row.gender) ?? "",
    dateOfBirth: row.dateOfBirth ?? null,
    ageValue: row.ageValue ?? null,
    ageUnit: row.ageUnit ?? null,
  };
}

/**
 * The identity to capture at the signing event. Same resolution the renderer
 * uses, so a frozen report prints exactly what it would have printed the moment
 * it was signed — and keeps printing it after the registration is edited.
 */
export async function captureReportIdentity(
  report: ReportIdentityTarget,
  patient?: PatientIdentityFacts | null,
): Promise<FrozenReportIdentity> {
  const live = await loadReportIdentityForRender(report, patient);
  return { ...live, capturedAt: new Date().toISOString() };
}

/**
 * PR #1171 — fold the draft's demography corrections into the identity the
 * signing event captured.
 *
 * The Demography card's corrections used to die at the border: the preview,
 * the client PDF and the Word export showed them, but `captureReportIdentity`
 * resolved from the worklist / billed study / patient master and froze THAT,
 * so the signed report printed the uncorrected values. This helper applies
 * the same rule the client's own `mergeReportDemography` uses — only a
 * non-empty trimmed string overrides — onto the frozen half, so every durable
 * surface (Report Hub print, PDF, share, email, PACS archive) prints the
 * corrected values the radiologist approved.
 *
 * Field mapping is fixed by what the frozen identity actually prints:
 * patientName/uhid/sex/age → the patient half (age → ageAtExamination);
 * studyDescription/studyDate/referringDoctor → the study half. `dateOfBirth`
 * has no server slot — no report surface the durable builder renders prints a
 * DOB line — so it round-trips in the envelope for the client surfaces that
 * do, and none is invented here. The input is never mutated; `capturedAt`
 * survives because it is evidence, not display.
 */
export function applyDemographyOverridesToIdentity(
  identity: FrozenReportIdentity,
  overrides: CareDemographyOverrides | null | undefined,
): FrozenReportIdentity {
  if (!overrides) return identity;
  const value = (field: keyof CareDemographyOverrides): string | null => {
    const raw = overrides[field];
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  };
  const patientName = value("patientName");
  const uhid = value("uhid");
  const sex = value("sex");
  const age = value("age");
  const studyDescription = value("studyDescription");
  const studyDate = value("studyDate");
  const referringDoctor = value("referringDoctor");
  if (
    patientName == null && uhid == null && sex == null && age == null
    && studyDescription == null && studyDate == null && referringDoctor == null
  ) {
    return identity;
  }
  const study = { ...identity.study };
  if (studyDescription != null) study.studyDescription = studyDescription;
  if (studyDate != null) study.studyDate = studyDate;
  if (referringDoctor != null) study.referringDoctor = referringDoctor;
  return {
    ...identity,
    ...(patientName != null ? { patientName } : {}),
    ...(uhid != null ? { uhid } : {}),
    ...(sex != null ? { sex } : {}),
    ...(age != null ? { ageAtExamination: age } : {}),
    study,
  };
}




// ── The signer display flags, frozen the same way ───────────────────────────
//
// Which parts of the signature block a printed report shows — name, degree,
// registration number, the signature image itself, the timestamp, the QR
// verification mark — is decided by the clinic's institutional style row. That row
// is live configuration, and until this section existed a report kept reading it
// AFTER it had been signed and delivered: measured on main, flipping the flags on
// the style row changed a VERIFIED report's PDF (683,448 → 681,386 bytes) and
// dropped `Reg. No:` and both printed timestamps from it. A document that has been
// signed and handed to a patient cannot be allowed to change what it says about who
// signed it, because that is the fact the signature attests.
//
// So the six flags are captured at the signing event into the same jsonb snapshot
// that already holds the signed template and the signed patient/study identity, and
// a report with that snapshot renders its signer block from it.
//
// What stays live is deliberate: layout, headings, spacing and section order are
// presentation FORMATTING, and the clinic may reprint a report in the current
// layout. These six are not formatting — each one either names the signer or does
// not.

export type SignerDisplayFlags = {
  showRadiologistName: boolean;
  showDegree: boolean;
  showRegNumber: boolean;
  showDigitalSignature: boolean;
  showTimestamp: boolean;
  showQrVerification: boolean;
};

const SIGNER_DISPLAY_KEYS: (keyof SignerDisplayFlags)[] = [
  "showRadiologistName", "showDegree", "showRegNumber",
  "showDigitalSignature", "showTimestamp", "showQrVerification",
];

/**
 * The fallback the renderer already used, as one function so the sign-time capture
 * and the render-time fallback cannot drift apart. Note the asymmetry it preserves:
 * with no style row every line shows, but once a style row exists a flag it does not
 * set to true hides its line — the clinic's own configuration, not a default to fix.
 */
export function signerDisplayFromStyle(style: Record<string, unknown> | null | undefined): SignerDisplayFlags {
  const flags = {} as SignerDisplayFlags;
  for (const key of SIGNER_DISPLAY_KEYS) flags[key] = style ? style[key] === true : true;
  return flags;
}

/** The snapshot as stored. `stylePresetName` records which preset the report was
 *  signed under so the register is explainable afterwards; `capturedAt` is evidence
 *  and is never printed. */
export type FrozenSignerDisplay = SignerDisplayFlags & {
  stylePresetName: string | null;
  capturedAt: string;
};

export function captureSignerDisplay(style: Record<string, unknown> | null | undefined): FrozenSignerDisplay {
  return {
    ...signerDisplayFromStyle(style),
    stylePresetName: typeof style?.presetName === "string" ? style.presetName : null,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * A signed report shows what it showed when it was signed; a draft shows what the
 * clinic has configured today. Whole, never field-by-field — mixing frozen and live
 * flags would produce a signer block that is partly what was authorized and partly
 * what the style row says today, which is worse than either.
 *
 * A snapshot written before flags were captured (or a malformed one) counts as no
 * snapshot: falling back to live is the same documented behaviour the frozen identity
 * and frozen template use, whereas inventing all-off would hide a signer block that
 * was never hidden.
 */
export function effectiveSignerDisplay(
  frozen: FrozenSignerDisplay | null | undefined,
  live: SignerDisplayFlags,
): { flags: SignerDisplayFlags; source: "frozen" | "live" } {
  if (!frozen || typeof frozen.showRadiologistName !== "boolean") return { flags: live, source: "live" };
  const flags = {} as SignerDisplayFlags;
  for (const key of SIGNER_DISPLAY_KEYS) flags[key] = frozen[key];
  return { flags, source: "frozen" };
}
