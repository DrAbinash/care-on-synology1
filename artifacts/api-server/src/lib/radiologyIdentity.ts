/**
 * Canonical radiology identity helpers.
 *
 * `patient_reports.study_id` on the Reporting Workspace finalize path stores
 * the radiology_worklist.id (not radiology_studies.id). Resolve both shapes
 * via resolveWorklistFromStudyRef() so readers cannot confuse the two.
 */
import { db } from "@workspace/db";
import {
  orderTestsTable,
  ordersTable,
  patientReportsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { extractCareLinkedStudy } from "./structuredJsonColumn";

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

export type FinalizeMatchClassification =
  | "ALLOWED"
  | "CONFIRM_UNLINKED"
  | "REFUSED";

/**
 * Parse a row's matchWarnings (JSON string, array, or null) into strings.
 */
function parseMatchWarnings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((w) => String(w));
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map((w) => String(w));
      if (parsed != null) return [String(parsed)];
    } catch {
      return [raw];
    }
  }
  return [];
}

/**
 * The finalize match policy — one classification shared by every gate.
 *
 * Owner-approved policy (A3): when a reporting workspace has independently
 * verified CARE billing identity — correct patient, correct billed
 * examination, and the reporting study belongs to that patient and
 * examination — the DICOM association's GREEN/APPROVED status is an
 * unnecessary second requirement. Concretely:
 *
 *   - APPROVED decision: a radiologist already answered "this study belongs
 *     to this billed examination" in Match Center. Allowed.
 *   - GREEN: the archive and the bill agree. Allowed.
 *   - YELLOW: consistent but incomplete association (typically accessionless
 *     USG where the name spelling differs slightly). No identity contradiction
 *     is present — allowed. This was the state that blocked live ultrasound
 *     reporting with 409s while the billing identity was never in doubt.
 *   - REJECTED decision: a human rejected the pairing. Refused, always — a
 *     rejection must veto even a high-scoring study.
 *   - RED: the matcher recorded an identity contradiction (modality mismatch,
 *     or a complete name mismatch without accession proof). Refused — this is
 *     the wrong-patient / wrong-examination protection.
 *   - Absent DICOM association (no linked study and the only recorded state is
 *     NO_LINKED_STUDY, with no contradictory evidence): not a refusal — but
 *     not an automatic allow either. The caller must collect ONE explicit
 *     radiologist confirmation ("finalize without linked images?") and pass
 *     confirmUnlinked; the surrounding bind checks still prove patient,
 *     billed examination and study ownership.
 *
 * Partial-shape callers (tests pass only matchScore/matchDecision) can never
 * reach CONFIRM_UNLINKED: hasLinkedStudy is undefined for them, and the
 * classifier fails closed exactly like the old gate did.
 */
export function classifyFinalizeMatch(wl: {
  matchScore?: string | null;
  matchDecision?: string | null;
  matchWarnings?: unknown;
  /** Present (true/false) only when the caller holds the full row. */
  hasLinkedStudy?: boolean;
}): FinalizeMatchClassification {
  const decision = String(wl.matchDecision ?? "").toUpperCase();
  if (decision === "REJECTED") return "REFUSED";
  if (decision === "APPROVED") return "ALLOWED";
  const score = String(wl.matchScore ?? "").toUpperCase();
  if (score === "GREEN" || score === "YELLOW") return "ALLOWED";
  if (wl.hasLinkedStudy === false) {
    const warnings = parseMatchWarnings(wl.matchWarnings);
    const contradictory = warnings.some((w) =>
      /MODALITY_MISMATCH|NAME_MISMATCH|STUDY_NOT_FOUND/.test(w),
    );
    if (!contradictory) return "CONFIRM_UNLINKED";
  }
  return "REFUSED";
}

/**
 * Back-compat boolean gate: true only when finalize needs no extra
 * confirmation. CONFIRM_UNLINKED and REFUSED both return false — callers
 * that want to offer the unlinked confirmation must use
 * classifyFinalizeMatch() instead of this.
 */
export function matchAllowsFinalize(wl: {
  matchScore?: string | null;
  matchDecision?: string | null;
  matchWarnings?: unknown;
  hasLinkedStudy?: boolean;
}): boolean {
  return classifyFinalizeMatch(wl) === "ALLOWED";
}

/**
 * Match Center explicit approval — persisted on radiology_worklist.match_decision.
 *
 * One spelling on purpose: the clause decides whether a human has already answered "which
 * patient is this", and it is read by DICOM re-intake, by bill auto-linking and by anything else
 * that could re-derive the answer from data. Two copies of it would drift the first time the
 * decision vocabulary grows.
 */
export function isApprovedMatchDecision(decision: string | null | undefined): boolean {
  return String(decision ?? "").toUpperCase() === "APPROVED";
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
  /** One explicit radiologist confirmation for a billed examination with no linked images. */
  confirmUnlinked?: boolean;
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

  if (input.requireMatchGate !== false) {
    const matchClass = classifyFinalizeMatch({
      matchScore: worklist.matchScore,
      matchDecision: worklist.matchDecision,
      matchWarnings: worklist.matchWarnings,
      hasLinkedStudy: worklist.studyId != null,
    });
    if (matchClass === "REFUSED") {
      throw new RadiologyIdentityError(
        409,
        "MATCH_GATE_BLOCKED",
        `Report finalization is blocked. Match score is ${worklist.matchScore ?? "RED"} (mismatch / possible wrong study). Approve the correct match in Match Center, or relink the correct study.`,
      );
    }
    if (matchClass === "CONFIRM_UNLINKED" && input.confirmUnlinked !== true) {
      throw new RadiologyIdentityError(
        409,
        "UNLINKED_CONFIRM_REQUIRED",
        "No images are linked to this billed examination. One explicit confirmation is required to finalize without images.",
      );
    }
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

  // No billed study row exists to compare against, which leaves the caller's own
  // `testId` / `orderId` as the only evidence of what is being reported — and an
  // unverified claim here is how patient A's report gets billed against patient
  // B's test. The Reporting Workspace reads its prefill from
  // `GET /api/patient-reports/from-study/:id`, which is keyed on
  // `radiology_studies.id`; when it passes the worklist ROW id, whichever study
  // happens to share that number answers, with ITS patient, test, order and bill.
  // Nothing in this file could see that, because every comparison it makes needs
  // a billed study and this branch is the one that has none.
  //
  // So prove the claim against the order it cites, using the same two typed
  // refusals the billed-study branch already uses. A caller that cites no order
  // is left exactly as before: this refuses only pairings that are demonstrably
  // not this patient's, and never a legitimately unbilled study.
  if (input.orderId && Number.isFinite(Number(input.orderId))) {
    const orderId = Math.trunc(Number(input.orderId));
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);
    if (!order || (order.patientId != null && order.patientId !== worklist.patientId)) {
      throw new RadiologyIdentityError(
        409,
        "ORDER_MISMATCH",
        "Submitted order does not belong to this study's patient.",
      );
    }
    const [pairing] = await db
      .select({ id: orderTestsTable.id })
      .from(orderTestsTable)
      .where(
        and(
          eq(orderTestsTable.orderId, orderId),
          eq(orderTestsTable.testId, Math.trunc(Number(input.testId))),
        ),
      )
      .limit(1);
    if (!pairing) {
      throw new RadiologyIdentityError(
        409,
        "TEST_MISMATCH",
        "Submitted test is not on the order cited for this study.",
      );
    }
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
      // One signed document may legitimately cover a second examination, but only when a
      // radiologist combined those two examinations into one report. That decision is already
      // persisted server-side — the draft that produced this report stores the partner worklist row
      // in its structured_json envelope — so the allowance reads it instead of inventing one.
      // The patient equality checked above still runs first, so a combine naming another patient's
      // row cannot reach here as an excuse.
      const authorizedSiblingId = await resolveAuthorizedCombinedSiblingWorklistId({
        studyId: report.studyId,
      });
      if (authorizedSiblingId !== worklist.id) {
        throw new RadiologyIdentityError(
          409,
          "REPORT_WORKLIST_MISMATCH",
          "Report is bound to a different worklist study.",
        );
      }
    }
    return;
  }

  // No study reference at all. Patient equality alone cannot answer "which examination", so the
  // linkage has to come from the database rather than from a guess.
  const linked = await hasAuthoritativeLinkageToWorklist(
    { id: report.id, orderTestId: report.orderTestId },
    { id: worklist.id, reportId: worklist.reportId },
  );
  if (!linked) {
    throw new RadiologyIdentityError(
      409,
      "REPORT_STUDY_UNATTRIBUTED",
      "This report carries no study, and no draft, worklist link or billed examination ties it to this study. Open the report from the study it belongs to, or link the study in Match Center — do not finalize it from a second study of the same patient.",
    );
  }
}

/**
 * Does something already recorded in the database name this worklist row as this report's study?
 *
 * A report can legitimately arrive with `patient_reports.study_id` NULL: the study-less create path is
 * kept on purpose (`routes/patient-reports.ts:1980-1985`), and amendments and legacy free-text rows
 * are never re-keyed. That is a reason to look for a linkage, not a licence to fall back on the
 * patient — one patient with two studies satisfies "same patient" for both of them.
 *
 * Three linkages are authoritative because a person or a bill already wrote them:
 *  1. the worklist row itself names the report (`radiology_worklist.report_id`, set at
 *     `routes/patient-reports.ts:2208` / `:2275`) — finalizing it again claims no new association;
 *  2. a draft promoted to this report (`radiology_report_drafts.final_report_id`, written at
 *     `:1208`) carries the row it was written for in `worklist_id`, or a study reference that
 *     `resolveWorklistFromStudyRef` already knows how to untangle;
 *  3. the report's own `order_test_id`, which is UNIQUE on `radiology_studies` and therefore names one
 *     examination; that study may answer for any worklist row bound to it, because duplicate modality
 *     intake binds two rows to the same examination and both of them ARE that examination.
 *
 * The study side is unique-or-refuse (an `order_test_id` reaching two studies is a data violation, not
 * a choice), and ambiguity there returns false rather than picking one. Nothing here writes, back-fills
 * or re-keys a historical report.
 */
export async function hasAuthoritativeLinkageToWorklist(
  report: { id: number; orderTestId: number | null },
  worklist: { id: number; reportId: number | null },
): Promise<boolean> {
  if (worklist.reportId === report.id) return true;

  const drafts = await db
    .select({ worklistId: radiologyReportDraftsTable.worklistId, studyId: radiologyReportDraftsTable.studyId })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.finalReportId, report.id));
  for (const draft of drafts) {
    if (draft.worklistId === worklist.id) return true;
    if (draft.studyId != null) {
      const resolved = await resolveWorklistFromStudyRef(draft.studyId);
      if (resolved?.id === worklist.id) return true;
    }
  }

  if (report.orderTestId != null) {
    const studies = await db
      .select({ id: radiologyStudiesTable.id })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderTestId, report.orderTestId));
    const studyPick = pickUniqueRow(studies);
    if (studyPick.status === "unique") {
      const rows = await db
        .select({ id: radiologyWorklistTable.id })
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.studyId, studyPick.row.id));
      if (rows.some((row) => row.id === worklist.id)) return true;
    }
  }

  return false;
}

/**
 * The worklist row this report's radiologist explicitly combined it with, or `null`.
 *
 * `radiology_report_drafts.structured_json.linkedStudyId` / `careLinkedStudy` is written by
 * `POST /api/radiology/report-generator/save-draft` when the workspace's combine action names a
 * second examination. The draft is found the way the finalize path itself finds it — latest draft for
 * this report's own study reference (`routes/patient-reports.ts:973-977`), which is the row that
 * finalize then promotes by `final_report_id` (`:1208`, and `:1875` for an amendment, which is how an
 * amended combined report keeps its scope without re-deriving anything). Reading it through
 * `extractCareLinkedStudy` means this is the same envelope the rest of the product reads: no second
 * linkage, no new column, no migration.
 *
 * Deliberately narrow: an id is returned only when that draft names one. Absence is not ambiguity to
 * be resolved by patient, modality, date or accession similarity — those are exactly the inferences
 * that let one patient's report stand in for another examination.
 */
export async function resolveAuthorizedCombinedSiblingWorklistId(
  report: { studyId: number | null },
): Promise<number | null> {
  if (report.studyId == null) return null;
  const [draft] = await db
    .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.studyId, report.studyId))
    .orderBy(desc(radiologyReportDraftsTable.updatedAt), desc(radiologyReportDraftsTable.id))
    .limit(1);
  const linked = extractCareLinkedStudy(draft?.structuredJson);
  const id = Number(linked?.studyId);
  return Number.isInteger(id) && id > 0 ? id : null;
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
    // Do not name a route that this row cannot use. POST /:id/amend refuses
    // every report without a signed structured document, so pointing a
    // legacy-signed study at it sent staff to an endpoint that answers 409
    // not_a_signed_structured_report.
    //
    // That rule cuts three ways, not one, and this row already says which. A
    // DELIVERED study cannot be un-signed at all — withdraw-signature throws
    // `already_delivered` inside its own transaction (patient-reports.ts:2932).
    // A final study still pointing at a report CAN be, from Report Hub, which is
    // the loop #847/#852 built and the single generic sentence below never
    // named. And a study marked final with no reportId has no report behind it,
    // so there is no signature to withdraw — the workspace renders exactly that
    // state as "Study marked final — NO report exists"
    // (`signedReportBadge("no-signed-report")` in
    // diagnostic-erp/src/lib/radiologyReportLifecycle.ts, shown by
    // WorkspaceOverlays' completion chip).
    //
    // One message covering all three had to be vague enough to be true of each,
    // which is how it came to promise only "a separate, attributed action" — a
    // dead end for the row that has a way out, and false comfort for the two
    // that do not.
    if (worklist.status === "DELIVERED") {
      // "from the app" is the honest scope, and it is the whole of it: both UI
      // callers of report-status only ever send REPORT_FINAL
      // (radiologyReportLifecycle.ts:316, RadiologyWorklist.tsx:1045), so no
      // affordance un-delivers a row, canWithdrawSignature returns false for a
      // delivered report, and withdraw-signature itself throws
      // `already_delivered`. An administrator issuing the status call by hand
      // could un-deliver and then withdraw — which is precisely why the message
      // does not claim the signature is immutable, only that nothing in the app
      // will take it back.
      throw new RadiologyIdentityError(409, "REPORT_LOCKED", "This study's report has already been delivered, so its draft is locked. Nothing typed here can change the signed text, and a delivered report cannot be un-signed from the app.");
    }
    if (worklist.reportId) {
      // "unless it has been verified or delivered" is not decoration: the legacy
      // verify route sets patient_reports.status = "verified" with no structured
      // document involved (patient-reports.ts:2622), and withdraw-signature
      // refuses that row with `already_verified` (:2866). Without the clause this
      // message would promise a button Report Hub is right to hide.
      throw new RadiologyIdentityError(409, "REPORT_LOCKED", "This study already has a final report, so its draft is locked; nothing typed here changes the signed text. The signer or an administrator can withdraw it in Report Hub to unlock this study — unless it has been verified or delivered.");
    }
    if (worklist.status === "REPORT_FINAL") {
      throw new RadiologyIdentityError(409, "REPORT_LOCKED", "This study was marked final but has no report linked to it, so its draft is locked and there is no signature behind it to take back. Nothing typed here can change that.");
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
