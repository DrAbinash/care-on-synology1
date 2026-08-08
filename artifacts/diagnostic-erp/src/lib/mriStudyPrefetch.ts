/**
 * mriStudyPrefetch.ts — browser-side warm-up for Reporting Workspace MRI opens.
 *
 * After the worklist loads, prefetch DICOMweb series metadata (and one rendered
 * thumbnail) for up to N StudyInstanceUIDs against the SAME dicomWebBaseUrl the
 * embedded viewer uses. Relies on HTTP disk cache + Orthanc already warmed by
 * the server-side mriStudyWarmer — does NOT store pixels in IndexedDB.
 */

const PREFETCH_CONCURRENCY = 2;
const MAX_STUDIES = 20;
const SERIES_ACCEPT = "application/dicom+json";

export type PrefetchTarget = {
  studyInstanceUID: string;
  dicomWebBaseUrl: string;
};

const warmed = new Set<string>();

function keyOf(t: PrefetchTarget): string {
  return `${t.dicomWebBaseUrl}::${t.studyInstanceUID}`;
}

async function prefetchOne(t: PrefetchTarget): Promise<void> {
  const k = keyOf(t);
  if (warmed.has(k) || !t.studyInstanceUID || !t.dicomWebBaseUrl) return;
  warmed.add(k);
  const base = t.dicomWebBaseUrl.replace(/\/$/, "");
  const seriesUrl = `${base}/studies/${encodeURIComponent(t.studyInstanceUID)}/series`;
  try {
    const res = await fetch(seriesUrl, { headers: { Accept: SERIES_ACCEPT } });
    if (!res.ok) return;
    const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
    const series = (Array.isArray(data) ? data : [])
      .map((s) => String(s["0020000E"]?.Value?.[0] ?? ""))
      .filter(Boolean)
      .slice(0, 4);
    for (const seriesUid of series) {
      const instUrl = `${base}/studies/${encodeURIComponent(t.studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances`;
      const ir = await fetch(instUrl, { headers: { Accept: SERIES_ACCEPT } });
      if (!ir.ok) continue;
      const instances = (await ir.json()) as Array<Record<string, { Value?: unknown[] }>>;
      const first = (Array.isArray(instances) ? instances : [])
        .map((i) => String(i["00080018"]?.Value?.[0] ?? ""))
        .find(Boolean);
      if (!first) continue;
      // One small rendered frame — warms WADO-RS path the Frames viewer uses.
      const rendered = `${base}/studies/${encodeURIComponent(t.studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances/${encodeURIComponent(first)}/rendered?quality=40&viewport=256,256`;
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = rendered;
      });
      break; // one preview per study is enough for open-speed
    }
  } catch {
    warmed.delete(k); // allow retry later
  }
}

/** Idle-time prefetch of a queue of MRI studies (concurrency-limited). */
export function prefetchMriStudies(targets: PrefetchTarget[]): void {
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

export function clearMriPrefetchMemory(): void {
  warmed.clear();
}
