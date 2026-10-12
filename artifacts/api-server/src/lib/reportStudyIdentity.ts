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
 */
import {
  isRadiologyReportType,
  loadBilledStudy,
  resolveWorklistFromStudyRef,
} from "./radiologyIdentity";

/** The label `reportPresentation.ts:313` already harvests into `Accession:`. */
export const ACCESSION_ROW_LABEL = "Accession No.";

export type AccessionCandidate = {
  accessionNumber?: string | null;
  patientId?: number | null;
};

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

  const candidates: { source: AccessionSource; row: AccessionCandidate }[] = [];
  if (input.worklist) candidates.push({ source: "worklist", row: input.worklist });
  if (input.billedStudy) candidates.push({ source: "billed-study", row: input.billedStudy });
  if (candidates.length === 0) {
    return { status: "absent", reason: "no-candidate", rejected };
  }

  let chosen: { source: AccessionSource; accession: string } | null = null;
  for (const candidate of candidates) {
    const candidatePatientId = positiveId(candidate.row.patientId);
    if (candidatePatientId === null) {
      rejected.push({ source: candidate.source, why: "candidate row names no patient" });
      continue;
    }
    if (candidatePatientId !== reportPatientId) {
      // The id-space collision this exists to catch.
      rejected.push({ source: candidate.source, why: `belongs to patient ${candidatePatientId}, not ${reportPatientId}` });
      continue;
    }
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

/**
 * Load the candidates for one report and decide. Reads only.
 *
 * The worklist row is resolved through `resolveWorklistFromStudyRef`, which
 * already knows that this column holds a worklist id on the finalize path and a
 * billed-study id on older rows; the patient cross-check in
 * `resolveReportAccession` is what makes either shape safe to print.
 */
export async function loadReportAccessionForReport(report: {
  type?: string | null;
  studyId?: number | null;
  patientId?: number | null;
}): Promise<ResolvedReportAccession> {
  // Every radiology writer stores the literal "radiology" (patient-reports.ts:1150,
  // :1807, :3671, internal-reporting-studio.ts:878), so the type column alone is
  // authoritative here. A row typed otherwise has no accession to name.
  const isRadiology = isRadiologyReportType(String(report.type ?? ""));
  const studyRef = positiveId(report.studyId);
  if (!isRadiology || studyRef === null) {
    return resolveReportAccession({ isRadiology, studyId: studyRef, reportPatientId: report.patientId });
  }

  const [worklist, billedStudy] = await Promise.all([
    resolveWorklistFromStudyRef(studyRef),
    loadBilledStudy(studyRef),
  ]);

  return resolveReportAccession({
    isRadiology,
    studyId: studyRef,
    reportPatientId: report.patientId,
    worklist,
    billedStudy,
  });
}
