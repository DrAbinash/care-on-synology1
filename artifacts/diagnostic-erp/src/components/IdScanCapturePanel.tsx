/**
 * IdScanCapturePanel — the inline ID-capture surface for Form F.
 *
 * Replaces the two lone "Scan Front" / "Scan Back" buttons with a single,
 * self-explaining panel: a live scanner-status header, a method switcher
 * (Webcam / Existing Scanner / Upload), per-side capture tiles for the active
 * method, and an always-available drag-&-drop upload with Front/Back targets.
 *
 * It owns only presentation + status. Every actual capture is delegated to the
 * shared, already-tested {@link UnifiedScanCapture} engine via its
 * `renderTrigger` + `autoStart` props, so the capture mechanics (webcam stream,
 * TVS device, scanner bridge, upload, mobile, blur/disconnect handling) and the
 * `onCapture(result)` contract are unchanged — the result still flows to Form F's
 * existing handler, crop/enhance editor and OCR.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Camera, ScanLine, Upload, Settings2, CheckCircle2, ChevronRight,
  Sparkles, FolderOpen, UploadCloud,
} from "lucide-react";
import UnifiedScanCapture, { type ScanCaptureResult, type ScanSource, type ScanSide } from "@/components/UnifiedScanCapture";
import { checkScanBridgeHealth, type ScanBridgeState } from "@/lib/scanBridgeClient";
import { getPreferredTvsDeviceId, getPreferredTvsDeviceLabel } from "@/lib/tvsDeviceProfile";
import { isSecureCameraContext } from "@/lib/cameraDiagnostics";

type CaptureMethod = "camera" | "bridge" | "upload";

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

  const methods: { key: CaptureMethod; label: string; sub: string; icon: typeof Camera; dot?: boolean }[] = [
    { key: "camera", label: primaryLabel, sub: "Primary", icon: Camera, dot: cameraReady },
    { key: "bridge", label: "Scanner", sub: "Bridge", icon: ScanLine, dot: bridgeOk },
    { key: "upload", label: "Upload", sub: "If needed", icon: Upload },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50/60 shadow-sm p-3.5">
      {/* ── Status header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
            <ScanLine size={15} className="text-violet-600" />
          </div>
          <div className="text-sm min-w-0 truncate">
            <span className="font-semibold text-gray-800">Primary Scanner: </span>
            <span className="text-gray-600">{primaryLabel}</span>
          </div>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${
              primaryOnline
                ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : "text-amber-700 bg-amber-50 border-amber-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${primaryOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
            {primaryOnline ? "Online" : "Setup needed"}
          </span>
        </div>
        <Link href="/settings/scanner" className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 hover:underline shrink-0">
          <Settings2 size={13} /> Scanner Settings
        </Link>
      </div>

      {/* ── Method switcher ── */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {methods.map((m) => {
          const active = method === m.key;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMethod(m.key)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                active
                  ? "border-violet-300 bg-violet-50 ring-1 ring-violet-200"
                  : "border-gray-200 bg-white hover:border-violet-200 hover:bg-gray-50"
              }`}
            >
              <div className={`relative w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? "bg-violet-100" : "bg-gray-100"}`}>
                <Icon size={15} className={active ? "text-violet-600" : "text-gray-500"} />
                {m.dot !== undefined && (
                  <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${m.dot ? "bg-emerald-500" : "bg-gray-300"}`} />
                )}
              </div>
              <div className="min-w-0">
                <div className={`text-xs font-semibold leading-tight truncate ${active ? "text-violet-800" : "text-gray-700"}`}>{m.label}</div>
                <div className="text-[10px] text-gray-400 leading-tight">{m.sub}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Capture with the active camera / scanner method ── */}
      {method !== "upload" && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            Capture with {method === "bridge" ? "Existing Scanner" : primaryLabel}
          </div>
          {method === "bridge" && !bridgeOk && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-2">
              Scanner Bridge not detected. Start the Scanner Bridge on this workstation, or use Webcam / Upload.
            </p>
          )}
          {method === "camera" && !cameraReady && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-2">
              Webcam capture needs HTTPS (or localhost). Use the Existing Scanner or Upload instead.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <SideCaptureTile
              side="front" title="Front" subtitle="Capture front side"
              done={frontDone} busy={busy}
              disabled={(method === "bridge" && !bridgeOk) || (method === "camera" && !cameraReady)}
              autoStart={method === "bridge" ? "bridge" : cameraSource}
              onCapture={onCapture} onError={onError}
            />
            <SideCaptureTile
              side="back" title="Back" subtitle="Capture back side"
              done={backDone} busy={busy}
              disabled={(method === "bridge" && !bridgeOk) || (method === "camera" && !cameraReady)}
              autoStart={method === "bridge" ? "bridge" : cameraSource}
              onCapture={onCapture} onError={onError}
            />
          </div>
        </div>
      )}

      {/* ── Upload from device (always available) ── */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          {method === "upload" ? "Upload from Device" : "Or upload from device"}
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptDroppedFile(e.dataTransfer.files?.[0]); }}
          className={`flex items-center gap-3 rounded-lg border-2 border-dashed px-3 py-3 transition-colors ${
            dragOver ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-white"
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
            <UploadCloud size={18} className="text-violet-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-700">Drag &amp; drop files here or use buttons</div>
            <div className="text-[10px] text-gray-400">JPG, PNG, PDF · Max 10 MB each</div>
          </div>
          <div className="flex gap-2 shrink-0">
            <UploadTile side="front" label="Front" busy={busy} onCapture={onCapture} onError={onError} />
            <UploadTile side="back" label="Back" busy={busy} onCapture={onCapture} onError={onError} />
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-gray-100 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <Sparkles size={12} className="text-violet-500 shrink-0" />
          Scans are auto-cropped, enhanced &amp; saved to Form F.
        </div>
        {onViewSaved && (
          <button type="button" onClick={onViewSaved} className="flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-700 hover:underline">
            <FolderOpen size={12} /> View saved records
          </button>
        )}
      </div>
    </div>
  );
}

/** A large per-side capture tile for the active camera / scanner method. */
function SideCaptureTile({
  side, title, subtitle, done, busy, disabled, autoStart, onCapture, onError,
}: {
  side: ScanSide;
  title: string;
  subtitle: string;
  done: boolean;
  busy: boolean;
  disabled: boolean;
  autoStart: ScanSource;
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
          className={`group w-full flex items-center gap-2.5 rounded-lg border px-3 py-3 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            done
              ? "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300"
              : "border-gray-200 bg-white hover:border-violet-300 hover:bg-violet-50/50 hover:shadow-sm"
          }`}
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${done ? "bg-emerald-100" : "bg-violet-100 group-hover:bg-violet-200"}`}>
            {done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Camera size={18} className="text-violet-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${done ? "text-emerald-800" : "text-gray-800"}`}>
              {title}{done ? " ✓" : ""}
            </div>
            <div className="text-[11px] text-gray-500 leading-tight">{done ? "Captured — tap to retake" : subtitle}</div>
          </div>
          <ChevronRight size={16} className="text-gray-300 group-hover:text-violet-400 shrink-0" />
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
          className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload size={13} /> {label}
        </button>
      )}
    />
  );
}
