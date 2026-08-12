/**
 * Pure cancellation / active-MWL rules (no DB imports — safe for unit tests).
 */

const STUDY_TERMINAL = new Set(["cancelled", "delivered"]);
const MWL_TERMINAL = new Set(["COMPLETED", "CANCELLED", "CANCELED", "DISCONTINUED"]);

/** Pure: should an MWL row with this status still appear on the modality? */
export function isActiveMwlStatus(status: string | null | undefined): boolean {
  const s = (status || "").toUpperCase();
  if (!s) return true;
  return !MWL_TERMINAL.has(s) && s !== "ARRIVED";
}

/** Pure: should a radiology_studies row still drive MWL after cancel? */
export function isCancellableStudyStatus(status: string | null | undefined): boolean {
  return !STUDY_TERMINAL.has((status || "").toLowerCase());
}
