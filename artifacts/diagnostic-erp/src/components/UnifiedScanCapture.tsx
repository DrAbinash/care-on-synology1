/**
 * UnifiedScanCapture.tsx — the ONE shared document-capture entry point for
 * Care Diagnostics, reusable by Form F, Patient Registration, Expenses, and
 * Banking. This is a UI-unification layer over already-working mechanisms —
 * it introduces no new scanning logic:
 *
 *   - "Existing Scanner"  -> scanBridgeClient.ts -> workstation Scanner Bridge
 *   - "Upload Image or PDF" -> the same file-picker/drag-drop pattern used by
 *                              DocumentScanCapture.tsx and ScanIdButton.tsx
 *   - "Mobile Scan"        -> the existing /api/scan-sessions QR/phone flow
 *   - "Webcam"             -> getUserMedia, shown only when a camera is
 *                              actually available (secure-context checked)
 *
 * A 5th option, "Scan with TVS PDS 8M", is intentionally NOT included yet —
 * it lands in a later phase once real-device behavior has been verified on
 * the reception workstation, per the "don't claim hardware support before
 * it's been tested" rule. Until then, "Webcam" already covers any UVC
 * camera-class device plugged into the workstation, including the TVS.
 *
 * Capture-only: resolves to raw bytes + light metadata, never OCR results.
 * Each caller keeps calling its own existing OCR/save endpoint with the
 * returned blob — this component does not know about Form F fields, expense
 * categories, or any other module-specific shape.
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Camera, Scan, Smartphone, Upload, X, RefreshCcw, Loader2 } from "lucide-react";
import { checkScanBridgeHealth, scanBridgeCapture, type ScanBridgeState } from "@/lib/scanBridgeClient";

export type ScanModule = "form-f" | "patients" | "expenses" | "banking";
export type ScanDocType = "id-card" | "bill" | "bank-statement" | "photo" | "other";
export type ScanSource = "bridge" | "upload" | "mobile" | "webcam";

export interface ScanCaptureResult {
  file: Blob;
  mimeType: string;
  source: ScanSource;
  deviceLabel?: string;
  filename?: string;
}

export interface UnifiedScanCaptureProps {
  module: ScanModule;
  docType: ScanDocType;
  triggerLabel?: string;
  className?: string;
  onCapture: (result: ScanCaptureResult) => void;
  onError?: (message: string) => void;
}

const ACCEPTED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const MOBILE_QR_LABEL: Record<ScanModule, string> = {
  "form-f": "Form F document",
  patients: "patient document",
  expenses: "expense bill",
  banking: "bank document",
};

export default function UnifiedScanCapture({
  module,
  docType,
  triggerLabel = "Scan Document",
  className = "",
  onCapture,
  onError,
}: UnifiedScanCaptureProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"select" | "webcam" | "mobile">("select");

  // ── Scanner Bridge health ──
  const [bridgeState, setBridgeState] = useState<ScanBridgeState>("not-running");
  const [bridgeBusy, setBridgeBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    async function poll() {
      const health = await checkScanBridgeHealth();
      if (active) setBridgeState(health.state);
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { active = false; clearInterval(t); };
  }, [open]);

  async function handleBridgeCapture() {
    setBridgeBusy(true);
    try {
      const raw = await scanBridgeCapture();
      if (!raw.ok || !raw.imageBase64) throw new Error(raw.error || "Scan failed");
      const blob = base64ToBlob(raw.imageBase64, raw.mimeType || "image/jpeg");
      onCapture({ file: blob, mimeType: raw.mimeType || "image/jpeg", source: "bridge", filename: raw.filename, deviceLabel: "Workstation Scanner" });
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scanner bridge failed";
      onError?.(msg);
      toast({ title: "Scanner error", description: msg, variant: "destructive" });
    } finally {
      setBridgeBusy(false);
    }
  }

  // ── Upload ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  function handleFileChosen(file: File | null) {
    if (!file) return;
    if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
      const msg = "Unsupported file type. Use JPEG, PNG, WebP, HEIC, or PDF.";
      onError?.(msg);
      toast({ title: "Unsupported file", description: msg, variant: "destructive" });
      return;
    }
    onCapture({ file, mimeType: file.type, source: "upload", filename: file.name });
    setOpen(false);
  }

  // ── Webcam ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const isSecureCameraContext = typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices;

  useEffect(() => {
    if (!open || !isSecureCameraContext) return;
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => setCameras(devices.filter((d) => d.kind === "videoinput")))
      .catch(() => setCameras([]));
  }, [open, isSecureCameraContext]);

  function stopWebcam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => () => stopWebcam(), []);

  async function startWebcam() {
    setMode("webcam");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start camera";
      onError?.(msg);
      toast({ title: "Camera failed", description: msg, variant: "destructive" });
      setMode("select");
    }
  }

  function captureWebcamFrame() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const deviceLabel = cameras.find((c) => streamRef.current?.getVideoTracks()[0]?.label === c.label)?.label || "Webcam";
    stopWebcam();
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture({ file: blob, mimeType: "image/jpeg", source: "webcam", deviceLabel, filename: "webcam-capture.jpg" });
        setOpen(false);
      },
      "image/jpeg",
      0.9,
    );
  }

  // ── Mobile Scan (QR) — reuses the existing scan-sessions flow ──
  const [sessionToken, setSessionToken] = useState("");
  const [mobileQrUrl, setMobileQrUrl] = useState("");
  const [sessionStatus, setSessionStatus] = useState<"pending" | "completed" | "expired" | "">("");

  async function startMobileSession() {
    setMode("mobile");
    try {
      const res = await api.post<{ sessionToken: string }>("/api/scan-sessions/create", { method: "qr" });
      setSessionToken(res.sessionToken);
      setSessionStatus("pending");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start mobile scan session";
      onError?.(msg);
      toast({ title: "Mobile scan failed", description: msg, variant: "destructive" });
      setMode("select");
    }
  }

  useEffect(() => {
    if (!sessionToken) return;
    const path = `${window.location.origin}/scan-mobile/${sessionToken}`;
    QRCode.toDataURL(path, { width: 200, margin: 1 }, (err, url) => { if (!err) setMobileQrUrl(url); });
  }, [sessionToken]);

  useEffect(() => {
    if (mode !== "mobile" || !sessionToken || sessionStatus !== "pending") return;
    let active = true;
    async function poll() {
      if (!active) return;
      try {
        const data = await api.get<{ status?: string; frontImageUrl?: string }>(`/api/scan-sessions/status/${sessionToken}`);
        if (data.status === "completed" && active) {
          setSessionStatus("completed");
          if (data.frontImageUrl) {
            const resp = await fetch(`/uploads/${data.frontImageUrl}`);
            const blob = await resp.blob();
            onCapture({ file: blob, mimeType: blob.type || "image/jpeg", source: "mobile", filename: data.frontImageUrl });
            setOpen(false);
          }
          return;
        }
        if (data.status === "expired" && active) {
          setSessionStatus("expired");
          return;
        }
      } catch {
        // transient poll failure — try again
      }
      if (active) setTimeout(poll, 1500);
    }
    poll();
    return () => { active = false; };
  }, [mode, sessionToken, sessionStatus]);

  function resetAndClose() {
    stopWebcam();
    setMode("select");
    setSessionToken("");
    setMobileQrUrl("");
    setSessionStatus("");
    setOpen(false);
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setOpen(true); setMode("select"); }} className={`gap-1.5 ${className}`}>
        <Scan size={15} /> {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Scan size={18} className="text-primary" /> {triggerLabel}
            </DialogTitle>
          </DialogHeader>

          {mode === "select" && (
            <div className="grid grid-cols-1 gap-2.5 pt-2">
              <Button
                variant="outline"
                onClick={handleBridgeCapture}
                disabled={bridgeBusy || bridgeState !== "ok"}
                className={`h-14 justify-start gap-3 hover:bg-muted/40 ${bridgeState === "ok" ? "border-green-200 bg-green-50/10" : ""}`}
              >
                {bridgeBusy ? <Loader2 size={20} className="animate-spin" /> : <Scan size={20} className={bridgeState === "ok" ? "text-green-600" : "text-muted-foreground"} />}
                <div className="text-left">
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    Existing Scanner
                    <div className={`w-1.5 h-1.5 rounded-full ${bridgeState === "ok" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {bridgeState === "ok" ? "Ready — Canon / workstation scanner" : bridgeState === "not-running" ? "Not detected — check Scanner Bridge is running" : "Blocked — check Scanner Settings"}
                  </div>
                </div>
              </Button>

              <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="h-14 justify-start gap-3 hover:bg-muted/40">
                <Upload size={20} className="text-muted-foreground shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-sm">Upload Image or PDF</div>
                  <div className="text-[10px] text-muted-foreground">Select a file from this computer</div>
                </div>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD_TYPES.join(",")}
                className="hidden"
                onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
              />

              <Button variant="outline" onClick={startMobileSession} className="h-14 justify-start gap-3 border-dashed hover:bg-muted/40">
                <Smartphone size={20} className="text-muted-foreground shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-sm">Mobile Scan</div>
                  <div className="text-[10px] text-muted-foreground">Scan QR with your phone to capture a {MOBILE_QR_LABEL[module]}</div>
                </div>
              </Button>

              {isSecureCameraContext && cameras.length > 0 && (
                <Button variant="outline" onClick={startWebcam} className="h-14 justify-start gap-3 hover:bg-muted/40">
                  <Camera size={20} className="text-muted-foreground shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Webcam</div>
                    <div className="text-[10px] text-muted-foreground">{cameras.length} camera{cameras.length !== 1 ? "s" : ""} detected on this workstation</div>
                  </div>
                </Button>
              )}
              {!isSecureCameraContext && (
                <p className="text-[10px] text-muted-foreground px-1">Webcam capture requires HTTPS (or localhost) — not available on this connection.</p>
              )}
            </div>
          )}

          {mode === "webcam" && (
            <div className="space-y-2 pt-2">
              <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2">
                <Button type="button" onClick={captureWebcamFrame} className="flex-1 gap-1.5">
                  <Camera size={15} /> Capture
                </Button>
                <Button type="button" variant="outline" onClick={() => { stopWebcam(); setMode("select"); }}>
                  <X size={15} />
                </Button>
              </div>
            </div>
          )}

          {mode === "mobile" && (
            <div className="space-y-3 pt-2 text-center">
              {sessionStatus === "pending" && mobileQrUrl && (
                <>
                  <img src={mobileQrUrl} alt="Scan QR" className="w-48 h-48 mx-auto rounded-lg border" />
                  <p className="text-xs text-muted-foreground">Scan this code with your phone's camera to open the mobile capture page.</p>
                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" /> Waiting for phone…
                  </div>
                </>
              )}
              {sessionStatus === "expired" && (
                <>
                  <p className="text-sm text-destructive">Session expired.</p>
                  <Button size="sm" onClick={startMobileSession} className="gap-1.5">
                    <RefreshCcw size={13} /> New QR Code
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => setMode("select")}>Back</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}
