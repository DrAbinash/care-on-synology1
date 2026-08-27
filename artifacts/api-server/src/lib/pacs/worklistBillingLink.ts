/**
 * Auto-link a PACS worklist row to a billed radiology_studies row when the
 * patient was billed but intake never set radiology_worklist.study_id.
 *
 * Order:
 * 1. Unique normalized accession (MWL work-id) → GREEN
 * 2. Patient-scoped fuzzy score (same patientId) → unique GREEN winner
 * 3. Cross-patient name ± referral (no-MWL clinic) → unique YELLOW + PENDING review
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
import { and, desc, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { calculateMatchScore, normalizeAccessionKey, type DicomInput } from "./matchingEngine";
import { pickUniqueRow } from "../radiologyIdentity";
import {
  NAME_REFERRAL_AUTO_DAY_RADIUS,
  capNameReferralAutoScore,
  rankBillCandidate,
  selectUniqueNameReferralAutoLink,
  studyDateSearchWindow,
} from "./nameReferralLink";

const AUTO_LINK_MIN_POINTS = 45;
/** Unique GREEN winner must beat the next eligible candidate by this gap. */
const AUTO_LINK_UNIQUE_GAP = 20;

export function selectUniqueAutoLinkCandidate(
  candidates: Array<{ studyId: number; points: number; score: string }>,
  minGap = AUTO_LINK_UNIQUE_GAP,
): { studyId: number; points: number; score: string } | null {
  const eligible = [...candidates].sort((a, b) => b.points - a.points);
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0]!;
  const top = eligible[0]!;
  const second = eligible[1]!;
  if (top.score === "GREEN" && top.points - second.points >= minGap) return top;
  return null;
}

export interface AutoLinkResult {
  linked: boolean;
  studyId?: number;
  matchPoints?: number;
  matchScore?: string;
  reason?: string;
  method?: string;
}

type WorklistRow = typeof radiologyWorklistTable.$inferSelect;

type StudyJoinRow = {
  id: number;
  accessionNumber: string;
  modality: string;
  studyDescription: string | null;
  studyDate: string;
  patientId: number;
  referringDoctor: string | null;
  patientName: string;
  patientUHID: string | null;
  age: string;
  sex: string | null;
  testName: string;
  billNumber: string | null;
};

function dicomFromWorklist(worklistItem: WorklistRow): DicomInput {
  return {
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
}

const studySelect = {
  id: radiologyStudiesTable.id,
  accessionNumber: radiologyStudiesTable.accessionNumber,
  modality: radiologyStudiesTable.modality,
  studyDescription: radiologyStudiesTable.studyDescription,
  studyDate: radiologyStudiesTable.studyDate,
  patientId: radiologyStudiesTable.patientId,
  referringDoctor: radiologyStudiesTable.referringDoctor,
  patientName: sql<string>`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
  patientUHID: patientsTable.patientId,
  age: sql<string>`concat(${patientsTable.ageValue}, ' ', ${patientsTable.ageUnit})`,
  sex: patientsTable.gender,
  testName: testsTable.name,
  billNumber: billsTable.billNumber,
};

async function applyWorklistStudyLink(opts: {
  worklistItem: WorklistRow;
  studyId: number;
  actor: string;
  matchPoints: number;
  matchScore: string;
  method: string;
  reason: string;
}): Promise<AutoLinkResult> {
  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, opts.studyId))
    .limit(1);

  if (!study) {
    return { linked: false, reason: "matched study row missing" };
  }

  await db
    .update(radiologyWorklistTable)
    .set({
      studyId: opts.studyId,
      patientId: study.patientId,
      updatedAt: new Date(),
    })
    .where(eq(radiologyWorklistTable.id, opts.worklistItem.id));

  const studyUpdates: Partial<typeof radiologyStudiesTable.$inferInsert> = {
    updatedAt: new Date(),
    status: "acquired",
    acquiredAt: new Date(),
  };
  if (opts.worklistItem.studyInstanceUID && !study.studyInstanceUid) {
    studyUpdates.studyInstanceUid = opts.worklistItem.studyInstanceUID;
  }
  await db
    .update(radiologyStudiesTable)
    .set(studyUpdates)
    .where(eq(radiologyStudiesTable.id, opts.studyId));

  await db.insert(radiologyAuditLogTable).values({
    worklistId: opts.worklistItem.id,
    accessionNumber: opts.worklistItem.accessionNumber,
    action: "AUTO_LINK_BILLED",
    actor: opts.actor,
    details: JSON.stringify({
      studyId: opts.studyId,
      matchPoints: opts.matchPoints,
      matchScore: opts.matchScore,
      method: opts.method,
    }),
  });

  return {
    linked: true,
    studyId: opts.studyId,
    matchPoints: opts.matchPoints,
    matchScore: opts.matchScore,
    reason: opts.reason,
    method: opts.method,
  };
}

async function alreadyLinkedStudyIds(): Promise<number[]> {
  const rows = await db
    .select({ studyId: radiologyWorklistTable.studyId })
    .from(radiologyWorklistTable)
    .where(sql`${radiologyWorklistTable.studyId} is not null`);
  return rows.map((r) => r.studyId!).filter((id) => Number.isFinite(id));
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

  // Fast path: normalized accession is the MWL work-id.
  const accKey = normalizeAccessionKey(worklistItem.accessionNumber);
  if (accKey) {
    const accRows = await db
      .select({
        id: radiologyStudiesTable.id,
        patientId: radiologyStudiesTable.patientId,
        accessionNumber: radiologyStudiesTable.accessionNumber,
      })
      .from(radiologyStudiesTable)
      .where(
        sql`lower(regexp_replace(coalesce(${radiologyStudiesTable.accessionNumber}, ''), '[^a-zA-Z0-9]', '', 'g')) = ${accKey}`,
      );
    const uniqueAcc = pickUniqueRow(accRows);
    const byAcc = uniqueAcc.status === "unique" ? uniqueAcc.row : null;
    if (byAcc) {
      return applyWorklistStudyLink({
        worklistItem,
        studyId: byAcc.id,
        actor,
        matchPoints: 50,
        matchScore: "GREEN",
        method: "accession-normalized",
        reason: "linked by accession number",
      });
    }
  }

  const dicomInput = dicomFromWorklist(worklistItem);

  // Patient-scoped fuzzy path (same ERP patientId on the worklist row).
  if (worklistItem.patientId) {
    const studies = await db
      .select(studySelect)
      .from(radiologyStudiesTable)
      .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
      .innerJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
      .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
      .where(eq(radiologyStudiesTable.patientId, worklistItem.patientId))
      .orderBy(desc(radiologyStudiesTable.createdAt))
      .limit(50);

    const eligible: { studyId: number; points: number; score: string }[] = [];
    for (const s of studies as StudyJoinRow[]) {
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
        referringDoctor: s.referringDoctor,
      });
      if (match.score === "RED") continue;
      if (match.points < AUTO_LINK_MIN_POINTS) continue;
      eligible.push({ studyId: s.id, points: match.points, score: match.score });
    }

    const best = selectUniqueAutoLinkCandidate(eligible);
    if (best) {
      return applyWorklistStudyLink({
        worklistItem,
        studyId: best.studyId,
        actor,
        matchPoints: best.points,
        matchScore: best.score,
        method: "patient-scoped-score",
        reason: "auto-linked to billed study",
      });
    }
  }

  // Cross-patient name ± referral (no MWL / random modality PatientID).
  const window = studyDateSearchWindow(worklistItem.studyDate, NAME_REFERRAL_AUTO_DAY_RADIUS);
  if (!window) {
    return {
      linked: false,
      reason: worklistItem.patientId
        ? "no confident billed-study match (try DICOM Match Center)"
        : "no study date for name±referral auto-link (try DICOM Match Center)",
    };
  }

  const linkedIds = await alreadyLinkedStudyIds();
  const dateCond = and(
    gte(radiologyStudiesTable.studyDate, window.from),
    lte(radiologyStudiesTable.studyDate, window.to),
  );
  const whereClause =
    linkedIds.length > 0
      ? and(dateCond, notInArray(radiologyStudiesTable.id, linkedIds))
      : dateCond;

  const nameStudies = await db
    .select(studySelect)
    .from(radiologyStudiesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .innerJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
    .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
    .where(whereClause)
    .orderBy(desc(radiologyStudiesTable.createdAt))
    .limit(300);

  const ranked = (nameStudies as StudyJoinRow[]).map((s) =>
    rankBillCandidate(dicomInput, {
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
      referringDoctor: s.referringDoctor,
    }),
  );

  const nameBest = selectUniqueNameReferralAutoLink(ranked);
  if (!nameBest) {
    const eligibleCount = ranked.filter((r) => r.autoLinkEligible).length;
    return {
      linked: false,
      reason:
        eligibleCount > 1
          ? "ambiguous name±referral match (try DICOM Match Center)"
          : "no confident name±referral match (try DICOM Match Center)",
    };
  }

  const capped = capNameReferralAutoScore(nameBest.score);
  return applyWorklistStudyLink({
    worklistItem,
    studyId: nameBest.studyId,
    actor,
    matchPoints: nameBest.points,
    matchScore: capped,
    method: "name-referral",
    reason: "auto-linked by patient name ± referral (review in Match Center)",
  });
}
