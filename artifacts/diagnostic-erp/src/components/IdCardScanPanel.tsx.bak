import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Crop, RotateCcw, RotateCw, Undo2, Check, AlertTriangle,
  Maximize2, ScanLine, X, Upload
} from "lucide-react";

export interface IdCardScanPanelProps {
  imageBase64: string;
  mimeType: string;
  onSave: (result: {
    originalBase64: string;
    croppedBase64: string;
    mimeType: string;
  }) => void;
  onCancel: () => void;
  autoCropEnabled?: boolean;
  cropPadding?: number;
  jpegQuality?: number;
  maxWidth?: number;
}

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [originalBase64, setOriginalBase64] = useState(imageBase64);
  const [croppedBase64, setCroppedBase64] = useState("");
  const [showCropped, setShowCropped] = useState(true);
  const [cropConfidence, setCropConfidence] = useState<"high" | "medium" | "low">("high");
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<"move" | "resize-br" | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [processing, setProcessing] = useState(false);

  // Load image and optionally auto-crop
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      setImgSize({ w: naturalW, h: naturalH });

      // Scale down to maxWidth if needed
      const scaleFactor = maxWidth > 0 && naturalW > maxWidth ? maxWidth / naturalW : 1;
      const displayW = Math.round(naturalW * scaleFactor);
      const displayH = Math.round(naturalH * scaleFactor);

      // Set canvas dimensions
      const canvas = canvasRef.current;
      const preview = previewRef.current;
      if (!canvas || !preview) return;
      canvas.width = displayW;
      canvas.height = displayH;
      preview.width = displayW;
      preview.height = displayH;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, displayW, displayH);

      // Update original with resized version
      const resized = canvas.toDataURL("image/jpeg", jpegQuality / 100);
      setOriginalBase64(resized.split(",")[1]);

      if (autoCropEnabled) {
        const rect = detectCardCrop(canvas, cropPadding);
        setCropRect(rect);
        setCropConfidence(rect.confidence);
        if (rect.confidence !== "low") {
          applyCrop(rect, canvas, preview);
        } else {
          // Show original with crop overlay
          drawCropOverlay(canvas, preview, rect);
        }
      } else {
        // No auto-crop — show full image, default crop = full
        setCropRect({ x: 0, y: 0, w: displayW, h: displayH });
        setCropConfidence("high");
        const pCtx = preview.getContext("2d");
        if (pCtx) pCtx.drawImage(canvas, 0, 0);
      }
    };
    img.src = `data:${mimeType};base64,${imageBase64}`;
  }, [imageBase64, mimeType, autoCropEnabled, cropPadding, jpegQuality, maxWidth]);

  // Detect card crop region via edge detection
  function detectCardCrop(canvas: HTMLCanvasElement, padding: number): {
    x: number; y: number; w: number; h: number; confidence: "high" | "medium" | "low";
  } {
    const ctx = canvas.getContext("2d");
    if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height, confidence: "low" };
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width;
    const h = canvas.height;

    // Background threshold: pixels with R,G,B all > 240 are considered "white"
    const isBg = (i: number) => data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    let nonBgCount = 0;

    // Sample every 4th pixel for speed
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4;
        if (!isBg(i)) {
          nonBgCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const totalPixels = (w * h) / 16;
    const coverageRatio = nonBgCount / totalPixels;

    // If very little non-white, card may not be detected well
    if (coverageRatio < 0.05 || coverageRatio > 0.95) {
      return { x: 0, y: 0, w, h, confidence: "low" };
    }

    // Add padding
    const pad = Math.max(padding, 8);
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w, maxX + pad);
    maxY = Math.min(h, maxY + pad);

    const cropW = maxX - minX;
    const cropH = maxY - minY;

    // Confidence based on coverage ratio and aspect ratio
    const aspectRatio = cropW / (cropH || 1);
    const isCardAspect = aspectRatio >= 1.2 && aspectRatio <= 2.0;
    let confidence: "high" | "medium" | "low" = "medium";
    if (coverageRatio > 0.1 && coverageRatio < 0.8 && isCardAspect) confidence = "high";
    else if (coverageRatio < 0.05 || coverageRatio > 0.9) confidence = "low";

    return { x: minX, y: minY, w: cropW, h: cropH, confidence };
  }

  function applyCrop(
    rect: { x: number; y: number; w: number; h: number },
    source: HTMLCanvasElement,
    target: HTMLCanvasElement
  ) {
    target.width = rect.w;
    target.height = rect.h;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const dataUrl = target.toDataURL("image/jpeg", jpegQuality / 100);
    setCroppedBase64(dataUrl.split(",")[1]);
  }

  function drawCropOverlay(
    source: HTMLCanvasElement,
    target: HTMLCanvasElement,
    rect: { x: number; y: number; w: number; h: number }
  ) {
    target.width = source.width;
    target.height = source.height;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(source, 0, 0);
    // Draw dim overlay outside crop
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, rect.x, source.height);
    ctx.fillRect(rect.x + rect.w, 0, source.width - rect.x - rect.w, source.height);
    ctx.fillRect(rect.x, 0, rect.w, rect.y);
    ctx.fillRect(rect.x, rect.y + rect.h, rect.w, source.height - rect.y - rect.h);
    // Draw border
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    // Draw resize handle
    ctx.fillStyle = "#3b82f6";
    const handleSize = 8;
    ctx.fillRect(rect.x + rect.w - handleSize, rect.y + rect.h - handleSize, handleSize, handleSize);
  }

  // Redraw preview when cropRect changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const preview = previewRef.current;
    if (!canvas || !preview || imgSize.w === 0) return;
    if (showCropped) {
      applyCrop(cropRect, canvas, preview);
    } else {
      drawCropOverlay(canvas, preview, cropRect);
    }
  }, [cropRect, showCropped, imgSize.w, imgSize.h]);

  // Pointer events for manual crop
  function getPointerPos(e: React.PointerEvent | React.MouseEvent | React.TouchEvent) {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ("touches" in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ("clientX" in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return { x: 0, y: 0 };
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function handlePointerDown(e: React.PointerEvent | React.MouseEvent) {
    const pos = getPointerPos(e);
    const handleSize = 12;
    const nearHandle =
      pos.x >= cropRect.x + cropRect.w - handleSize &&
      pos.x <= cropRect.x + cropRect.w + handleSize &&
      pos.y >= cropRect.y + cropRect.h - handleSize &&
      pos.y <= cropRect.y + cropRect.h + handleSize;

    if (nearHandle) {
      setDragMode("resize-br");
    } else if (
      pos.x >= cropRect.x &&
      pos.x <= cropRect.x + cropRect.w &&
      pos.y >= cropRect.y &&
      pos.y <= cropRect.y + cropRect.h
    ) {
      setDragMode("move");
    } else {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: pos.x, y: pos.y });
  }

  function handlePointerMove(e: React.PointerEvent | React.MouseEvent | React.TouchEvent) {
    if (!isDragging || !dragMode) return;
    const pos = getPointerPos(e);
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;

    if (dragMode === "move") {
      setCropRect((prev) => {
        const newX = Math.max(0, Math.min(prev.x + dx, imgSize.w - prev.w));
        const newY = Math.max(0, Math.min(prev.y + dy, imgSize.h - prev.h));
        return { ...prev, x: newX, y: newY };
      });
    } else if (dragMode === "resize-br") {
      setCropRect((prev) => {
        const newW = Math.max(50, Math.min(prev.w + dx, imgSize.w - prev.x));
        const newH = Math.max(50, Math.min(prev.h + dy, imgSize.h - prev.y));
        return { ...prev, w: newW, h: newH };
      });
    }
    setDragStart({ x: pos.x, y: pos.y });
  }

  function handlePointerUp() {
    setIsDragging(false);
    setDragMode(null);
  }

  function rotateImage(direction: "left" | "right") {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const temp = document.createElement("canvas");
    temp.width = canvas.height;
    temp.height = canvas.width;
    const ctx = temp.getContext("2d");
    if (!ctx) return;
    if (direction === "left") {
      ctx.translate(0, temp.height);
      ctx.rotate(-Math.PI / 2);
    } else {
      ctx.translate(temp.width, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(canvas, 0, 0);
    canvas.width = temp.width;
    canvas.height = temp.height;
    const c2 = canvas.getContext("2d");
    if (c2) c2.drawImage(temp, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality / 100);
    setOriginalBase64(dataUrl.split(",")[1]);
    setImgSize({ w: canvas.width, h: canvas.height });

    // Re-run auto-crop on rotated image
    if (autoCropEnabled) {
      const rect = detectCardCrop(canvas, cropPadding);
      setCropRect(rect);
      setCropConfidence(rect.confidence);
      if (rect.confidence !== "low") {
        applyCrop(rect, canvas, previewRef.current!);
      }
    } else {
      setCropRect({ x: 0, y: 0, w: canvas.width, h: canvas.height });
    }
    toast({ title: `Rotated ${direction}` });
  }

  function restoreOriginal() {
    const canvas = canvasRef.current;
    const preview = previewRef.current;
    if (!canvas || !preview) return;
    setCroppedBase64("");
    setCropRect({ x: 0, y: 0, w: canvas.width, h: canvas.height });
    setCropConfidence("high");
    setShowCropped(false);
    const ctx = preview.getContext("2d");
    if (ctx) ctx.drawImage(canvas, 0, 0);
    toast({ title: "Original restored" });
  }

  function handleSave() {
    const final = croppedBase64 || originalBase64;
    if (!final) {
      toast({ title: "No image to save", variant: "destructive" });
      return;
    }
    onSave({
      originalBase64,
      croppedBase64: final === originalBase64 ? "" : final,
      mimeType: "image/jpeg",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <ScanLine size={18} className="text-blue-600" />
            <h3 className="text-base font-bold text-gray-900">ID Card Scan Editor</h3>
            {cropConfidence === "low" && (
              <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 text-[10px] h-5">
                <AlertTriangle size={10} className="mr-1" /> Low confidence
              </Badge>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Confidence warning */}
          {cropConfidence === "low" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} />
                <span className="font-semibold">Auto crop may be inaccurate.</span>
              </div>
              <p className="text-xs text-amber-700 mt-1">
                Please adjust the crop rectangle manually before saving.
              </p>
            </div>
          )}

          {/* Image preview with crop overlay */}
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="text-xs font-semibold text-gray-600 mb-1">
                {showCropped ? "Cropped Preview" : "Crop Region (drag to adjust)"}
              </div>
              <div
                ref={containerRef}
                className="relative bg-gray-100 rounded-lg overflow-hidden border border-gray-200 cursor-crosshair select-none"
                style={{ maxHeight: 400, display: "flex", justifyContent: "center" }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={(e) => handlePointerDown(e as any)}
                onTouchMove={(e) => handlePointerMove(e as any)}
                onTouchEnd={handlePointerUp}
              >
                <canvas
                  ref={previewRef}
                  className="max-w-full max-h-[400px]"
                />
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Drag inside the box to move. Drag bottom-right corner to resize.
              </div>
            </div>
          </div>

          {/* Hidden source canvas */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={showCropped ? "outline" : "default"}
              className="h-8 text-xs"
              onClick={() => setShowCropped(!showCropped)}
            >
              <Crop size={12} className="mr-1" /> {showCropped ? "Show Crop Overlay" : "Show Cropped"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => rotateImage("left")}>
              <RotateCcw size={12} className="mr-1" /> Rotate Left
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => rotateImage("right")}>
              <RotateCw size={12} className="mr-1" /> Rotate Right
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={restoreOriginal}>
              <Undo2 size={12} className="mr-1" /> Restore Original
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
              const canvas = canvasRef.current;
              const preview = previewRef.current;
              if (!canvas || !preview) return;
              const rect = detectCardCrop(canvas, cropPadding);
              setCropRect(rect);
              setCropConfidence(rect.confidence);
              if (rect.confidence !== "low") applyCrop(rect, canvas, preview);
              else drawCropOverlay(canvas, preview, rect);
            }}>
              <Maximize2 size={12} className="mr-1" /> Crop Again
            </Button>
          </div>

          {/* Save/Cancel */}
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSave}>
              <Check size={12} className="mr-1" /> Save Cropped
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
