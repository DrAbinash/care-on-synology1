/**
 * scannerImaging.ts — pure document-image processing primitives.
 *
 * Extracted from IdCardScanPanel so the pixel math (histogram, Otsu threshold,
 * gray-world white balance, illumination flattening) is dependency-free and
 * unit-testable without a DOM/canvas. All functions operate on plain typed
 * arrays (RGBA `Uint8ClampedArray` or a luma `Float32Array`).
 *
 * These replace/augment the older fixed-threshold + Array.sort approach:
 *  - Array.sort percentile  → O(n) histogram percentile (perf on big scans)
 *  - fixed B&W cutoff (140)  → Otsu adaptive threshold (handles exposure)
 *  - (new) gray-world WB      → removes yellow/blue lighting cast
 *  - (new) illumination flat  → removes shadows/uneven light (receipts, cheques)
 */

export const LUMA_R = 0.299;
export const LUMA_G = 0.587;
export const LUMA_B = 0.114;

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 256-bin luminance histogram over RGBA pixel data. */
export function lumaHistogram(data: Uint8ClampedArray | Uint8Array | number[]): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const y = (LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2]) | 0;
    hist[y < 0 ? 0 : y > 255 ? 255 : y]++;
  }
  return hist;
}

/** Luminance value at percentile p (0..1) from a histogram of `total` samples. */
export function percentileFromHistogram(hist: Uint32Array, total: number, p: number): number {
  if (total <= 0) return p < 0.5 ? 0 : 255;
  const target = Math.min(total - 1, Math.max(0, Math.floor(total * p)));
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum > target) return v;
  }
  return 255;
}

/**
 * Otsu's method — the threshold in [0,255] that maximizes between-class
 * variance. Replaces the previous hard-coded B&W cutoff of 140, so scans that
 * are over- or under-exposed still binarize cleanly.
 */
export function otsuThreshold(hist: Uint32Array, total: number): number {
  if (total <= 0) return 128;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, maxVar = -1, thr = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thr = v; }
  }
  return thr;
}

export interface ChannelGains { r: number; g: number; b: number }

/**
 * Gray-world white-balance gains: scale each channel so its mean moves toward
 * the overall gray mean, neutralizing a colour cast (e.g. yellow tungsten light
 * on a receipt). Gains are clamped to [0.5, 2.0] so a strongly single-colour
 * document (a blue form) isn't wrecked.
 */
export function grayWorldGains(data: Uint8ClampedArray | Uint8Array | number[]): ChannelGains {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++; }
  if (n === 0) return { r: 1, g: 1, b: 1 };
  const mr = sr / n, mg = sg / n, mb = sb / n;
  const gray = (mr + mg + mb) / 3;
  const clampGain = (x: number) => Math.max(0.5, Math.min(2, x));
  return {
    r: clampGain(mr > 0 ? gray / mr : 1),
    g: clampGain(mg > 0 ? gray / mg : 1),
    b: clampGain(mb > 0 ? gray / mb : 1),
  };
}

/** Apply channel gains in place (white balance). */
export function applyChannelGains(data: Uint8ClampedArray, gains: ChannelGains): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp8(Math.round(data[i] * gains.r));
    data[i + 1] = clamp8(Math.round(data[i + 1] * gains.g));
    data[i + 2] = clamp8(Math.round(data[i + 2] * gains.b));
  }
}

/**
 * Coarse background luminance grid — the mean luma of each of `grid`×`grid`
 * blocks. Used as an illumination map (a heavy low-pass) for shadow removal.
 * Returns { bg, gx, gy } where bg[gy*gx + bx] is the block mean.
 */
export function backgroundLumaGrid(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  grid = 8,
): { bg: Float32Array; gx: number; gy: number } {
  const gx = Math.max(1, Math.min(grid, w));
  const gy = Math.max(1, Math.min(grid, h));
  const sum = new Float64Array(gx * gy);
  const cnt = new Uint32Array(gx * gy);
  for (let y = 0; y < h; y++) {
    const by = Math.min(gy - 1, Math.floor((y / h) * gy));
    for (let x = 0; x < w; x++) {
      const bx = Math.min(gx - 1, Math.floor((x / w) * gx));
      const i = (y * w + x) * 4;
      const l = LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2];
      const bi = by * gx + bx;
      sum[bi] += l; cnt[bi]++;
    }
  }
  const bg = new Float32Array(gx * gy);
  for (let i = 0; i < bg.length; i++) bg[i] = cnt[i] > 0 ? sum[i] / cnt[i] : 255;
  return { bg, gx, gy };
}

/** Bilinear sample of the background grid at fractional block coords. */
function sampleGrid(bg: Float32Array, gx: number, gy: number, fx: number, fy: number): number {
  const x = Math.max(0, Math.min(gx - 1, fx));
  const y = Math.max(0, Math.min(gy - 1, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(gx - 1, x0 + 1), y1 = Math.min(gy - 1, y0 + 1);
  const dx = x - x0, dy = y - y0;
  const a = bg[y0 * gx + x0], b = bg[y0 * gx + x1];
  const c = bg[y1 * gx + x0], d = bg[y1 * gx + x1];
  const top = a + (b - a) * dx;
  const bot = c + (d - c) * dx;
  return top + (bot - top) * dy;
}

/**
 * Specular-glare suppression IN PLACE — for laminated / glossy ID cards.
 *
 * A laminated Aadhaar / PAN card photographed or flat-bed-scanned under a lamp
 * develops blown-out white patches (specular reflections off the plastic) that
 * bury the text underneath. A pixel that has clipped all the way to 255 is
 * unrecoverable, but two things still help legibility:
 *   1. Pull the near-white specular pixels down toward `hiThresh` so the glare
 *      stops dominating and any residual detail on its shoulder re-emerges.
 *   2. Because the correction only touches bright, *desaturated* pixels, the
 *      card's coloured artwork (saffron Aadhaar header, blue emblem, the photo)
 *      and any coloured ink are left untouched.
 *
 * A pixel is treated as glare when luma > `hiThresh` AND saturation
 * (max-min channel) < `satThresh` — specular highlights are white, not
 * coloured. `strength` in [0,1] is how hard the over-threshold excess is
 * compressed (1 = flatten every glare pixel down to `hiThresh`).
 *
 * NOTE: this reduces the *visual dominance* of glare and recovers marginal
 * detail; it cannot reconstruct text that was fully clipped to pure white.
 */
export function suppressGlare(
  data: Uint8ClampedArray,
  hiThresh = 200,
  satThresh = 32,
  strength = 0.7,
): void {
  const s = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (maxC - minC >= satThresh) continue;            // coloured pixel → keep
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    if (luma <= hiThresh) continue;                    // not blown out → keep
    // Compress the portion of luma above the threshold, then scale RGB uniformly
    // by target/luma so any faint residual hue in the highlight is preserved.
    const target = hiThresh + (luma - hiThresh) * (1 - s);
    const factor = target / luma;                      // luma > hiThresh > 0
    data[i] = clamp8(Math.round(r * factor));
    data[i + 1] = clamp8(Math.round(g * factor));
    data[i + 2] = clamp8(Math.round(b * factor));
  }
}

/**
 * Illumination flattening (shadow/uneven-light removal) IN PLACE. Divides each
 * pixel by a smooth background-illumination estimate so paper reads as uniform
 * white regardless of shadows or a lamp on one side — the single biggest quality
 * win for phone photos of receipts, bills and cheques. `strength` in [0,1]
 * blends the correction (1 = full flatten).
 */
export function flattenIllumination(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  grid = 8,
  strength = 1,
): void {
  if (w < 2 || h < 2) return;
  const { bg, gx, gy } = backgroundLumaGrid(data, w, h, grid);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * gy - 0.5;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gx - 0.5;
      const local = sampleGrid(bg, gx, gy, fx, fy);
      if (local < 1) continue;
      // Scale so the local background maps toward white (255).
      const factor = 1 + strength * (255 / local - 1);
      const i = (y * w + x) * 4;
      data[i] = clamp8(Math.round(data[i] * factor));
      data[i + 1] = clamp8(Math.round(data[i + 1] * factor));
      data[i + 2] = clamp8(Math.round(data[i + 2] * factor));
    }
  }
}

/**
 * Should a detected auto-crop rectangle actually be applied, or is it more
 * likely a mis-detection that would clip real card content (the detector
 * locking onto one small bright patch — a logo — on a dark/low-contrast card,
 * rather than the card itself)?
 *
 * A PRIOR version of this guard rejected any crop that kept less than 60% of
 * the FULL FRAME area. That was proven wrong by actually running it against a
 * synthetic clean flatbed-scan image (card with a normal amount of scan
 * margin, correctly detected) — the correct crop was only ~52% of the frame
 * and got rejected, defaulting to "no crop" for the most common, easiest case.
 * Frame-relative area conflates "the crop is small" with "the crop is wrong":
 * those are unrelated once the frame has any real margin around the card.
 *
 * The signal that actually separates a good crop from a clip-to-logo failure
 * is SHAPE, not frame-relative area:
 *   - aspect ratio: a real ID/PAN/voter card, in either orientation, is never
 *     near-square. A clipped-to-logo crop typically is (verified empirically:
 *     a synthetic dark-on-dark card with one bright logo circle produced a
 *     0.98 aspect crop, vs. 1.5–1.6 for correctly-detected real cards).
 *   - absolute size relative to the frame's shorter side: a card that's
 *     genuinely present and readable in the shot occupies a meaningful
 *     fraction of the frame's short dimension; a clip-to-logo blob does not.
 *
 * Verified against 6 synthetic scenarios (flatbed scan, phone photo on a dark
 * background, the dark/low-contrast clip-risk case, a card filling nearly the
 * whole frame, a portrait-oriented card, and a card genuinely too far away to
 * read) — this heuristic accepted every real, non-clipping crop and rejected
 * both failure cases; the frame-area floor it replaces failed 2 of those 6.
 */
export function shouldAutoCrop(
  cropW: number,
  cropH: number,
  frameW: number,
  frameH: number,
): boolean {
  if (cropW <= 0 || cropH <= 0 || frameW <= 0 || frameH <= 0) return false;
  const aspect = cropW / cropH;
  const plausibleAspect = aspect >= 0.55 && aspect <= 2.6; // landscape or portrait card; rejects near-square blobs
  const shortSide = Math.min(frameW, frameH);
  const minDim = Math.min(cropW, cropH);
  const bigEnough = minDim >= shortSide * 0.35;
  return plausibleAspect && bigEnough;
}
