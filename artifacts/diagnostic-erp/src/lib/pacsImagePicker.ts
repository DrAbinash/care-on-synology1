/**
 * pacsImagePicker.ts — pure helpers for "SELECT IMAGES FROM PACS".
 *
 * The picker talks to CARE's own DICOMweb proxy (`/api/radiology/dicom-web`),
 * never to Orthanc directly: no PACS credential, no internal host and no
 * patient-name matching reaches the browser. It reads the study that is already
 * bound to the open report, so a series list can never belong to another
 * patient.
 *
 * Nothing here depends on OHIF. The viewer is an optional extra surface for the
 * same job; the Orthanc path below is the one that must always work.
 */

import { BROWSER_DICOMWEB_BASE } from "./browserDicomWeb";

const UID = /^[0-9.]{1,128}$/;

/** (0028,0008) NumberOfFrames — asked for explicitly, because Orthanc's QIDO
 *  instance response does not carry it and a frame selector must not offer a
 *  frame the object cannot have. */
export const TAG_NUMBER_OF_FRAMES = "00280008";
export const QIDO_INSTANCE_FIELDS = `includefield=${TAG_NUMBER_OF_FRAMES}`;

type DicomJson = Record<string, { Value?: unknown[] } | undefined>;

function tagString(row: DicomJson, tag: string): string {
  const v = row[tag]?.Value;
  if (!v || v.length === 0) return "";
  return String(v[0] ?? "").trim();
}

function tagNumber(row: DicomJson, tag: string): number | null {
  const raw = tagString(row, tag);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export interface PacsSeries {
  uid: string;
  description: string;
  modality: string;
  number: number | null;
  instanceCount: number | null;
}

export interface PacsInstance {
  sopUid: string;
  instanceNumber: number | null;
  /** 1 when the object is single-frame or the frame count is unknown. */
  numberOfFrames: number;
}

/** QIDO series rows → picker rows, in series-number order. Rows without a
 *  SeriesInstanceUID are dropped: an image cannot be attached without one. */
export function parsePacsSeries(json: unknown): PacsSeries[] {
  const rows = Array.isArray(json) ? (json as DicomJson[]) : [];
  return rows
    .map((row) => ({
      uid: tagString(row, "0020000E"),
      description: tagString(row, "0008103E"),
      modality: tagString(row, "00080060"),
      number: tagNumber(row, "00200011"),
      instanceCount: tagNumber(row, "00201209"),
    }))
    .filter((s) => UID.test(s.uid))
    .sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999));
}

/** QIDO instance rows → picker rows, in instance-number order. */
export function parsePacsInstances(json: unknown): PacsInstance[] {
  const rows = Array.isArray(json) ? (json as DicomJson[]) : [];
  return rows
    .map((row) => ({
      sopUid: tagString(row, "00080018"),
      instanceNumber: tagNumber(row, "00200013"),
      numberOfFrames: Math.max(1, tagNumber(row, TAG_NUMBER_OF_FRAMES) ?? 1),
    }))
    .filter((i) => UID.test(i.sopUid))
    .sort((a, b) => (a.instanceNumber ?? 99999) - (b.instanceNumber ?? 99999));
}

/** A selection is one picture, so a multiframe object is selected per frame. */
export function pickKey(sopUid: string, frame: number | null): string {
  return `${sopUid}|${frame ?? ""}`;
}

/** The frames a picker should offer. A single-frame object (or one whose frame
 *  count Orthanc did not report) has no frame choice at all — null — so the
 *  request never claims a frame that may not exist. */
export function frameOptions(numberOfFrames: number): number[] | null {
  if (!Number.isFinite(numberOfFrames) || numberOfFrames < 2) return null;
  return Array.from({ length: Math.min(Math.floor(numberOfFrames), 200) }, (_, i) => i + 1);
}

export interface PacsPick {
  seriesUid: string;
  seriesDescription: string;
  modality: string;
  sopUid: string;
  instanceNumber: number | null;
  frame: number | null;
}

export interface PacsStudyContext {
  draftId: number;
  studyId?: number | null;
  patientId?: number | null;
  accessionNumber?: string | null;
  studyInstanceUid: string;
}

/** Body for POST /key-images/from-pacs. The caption starts from what the study
 *  itself says (series description, then instance number) so a printed report
 *  labels its pictures without the radiologist typing anything. */
export function buildPacsStillBody(pick: PacsPick, ctx: PacsStudyContext): Record<string, unknown> {
  if (!UID.test(pick.seriesUid) || !UID.test(pick.sopUid) || !UID.test(ctx.studyInstanceUid)) {
    throw new Error("Not a valid DICOM reference");
  }
  const caption =
    pick.seriesDescription.trim()
    || (pick.instanceNumber != null ? `Image ${pick.instanceNumber}` : "");
  return {
    draftId: ctx.draftId,
    ...(ctx.studyId ? { studyId: ctx.studyId } : {}),
    ...(ctx.patientId ? { patientId: ctx.patientId } : {}),
    ...(ctx.accessionNumber ? { accessionNumber: ctx.accessionNumber } : {}),
    studyInstanceUid: ctx.studyInstanceUid,
    seriesInstanceUid: pick.seriesUid,
    sopInstanceUid: pick.sopUid,
    ...(pick.frame != null ? { frameNumber: pick.frame } : {}),
    ...(pick.instanceNumber != null ? { instanceNumber: pick.instanceNumber } : {}),
    ...(pick.seriesDescription ? { seriesDescription: pick.seriesDescription } : {}),
    ...(pick.modality ? { modality: pick.modality } : {}),
    ...(caption ? { caption } : {}),
  };
}

/** Series list for the study bound to this report. */
export function seriesListUrl(studyInstanceUid: string): string {
  return `${BROWSER_DICOMWEB_BASE}/studies/${encodeURIComponent(studyInstanceUid)}/series`;
}

export function instanceListUrl(studyInstanceUid: string, seriesUid: string): string {
  return (
    `${BROWSER_DICOMWEB_BASE}/studies/${encodeURIComponent(studyInstanceUid)}` +
    `/series/${encodeURIComponent(seriesUid)}/instances?${QIDO_INSTANCE_FIELDS}`
  );
}

/** A rendered JPEG of one instance (or one frame of one). `size` is the longest
 *  edge in pixels; Orthanc does the windowing, so every modality previews
 *  correctly without CARE shipping a DICOM renderer. */
export function renderedImageUrl(
  ref: { studyInstanceUid: string; seriesUid: string; sopUid: string; frame: number | null },
  size: number,
): string {
  const base =
    `${BROWSER_DICOMWEB_BASE}/studies/${encodeURIComponent(ref.studyInstanceUid)}` +
    `/series/${encodeURIComponent(ref.seriesUid)}` +
    `/instances/${encodeURIComponent(ref.sopUid)}`;
  const frame = ref.frame && ref.frame >= 1 ? `/frames/${Math.floor(ref.frame)}` : "";
  return `${base}${frame}/rendered?quality=80&viewport=${size},${size}`;
}
