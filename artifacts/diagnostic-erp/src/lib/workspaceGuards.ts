/** Signed-report trial edit and force-release visibility. */

export function canTrialEditSignedReport(isOwner: boolean, role: string): boolean {
  return isOwner || role === "admin";
}

export function canForceReleaseStudyLock(
  isOwner: boolean,
  role: string,
  ownerId: number | null | undefined,
  myUserId: number | null | undefined,
): boolean {
  if (isOwner || role === "admin") return true;
  return ownerId != null && myUserId != null && ownerId === myUserId;
}

/** Queue date preset when localStorage has no saved choice. */
export function defaultReadingQueueDatePreset(
  stored: string | null | undefined,
): "today" | "yesterday" | "today-yesterday" | "all" {
  if (stored === "today" || stored === "yesterday" || stored === "all" || stored === "today-yesterday") {
    return stored;
  }
  return "today";
}

export function visibleTabRefetchInterval(tabVisible: boolean, intervalMs = 30_000): number | false {
  return tabVisible ? intervalMs : false;
}
