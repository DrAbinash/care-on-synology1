import type { PriorStudySummary } from "@workspace/api-zod";

/**
 * Pure merge logic for GET /api/radiology-copilot/prior-studies.
 *
 * Takes the patient's studies (one row per radiology_studies row, already
 * patient-scoped, non-cancelled, current-study-excluded, newest first) and the
 * patient's radiology patient_reports rows, and produces the PriorStudySummary
 * shape both prior-study panels consume. Kept pure so ordering, report
 * preference and fallback rules are unit-testable without a database.
 */

export interface PriorStudyRow {
  id: number;
  accessionNumber: string;
  modality: string;
  bodyPart: string | null;
  studyDate: string;
  status: string;
  testName: string | null;
  testCode: string | null;
  finalReport: string | null;
  finalReportedBy: string | null;
  finalReportedAt: Date | string | null;
  prelimReport: string | null;
  prelimReportedBy: string | null;
  prelimReportedAt: Date | string | null;
  studyDescription: string | null;
}

export interface PriorReportRow {
  id: number;
  studyId: number | null;
  status: string;
  impression: string | null;
  body: string | null;
  createdAt: Date | string | null;
}

/** Signed statuses in the patient_reports lifecycle (draft → verified → delivered). */
const SIGNED_REPORT_STATUSES = new Set(["verified", "delivered"]);

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Pick the best linked patient_reports row for a study: prefer signed
 * (verified/delivered) reports, then the most recent. `reports` may be in any
 * order; rows without a studyId never match.
 */
export function pickBestReport(
  studyId: number,
  reports: PriorReportRow[],
): PriorReportRow | null {
  let best: PriorReportRow | null = null;
  for (const r of reports) {
    if (r.studyId !== studyId) continue;
    if (!best) { best = r; continue; }
    const bestSigned = SIGNED_REPORT_STATUSES.has(best.status);
    const rSigned = SIGNED_REPORT_STATUSES.has(r.status);
    if (rSigned !== bestSigned) {
      if (rSigned) best = r;
      continue;
    }
    const bestAt = toIso(best.createdAt) ?? "";
    const rAt = toIso(r.createdAt) ?? "";
    if (rAt > bestAt) best = r;
  }
  return best;
}

export function mergePriorStudies(
  studies: PriorStudyRow[],
  reports: PriorReportRow[],
): PriorStudySummary[] {
  return studies.map((s) => {
    const report = pickBestReport(s.id, reports);
    const finalReport = s.finalReport ?? s.prelimReport ?? report?.body ?? null;
    return {
      id: s.id,
      accessionNumber: s.accessionNumber,
      modality: s.modality,
      bodyPart: s.bodyPart,
      studyDate: s.studyDate,
      // testName falls back to the study description so the dropdown is never blank.
      testName: s.testName ?? s.studyDescription ?? s.modality,
      testCode: s.testCode,
      impression: report?.impression ?? null,
      finalReport,
      reportedBy: s.finalReportedBy ?? s.prelimReportedBy ?? null,
      reportedAt: toIso(s.finalReportedAt ?? s.prelimReportedAt),
      status: s.status,
      reportId: report?.id ?? null,
      reportStatus: report?.status ?? null,
    };
  });
}
