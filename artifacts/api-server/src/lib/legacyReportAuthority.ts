/**
 * B-10 — the legacy free-text report write is not an authoring boundary.
 *
 * Pure and dependency-free for the reason `studyUidBinding.ts` and
 * `radiologyWorklistDedup.ts` exist: `routes/radiology.ts` imports `db` at
 * module load, so a rule that lives inside the route can only be tested
 * against a live Postgres. The route gathers the three facts and asks.
 *
 * THE RULE: `radiology_studies.prelim_report` / `final_report` may be written
 * here ONLY to correct a legacy free-text document that already exists on a
 * study the modern reporting pipeline never touched. Two facts close it:
 *
 *   A. `hasWorklistRow` — a `radiology_worklist` row carries this `study_id`,
 *      so `RadiologyReportingWorkspace` (`/radiology/report/:worklistId`) can
 *      open the study and report it.
 *   B. `hasPatientReport` — a `patient_reports` row exists for the study, in
 *      either id space (the route stores `worklistId ?? studyId`, see
 *      `radiologyReportLifecycle.ts` `draftStudyKey`), so a report artifact
 *      — possibly signed — already exists.
 *
 * Either fact makes this surface a *second* author of the same study's
 * clinical narrative. That is not a cosmetic duplication: the study-row text
 * outranks the canonical artifact downstream —
 * `lib/priorStudies.ts`: `s.finalReport ?? s.prelimReport ?? report?.body`,
 * which is what the workspace's own prior-study panel shows, and
 * `lib/pacsArchive.ts` falls back to it when no `patient_reports` row is
 * found. So a legacy save can silently contradict a signed report, in the
 * place the next radiologist reads.
 *
 * When neither fact holds, the study exists only in the legacy RIS table. Its
 * historical text stays readable AND correctable (`allowed`), but this surface
 * must not CREATE authoritative content: an empty target column means the
 * write would be the study's first report, and the first report of a study
 * that the clinic can open in the workspace is exactly the competing clinical
 * truth B-10 exists to prevent. So a blank column is refused even in this
 * branch — new narrative has to be authored once, in the workspace, through
 * the transports that carry the #877 placeholder guard, the #878/#879
 * non-destructive merges, the #880 acceptance target, the #882 proposal
 * fingerprint and the #859/#862 signed-refusal.
 *
 * Deliberately NOT modelled here: the caller's role, the request body's
 * `reportedBy` string, or the study's `status`. None of them change which
 * surface owns the clinical truth, and a rule that took them as parameters
 * could be talked into allowing a write by choosing a header value.
 */

export type LegacyReportStage = "preliminary" | "final";

export interface LegacyReportAuthorityFacts {
  stage: LegacyReportStage;
  /** Current value of the column this write would set (`prelimReport` or `finalReport`). */
  existingColumn: string | null;
  hasWorklistRow: boolean;
  hasPatientReport: boolean;
}

export type LegacyReportAuthorityCode =
  | "LEGACY_REPORT_SURFACE_CLOSED"
  | "LEGACY_REPORT_CREATION_CLOSED";

export type LegacyReportAuthorityDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** 409, not 403: the caller may be perfectly authorised — the *surface* is not the place. */
      httpStatus: 409;
      code: LegacyReportAuthorityCode;
      error: string;
    };

const isBlank = (v: string | null): boolean => v == null || v.trim() === "";

export function decideLegacyReportWrite(
  facts: LegacyReportAuthorityFacts,
): LegacyReportAuthorityDecision {
  if (facts.hasWorklistRow || facts.hasPatientReport) {
    return {
      allowed: false,
      httpStatus: 409,
      code: "LEGACY_REPORT_SURFACE_CLOSED",
      error:
        "This study is reported in the Reporting Workspace, which owns its clinical narrative. " +
        "The legacy free-text report surface is closed for it — open the study from the worklist " +
        "(/radiology/report/:worklistId) to save or finalize.",
    };
  }

  if (isBlank(facts.existingColumn)) {
    return {
      allowed: false,
      httpStatus: 409,
      code: "LEGACY_REPORT_CREATION_CLOSED",
      error:
        `A ${facts.stage} report cannot be created here. This study has no legacy ${facts.stage} ` +
        "report on file, and new authoritative radiology narrative is authored only in the " +
        "Reporting Workspace. A study with no worklist row cannot be opened there yet — it needs " +
        "a radiology_worklist row (PACS/MWL intake, or the worklist's billing link) first.",
    };
  }

  return { allowed: true };
}
