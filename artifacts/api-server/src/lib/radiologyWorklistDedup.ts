/**
 * Radiology worklist intake — dedup & race-safety decisions.
 *
 * Pure, dependency-free helpers extracted from routes/internal-radiology.ts
 * so they have direct regression coverage without needing a live Postgres
 * connection (unlike the route file itself, which imports `db` at module
 * load time).
 *
 * Background: accession_number on radiology_worklist is external DICOM
 * data pushed by PACS/modalities and is NOT reliably unique — a
 * misconfigured modality can push the same bogus text (e.g. a referring
 * doctor's name) for genuinely different studies. study_instance_uid is
 * the true globally-unique DICOM identifier and is what's enforced unique
 * at the DB level (radiology_worklist_uid_uq, a partial unique index that
 * excludes NULLs). See lib/db/src/schema/radiologyWorklist.ts and the
 * migration in artifacts/api-server/src/index.ts (runStartupMigrations).
 */

/**
 * accession-number-based dedup lookup is only safe to use when the
 * incoming study has no studyInstanceUID at all (older/incomplete PACS
 * data). It must never be used to "find a match" for a study that does
 * have a UID — otherwise two unrelated studies sharing a bad/duplicate
 * accession number would get merged into one worklist row, silently
 * overwriting one of them.
 */
export function shouldFallbackToAccessionLookup(
  studyInstanceUID: string | null,
  accessionNumber: string | null,
): boolean {
  return !studyInstanceUID && !!accessionNumber;
}

/**
 * True when a worklist INSERT failed because of a concurrent race on
 * study_instance_uid: two simultaneous pushes for the same UID both missed
 * the pre-insert SELECT and both tried to INSERT — Postgres's
 * radiology_worklist_uid_uq partial unique index rejects the loser with a
 * 23505 (unique_violation). That case should be treated as "someone else
 * just created it" and retried as an UPDATE instead of surfacing a 500 —
 * the update-on-conflict behavior for repeated StudyInstanceUID. Any other
 * error (including a 23505 on an unrelated constraint) must not be
 * swallowed by this check.
 */
export function isWorklistUidRaceViolation(
  err: unknown,
  studyInstanceUID: string | null,
): boolean {
  if (!studyInstanceUID) return false;
  const e = err as { code?: unknown; constraint?: unknown; detail?: unknown } | null | undefined;
  if (!e || e.code !== "23505") return false;
  if (e.constraint === "radiology_worklist_uid_uq") return true;
  return String(e.detail ?? "").includes("study_instance_uid");
}
