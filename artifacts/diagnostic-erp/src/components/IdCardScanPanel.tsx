/**
 * IdCardScanPanel — Enhanced ID Card Crop & Enhancement Editor
 *
 * Enhances the existing Form F ID card capture workflow with:
 *   1. Auto-crop  — edge detection bounding-box (existing, improved)
 *   2. Deskew     — canvas-based skew detection and correction
 *   3. Enhancement pipeline — contrast stretch, sharpening, text darkening
 *   4. Enhancement mode selector — 7 modes
 *   5. Dual before/after preview — side-by-side original vs enhanced
 *   6. Status messages — "Auto crop successful", "Low confidence", etc.
 *   7. Webcam → scan panel routing (captureFromCamera wires here via processIdImage)
 *   8. Mobile-friendly controls
 *
 * PRESERVED (unchanged):
 *   - onSave({ originalBase64, croppedBase64, mimeType }) callback interface
 *   - autoCropEnabled, cropPadding, jpegQuality, maxWidth props
 *   - Manual drag-crop (move + resize from all 4 corners and 4 edges)
 *   - Rotate left/right
 *   - Restore original
 *   - All existing FormF.tsx scan panel open/close logic
 *
 * EXTENDED (backward-compatible additions to onSave result):
 *   - enhancedBase64    — enhanced/processed image (may === croppedBase64)
 *   - enhancementMode   — which mode was applied
 *
 * No external libraries added. Pure canvas-based processing.
 * Works offline, no network call required for enhancement.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Crop, RotateCcw, RotateCw, Undo2, Check, AlertTriangle,
  Maximize2, ScanLine, X, Sparkles, Eye, EyeOff, ZoomIn,
  CheckCircle2, Info,
} from "lucide-react";
import {
  lumaHistogram, percentileFromHistogram, otsuThreshold,
  grayWorldGains, applyChannelGains, flattenIllumination, suppressGlare,
} from "@/lib/scannerImaging";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EnhancementMode =
  | "original"
  | "auto"
  | "laminated"
  | "document"
  | "receipt"
  | "darkText"
  | "highContrast"
  | "grayscale"
  | "bw";

/** The kind of document being scanned — drives the default enhancement mode
 *  and crop aspect expectations so Form F (ID card), Expenses (receipt/bill)
 *  and Bank (cheque/passbook) each start on the right preset. */
export type ScanDocType = "id-card" | "receipt" | "document";

/** Manual-crop drag handle: whole-box move, a corner, or an edge. The corner /
 *  edge codes contain the sides they move ("tl" moves top+left), so the resize
 *  math can test them with `.includes`. */
type DragMode = "move" | "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r" | null;

/** CSS cursor matching the active (or idle) crop drag handle. */
function cursorForDrag(mode: DragMode): string {
  switch (mode) {
    case "tl": case "br": return "nwse-resize";
    case "tr": case "bl": return "nesw-resize";
    case "t":  case "b":  return "ns-resize";
    case "l":  case "r":  return "ew-resize";
    case "move": return "move";
    default: return "crosshair";
  }
}

export interface IdCardScanPanelProps {
  imageBase64: string;
  mimeType: string;
  onSave: (result: {
    originalBase64: string;
    croppedBase64: string;
    enhancedBase64?: string;
    enhancementMode?: EnhancementMode;
    mimeType: string;
  }) => void;
  onCancel: () => void;
  autoCropEnabled?: boolean;
  cropPadding?: number;
  jpegQuality?: number;
  maxWidth?: number;
  /** Auto-deskew on load. Default **false** — a phone photo is often stored
   *  sideways, and rotating it (then cropping the rotated, white-padded frame)
   *  both mis-orients and clips the card. Staff use Rotate Left/Right instead. */
  autoRotate?: boolean;
  /** Document type — selects the initial enhancement preset. Default "id-card". */
  docType?: ScanDocType;
  /** Title shown in the editor header / save button. Default "ID Card". */
  title?: string;
}

const MODE_LABELS: Record<EnhancementMode, string> = {
  original:     "Original",
  auto:         "Auto Enhance",
  laminated:    "Anti-Glare (Laminated)",
  document:     "Document / Text",
  receipt:      "Receipt / Bill",
  darkText:     "Dark Text",
  highContrast: "High Contrast",
  grayscale:    "Grayscale",
  bw:           "B&W Scan",
};

/** Default enhancement mode per document type. ID cards open on **Original**
 *  (no processing) — the enhancement presets are opt-in from the mode row, so a
 *  clean scan is never altered unless staff choose to. */
const DEFAULT_MODE_FOR_DOC: Record<ScanDocType, EnhancementMode> = {
  "id-card": "original",
  receipt: "receipt",
  document: "document",
};

// ── Image Processing Pipeline ──────────────────────────────────────────────────

/**
 * Apply enhancement to an ImageData using pixel-level operations.
 * All processing is pure canvas — no external dependencies.
 */
function applyEnhancement(
  src: ImageData,
  mode: EnhancementMode,
): ImageData {
  if (mode === "original") return src;

  const data = new Uint8ClampedArray(src.data);
  const len = data.length;
  const pixels = len / 4;

  // --- "receipt" mode: white-balance + illumination flatten, THEN document
  // pipeline. This runs before luma/percentile so the stretch works on the
  // shadow-corrected image — the big quality win for phone photos of receipts,
  // bills and cheques (uneven lighting, colour cast). New mode; leaves the
  // existing ID-card modes untouched.
  if (mode === "receipt") {
    applyChannelGains(data, grayWorldGains(data)); // gray-world white balance
    flattenIllumination(data, src.width, src.height, 10, 0.9); // shadow removal
  }

  // --- "laminated" mode: glossy ID-card glare removal. White-balance, knock
  // down the specular highlights the plastic throws back at the lamp, then a
  // gentle illumination flatten so the card tone reads evenly. Runs before the
  // luma/percentile stretch (below) so contrast is measured on the de-glared
  // image. Falls through to the document-strength sharpen + dark-text pass.
  if (mode === "laminated") {
    applyChannelGains(data, grayWorldGains(data));
    suppressGlare(data, 200, 32, 0.85);
    flattenIllumination(data, src.width, src.height, 12, 0.45);
  }

  // --- "auto" mode: a light glare pass by default. Most Indian ID cards
  // (Aadhaar / PAN) are laminated, so a gentle specular knock-down helps the
  // common case; it only touches near-white desaturated pixels, leaving a
  // plain matte card essentially unchanged.
  if (mode === "auto") {
    suppressGlare(data, 214, 26, 0.4);
  }

  // --- Step 1: Grayscale luminance (used by all non-original modes)
  const luma = new Float32Array(pixels);
  for (let i = 0; i < len; i += 4) {
    luma[i >> 2] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // --- Step 2: Contrast stretch on the 2nd–98th luma percentile.
  // O(n) histogram percentile (was an O(n log n) Array.sort of every pixel —
  // slow + memory-heavy on full-resolution scans).
  const hist = lumaHistogram(data);
  const lo = percentileFromHistogram(hist, pixels, 0.02);
  const hi = percentileFromHistogram(hist, pixels, 0.98);
  const range = hi - lo || 1;

  function stretch(v: number): number {
    return Math.max(0, Math.min(255, ((v - lo) / range) * 255));
  }

  if (mode === "grayscale") {
    for (let i = 0; i < len; i += 4) {
      const g = Math.round(stretch(luma[i >> 2]));
      data[i] = data[i + 1] = data[i + 2] = g;
    }
    return new ImageData(data, src.width, src.height);
  }

  if (mode === "bw") {
    // Otsu adaptive threshold (was a fixed cutoff of 140 that blotched over/
    // under-exposed scans). stretch() is monotonic, so thresholding the raw
    // luma at the Otsu value is equivalent to thresholding the stretched value.
    const bwThreshold = otsuThreshold(hist, pixels);
    for (let i = 0; i < len; i += 4) {
      // Otsu's threshold is the top of the dark (background/ink) class, so
      // pixels <= threshold are the darker class → black.
      const v = luma[i >> 2] <= bwThreshold ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    return new ImageData(data, src.width, src.height);
  }

  if (mode === "highContrast") {
    for (let i = 0; i < len; i += 4) {
      const g = Math.round(stretch(luma[i >> 2]));
      // S-curve for extra contrast
      const s = g < 128
        ? Math.round(128 * Math.pow(g / 128, 0.6))
        : Math.round(255 - 128 * Math.pow((255 - g) / 128, 0.6));
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, s));
    }
    return new ImageData(data, src.width, src.height);
  }

  if (mode === "darkText") {
    // Darken text (pixels below median) while brightening background
    const med = percentileFromHistogram(hist, pixels, 0.5);
    for (let i = 0; i < len; i += 4) {
      const g = stretch(luma[i >> 2]);
      let out: number;
      if (g < med) {
        // Dark pixels (text) → push darker
        out = Math.round(g * 0.65);
      } else {
        // Light pixels (background) → push brighter
        out = Math.round(255 - (255 - g) * 0.5);
      }
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, out));
    }
    return new ImageData(data, src.width, src.height);
  }

  // "auto", "document", "receipt" and "laminated" modes — colour-preserving
  // contrast + sharpening. ("receipt"/"laminated" have already had their
  // white-balance / glare / illumination pre-passes applied above; here they
  // get the document-strength sharpen.)
  // Step A: per-channel contrast stretch
  if (mode === "document" || mode === "auto" || mode === "receipt" || mode === "laminated") {
    for (let i = 0; i < len; i += 4) {
      data[i]     = Math.round(stretch(data[i]));
      data[i + 1] = Math.round(stretch(data[i + 1]));
      data[i + 2] = Math.round(stretch(data[i + 2]));
    }

    // Step B: Unsharp mask — 3×3 Laplacian sharpening
    const w = src.width;
    const h = src.height;
    const sharpened = new Uint8ClampedArray(data);
    const strength = mode === "auto" ? 0.4 : 0.6;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          const ci = (y * w + x) * 4 + c;
          const center = data[ci] * 9;
          const neighbors =
            data[((y - 1) * w + x - 1) * 4 + c] +
            data[((y - 1) * w + x)     * 4 + c] +
            data[((y - 1) * w + x + 1) * 4 + c] +
            data[(y * w + x - 1)       * 4 + c] +
            data[(y * w + x + 1)       * 4 + c] +
            data[((y + 1) * w + x - 1) * 4 + c] +
            data[((y + 1) * w + x)     * 4 + c] +
            data[((y + 1) * w + x + 1) * 4 + c];
          const laplacian = center - neighbors;
          sharpened[ci] = Math.max(0, Math.min(255,
            Math.round(data[ci] + strength * laplacian)
          ));
        }
      }
    }

    // Step C: document/receipt/laminated mode — also bring dark text darker
    if (mode === "document" || mode === "receipt" || mode === "laminated") {
      for (let i = 0; i < len; i += 4) {
        const g = 0.299 * sharpened[i] + 0.587 * sharpened[i + 1] + 0.114 * sharpened[i + 2];
        if (g < 100) {
          sharpened[i]     = Math.round(sharpened[i] * 0.75);
          sharpened[i + 1] = Math.round(sharpened[i + 1] * 0.75);
          sharpened[i + 2] = Math.round(sharpened[i + 2] * 0.75);
        }
      }
    }

    return new ImageData(sharpened, w, h);
  }

  return new ImageData(data, src.width, src.height);
}

/**
 * Detect skew angle by scanning horizontal luminance variance.
 * Returns estimated rotation in degrees. Range: -15 to +15.
 */
function detectSkewAngle(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const w = canvas.width;
  const h = canvas.height;
  // Sample a strip in the middle third
  const y0 = Math.floor(h * 0.35);
  const y1 = Math.floor(h * 0.65);
  const imageData = ctx.getImageData(0, y0, w, y1 - y0);
  const d = imageData.data;
  const rows = y1 - y0;

  // For each row, find the first dark pixel from left and right
  const leftEdge: number[] = [];
  const rightEdge: number[] = [];
  for (let row = 0; row < rows; row++) {
    let lx = -1; let rx = -1;
    for (let x = 0; x < w; x++) {
      const i = (row * w + x) * 4;
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (g < 180 && lx === -1) lx = x;
    }
    for (let x = w - 1; x >= 0; x--) {
      const i = (row * w + x) * 4;
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (g < 180 && rx === -1) rx = x;
    }
    if (lx >= 0) leftEdge.push(lx);
    if (rx >= 0) rightEdge.push(rx);
  }

  if (leftEdge.length < 10) return 0;

  // Linear regression on left edge X positions vs row index
  const n = leftEdge.length;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += leftEdge[i];
    sumXY += i * leftEdge[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);

  // slope in px/row → angle in degrees
  const angle = Math.atan(slope) * (180 / Math.PI);
  // Clamp to ±15 degrees; beyond that it's ambiguous
  return Math.max(-15, Math.min(15, angle));
}

/**
 * Rotate the source canvas by angleDeg and return a new canvas.
 */
function rotateCanvasByAngle(src: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.round(src.width * cos + src.height * sin);
  const newH = Math.round(src.width * sin + src.height * cos);

  const out = document.createElement("canvas");
  out.width = newW;
  out.height = newH;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, newW, newH);
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function IdCardScanPanel({
  imageBase64,
  mimeType,
  onSave,
  onCancel,
  autoCropEnabled = true,
  cropPadding = 12,
  jpegQuality = 92,
  maxWidth = 1600,
  autoRotate = false,
  docType = "id-card",
  title = "ID Card",
}: IdCardScanPanelProps) {
  const { toast } = useToast();

  // Canvas refs — hidden source, overlay for manual crop, enhanced preview
  const sourceCanvasRef  = useRef<HTMLCanvasElement>(null); // always holds current rotated/deskewed image
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null); // shows crop overlay for manual adjustment
  const enhancedCanvasRef = useRef<HTMLCanvasElement>(null); // shows enhanced result

  // Core state
  const [originalBase64, setOriginalBase64] = useState(imageBase64);
  const [croppedBase64, setCroppedBase64]   = useState("");
  const [enhancedBase64, setEnhancedBase64] = useState("");
  const [cropRect, setCropRect]             = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [imgSize, setImgSize]               = useState({ w: 0, h: 0 });
  const [cropConfidence, setCropConfidence] = useState<"high" | "medium" | "low">("high");
  const [enhancementMode, setEnhancementMode] = useState<EnhancementMode>(DEFAULT_MODE_FOR_DOC[docType]);
  const [processing, setProcessing]         = useState(false);
  const [deskewAngle, setDeskewAngle]       = useState(0);
  const [deskewApplied, setDeskewApplied]   = useState(false);

  // UI state
  const [showEnhanced, setShowEnhanced]     = useState(true); // dual preview: which side is "right"
  const [statusMsg, setStatusMsg]           = useState("");
  const [statusType, setStatusType]         = useState<"ok" | "warn" | "info">("info");

  // Manual crop drag state. Handles: 4 corners (tl/tr/bl/br), 4 edges
  // (t/b/l/r) and whole-box move.
  const containerRef   = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragMode, setDragMode]       = useState<DragMode>(null);
  const [dragStart, setDragStart]     = useState({ x: 0, y: 0 });

  // ── Status helper ──────────────────────────────────────────────────────────

  function setStatus(msg: string, type: "ok" | "warn" | "info" = "info") {
    setStatusMsg(msg);
    setStatusType(type);
  }

  // ── Edge detection crop ────────────────────────────────────────────────────
  //
  // Strategy: row & column projection histogram.
  //   1. Convert each pixel to grayscale.
  //   2. Mark pixel as "content" if it differs from the image's dominant corner
  //      colour (background estimation) by more than a threshold.
  //   3. Count content pixels per row and per column.
  //   4. Find first/last row and column where content density exceeds 5%.
  //   5. This always produces a crop — no bail-out for high coverage.
  //
  // Why this works for all input types:
  //   - Scanner (card on white): background = white, card content found easily
  //   - Phone photo (card fills frame): background = corners, card fills rest
  //   - Tilted/coloured card on table: background estimated from corners
  //   - High coverage (card IS the image): corners = card edge, crop ≈ full image
  //     which is correct — no background to remove.

  function detectCardCrop(canvas: HTMLCanvasElement, padding: number): {
    x: number; y: number; w: number; h: number; confidence: "high" | "medium" | "low";
  } {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    if (!ctx || w < 10 || h < 10) {
      return { x: 0, y: 0, w, h, confidence: "low" };
    }

    // Work on a downscaled copy (≤ 480 px long edge). Faster, and the blur of
    // downscaling suppresses per-pixel noise so the card edge dominates.
    const scale = Math.min(1, 480 / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    const small = document.createElement("canvas");
    small.width = sw; small.height = sh;
    const sctx = small.getContext("2d");
    if (!sctx) return { x: 0, y: 0, w, h, confidence: "low" };
    sctx.drawImage(canvas, 0, 0, sw, sh);
    const data = sctx.getImageData(0, 0, sw, sh).data;

    // Per-pixel luma (reused by the gradient test).
    const lum = new Float32Array(sw * sh);
    for (let p = 0; p < sw * sh; p++) {
      const i = p * 4;
      lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // ── Step 1: Background = MEDIAN colour of the outer border frame ──
    // A thin outermost ring (≈3%) is the most likely to be true background; a
    // wider band gets contaminated when the card nearly fills the frame, which
    // then makes the card's own edge read as "background" and the crop bites
    // into it. The median resists a glare patch or a finger in the border.
    const band = Math.max(2, Math.round(Math.min(sw, sh) * 0.03));
    const bR: number[] = [], bG: number[] = [], bB: number[] = [];
    for (let y = 0; y < sh; y++) {
      const edgeRow = y < band || y >= sh - band;
      for (let x = 0; x < sw; x++) {
        if (edgeRow || x < band || x >= sw - band) {
          const i = (y * sw + x) * 4;
          bR.push(data[i]); bG.push(data[i + 1]); bB.push(data[i + 2]);
        }
      }
    }
    const medianOf = (vals: number[]): number => {
      if (vals.length === 0) return 255;
      const s = vals.slice().sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const bgR = medianOf(bR), bgG = medianOf(bG), bgB = medianOf(bB);

    // ── Step 2: Content mask = differs from background OR sits on a strong edge ──
    // The colour test finds the card body; the gradient (edge/text) test finds
    // the card even when its interior tone is close to the background, and locks
    // onto the card border and printed text — the single biggest robustness win
    // over the old colour-only detector.
    // Sensitive thresholds: better to include a sliver of background (staff can
    // trim it with the now-full manual crop) than to shave off card content.
    const COLOR_THRESH = 42;   // summed |Δ| across R,G,B
    const GRAD_THRESH  = 14;   // |dx|+|dy| on luma
    const content = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const p = y * sw + x;
        const i = p * 4;
        const cd = Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB);
        let isC = cd > COLOR_THRESH;
        if (!isC && x > 0 && x < sw - 1 && y > 0 && y < sh - 1) {
          const gx = Math.abs(lum[p + 1] - lum[p - 1]);
          const gy = Math.abs(lum[p + sw] - lum[p - sw]);
          if (gx + gy > GRAD_THRESH) isC = true;
        }
        content[p] = isC ? 1 : 0;
      }
    }

    // ── Step 3: Row / column content projections (fraction per line) ──
    const rowP = new Float32Array(sh);
    const colP = new Float32Array(sw);
    for (let y = 0; y < sh; y++) {
      let c = 0;
      for (let x = 0; x < sw; x++) c += content[y * sw + x];
      rowP[y] = c / sw;
    }
    for (let x = 0; x < sw; x++) {
      let c = 0;
      for (let y = 0; y < sh; y++) c += content[y * sw + x];
      colP[x] = c / sh;
    }

    const smoothHalf = Math.max(1, Math.round(Math.min(sw, sh) * 0.012));
    function smoothed(hist: Float32Array, i: number, half = smoothHalf): number {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - half); k <= Math.min(hist.length - 1, i + half); k++) {
        s += hist[k]; n++;
      }
      return s / (n || 1);
    }

    // ── Step 4: Adaptive threshold — a fraction of each projection's own peak ──
    // so the boundary tracks the card whether it's dense with print or sparse,
    // rather than a fixed 5% that mis-fires on both.
    let rowPeak = 0, colPeak = 0;
    for (let y = 0; y < sh; y++) rowPeak = Math.max(rowPeak, smoothed(rowP, y));
    for (let x = 0; x < sw; x++) colPeak = Math.max(colPeak, smoothed(colP, x));
    // A low fraction (9%) keeps the boundary out near the card edge instead of
    // biting inward on a lower-density strip (e.g. a logo panel with little
    // print).
    const rowT = Math.max(0.04, rowPeak * 0.09);
    const colT = Math.max(0.04, colPeak * 0.09);

    let top = 0, bottom = sh - 1, left = 0, right = sw - 1;
    for (let y = 0; y < sh; y++)      { if (smoothed(rowP, y) > rowT) { top = y; break; } }
    for (let y = sh - 1; y >= 0; y--) { if (smoothed(rowP, y) > rowT) { bottom = y; break; } }
    for (let x = 0; x < sw; x++)      { if (smoothed(colP, x) > colT) { left = x; break; } }
    for (let x = sw - 1; x >= 0; x--) { if (smoothed(colP, x) > colT) { right = x; break; } }

    // Nothing found (blank / uniform frame) → keep the whole image.
    if (right <= left || bottom <= top) { left = 0; top = 0; right = sw - 1; bottom = sh - 1; }

    // ── Step 5: Safety margin + snap-to-edge, then pad and map back up ──
    // A generous margin (≈2.5%) means we never crop flush to detected content —
    // a hair of background is fine, a shaved-off letter is not. And if a
    // boundary sits within ≈4% of the frame, snap it to the frame: the card
    // reaches the edge there, so any remaining gap is spurious.
    const margin = Math.round(Math.min(sw, sh) * 0.025);
    const snap = Math.round(Math.min(sw, sh) * 0.04);
    left   = left   < snap          ? 0      : left - margin;
    top    = top    < snap          ? 0      : top - margin;
    right  = right  > sw - 1 - snap ? sw - 1 : right + margin;
    bottom = bottom > sh - 1 - snap ? sh - 1 : bottom + margin;

    const padS = Math.max(padding, 4) * scale;
    left   = Math.max(0, left - padS);
    top    = Math.max(0, top - padS);
    right  = Math.min(sw - 1, right + padS);
    bottom = Math.min(sh - 1, bottom + padS);

    const inv = 1 / scale;
    let X = Math.round(left * inv);
    let Y = Math.round(top * inv);
    let cropW = Math.round((right - left) * inv);
    let cropH = Math.round((bottom - top) * inv);
    X = Math.max(0, Math.min(X, w - 1));
    Y = Math.max(0, Math.min(Y, h - 1));
    cropW = Math.max(10, Math.min(cropW, w - X));
    cropH = Math.max(10, Math.min(cropH, h - Y));

    // Minimum crop size sanity check
    if (cropW < 40 || cropH < 20) {
      return { x: 0, y: 0, w, h, confidence: "medium" };
    }

    // ── Step 6: Confidence based on how much we cropped ──
    const wRatio = cropW / w;
    const hRatio = cropH / h;
    const aspect = cropW / (cropH || 1);
    const goodAspect = aspect >= 1.0 && aspect <= 2.5; // ID cards are landscape usually
    const confidence: "high" | "medium" | "low" =
      wRatio < 0.94 && hRatio < 0.94 && goodAspect ? "high" : "medium";

    return { x: X, y: Y, w: cropW, h: cropH, confidence };
  }

  // ── Apply crop to produce a cropped canvas ─────────────────────────────────

  function cropToCanvas(
    src: HTMLCanvasElement,
    rect: { x: number; y: number; w: number; h: number },
  ): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = rect.w;
    out.height = rect.h;
    const ctx = out.getContext("2d");
    if (ctx) ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return out;
  }

  // ── Apply enhancement mode to a canvas, return base64 ─────────────────────

  function applyEnhancementToCanvas(
    src: HTMLCanvasElement,
    mode: EnhancementMode,
    targetCanvas: HTMLCanvasElement,
  ): string {
    const ctx = src.getContext("2d");
    if (!ctx) return "";
    const imageData = ctx.getImageData(0, 0, src.width, src.height);
    const enhanced = applyEnhancement(imageData, mode);

    targetCanvas.width = src.width;
    targetCanvas.height = src.height;
    const tCtx = targetCanvas.getContext("2d");
    if (!tCtx) return "";
    tCtx.putImageData(enhanced, 0, 0);
    return targetCanvas.toDataURL("image/jpeg", jpegQuality / 100).split(",")[1];
  }

  // ── Draw overlay for manual crop ───────────────────────────────────────────

  function drawCropOverlay(rect: { x: number; y: number; w: number; h: number }) {
    const source = sourceCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!source || !overlay) return;
    overlay.width = source.width;
    overlay.height = source.height;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(source, 0, 0);

    // Darken outside crop
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, rect.x, source.height);
    ctx.fillRect(rect.x + rect.w, 0, source.width - rect.x - rect.w, source.height);
    ctx.fillRect(rect.x, 0, rect.w, rect.y);
    ctx.fillRect(rect.x, rect.y + rect.h, rect.w, source.height - rect.y - rect.h);

    // Border
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

    // Thirds guides (rule-of-thirds) — faint, help line the card up
    ctx.strokeStyle = "rgba(59,130,246,0.35)";
    ctx.lineWidth = 1;
    for (let k = 1; k <= 2; k++) {
      const gx = rect.x + (rect.w * k) / 3;
      const gy = rect.y + (rect.h * k) / 3;
      ctx.beginPath(); ctx.moveTo(gx, rect.y); ctx.lineTo(gx, rect.y + rect.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rect.x, gy); ctx.lineTo(rect.x + rect.w, gy); ctx.stroke();
    }

    // Handles — 4 corners + 4 edge midpoints. Scale the handle to the image so
    // it stays grabbable on a downscaled preview.
    const hs = Math.max(10, Math.round(Math.min(overlay.width, overlay.height) * 0.028));
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const handles: [number, number][] = [
      [rect.x, rect.y], [rect.x + rect.w, rect.y],           // tl, tr
      [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h], // bl, br
      [cx, rect.y], [cx, rect.y + rect.h],                   // t, b
      [rect.x, cy], [rect.x + rect.w, cy],                   // l, r
    ];
    for (const [hx, hy] of handles) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(hx - hs / 2 + 2, hy - hs / 2 + 2, hs - 4, hs - 4);
    }
  }

  // ── Full pipeline: detect → deskew → crop → enhance ───────────────────────

  const runFullPipeline = useCallback(async (
    base64: string,
    mime: string,
    mode: EnhancementMode,
    doDeskew: boolean,
  ) => {
    setProcessing(true);
    setStatus("Processing…", "info");

    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        const scaleFactor = maxWidth > 0 && naturalW > maxWidth ? maxWidth / naturalW : 1;
        const displayW = Math.round(naturalW * scaleFactor);
        const displayH = Math.round(naturalH * scaleFactor);

        // Draw to source canvas
        const source = sourceCanvasRef.current;
        if (!source) { resolve(); return; }
        source.width = displayW;
        source.height = displayH;
        const sCtx = source.getContext("2d");
        if (!sCtx) { resolve(); return; }
        sCtx.drawImage(img, 0, 0, displayW, displayH);

        // Update original base64 with possibly-rescaled version
        const resizedDataUrl = source.toDataURL("image/jpeg", jpegQuality / 100);
        const resizedB64 = resizedDataUrl.split(",")[1];
        setOriginalBase64(resizedB64);
        setImgSize({ w: displayW, h: displayH });

        // Step 1: Deskew if requested
        let workingCanvas: HTMLCanvasElement = source;
        if (doDeskew) {
          const angle = detectSkewAngle(source);
          setDeskewAngle(angle);
          if (Math.abs(angle) > 0.5) {
            const deskewed = rotateCanvasByAngle(source, -angle);
            // Replace source canvas with deskewed version
            source.width = deskewed.width;
            source.height = deskewed.height;
            const sCtx2 = source.getContext("2d");
            if (sCtx2) sCtx2.drawImage(deskewed, 0, 0);
            workingCanvas = source;
            setImgSize({ w: source.width, h: source.height });
            setDeskewApplied(true);
          } else {
            setDeskewApplied(false);
          }
        }

        // Step 2: Auto-crop. Only auto-APPLY a modest trim (≥60% of the frame
        // kept). A crop that wants to throw away more than that is exactly what
        // clips a dark or low-contrast card — the detector locks onto the one
        // high-contrast patch (a logo) and shaves the rest. In that case we keep
        // the full frame and ask the user to crop manually; the "Auto Crop"
        // button still forces the detected box when they want it.
        const fullRect = { x: 0, y: 0, w: workingCanvas.width, h: workingCanvas.height };
        let rect: typeof cropRect;
        let confidence: "high" | "medium" | "low" = "high";

        if (autoCropEnabled) {
          const detected = detectCardCrop(workingCanvas, cropPadding);
          const areaRatio = (detected.w * detected.h) / (workingCanvas.width * workingCanvas.height || 1);
          if (areaRatio >= 0.6) {
            rect = { x: detected.x, y: detected.y, w: detected.w, h: detected.h };
            confidence = detected.confidence;
            setStatus(confidence === "high" ? "Auto crop successful" : "Auto crop applied — adjust manually if needed", confidence === "high" ? "ok" : "warn");
          } else {
            // Aggressive/untrusted crop — don't clip. Show the whole card.
            rect = fullRect;
            confidence = "medium";
            setStatus("Auto crop skipped to avoid clipping — drag the box or tap Auto Crop", "warn");
          }
          setCropConfidence(confidence);
          setCropRect(rect);
        } else {
          rect = fullRect;
          setCropRect(rect);
          setCropConfidence("high");
          setStatus("Ready — auto crop disabled", "info");
        }

        // Draw crop overlay (manual adjustment view)
        drawCropOverlay(rect);

        // Step 3: Crop
        const cropped = cropToCanvas(workingCanvas, rect);
        const croppedB64 = cropped.toDataURL("image/jpeg", jpegQuality / 100).split(",")[1];
        setCroppedBase64(croppedB64);

        // Step 4: Enhance
        const enhCanvas = enhancedCanvasRef.current;
        if (enhCanvas && mode !== "original") {
          const enhB64 = applyEnhancementToCanvas(cropped, mode, enhCanvas);
          setEnhancedBase64(enhB64);
          setStatus(`${MODE_LABELS[mode]} applied`, "ok");
        } else if (enhCanvas) {
          // Original mode — just show cropped
          enhCanvas.width = cropped.width;
          enhCanvas.height = cropped.height;
          const eCtx = enhCanvas.getContext("2d");
          if (eCtx) eCtx.drawImage(cropped, 0, 0);
          setEnhancedBase64(croppedB64);
        }

        resolve();
      };
      // The editor is canvas-based, so it can only open images the browser can
      // decode. Without this handler a format it can't decode (a PDF, or HEIC on
      // a non-Safari browser) would fire neither onload nor a rejection, leaving
      // the Promise unresolved and the modal stuck on "Processing…" forever with
      // Save disabled. Resolving here reaches setProcessing(false) below so the
      // dialog recovers and the user can Cancel (callers pre-screen undecodable
      // files, but this keeps the editor safe against any input).
      img.onerror = () => {
        setStatus("Couldn't open this file for editing — the image format may be unsupported. Please use a JPG or PNG.", "warn");
        resolve();
      };
      img.src = `data:${mime};base64,${base64}`;
    });

    setProcessing(false);
  }, [autoCropEnabled, cropPadding, jpegQuality, maxWidth]);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    runFullPipeline(imageBase64, mimeType, enhancementMode, autoRotate);
  }, [imageBase64, mimeType]); // only on mount

  // ── Re-enhance when mode changes (reuses already-cropped image) ───────────

  function reEnhance(mode: EnhancementMode) {
    setEnhancementMode(mode);
    const source = sourceCanvasRef.current;
    const enhCanvas = enhancedCanvasRef.current;
    if (!source || !enhCanvas) return;

    // Re-crop from current cropRect first
    const cropped = cropToCanvas(source, cropRect);
    const croppedB64 = cropped.toDataURL("image/jpeg", jpegQuality / 100).split(",")[1];
    setCroppedBase64(croppedB64);

    if (mode === "original") {
      enhCanvas.width = cropped.width;
      enhCanvas.height = cropped.height;
      const eCtx = enhCanvas.getContext("2d");
      if (eCtx) eCtx.drawImage(cropped, 0, 0);
      setEnhancedBase64(croppedB64);
      setStatus("Original preserved", "info");
    } else {
      const enhB64 = applyEnhancementToCanvas(cropped, mode, enhCanvas);
      setEnhancedBase64(enhB64);
      setStatus(`${MODE_LABELS[mode]} applied`, "ok");
    }
  }

  // ── Re-crop manually when cropRect changes (from drag) ───────────────────

  useEffect(() => {
    if (imgSize.w === 0) return;
    const source = sourceCanvasRef.current;
    if (!source) return;
    // Redraw overlay
    drawCropOverlay(cropRect);
    // Re-crop + re-enhance silently
    const cropped = cropToCanvas(source, cropRect);
    const croppedB64 = cropped.toDataURL("image/jpeg", jpegQuality / 100).split(",")[1];
    setCroppedBase64(croppedB64);
    const enhCanvas = enhancedCanvasRef.current;
    if (enhCanvas) {
      if (enhancementMode === "original") {
        enhCanvas.width = cropped.width;
        enhCanvas.height = cropped.height;
        const eCtx = enhCanvas.getContext("2d");
        if (eCtx) eCtx.drawImage(cropped, 0, 0);
        setEnhancedBase64(croppedB64);
      } else {
        const enhB64 = applyEnhancementToCanvas(cropped, enhancementMode, enhCanvas);
        setEnhancedBase64(enhB64);
      }
    }
  }, [cropRect, imgSize]);

  // ── Rotate ────────────────────────────────────────────────────────────────

  function rotateImage(direction: "left" | "right") {
    const source = sourceCanvasRef.current;
    if (!source) return;
    const temp = document.createElement("canvas");
    temp.width = source.height;
    temp.height = source.width;
    const ctx = temp.getContext("2d");
    if (!ctx) return;
    if (direction === "left") {
      ctx.translate(0, temp.height); ctx.rotate(-Math.PI / 2);
    } else {
      ctx.translate(temp.width, 0); ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(source, 0, 0);
    source.width = temp.width;
    source.height = temp.height;
    const c2 = source.getContext("2d");
    if (c2) c2.drawImage(temp, 0, 0);

    const dataUrl = source.toDataURL("image/jpeg", jpegQuality / 100);
    setOriginalBase64(dataUrl.split(",")[1]);
    setImgSize({ w: source.width, h: source.height });

    // Re-run auto-crop on rotated image
    if (autoCropEnabled) {
      const rect = detectCardCrop(source, cropPadding);
      setCropRect({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      setCropConfidence(rect.confidence);
      setStatus(rect.confidence === "high" ? "Auto crop successful" : "Adjust crop manually", rect.confidence === "high" ? "ok" : "warn");
    } else {
      setCropRect({ x: 0, y: 0, w: source.width, h: source.height });
    }
    toast({ title: `Rotated ${direction}` });
  }

  // ── Restore original ──────────────────────────────────────────────────────

  function restoreOriginal() {
    runFullPipeline(imageBase64, mimeType, "original", false);
    setEnhancementMode("original");
    setStatus("Original preserved", "info");
    toast({ title: "Original restored" });
  }

  // ── Re-run auto crop ──────────────────────────────────────────────────────

  function runAutoCrop() {
    const source = sourceCanvasRef.current;
    if (!source) return;
    const rect = detectCardCrop(source, cropPadding);
    setCropRect({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    setCropConfidence(rect.confidence);
    if (rect.confidence === "high") {
      setStatus("Auto crop successful", "ok");
    } else {
      setStatus("Auto crop applied — adjust manually if needed", "warn");
    }
  }

  // ── Manual crop drag ──────────────────────────────────────────────────────

  function getPointerPos(e: React.MouseEvent | React.TouchEvent) {
    // Measure against the CANVAS, not its container. The canvas is centered in
    // the container (flex, justify-center), so a portrait image (e.g. a mobile
    // phone photo) is letterboxed — narrower than the container — and using the
    // container's rect would give both a wrong offset and a wrong scale, so the
    // crop handles never line up under the pointer. A landscape image fills the
    // container width, which is why it happened to work there.
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    const pt = "touches" in e ? (e.touches[0] ?? e.changedTouches[0]) : e;
    if (!pt) return { x: 0, y: 0 };
    return { x: (pt.clientX - rect.left) * scaleX, y: (pt.clientY - rect.top) * scaleY };
  }

  // Pick which handle (if any) the pointer grabbed. Corners win over edges,
  // edges over move. Hit area scales with the image so it's grabbable on the
  // downscaled preview and on touch.
  function hitTestHandle(px: number, py: number): DragMode {
    const L = cropRect.x, T = cropRect.y, R = cropRect.x + cropRect.w, B = cropRect.y + cropRect.h;
    const hit = Math.max(16, Math.round(Math.min(imgSize.w, imgSize.h) * 0.04));
    const near = (a: number, b: number) => Math.abs(a - b) <= hit;
    const onXband = px >= L - hit && px <= R + hit;
    const onYband = py >= T - hit && py <= B + hit;
    // Corners
    if (near(px, L) && near(py, T)) return "tl";
    if (near(px, R) && near(py, T)) return "tr";
    if (near(px, L) && near(py, B)) return "bl";
    if (near(px, R) && near(py, B)) return "br";
    // Edges
    if (near(py, T) && onXband) return "t";
    if (near(py, B) && onXband) return "b";
    if (near(px, L) && onYband) return "l";
    if (near(px, R) && onYband) return "r";
    // Inside → move
    if (px >= L && px <= R && py >= T && py <= B) return "move";
    return null;
  }

  function handlePointerDown(e: React.MouseEvent | React.TouchEvent) {
    const pos = getPointerPos(e);
    const mode = hitTestHandle(pos.x, pos.y);
    if (!mode) return;
    setDragMode(mode);
    setIsDragging(true);
    setDragStart({ x: pos.x, y: pos.y });
  }

  function handlePointerMove(e: React.MouseEvent | React.TouchEvent) {
    if (!isDragging || !dragMode) return;
    const pos = getPointerPos(e);
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;
    const MIN = 40;

    setCropRect((prev) => {
      if (dragMode === "move") {
        return {
          ...prev,
          x: Math.max(0, Math.min(prev.x + dx, imgSize.w - prev.w)),
          y: Math.max(0, Math.min(prev.y + dy, imgSize.h - prev.h)),
        };
      }
      // Resize: work in edge coordinates, move only the edges named by dragMode.
      let left = prev.x, top = prev.y, right = prev.x + prev.w, bottom = prev.y + prev.h;
      if (dragMode.includes("l")) left = Math.max(0, Math.min(left + dx, right - MIN));
      if (dragMode.includes("r")) right = Math.min(imgSize.w, Math.max(right + dx, left + MIN));
      if (dragMode.includes("t")) top = Math.max(0, Math.min(top + dy, bottom - MIN));
      if (dragMode.includes("b")) bottom = Math.min(imgSize.h, Math.max(bottom + dy, top + MIN));
      return { x: left, y: top, w: right - left, h: bottom - top };
    });
    setDragStart({ x: pos.x, y: pos.y });
  }

  function handlePointerUp() {
    setIsDragging(false);
    setDragMode(null);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    const finalEnhanced = enhancedBase64 || croppedBase64 || originalBase64;
    const finalCropped  = croppedBase64 || originalBase64;
    if (!finalCropped) {
      toast({ title: "No image to save", variant: "destructive" });
      return;
    }
    onSave({
      originalBase64,
      croppedBase64: finalCropped,
      enhancedBase64: finalEnhanced !== finalCropped ? finalEnhanced : finalCropped,
      enhancementMode,
      mimeType: "image/jpeg",
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const statusIcon = statusType === "ok"
    ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
    : statusType === "warn"
    ? <AlertTriangle size={13} className="text-amber-500 shrink-0" />
    : <Info size={13} className="text-blue-400 shrink-0" />;

  const statusColour = statusType === "ok"
    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
    : statusType === "warn"
    ? "bg-amber-50 border-amber-200 text-amber-800"
    : "bg-blue-50 border-blue-200 text-blue-800";

  // Determine the "saved" image shown in Form F preview (enhanced takes priority)
  const displayB64 = showEnhanced
    ? (enhancedBase64 || croppedBase64 || originalBase64)
    : (croppedBase64 || originalBase64);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full mx-3 max-h-[95vh] overflow-y-auto"
        style={{ maxWidth: 820 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-gray-50 rounded-t-xl">
          <div className="flex items-center gap-2">
            <ScanLine size={17} className="text-blue-600" />
            <h3 className="text-sm font-bold text-gray-900">{title} Editor</h3>
            {cropConfidence === "medium" && (
              <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 text-[10px] h-5 px-1.5">
                <AlertTriangle size={9} className="mr-1" /> Adjust if needed
              </Badge>
            )}
            {cropConfidence === "high" && (
              <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 text-[10px] h-5 px-1.5">
                <CheckCircle2 size={9} className="mr-1" /> Auto crop ok
              </Badge>
            )}
            {deskewApplied && (
              <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50 text-[10px] h-5 px-1.5">
                Deskewed {deskewAngle.toFixed(1)}°
              </Badge>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 p-1">
            <X size={17} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* ── Status bar ── */}
          {statusMsg && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${statusColour}`}>
              {statusIcon}
              {statusMsg}
            </div>
          )}

          {/* ── Dual preview ── */}
          <div className="grid grid-cols-2 gap-3">
            {/* Left: Manual crop overlay */}
            <div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Original — drag to adjust crop
              </div>
              <div
                ref={containerRef}
                className="relative bg-gray-100 rounded-lg overflow-hidden border border-gray-200 select-none"
                // touchAction:none so a touch-drag on a handle resizes the crop
                // instead of scrolling/zooming the page on phones and tablets.
                style={{ cursor: cursorForDrag(dragMode), maxHeight: 340, display: "flex", justifyContent: "center", touchAction: "none" }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={(e) => handlePointerDown(e)}
                onTouchMove={(e) => handlePointerMove(e)}
                onTouchEnd={handlePointerUp}
              >
                <canvas ref={overlayCanvasRef} className="max-w-full max-h-[340px]" />
              </div>
              <div className="text-[9px] text-gray-400 mt-1">
                Drag inside to move · drag any corner or edge to resize
              </div>
            </div>

            {/* Right: Enhanced result */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {MODE_LABELS[enhancementMode]} — Preview
                </div>
                <button
                  className="text-[9px] text-blue-500 hover:underline flex items-center gap-0.5"
                  onClick={() => setShowEnhanced((s) => !s)}
                >
                  {showEnhanced ? <Eye size={9} /> : <EyeOff size={9} />}
                  {showEnhanced ? "Showing enhanced" : "Showing original"}
                </button>
              </div>
              <div
                className="bg-gray-100 rounded-lg overflow-hidden border border-blue-200"
                style={{ maxHeight: 340, display: "flex", justifyContent: "center", alignItems: "center" }}
              >
                {processing ? (
                  <div className="text-xs text-gray-400 py-10 flex items-center gap-2">
                    <Sparkles size={14} className="animate-spin text-blue-400" /> Processing…
                  </div>
                ) : displayB64 ? (
                  <img
                    src={`data:image/jpeg;base64,${displayB64}`}
                    alt="Enhanced preview"
                    className="max-w-full max-h-[340px] object-contain"
                  />
                ) : (
                  <div className="text-xs text-gray-400 py-10">Enhancing…</div>
                )}
              </div>
              <div className="text-[9px] text-gray-400 mt-1">
                This is the image that will be saved
              </div>
            </div>
          </div>

          {/* ── Enhancement mode selector ── */}
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Sparkles size={10} /> Enhancement Mode
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(MODE_LABELS) as EnhancementMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => reEnhance(mode)}
                  disabled={processing}
                  className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    enhancementMode === mode
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                  }`}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          {/* ── Action buttons ── */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={runAutoCrop} disabled={processing}
            >
              <ZoomIn size={12} className="mr-1" /> Auto Crop
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => rotateImage("left")} disabled={processing}
            >
              <RotateCcw size={12} className="mr-1" /> Rotate Left
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => rotateImage("right")} disabled={processing}
            >
              <RotateCw size={12} className="mr-1" /> Rotate Right
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => reEnhance(enhancementMode)} disabled={processing}
            >
              <Sparkles size={12} className="mr-1" /> Re-Enhance
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={restoreOriginal} disabled={processing}
            >
              <Undo2 size={12} className="mr-1" /> Use Original
            </Button>
          </div>

          {/* ── Save / Cancel ── */}
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleSave} disabled={processing}
            >
              <Check size={12} className="mr-1" /> Save
            </Button>
          </div>
        </div>

        {/* Hidden canvases */}
        <canvas ref={sourceCanvasRef}  className="hidden" />
        <canvas ref={enhancedCanvasRef} className="hidden" />
      </div>
    </div>
  );
}
