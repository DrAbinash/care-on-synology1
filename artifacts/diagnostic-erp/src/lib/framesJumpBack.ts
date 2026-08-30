/**
 * Pure study-UID guard used by FRAMES goToAnchor.
 */
export function framesAnchorStudyAllowed(
  loadedStudyUID: string | null | undefined,
  anchorStudyUID: string | null | undefined,
): boolean {
  if (!anchorStudyUID || !loadedStudyUID) return true;
  return anchorStudyUID === loadedStudyUID;
}
