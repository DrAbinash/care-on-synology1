/**
 * Pure rules behind `resyncStudyAfterTestSwap` — no DB imports, so they are
 * unit-testable the way `cancelRadiologyMwlRules.ts` is. Both the billing
 * route (which asks them inside its transaction, before the money moves) and
 * the synchroniser (which asks again after the commit) read these, so the two
 * doors cannot disagree about whether a booked examination may still move.
 */
import { isCancellableStudyStatus } from "./cancelRadiologyMwlRules";

/** What a study row says about whether the examination has been performed. */
export type StudySwapEvidence = {
  status: string;
  startedAt?: Date | null;
  acquiredAt?: Date | null;
  deliveredAt?: Date | null;
  studyInstanceUid?: string | null;
  numImages?: number | null;
};

/** The study is already an acquisition record, or is closed. */
export type StudySwapBlockReason = "acquired" | "terminal";

/**
 * Why this study must not follow the bill. `cancelled` / `delivered` reuse the
 * worklist's own terminal rule so this cannot disagree with the code that
 * removes the `.wl` file. Everything else is read as evidence that an
 * examination actually happened: a start, an image, a DICOM StudyInstanceUID
 * the PACS echoed back, or a delivery.
 */
export function studySwapSyncBlock(
  study: StudySwapEvidence | null | undefined,
): StudySwapBlockReason | null {
  if (!study) return null;
  if (!isCancellableStudyStatus(study.status)) return "terminal";
  const acquired =
    study.startedAt != null ||
    study.acquiredAt != null ||
    study.deliveredAt != null ||
    (study.studyInstanceUid ?? "").trim() !== "" ||
    Number(study.numImages ?? 0) > 0;
  return acquired ? "acquired" : null;
}

/**
 * Is the study's description the fan-out's own copy of the billed test's name?
 *
 * `generateStudiesForOrder` writes the test's name unless the order is a single
 * radiology examination carrying a bill-level description, so an exact (case-
 * and space-folded) match to the old test's name means "derived, and now
 * naming a test that no longer exists". Anything else was typed by somebody and
 * stays — a synchronization that rewrites a clerk's sentence is its own defect.
 */
export function studyDescriptionIsDerived(
  current: string | null | undefined,
  oldTestName: string | null | undefined,
): boolean {
  const c = fold(current);
  if (!c) return true;
  const baseline = fold(oldTestName);
  // A study whose catalog row is gone has no baseline to compare against, so
  // its description is treated as manual rather than silently replaced.
  if (!baseline) return false;
  return c === baseline;
}

function fold(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
