/**
 * Pure Orthanc study-list helpers for overnight AI (no DB / no fetch).
 */
import type { InstanceRef } from "./studySnapshot";

const TAG = {
  seriesUid: "0020000E",
  sopUid: "00080018",
  modality: "00080060",
  seriesNumber: "00200011",
  instanceNumber: "00200013",
  numberOfFrames: "00280008",
} as const;

export type DcmTag = { Value?: Array<string | { Alphabetic?: string }> };
export type DcmEntry = Record<string, DcmTag>;

export function stripOrthancBase(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw.trim().replace(/\/+$/, "").replace(/\/dicom-web$/i, "");
}

/** Server-side Orthanc HTTP origin (container-to-container preferred). */
export function resolveOrthancBaseFromSources(opts: {
  envInternal?: string | null;
  envPublic?: string | null;
  orthancBaseUrl?: string | null;
  orthancUrl?: string | null;
  orthancDicomWebUrl?: string | null;
}): string | null {
  return stripOrthancBase(opts.envInternal)
    || stripOrthancBase(opts.orthancBaseUrl)
    || stripOrthancBase(opts.orthancUrl)
    || stripOrthancBase(opts.orthancDicomWebUrl)
    || stripOrthancBase(opts.envPublic);
}

export function tagStr(e: DcmEntry, tag: string): string | undefined {
  const v = e?.[tag]?.Value?.[0];
  return typeof v === "string" ? v : undefined;
}
function tagNum(e: DcmEntry, tag: string): number | undefined {
  const s = tagStr(e, tag);
  return s != null && s !== "" ? Number(s) : undefined;
}

export function instancesFromDicomWeb(
  seriesList: DcmEntry[],
  instanceLists: Array<{ seriesUid: string; instances: DcmEntry[] }>,
): InstanceRef[] {
  const out: InstanceRef[] = [];
  const seriesMeta = new Map<string, { modality?: string; seriesNumber?: number }>();
  for (const s of seriesList) {
    const seriesUid = tagStr(s, TAG.seriesUid);
    if (!seriesUid) continue;
    seriesMeta.set(seriesUid, { modality: tagStr(s, TAG.modality), seriesNumber: tagNum(s, TAG.seriesNumber) });
  }
  for (const group of instanceLists) {
    const meta = seriesMeta.get(group.seriesUid) ?? {};
    for (const inst of group.instances) {
      const sopUid = tagStr(inst, TAG.sopUid);
      if (!sopUid) continue;
      out.push({
        seriesUid: group.seriesUid,
        sopUid,
        modality: meta.modality,
        seriesNumber: meta.seriesNumber,
        instanceNumber: tagNum(inst, TAG.instanceNumber),
        numberOfFrames: tagNum(inst, TAG.numberOfFrames),
      });
    }
  }
  return out;
}

export type OrthancExpandedInstance = {
  ID?: string;
  MainDicomTags?: Record<string, string>;
  ParentSeries?: string;
};

export type OrthancSeries = {
  ID?: string;
  MainDicomTags?: Record<string, string>;
};

export function instancesFromOrthancRest(args: {
  instances: OrthancExpandedInstance[];
  seriesById: Record<string, OrthancSeries>;
}): InstanceRef[] {
  const out: InstanceRef[] = [];
  for (const inst of args.instances) {
    const sopUid = (inst.MainDicomTags?.SOPInstanceUID ?? "").trim();
    const seriesId = inst.ParentSeries ?? "";
    const seriesUid = (args.seriesById[seriesId]?.MainDicomTags?.SeriesInstanceUID ?? "").trim();
    if (!sopUid || !seriesUid) continue;
    const tags = inst.MainDicomTags ?? {};
    const seriesTags = args.seriesById[seriesId]?.MainDicomTags ?? {};
    const frames = tags.NumberOfFrames ? Number(tags.NumberOfFrames) : undefined;
    out.push({
      seriesUid,
      sopUid,
      modality: seriesTags.Modality,
      seriesNumber: seriesTags.SeriesNumber ? Number(seriesTags.SeriesNumber) : undefined,
      instanceNumber: tags.InstanceNumber ? Number(tags.InstanceNumber) : undefined,
      numberOfFrames: Number.isFinite(frames) ? frames : undefined,
      orthancInstanceId: inst.ID,
    });
  }
  return out;
}

export { TAG };
