/**
 * The identity gate for the MANUAL worklist link door,
 * POST /api/radiology/pacs-worklist/:id/link-study (PR #1170, leg 1).
 *
 * Until this gate existed, the route accepted any studyId and copied
 * radiology_studies.patient_id onto the worklist row with no identity check
 * at all — the one remaining door where "patient A's PACS study becomes
 * patient B's" needed neither a refusal nor a record of why. Its siblings
 * already check: the auto-link path refuses cross-patient writes under an
 * APPROVED decision (worklistBillingLink.ts), and the match-decision route
 * requires an overrideReason with its audit row. The manual door had nothing.
 *
 * Decision table (worklist row's patient vs the billed study's patient):
 *
 * | worklist | study  | verdict                                            |
 * |----------|--------|----------------------------------------------------|
 * | null     | any    | LINK — the assignment workflow: an unbilled PACS    |
 * |          |        | scan receives its bill's patient; nothing to check. |
 * | set      | same   | LINK — the identity the row already claims.         |
 * | set      | other  | REFUSE LINK_PATIENT_MISMATCH — unless the request   |
 * |          |        | carries a real overrideReason (>= 3 chars), which   |
 * |          |        | links AND is audited as MANUAL_LINK_OVERRIDE.       |
 * | set      | null   | REFUSE LINK_PATIENT_UNPROVABLE — absence of a       |
 * |          |        | mismatch is not a match (ADR-005 doctrine); the     |
 * |          |        | write would also blank the row's patient. Same       |
 * |          |        | override door.                                      |
 *
 * The override is the owner-mandated authorized path for the legitimate
 * patient-correction workflow (a worklist row registered under the wrong
 * patient, corrected by linking the study that carries the right one): the
 * reason is required, trimmed, and lands in the audit row beside the
 * from/to patient ids. Everything else — refusing silently, weakening the
 * check, writing the patient master — is out of scope by instruction.
 */

export const LINK_PATIENT_MISMATCH = "LINK_PATIENT_MISMATCH";
export const LINK_PATIENT_UNPROVABLE = "LINK_PATIENT_UNPROVABLE";

/** The minimum a reason must say to count as one. Mirrors the PCPNDT
 *  override's >= 3 chars: whitespace and single letters are not reasons. */
const MIN_OVERRIDE_REASON_LENGTH = 3;

export type LinkStudyPatientGateDecision =
  | { decision: "link"; overridden: false }
  | { decision: "link"; overridden: true; overrideReason: string }
  | { decision: "refuse"; code: typeof LINK_PATIENT_MISMATCH | typeof LINK_PATIENT_UNPROVABLE; message: string };

function overrideReasonOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length >= MIN_OVERRIDE_REASON_LENGTH ? trimmed : null;
}

export function evaluateLinkStudyPatientGate(input: {
  worklistPatientId: number | null;
  studyPatientId: number | null;
  overrideReason?: unknown;
}): LinkStudyPatientGateDecision {
  const { worklistPatientId, studyPatientId } = input;

  // Assignment, not correction: the row has no patient identity to contradict.
  if (worklistPatientId == null) {
    return { decision: "link", overridden: false };
  }

  // Same patient — the identity the row already claims. A stray reason string
  // changes nothing here: MANUAL_LINK_OVERRIDE audit rows must only ever mark
  // links that actually crossed (or could not disprove) a patient boundary.
  if (studyPatientId != null && studyPatientId === worklistPatientId) {
    return { decision: "link", overridden: false };
  }

  const reason = overrideReasonOf(input.overrideReason);

  if (studyPatientId != null) {
    if (reason != null) {
      return { decision: "link", overridden: true, overrideReason: reason };
    }
    return {
      decision: "refuse",
      code: LINK_PATIENT_MISMATCH,
      message:
        "The selected study belongs to a different patient. Linking it would move this worklist entry to that patient's record. Nothing was linked. To correct a genuinely mis-registered row, repeat the link with an overrideReason stating how the patient was verified.",
    };
  }

  if (reason != null) {
    return { decision: "link", overridden: true, overrideReason: reason };
  }
  return {
    decision: "refuse",
    code: LINK_PATIENT_UNPROVABLE,
    message:
      "The selected study has no patient recorded, so CARE cannot confirm it belongs to this worklist entry's patient. Nothing was linked. Repeat the link with an overrideReason stating how the patient was verified.",
  };
}
