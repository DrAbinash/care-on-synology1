/**
 * Study image fetch — Orthanc access for overnight AI drafts.
 *
 * Production Orthanc on the NAS is REST-first (RegisteredUsers + Docker
 * hostname). Overnight jobs used to call unauthenticated DICOMweb on
 * `pacs_settings.orthanc_base_url` only — that key is often empty, DICOMweb
 * may be off, and 401/404 were treated as "study not arrived". Result: zero
 * successful night drafts.
 *
 * Resolution order matches reportImages.ts (server vantage):
 *   ORTHANC_INTERNAL_URL → orthanc_base_url → orthanc_url → dicomweb URL → ORTHANC_URL
 * Auth: ORTHANC_USERNAME / ORTHANC_PASSWORD.
 * Listing: DICOMweb QIDO, then Orthanc REST `/tools/find`.
 * Render: DICOMweb `/rendered`, then REST `/instances/{id}/preview`.
 */
import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import type { InstanceRef } from "./studySnapshot";
import { selectImageAnchors, type ImageAnchor, type SelectedImage, type SelectionStrategy } from "./studyImageSelection";
import {
  TAG,
  instancesFromDicomWeb,
  instancesFromOrthancRest,
  resolveOrthancBaseFromSources,
  tagStr,
  type DcmEntry,
  type OrthancExpandedInstance,
  type OrthancSeries,
} from "./studyImageFetchCore";

export {
  stripOrthancBase,
  resolveOrthancBaseFromSources,
  instancesFromDicomWeb,
  instancesFromOrthancRest,
} from "./studyImageFetchCore";

export class OrthancImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrthancImageFetchError";
  }
}

export function orthancAuthHeaders(): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  if (!user || !pass) return {};
  return { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

async function getOrthancBaseUrl(): Promise<string | null> {
  const rows = await db
    .select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value, category: pacsSettingsTable.category })
    .from(pacsSettingsTable);
  const val = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return resolveOrthancBaseFromSources({
    envInternal: process.env.ORTHANC_INTERNAL_URL,
    envPublic: process.env.ORTHANC_URL,
    orthancBaseUrl: val("orthanc_base_url"),
    orthancUrl: val("orthanc_url"),
    orthancDicomWebUrl: val("orthanc_dicomweb_url"),
  });
}

type FetchLike = typeof fetch;

function jsonHeaders(): Record<string, string> {
  return { ...orthancAuthHeaders(), Accept: "application/json" };
}

async function fetchJson(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<{ ok: boolean; status: number; body: unknown }> {
  const resp = await fetchImpl(url, { ...init, headers: { ...jsonHeaders(), ...(init.headers as Record<string, string> | undefined) } }).catch(() => null);
  if (!resp) return { ok: false, status: 0, body: null };
  const body = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, body };
}

async function listViaDicomWeb(base: string, studyInstanceUID: string, fetchImpl: FetchLike): Promise<InstanceRef[]> {
  const dicomWebBase = `${base}/dicom-web`;
  const seriesResp = await fetchJson(
    `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series`,
    { headers: { Accept: "application/dicom+json, application/json" } },
    fetchImpl,
  );
  if (seriesResp.status === 401 || seriesResp.status === 403) {
    throw new OrthancImageFetchError("Orthanc auth failed — set ORTHANC_USERNAME/ORTHANC_PASSWORD to match orthanc.json");
  }
  if (!seriesResp.ok || !Array.isArray(seriesResp.body)) return [];
  const seriesList = seriesResp.body as DcmEntry[];
  const instanceLists: Array<{ seriesUid: string; instances: DcmEntry[] }> = [];
  for (const s of seriesList) {
    const seriesUid = tagStr(s, TAG.seriesUid);
    if (!seriesUid) continue;
    const instResp = await fetchJson(
      `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances`,
      { headers: { Accept: "application/dicom+json, application/json" } },
      fetchImpl,
    );
    if (!instResp.ok || !Array.isArray(instResp.body)) continue;
    instanceLists.push({ seriesUid, instances: instResp.body as DcmEntry[] });
  }
  return instancesFromDicomWeb(seriesList, instanceLists);
}

async function listViaOrthancRest(base: string, studyInstanceUID: string, fetchImpl: FetchLike): Promise<InstanceRef[]> {
  const findResp = await fetchJson(
    `${base}/tools/find`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        Level: "Instance",
        Query: { StudyInstanceUID: studyInstanceUID },
        Expand: true,
      }),
    },
    fetchImpl,
  );
  if (findResp.status === 401 || findResp.status === 403) {
    throw new OrthancImageFetchError("Orthanc auth failed — set ORTHANC_USERNAME/ORTHANC_PASSWORD to match orthanc.json");
  }
  if (!findResp.ok || !Array.isArray(findResp.body)) return [];
  const instances = findResp.body as OrthancExpandedInstance[];
  const seriesIds = [...new Set(instances.map((i) => i.ParentSeries).filter((id): id is string => !!id))];
  const seriesById: Record<string, OrthancSeries> = {};
  for (const id of seriesIds) {
    const sResp = await fetchJson(`${base}/series/${encodeURIComponent(id)}`, {}, fetchImpl);
    if (sResp.ok && sResp.body && typeof sResp.body === "object") {
      seriesById[id] = sResp.body as OrthancSeries;
    }
  }
  return instancesFromOrthancRest({ instances, seriesById });
}

/** List a study's instance manifest via DICOMweb, then Orthanc REST. */
export async function listStudyInstances(studyInstanceUID: string, fetchImpl: FetchLike = fetch): Promise<InstanceRef[]> {
  const base = await getOrthancBaseUrl();
  if (!base) {
    throw new OrthancImageFetchError(
      "Orthanc URL not configured for overnight AI — set ORTHANC_INTERNAL_URL (or orthanc_url / orthanc_base_url)",
    );
  }
  const viaDicomWeb = await listViaDicomWeb(base, studyInstanceUID, fetchImpl);
  if (viaDicomWeb.length > 0) return viaDicomWeb;
  return listViaOrthancRest(base, studyInstanceUID, fetchImpl);
}

async function renderViaDicomWeb(
  base: string,
  studyInstanceUID: string,
  a: ImageAnchor,
  fetchImpl: FetchLike,
): Promise<Uint8Array | null> {
  const url = `${base}/dicom-web/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(a.seriesUid)}/instances/${encodeURIComponent(a.sopUid)}/rendered`;
  const r = await fetchImpl(url, { headers: { ...orthancAuthHeaders(), Accept: "image/jpeg" } }).catch(() => null);
  if (!r?.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}

async function renderViaOrthancPreview(
  base: string,
  a: ImageAnchor & { orthancInstanceId?: string },
  fetchImpl: FetchLike,
): Promise<Uint8Array | null> {
  let instanceId = a.orthancInstanceId;
  if (!instanceId) {
    const found = await fetchJson(
      `${base}/tools/find`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Level: "Instance", Query: { SOPInstanceUID: a.sopUid }, Expand: false }),
      },
      fetchImpl,
    );
    if (found.ok && Array.isArray(found.body) && typeof found.body[0] === "string") {
      instanceId = found.body[0];
    }
  }
  if (!instanceId) return null;
  const r = await fetchImpl(`${base}/instances/${encodeURIComponent(instanceId)}/preview`, {
    headers: { ...orthancAuthHeaders(), Accept: "image/jpeg" },
  }).catch(() => null);
  if (!r?.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}

/** Render selected anchors to base64 JPEGs (DICOMweb rendered, then Orthanc preview). */
export async function renderAnchors(
  studyInstanceUID: string,
  anchors: ImageAnchor[],
  maxWidthPx = 512,
  fetchImpl: FetchLike = fetch,
): Promise<SelectedImage[]> {
  const base = await getOrthancBaseUrl();
  if (!base) return [];

  const out: SelectedImage[] = [];
  for (const a of anchors) {
    let arr = await renderViaDicomWeb(base, studyInstanceUID, a, fetchImpl);
    if (!arr || arr.length === 0) {
      arr = await renderViaOrthancPreview(base, a, fetchImpl);
    }
    if (!arr || arr.length === 0) continue;
    try {
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
