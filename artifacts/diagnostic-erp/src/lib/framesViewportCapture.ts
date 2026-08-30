/**
 * framesViewportCapture.ts — composite the FRAMES <img> viewport as displayed
 * (zoom / pan / brightness / contrast) into a JPEG Blob for frozen evidence.
 *
 * FRAMES has no ROI/measurement overlay layer — capture includes only the
 * displayed DICOM-rendered pixels with CSS display transforms applied.
 */

export type FramesViewportSnapshotV1 = {
  version: 1;
  zoom: number;
  panX: number;
  panY: number;
  brightness: number;
  contrast: number;
  rotationDeg?: number;
  flipH?: boolean;
  flipV?: boolean;
};

export type FramesCaptureResult = {
  blob: Blob;
  thumbnailBlob: Blob;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  snapshot: FramesViewportSnapshotV1;
};

const MAX_EDGE_PX = 1600;
const THUMB_EDGE_PX = 240;
const JPEG_QUALITY = 0.88;
const THUMB_QUALITY = 0.8;

function applyCssFilter(
  ctx: CanvasRenderingContext2D,
  brightnessPct: number,
  contrastPct: number,
): void {
  // Approximate the CSS filter: brightness(%) contrast(%) used by FRAMES.
  ctx.filter = `brightness(${brightnessPct}%) contrast(${contrastPct}%)`;
}

/**
 * Draw the image as currently transformed in the viewport into an offscreen
 * canvas. Uses natural image size scaled by zoom, offset by pan — matching
 * the FRAMES `<img style="transform: translate(pan) scale(zoom)">` model.
 */
export async function captureFramesViewport(opts: {
  img: HTMLImageElement;
  zoom: number;
  panX: number;
  panY: number;
  brightness: number;
  contrast: number;
  maxEdgePx?: number;
}): Promise<FramesCaptureResult> {
  const img = opts.img;
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Viewport image is not loaded");
  }

  const zoom = Number.isFinite(opts.zoom) && opts.zoom > 0 ? opts.zoom : 1;
  const panX = Number.isFinite(opts.panX) ? opts.panX : 0;
  const panY = Number.isFinite(opts.panY) ? opts.panY : 0;
  const brightness = Number.isFinite(opts.brightness) ? opts.brightness : 100;
  const contrast = Number.isFinite(opts.contrast) ? opts.contrast : 100;
  const maxEdge = opts.maxEdgePx ?? MAX_EDGE_PX;

  // Capture the transformed content bounds: the scaled image with pan offset.
  // We render onto a canvas sized to the *visible* transformed image extents
  // (not the surrounding black chrome), then downscale to maxEdge.
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const drawnW = srcW * zoom;
  const drawnH = srcH * zoom;

  // Intermediate canvas at display scale (capped).
  let outW = Math.max(1, Math.round(drawnW));
  let outH = Math.max(1, Math.round(drawnH));
  const scaleDown = Math.min(1, maxEdge / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * scaleDown));
  outH = Math.max(1, Math.round(outH * scaleDown));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);
  applyCssFilter(ctx, brightness, contrast);

  // Map pan (CSS px at display zoom) into the output canvas.
  // FRAMES applies translate then scale on the element; we draw the natural
  // image scaled to outW×outH and shift by pan * scaleDown.
  const dx = panX * scaleDown;
  const dy = panY * scaleDown;
  ctx.drawImage(img, dx, dy, outW, outH);
  ctx.filter = "none";

  const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
  const thumb = await makeThumbnail(canvas, THUMB_EDGE_PX, THUMB_QUALITY);

  return {
    blob,
    thumbnailBlob: thumb,
    mimeType: "image/jpeg",
    width: outW,
    height: outH,
    snapshot: {
      version: 1,
      zoom,
      panX,
      panY,
      brightness,
      contrast,
    },
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      type,
      quality,
    );
  });
}

async function makeThumbnail(source: HTMLCanvasElement, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, w, h);
  return canvasToBlob(c, "image/jpeg", quality);
}
