/**
 * Server-verified study identity for Background AI Report Composer jobs.
 *
 * WHY THIS EXISTS
 * `ai_report_compose_jobs.study_id / worklist_id / report_id` used to be copied
 * straight out of the browser snapshot, and `POST /jobs/:id/applied` named no
 * target at all — it marked any job APPLIED on the strength of its job id plus
 * client-supplied hashes. Neither freshness axis closes that gap either:
 * `canonicalStudyContextHashPayload` (snapshot.ts:93) deliberately hashes
 * modality/region/protocol/reportTitle and NOT the study ids, so a READY draft
 * composed for Patient A keeps passing its own freshness check when it is
 * presented inside Patient B's browser, as long as the text matches. Model B
 * froze the clinical *text*; nothing froze *whose study* it belonged to.
 *
 * THE RULE ENFORCED HERE
 * Every identity value a job carries is resolved against `radiology_worklist`,
 * `radiology_report_drafts` and `patient_reports` on the server — once when the
 * job is created, and again when it is applied — and the two resolutions must
 * agree. A browser-declared id is only ever a reference to look up, never
 * evidence of identity or of authorization. Anything that cannot be resolved is
 * refused: no silent substitution of another study, no "unknown identity is
 * probably fine".
 *
 * THE ANCHOR IS `radiology_worklist.id`, because that is what the canonical
 * write paths already anchor on: `POST /save-draft` re-derives
 * study/worklist/patient from that row precisely so "a delayed Patient A
 * autosave cannot write into Patient B's draft identity"
 * (radiology-report-generator.ts:1718-1733), and finalize stores that row id in
 * `patient_reports.study_id` (radiologyIdentity.ts:95). `studyId` and
 * `worklistId` are NOT interchangeable — they are two different sequences whose
 * numbers collide by accident — so both spellings are accepted as a *reference*
 * and then re-read from the row, never compared as raw client integers.
 *
 * This module composes the existing radiology identity helpers. It does not
 * re-implement them, and it adds no schema: `worklistId` alone determines the
 * patient, the billed study, the DICOM UID and the report, so the verified
 * binding is re-derivable from the row at Apply time.
 */
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  type AiReportComposeJob,
} from "@workspace/db/schema";
import {
  RadiologyIdentityError,
  assertDraftWritable,
  assertReportBelongsToWorklist,
  loadBilledStudy,
  resolveWorklistFromStudyRef,
  type WorklistIdentityRow,
} from "../radiologyIdentity";
import { checkWriteLock } from "../studyLocks";

export type ComposeStudyRefs = {
  worklistId?: number | null;
  studyId?: number | null;
  reportId?: number | null;
};

export type ComposeIdentityCode =
  | "compose_target_required"
  | "compose_worklist_required"
  | "compose_worklist_not_found"
  | "compose_study_conflict"
  | "compose_report_conflict"
  | "compose_draft_conflict"
  | "compose_locked"
  | "compose_locked_by_other"
  | "compose_job_unbound"
  | "compose_job_cross_study"
  | "compose_job_report_conflict"
  | "compose_identity_unavailable";

export type VerifiedComposeIdentity = {
  /** radiology_worklist.id — the anchor. Always present when ok. */
  worklistId: number;
  /** radiology_studies.id linked to that row, or null when unbilled. */
  studyId: number | null;
  /** patient_reports.id bound to that row, or null before finalize. */
  reportId: number | null;
  /** Taken from the worklist row, never from the browser. May be null while a
   * DICOM study is still unmatched in Match Center. */
  patientId: number | null;
  studyInstanceUID: string | null;
  worklistStatus: string;
};

export type ComposeIdentityResult =
  | { ok: true; identity: VerifiedComposeIdentity; worklist: WorklistIdentityRow }
  | { ok: false; code: ComposeIdentityCode; message: string };

function asId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Clinician-facing sentences for each refusal. Kept next to the codes so the
 * route, the workspace toast and the tests cannot drift into three different
 * descriptions of the same rejection. Messages name no patient, no study
 * instance UID and no internal identifier — a rejection is often read on a
 * shared screen.
 */
const IDENTITY_MESSAGES: Record<ComposeIdentityCode, string> = {
  compose_target_required:
    "CARE could not verify which study you are applying to. Nothing was changed — reopen the study and try again.",
  compose_worklist_required:
    "CARE could not identify which study this draft is for. Open the study from the worklist and try again.",
  compose_worklist_not_found:
    "This AI draft belongs to a study that is not in the worklist. It cannot be applied.",
  compose_study_conflict:
    "The study identifiers on this draft do not describe one study. Nothing was changed — check the open study and regenerate.",
  compose_report_conflict:
    "This AI draft belongs to another report. It cannot be applied to the current report.",
  compose_draft_conflict:
    "The saved draft for this study points at a different patient or study. Nothing was changed.",
  compose_locked:
    "The target report is finalized. AI changes cannot be applied.",
  compose_locked_by_other:
    "Another user is reporting this study right now, so this AI draft was not applied. Your text was left as it was.",
  compose_job_unbound:
    "This AI draft was created before CARE could verify its study. Regenerate it for the current study.",
  compose_job_cross_study:
    "This AI draft belongs to another study. It cannot be applied to the current report.",
  compose_job_report_conflict:
    "This AI draft no longer matches the report it was generated for. Review and regenerate.",
  compose_identity_unavailable:
    "CARE could not read the study records needed to verify this AI draft. Nothing was changed — try again.",
};

function fail(code: ComposeIdentityCode, message?: string): { ok: false; code: ComposeIdentityCode; message: string } {
  return { ok: false, code, message: message ?? IDENTITY_MESSAGES[code] };
}

async function loadWorklistById(worklistId: number): Promise<WorklistIdentityRow | null> {
  const [row] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve the browser's references into one authoritative study identity.
 *
 * Returns the worklist row and the values that must be persisted on the job.
 * Rejects — rather than guessing — when a reference cannot be found, when the
 * three references describe different studies, or when the study's report is
 * already locked.
 */
export async function resolveVerifiedComposeIdentity(
  refs: ComposeStudyRefs,
): Promise<ComposeIdentityResult> {
  const worklistRef = asId(refs.worklistId);
  const studyRef = asId(refs.studyId);
  const reportRef = asId(refs.reportId);

  if (!worklistRef) {
    // A study may be named by `studyId` alone, but `studyId` is overloaded (it
    // is a radiology_studies.id in the workspace snapshot and a
    // radiology_worklist.id everywhere else), so resolving from it would be a
    // guess about which study to write into. Guessing is not allowed here.
    return fail("compose_worklist_required");
  }

  let worklist: WorklistIdentityRow | null;
  try {
    worklist = await loadWorklistById(worklistRef);
  } catch {
    return fail("compose_identity_unavailable");
  }
  if (!worklist) {
    // The reference may be a billed-study id (older surfaces pass the route
    // param into both fields). Look that up, but only accept it when it names
    // exactly one worklist row; an ambiguous or unrelated id is refused.
    const viaStudy = await resolveWorklistFromStudyRef(studyRef).catch(() => null);
    return fail("compose_worklist_not_found", viaStudy ? IDENTITY_MESSAGES.compose_study_conflict : undefined);
  }

  // `studyId` agreement.
  //
  // `radiology_studies.id` and `radiology_worklist.id` are two independent
  // sequences, so the same number legitimately names a billed study and a
  // worklist row at the same time. The Reporting Workspace sends the billed id
  // (useWorkspaceClinicalUi.tsx:1517 reads `workflow.currentRow?.studyId`), so
  // the primary rule is agreement with the worklist row's own `study_id`. If the
  // number instead equals this worklist's primary key, it may be a surface
  // passing the route param twice — accepted, but only while that number does
  // not resolve to a *different* billed study. Refusing the colliding case is
  // the point: a number that names another patient's study cannot be waved
  // through as "the same study, different spelling".
  if (studyRef != null && studyRef !== worklist.studyId) {
    if (studyRef !== worklist.id) return fail("compose_study_conflict");
    const namedStudy = await loadBilledStudy(studyRef).catch(() => null);
    if (namedStudy && namedStudy.id !== worklist.studyId) return fail("compose_study_conflict");
  }

  // The report of record must belong to this worklist AND to this patient.
  // `assertReportBelongsToWorklist` is the same check the finalize path runs;
  // it compares server rows, so it also catches a reportId that exists but
  // belongs to another patient (the cross-patient forgery).
  if (reportRef != null) {
    try {
      await assertReportBelongsToWorklist(reportRef, worklist);
    } catch (err) {
      if (err instanceof RadiologyIdentityError) return fail("compose_report_conflict");
      return fail("compose_identity_unavailable");
    }
  }
  // The worklist's own back-link is authoritative once a report exists.
  if (worklist.reportId != null && reportRef != null && worklist.reportId !== reportRef) {
    return fail("compose_report_conflict");
  }

  // The workspace draft is the row the accepted text is eventually saved into.
  // Only a draft that is *unambiguously* this study's (matched on the worklist
  // primary key) is consulted: `resolveAuthoritativeComposeDraft` also falls
  // back to `drafts.study_id = <studyId>`, and `drafts.study_id` canonically
  // holds a WORKLIST id while the reference being resolved is a BILLED study id
  // — so that fallback can return an unrelated study's draft, and treating it
  // as a contradiction here would refuse valid work.
  const drafts = await db
    .select({
      worklistId: radiologyReportDraftsTable.worklistId,
      studyId: radiologyReportDraftsTable.studyId,
      patientId: radiologyReportDraftsTable.patientId,
      status: radiologyReportDraftsTable.status,
      finalReportId: radiologyReportDraftsTable.finalReportId,
    })
    .from(radiologyReportDraftsTable)
    .where(eq(radiologyReportDraftsTable.worklistId, worklist.id))
    .limit(2);
  for (const draft of drafts) {
    if (draft.patientId != null && worklist.patientId != null && draft.patientId !== worklist.patientId) {
      return fail("compose_draft_conflict");
    }
    if (draft.studyId != null && draft.studyId !== worklist.id && draft.studyId !== worklist.studyId) {
      return fail("compose_draft_conflict");
    }
  }

  // Finalization is read from the worklist row, not from whatever reportId the
  // browser happened to send: a signed study stays signed even when the caller
  // omits `reportId`, which used to skip the persisted check entirely.
  try {
    await assertDraftWritable({
      worklistId: worklist.id,
      studyId: worklist.id,
      patientId: worklist.patientId ?? null,
    });
  } catch (err) {
    if (err instanceof RadiologyIdentityError) {
      // Keep the canonical wording — these refusals were tuned to name a
      // correction path that actually exists (see #863).
      return fail("compose_locked", err.message);
    }
    return fail("compose_identity_unavailable");
  }

  return {
    ok: true,
    worklist,
    identity: {
      worklistId: worklist.id,
      studyId: worklist.studyId ?? null,
      reportId: worklist.reportId ?? reportRef ?? null,
      patientId: worklist.patientId ?? null,
      studyInstanceUID: worklist.studyInstanceUID ?? null,
      worklistStatus: String(worklist.status ?? ""),
    },
  };
}

/**
 * The Apply gate: does this job belong to the study the caller says they are
 * in, and is that study the caller's to write right now?
 *
 * Both sides are resolved against server rows. The target reference is looked
 * up, never trusted, and the job's stored `worklistId` is re-read from
 * `radiology_worklist` — so a job row whose ids were written by an older build,
 * or whose report has since been re-linked to a different patient, is refused
 * instead of honoured.
 */
export async function verifyComposeJobIdentity(opts: {
  job: Pick<AiReportComposeJob, "worklistId" | "studyId" | "reportId">;
  target: ComposeStudyRefs;
  /** `req.staffSession.subjectId` — the clinician, not the session row. */
  staffId?: number | null;
}): Promise<ComposeIdentityResult> {
  const targetRefs = opts.target;
  if (
    asId(targetRefs.worklistId) == null &&
    asId(targetRefs.studyId) == null &&
    asId(targetRefs.reportId) == null
  ) {
    // Fail closed: an Apply that does not say which study it is applying into
    // cannot be verified, and "unverifiable" is not "allowed".
    return fail("compose_target_required");
  }

  const resolved = await resolveVerifiedComposeIdentity(targetRefs);
  if (!resolved.ok) return resolved;
  const identity = resolved.identity;

  const jobWorklistId = asId(opts.job.worklistId);
  if (!jobWorklistId) return fail("compose_job_unbound");

  let jobWorklist: WorklistIdentityRow | null = null;
  try {
    jobWorklist = await loadWorklistById(jobWorklistId);
  } catch {
    return fail("compose_identity_unavailable");
  }
  if (!jobWorklist) return fail("compose_worklist_not_found");

  if (jobWorklistId !== identity.worklistId) return fail("compose_job_cross_study");
  if (jobWorklist.id !== identity.worklistId) return fail("compose_job_cross_study");

  // The job's own study/report columns must agree with the row they name.
  const jobStudyId = asId(opts.job.studyId);
  if (jobStudyId != null && jobStudyId !== jobWorklist.id && jobStudyId !== jobWorklist.studyId) {
    return fail("compose_job_cross_study");
  }
  const jobReportId = asId(opts.job.reportId);
  if (jobReportId != null) {
    try {
      await assertReportBelongsToWorklist(jobReportId, jobWorklist);
    } catch (err) {
      if (err instanceof RadiologyIdentityError) return fail("compose_job_report_conflict");
      return fail("compose_identity_unavailable");
    }
  }

  // Same-study authorization, on exactly the terms the canonical draft-save
  // path uses: an ACTIVE write lock held by another user blocks, and an
  // unlocked / own / expired study never blocks (studyLocks.ts:214-224), so
  // flows that do not take locks keep working unchanged.
  if (opts.staffId != null) {
    try {
      const gate = await checkWriteLock(identity.worklistId, opts.staffId);
      if (gate.blocked) return fail("compose_locked_by_other");
    } catch {
      return fail("compose_identity_unavailable");
    }
  }

  return { ok: true, identity, worklist: jobWorklist };
}
