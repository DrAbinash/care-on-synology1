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

// ── C1 — the study a dictation session is spoken against ─────────────────────

export type DictationStudyIdentity = {
  studyKey: string | null;
  studyInstanceUID: string | null;
};

/**
 * Normalise one identity witness to a comparable string, or null for "no study
 * named here". An unparseable route param is unbound, NOT the string "nan":
 * `App.tsx` computes `Number(params.studyId)` and mounts two workspace routes
 * with no study id at all, so an unnormalised NaN would make two different
 * unbound surfaces compare as the same study.
 */
export function dictationStudyKeyOf(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  const text = String(raw).trim();
  // A route param that failed to parse reaches here as the STRING form.
  if (!text || text === "NaN" || text === "undefined" || text === "null") return null;
  return text;
}

export function dictationIdentityOf(input: {
  studyId?: unknown;
  studyInstanceUID?: unknown;
}): DictationStudyIdentity {
  return {
    studyKey: dictationStudyKeyOf(input.studyId),
    studyInstanceUID: dictationStudyKeyOf(input.studyInstanceUID),
  };
}

/**
 * Does a dictation session captured as `bound` still belong to the study on
 * screen? Three checks, each asymmetric on purpose.
 *
 * 1. The ROUTE id must still be the one the words were staged against — and two
 *    unbound sides PASS. A session bound to no study is the legitimate
 *    no-param workspace; refusing it would break a working surface to protect
 *    an identity that was never there.
 * 2. The DICOM StudyInstanceUID must not have moved, when BOTH sides name one.
 *    This is the witness that catches a worklist row re-linked to a different
 *    study mid-dictation, which changes the study without changing the row id.
 *    A null on either side is not a refusal: hydration sets the UID after the
 *    row loads, and a non-PACS study has none — either would void a live
 *    dictation on a value that merely arrived late.
 * 3. The store's `activeStudyId`, when it has one, must agree with the bound
 *    route id. This is the witness that matters for the WRITE: the workspace
 *    narrative and Apply both land in the study the STORE holds, so a store
 *    lagging the route would put patient A's sentences under patient B while
 *    the route never moved. Checked against the route-captured binding, never
 *    against itself — store note A-02 records that a guard comparing a stamped
 *    id with `activeStudyId` was self-referential while the field could lag.
 *
 * `storeActiveStudyId` is optional because the caller that has no store (a
 * unit of composition, a test) still gets checks 1 and 2.
 */
export function dictationBindingHolds(
  bound: DictationStudyIdentity,
  live: DictationStudyIdentity,
  storeActiveStudyId?: unknown,
): boolean {
  if ((bound.studyKey ?? null) !== (live.studyKey ?? null)) return false;
  if (
    bound.studyInstanceUID
    && live.studyInstanceUID
    && bound.studyInstanceUID !== live.studyInstanceUID
  ) {
    return false;
  }
  if (
    bound.studyKey
    && storeActiveStudyId != null
    && dictationStudyKeyOf(storeActiveStudyId) !== bound.studyKey
  ) {
    return false;
  }
  return true;
}
