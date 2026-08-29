/**
 * mriStudyPrefetch.ts — browser-side warm-up for Reporting Workspace MRI opens.
 *
 * After the worklist loads, prefetch DICOMweb series metadata (and rendered
 * thumbnails) for up to N StudyInstanceUIDs against the SAME dicomWebBaseUrl the
 * embedded viewer uses. Relies on HTTP disk cache + Orthanc already warmed by
 * the server-side mriStudyWarmer — does NOT store pixels in IndexedDB or the ERP DB.
 *
 * Why not put DICOM in the ERP database?
 *   - MRI studies are hundreds of MB–GB; Postgres/ERP is the wrong store.
 *   - Orthanc already is the cache; warming it (server) + HTTP cache (browser)
 *     is the durable pattern. ERP only orchestrates which UIDs to touch.
 */

import { isClinicPeakHours } from "./clinicPeakHours";
import { dicomWebFetch, withDicomWebAuth } from "./browserDicomWeb";

const PREFETCH_CONCURRENCY = 2;
const MAX_STUDIES = 20;
/** Series to warm per study on the queue (metadata + one small preview each). */
const MAX_SERIES_PER_QUEUE_STUDY = 8;
/** When the active study opens, warm more series so sequence switches are fast. */
const MAX_SERIES_ACTIVE_STUDY = 24;

export type PrefetchTarget = {
  studyInstanceUID: string;
  dicomWebBaseUrl: string;
};

const warmed = new Set<string>();
const activeWarmed = new Set<string>();

function keyOf(t: PrefetchTarget): string {
  return `${t.dicomWebBaseUrl}::${t.studyInstanceUID}`;
}

async function warmSeriesList(
  t: PrefetchTarget,
  maxSeries: number,
  previewAllSeries: boolean,
): Promise<void> {
  const base = t.dicomWebBaseUrl.replace(/\/$/, "");
  const seriesUrl = `${base}/studies/${encodeURIComponent(t.studyInstanceUID)}/series`;
  const res = await dicomWebFetch(seriesUrl);
  if (!res.ok) return;
  const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
  const series = (Array.isArray(data) ? data : [])
    .map((s) => String(s["0020000E"]?.Value?.[0] ?? ""))
    .filter(Boolean)
    .slice(0, maxSeries);

  for (const seriesUid of series) {
    const instUrl = `${base}/studies/${encodeURIComponent(t.studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances`;
    const ir = await dicomWebFetch(instUrl);
    if (!ir.ok) continue;
    const instances = (await ir.json()) as Array<Record<string, { Value?: unknown[] }>>;
    const first = (Array.isArray(instances) ? instances : [])
      .map((i) => String(i["00080018"]?.Value?.[0] ?? ""))
      .find(Boolean);
    if (!first) continue;
    // Small rendered frame — warms Orthanc decode + browser HTTP cache for
    // Frames mode and helps OHIF's first series paint after SPA load.
    const rendered = `${base}/studies/${encodeURIComponent(t.studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances/${encodeURIComponent(first)}/rendered?quality=40&viewport=256,256`;
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = withDicomWebAuth(rendered) ?? rendered;
    });
    if (!previewAllSeries) break;
  }
}

async function prefetchOne(t: PrefetchTarget): Promise<void> {
  const k = keyOf(t);
  if (warmed.has(k) || !t.studyInstanceUID || !t.dicomWebBaseUrl) return;
  warmed.add(k);
  try {
    await warmSeriesList(t, MAX_SERIES_PER_QUEUE_STUDY, true);
  } catch {
    warmed.delete(k); // allow retry later
  }
}

/** Idle-time prefetch of a queue of MRI studies (concurrency-limited). */
export function prefetchMriStudies(targets: PrefetchTarget[]): void {
  if (isClinicPeakHours()) return;
  const list = targets
    .filter((t) => t.studyInstanceUID && t.dicomWebBaseUrl)
    .filter((t) => !warmed.has(keyOf(t)))
    .slice(0, MAX_STUDIES);
  if (list.length === 0) return;

  let idx = 0;
  const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, list.length) }, async () => {
    while (idx < list.length) {
      const cur = list[idx++]!;
      await prefetchOne(cur);
      // Yield so reporting UI stays responsive.
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  void Promise.all(workers);
}

/** Prefetch the next study in the reporting queue (call on study switch). */
export function prefetchNextMriStudy(target: PrefetchTarget | null | undefined): void {
  if (!target) return;
  prefetchMriStudies([target]);
}

/**
 * Deep-warm the study currently open in Reporting Workspace: all series
 * metadata + first-frame preview for up to 24 series. Makes the next sequence
 * switch in Frames (and Orthanc-backed OHIF) hit warm cache.
 */
export function prefetchActiveStudySeries(target: PrefetchTarget | null | undefined): void {
  if (!target?.studyInstanceUID || !target.dicomWebBaseUrl) return;
  if (isClinicPeakHours()) return;
  const k = `active::${keyOf(target)}`;
  if (activeWarmed.has(k)) return;
  activeWarmed.add(k);
  void (async () => {
    try {
      await warmSeriesList(target, MAX_SERIES_ACTIVE_STUDY, true);
      warmed.add(keyOf(target));
    } catch {
      activeWarmed.delete(k);
    }
  })();
}

export function clearMriPrefetchMemory(): void {
  warmed.clear();
  activeWarmed.clear();
}
