/**
 * scannerImaging — pure unit tests (no DOM/canvas).
 */
import { describe, it, expect } from "vitest";
import {
  lumaHistogram, percentileFromHistogram, otsuThreshold,
  grayWorldGains, applyChannelGains, flattenIllumination, suppressGlare,
  shouldAutoCrop,
} from "./scannerImaging";

/** Build RGBA data of `n` pixels with a per-pixel (r,g,b) from `fn`. */
function rgba(n: number, fn: (i: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = fn(i);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  return d;
}

describe("lumaHistogram + percentileFromHistogram", () => {
  it("bins luminance and returns correct percentiles", () => {
    // 100 pixels: gray ramp 0..99 (luma == value since r=g=b)
    const d = rgba(100, (i) => [i, i, i]);
    const hist = lumaHistogram(d);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentileFromHistogram(hist, 100, 0.5)).toBeGreaterThanOrEqual(49);
    expect(percentileFromHistogram(hist, 100, 0.5)).toBeLessThanOrEqual(51);
    expect(percentileFromHistogram(hist, 100, 0.02)).toBeLessThan(5);
    expect(percentileFromHistogram(hist, 100, 0.98)).toBeGreaterThan(94);
  });
  it("handles empty input", () => {
    expect(percentileFromHistogram(new Uint32Array(256), 0, 0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe("otsuThreshold", () => {
  it("separates a clear bimodal (dark text on light paper)", () => {
    // 80 light pixels (~230) + 20 dark pixels (~30). Binarizing with `<= t`
    // must put the dark class below/at the threshold and the light class above.
    const d = rgba(100, (i) => (i < 20 ? [30, 30, 30] : [230, 230, 230]));
    const t = otsuThreshold(lumaHistogram(d), 100);
    expect(30).toBeLessThanOrEqual(t); // dark (30) → black
    expect(230).toBeGreaterThan(t);    // light (230) → white
  });
  it("is stable for a uniform image", () => {
    const d = rgba(50, () => [128, 128, 128]);
    const t = otsuThreshold(lumaHistogram(d), 50);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(255);
  });
});

describe("grayWorldGains + applyChannelGains", () => {
  it("computes gains that neutralize a colour cast toward gray", () => {
    // Yellow cast: high R,G, low B
    const d = rgba(100, () => [200, 200, 100]);
    const g = grayWorldGains(d);
    // Blue is under-represented → gets boosted (>1); red/green damped (<1)
    expect(g.b).toBeGreaterThan(1);
    expect(g.r).toBeLessThanOrEqual(1);
    applyChannelGains(d, g);
    // After balancing, channel means should be much closer together
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
    const n = d.length / 4;
    expect(Math.abs(sr / n - sb / n)).toBeLessThan(80); // was 100 before
  });
  it("clamps extreme gains to [0.5, 2]", () => {
    const d = rgba(10, () => [255, 255, 1]); // near-zero blue → huge gain, must clamp
    const g = grayWorldGains(d);
    expect(g.b).toBeLessThanOrEqual(2);
    expect(g.r).toBeGreaterThanOrEqual(0.5);
  });
});

describe("flattenIllumination", () => {
  it("flattens a left-to-right lighting gradient toward uniform brightness", () => {
    const w = 40, h = 8;
    // A horizontal brightness gradient (shadow on the left, bright on the right)
    const d = rgba(w * h, (i) => { const x = i % w; const v = 60 + Math.round((x / (w - 1)) * 180); return [v, v, v]; });
    const meanLuma = (arr: Uint8ClampedArray) => {
      let s = 0; for (let i = 0; i < arr.length; i += 4) s += arr[i]; return s / (arr.length / 4);
    };
    // Column means before: strongly increasing left→right.
    const before = d.slice();
    flattenIllumination(d, w, h, 8, 1);
    // After flattening, the spread between the darkest and brightest column
    // means should shrink (illumination removed).
    const colMean = (arr: Uint8ClampedArray, x: number) => {
      let s = 0; for (let y = 0; y < h; y++) s += arr[(y * w + x) * 4]; return s / h;
    };
    const spreadBefore = colMean(before, w - 1) - colMean(before, 0);
    const spreadAfter = colMean(d, w - 1) - colMean(d, 0);
    expect(spreadAfter).toBeLessThan(spreadBefore);
    expect(meanLuma(d)).toBeGreaterThan(meanLuma(before)); // pushed toward white
  });
  it("no-ops on a tiny image", () => {
    const d = rgba(1, () => [10, 10, 10]);
    flattenIllumination(d, 1, 1, 8, 1);
    expect(d[0]).toBe(10);
  });
});

describe("suppressGlare", () => {
  it("tones down a blown-out white specular highlight", () => {
    const d = rgba(4, () => [255, 255, 255]); // pure-white glare
    suppressGlare(d, 200, 32, 0.7);
    // Every channel is pulled below 255 (glare no longer clips to pure white).
    expect(d[0]).toBeLessThan(255);
    expect(d[0]).toBe(d[1]); // stays neutral gray
    expect(d[0]).toBe(d[2]);
    // With hiThresh=200, strength=0.7: target = 200 + 55*0.3 = 216.5 → ~217.
    expect(d[0]).toBeGreaterThanOrEqual(210);
    expect(d[0]).toBeLessThanOrEqual(222);
  });
  it("leaves coloured bright pixels (saffron header) untouched", () => {
    const d = rgba(4, () => [255, 153, 51]); // saturated saffron — not specular
    suppressGlare(d, 200, 32, 0.9);
    expect([d[0], d[1], d[2]]).toEqual([255, 153, 51]);
  });
  it("leaves mid/low luminance pixels untouched", () => {
    const d = rgba(4, () => [150, 150, 150]); // below hiThresh
    suppressGlare(d, 200, 32, 0.9);
    expect(d[0]).toBe(150);
  });
  it("strength 0 is a no-op even on glare", () => {
    const d = rgba(4, () => [255, 255, 255]);
    suppressGlare(d, 200, 32, 0);
    expect(d[0]).toBe(255);
  });
});

describe("shouldAutoCrop", () => {
  // Fixture crop dimensions below are the EXACT output of the real
  // detectCardCrop() (IdCardScanPanel.tsx), run against synthetic test images
  // via node-canvas in a throwaway sandbox script — not invented numbers. That
  // exercise is what caught the bug this replaces: the previous guard ("keep
  // >=60% of the full FRAME area") rejected the flatbed-scan case below (a
  // correct, non-clipping crop at just 52% of frame area) because it
  // conflated "small crop" with "wrong crop" — unrelated once the frame has
  // any real scan margin, which is the normal case.
  it("accepts a clean flatbed scan (a correct crop the old 60%-frame-area floor wrongly rejected)", () => {
    expect(shouldAutoCrop(947, 597, 1200, 900)).toBe(true);
  });
  it("accepts a phone photo on a dark background with normal margins", () => {
    expect(shouldAutoCrop(915, 612, 1080, 1440)).toBe(true);
  });
  it("rejects a dark-on-dark clip-risk detection (locked onto a small near-square logo blob)", () => {
    expect(shouldAutoCrop(251, 257, 1000, 1400)).toBe(false);
  });
  it("accepts a card that fills nearly the whole frame", () => {
    expect(shouldAutoCrop(898, 559, 900, 560)).toBe(true);
  });
  it("accepts a portrait-oriented card (taller than wide)", () => {
    expect(shouldAutoCrop(697, 997, 900, 1200)).toBe(true);
  });
  it("rejects a card genuinely too small/far-away to be a reliable crop", () => {
    expect(shouldAutoCrop(303, 232, 2000, 1500)).toBe(false);
  });
  it("rejects zero/negative dimensions instead of throwing", () => {
    expect(shouldAutoCrop(0, 100, 1000, 1000)).toBe(false);
    expect(shouldAutoCrop(100, 0, 1000, 1000)).toBe(false);
    expect(shouldAutoCrop(100, 100, 0, 1000)).toBe(false);
    expect(shouldAutoCrop(-10, 100, 1000, 1000)).toBe(false);
  });
});
