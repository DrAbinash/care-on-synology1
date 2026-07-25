/**
 * IdScanCapturePanel — the compact inline ID-capture surface for Form F.
 *
 * A single self-explaining panel: a live scanner-status header with the method
 * switch (Webcam / Existing Scanner / Mobile / Upload) on the same row, then a
 * two-column body — per-side capture tiles for the active method on the left and
 * a drag-&-drop upload with Front/Back targets on the right — over a compact
 * footer.
 *
 * It owns only presentation + status. Every actual capture is delegated to the
 * shared, already-tested {@link UnifiedScanCapture} engine via its
 * `renderTrigger` + `autoStart` props, so the capture mechanics (webcam stream,
 * TVS device, scanner bridge, mobile QR, upload, blur/disconnect handling) and
 * the `onCapture(result)` contract are unchanged — the result still flows to
 * Form F's existing handler, crop/enhance editor and OCR.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Camera, ScanLine, Upload, Settings2, CheckCircle2, ChevronRight,
  Sparkles, FolderOpen, UploadCloud, Smartphone,
} from "lucide-react";
import UnifiedScanCapture, { type ScanCaptureResult, type ScanSource, type ScanSide } from "@/components/UnifiedScanCapture";
import ScannerSetupHelp from "@/components/ScannerSetupHelp";
import { checkScanBridgeHealth, type ScanBridgeState } from "@/lib/scanBridgeClient";
import { getPreferredTvsDeviceId, getPreferredTvsDeviceLabel } from "@/lib/tvsDeviceProfile";
import { isSecureCameraContext } from "@/lib/cameraDiagnostics";

type CaptureMethod = "camera" | "bridge" | "mobile" | "upload";

const ACCEPTED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB, matches the panel's stated limit

export interface IdScanCapturePanelProps {
  /** Whether a front / back image is already captured (drives the ✓ badges and
   *  which side a bare drag-&-drop is routed to). */
  frontDone: boolean;
  backDone: boolean;
  /** True while a capture is being processed upstream — disables the triggers. */
  busy?: boolean;
  onCapture: (result: ScanCaptureResult) => void;
  onError?: (message: string) => void;
  /** Optional — show a "View saved records" affordance in the footer. */
  onViewSaved?: () => void;
}

export default function IdScanCapturePanel({
  frontDone, backDone, busy = false, onCapture, onError, onViewSaved,
}: IdScanCapturePanelProps) {
  // Primary camera device — a bound TVS PDS 8M if an admin has configured one,
  // otherwise a generic webcam.
  const tvsDeviceId = getPreferredTvsDeviceId();
  const tvsLabel = getPreferredTvsDeviceLabel();
  const cameraIsTvs = !!tvsDeviceId;
  const cameraSource: ScanSource = cameraIsTvs ? "tvs" : "webcam";
  const primaryLabel = cameraIsTvs ? (tvsLabel || "TVS PDS 8M") : "Webcam";
  const cameraReady = isSecureCameraContext();

  // Live scanner-bridge health for the header/tab, polled while mounted.
  const [bridgeState, setBridgeState] = useState<ScanBridgeState>("not-running");
  useEffect(() => {
    let active = true;
    const poll = async () => {
      const h = await checkScanBridgeHealth().catch(() => ({ state: "not-running" as ScanBridgeState }));
      if (active) setBridgeState(h.state);
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { active = false; clearInterval(t); };
  }, []);
  const bridgeOk = bridgeState === "ok";

  const [method, setMethod] = useState<CaptureMethod>(cameraReady ? "camera" : "upload");
  const [dragOver, setDragOver] = useState(false);
  const primaryOnline = method === "bridge" ? bridgeOk : method === "camera" ? cameraReady : true;

  // ── Drag & drop → route to a side (first drop fills Front, next fills Back) ──
  function acceptDroppedFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
      onError?.("Unsupported file type. Use JPG, PNG, WebP, HEIC or PDF.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      onError?.("File is larger than 10 MB. Use a smaller image.");
      return;
    }
    const side: ScanSide = frontDone ? "back" : "front";
    onCapture({ file, mimeType: file.type, source: "upload", filename: file.name, side });
  }

  const tabs: { key: CaptureMethod; label: string; icon: typeof Camera; dot?: boolean }[] = [
    { key: "camera", label: "Webcam", icon: Camera, dot: cameraReady },
    { key: "bridge", label: "Scanner", icon: ScanLine, dot: bridgeOk },
    { key: "mobile", label: "Mobile", icon: Smartphone },
    { key: "upload", label: "Upload", icon: Upload },
  ];

  const showCapture = method !== "upload";
  const captureSource: ScanSource = method === "bridge" ? "bridge" : method === "mobile" ? "mobile" : cameraSource;
  const tileIcon = method === "mobile" ? Smartphone : Camera;
  const tileDisabled = (method === "bridge" && !bridgeOk) || (method === "camera" && !cameraReady);
  const captureLabel = method === "bridge" ? "Existing Scanner" : method === "mobile" ? "Mobile Phone" : primaryLabel;

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50/60 shadow-sm p-3">
      {/* ── Header: status (left) + method switch (right) ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
              <ScanLine size={13} className="text-violet-600" />
            </div>
            <div className="text-[13px] min-w-0 truncate">
              <span className="font-semibold text-gray-800">Primary Scanner: </span>
              <span className="text-gray-600">{primaryLabel}</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${
                primaryOnline
                  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                  : "text-amber-700 bg-amber-50 border-amber-200"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${primaryOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
              {primaryOnline ? "Online" : "Setup"}
            </span>
          </div>
          <div className="flex items-center gap-3 ml-8 mt-0.5">
            <Link href="/settings/scanner" className="inline-flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-700 hover:underline">
              <Settings2 size={11} /> Scanner Settings
            </Link>
            <span className="text-gray-300">·</span>
            <ScannerSetupHelp online={bridgeOk} />
          </div>
        </div>

        <div className="flex gap-1.5 shrink-0">
          {tabs.map((t) => {
            const active = method === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setMethod(t.key)}
                title={t.label}
                className={`relative flex flex-col items-center justify-center gap-0.5 w-[52px] h-[44px] rounded-lg border transition-colors ${
                  active
                    ? "border-violet-300 bg-violet-50 ring-1 ring-violet-200"
                    : "border-gray-200 bg-white hover:border-violet-200 hover:bg-gray-50"
                }`}
              >
                <Icon size={15} className={active ? "text-violet-600" : "text-gray-500"} />
                <span className={`text-[9px] font-medium leading-none ${active ? "text-violet-700" : "text-gray-500"}`}>{t.label}</span>
                {t.dot !== undefined && (
                  <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${t.dot ? "bg-emerald-500" : "bg-gray-300"}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Body: capture (left) + upload (right). Both columns stretch to the
          same height so the drop zone matches the Front/Back tiles. ── */}
      <div className={`grid gap-2.5 mt-2.5 items-stretch ${showCapture ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
        {showCapture && (
          <div className="flex flex-col">
            <SectLabel>Capture with {captureLabel}</SectLabel>
            {tileDisabled ? (
              <p className="flex-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                {method === "bridge"
                  ? "Scanner Bridge not detected — start it, or use Mobile / Upload."
                  : "Webcam needs HTTPS (or localhost) — use Scanner / Mobile / Upload."}
              </p>
            ) : (
              <div className="flex flex-col flex-1">
                {method === "mobile" && (
                  <p className="text-[10px] text-gray-500 mb-1.5">Opens a QR / pings a paired phone — the capture lands here automatically.</p>
                )}
                <div className="grid grid-cols-2 gap-2 flex-1">
                  <SideCaptureTile side="front" title="Front" subtitle="Front side" done={frontDone} busy={busy} disabled={tileDisabled} icon={tileIcon} autoStart={captureSource} onCapture={onCapture} onError={onError} />
                  <SideCaptureTile side="back" title="Back" subtitle="Back side" done={backDone} busy={busy} disabled={tileDisabled} icon={tileIcon} autoStart={captureSource} onCapture={onCapture} onError={onError} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col">
          <SectLabel>{showCapture ? "Or upload from device" : "Upload from device"}</SectLabel>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptDroppedFile(e.dataTransfer.files?.[0]); }}
            className={`flex flex-1 items-center gap-2.5 rounded-lg border-2 border-dashed px-2.5 py-2 transition-colors ${
              dragOver ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-white"
            }`}
          >
            <div className="w-8 h-8 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
              <UploadCloud size={16} className="text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-gray-700 leading-tight truncate">Drag &amp; drop or use buttons</div>
              <div className="text-[9px] text-gray-400 leading-tight truncate">JPG, PNG, PDF · Max 10 MB</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <UploadTile side="front" label="Front" busy={busy} onCapture={onCapture} onError={onError} />
              <UploadTile side="back" label="Back" busy={busy} onCapture={onCapture} onError={onError} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-gray-100 flex-wrap">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <Sparkles size={11} className="text-violet-500 shrink-0" />
          Scans are auto-cropped, enhanced &amp; saved to Form F.
        </div>
        {onViewSaved && (
          <button type="button" onClick={onViewSaved} className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-700 hover:underline">
            <FolderOpen size={11} /> View saved records
          </button>
        )}
      </div>
    </div>
  );
}

/** Compact uppercase section label with the violet dot marker. */
function SectLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
      {children}
    </div>
  );
}

/** A compact per-side capture tile for the active camera / scanner / mobile method. */
function SideCaptureTile({
  side, title, subtitle, done, busy, disabled, autoStart, icon: Icon, onCapture, onError,
}: {
  side: ScanSide;
  title: string;
  subtitle: string;
  done: boolean;
  busy: boolean;
  disabled: boolean;
  autoStart: ScanSource;
  icon: typeof Camera;
  onCapture: (r: ScanCaptureResult) => void;
  onError?: (m: string) => void;
}) {
  return (
    <UnifiedScanCapture
      module="form-f"
      docType="id-card"
      side={side}
      autoStart={autoStart}
      onCapture={onCapture}
      onError={onError}
      renderTrigger={(launch) => (
        <button
          type="button"
          onClick={launch}
          disabled={busy || disabled}
          className={`group w-full h-full flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            done
              ? "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300"
              : "border-gray-200 bg-white hover:border-violet-300 hover:bg-violet-50/50 hover:shadow-sm"
          }`}
        >
          <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${done ? "bg-emerald-100" : "bg-violet-100 group-hover:bg-violet-200"}`}>
            {done ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Icon size={15} className="text-violet-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[13px] font-semibold leading-tight ${done ? "text-emerald-800" : "text-gray-800"}`}>
              {title}{done ? " ✓" : ""}
            </div>
            <div className="text-[10px] text-gray-500 leading-tight">{done ? "Tap to retake" : subtitle}</div>
          </div>
          <ChevronRight size={14} className="text-gray-300 group-hover:text-violet-400 shrink-0" />
        </button>
      )}
    />
  );
}

/** A compact Front/Back upload button beside the drop zone. */
function UploadTile({
  side, label, busy, onCapture, onError,
}: {
  side: ScanSide;
  label: string;
  busy: boolean;
  onCapture: (r: ScanCaptureResult) => void;
  onError?: (m: string) => void;
}) {
  return (
    <UnifiedScanCapture
      module="form-f"
      docType="id-card"
      side={side}
      autoStart="upload"
      onCapture={onCapture}
      onError={onError}
      renderTrigger={(launch) => (
        <button
          type="button"
          onClick={launch}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload size={12} /> {label}
        </button>
      )}
    />
  );
}
