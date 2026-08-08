import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Camera, Upload, Scan, X, CheckCircle2, AlertTriangle,
  RefreshCcw, ChevronDown, ChevronUp, FileImage, Activity,
  ScanLine, Wrench, Eye, EyeOff
} from "lucide-react";

type OcrLogEntry = {
  stage: string;
  status: "ok" | "warn" | "error" | "info";
  message: string;
  detail?: string;
};

type OcrResult = {
  guardianName?: string;
  address?: string;
  documentType?: string;
  confidence?: string;
} | null;

export interface OcrCapturePanelProps {
  onCapture: (result: {
    imageUrl: string;
    ocr: OcrResult;
    ocrLog: OcrLogEntry[];
  }) => void;
  onClose: () => void;
  scanBridgeOk: boolean;
  scanBridgeUrl: string;
  onScanBridgeTrigger: () => void;
  scanning: boolean;
}

export default function OcrCapturePanel({
  onCapture,
  onClose,
  scanBridgeOk,
  scanBridgeUrl,
  onScanBridgeTrigger,
  scanning,
}: OcrCapturePanelProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [cameraPermission, setCameraPermission] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [previewActive, setPreviewActive] = useState(false);
  const [ocrLog, setOcrLog] = useState<OcrLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "ok" | "fail">("idle");
  const [tesseractReady, setTesseractReady] = useState(false);
  const [tesseractLoading, setTesseractLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"unknown" | "ok" | "fail">("unknown");

  const SCAN_BRIDGE_URL = scanBridgeUrl;

  // ── 1. Auto camera detection ──
  // `navigator.mediaDevices` is entirely `undefined` in a non-secure context
  // (any origin that isn't HTTPS or localhost) — enumerateDevices() throwing
  // in that case was previously indistinguishable from "no camera hardware",
  // producing a misleading "No cameras detected" message instead of the
  // actual, actionable "this page needs HTTPS" cause.
  const isSecureCameraContext = typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices;

  async function detectCameras() {
    if (!isSecureCameraContext) {
      setCameras([]);
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      setCameras(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        // Prefer environment-facing (back) camera
        const env = videoDevices.find((d) =>
          d.label.toLowerCase().includes("back") ||
          d.label.toLowerCase().includes("environment") ||
          d.label.toLowerCase().includes("rear")
        );
        setSelectedCamera(env?.deviceId ?? videoDevices[0].deviceId);
      }
      return videoDevices;
    } catch {
      setCameras([]);
      return [];
    }
  }

  // ── 2. Permission diagnostics ──
  async function checkPermissions() {
    if (typeof navigator === "undefined" || !navigator.permissions) {
      setCameraPermission("unknown");
      return;
    }
    try {
      const cam = await navigator.permissions.query({ name: "camera" as PermissionName });
      setCameraPermission(cam.state as "granted" | "denied" | "prompt");
      cam.addEventListener("change", () => {
        setCameraPermission(cam.state as "granted" | "denied" | "prompt");
      });
    } catch {
      setCameraPermission("unknown");
    }
  }

  useEffect(() => {
    detectCameras();
    checkPermissions();
    checkBackendStatus();
    // Detect camera changes
    const onChange = () => detectCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, []);

  // ── 3. Start/stop camera preview ──
  async function startPreview(deviceId?: string) {
    if (!isSecureCameraContext) {
      toast({
        title: "Camera requires HTTPS",
        description: "This page must be loaded over HTTPS (or localhost) for the browser to allow camera access. Use File Upload instead, or access the ERP via its HTTPS address.",
        variant: "destructive",
      });
      return;
    }
    const id = deviceId || selectedCamera;
    if (!id) {
      toast({ title: "No camera selected", description: "Try refreshing the list or use File Upload instead", variant: "destructive" });
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setStream(s);
      setPreviewActive(true);
      setTestResult("idle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start camera";
      toast({ title: "Camera failed", description: msg, variant: "destructive" });
      setPreviewActive(false);
      logEntry("camera", "error", "Camera failed to start", msg);
      setCameraPermission("denied");
    }
  }

  function stopPreview() {
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setPreviewActive(false);
  }

  useEffect(() => {
    return () => { stopPreview(); };
  }, []);

  function logEntry(stage: string, status: OcrLogEntry["status"], message: string, detail?: string) {
    setOcrLog((prev) => [...prev, { stage, status, message, detail }]);
  }

  function clearLog() {
    setOcrLog([]);
    setTestResult("idle");
  }

  // ── 4. "Test Camera" button ──
  async function testCamera() {
    clearLog();
    setTesting(true);
    logEntry("test", "info", "Starting camera test...");
    try {
      if (cameras.length === 0) {
        const found = await detectCameras();
        if (found.length === 0) {
          logEntry("test", "error", "No cameras found", "No video input devices detected on this device");
          setTesting(false);
          return;
        }
      }
      await startPreview();
      logEntry("test", "ok", "Camera preview started", `${cameras.length} camera(s) available`);
      // Show preview for 3 seconds then auto-close
      setTimeout(() => {
        logEntry("test", "ok", "Camera test passed", "Video feed is active and rendering");
        setTesting(false);
      }, 3000);
    } catch (e) {
      logEntry("test", "error", "Camera test failed", String(e));
      setTesting(false);
    }
  }

  // ── 5. "Test OCR" button ──
  async function testOcr() {
    clearLog();
    setTesting(true);
    setTestResult("idle");
    logEntry("ocr", "info", "Starting OCR test...", "Capturing frame and sending to backend");
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) {
        logEntry("ocr", "error", "No active camera feed", "Start camera preview first, then click Test OCR");
        setTesting(false);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        logEntry("ocr", "error", "Canvas not available");
        setTesting(false);
        return;
      }
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const base64 = dataUrl.split(",")[1];
      logEntry("ocr", "ok", "Frame captured", `${canvas.width}x${canvas.height}`);

      logEntry("backend", "info", "Sending to backend...", "POST /api/form-f/upload-id");
      const resp = await api.post<{
        ocr?: OcrResult;
        ocrLog?: OcrLogEntry[];
        ocrStage?: string;
        suggestedAction?: string;
        recordId?: number;
      }>("/api/form-f/upload-id", {
        formFId: 0,
        imageBase64: base64,
        mimeType: "image/jpeg",
      });

      if (resp.ocr?.guardianName || resp.ocr?.address) {
        logEntry("backend", "ok", "OCR succeeded", `Document: ${resp.ocr.documentType ?? "unknown"} | Confidence: ${resp.ocr.confidence ?? "N/A"}`);
        setTestResult("ok");
        toast({ title: "OCR test passed", description: `${resp.ocr.documentType} — ${resp.ocr.confidence} confidence` });
        onCapture({ imageUrl: dataUrl, ocr: resp.ocr, ocrLog: [...ocrLog, { stage: "result", status: "ok", message: "Test complete", detail: JSON.stringify(resp.ocr) }] });
      } else {
        logEntry("backend", "warn", "AI OCR empty — auto Tesseract fallback", "Backend received the image but AI returned no fields");
        await runTesseractOcrFromDataUrl(dataUrl);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OCR test failed";
      logEntry("backend", "error", "Backend OCR error — trying Tesseract", msg);
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d")?.drawImage(video, 0, 0);
          await runTesseractOcrFromDataUrl(canvas.toDataURL("image/jpeg", 0.92));
        } else {
          setTestResult("fail");
          toast({ title: "OCR test failed", description: msg, variant: "destructive" });
        }
      } catch {
        setTestResult("fail");
        toast({ title: "OCR test failed", description: msg, variant: "destructive" });
      }
    } finally {
      setTesting(false);
    }
  }

  // Shared Tesseract path used by the manual button and auto-fallback
  async function runTesseractOcrFromDataUrl(dataUrl: string) {
    logEntry("tesseract", "info", "Starting Tesseract.js fallback...");
    setTesseractLoading(true);
    try {
      const { runIdCardTesseractOcr } = await import("@/lib/idCardTesseractOcr");
      const tess = await runIdCardTesseractOcr(dataUrl, "image/jpeg", (pct) => {
        logEntry("tesseract", "info", "Recognizing text...", `${pct}%`);
      });
      if (!tess) {
        logEntry("tesseract", "warn", "Tesseract returned no usable fields");
        setTestResult("fail");
        toast({ title: "Tesseract OCR: empty", description: "Could not extract name/address. Enter manually.", variant: "destructive" });
        return;
      }
      setTesseractReady(true);
      const tesseractResult: OcrResult = {
        guardianName: tess.guardianName,
        address: tess.address,
        documentType: tess.documentType,
        confidence: tess.confidence,
      };
      logEntry("tesseract", "ok", "OCR complete", `${tess.rawText.length} chars extracted`);
      setTestResult("ok");
      toast({ title: "Tesseract OCR done", description: `Extracted ${tess.rawText.length} chars. Please verify results.` });
      onCapture({ imageUrl: dataUrl, ocr: tesseractResult, ocrLog: [...ocrLog, { stage: "result", status: "ok", message: "Tesseract OCR complete", detail: tess.rawText.slice(0, 200) }] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Tesseract failed";
      logEntry("tesseract", "error", "Tesseract OCR failed", msg);
      setTestResult("fail");
      toast({ title: "Tesseract OCR failed", description: msg, variant: "destructive" });
    } finally {
      setTesseractLoading(false);
    }
  }

  // ── 6. Tesseract OCR fallback (manual button) ──
  async function runTesseractOcr() {
    clearLog();
    setTesting(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) {
        logEntry("tesseract", "error", "No active camera feed", "Start camera first, then capture for Tesseract");
        setTesting(false);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      logEntry("tesseract", "ok", "Frame captured for Tesseract", `${canvas.width}x${canvas.height}`);
      await runTesseractOcrFromDataUrl(dataUrl);
    } finally {
      setTesting(false);
    }
  }

  // ── 7. File upload fallback ──
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    clearLog();
    setTesting(true);
    logEntry("upload", "info", "File selected", `${file.name} (${file.type}, ${Math.round(file.size / 1024)}KB)`);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result ?? "");
        const base64 = dataUrl.split(",")[1];
        if (!base64) {
          logEntry("upload", "error", "Failed to read file");
          setTesting(false);
          return;
        }
        logEntry("upload", "ok", "File loaded", `${dataUrl.length} chars`);
        logEntry("backend", "info", "Sending to backend...");
        const resp = await api.post<{
          ocr?: OcrResult;
          ocrLog?: OcrLogEntry[];
          ocrStage?: string;
          suggestedAction?: string;
        }>("/api/form-f/upload-id", {
          formFId: 0,
          imageBase64: base64,
          mimeType: file.type,
        });
        if (resp.ocr?.guardianName || resp.ocr?.address) {
          logEntry("backend", "ok", "OCR from upload succeeded", `Document: ${resp.ocr.documentType}`);
          toast({ title: "Upload OCR done", description: resp.ocr.documentType });
          onCapture({ imageUrl: dataUrl, ocr: resp.ocr, ocrLog: [...ocrLog, { stage: "result", status: "ok", message: "Upload complete" }] });
        } else {
          logEntry("backend", "warn", "OCR returned empty from upload", "Try Tesseract fallback or a clearer image");
          toast({ title: "Upload OCR: empty result", description: "Try Tesseract or a clearer image", variant: "destructive" });
          setTesting(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      logEntry("upload", "error", "Upload failed", String(err));
      setTesting(false);
    }
  }

  // ── 8. Backend status check ──
  async function checkBackendStatus() {
    try {
      const resp = await api.get<{ ok: boolean; geminiConfigured?: boolean }>("/api/form-f/ocr-status");
      setBackendStatus(resp.ok && resp.geminiConfigured ? "ok" : "fail");
    } catch {
      setBackendStatus("fail");
    }
  }

  // ── 9. Quick capture from camera (same as old capture) ──
  async function captureAndOcr() {
    if (!previewActive) {
      toast({ title: "Start camera first", description: "Click 'Test Camera' or 'Start Camera' to begin preview", variant: "destructive" });
      return;
    }
    await testOcr();
  }

  const statusColor = {
    ok: "text-green-600",
    warn: "text-amber-600",
    error: "text-red-600",
    info: "text-blue-600",
  };

  const statusBg = {
    ok: "bg-green-50",
    warn: "bg-amber-50",
    error: "bg-red-50",
    info: "bg-blue-50",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-blue-600" />
            <h3 className="text-base font-bold text-gray-900">ID Card Capture & OCR</h3>
            {backendStatus === "ok" ? (
              <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 text-[10px] h-5">Backend OK</Badge>
            ) : backendStatus === "fail" ? (
              <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 text-[10px] h-5">Backend Offline</Badge>
            ) : null}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* ── Permission & Diagnostics ── */}
          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Camera permission:</span>
              {cameraPermission === "granted" ? (
                <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={12} /> Granted</span>
              ) : cameraPermission === "denied" ? (
                <span className="text-red-600 flex items-center gap-1"><AlertTriangle size={12} /> Denied — open browser settings and allow camera</span>
              ) : cameraPermission === "prompt" ? (
                <span className="text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Waiting — click "Start Camera" below</span>
              ) : (
                <span className="text-gray-500">Unknown — click "Start Camera" to check</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Cameras found:</span>
              <span className="text-gray-600">{cameras.length} device{cameras.length !== 1 ? "s" : ""}</span>
              {cameras.length === 0 && !isSecureCameraContext && (
                <span className="text-red-600">— Camera requires HTTPS (or localhost). This page is loaded over plain HTTP, so the browser hides all cameras. Use File Upload or Scanner Bridge instead.</span>
              )}
              {cameras.length === 0 && isSecureCameraContext && (
                <span className="text-red-600">— No cameras detected. Use File Upload or Scanner Bridge instead.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Scanner bridge:</span>
              {scanBridgeOk ? (
                <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={12} /> Connected ({SCAN_BRIDGE_URL})</span>
              ) : (
                <span className="text-gray-500">Offline — bridge not running</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Backend OCR:</span>
              {backendStatus === "ok" ? (
                <span className="text-green-600">Gemini AI ready</span>
              ) : backendStatus === "fail" ? (
                <span className="text-red-600">Not configured — Tesseract fallback available</span>
              ) : (
                <span className="text-gray-500">Checking...</span>
              )}
            </div>
          </div>

          {/* ── Camera Selector ── */}
          {cameras.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-700">Camera:</label>
              <select
                value={selectedCamera}
                onChange={(e) => {
                  setSelectedCamera(e.target.value);
                  if (previewActive) {
                    stopPreview();
                    startPreview(e.target.value);
                  }
                }}
                className="text-xs border rounded-md px-2 py-1 flex-1 bg-white"
              >
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera ${c.deviceId.slice(0, 8)}`}
                    {c.label.toLowerCase().includes("back") || c.label.toLowerCase().includes("environment") ? " — back" : ""}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={detectCameras}>
                <RefreshCcw size={12} className="mr-1" /> Refresh
              </Button>
            </div>
          )}

          {/* ── Live Preview ── */}
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video border-2 border-gray-200">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {!previewActive && (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                <div className="text-center">
                  <Camera size={32} className="mx-auto mb-2 opacity-50" />
                  <p>Camera preview inactive</p>
                  <p className="text-xs mt-1">Click "Start Camera" to begin</p>
                </div>
              </div>
            )}
            {previewActive && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[10px] text-white bg-black/50 px-1.5 py-0.5 rounded">LIVE</span>
              </div>
            )}
          </div>

          {/* ── Action Buttons ── */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className={`h-8 text-xs ${previewActive ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
              onClick={previewActive ? stopPreview : () => startPreview()}
              disabled={cameras.length === 0 && !previewActive}
            >
              {previewActive ? (
                <><EyeOff size={12} className="mr-1" /> Stop Camera</>
              ) : (
                <><Eye size={12} className="mr-1" /> Start Camera</>
              )}
            </Button>

            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={testCamera} disabled={testing || cameras.length === 0}>
              <Activity size={12} className="mr-1" /> Test Camera
            </Button>

            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={captureAndOcr} disabled={testing || !previewActive}>
              <ScanLine size={12} className="mr-1" /> Test OCR
            </Button>

            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={runTesseractOcr} disabled={testing || !previewActive}>
              <Wrench size={12} className="mr-1" /> Tesseract Fallback
            </Button>

            {scanBridgeOk && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onScanBridgeTrigger} disabled={scanning}>
                <Scan size={12} className="mr-1" /> {scanning ? "Scanning..." : "Scanner Bridge"}
              </Button>
            )}

            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
              <Upload size={12} className="mr-1" /> Upload File
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          </div>

          {/* ── Test Result ── */}
          {testResult !== "idle" && (
            <div className={`rounded-lg p-3 text-sm ${testResult === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              <div className="flex items-center gap-2">
                {testResult === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span className="font-semibold">
                  {testResult === "ok" ? "OCR test passed — data extracted successfully" : "OCR test failed — check the log below for details"}
                </span>
              </div>
            </div>
          )}

          {/* ── OCR Log ── */}
          <div>
            <button
              onClick={() => setShowLog(!showLog)}
              className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
              {showLog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Detailed OCR Log ({ocrLog.length} entries)
              {ocrLog.length > 0 && (
                <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${ocrLog.some((l) => l.status === "error") ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"}`}>
                  {ocrLog.some((l) => l.status === "error") ? "Has errors" : "All OK"}
                </span>
              )}
            </button>
            {showLog && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto border rounded-lg p-2 bg-gray-50">
                {ocrLog.length === 0 ? (
                  <p className="text-xs text-gray-400">No log entries yet. Run a test to see details.</p>
                ) : (
                  ocrLog.map((entry, i) => (
                    <div key={i} className={`text-xs rounded px-2 py-1.5 ${statusBg[entry.status]} ${statusColor[entry.status]}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold uppercase text-[10px] tracking-wider">{entry.stage}</span>
                        <span className="font-medium">{entry.message}</span>
                      </div>
                      {entry.detail && <p className="mt-0.5 text-[10px] opacity-80 truncate">{entry.detail}</p>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── Tips ── */}
          <div className="text-xs text-gray-500 bg-blue-50 rounded-lg p-3">
            <p className="font-semibold text-blue-700 mb-1">Tips for best results:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Place the ID card flat on a dark, contrasting surface</li>
              <li>Ensure good lighting — avoid shadows and glare</li>
              <li>Hold the camera steady and parallel to the card</li>
              <li>Make sure all text is clearly visible in the preview</li>
              <li>If backend OCR fails, try the <strong>Tesseract Fallback</strong> button</li>
              <li>As a last resort, use <strong>Upload File</strong> with a scanned image</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
