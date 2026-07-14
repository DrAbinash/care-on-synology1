/**
 * UnifiedScanCapture.tsx — the ONE shared document-capture entry point for
 * Care Diagnostics, reusable by Form F, Patient Registration, Expenses, and
 * Banking. This is a UI-unification layer over already-working mechanisms —
 * it introduces no new scanning logic:
 *
 *   - "Scan with TVS PDS 8M" -> getUserMedia against an admin-confirmed
 *                              preferred deviceId (tvsDeviceProfile.ts),
 *                              with a fixed-focus placement guide + live
 *                              blur check. Only shown once an admin has
 *                              bound a device in Scanner Settings — see the
 *                              hardware-status note in tvsDeviceProfile.ts:
 *                              this path has NOT been physically verified
 *                              against a real TVS PDS 8M yet.
 *   - "Existing Scanner"  -> scanBridgeClient.ts -> workstation Scanner Bridge
 *                            (Canon / WIA / SANE flatbed — untouched, unaffected)
 *   - "Upload Image or PDF" -> the same file-picker/drag-drop pattern used by
 *                              DocumentScanCapture.tsx and ScanIdButton.tsx
 *   - "Mobile Scan"        -> the existing /api/scan-sessions QR/phone flow
 *   - "Webcam"             -> getUserMedia, generic device list, shown only
 *                              when a camera is actually available (secure-
 *                              context checked)
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
import { Camera, Scan, Smartphone, Upload, X, RefreshCcw, Loader2, ScanLine } from "lucide-react";
import { checkScanBridgeHealth, scanBridgeCapture, type ScanBridgeState } from "@/lib/scanBridgeClient";
import PlacementGuideOverlay from "@/components/PlacementGuideOverlay";
import { computeBlurScore, getPreferredTvsDeviceId, getPreferredTvsDeviceLabel, BLUR_WARNING_THRESHOLD } from "@/lib/tvsDeviceProfile";
import { classifyCameraError, isSecureCameraContext as checkSecureCameraContext, watchForDeviceDisconnect, type CameraDiagnostic } from "@/lib/cameraDiagnostics";

export type ScanModule = "form-f" | "patients" | "expenses" | "banking";
export type ScanDocType = "id-card" | "bill" | "bank-statement" | "photo" | "other";
export type ScanSource = "bridge" | "upload" | "mobile" | "webcam" | "tvs";

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
  const [mode, setMode] = useState<"select" | "webcam" | "tvs" | "mobile">("select");

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
  const isSecureCameraContext = checkSecureCameraContext();

  // TVS PDS 8M — see tvsDeviceProfile.ts for the hardware-status caveat.
  // Only shown once an admin has bound a deviceId in Scanner Settings.
  const [tvsDeviceId] = useState(() => getPreferredTvsDeviceId());
  const [tvsDeviceLabel] = useState(() => getPreferredTvsDeviceLabel());
  const [blurScore, setBlurScore] = useState<number | null>(null);
  const blurIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cameraDiagnostic, setCameraDiagnostic] = useState<CameraDiagnostic | null>(null);
  const stopDisconnectWatchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open || !isSecureCameraContext) return;
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => setCameras(devices.filter((d) => d.kind === "videoinput")))
      .catch(() => setCameras([]));
  }, [open, isSecureCameraContext]);

  function stopWebcam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (blurIntervalRef.current) {
      clearInterval(blurIntervalRef.current);
      blurIntervalRef.current = null;
    }
    stopDisconnectWatchRef.current?.();
    stopDisconnectWatchRef.current = null;
    setBlurScore(null);
  }
  useEffect(() => () => stopWebcam(), []);

  async function startCameraStream(target: "webcam" | "tvs", deviceId?: string) {
    setMode(target);
    setCameraDiagnostic(null);
    try {
      // `ideal` (not `exact`) for resolution — the browser picks the closest
      // mode the device actually supports rather than failing outright.
      // Without this, getUserMedia() commonly defaults to a low resolution
      // (often 640x480) even on an 8MP-capable device like the TVS PDS 8M.
      // See docs/TVS_PDS_8M_VALIDATION.md — actual supported resolutions on
      // the real device still need confirming via getCapabilities().
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 3264 }, height: { ideal: 2448 } }
          : { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // Surface a mid-session USB unplug — getUserMedia() itself doesn't
      // reject in this case, the stream just goes quiet, which otherwise
      // looks like a frozen preview with no explanation.
      stopDisconnectWatchRef.current = watchForDeviceDisconnect(stream, (diag) => {
        setCameraDiagnostic(diag);
        toast({ title: "Camera disconnected", description: diag.message, variant: "destructive" });
        setMode("select");
      });
      // TVS is fixed-focus — sample a live blur score so staff can reposition
      // before capturing instead of discovering a blurry image afterward.
      if (target === "tvs" && videoRef.current && canvasRef.current) {
        blurIntervalRef.current = setInterval(() => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.videoWidth === 0) return;
          // Downsample for speed — blur estimation doesn't need full resolution.
          const sampleWidth = 240;
          const scale = sampleWidth / video.videoWidth;
          canvas.width = sampleWidth;
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          setBlurScore(computeBlurScore(frame));
        }, 400);
      }
    } catch (e) {
      const diag = classifyCameraError(e);
      setCameraDiagnostic(diag);
      onError?.(diag.message);
      toast({ title: "Camera failed", description: diag.message, variant: "destructive" });
      setMode("select");
    }
  }

  function captureFrame(source: "webcam" | "tvs", deviceLabel?: string) {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const label =
      deviceLabel ||
      (source === "tvs" ? tvsDeviceLabel || "TVS PDS 8M" : cameras.find((c) => streamRef.current?.getVideoTracks()[0]?.label === c.label)?.label || "Webcam");
    stopWebcam();
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture({ file: blob, mimeType: "image/jpeg", source, deviceLabel: label, filename: `${source}-capture.jpg` });
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
              {cameraDiagnostic && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {cameraDiagnostic.message}
                </div>
              )}
              {tvsDeviceId ? (
                <Button
                  variant="outline"
                  onClick={() => startCameraStream("tvs", tvsDeviceId)}
                  className="h-14 justify-start gap-3 border-primary/30 bg-primary/5 hover:bg-primary/10"
                >
                  <ScanLine size={20} className="text-primary shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Scan with TVS PDS 8M</div>
                    <div className="text-[10px] text-muted-foreground">Preferred device — {tvsDeviceLabel || "configured"}</div>
                  </div>
                </Button>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground">
                  TVS PDS 8M not configured on this workstation yet. An admin can bind it in{" "}
                  <a href="/settings/scanner" className="text-primary underline">Scanner Settings</a>.
                </div>
              )}

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
                <Button variant="outline" onClick={() => startCameraStream("webcam")} className="h-14 justify-start gap-3 hover:bg-muted/40">
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
                <Button type="button" onClick={() => captureFrame("webcam")} className="flex-1 gap-1.5">
                  <Camera size={15} /> Capture
                </Button>
                <Button type="button" variant="outline" onClick={() => { stopWebcam(); setMode("select"); }}>
                  <X size={15} />
                </Button>
              </div>
            </div>
          )}

          {mode === "tvs" && (
            <div className="space-y-2 pt-2">
              <div className="relative rounded-lg overflow-hidden bg-black">
                <video ref={videoRef} className="w-full" playsInline muted />
                <PlacementGuideOverlay shape={docType === "bill" || docType === "bank-statement" ? "a4" : "id-card"} blurScore={blurScore} />
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2">
                <Button type="button" onClick={() => captureFrame("tvs")} className="flex-1 gap-1.5">
                  <Camera size={15} /> Capture{blurScore !== null && blurScore < BLUR_WARNING_THRESHOLD ? " anyway" : ""}
                </Button>
                <Button type="button" variant="outline" onClick={() => { stopWebcam(); setMode("select"); }}>
                  <X size={15} />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">Fixed-focus camera — hold steady until the guide turns green.</p>
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
