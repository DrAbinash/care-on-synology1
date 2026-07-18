/**
 * Study image fetch — Orthanc DICOMweb access (Phase P1 / Gate G6).
 *
 * The DB/network half of image selection (the pure selection lives in
 * studyImageSelection.ts). Reuses the same Orthanc DICOMweb pattern the legacy
 * radiologist AI-draft route uses; adds a full instance-manifest lister (for the
 * snapshot) and returns UID + frame provenance with every rendered image.
 */
import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { InstanceRef } from "./studySnapshot";
import { selectImageAnchors, type ImageAnchor, type SelectedImage, type SelectionStrategy } from "./studyImageSelection";

// DICOM tag keys used in QIDO responses.
const TAG = {
  seriesUid: "0020000E",
  sopUid: "00080018",
  modality: "00080060",
  seriesNumber: "00200011",
  instanceNumber: "00200013",
  numberOfFrames: "00280008",
} as const;

type DcmTag = { Value?: Array<string | { Alphabetic?: string }> };
type DcmEntry = Record<string, DcmTag>;

function tagStr(e: DcmEntry, tag: string): string | undefined {
  const v = e?.[tag]?.Value?.[0];
  return typeof v === "string" ? v : undefined;
}
function tagNum(e: DcmEntry, tag: string): number | undefined {
  const s = tagStr(e, tag);
  return s != null && s !== "" ? Number(s) : undefined;
}

async function getOrthancBaseUrl(): Promise<string | null> {
  const [row] = await db
    .select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, "orthanc_base_url"), eq(pacsSettingsTable.category, "orthanc")))
    .limit(1);
  return row?.value ?? null;
}

/** List a study's full instance manifest via Orthanc DICOMweb QIDO. */
export async function listStudyInstances(studyInstanceUID: string): Promise<InstanceRef[]> {
  const base = await getOrthancBaseUrl();
  if (!base) return [];
  const dicomWebBase = `${base.replace(/\/$/, "")}/dicom-web`;
  const headers = { Accept: "application/json" };

  const seriesResp = await fetch(`${dicomWebBase}/studies/${studyInstanceUID}/series`, { headers }).catch(() => null);
  if (!seriesResp?.ok) return [];
  const seriesList = (await seriesResp.json().catch(() => [])) as DcmEntry[];

  const out: InstanceRef[] = [];
  for (const s of seriesList) {
    const seriesUid = tagStr(s, TAG.seriesUid);
    if (!seriesUid) continue;
    const modality = tagStr(s, TAG.modality);
    const seriesNumber = tagNum(s, TAG.seriesNumber);
    const instResp = await fetch(
      `${dicomWebBase}/studies/${studyInstanceUID}/series/${seriesUid}/instances`,
      { headers },
    ).catch(() => null);
    if (!instResp?.ok) continue;
    const insts = (await instResp.json().catch(() => [])) as DcmEntry[];
    for (const inst of insts) {
      const sopUid = tagStr(inst, TAG.sopUid);
      if (!sopUid) continue;
      out.push({
        seriesUid,
        sopUid,
        modality,
        seriesNumber,
        instanceNumber: tagNum(inst, TAG.instanceNumber),
        numberOfFrames: tagNum(inst, TAG.numberOfFrames),
      });
    }
  }
  return out;
}

/** Render selected anchors to base64 JPEGs (WADO rendered + optional sharp resize). */
export async function renderAnchors(
  studyInstanceUID: string,
  anchors: ImageAnchor[],
  maxWidthPx = 512,
): Promise<SelectedImage[]> {
  const base = await getOrthancBaseUrl();
  if (!base) return [];
  const dicomWebBase = `${base.replace(/\/$/, "")}/dicom-web`;

  const out: SelectedImage[] = [];
  for (const a of anchors) {
    const r = await fetch(
      `${dicomWebBase}/studies/${studyInstanceUID}/series/${a.seriesUid}/instances/${a.sopUid}/rendered`,
      { headers: { Accept: "image/jpeg" } },
    ).catch(() => null);
    if (!r?.ok) continue;
    try {
      const arr = new Uint8Array(await r.arrayBuffer());
      let b64: string;
      try {
        const sharp = (await import("sharp")).default;
        const resized = await sharp(arr).resize({ width: maxWidthPx, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        b64 = resized.toString("base64");
      } catch {
        b64 = Buffer.from(arr).toString("base64");
      }
      out.push({ ...a, imageData: b64 });
    } catch {
      /* skip unreadable instance */
    }
  }
  return out;
}

/** Structured, modality-aware image selection with UID/frame provenance. */
export async function selectStudyImages(
  studyInstanceUID: string,
  opts: { modality?: string; maxImages?: number; strategy?: SelectionStrategy } = {},
): Promise<SelectedImage[]> {
  const instances = await listStudyInstances(studyInstanceUID);
  const anchors = selectImageAnchors(instances, { strategy: "modality-aware", ...opts });
  return renderAnchors(studyInstanceUID, anchors, 512);
}
