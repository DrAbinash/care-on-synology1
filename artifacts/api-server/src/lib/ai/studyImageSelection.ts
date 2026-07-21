/**
 * Structured image selection — pure logic (Phase P1 / Gate G6).
 *
 * No DB, no network — the Orthanc fetch/render lives in studyImageFetch.ts.
 * Replaces the old "middle instance per series" heuristic with a deterministic,
 * modality-aware selection that carries UID + frame provenance for every image.
 */
import type { InstanceRef } from "./studySnapshot";

/** An image reference with full provenance — what the Evidence Store anchors on. */
export interface ImageAnchor {
  seriesUid: string;
  sopUid: string;
  frameNumber: number;
}

export interface SelectedImage extends ImageAnchor {
  imageData: string; // base64 JPEG
}

export type SelectionStrategy = "representative" | "modality-aware";

// Cross-sectional modalities where multiple slices per series add signal.
const CROSS_SECTIONAL = new Set(["CT", "MR", "PT", "NM"]);
const MAX_SLICES_PER_SERIES = 3;

/**
 * Choose which instances to send to inference, with UID + frame provenance.
 * `modality-aware` takes a few evenly-spaced slices from cross-sectional series
 * and one representative (middle) instance otherwise; `representative` always
 * takes the single middle instance per series (the legacy behaviour). Series are
 * visited in a stable order (seriesNumber, then UID); the result is deterministic.
 */
export function selectImageAnchors(
  instances: InstanceRef[],
  opts: { modality?: string; maxImages?: number; strategy?: SelectionStrategy } = {},
): ImageAnchor[] {
  const maxImages = Math.min(opts.maxImages ?? 20, 40);
  const strategy = opts.strategy ?? "modality-aware";

  const bySeries = new Map<string, InstanceRef[]>();
  for (const i of instances) {
    if (!i.seriesUid || !i.sopUid) continue;
    if (!bySeries.has(i.seriesUid)) bySeries.set(i.seriesUid, []);
    bySeries.get(i.seriesUid)!.push(i);
  }

  const seriesEntries = [...bySeries.entries()].sort((a, b) => {
    const an = a[1][0]?.seriesNumber ?? 0;
    const bn = b[1][0]?.seriesNumber ?? 0;
    return an - bn || a[0].localeCompare(b[0]);
  });

  const modality = (opts.modality ?? instances.find((i) => i.modality)?.modality ?? "").toUpperCase();
  const crossSectional = strategy === "modality-aware" && CROSS_SECTIONAL.has(modality);

  const anchors: ImageAnchor[] = [];
  for (const [seriesUid, insts] of seriesEntries) {
    if (anchors.length >= maxImages) break;
    const sorted = insts.slice().sort((a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0));

    const pick: InstanceRef[] = [];
    if (crossSectional && sorted.length > MAX_SLICES_PER_SERIES) {
      const n = Math.min(MAX_SLICES_PER_SERIES, sorted.length);
      for (let k = 0; k < n; k++) {
        pick.push(sorted[Math.floor(((k + 1) * sorted.length) / (n + 1))]);
      }
    } else {
      pick.push(sorted[Math.floor(sorted.length / 2)]);
    }

    for (const inst of pick) {
      if (anchors.length >= maxImages) break;
      if (!inst?.sopUid) continue;
      anchors.push({ seriesUid, sopUid: inst.sopUid, frameNumber: 1 });
    }
  }
  return anchors;
}
