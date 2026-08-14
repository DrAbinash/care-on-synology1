/**
 * DocumentScanCapture.tsx — Reusable camera / upload capture for AI document
 * scanning, shared across ERP modules (Expenses today; Bank, Patient
 * Documents, and future modules can reuse the same component).
 *
 * This does NOT introduce a new OCR engine. It is a thin, generic capture UI
 * that posts the captured image to whatever `endpoint` the caller passes
 * (e.g. `/api/expenses/scan-bill` — Ollama vision, then Tesseract fallback).
 * The caller owns field mapping
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
import { Camera, Upload, X, Loader2, ScanLine, RefreshCcw, FileText } from "lucide-react";
import IdCardScanPanel, { type ScanDocType } from "@/components/IdCardScanPanel";

export interface DocumentScanCaptureProps<TResult = unknown> {
  /** Backend endpoint that accepts { imageBase64, mimeType } and returns the parsed result. */
  endpoint: string;
  /** Called with the raw parsed JSON from the endpoint. Field mapping is the caller's job. */
  onResult: (result: TResult) => void;
  /** Optional: called on any capture/scan error (network, endpoint, camera). */
  onError?: (message: string) => void;
  /**
   * When the server returns tesseractFallbackSuggested (Ollama down),
   * run local Tesseract and return a result in the same shape.
   */
  tesseractFallback?: (imageBase64: string, mimeType: string) => Promise<TResult | null>;
  /** Button label shown before capture starts. */
  triggerLabel?: string;
  /** Short helper text shown above the capture area. */
  helperText?: string;
  /** Max file size in MB for uploads (default 8MB, matches expense scan-bill limit). */
  maxSizeMB?: number;
  /** Show the crop/enhance editor after capture, before OCR. Default true — the
   *  enhanced (deskewed, white-balanced, shadow-flattened) image OCRs far better
   *  on phone photos of receipts/bills/cheques. Set false for the old direct flow. */
  enableEditor?: boolean;
  /** Document type for the editor preset. Default "receipt". */
  docType?: ScanDocType;
  /** Editor header/label. Default "Document". */
  editorTitle?: string;
  /** Optional: receives the FINAL (enhanced) image base64 + mime, e.g. to persist
   *  it on the record for an audit trail. Fires whether or not OCR succeeds. */
  onImage?: (base64: string, mimeType: string) => void;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

export default function DocumentScanCapture<TResult = unknown>({
  endpoint,
  onResult,
  onError,
  triggerLabel = "Scan with AI",
  helperText = "Take a photo or upload an image — fields will be auto-filled for you to review.",
  maxSizeMB = 8,
  enableEditor = true,
  docType = "receipt",
  editorTitle = "Document",
  onImage,
  tesseractFallback,
}: DocumentScanCaptureProps<TResult>) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  // When set, the crop/enhance editor is shown for this captured image before OCR.
  const [editing, setEditing] = useState<{ base64: string; mimeType: string } | null>(null);
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
      const msg = "Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF.";
      onError?.(msg);
      toast({ title: "Unsupported file", description: msg, variant: "destructive" });
      return;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      const msg = `File too large. Maximum ${maxSizeMB} MB.`;
      onError?.(msg);
      toast({ title: "File too large", description: msg, variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      // The crop/enhance editor is canvas-based and can't decode PDF bytes as
      // an image — send PDFs straight to OCR, same as the enableEditor=false path.
      const isPdf = file.type === "application/pdf";
      if (enableEditor && !isPdf) {
        // Show the crop/enhance editor first; OCR runs on the enhanced image.
        setEditing({ base64, mimeType: file.type });
      } else {
        setPreview(dataUrl);
        void runOcr(base64, file.type);
      }
    };
    reader.readAsDataURL(file);
  };

  /** POST the (possibly enhanced) image to the OCR endpoint and hand back the result. */
  const runOcr = async (base64: string, mimeType: string) => {
    onImage?.(base64, mimeType);
    setScanning(true);
    try {
      const result = await api.post<TResult & { tesseractFallbackSuggested?: boolean; geminiFallbackAvailable?: boolean }>(endpoint, {
        imageBase64: base64,
        mimeType,
      });
      const needsTess = Boolean(result && typeof result === "object" && result.tesseractFallbackSuggested);
      if (needsTess && tesseractFallback) {
        const tess = await tesseractFallback(base64, mimeType);
        if (tess) {
          onResult(tess);
          toast({ title: "Scanned with Tesseract", description: "Ollama was unavailable. Review every field before saving." });
          setOpen(false);
          setPreview("");
          return;
        }
      }
      const tryGemini = needsTess && Boolean(result && typeof result === "object" && result.geminiFallbackAvailable);
      if (tryGemini) {
        try {
          const gem = await api.post<TResult>(endpoint, {
            imageBase64: base64,
            mimeType,
            useGeminiFallback: true,
          });
          onResult(gem);
          toast({ title: "Scanned with Gemini", description: "Ollama and Tesseract did not read this. Review every field before saving." });
          setOpen(false);
          setPreview("");
          return;
        } catch { /* fall through */ }
      }
      onResult(result);
      toast({ title: "Scan complete", description: "Review the auto-filled fields before saving." });
      setOpen(false);
      setPreview("");
    } catch (err: unknown) {
      if (tesseractFallback) {
        try {
          const tess = await tesseractFallback(base64, mimeType);
          if (tess) {
            onResult(tess);
            toast({ title: "Scanned with Tesseract", description: "Server OCR failed. Review every field before saving." });
            setOpen(false);
            setPreview("");
            return;
          }
        } catch { /* fall through */ }
      }
      try {
        const gem = await api.post<TResult>(endpoint, {
          imageBase64: base64,
          mimeType,
          useGeminiFallback: true,
        });
        onResult(gem);
        toast({ title: "Scanned with Gemini", description: "Review every field before saving." });
        setOpen(false);
        setPreview("");
        return;
      } catch { /* fall through */ }
      const msg = err instanceof Error ? err.message : "AI scan failed";
      onError?.(msg);
      toast({ title: "Scan failed", description: msg, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void submitFile(file);
  };

  // The crop/enhance editor is a full-screen modal — render it over whatever
  // trigger/panel state we're in whenever an image is awaiting review.
  const editor = editing ? (
    <IdCardScanPanel
      imageBase64={editing.base64}
      mimeType={editing.mimeType}
      docType={docType}
      title={editorTitle}
      onSave={(r) => {
        const enhanced = r.enhancedBase64 || r.croppedBase64 || r.originalBase64;
        setEditing(null);
        void runOcr(enhanced, "image/jpeg");
      }}
      onCancel={() => setEditing(null)}
    />
  ) : null;

  if (!open) {
    return (
      <>
        <Button type="button" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
          <ScanLine size={15} /> {triggerLabel}
        </Button>
        {editor}
      </>
    );
  }

  return (
    <>
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
          {preview.startsWith("data:image") ? (
            <img src={preview} alt="Captured document" className="w-full rounded-lg max-h-64 object-contain bg-black/5" />
          ) : (
            <div className="w-full rounded-lg bg-black/5 flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <FileText size={24} /> <span className="text-sm">PDF ready for scanning</span>
            </div>
          )}
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
          <p className="text-xs text-muted-foreground mb-3">Drag &amp; drop an image or PDF here, or:</p>
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
    {editor}
    </>
  );
}
