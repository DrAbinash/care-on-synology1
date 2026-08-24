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

export function canHydrateDraftForPatient(
  draftPatientId: number | null | undefined,
  currentPatientId: number | null | undefined,
): boolean {
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
