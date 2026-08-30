/**
 * framesViewportCapture.ts — freeze what is visibly inside the FRAMES
 * viewport (overflow-hidden black area), not an inferred transform math model.
 *
 * Preferred geometry: viewport.getBoundingClientRect() + img.getBoundingClientRect().
 * CSS `transform` / default `transform-origin: 50% 50%` are already reflected in
 * the image's bounding rect, so we do not re-derive zoom/pan independently.
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
  /** Output canvas CSS-pixel size before downscale (viewport). */
  viewportWidthCss?: number;
  viewportHeightCss?: number;
};

export type FramesCaptureResult = {
  blob: Blob;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  snapshot: FramesViewportSnapshotV1;
};

export type DomRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ViewportCaptureLayout = {
  canvasW: number;
  canvasH: number;
  /** Image draw destination relative to canvas origin (scaled). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  scale: number;
};

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.88;

/**
 * Map viewport + transformed image rects onto an output canvas layout.
 * Canvas size = viewport size (capped). Image is placed by relative rect
 * so browser clipping matches the canvas boundary.
 */
export function layoutViewportCapture(
  viewport: DomRectLike,
  image: DomRectLike,
  maxEdgePx: number = MAX_EDGE_PX,
): ViewportCaptureLayout {
  const vw = Math.max(1, Number(viewport.width) || 1);
  const vh = Math.max(1, Number(viewport.height) || 1);
  const edge = Number.isFinite(maxEdgePx) && maxEdgePx > 0 ? maxEdgePx : MAX_EDGE_PX;
  const scale = Math.min(1, edge / Math.max(vw, vh));
  const canvasW = Math.max(1, Math.round(vw * scale));
  const canvasH = Math.max(1, Math.round(vh * scale));
  const dx = (image.left - viewport.left) * scale;
  const dy = (image.top - viewport.top) * scale;
  const dw = Math.max(0, (Number(image.width) || 0) * scale);
  const dh = Math.max(0, (Number(image.height) || 0) * scale);
  return { canvasW, canvasH, dx, dy, dw, dh, scale };
}

function applyCssFilter(
  ctx: CanvasRenderingContext2D,
  brightnessPct: number,
  contrastPct: number,
): void {
  ctx.filter = `brightness(${brightnessPct}%) contrast(${contrastPct}%)`;
}

/**
 * Capture the pixels visible inside `viewport` (FRAMES overflow-hidden area).
 * Draws the loaded `<img>` using its live layout rect relative to the viewport.
 */
export async function captureFramesViewport(opts: {
  img: HTMLImageElement;
  viewport: HTMLElement;
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
  if (!opts.viewport) {
    throw new Error("Viewport element is required");
  }

  const zoom = Number.isFinite(opts.zoom) && opts.zoom > 0 ? opts.zoom : 1;
  const panX = Number.isFinite(opts.panX) ? opts.panX : 0;
  const panY = Number.isFinite(opts.panY) ? opts.panY : 0;
  const brightness = Number.isFinite(opts.brightness) ? opts.brightness : 100;
  const contrast = Number.isFinite(opts.contrast) ? opts.contrast : 100;
  const maxEdge = opts.maxEdgePx ?? MAX_EDGE_PX;

  const viewportRect = opts.viewport.getBoundingClientRect();
  const imageRect = img.getBoundingClientRect();
  const layout = layoutViewportCapture(viewportRect, imageRect, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  applyCssFilter(ctx, brightness, contrast);
  if (layout.dw > 0 && layout.dh > 0) {
    ctx.drawImage(img, layout.dx, layout.dy, layout.dw, layout.dh);
  }
  ctx.filter = "none";

  const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);

  return {
    blob,
    mimeType: "image/jpeg",
    width: layout.canvasW,
    height: layout.canvasH,
    snapshot: {
      version: 1,
      zoom,
      panX,
      panY,
      brightness,
      contrast,
      viewportWidthCss: viewportRect.width,
      viewportHeightCss: viewportRect.height,
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
