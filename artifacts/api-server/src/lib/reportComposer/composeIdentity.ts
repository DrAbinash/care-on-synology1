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
 * A `COMBINE` job carries a SECOND identity set — the reports it merges in — and
 * `verifyComposeSourceIdentities` at the bottom of this file resolves each of
 * them against the same three tables and proves they belong to the anchor's
 * patient. Same rule, wider scope: one study's identity is not the only way a
 * draft can end up describing the wrong person.
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
  patientReportsTable,
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
import type { ComposerReportSource } from "./types";

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
  | "compose_identity_unavailable"
  | ComposeSourceIdentityCode;

/** Refusals raised by `verifyComposeSourceIdentities` — see its docstring. */
export type ComposeSourceIdentityCode =
  | "compose_source_unidentified"
  | "compose_source_unmatched"
  | "compose_source_not_found"
  | "compose_source_conflict"
  | "compose_source_anchor_unverified"
  | "compose_source_patient_mismatch"
  | "compose_source_uid_conflict";

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
  compose_source_unidentified:
    "The report you asked to combine does not name a CARE study, so CARE cannot check whose it is. Open the other study in the worklist and combine it from there, or link it in Match Center first.",
  compose_source_not_found:
    "The report you asked to combine names a study CARE can no longer find. Nothing was sent to the AI — check the other study is still in the worklist.",
  compose_source_unmatched:
    "The study you asked to combine is not linked to a patient in CARE, so CARE cannot check it belongs to the same person. Resolve it in Match Center first.",
  compose_source_conflict:
    "The report you asked to combine describes more than one study, so CARE could not settle which one it came from. Nothing was sent to the AI.",
  compose_source_anchor_unverified:
    "The study you are reporting is not linked to a patient yet, so CARE cannot check that the report you want to combine belongs to the same person. Resolve the match in Match Center first.",
  compose_source_patient_mismatch:
    "The report you asked to combine belongs to a different patient than the study you are reporting. Nothing was sent to the AI, and nothing was changed.",
  compose_source_uid_conflict:
    "The DICOM study identifiers of the report you asked to combine do not match the study it names. Nothing was sent to the AI.",
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
    // The anchor reference does not name a row. It is not rescued by looking
    // the *other* reference up: choosing which of two contradictory references
    // to believe would be substituting a study the caller did not ask for.
    return fail("compose_worklist_not_found");
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

/**
 * The statuses at which a `patient_reports` row is the signed report of record.
 * One owner: the composer's own "is the target finalized" read (`jobService`)
 * and a COMBINE source's "is this report signed" attestation must not drift into
 * two different answers about the same column.
 */
export function isFinalizedReportStatus(status: string | null | undefined): boolean {
  return ["final", "FINAL", "signed", "SIGNED", "amended", "verified", "delivered"].includes(
    String(status ?? ""),
  );
}

/** One `patient_reports` row, read by primary key. */
type SourceReportRow = {
  id: number;
  patientId: number;
  studyId: number | null;
  status: string;
  reportNumber: string;
};

async function loadReportById(reportId: number): Promise<SourceReportRow | null> {
  const [row] = await db
    .select({
      id: patientReportsTable.id,
      patientId: patientReportsTable.patientId,
      studyId: patientReportsTable.studyId,
      status: patientReportsTable.status,
      reportNumber: patientReportsTable.reportNumber,
    })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, reportId))
    .limit(1);
  return row ?? null;
}

/**
 * A COMBINE source whose identity CARE proved, resolved entirely from server
 * rows. Persisted as the job's attestation so the individual source study
 * identifiers survive the request and the clinician can see which study each
 * merged report came from.
 */
export type VerifiedComposeSource = {
  /** 0-based position in `snapshot.additionalReports`, so a refusal can say
   * which report it means without quoting anything about the patient. */
  position: number;
  /** The caption the clinician typed. Display only — never evidence of identity. */
  label: string | null;
  worklistId: number | null;
  studyId: number | null;
  reportId: number | null;
  reportNumber: string | null;
  /** Always present: a source with no patient never gets here. */
  patientId: number;
  studyInstanceUID: string | null;
  modality: string | null;
  worklistStatus: string | null;
  /** Its report of record is signed / verified / delivered, or its study is
   * final. A signed source is read and merged; it is never a write target. */
  signed: boolean;
};

export type ComposeSourceIdentityResult =
  | { ok: true; sources: VerifiedComposeSource[] }
  | { ok: false; code: ComposeSourceIdentityCode; message: string }
  | { ok: false; code: "compose_identity_unavailable"; message: string };

function sourceRefusal(
  code: ComposeSourceIdentityCode,
  position: number,
  total: number,
): { ok: false; code: ComposeSourceIdentityCode; message: string } {
  const which = total > 1 ? ` (report ${position + 1} of ${total})` : "";
  return { ok: false, code, message: IDENTITY_MESSAGES[code] + which };
}

/**
 * Per-source patient identity for `COMBINE`.
 *
 * WHY
 * A combination merges a second report's findings into the study being reported.
 * Before this, the only thing saying the two belonged to the same person was the
 * browser's own account: `additionalReports` carried free text and a label, and
 * nothing checked whose report that text was. A stale tab, a wrong pick in a
 * prior-study list, or a mislabelled paste therefore merges another patient's
 * findings into this patient's report — and the conservation validator cannot
 * see it, because every fact it tracks is faithfully present.
 *
 * THE RULE
 * Every source must name a CARE study — `radiology_worklist.id` and/or
 * `patient_reports.id` — and the reference is looked up, never believed. Both
 * spellings on one source must describe the same study (the same
 * `assertReportBelongsToWorklist` the anchor and the finalize path run). The
 * source's patient must be the anchor's patient, and both must be known; an
 * unlinked DICOM study on either side is refused rather than assumed to match.
 * A typed name, label or accession is not evidence of identity anywhere in this
 * function, and `radiology_studies` is cross-checked against the worklist row
 * the same way `bindRadiologyReportIdentity` does, so a study whose own rows
 * disagree is "conflict", not "probably fine".
 *
 * A report CARE does not hold — a printout from another centre typed into the
 * box — has no row to resolve, so it is refused. That is a real limit on the
 * operation and it is deliberate: "confirm all sources belong to the intended
 * patient" and "unverifiable text pasted in" cannot both hold. The outside study
 * has to be linked into CARE (Match Center / its own worklist row) first, which
 * also gives it a UID, a patient and a report of record.
 *
 * WHAT IS STILL THE CLINICIAN'S CLAIM
 * The NARRATIVE arrives from the browser, because the workspace composes the
 * merge from what is on screen. Identity is proved for the named study; that the
 * pasted words are that study's words is not — a mis-transcription is caught by
 * the conservation and relation guards plus the radiologist's review, not here.
 * Binding the text to the row was tried and rejected: a signed report's `body`
 * and a draft's `findingsSections` are not byte-equal to the editor's text (the
 * print formatters own them), so an equality gate would refuse honest merges.
 *
 * No new identity system: every value read here comes from the same three
 * tables the anchor resolver and the finalize path already treat as
 * authoritative.
 */
export async function verifyComposeSourceIdentities(opts: {
  anchor: { worklistId: number; patientId: number | null };
  sources: readonly ComposerReportSource[];
}): Promise<ComposeSourceIdentityResult> {
  if (opts.sources.length === 0) return { ok: true, sources: [] };

  // Without a patient on the open study there is nothing to compare a source
  // against, and "the same person, we trust" is not a verification.
  if (opts.anchor.patientId == null) {
    return { ok: false, code: "compose_source_anchor_unverified", message: IDENTITY_MESSAGES.compose_source_anchor_unverified };
  }

  const total = opts.sources.length;
  const verified: VerifiedComposeSource[] = [];

  for (const [position, source] of opts.sources.entries()) {
    const worklistRef = asId(source.worklistId);
    const reportRef = asId(source.reportId);
    if (worklistRef == null && reportRef == null) {
      return sourceRefusal("compose_source_unidentified", position, total);
    }

    let worklist: WorklistIdentityRow | null = null;
    let report: SourceReportRow | null = null;
    try {
      if (worklistRef != null) worklist = await loadWorklistById(worklistRef);
      if (reportRef != null) report = await loadReportById(reportRef);
    } catch {
      return { ok: false, code: "compose_identity_unavailable", message: IDENTITY_MESSAGES.compose_identity_unavailable };
    }
    if (worklistRef != null && !worklist) return sourceRefusal("compose_source_not_found", position, total);
    if (reportRef != null && !report) return sourceRefusal("compose_source_not_found", position, total);

    // A source named only by its report still has to say which study it was
    // reported on, and `patient_reports.study_id` holds a worklist row id on the
    // canonical radiology finalize path — read it the way every other reader
    // does, because it is overloaded.
    if (!worklist && report) {
      try {
        worklist = await resolveWorklistFromStudyRef(report.studyId);
      } catch {
        return { ok: false, code: "compose_identity_unavailable", message: IDENTITY_MESSAGES.compose_identity_unavailable };
      }
    }

    // …and a source named only by its STUDY has a report of record whether or not
    // the caller knew about it. Read it: the whole point of the attestation is to
    // preserve the individual source identifiers, and "signed" must come from the
    // report row itself rather than from a worklist status that is only a mirror
    // of it.
    if (!report && worklist?.reportId != null) {
      try {
        report = await loadReportById(worklist.reportId);
      } catch {
        return { ok: false, code: "compose_identity_unavailable", message: IDENTITY_MESSAGES.compose_identity_unavailable };
      }
      // The back-link names a report that no longer exists. The study claims to be
      // reported and signed and there is nothing behind it — that is an
      // unverifiable source, not a source without a report.
      if (!report) return sourceRefusal("compose_source_conflict", position, total);
    }

    // Both spellings present: they must describe one study and one patient. This
    // is the finalize path's own check, so a reportId that exists but belongs to
    // another patient cannot be waved through as "the other reference is fine".
    if (worklist && report) {
      try {
        await assertReportBelongsToWorklist(report.id, worklist);
      } catch (err) {
        if (err instanceof RadiologyIdentityError) return sourceRefusal("compose_source_conflict", position, total);
        return { ok: false, code: "compose_identity_unavailable", message: IDENTITY_MESSAGES.compose_identity_unavailable };
      }
    }

    const patientId = report?.patientId ?? worklist?.patientId ?? null;
    if (patientId == null) return sourceRefusal("compose_source_unmatched", position, total);
    if (patientId !== opts.anchor.patientId) {
      return sourceRefusal("compose_source_patient_mismatch", position, total);
    }

    // The worklist row and its billed study must agree with each other, exactly
    // as the finalize bind demands — a source whose own rows disagree is an
    // ambiguous identity, and ambiguity is refused.
    if (worklist?.studyId != null) {
      let billed = null as Awaited<ReturnType<typeof loadBilledStudy>>;
      try {
        billed = await loadBilledStudy(worklist.studyId);
      } catch {
        return { ok: false, code: "compose_identity_unavailable", message: IDENTITY_MESSAGES.compose_identity_unavailable };
      }
      if (billed && worklist.patientId != null && billed.patientId !== worklist.patientId) {
        return sourceRefusal("compose_source_conflict", position, total);
      }
    }

    const declaredUid = (source.studyInstanceUid ?? "").trim();
    const rowUid = worklist?.studyInstanceUID ?? null;
    if (declaredUid && rowUid && declaredUid !== rowUid) {
      return sourceRefusal("compose_source_uid_conflict", position, total);
    }

    verified.push({
      position,
      label: (source.label ?? "").trim() || null,
      worklistId: worklist?.id ?? null,
      studyId: worklist?.studyId ?? null,
      reportId: report?.id ?? worklist?.reportId ?? null,
      reportNumber: report?.reportNumber ?? null,
      patientId,
      studyInstanceUID: rowUid,
      modality: worklist?.modality ?? null,
      worklistStatus: worklist ? String(worklist.status ?? "") : null,
      signed:
        isFinalizedReportStatus(report?.status) ||
        (report != null && worklist?.reportId === report.id) ||
        worklist?.status === "REPORT_FINAL" ||
        worklist?.status === "DELIVERED",
    });
  }

  return { ok: true, sources: verified };
}
