/**
 * Which study an interactive AI request is allowed to name.
 *
 * WHY THIS EXISTS
 * `/draft` and `/query` both read a StudyInstanceUID out of the request body and
 * handed it straight to `fetchStudyImages`, which asks Orthanc for whatever study
 * carries that string. The worklist lookup sitting next to it only ever ENRICHED
 * the request — when it found no row, the handler continued with the caller's UID
 * anyway. So the pixels a model was shown could belong to a study this clinic's
 * RIS does not have, or to a study nobody has on a worklist, and the draft row and
 * audit row filed under that UID had no accession and no patient to be checked
 * against. `/image-review` already refuses that shape (`resolveAuthorizedStudyUid`)
 * and `/api/ai-comparison/run` already refuses to file an audit row for a study
 * that is not in `radiology_studies`. This module is the same rule, in one place,
 * for the two doors that were missing it.
 *
 * THE RULE, IN ONE SENTENCE
 * A request that names a study may only name one this clinic has, and may only call it
 * that study's own patient; a request that names no study is a text-only request and
 * stays allowed.
 *
 * Confirmed means: a `radiology_worklist` row for the given id, or a worklist row
 * carrying the claimed UID, or — when no worklist row carries it — a
 * `radiology_studies` row carrying it. The last arm keeps a PACS-first study that
 * is billed but not yet on a worklist working; it is still this clinic's own row,
 * which is the point.
 */
import { desc, eq } from "drizzle-orm";
import { db, radiologyStudiesTable } from "@workspace/db";
import { radiologyWorklistTable } from "@workspace/db/schema";

/**
 * What the server's own row says about the study. `modality` and `studyDescription`
 * are here because `/draft` builds its prompt and its cross-modality garbage filter
 * from them, and both used to be taken from the worklist row it then ignored when
 * the row was missing.
 */
export type StudyRowFacts = {
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  patientId: number | null;
  modality: string | null;
  studyDescription: string | null;
};

/** Which row confirmed the study, so a reader can tell how a request was bound. */
export type StudyBindingSource =
  /** The request named no study at all: a text-only call, no pixels involved. */
  | "not-named"
  | "worklist-by-id"
  | "worklist-by-uid"
  | "study-by-uid";

export type StudyBinding =
  | {
      ok: true;
      /** Server-confirmed UID, or null when the request named no study. */
      studyInstanceUID: string | null;
      accessionNumber: string | null;
      patientId: number | null;
      /** Null when nothing confirmed a modality — the caller's own value stands. */
      modality: string | null;
      studyDescription: string | null;
      source: StudyBindingSource;
  }
  | {
      ok: false;
      httpStatus: number;
      /** Stable so the ERP and the audit census can switch on it, not on prose. */
      code: string;
      /** Written for the radiologist: what was refused, and why in one clause. */
      message: string;
  };

/**
 * The rows this decision needs, read by `bindInteractiveStudy` and passed in so
 * the rule itself is testable without a database.
 */
export interface StudyBindingRows {
  worklistById: StudyRowFacts | null;
  worklistByUid: StudyRowFacts | null;
  /**
   * A `radiology_studies` row for the claimed UID, when exactly one carries it.
   * Two rows is not "less confirmed" — the study exists — it is "we cannot say
   * which accession", so confirmation is passed separately from the facts.
   */
  studyByUid: StudyRowFacts | null;
  studyByUidCount: number;
}

function refusal(
  httpStatus: number,
  code: string,
  message: string,
): StudyBinding {
  return { ok: false, httpStatus, code, message };
}

/**
 * Decide whether a claimed study is this clinic's study, and what the server knows
 * about it.
 *
 * Order is the order of authority: a worklist row named by id outranks a UID in the
 * body, because the id is what the screen the radiologist is looking at came from.
 */
export function decideStudyBinding(
  input: {
    worklistId: number | null;
    claimedUid: string | null;
  },
  rows: StudyBindingRows,
): StudyBinding {
  if (input.worklistId !== null) {
    const row = rows.worklistById;
    if (!row) {
      // The row the screen was opened from is gone (withdrawn, re-linked, or never
      // this id). Answering with the body's UID instead would put a study the
      // caller named in front of the model while claiming to honour the id.
      return refusal(
        404,
        "WORKLIST_NOT_FOUND",
        "This study is no longer on the radiology worklist, so no images were sent to the AI. Reload the worklist and try again.",
      );
    }
    if (input.claimedUid && row.studyInstanceUID && row.studyInstanceUID !== input.claimedUid) {
      return refusal(
        409,
        "STUDY_UID_MISMATCH",
        `The study selected on this screen (${row.studyInstanceUID}) is not the study named in the request (${input.claimedUid}). No images were sent to the AI.`,
      );
    }
    if (input.claimedUid && !row.studyInstanceUID) {
      return refusal(
        409,
        "NO_STUDY_UID",
        "This worklist entry has no DICOM study identity yet, so no images could be sent to the AI. Link the study in the Match Center first.",
      );
    }
    return {
      ok: true,
      studyInstanceUID: row.studyInstanceUID,
      accessionNumber: row.accessionNumber,
      patientId: row.patientId,
      modality: row.modality,
      studyDescription: row.studyDescription,
      source: "worklist-by-id",
    };
  }

  if (!input.claimedUid) {
    // Nothing is claimed, so nothing needs confirming: the text-only path, which
    // fetches no images and files a row naming no study.
    return {
      ok: true,
      studyInstanceUID: null,
      accessionNumber: null,
      patientId: null,
      modality: null,
      studyDescription: null,
      source: "not-named",
    };
  }

  const byUid = rows.worklistByUid;
  if (byUid?.studyInstanceUID) {
    return {
      ok: true,
      studyInstanceUID: byUid.studyInstanceUID,
      accessionNumber: byUid.accessionNumber,
      patientId: byUid.patientId,
      modality: byUid.modality,
      studyDescription: byUid.studyDescription,
      source: "worklist-by-uid",
    };
  }

  if (rows.studyByUidCount === 1 && rows.studyByUid) {
    return {
      ok: true,
      studyInstanceUID: rows.studyByUid.studyInstanceUID,
      accessionNumber: rows.studyByUid.accessionNumber,
      patientId: rows.studyByUid.patientId,
      modality: rows.studyByUid.modality,
      studyDescription: rows.studyByUid.studyDescription,
      source: "study-by-uid",
    };
  }

  if (rows.studyByUidCount > 1) {
    // Present more than once means present. The pixels are this clinic's pixels;
    // only the accession is not decidable, and saying so is better than picking.
    return {
      ok: true,
      studyInstanceUID: input.claimedUid,
      accessionNumber: null,
      patientId: null,
      modality: null,
      studyDescription: null,
      source: "study-by-uid",
    };
  }

  return refusal(
    400,
    "STUDY_NOT_IN_CLINIC",
    "No study in this clinic carries that DICOM StudyInstanceUID, so no images were sent to the AI.",
  );
}

/** A binding that says which study this is, with the clinic's own facts about it. */
export type StudyBindingConfirmed = Extract<StudyBinding, { ok: true }>;

/**
 * The patient a request claims, checked against the patient the clinic's row for
 * that study already names.
 *
 * WHY THIS IS NOT COVERED BY THE UID BINDING
 * #1109 confirmed WHICH STUDY a request meant. It left the request free to say whose
 * PATIENT it was: `/query` reads `patientId` out of the body and looks that patient up
 * in `patients` to append their age and sex to the prompt the model reads, and both
 * `/query` and `POST /drafts` file that id on the row afterwards. A request carrying
 * patient A's study and patient B's id therefore asked the model to read a scan through
 * the wrong person's demographics, and left behind an audit row and a draft naming the
 * wrong person — the draft being the worse of the two, since `GET /drafts/:studyId`
 * hands it to whoever opens that study next.
 *
 * The clinic's row wins in both directions: a claim that contradicts it is refused, and
 * a claim it cannot confirm (no study bound, or a study whose patient is not linked
 * yet) is dropped rather than adopted. Absence of a server-side answer is not a licence
 * for the browser to supply one.
 *
 * The accession is deliberately NOT refused here. `dicom_pulled_studies` keeps whatever
 * AccessionNumber the modality sent, and the viewer reads its label from there when no
 * worklist row exists, so a billed study's screen can carry a string that differs from
 * the ERP's own accession for reasons this server cannot see. Dropping the claim costs
 * the audit row nothing (the ERP's accession is written) while refusing it would take
 * the AI panel away from a radiologist whose study is legitimately in the clinic.
 */
export function refuseConflictingPatientClaim(
  binding: StudyBindingConfirmed,
  claimedPatientId: unknown,
): StudyBinding {
  // A JSON body arrives as whatever it arrives as. Only a real patient id counts as a
  // claim: a string, a fraction or a negative is not a patient, and is never adopted.
  const claim =
    typeof claimedPatientId === "number" &&
    Number.isInteger(claimedPatientId) &&
    claimedPatientId > 0
      ? claimedPatientId
      : null;
  if (claim === null) return binding;
  if (binding.patientId === null || binding.patientId === claim) return binding;

  return refusal(
    409,
    "PATIENT_ID_MISMATCH",
    `This request names patient ${claim}, but the clinic's record for study `
      + `${binding.studyInstanceUID ?? "(no DICOM identity)"} names patient ${binding.patientId}. `
      + "Nothing was sent to the AI and no draft was saved.",
  );
}

/**
 * Read the rows and decide. Throws nothing: a refusal is a return value, because
 * every caller has to answer the request rather than crash on it.
 */
export async function bindInteractiveStudy(input: {
  worklistId?: number | null;
  studyInstanceUID?: string | null;
}): Promise<StudyBinding> {
  const claimedUid = input.studyInstanceUID?.trim() || null;
  const worklistId =
    input.worklistId && Number.isFinite(input.worklistId)
      ? Math.trunc(input.worklistId)
      : null;

  if (worklistId !== null) {
    const [row] = await db
      .select({
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        patientId: radiologyWorklistTable.patientId,
        modality: radiologyWorklistTable.modality,
        studyDescription: radiologyWorklistTable.studyDescription,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, worklistId))
      .limit(1);
    return decideStudyBinding(
      { worklistId, claimedUid },
      { worklistById: row ?? null, worklistByUid: null, studyByUid: null, studyByUidCount: 0 },
    );
  }

  if (!claimedUid) {
    return decideStudyBinding({ worklistId: null, claimedUid: null }, {
      worklistById: null,
      worklistByUid: null,
      studyByUid: null,
      studyByUidCount: 0,
    });
  }

  const [worklist] = await db
    .select({
      studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
      accessionNumber: radiologyWorklistTable.accessionNumber,
      patientId: radiologyWorklistTable.patientId,
      modality: radiologyWorklistTable.modality,
      studyDescription: radiologyWorklistTable.studyDescription,
    })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyInstanceUID, claimedUid))
    .orderBy(desc(radiologyWorklistTable.id))
    .limit(1);
  if (worklist?.studyInstanceUID) {
    return decideStudyBinding({ worklistId: null, claimedUid }, {
      worklistById: null,
      worklistByUid: worklist,
      studyByUid: null,
      studyByUidCount: 0,
    });
  }

  // Bounded at two: the second row is what makes "this UID appears twice, with
  // which accession?" a fact the code can see instead of a guess it makes.
  const studyRows = await db
    .select({
      studyInstanceUID: radiologyStudiesTable.studyInstanceUid,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      patientId: radiologyStudiesTable.patientId,
      modality: radiologyStudiesTable.modality,
      studyDescription: radiologyStudiesTable.studyDescription,
    })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.studyInstanceUid, claimedUid))
    .limit(2);

  return decideStudyBinding({ worklistId: null, claimedUid }, {
    worklistById: null,
    worklistByUid: null,
    studyByUid: studyRows[0] ?? null,
    studyByUidCount: studyRows.length,
  });
}
