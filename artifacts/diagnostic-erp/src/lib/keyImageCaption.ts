/**
 * keyImageCaption.ts — auto-caption for frozen key images from observations.
 * Caption edits never mutate finding text; captionManual protects overwrites.
 */

export function buildObservationKeyImageCaption(obs: {
  level?: string | null;
  laterality?: string | null;
  findingsText?: string | null;
  lastRenderedFindings?: string | null;
  concept?: string | null;
  region?: string | null;
}): string {
  const finding = (obs.lastRenderedFindings || obs.findingsText || "").trim().replace(/\s+/g, " ");
  const locParts = [obs.level, obs.laterality].map((s) => (s ?? "").trim()).filter(Boolean);
  if (locParts.length && finding) {
    const loc = locParts.join(" ");
    const body = finding.endsWith(".") ? finding : `${finding}.`;
    return `${loc}: ${body}`.slice(0, 500);
  }
  if (finding) return finding.slice(0, 500);
  const fallback = [obs.level, obs.laterality, obs.concept || obs.region].filter(Boolean).join(" — ");
  return fallback.slice(0, 500);
}

/** Refresh caption only when the radiologist has not edited it manually. */
export function maybeRefreshCaption(opts: {
  captionManual: boolean;
  currentCaption: string;
  nextAutoCaption: string;
}): string {
  if (opts.captionManual) return opts.currentCaption;
  return opts.nextAutoCaption || opts.currentCaption;
}
