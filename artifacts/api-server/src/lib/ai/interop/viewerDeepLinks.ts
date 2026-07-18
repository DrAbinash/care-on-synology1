/**
 * Viewer synchronization deep-links — Phase P4 / Gate G18 (pure).
 *
 * The reporting workspace already launches studies through the canonical
 * `studyLaunchService` (diagnostic-erp). This module does NOT re-implement
 * network selection or study identity — it only computes the *image-anchor
 * fragment* that lets a click on an AI finding jump the open viewer to the
 * exact series/instance that finding was inferred from (G6 image anchors →
 * G18 sync). The service layer combines the selected base URL with these
 * anchors; everything here is pure + unit-tested.
 *
 * OHIF: query params on /viewer (StudyInstanceUIDs, SeriesInstanceUID,
 *       initialSopInstanceUid) — the standard OHIF deep-link contract.
 * Weasis: a `$dicom:get` argument set narrowed to the series/instance.
 */

export interface ViewerAnchor {
  studyInstanceUid: string;
  seriesInstanceUid?: string | null;
  sopInstanceUid?: string | null;
  frameNumber?: number | null;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * Build an OHIF deep-link that opens `studyInstanceUid` and, when provided,
 * pre-selects the series and scrolls to the SOP instance. `base` is the
 * already-selected viewer base URL from studyLaunchService (no network logic
 * here). Returns null when there is no study UID to anchor to.
 */
export function buildOhifDeepLink(base: string, anchor: ViewerAnchor): string | null {
  const study = clean(anchor.studyInstanceUid);
  if (!study) return null;
  const root = base.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("StudyInstanceUIDs", study);
  const series = clean(anchor.seriesInstanceUid);
  if (series) params.set("SeriesInstanceUID", series);
  const sop = clean(anchor.sopInstanceUid);
  if (sop) params.set("initialSopInstanceUid", sop);
  const url = `${root}/viewer?${params.toString()}`;
  return url.replace(/([^:/])\/{2,}/g, "$1/");
}

/**
 * Build a Weasis launch fragment narrowed to the anchor. When a WADO URL is
 * present we emit a `$dicom:get` command scoped by study/series/object UID;
 * otherwise we fall back to a study-only retrieve. Returns null without a
 * study UID (Weasis cannot anchor on accession alone here).
 */
export function buildWeasisDeepLink(wadoBaseUrl: string | null, anchor: ViewerAnchor): string | null {
  const study = clean(anchor.studyInstanceUid);
  if (!study) return null;
  const wado = clean(wadoBaseUrl);
  const parts = [`studyUID=${study}`];
  const series = clean(anchor.seriesInstanceUid);
  if (series) parts.push(`seriesUID=${series}`);
  const sop = clean(anchor.sopInstanceUid);
  if (sop) parts.push(`objectUID=${sop}`);
  const query = parts.join("&");
  if (wado) return `weasis://$dicom:get -w "${wado}" -r "${query}"`;
  return `weasis://$dicom:get -r "${query}"`;
}

export interface FindingAnchorInput {
  key: string;
  studyInstanceUid: string;
  seriesInstanceUid?: string | null;
  sopInstanceUid?: string | null;
  frameNumber?: number | null;
}

export interface FindingViewerLink {
  key: string;
  hasAnchor: boolean;
  ohif: string | null;
  weasis: string | null;
}

/**
 * Map a list of AI findings (each carrying its G6 image anchor) to per-finding
 * viewer links. Findings without a series/instance still get a study-level
 * link but are flagged `hasAnchor: false` so the UI can disable the "jump to
 * image" affordance rather than silently opening the wrong slice.
 */
export function buildFindingViewerLinks(
  ohifBase: string,
  wadoBaseUrl: string | null,
  findings: FindingAnchorInput[],
): FindingViewerLink[] {
  return findings.map((f) => {
    const anchor: ViewerAnchor = {
      studyInstanceUid: f.studyInstanceUid,
      seriesInstanceUid: f.seriesInstanceUid,
      sopInstanceUid: f.sopInstanceUid,
      frameNumber: f.frameNumber,
    };
    return {
      key: f.key,
      hasAnchor: Boolean(clean(f.seriesInstanceUid) && clean(f.sopInstanceUid)),
      ohif: buildOhifDeepLink(ohifBase, anchor),
      weasis: buildWeasisDeepLink(wadoBaseUrl, anchor),
    };
  });
}
