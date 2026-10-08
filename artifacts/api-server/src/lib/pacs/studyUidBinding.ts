/**
 * StudyInstanceUID binding — the single rule for when a DICOM study UID may
 * enter the CARE reporting/viewer chain from an Orthanc *search*.
 *
 * Pure and dependency-free, extracted from routes/radiology.ts for the same
 * reason radiologyWorklistDedup.ts exists: the route imports `db` at module
 * load time, so the decision itself would otherwise only be testable against
 * a live Postgres.
 *
 * THE INVARIANT (Audit D, D1):
 *   A StudyInstanceUID must never become authoritative merely because Orthanc
 *   returned a plausible patient-name / study-date / modality candidate. A
 *   wrong study is more dangerous than a missing study, because a missing
 *   study stays visibly unresolved while a wrong one is indistinguishable
 *   from a real link for the rest of its life.
 *
 *   Automatic persistence is allowed only when BOTH hold:
 *     A. exactly ONE acceptable candidate exists, AND
 *     B. it agrees with the worklist row on an EXACT strong identifier.
 *
 *   Evidence hierarchy (strongest first, exactly one must succeed):
 *     1. AccessionNumber equal after trim + case-fold
 *     2. external DICOM PatientID equal after trim + case-fold (see note below)
 *
 *   Patient name, study date and modality are deliberately NOT parameters of
 *   this function. They may narrow an Orthanc search, but narrowing is not
 *   identity, and a helper that cannot see a name cannot be talked into
 *   matching on one.
 *
 * Evidence 2 is implemented here but currently DORMANT at the route: the
 * Orthanc search helper (lib/pacs/orthancStudyFind.ts) neither queries nor
 * returns PatientID, and a worklist row only learns dicom_patient_id from PACS
 * intake — which is the same push that supplies the UID. So no row exists today
 * with a UID to find and a PatientID to match on. The rule is written now so
 * that wiring it up later cannot quietly weaken Evidence 1.
 *
 * NEVER treat the ERP's internal `patients.id` primary key as a DICOM
 * PatientID. Modality PatientIDs are external and can numerically collide with
 * serial PKs (see lib/pacs/matchingEngine.ts and the request tests around
 * dicomPatientIdPkCollision). This module only ever compares values that are
 * already DICOM-side on both ends.
 */

/** How the currently-stored StudyInstanceUID came to be on the row. */
export const STUDY_UID_PROVENANCE = {
  /** The UID arrived inside a DICOM-derived study pushed by PACS/the modality
   *  (POST /api/internal/radiology/studies). Strongest state: the identifier
   *  came with the pixels, not from a search. */
  pacsIntake: "PACS_INTAKE",
  /** A search returned exactly one candidate whose AccessionNumber equals the
   *  row's accession exactly. */
  accessionExact: "ORTHANC_ACCESSION_EXACT",
  /** A search returned exactly one candidate whose external DICOM PatientID
   *  equals the row's dicom_patient_id exactly. Dormant — see header. */
  patientIdExact: "ORTHANC_PATIENT_ID_EXACT",
} as const;

export type StudyUidProvenance = (typeof STUDY_UID_PROVENANCE)[keyof typeof STUDY_UID_PROVENANCE];

/** Every value the column may hold. NULL additionally means "unknown/legacy"
 *  and is never rewritten by this code. */
export const STUDY_UID_PROVENANCE_VALUES: readonly string[] = Object.values(STUDY_UID_PROVENANCE);

export type BindingStatus = "resolved" | "unresolved" | "ambiguous" | "conflict";

export interface BindingRowIdentity {
  /** The row's own UID, when it already has one. */
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  /** Raw external DICOM PatientID carried by the row (never patients.id). */
  dicomPatientId?: string | null;
}

export interface BindingCandidate {
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  patientId?: string | null;
}

export interface BindingDecision {
  status: BindingStatus;
  /** Populated ONLY when status is "resolved". Never write a UID otherwise. */
  studyInstanceUID: string | null;
  provenance: StudyUidProvenance | null;
  /** Which evidence settled it, for the response and for logs. */
  matchedOn: "accession" | "patientId" | null;
  /** Distinct candidate UIDs the search returned — diagnostics, not identity. */
  candidateCount: number;
  /** Stable machine reason; safe to show to an operator. */
  reason: string;
}

/** Case-folded, trimmed, empty-for-missing. Two keys agree when this is equal. */
export function identityKey(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * Collapse candidates to distinct, non-blank StudyInstanceUIDs. A search can
 * return the same study more than once, and two rows pointing at one study are
 * one candidate, not ambiguity — counting them twice would refuse a binding
 * that is actually proven. Distinctness comes from the Map key; order is
 * insertion order, which the decision never reads.
 */
export function distinctCandidateUids(
  candidates: readonly BindingCandidate[],
): Array<{ studyInstanceUID: string; accessionNumber: string; patientId: string }> {
  const byUid = new Map<string, { studyInstanceUID: string; accessionNumber: string; patientId: string }>();
  for (const c of candidates) {
    const uid = (c.studyInstanceUID ?? "").trim();
    if (!uid) continue;
    byUid.set(uid, {
      studyInstanceUID: uid,
      accessionNumber: identityKey(c.accessionNumber),
      patientId: identityKey(c.patientId),
    });
  }
  return [...byUid.values()];
}

/**
 * The whole D1 rule.
 *
 * Fail-closed outcomes:
 *   0 candidates                      -> unresolved
 *   row has no strong identifier      -> unresolved ("no-strong-identifier")
 *   1 candidate on the exact key, but
 *     its OTHER strong identifier
 *     conflicts with the row          -> conflict
 *   >1 candidate on the exact key     -> ambiguous
 *   no candidate on any key           -> unresolved
 */
export function decideStudyUidBinding(
  row: BindingRowIdentity,
  candidates: readonly BindingCandidate[],
): BindingDecision {
  const pool = distinctCandidateUids(candidates);
  const candidateCount = pool.length;
  const base = { candidateCount } as const;

  const rowAccession = identityKey(row.accessionNumber);
  const rowPatientId = identityKey(row.dicomPatientId);

  if (!rowAccession && !rowPatientId) {
    return {
      status: "unresolved",
      studyInstanceUID: null,
      provenance: null,
      matchedOn: null,
      ...base,
      reason: "no-strong-identifier",
    };
  }

  // Evidence 1 — exact accession. Preferred, and tried first even when the row
  // also carries a PatientID: accession is CARE's own clinical linking key.
  if (rowAccession) {
    const hits = pool.filter((c) => c.accessionNumber === rowAccession);
    if (hits.length === 1) {
      const hit = hits[0]!;
      if (rowPatientId && hit.patientId && hit.patientId !== rowPatientId) {
        return {
          status: "conflict",
          studyInstanceUID: null,
          provenance: null,
          matchedOn: "accession",
          ...base,
          reason: "patient-id-conflicts",
        };
      }
      return {
        status: "resolved",
        studyInstanceUID: hit.studyInstanceUID,
        provenance: STUDY_UID_PROVENANCE.accessionExact,
        matchedOn: "accession",
        ...base,
        reason: "exact-accession",
      };
    }
    if (hits.length > 1) {
      return {
        status: "ambiguous",
        studyInstanceUID: null,
        provenance: null,
        matchedOn: "accession",
        ...base,
        reason: "multiple-accession-candidates",
      };
    }
    // Exactly zero on the preferred key. Do NOT fall through to a weaker key
    // that the row could match by accident: a name/date/modality-shaped search
    // that returned a study with a different accession is not our study.
    if (!rowPatientId) {
      return {
        status: "unresolved",
        studyInstanceUID: null,
        provenance: null,
        matchedOn: null,
        ...base,
        reason: candidateCount === 0 ? "no-candidates" : "no-exact-accession",
      };
    }
  }

  // Evidence 2 — exact external PatientID.
  if (rowPatientId) {
    const hits = pool.filter((c) => c.patientId === rowPatientId);
    if (hits.length === 1) {
      const hit = hits[0]!;
      if (rowAccession && hit.accessionNumber && hit.accessionNumber !== rowAccession) {
        return {
          status: "conflict",
          studyInstanceUID: null,
          provenance: null,
          matchedOn: "patientId",
          ...base,
          reason: "accession-conflicts",
        };
      }
      return {
        status: "resolved",
        studyInstanceUID: hit.studyInstanceUID,
        provenance: STUDY_UID_PROVENANCE.patientIdExact,
        matchedOn: "patientId",
        ...base,
        reason: "exact-patient-id",
      };
    }
    if (hits.length > 1) {
      return {
        status: "ambiguous",
        studyInstanceUID: null,
        provenance: null,
        matchedOn: "patientId",
        ...base,
        reason: "multiple-patient-id-candidates",
      };
    }
  }

  return {
    status: "unresolved",
    studyInstanceUID: null,
    provenance: null,
    matchedOn: null,
    ...base,
    reason: candidateCount === 0 ? "no-candidates" : "no-exact-identifier",
  };
}

/**
 * Write gate. A row that already carries a UID is never re-pointed
 * automatically, and a resolver that proposes the same UID again is a no-op
 * rather than a write.
 */
export function canBindUidToRow(
  currentStudyInstanceUID: string | null | undefined,
  proposedStudyInstanceUID: string | null | undefined,
): { allowed: boolean; alreadyBound: boolean; reason: string } {
  const current = (currentStudyInstanceUID ?? "").trim();
  const proposed = (proposedStudyInstanceUID ?? "").trim();
  if (!proposed) return { allowed: false, alreadyBound: false, reason: "no-proposed-uid" };
  if (!current) return { allowed: true, alreadyBound: false, reason: "row-unbound" };
  if (current === proposed) return { allowed: false, alreadyBound: true, reason: "already-bound-same-uid" };
  return { allowed: false, alreadyBound: false, reason: "row-already-bound-to-other-study" };
}

/**
 * Candidate-safe accession -> UID map for the worklist LIST endpoint's display
 * backfill. A repeated accession with DIFFERENT UIDs is ambiguity, not a
 * pick-one: last-write-wins in a Map is exactly the rows[0] failure mode in
 * another shape, and this map's output can launch the viewer from the client.
 */
export function accessionUidMap(
  candidates: readonly BindingCandidate[],
): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, Set<string>>();
  for (const c of candidates) {
    const uid = (c.studyInstanceUID ?? "").trim();
    const acc = identityKey(c.accessionNumber);
    if (!uid || !acc) continue;
    const uids = seen.get(acc) ?? new Set<string>();
    uids.add(uid);
    seen.set(acc, uids);
  }
  for (const [acc, uids] of seen) {
    if (uids.size === 1) out.set(acc, [...uids][0]!);
  }
  return out;
}
