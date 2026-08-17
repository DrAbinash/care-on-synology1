/**
 * Auto-link a PACS worklist row to a billed radiology_studies row when the
 * patient was billed but intake never set radiology_worklist.study_id.
 */
import { db } from "@workspace/db";
import {
  radiologyWorklistTable,
  radiologyStudiesTable,
  radiologyAuditLogTable,
  patientsTable,
  testsTable,
  billsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { calculateMatchScore, normalizeAccessionKey } from "./matchingEngine";

const AUTO_LINK_MIN_POINTS = 45;

export interface AutoLinkResult {
  linked: boolean;
  studyId?: number;
  matchPoints?: number;
  matchScore?: string;
  reason?: string;
}

export async function autoLinkBilledStudyForWorklist(
  worklistId: number,
  actor = "system",
): Promise<AutoLinkResult> {
  const [worklistItem] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);

  if (!worklistItem) {
    return { linked: false, reason: "worklist row not found" };
  }

  if (worklistItem.studyId) {
    return { linked: true, studyId: worklistItem.studyId, reason: "already linked" };
  }

  // Fast path: normalized accession is the MWL work-id. Prefer this over
  // patient-scoped fuzzy match so rows with images still link when PatientID
  // on the console was mistyped or auto-created a different patient.
  const accKey = normalizeAccessionKey(worklistItem.accessionNumber);
  if (accKey) {
    const [byAcc] = await db
      .select({
        id: radiologyStudiesTable.id,
        patientId: radiologyStudiesTable.patientId,
        accessionNumber: radiologyStudiesTable.accessionNumber,
      })
      .from(radiologyStudiesTable)
      .where(
        sql`lower(regexp_replace(coalesce(${radiologyStudiesTable.accessionNumber}, ''), '[^a-zA-Z0-9]', '', 'g')) = ${accKey}`,
      )
      .limit(1);
    if (byAcc) {
      await db
        .update(radiologyWorklistTable)
        .set({
          studyId: byAcc.id,
          patientId: byAcc.patientId,
          updatedAt: new Date(),
        })
        .where(eq(radiologyWorklistTable.id, worklistId));

      const [study] = await db
        .select()
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, byAcc.id))
        .limit(1);
      if (study) {
        const studyUpdates: Partial<typeof radiologyStudiesTable.$inferInsert> = {
          updatedAt: new Date(),
          status: "acquired",
          acquiredAt: new Date(),
        };
        if (worklistItem.studyInstanceUID && !study.studyInstanceUid) {
          studyUpdates.studyInstanceUid = worklistItem.studyInstanceUID;
        }
        await db
          .update(radiologyStudiesTable)
          .set(studyUpdates)
          .where(eq(radiologyStudiesTable.id, byAcc.id));
      }

      await db.insert(radiologyAuditLogTable).values({
        worklistId,
        accessionNumber: worklistItem.accessionNumber,
        action: "AUTO_LINK_BILLED",
        actor,
        details: JSON.stringify({
          studyId: byAcc.id,
          matchPoints: 50,
          matchScore: "GREEN",
          method: "accession-normalized",
        }),
      });

      return {
        linked: true,
        studyId: byAcc.id,
        matchPoints: 50,
        matchScore: "GREEN",
        reason: "linked by accession number",
      };
    }
  }

  if (!worklistItem.patientId) {
    return { linked: false, reason: "no patient linked on worklist row" };
  }

  const studies = await db
    .select({
      id: radiologyStudiesTable.id,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      modality: radiologyStudiesTable.modality,
      studyDescription: radiologyStudiesTable.studyDescription,
      studyDate: radiologyStudiesTable.studyDate,
      patientId: radiologyStudiesTable.patientId,
      patientName: sql<string>`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
      patientUHID: patientsTable.patientId,
      age: sql<string>`concat(${patientsTable.ageValue}, ' ', ${patientsTable.ageUnit})`,
      sex: patientsTable.gender,
      testName: testsTable.name,
      billNumber: billsTable.billNumber,
    })
    .from(radiologyStudiesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .innerJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
    .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
    .where(eq(radiologyStudiesTable.patientId, worklistItem.patientId))
    .orderBy(desc(radiologyStudiesTable.createdAt))
    .limit(50);

  if (studies.length === 0) {
    return { linked: false, reason: "no billed radiology studies for this patient" };
  }

  const dicomInput = {
    patientName: worklistItem.patientName,
    dicomPatientId: worklistItem.dicomPatientId,
    age: worklistItem.age,
    sex: worklistItem.sex,
    modality: worklistItem.modality,
    studyDescription: worklistItem.studyDescription,
    accessionNumber: worklistItem.accessionNumber ?? "",
    studyDate: worklistItem.studyDate,
    studyTime: null,
    studyInstanceUID: worklistItem.studyInstanceUID,
    referringDoctor: worklistItem.referringDoctor,
  };

  let best: { studyId: number; points: number; score: string } | null = null;

  for (const s of studies) {
    const match = calculateMatchScore(dicomInput, {
      id: s.id,
      patientId: s.patientId,
      patientName: String(s.patientName || ""),
      patientUHID: s.patientUHID,
      age: String(s.age || ""),
      sex: s.sex,
      testName: s.testName,
      modality: s.modality,
      accessionNumber: s.accessionNumber,
      billNumber: s.billNumber,
      studyDate: s.studyDate,
    });

    if (match.score === "RED") continue;
    if (match.points < AUTO_LINK_MIN_POINTS) continue;
    if (!best || match.points > best.points) {
      best = { studyId: s.id, points: match.points, score: match.score };
    }
  }

  if (!best) {
    return { linked: false, reason: "no confident billed-study match (try DICOM Match Center)" };
  }

  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, best.studyId))
    .limit(1);

  if (!study) {
    return { linked: false, reason: "matched study row missing" };
  }

  await db
    .update(radiologyWorklistTable)
    .set({
      studyId: best.studyId,
      patientId: study.patientId,
      updatedAt: new Date(),
    })
    .where(eq(radiologyWorklistTable.id, worklistId));

  const studyUpdates: Partial<typeof radiologyStudiesTable.$inferInsert> = {
    updatedAt: new Date(),
    status: "acquired",
    acquiredAt: new Date(),
  };
  if (worklistItem.studyInstanceUID && !study.studyInstanceUid) {
    studyUpdates.studyInstanceUid = worklistItem.studyInstanceUID;
  }
  await db
    .update(radiologyStudiesTable)
    .set(studyUpdates)
    .where(eq(radiologyStudiesTable.id, best.studyId));

  await db.insert(radiologyAuditLogTable).values({
    worklistId,
    accessionNumber: worklistItem.accessionNumber,
    action: "AUTO_LINK_BILLED",
    actor,
    details: JSON.stringify({
      studyId: best.studyId,
      matchPoints: best.points,
      matchScore: best.score,
    }),
  });

  return {
    linked: true,
    studyId: best.studyId,
    matchPoints: best.points,
    matchScore: best.score,
    reason: "auto-linked to billed study",
  };
}
