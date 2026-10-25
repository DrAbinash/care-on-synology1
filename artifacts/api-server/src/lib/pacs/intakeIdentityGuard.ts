/**
 * DICOM intake identity guard.
 *
 * The intake cascade in routes/internal-radiology.ts resolves an incoming study
 * against `radiology_studies` through six tiers and then writes `status`,
 * `acquiredAt`, `studyInstanceUid` and `accessionNumber` onto whatever row the
 * cascade picked. Until now nothing compared the picked row's own identity to
 * the identity arriving with the pixels.
 *
 * That gap is a wrong-patient mechanism, not a theoretical one. Accession is
 * CARE's clinical linking key but it is NOT unique — the same file documents
 * that "real DICOM data from misconfigured modalities can push the same bogus
 * accession text for genuinely different studies" (internal-radiology.ts,
 * worklist dedup comment). Tier 2 selects the first normalized-accession row
 * with `.limit(1)`, so a reused accession hands over patient A's billed study
 * to patient B's incoming study, and the write then stamps B's
 * StudyInstanceUID onto A's row. From there the worklist row is built with A's
 * billed study and B's patient, and the report is written under both.
 *
 * So: refuse the link BEFORE any mutation, and reuse the convention the rest of
 * this cascade already follows — an unusable match leaves the study UNMATCHED
 * and it lands in Match Center for a human. Ambiguity is never resolved by
 * guessing, and no new HTTP status is introduced for the modality bridge to
 * mis-handle.
 *
 * Deliberately NOT checked here: name, date-of-birth and modality agreement.
 * Modality mismatch already has its own warning path in matchingEngine, and
 * demographic fuzziness is exactly what Match Center exists to adjudicate.
 * Only two facts are hard contradictions: a different patient, and a different
 * already-recorded StudyInstanceUID.
 */

export type IntakeCandidateIdentity = {
  /** radiology_studies.patient_id — the internal patients.id FK, nullable. */
  patientId?: number | string | null;
  /** radiology_studies.study_instance_uid — nullable. */
  studyInstanceUid?: string | null;
};

export type IntakeIncomingIdentity = {
  /** Resolved internal patients.id, or null when the study arrived unlinked. */
  resolvedPatientId?: number | null;
  /** StudyInstanceUID arriving with this study. */
  studyInstanceUID?: string | null;
};

export type IntakeGuardReason = "patient-id-conflicts" | "study-uid-conflicts";

export type IntakeGuardVerdict =
  | { matched: true }
  | { matched: false; reason: IntakeGuardReason };

function asId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asUid(value: string | null | undefined): string | null {
  const t = typeof value === "string" ? value.trim() : "";
  return t || null;
}

/**
 * Is the row the cascade picked actually the incoming study's own row?
 *
 * Both sides must carry the fact before it can contradict anything: a billed
 * study with no patient linked yet is not a conflict, it is the normal
 * register-then-image order, and refusing it would block every study whose
 * accession was booked before its patient was chosen.
 */
export function assessIntakeIdentity(
  candidate: IntakeCandidateIdentity | null | undefined,
  incoming: IntakeIncomingIdentity,
): IntakeGuardVerdict {
  if (!candidate) return { matched: true };

  const rowPatientId = asId(candidate.patientId);
  const incomingPatientId = asId(incoming.resolvedPatientId);
  if (rowPatientId !== null && incomingPatientId !== null && rowPatientId !== incomingPatientId) {
    return { matched: false, reason: "patient-id-conflicts" };
  }

  const rowUid = asUid(candidate.studyInstanceUid);
  const incomingUid = asUid(incoming.studyInstanceUID);
  if (rowUid !== null && incomingUid !== null && rowUid !== incomingUid) {
    return { matched: false, reason: "study-uid-conflicts" };
  }

  return { matched: true };
}
