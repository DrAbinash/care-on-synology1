/**
 * Human label for how far a bill's timestamp sits from the moment its DICOM
 * study reached CARE. Explains Match Center suggestion order; it is not
 * evidence of identity, so nothing in the auto-link path consults it.
 */
export function formatBillToScanGap(minutes: number | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  const abs = Math.abs(minutes);
  const span =
    abs < 60
      ? `${abs} min`
      : abs < 1440
        ? `${Math.floor(abs / 60)} h ${abs % 60} min`
        : `${Math.round(abs / 1440)} days`;
  return minutes >= 0 ? `bill raised ${span} before scan` : `bill raised ${span} after scan`;
}
