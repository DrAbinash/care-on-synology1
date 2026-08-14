export function previewRowCanResolve(r: {
  matchClass: string;
  alreadyImported: boolean;
  blocked: boolean;
  resolution?: { action: string } | null;
}): boolean {
  if (r.alreadyImported || r.blocked) return false;
  if (r.resolution) return true;
  return r.matchClass === "PROBABLE_MATCH" || r.matchClass === "CONFLICT";
}

export function resolvedCaption(r: {
  alreadyImported: boolean;
  resolution?: { carePatientLabel?: string | null; resolvedByStaffName?: string; resolvedAt?: string } | null;
  carePatientLabel?: string | null;
}): string | null {
  if (!r.resolution) return null;
  const label = r.resolution.carePatientLabel || r.carePatientLabel;
  if (!label) return null;
  const who = r.resolution.resolvedByStaffName ? ` · ${r.resolution.resolvedByStaffName}` : "";
  const when = r.resolution.resolvedAt
    ? ` · ${new Date(r.resolution.resolvedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
    : "";
  return `Resolved to: ${label}${who}${when}`;
}
