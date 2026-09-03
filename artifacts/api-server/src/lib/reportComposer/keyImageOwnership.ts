/**
 * Strict ownership verification for SELECTED_IMAGES key-image rows.
 * Never trusts snapshot metadata as ownership evidence.
 * Never accepts a row merely because draftId/studyId is null.
 */
export type KeyImageOwnershipRow = {
  id: number;
  draftId: number | null;
  studyId: number | null;
  patientId: number | null;
};

export type KeyImageOwnershipContext = {
  /** Authoritative draft id for this compose job (resolved server-side). */
  draftId: number | null;
  /** Authoritative study id (job / snapshot / draft). */
  studyId: number | null;
  worklistId: number | null;
  patientId: number | null;
  /** Fields from the authoritative draft row (for legacy linkage proof). */
  draftStudyId: number | null;
  draftWorklistId: number | null;
  draftPatientId: number | null;
};

export type OwnershipCheckResult =
  | { ok: true }
  | { ok: false; safeError: string; detail?: string };

function patientConflict(
  row: KeyImageOwnershipRow,
  ctx: KeyImageOwnershipContext,
): boolean {
  return (
    row.patientId != null &&
    ctx.patientId != null &&
    row.patientId !== ctx.patientId
  );
}

function draftLinksToJob(ctx: KeyImageOwnershipContext): boolean {
  if (ctx.draftId == null) return false;
  if (ctx.studyId != null && ctx.draftStudyId != null && ctx.draftStudyId === ctx.studyId) {
    return true;
  }
  if (
    ctx.worklistId != null &&
    ctx.draftWorklistId != null &&
    ctx.draftWorklistId === ctx.worklistId
  ) {
    return true;
  }
  if (
    ctx.patientId != null &&
    ctx.draftPatientId != null &&
    ctx.draftPatientId === ctx.patientId
  ) {
    return true;
  }
  return false;
}

/**
 * Positive ownership proof for one key-image row against authoritative job context.
 */
export function verifyKeyImageRowOwnership(
  row: KeyImageOwnershipRow,
  ctx: KeyImageOwnershipContext,
): OwnershipCheckResult {
  if (ctx.draftId == null && ctx.studyId == null) {
    return {
      ok: false,
      safeError: "selected_images_ownership_unverified",
      detail: "Compose job has no authoritative draft or study identity.",
    };
  }

  if (patientConflict(row, ctx)) {
    return {
      ok: false,
      safeError: "selected_images_ownership_unverified",
      detail: "Key image patient does not match the reporting draft.",
    };
  }

  const rowDraft = row.draftId;
  const rowStudy = row.studyId;
  const draftMismatch =
    ctx.draftId != null && rowDraft != null && rowDraft !== ctx.draftId;
  const studyMismatch =
    ctx.studyId != null && rowStudy != null && rowStudy !== ctx.studyId;

  if (draftMismatch) {
    return {
      ok: false,
      safeError: "selected_images_cross_draft",
      detail: "Selected key image does not belong to this draft.",
    };
  }
  if (studyMismatch) {
    return {
      ok: false,
      safeError: "selected_images_cross_study",
      detail: "Selected key image does not belong to this study.",
    };
  }

  // Both authoritative identifiers available.
  if (ctx.draftId != null && ctx.studyId != null) {
    if (rowDraft != null && rowStudy != null) {
      if (rowDraft === ctx.draftId && rowStudy === ctx.studyId) return { ok: true };
      return {
        ok: false,
        safeError: "selected_images_ownership_unverified",
        detail: "Key image draft/study pair does not match the compose job.",
      };
    }

    // Legacy: draftId present, studyId null — prove via authoritative draft linkage.
    if (rowDraft != null && rowDraft === ctx.draftId && rowStudy == null) {
      if (draftLinksToJob(ctx)) return { ok: true };
      return {
        ok: false,
        safeError: "selected_images_ownership_unverified",
        detail: "Legacy key image draft link could not be correlated to study/worklist.",
      };
    }

    // Legacy: studyId present, draftId null — require patient + draft study match.
    if (rowStudy != null && rowStudy === ctx.studyId && rowDraft == null) {
      if (
        row.patientId != null &&
        ctx.patientId != null &&
        row.patientId === ctx.patientId &&
        ctx.draftStudyId === ctx.studyId
      ) {
        return { ok: true };
      }
      return {
        ok: false,
        safeError: "selected_images_ownership_unverified",
        detail: "Legacy key image lacks draft association and cannot be proven.",
      };
    }

    // Both null on row — never accept.
    return {
      ok: false,
      safeError: "selected_images_ownership_unverified",
      detail: "Key image has no draft or study identity.",
    };
  }

  // Only draft authoritative.
  if (ctx.draftId != null) {
    if (rowDraft != null && rowDraft === ctx.draftId) return { ok: true };
    return {
      ok: false,
      safeError:
        rowDraft == null ? "selected_images_ownership_unverified" : "selected_images_cross_draft",
      detail: "Selected key image does not belong to this draft.",
    };
  }

  // Only study authoritative.
  if (ctx.studyId != null) {
    if (rowStudy != null && rowStudy === ctx.studyId) {
      if (
        row.patientId != null &&
        ctx.patientId != null &&
        row.patientId === ctx.patientId
      ) {
        return { ok: true };
      }
      return {
        ok: false,
        safeError: "selected_images_ownership_unverified",
        detail: "Study match alone is insufficient without patient/draft linkage.",
      };
    }
    return {
      ok: false,
      safeError:
        rowStudy == null ? "selected_images_ownership_unverified" : "selected_images_cross_study",
      detail: "Selected key image does not belong to this study.",
    };
  }

  return { ok: false, safeError: "selected_images_ownership_unverified" };
}
