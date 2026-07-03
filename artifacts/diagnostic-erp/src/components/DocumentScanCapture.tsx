/**
 * DocumentScanCapture.tsx — Reusable camera / upload capture for AI document
 * scanning, shared across ERP modules (Expenses today; Bank, Patient
 * Documents, and future modules can reuse the same component).
 *
 * This does NOT introduce a new OCR engine. It is a thin, generic capture UI
 * that posts the captured image to whatever `endpoint` the caller passes
 * (e.g. the EXISTING `/api/expenses/scan-bill`, which already uses the
 * shared Gemini OCR helper `geminiOcrBill`). The caller owns field mapping
 * via `onResult` — this component only handles: get an image → send it →
 * hand back the raw JSON.
 *
 * Supports:
 *   - Mobile/desktop camera capture (getUserMedia)
 *   - File upload (JPG/PNG/PDF-as-image via <input type=file accept=...>)
 *   - Drag & drop
 *   - Live scanning state + error surface
 *
 * Reused instead of duplicated: this is the SAME visual pattern as
 * OcrCapturePanel.tsx (Form F ID scanning) but with no Form-F-specific
 * field names baked in, so any module can adopt it without forking logic.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X, Loader2, ScanLine, RefreshCcw } from "lucide-react";

export interface DocumentScanCaptureProps<TResult = unknown> {
  /** Backend endpoint that accepts { imageBase64, mimeType } and returns the parsed result. */
  endpoint: string;
  /** Called with the raw parsed JSON from the endpoint. Field mapping is the caller's job. */
  onResult: (result: TResult) => void;
  /** Optional: called on any capture/scan error (network, endpoint, camera). */
  onError?: (message: string) => void;
  /** Button label shown before capture starts. */
  triggerLabel?: string;
  /** Short helper text shown above the capture area. */
  helperText?: string;
  /** Max file size in MB for uploads (default 8MB, matches expense scan-bill limit). */
  maxSizeMB?: number;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export default function DocumentScanCapture<TResult = unknown>({
  endpoint,
  onResult,
  onError,
  triggerLabel = "Scan with AI",
  helperText = "Take a photo or upload an image — fields will be auto-filled for you to review.",
  maxSizeMB = 8,
}: DocumentScanCaptureProps<TResult>) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      const msg = "Camera not available. You can still upload a photo instead.";
      onError?.(msg);
      toast({ title: "Camera unavailable", description: msg, variant: "destructive" });
    }
  };

  const captureFromCamera = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    stopCamera();
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        void submitFile(file);
      },
      "image/jpeg",
      0.9,
    );
  };

  const submitFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      const msg = "Unsupported file type. Use JPEG, PNG, WebP, or HEIC.";
      onError?.(msg);
      toast({ title: "Unsupported file", description: msg, variant: "destructive" });
      return;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      const msg = `Image too large. Maximum ${maxSizeMB} MB.`;
      onError?.(msg);
      toast({ title: "File too large", description: msg, variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPreview(dataUrl);
      const base64 = dataUrl.split(",")[1] ?? "";
      setScanning(true);
      try {
        const result = await api.post<TResult>(endpoint, {
          imageBase64: base64,
          mimeType: file.type,
        });
        onResult(result);
        toast({ title: "Scan complete", description: "Review the auto-filled fields before saving." });
        setOpen(false);
        setPreview("");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "AI scan failed";
        onError?.(msg);
        toast({ title: "Scan failed", description: msg, variant: "destructive" });
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void submitFile(file);
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <ScanLine size={15} /> {triggerLabel}
      </Button>
    );
  }

  return (
    <div className="border rounded-xl p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{helperText}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { stopCamera(); setOpen(false); setPreview(""); }}
        >
          <X size={14} />
        </Button>
      </div>

      {cameraActive ? (
        <div className="space-y-2">
          <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-2">
            <Button type="button" onClick={captureFromCamera} className="flex-1 gap-1.5">
              <Camera size={15} /> Capture
            </Button>
            <Button type="button" variant="outline" onClick={stopCamera}>
              <RefreshCcw size={15} />
            </Button>
          </div>
        </div>
      ) : preview && scanning ? (
        <div className="space-y-2">
          <img src={preview} alt="Captured document" className="w-full rounded-lg max-h-64 object-contain bg-black/5" />
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 size={16} className="animate-spin" /> Reading document with AI…
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
          }`}
        >
          <p className="text-xs text-muted-foreground mb-3">Drag &amp; drop an image here, or:</p>
          <div className="flex items-center justify-center gap-2">
            <Button type="button" size="sm" onClick={startCamera} className="gap-1.5">
              <Camera size={14} /> Use Camera
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
              <Upload size={14} /> Upload File
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void submitFile(f); }}
          />
        </div>
      )}
    </div>
  );
}
