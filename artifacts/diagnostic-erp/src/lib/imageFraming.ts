/**
 * imageFraming.ts — non-destructive report-image presentation.
 *
 * Original DICOM pixels are never modified. Premium reports show each
 * selected image inside a fixed 4:3 viewport; zoom / pan / fitMode live on
 * the image-reference row as JSON and are applied identically in workspace
 * preview, browser print, and Chromium PDF via the same CSS variables.
 */

export type ImageFitMode = "contain" | "cover";

export interface ImageFraming {
  zoom: number;
  offsetX: number;
  offsetY: number;
  fitMode: ImageFitMode;
}

export const DEFAULT_IMAGE_FRAMING: ImageFraming = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  fitMode: "cover",
};

/** Images beyond this count continue below the two-column body, 2-up. */
export const SIDE_RAIL_MAX_IMAGES = 6;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

export function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

export function clampOffset(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(80, Math.max(-80, n));
}

export function parseImageFraming(raw: unknown): ImageFraming {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = {}; }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const fit = obj.fitMode === "contain" ? "contain" : "cover";
  return {
    zoom: clampZoom(typeof obj.zoom === "number" ? obj.zoom : 1),
    offsetX: clampOffset(typeof obj.offsetX === "number" ? obj.offsetX : 0),
    offsetY: clampOffset(typeof obj.offsetY === "number" ? obj.offsetY : 0),
    fitMode: fit,
  };
}

export function serializeImageFraming(f: ImageFraming): string {
  return JSON.stringify(parseImageFraming(f));
}

/** Inline CSS variables consumed by `.image-viewport .dicom-img`. */
export function framingInlineStyle(raw: unknown): string {
  const f = parseImageFraming(raw);
  return `--img-zoom:${f.zoom};--img-ox:${f.offsetX}%;--img-oy:${f.offsetY}%;--img-fit:${f.fitMode}`;
}

/** Same transform the PDF viewport applies — used by the workspace editor/thumbs. */
export function framingImgStyle(raw: unknown): {
  objectFit: ImageFitMode;
  objectPosition: "center";
  transform: string;
  transformOrigin: "center center";
} {
  const f = parseImageFraming(raw);
  return {
    objectFit: f.fitMode,
    objectPosition: "center",
    transform: `translate(${f.offsetX}%, ${f.offsetY}%) scale(${f.zoom})`,
    transformOrigin: "center center",
  };
}

export function sideRailCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Math.floor(total), SIDE_RAIL_MAX_IMAGES);
}

/**
 * Detect the useful (non-near-black) bounding box of an RGBA buffer.
 * Returns null when the frame is empty or the border is too small to crop.
 */
export function detectContentBoundingBox(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 18,
): { x: number; y: number; w: number; h: number } | null {
  if (width < 8 || height < 8) return null;
  const colHas = new Uint8Array(width);
  const rowHas = new Uint8Array(height);
  const minBright = threshold * 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > minBright) {
        colHas[x] = 1;
        rowHas[y] = 1;
      }
    }
  }
  let x0 = 0;
  while (x0 < width && !colHas[x0]) x0++;
  let x1 = width - 1;
  while (x1 > x0 && !colHas[x1]) x1--;
  let y0 = 0;
  while (y0 < height && !rowHas[y0]) y0++;
  let y1 = height - 1;
  while (y1 > y0 && !rowHas[y1]) y1--;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 8 || h < 8) return null;
  const areaFrac = (w * h) / (width * height);
  if (areaFrac > 0.92) return null; // already filling the frame
  if (areaFrac < 0.04) return null;
  return { x: x0, y: y0, w, h };
}

/**
 * Suggest a cover-mode zoom/pan that fills the 4:3 viewport with the
 * detected content box. Never applied permanently — the radiologist reviews.
 */
export function suggestFramingFromBox(
  box: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
): ImageFraming {
  const pad = 0.04;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const zoomX = imgW / Math.max(1, box.w * (1 + pad));
  const zoomY = imgH / Math.max(1, box.h * (1 + pad));
  const zoom = clampZoom(Math.max(zoomX, zoomY));
  const offsetX = clampOffset(((imgW / 2 - cx) / imgW) * 100);
  const offsetY = clampOffset(((imgH / 2 - cy) / imgH) * 100);
  return { zoom, offsetX, offsetY, fitMode: "cover" };
}
