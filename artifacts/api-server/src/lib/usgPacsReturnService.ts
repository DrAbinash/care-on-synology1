/**
 * usgPacsReturnService — LIVE eligibility bridge for P6 report→PACS return
 * (final-integration wiring; not a pure core).
 *
 * Assembles real study / patient / signed-report / PCPNDT state and runs the
 * merged, fail-closed policy `planUsgPacsReturn`. The actual push is the
 * canonical `archiveReportToPacs`, invoked from the USG_PACS_RETURN_JOB durable
 * handler — this service NEVER pushes directly and never finalizes a report.
 */

import { db } from "@workspace/db";
import {
  radiologyStudiesTable, patientsTable, patientReportsTable, patientReportAmendmentsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { planUsgPacsReturn, type PacsReturnDecision } from "./usgPacsReturnPolicy";
import { isObstetricUsgStudy } from "./usgModality";
import { checkPcpndtFormFCompliance } from "./pcpndtCompliance";

export interface ReturnEvaluation extends PacsReturnDecision {
  studyId: number;
  reportId: number | null;
}

/** Evaluate whether a study's signed report may return to PACS, and its tags. */
export async function evaluateUsgPacsReturn(studyId: number): Promise<ReturnEvaluation | { error: string }> {
  const [s] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).limit(1);
  if (!s) return { error: "study_not_found" };
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, s.patientId)).limit(1);
  const [report] = await db.select().from(patientReportsTable)
    .where(eq(patientReportsTable.studyId, studyId)).orderBy(desc(patientReportsTable.id)).limit(1);

  // Supersession: an amendment whose originalReportId is this report.
  let supersededByReportId: number | null = null;
  let sequenceNumber = 1;
  if (report) {
    const [amend] = await db.select().from(patientReportAmendmentsTable)
      .where(eq(patientReportAmendmentsTable.originalReportId, report.id)).limit(1);
    if (amend) supersededByReportId = amend.amendedReportId ?? null;
    const [asAmended] = await db.select().from(patientReportAmendmentsTable)
      .where(eq(patientReportAmendmentsTable.amendedReportId, report.id)).limit(1);
    if (asAmended?.sequenceNumber) sequenceNumber = asAmended.sequenceNumber;
  }

  const isObstetric = isObstetricUsgStudy(s.modality, s.studyDescription ?? "");
  const pcpndt = isObstetric ? await checkPcpndtFormFCompliance(s.patientId) : null;

  const decision = planUsgPacsReturn(
    {
      studyId: s.id,
      studyInstanceUid: s.studyInstanceUid ?? null,
      accessionNumber: s.accessionNumber ?? null,
      patientId: s.patientId,
      patientName: patient ? `${patient.firstName ?? ""} ${patient.lastName ?? ""}`.trim() : null,
      patientDisplayId: patient?.patientId ?? null,
      modality: s.modality,
      isObstetric,
      studyDate: s.studyDate ? String(s.studyDate) : null,
      referringDoctor: s.referringDoctor ?? null,
    },
    { reportId: report?.id ?? null, status: report?.status ?? null, sequenceNumber, supersededByReportId },
    pcpndt ? { compliant: pcpndt.compliant, errors: pcpndt.errors } : null,
  );

  return { ...decision, studyId, reportId: report?.id ?? null };
}
