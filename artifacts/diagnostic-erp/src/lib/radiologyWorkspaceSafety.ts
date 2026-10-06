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

/**
 * A-01 — the strict identity assertion that must hold before a signed payload is
 * assembled.
 *
 * Finalize captures the initiating study, then runs a long asynchronous gauntlet
 * (save-draft → server validation → AI quality evaluation → signature fetch → the
 * sign dialog, which is a human being deciding) and only AFTER all of that reads the
 * report narrative out of the module-scope workspace store. If the radiologist has
 * navigated away meanwhile, that store now holds a different patient's findings, and
 * posting them under the captured study id signs the wrong clinical truth. The
 * server cannot catch this: it validates report ↔ worklist ↔ patient and then trusts
 * the body HTML verbatim, so an A-identity / B-content request is self-consistent.
 *
 * Deliberately stricter than `shouldApplyAsyncStudyKey`, whose null-request branch is
 * a PERMISSION designed for AI paths that legitimately run against worklist rows
 * carrying no StudyInstanceUID. There is no legitimate finalize with no study: both
 * sides must be present and numerically equal, or finalize stops before it can write.
 *
 * `currentStudyId` accepts the store's string form of the same route id, which after
 * A-02 is written in the same setState as the clinical reset — so matching it is what
 * proves the narrative about to be read belongs to the study about to be signed.
 */
export function isFinalizeStudyIdentityIntact(
  capturedStudyId: number | null | undefined,
  currentStudyId: number | string | null | undefined,
): boolean {
  if (capturedStudyId == null) return false;
  if (currentStudyId == null || currentStudyId === "") return false;
  const current = Number(currentStudyId);
  return Number.isFinite(current) && Number(capturedStudyId) === current;
}
