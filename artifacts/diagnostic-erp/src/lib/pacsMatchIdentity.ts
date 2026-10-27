/**
 * The DICOM ↔ ERP patient-identity verdict, read where a report is composed.
 *
 * CARE already scores every PACS study against the billed order it thinks it
 * belongs to: `radiology_worklist` carries `match_score`, `match_points`,
 * `match_reasons`, `match_warnings` and `match_decision`, the matching engine
 * writes them (`lib/pacs/matchingEngine.ts`), `/api/radiology/pacs-worklist`
 * already selects all five and `omitHeavyPacsWorklistFields` strips only
 * `dicomMetadata` and `aiDraftJson` — so they are on the wire to the reporting
 * workspace today. The My Collection screen reads them and lets a user approve
 * or reject a match.
 *
 * The Composer did not. A radiologist could draft and sign a report on a study
 * whose patient identity the system had already flagged, with the one screen that
 * knew about it a navigation away. This module is that existing verdict carried
 * to the second screen — no new matching, no second engine, no new columns.
 *
 * The two predicates here are lifted verbatim from `pages/MyCollection.tsx` so
 * the queue and the Composer cannot disagree about what "needs review" means;
 * that page now imports them from here.
 */

export type PacsMatchScore = "GREEN" | "YELLOW" | "RED";
export type PacsMatchDecision = "PENDING" | "APPROVED" | "REJECTED";

/** The identity fields a worklist row carries. All optional: older payloads and
 *  Orthanc-only rows predate the match, and an absent score is not a red one. */
export type PacsMatchIdentity = {
  studyId?: number | string | null;
  matchScore?: PacsMatchScore | string | null;
  matchWarnings?: string | string[] | null;
  matchDecision?: PacsMatchDecision | string | null;
};

/**
 * The list behind `match_warnings` / `match_reasons`.
 *
 * Both columns are a JSON array stored as text, and the queue screen parsed them
 * with a bare `JSON.parse` — one malformed row and the whole panel threw. A
 * warning that cannot be read must degrade to no warning, not to a crashed
 * screen.
 */
export function parseMatchStringArray(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((w) => String(w ?? "").trim()).filter(Boolean);
  const text = String(raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((w) => String(w ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** An unbilled scan has no ERP patient to disagree with, so it cannot conflict.
 *  Orthanc-only rows are built with a hardcoded RED/PENDING and would otherwise
 *  warn on every study that has simply not been linked yet. */
export function isUnbilledScan(item: PacsMatchIdentity): boolean {
  return item.studyId == null;
}

export function needsMatchReview(item: PacsMatchIdentity): boolean {
  return !isUnbilledScan(item) && item.matchDecision === "PENDING" && item.matchScore !== "GREEN";
}

export function isResolvedMatch(item: PacsMatchIdentity): boolean {
  return item.matchScore === "GREEN" || item.matchDecision === "APPROVED";
}

export type ComposerIdentityConflict = {
  score: PacsMatchScore;
  decision: PacsMatchDecision | string;
  warnings: string[];
};

/**
 * What the Composer should say about this study's patient identity, or null when
 * it should say nothing.
 *
 * Null is the common answer and it is deliberately so: a warning the radiologist
 * sees on every study is a warning he stops reading, and the point of this is the
 * one study whose patient may be somebody else. GREEN, an approved match and an
 * as-yet-unlinked scan are all silence.
 */
export function composerIdentityConflict(
  item: PacsMatchIdentity | null | undefined,
): ComposerIdentityConflict | null {
  if (!item || !needsMatchReview(item)) return null;
  const score = (item.matchScore === "YELLOW" || item.matchScore === "RED"
    ? item.matchScore
    : "RED") as PacsMatchScore;
  return {
    score,
    decision: item.matchDecision ?? "PENDING",
    warnings: parseMatchStringArray(item.matchWarnings),
  };
}
