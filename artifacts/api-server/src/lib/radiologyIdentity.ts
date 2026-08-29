/**
 * Canonical radiology identity helpers.
 *
 * `patient_reports.study_id` on the Reporting Workspace finalize path stores
 * the radiology_worklist.id (not radiology_studies.id). Resolve both shapes
 * via resolveWorklistFromStudyRef() so readers cannot confuse the two.
 */
import { db } from "@workspace/db";
import {
  patientReportsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RadiologyIdentityError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = "RadiologyIdentityError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export type UniquePick<T> =
  | { status: "none" }
  | { status: "unique"; row: T }
  | { status: "ambiguous"; count: number };

export function pickUniqueRow<T>(rows: T[]): UniquePick<T> {
  if (rows.length === 0) return { status: "none" };
  if (rows.length === 1) return { status: "unique", row: rows[0]! };
  return { status: "ambiguous", count: rows.length };
}

export function matchAllowsFinalize(wl: {
  matchScore?: string | null;
  matchDecision?: string | null;
}): boolean {
  const decision = String(wl.matchDecision ?? "").toUpperCase();
  const score = String(wl.matchScore ?? "").toUpperCase();
  return decision === "APPROVED" || score === "GREEN";
}

export function isRadiologyReportType(type: string, testDepartment?: string | null): boolean {
  if (type === "radiology") return true;
  return !!testDepartment && /(USG|MRI|CT|X-?RAY|MAMMO|DEXA|RAD)/i.test(testDepartment);
}

export type WorklistIdentityRow = typeof radiologyWorklistTable.$inferSelect;
export type BilledStudyRow = typeof radiologyStudiesTable.$inferSelect;

export async function resolveWorklistFromStudyRef(
  studyRef: number | null | undefined,
): Promise<WorklistIdentityRow | null> {
  if (!studyRef || !Number.isFinite(studyRef) || studyRef <= 0) return null;
  const id = Math.trunc(studyRef);
  const [byWorklistId] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, id))
    .limit(1);
  if (byWorklistId) return byWorklistId;
  const [byBilledStudyId] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyId, id))
    .limit(1);
  return byBilledStudyId ?? null;
}

export async function loadBilledStudy(studyId: number | null | undefined): Promise<BilledStudyRow | null> {
  if (!studyId || !Number.isFinite(studyId) || studyId <= 0) return null;
  const [row] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, Math.trunc(studyId)))
    .limit(1);
  return row ?? null;
}

export type BoundRadiologyIdentity = {
  worklist: WorklistIdentityRow;
  billedStudy: BilledStudyRow | null;
  patientId: number;
  testId: number;
  orderId: number | null;
  orderTestId: number | null;
  billId: number | null;
  /** Always the worklist row id — store this on patient_reports.study_id. */
  worklistId: number;
};

/**
 * Server-authoritative bind for radiology report create / finalize.
 * Derives patient/test/order from worklist + billed study; rejects client disagreement.
 */
export async function bindRadiologyReportIdentity(input: {
  studyRef?: number | null;
  worklistId?: number | null;
  patientId?: number | null;
  testId?: number | null;
  orderId?: number | null;
  orderTestId?: number | null;
  requireMatchGate?: boolean;
}): Promise<BoundRadiologyIdentity> {
  const worklistId = input.worklistId && Number.isFinite(input.worklistId) ? Math.trunc(input.worklistId) : null;
  const studyRef = input.studyRef && Number.isFinite(input.studyRef) ? Math.trunc(input.studyRef) : null;

  let worklist: WorklistIdentityRow | null = null;
  if (worklistId) {
    const [row] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    worklist = row ?? null;
  }
  if (!worklist && studyRef) {
    worklist = await resolveWorklistFromStudyRef(studyRef);
  }
  if (!worklist) {
    throw new RadiologyIdentityError(
      409,
      "WORKLIST_REQUIRED",
      "Radiology finalize requires a linked worklist/study. Open the study from the worklist.",
    );
  }

  if (input.requireMatchGate !== false && !matchAllowsFinalize(worklist)) {
    const reason = worklist.matchScore === "YELLOW" ? "needs review" : "mismatch / possible wrong study";
    throw new RadiologyIdentityError(
      409,
      "MATCH_GATE_BLOCKED",
      `Report finalization is blocked. Match score is ${worklist.matchScore ?? "RED"} (${reason}). Approve the match in Match Center, or relink the correct study.`,
    );
  }

  if (!worklist.patientId) {
    throw new RadiologyIdentityError(
      409,
      "PATIENT_UNMATCHED",
      "This DICOM study is not linked to a CARE patient. Resolve identity in Match Center before finalizing.",
    );
  }

  if (input.patientId && Number(input.patientId) !== worklist.patientId) {
    throw new RadiologyIdentityError(
      409,
      "PATIENT_MISMATCH",
      "Submitted patient does not match the worklist patient for this study.",
    );
  }

  const billedStudy = await loadBilledStudy(worklist.studyId);
  if (billedStudy) {
    if (billedStudy.patientId !== worklist.patientId) {
      throw new RadiologyIdentityError(
        409,
        "STUDY_PATIENT_MISMATCH",
        "Linked billed study belongs to a different patient than the worklist row.",
      );
    }
    if (billedStudy.status === "cancelled") {
      throw new RadiologyIdentityError(
        409,
        "ORDER_CANCELLED",
        "The billed radiology order for this study is cancelled. It cannot be newly finalized.",
      );
    }
    if (input.testId && Number(input.testId) !== billedStudy.testId) {
      throw new RadiologyIdentityError(
        409,
        "TEST_MISMATCH",
        "Submitted test does not match the billed radiology study.",
      );
    }
    if (input.orderId && billedStudy.orderId && Number(input.orderId) !== billedStudy.orderId) {
      throw new RadiologyIdentityError(
        409,
        "ORDER_MISMATCH",
        "Submitted order does not match the billed radiology study.",
      );
    }
    return {
      worklist,
      billedStudy,
      patientId: worklist.patientId,
      testId: billedStudy.testId,
      orderId: billedStudy.orderId ?? null,
      orderTestId: billedStudy.orderTestId ?? null,
      billId: billedStudy.billId ?? null,
      worklistId: worklist.id,
    };
  }

  if (!input.testId) {
    throw new RadiologyIdentityError(
      409,
      "TEST_REQUIRED",
      "No billed radiology test is linked to this study. Link the billed study in Match Center before creating a patient report.",
    );
  }

  return {
    worklist,
    billedStudy: null,
    patientId: worklist.patientId,
    testId: Number(input.testId),
    orderId: input.orderId ? Number(input.orderId) : null,
    orderTestId: input.orderTestId ? Number(input.orderTestId) : null,
    billId: null,
    worklistId: worklist.id,
  };
}

export async function assertReportBelongsToWorklist(reportId: number, worklist: WorklistIdentityRow): Promise<void> {
  const [report] = await db
    .select()
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, reportId))
    .limit(1);
  if (!report) {
    throw new RadiologyIdentityError(404, "REPORT_NOT_FOUND", "Report not found.");
  }
  if (report.patientId !== worklist.patientId) {
    throw new RadiologyIdentityError(
      409,
      "REPORT_PATIENT_MISMATCH",
      "Report patient does not match this worklist study.",
    );
  }
  if (report.studyId) {
    const reportWorklist = await resolveWorklistFromStudyRef(report.studyId);
    if (reportWorklist && reportWorklist.id !== worklist.id) {
      throw new RadiologyIdentityError(
        409,
        "REPORT_WORKLIST_MISMATCH",
        "Report is bound to a different worklist study.",
      );
    }
  }
}

export async function claimWorklistForFinalize(tx: DbTx, worklistId: number): Promise<WorklistIdentityRow> {
  await tx.execute(sql`SELECT id FROM radiology_worklist WHERE id = ${worklistId} FOR UPDATE`);
  const [row] = await tx
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);
  if (!row) {
    throw new RadiologyIdentityError(404, "WORKLIST_NOT_FOUND", "Worklist entry not found.");
  }
  if (row.status === "REPORT_FINAL" || row.status === "DELIVERED") {
    throw new RadiologyIdentityError(
      409,
      "ALREADY_FINALIZED",
      "This study already has a final report.",
    );
  }
  if (row.reportId) {
    throw new RadiologyIdentityError(
      409,
      "ALREADY_FINALIZED",
      "This study already has a final report.",
    );
  }
  return row;
}

export async function assertDraftWritable(opts: {
  draftId?: number | null;
  worklistId?: number | null;
  studyId?: number | null;
  patientId?: number | null;
}): Promise<void> {
  const worklist = opts.worklistId
    ? (await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, opts.worklistId)).limit(1))[0]
    : await resolveWorklistFromStudyRef(opts.studyId ?? null);

  if (worklist) {
    if (opts.patientId && worklist.patientId && Number(opts.patientId) !== worklist.patientId) {
      throw new RadiologyIdentityError(409, "DRAFT_PATIENT_MISMATCH", "Draft patient does not match the worklist patient.");
    }
    if (worklist.status === "REPORT_FINAL" || worklist.status === "DELIVERED" || worklist.reportId) {
      throw new RadiologyIdentityError(409, "REPORT_LOCKED", "This study already has a final report. Use amend instead of editing the draft.");
    }
  }

  if (opts.draftId) {
    const [draft] = await db
      .select()
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, opts.draftId))
      .limit(1);
    if (!draft) {
      throw new RadiologyIdentityError(404, "DRAFT_NOT_FOUND", "Draft not found.");
    }
    if (draft.finalReportId || draft.status === "FINAL") {
      throw new RadiologyIdentityError(409, "REPORT_LOCKED", "This draft has already been finalized and cannot be overwritten.");
    }
    if (opts.worklistId && draft.worklistId && draft.worklistId !== opts.worklistId) {
      throw new RadiologyIdentityError(409, "DRAFT_WORKLIST_MISMATCH", "Draft belongs to a different worklist study.");
    }
    if (opts.patientId && draft.patientId && draft.patientId !== opts.patientId) {
      throw new RadiologyIdentityError(409, "DRAFT_PATIENT_MISMATCH", "Draft belongs to a different patient.");
    }
  }
}

export async function expectedStudyInstanceUidForDraft(draftId: number): Promise<string | null> {
  const [draft] = await db
    .select()
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);
  if (!draft) return null;
  if (draft.worklistId) {
    const [wl] = await db
      .select({ uid: radiologyWorklistTable.studyInstanceUID })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, draft.worklistId))
      .limit(1);
    if (wl?.uid) return wl.uid;
  }
  if (draft.studyId) {
    const billed = await loadBilledStudy(draft.studyId);
    if (billed?.studyInstanceUid) return billed.studyInstanceUid;
    const wl = await resolveWorklistFromStudyRef(draft.studyId);
    if (wl?.studyInstanceUID) return wl.studyInstanceUID;
  }
  return null;
}

export async function assertImageUidBelongsToDraft(draftId: number, studyInstanceUid?: string | null): Promise<void> {
  const expected = await expectedStudyInstanceUidForDraft(draftId);
  if (!studyInstanceUid) {
    if (expected) {
      throw new RadiologyIdentityError(409, "IMAGE_STUDY_REQUIRED", "Selected images must include the study UID of the open study.");
    }
    return;
  }
  if (expected && studyInstanceUid !== expected) {
    throw new RadiologyIdentityError(
      409,
      "IMAGE_STUDY_MISMATCH",
      "Selected image belongs to a different DICOM study than this report.",
    );
  }
}

export async function imageRefsLocked(draftId: number): Promise<boolean> {
  const [draft] = await db
    .select()
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.id, draftId))
    .limit(1);
  if (!draft) return false;
  if (draft.finalReportId || draft.status === "FINAL") return true;
  const worklist = draft.worklistId
    ? (await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, draft.worklistId)).limit(1))[0]
    : await resolveWorklistFromStudyRef(draft.studyId);
  if (worklist && (worklist.status === "REPORT_FINAL" || worklist.status === "DELIVERED" || worklist.reportId)) {
    return true;
  }
  return false;
}

/**
 * Resolve the DICOM StudyInstanceUID from an authorized worklist row.
 * Callers must not trust a client-supplied UID unless it matches this row.
 */
export async function resolveAuthorizedStudyUid(opts: {
  worklistId?: number | null;
  studyInstanceUID?: string | null;
}): Promise<string> {
  const worklistId =
    opts.worklistId && Number.isFinite(opts.worklistId) ? Math.trunc(opts.worklistId) : null;
  if (!worklistId) {
    throw new RadiologyIdentityError(
      400,
      "WORKLIST_REQUIRED",
      "worklistId is required to resolve the DICOM study.",
    );
  }
  const [wl] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);
  if (!wl) {
    throw new RadiologyIdentityError(404, "WORKLIST_NOT_FOUND", "Worklist entry not found.");
  }
  if (!wl.studyInstanceUID) {
    throw new RadiologyIdentityError(409, "NO_STUDY_UID", "Worklist row has no StudyInstanceUID.");
  }
  if (opts.studyInstanceUID && opts.studyInstanceUID !== wl.studyInstanceUID) {
    throw new RadiologyIdentityError(
      409,
      "STUDY_UID_MISMATCH",
      "Submitted StudyInstanceUID does not match the worklist study.",
    );
  }
  return wl.studyInstanceUID;
}
