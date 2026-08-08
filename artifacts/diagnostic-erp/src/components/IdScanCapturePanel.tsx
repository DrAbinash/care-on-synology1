/**
 * IdScanCapturePanel — simple Front / Back ID capture for Form F.
 *
 * Two big actions open the shared {@link UnifiedScanCapture} chooser
 * (scanner, upload, webcam, or phone). No method tabs or dual columns —
 * pick a side, then pick how to capture.
 */
import { Link } from "wouter";
import {
  ScanLine, Settings2, CheckCircle2, ChevronRight, IdCard,
} from "lucide-react";
import UnifiedScanCapture, { type ScanCaptureResult, type ScanSide } from "@/components/UnifiedScanCapture";
import ScannerSetupHelp from "@/components/ScannerSetupHelp";
import { useEffect, useState } from "react";
import { checkScanBridgeHealth, type ScanBridgeState } from "@/lib/scanBridgeClient";

export interface IdScanCapturePanelProps {
  frontDone: boolean;
  backDone: boolean;
  busy?: boolean;
  onCapture: (result: ScanCaptureResult) => void;
  onError?: (message: string) => void;
  onViewSaved?: () => void;
  /** Clinic preferred method — highlighted first in the chooser. */
  defaultMethod?: string;
}

function preferredSource(pref: string | undefined): "bridge" | "webcam" | "mobile" | undefined {
  if (pref === "bridge" || pref === "mobile") return pref;
  if (pref === "camera") return "webcam";
  return "bridge";
}

export default function IdScanCapturePanel({
  frontDone, backDone, busy = false, defaultMethod, onCapture, onError, onViewSaved,
}: IdScanCapturePanelProps) {
  const [bridgeOk, setBridgeOk] = useState(false);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      const h = await checkScanBridgeHealth().catch(() => ({ state: "not-running" as ScanBridgeState }));
      if (active) setBridgeOk(h.state === "ok");
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const preferred = preferredSource(defaultMethod);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
            <IdCard size={14} className="text-violet-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 leading-tight">ID Card</div>
            <div className="text-[11px] text-gray-500 leading-tight">Scan, upload, or use webcam — front and back</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          <Link href="/settings?tab=scanner#preferred-scanning-source" className="inline-flex items-center gap-1 text-violet-600 hover:underline">
            <Settings2 size={11} /> Settings
          </Link>
          <span className="text-gray-300">·</span>
          <ScannerSetupHelp online={bridgeOk} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <SideButton
          side="front"
          label="Front"
          done={frontDone}
          busy={busy}
          preferredSource={preferred}
          onCapture={onCapture}
          onError={onError}
        />
        <SideButton
          side="back"
          label="Back"
          done={backDone}
          busy={busy}
          preferredSource={preferred}
          onCapture={onCapture}
          onError={onError}
        />
      </div>

      {onViewSaved && (
        <button
          type="button"
          onClick={onViewSaved}
          className="mt-2 text-[11px] text-violet-600 hover:underline inline-flex items-center gap-1"
        >
          <ScanLine size={11} /> View saved records
        </button>
      )}
    </div>
  );
}

function SideButton({
  side, label, done, busy, preferredSource: preferred, onCapture, onError,
}: {
  side: ScanSide;
  label: string;
  done: boolean;
  busy: boolean;
  preferredSource?: "bridge" | "webcam" | "mobile";
  onCapture: (r: ScanCaptureResult) => void;
  onError?: (m: string) => void;
}) {
  return (
    <UnifiedScanCapture
      module="form-f"
      docType="id-card"
      side={side}
      preferredSource={preferred}
      triggerLabel={`${label} of ID card`}
      onCapture={onCapture}
      onError={onError}
      renderTrigger={(launch) => (
        <button
          type="button"
          onClick={launch}
          disabled={busy}
          className={`group w-full flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            done
              ? "border-emerald-200 bg-emerald-50/80 hover:border-emerald-300"
              : "border-gray-200 bg-gray-50/50 hover:border-violet-300 hover:bg-violet-50/40"
          }`}
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            done ? "bg-emerald-100" : "bg-violet-100 group-hover:bg-violet-200"
          }`}>
            {done
              ? <CheckCircle2 size={18} className="text-emerald-600" />
              : <ScanLine size={18} className="text-violet-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${done ? "text-emerald-900" : "text-gray-900"}`}>
              {label}{done ? " captured" : ""}
            </div>
            <div className="text-[11px] text-gray-500 leading-tight">
              {done ? "Tap to replace" : "Scanner · Upload · Webcam · Phone"}
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-300 group-hover:text-violet-400 shrink-0" />
        </button>
      )}
    />
  );
}
