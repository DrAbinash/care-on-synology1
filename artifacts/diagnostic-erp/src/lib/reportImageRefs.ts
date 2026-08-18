/**
 * reportImageRefs.ts — Ticket R1.1 Phase 10/11: pure helpers for selected
 * report images.
 *
 * Selected images persist as DICOM REFERENCES only (StudyInstanceUID /
 * SeriesInstanceUID / SOPInstanceUID / FrameNumber / caption / display
 * order) — never browser blob URLs; the server resolves pixels at render
 * time. Thumbnails in the picker reuse the SAME browser DICOMweb base the
 * embedded viewer already uses (M1.2 launch contract) — no new PACS access
 * path and no public PACS URLs inside documents.
 */

export interface ReportImageRef {
  id: number;
  draftId: number;
  description: string;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  frameNumber: number | null;
  displayOrder: number;
  /** R1.3 — clinically-flagged key image (KEY badge in the rendered report). */
  isKeyImage?: boolean;
  createdBy?: string | null;
  /** Non-destructive viewport JSON persisted on the reference row. */
  presentationJson?: string | null;
}

export interface NewImageRefInput {
  draftId: number;
  studyId?: number | null;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  frameNumber?: number | null;
  caption: string;
  displayOrder: number;
  isKeyImage?: boolean;
}

/** R1.3 — a report supports up to 100 selected images (server enforces too). */
export const MAX_REPORT_IMAGES = 100;

const UID = /^[0-9.]{1,128}$/;

/** POST /api/radiology/report-generator/image-references body. Throws on a
 *  malformed UID so a bad reference can never be persisted. */
export function buildImageRefPayload(input: NewImageRefInput): Record<string, unknown> {
  for (const [name, value] of [
    ["StudyInstanceUID", input.studyInstanceUID],
    ["SeriesInstanceUID", input.seriesInstanceUID],
    ["SOPInstanceUID", input.sopInstanceUID],
  ] as const) {
    if (!UID.test(value)) throw new Error(`${name} is not a valid DICOM UID`);
  }
  return {
    draftId: input.draftId,
    ...(input.studyId ? { studyId: input.studyId } : {}),
    studyInstanceUid: input.studyInstanceUID,
    seriesInstanceUid: input.seriesInstanceUID,
    sopInstanceUid: input.sopInstanceUID,
    ...(input.frameNumber && input.frameNumber >= 1 ? { frameNumber: Math.floor(input.frameNumber) } : {}),
    description: (input.caption || "Key image").slice(0, 500),
    displayOrder: input.displayOrder,
    ...(input.isKeyImage ? { isKeyImage: true } : {}),
  };
}

/** Browser thumbnail URL on the SAME DICOMweb base the embedded viewer uses. */
export function thumbnailRenderedUrl(
  dicomWebBase: string,
  ref: { studyInstanceUid: string | null; seriesInstanceUid: string | null; sopInstanceUid: string | null; frameNumber?: number | null },
  size = 160,
): string | null {
  const { studyInstanceUid: st, seriesInstanceUid: se, sopInstanceUid: so } = ref;
  if (!st || !se || !so || !UID.test(st) || !UID.test(se) || !UID.test(so)) return null;
  const base = dicomWebBase.replace(/\/+$/, "");
  const path = `${base}/studies/${encodeURIComponent(st)}/series/${encodeURIComponent(se)}/instances/${encodeURIComponent(so)}`;
  const frame = ref.frameNumber && ref.frameNumber >= 1 ? `/frames/${Math.floor(ref.frameNumber)}` : "";
  return `${path}${frame}/rendered?quality=80&viewport=${size},${size}`;
}

/** Phase 11 — viewer deep link: opens the study in OHIF (admin-configured
 *  launch URL from the M1.2 contract; never a raw PACS URL). */
export function ohifUrlForRef(launchOhifUrl: string | null | undefined): string | null {
  return launchOhifUrl && /^https?:\/\//.test(launchOhifUrl) ? launchOhifUrl : null;
}

/** Next display order after the existing refs (stable append). */
export function nextDisplayOrder(refs: Array<{ displayOrder: number }>): number {
  return refs.reduce((max, r) => Math.max(max, r.displayOrder), -1) + 1;
}

/** R1.3 — query string for the SERVER-BUILT deep-launch URL: the server
 *  builds the viewer URL (SOP → series → study degradation happens there);
 *  the browser only names WHICH image it wants. Only valid UIDs are ever
 *  sent; a ref without a series UID launches at study level ("" query). */
export function launchQueryForRef(ref: {
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
}): string {
  const se = ref.seriesInstanceUid;
  if (!se || !UID.test(se)) return "";
  const so = ref.sopInstanceUid;
  const params = [`seriesInstanceUID=${encodeURIComponent(se)}`];
  if (so && UID.test(so)) params.push(`sopInstanceUID=${encodeURIComponent(so)}`);
  return `?${params.join("&")}`;
}

/** R1.3 — pure drag-reorder: move the item at `from` to position `to`,
 *  returning the new id order (input untouched; invalid indexes = no-op). */
export function reorderIds(ids: number[], from: number, to: number): number[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
