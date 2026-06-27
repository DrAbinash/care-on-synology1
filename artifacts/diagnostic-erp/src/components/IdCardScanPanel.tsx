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
 *   - Manual drag-crop (move + resize-br)
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type EnhancementMode =
  | "original"
  | "auto"
  | "document"
  | "darkText"
  | "highContrast"
  | "grayscale"
  | "bw";

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
}

const MODE_LABELS: Record<EnhancementMode, string> = {
  original:     "Original",
  auto:         "Auto Enhance",
  document:     "Document / Text",
  darkText:     "Dark Text",
  highContrast: "High Contrast",
  grayscale:    "Grayscale",
  bw:           "B&W Scan",
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

  // --- Step 1: Grayscale luminance (used by all non-original modes)
  const luma = new Float32Array(len / 4);
  for (let i = 0; i < len; i += 4) {
    luma[i >> 2] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // --- Step 2: Contrast stretch (find 2nd–98th percentile)
  const sorted = Array.from(luma).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.98)] ?? 255;
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
    // Adaptive threshold: Sauvola-style, simplified
    for (let i = 0; i < len; i += 4) {
      const g = stretch(luma[i >> 2]);
      const v = g < 140 ? 0 : 255;
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
    const med = sorted[Math.floor(sorted.length * 0.5)] ?? 128;
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

  // "auto" and "document" modes — colour-preserving contrast + sharpening
  // Step A: per-channel contrast stretch
  if (mode === "document" || mode === "auto") {
    for (let i = 0; i < len; i += 4) {
      data[i]     = Math.round(stretch(data[i]));
      data[i + 1] = Math.round(stretch(data[i + 1]));
      data[i + 2] = Math.round(stretch(data[i + 2]));
    }

    // Step B: Unsharp mask — 3×3 Laplacian sharpening
    const w = src.width;
    const h = src.height;
    const sharpened = new Uint8ClampedArray(data);
    const strength = mode === "document" ? 0.6 : 0.4;

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

    // Step C: document mode — also bring dark text darker
    if (mode === "document") {
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
  jpegQuality = 85,
  maxWidth = 1200,
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
  const [enhancementMode, setEnhancementMode] = useState<EnhancementMode>("auto");
  const [processing, setProcessing]         = useState(false);
  const [deskewAngle, setDeskewAngle]       = useState(0);
  const [deskewApplied, setDeskewApplied]   = useState(false);

  // UI state
  const [showEnhanced, setShowEnhanced]     = useState(true); // dual preview: which side is "right"
  const [statusMsg, setStatusMsg]           = useState("");
  const [statusType, setStatusType]         = useState<"ok" | "warn" | "info">("info");

  // Manual crop drag state
  const containerRef   = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragMode, setDragMode]       = useState<"move" | "resize-br" | null>(null);
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

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // ── Step 1: Estimate background colour from the four corners (5×5 px each) ──
    let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
    const cornerSize = Math.min(8, Math.floor(Math.min(w, h) * 0.05));
    const sampleCorners = [
      [0, 0], [w - cornerSize, 0],
      [0, h - cornerSize], [w - cornerSize, h - cornerSize],
    ];
    for (const [cx, cy] of sampleCorners) {
      for (let py = cy; py < cy + cornerSize && py < h; py++) {
        for (let px = cx; px < cx + cornerSize && px < w; px++) {
          const i = (py * w + px) * 4;
          bgR += data[i]; bgG += data[i + 1]; bgB += data[i + 2]; bgN++;
        }
      }
    }
    if (bgN > 0) { bgR /= bgN; bgG /= bgN; bgB /= bgN; }

    // ── Step 2: Mark each pixel as content vs background ──
    // Threshold: pixel differs from background by more than 20 in any channel
    // OR has significant colour saturation (catches coloured cards on grey tables)
    const DIFF_THRESH = 22;
    const SAT_THRESH  = 25;

    function isContent(i: number): boolean {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (
        Math.abs(r - bgR) > DIFF_THRESH ||
        Math.abs(g - bgG) > DIFF_THRESH ||
        Math.abs(b - bgB) > DIFF_THRESH
      ) return true;
      // Also catch saturated pixels (colour card on neutral background)
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      return (maxC - minC) > SAT_THRESH;
    }

    // ── Step 3: Build row and column histograms ──
    // Sample every 2nd pixel for speed (still accurate enough)
    const rowHist    = new Float32Array(h);   // fraction of row pixels that are content
    const colHist    = new Float32Array(w);   // fraction of col pixels that are content

    for (let y = 0; y < h; y += 2) {
      let cnt = 0;
      for (let x = 0; x < w; x += 2) {
        if (isContent((y * w + x) * 4)) cnt++;
      }
      rowHist[y] = cnt / (w / 2);
      if (y + 1 < h) rowHist[y + 1] = rowHist[y]; // duplicate for skipped row
    }
    for (let x = 0; x < w; x += 2) {
      let cnt = 0;
      for (let y = 0; y < h; y += 2) {
        if (isContent((y * w + x) * 4)) cnt++;
      }
      colHist[x] = cnt / (h / 2);
      if (x + 1 < w) colHist[x + 1] = colHist[x];
    }

    // ── Step 4: Find content boundary — first/last row/col above threshold ──
    // Use a low threshold (5%) so even sparse card edges are detected.
    // Smooth over a 5px window to ignore single-pixel noise.
    const ROW_THRESH = 0.05;
    const COL_THRESH = 0.05;

    function smoothed(hist: Float32Array, i: number, half = 3): number {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - half); k <= Math.min(hist.length - 1, i + half); k++) {
        s += hist[k]; n++;
      }
      return s / (n || 1);
    }

    let top = 0, bottom = h - 1, left = 0, right = w - 1;

    for (let y = 0; y < h; y++) {
      if (smoothed(rowHist, y) > ROW_THRESH) { top = y; break; }
    }
    for (let y = h - 1; y >= 0; y--) {
      if (smoothed(rowHist, y) > ROW_THRESH) { bottom = y; break; }
    }
    for (let x = 0; x < w; x++) {
      if (smoothed(colHist, x) > COL_THRESH) { left = x; break; }
    }
    for (let x = w - 1; x >= 0; x--) {
      if (smoothed(colHist, x) > COL_THRESH) { right = x; break; }
    }

    // ── Step 5: Add padding, clamp to canvas ──
    const pad = Math.max(padding, 4);
    left   = Math.max(0, left   - pad);
    top    = Math.max(0, top    - pad);
    right  = Math.min(w - 1, right  + pad);
    bottom = Math.min(h - 1, bottom + pad);

    const cropW = right - left;
    const cropH = bottom - top;

    // Minimum crop size sanity check
    if (cropW < 40 || cropH < 20) {
      return { x: 0, y: 0, w, h, confidence: "medium" };
    }

    // ── Step 6: Confidence based on how much we cropped ──
    // If crop is < 90% of original in both dimensions → we found real margins → high
    // If crop ≈ full image → card fills frame or detection uncertain → medium
    const wRatio = cropW / w;
    const hRatio = cropH / h;
    const aspect = cropW / (cropH || 1);
    const goodAspect = aspect >= 1.0 && aspect <= 2.5; // ID cards are landscape usually

    let confidence: "high" | "medium" | "low";
    if (wRatio < 0.92 && hRatio < 0.92 && goodAspect) {
      confidence = "high";   // cropped meaningful margins on all sides
    } else if (wRatio < 0.98 || hRatio < 0.98) {
      confidence = "medium"; // cropped some margins
    } else {
      confidence = "medium"; // card fills frame — crop = full image, still valid
    }

    return { x: left, y: top, w: cropW, h: cropH, confidence };
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

    // Corner handles
    const hs = 10;
    ctx.fillStyle = "#3b82f6";
    [[rect.x, rect.y], [rect.x + rect.w - hs, rect.y],
     [rect.x, rect.y + rect.h - hs], [rect.x + rect.w - hs, rect.y + rect.h - hs]
    ].forEach(([hx, hy]) => ctx.fillRect(hx, hy, hs, hs));
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

        // Step 2: Auto-crop — always apply, confidence is a UI indicator only
        let rect: typeof cropRect;
        let confidence: "high" | "medium" | "low" = "high";

        if (autoCropEnabled) {
          const detected = detectCardCrop(workingCanvas, cropPadding);
          rect = { x: detected.x, y: detected.y, w: detected.w, h: detected.h };
          confidence = detected.confidence;
          setCropConfidence(confidence);
          setCropRect(rect);

          if (confidence === "high") {
            setStatus("Auto crop successful", "ok");
          } else {
            // confidence "medium" still means we found boundaries — apply it
            setStatus("Auto crop applied — adjust manually if needed", "warn");
          }
        } else {
          rect = { x: 0, y: 0, w: workingCanvas.width, h: workingCanvas.height };
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
          if (mode !== "original") {
            setStatus((prev) =>
              prev.includes("crop") ? prev + ` · ${MODE_LABELS[mode]} applied` : `${MODE_LABELS[mode]} applied`,
              "ok"
            );
          }
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
      img.src = `data:${mime};base64,${base64}`;
    });

    setProcessing(false);
  }, [autoCropEnabled, cropPadding, jpegQuality, maxWidth]);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    runFullPipeline(imageBase64, mimeType, enhancementMode, true);
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
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const cw = overlayCanvasRef.current?.width ?? 1;
    const ch = overlayCanvasRef.current?.height ?? 1;
    const scaleX = cw / rect.width;
    const scaleY = ch / rect.height;
    let cx = 0; let cy = 0;
    if ("touches" in e) {
      cx = e.touches[0].clientX - rect.left;
      cy = e.touches[0].clientY - rect.top;
    } else {
      cx = e.clientX - rect.left;
      cy = e.clientY - rect.top;
    }
    return { x: cx * scaleX, y: cy * scaleY };
  }

  function handlePointerDown(e: React.MouseEvent | React.TouchEvent) {
    const pos = getPointerPos(e);
    const hs = 20; // handle hit area
    const br = { x: cropRect.x + cropRect.w - hs, y: cropRect.y + cropRect.h - hs };
    if (pos.x >= br.x && pos.y >= br.y) {
      setDragMode("resize-br");
    } else if (
      pos.x >= cropRect.x && pos.x <= cropRect.x + cropRect.w &&
      pos.y >= cropRect.y && pos.y <= cropRect.y + cropRect.h
    ) {
      setDragMode("move");
    } else {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: pos.x, y: pos.y });
  }

  function handlePointerMove(e: React.MouseEvent | React.TouchEvent) {
    if (!isDragging || !dragMode) return;
    const pos = getPointerPos(e);
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;

    if (dragMode === "move") {
      setCropRect((prev) => ({
        ...prev,
        x: Math.max(0, Math.min(prev.x + dx, imgSize.w - prev.w)),
        y: Math.max(0, Math.min(prev.y + dy, imgSize.h - prev.h)),
      }));
    } else if (dragMode === "resize-br") {
      setCropRect((prev) => ({
        ...prev,
        w: Math.max(50, Math.min(prev.w + dx, imgSize.w - prev.x)),
        h: Math.max(50, Math.min(prev.h + dy, imgSize.h - prev.y)),
      }));
    }
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
            <h3 className="text-sm font-bold text-gray-900">ID Card Editor</h3>
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
                style={{ cursor: isDragging ? (dragMode === "resize-br" ? "nwse-resize" : "move") : "crosshair", maxHeight: 340, display: "flex", justifyContent: "center" }}
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
                Drag inside blue box to move · Bottom-right corner to resize
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
                This image will be saved to Form F
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
              <Check size={12} className="mr-1" /> Save to Form F
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
