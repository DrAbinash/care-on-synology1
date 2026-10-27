/**
 * Phase 3, item A — appointment vs reporting exam visibility.
 *
 * The Reading Queue is one table, two very different kinds of row, and until
 * now they were pixel-identical:
 *
 *   · a booked appointment — `radiology_worklist` status SCHEDULED, written by
 *     the appointment/billing door the moment a procedure is scheduled
 *     (`sourceAppointmentId`), no DICOM yet, nothing to report;
 *   · an arrived exam — STUDY_RECEIVED or later, images at PACS, reportable
 *     now.
 *
 * Worse than identical: `normalizeWorkspaceStudy` folded "scheduled" into
 * "received", so the queue row asserted an appointment's images had arrived.
 * This module is the display-side truth the strip renders:
 *
 *   · `scheduled`  → awaiting-acquisition — "Booked · images not yet received";
 *   · any reporting lifecycle (received…amended) → reportable, the row keeps
 *     today's appearance.
 *
 * Deliberately a display classifier, not a gate: opening a booked row stays
 * possible (demographics, history and priors are real work), and the status is
 * PACS-owned — this module never infers readiness from anything the radiologist
 * could have edited, and it never rewrites a clinical field.
 */
export type StudyReadinessState = "awaiting-acquisition" | "reportable";

export type StudyReadiness = {
  state: StudyReadinessState;
  /** The chip the Reading Queue row shows. Empty for a reportable exam. */
  badge: string;
  /** One line for the row's title tooltip. Empty for a reportable exam. */
  hint: string;
};

/**
 * The one rule, on the row's own lifecycle status only. `images`/`series` are
 * accepted for future wire richness but never trusted alone: the worklist
 * endpoint does not send counts, and a wire that omits them defaults to 0 —
 * deciding "awaiting" from a zero count would mislabel EVERY arrived study.
 */
export function studyReportingReadiness(study: {
  status?: string | null;
  images?: number | null;
  series?: number | null;
}): StudyReadiness {
  const status = (study.status ?? "").trim().toLowerCase();
  if (status === "scheduled") {
    return {
      state: "awaiting-acquisition",
      badge: "BOOKED — awaiting images",
      hint: "Appointment booked; no images have arrived from the modality yet. Nothing to report until PACS receives the study.",
    };
  }
  return { state: "reportable", badge: "", hint: "" };
}

/** Queue header summary: how many rows are appointments rather than exams. */
export function countAwaitingAcquisition(
  studies: ReadonlyArray<{ status?: string | null }>,
): number {
  return studies.reduce(
    (n, s) => n + (studyReportingReadiness(s).state === "awaiting-acquisition" ? 1 : 0),
    0,
  );
}
