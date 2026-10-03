/**
 * Client-side correlation guards for the radiology reporting workspace.
 * Server-side save-draft / AI routes also bind identity; these helpers stop
 * Patient A editor/AI/autosave state from being applied after a switch to B.
 */

export function shouldApplyAsyncStudyResult(
  requestStudyId: number | null | undefined,
  currentStudyId: number | null | undefined,
): boolean {
  if (requestStudyId == null || currentStudyId == null) return false;
  return Number(requestStudyId) === Number(currentStudyId);
}

/**
 * String-identity sibling of shouldApplyAsyncStudyResult, for keys that are not
 * numbers: a DICOM StudyInstanceUID, or the workspace store's string study id.
 *
 * A null request key is NOT a refusal. The AI paths run against worklist rows
 * that legitimately carry no StudyInstanceUID, and refusing those would break
 * Ctrl+I for every such study — a usability regression bought with no safety,
 * because there was no identity to lose. A null current key IS a refusal once
 * the request named one: it means the workspace has moved off that study.
 */
export function shouldApplyAsyncStudyKey(
  requestStudyKey: string | null | undefined,
  currentStudyKey: string | null | undefined,
): boolean {
  if (requestStudyKey == null) return true;
  if (currentStudyKey == null) return false;
  return requestStudyKey === currentStudyKey;
}

export function canHydrateDraftForPatient(
  draftPatientId: number | null | undefined,
  currentPatientId: number | null | undefined,
): boolean {
  // Wait until the worklist patient is known before hydrating a draft that
  // already carries a patientId — otherwise Patient A's draft can load while
  // the row for B is still resolving.
  if (draftPatientId != null && currentPatientId == null) return false;
  if (draftPatientId == null || currentPatientId == null) return true;
  return Number(draftPatientId) === Number(currentPatientId);
}

export function shouldCommitAutosave(
  requestStudyId: number | null | undefined,
  currentStudyId: number | null | undefined,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return (
    shouldApplyAsyncStudyResult(requestStudyId, currentStudyId) &&
    requestGeneration === currentGeneration
  );
}
