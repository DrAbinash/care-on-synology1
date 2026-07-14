/**
 * PlacementGuideOverlay.tsx — framing guide for fixed-focus camera capture
 * (TVS PDS 8M, and generic webcams used the same way). Since these devices
 * have no autofocus, staff need a visual cue for the correct distance/
 * framing, plus a live sharpness indicator so a blurry capture is caught
 * BEFORE upload/OCR rather than discovered after the fact.
 *
 * This is a presentational overlay only — it does not touch the
 * MediaStream; the parent component owns the <video> element and passes a
 * live blur score in.
 */
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { BLUR_WARNING_THRESHOLD } from "@/lib/tvsDeviceProfile";

export type GuideShape = "id-card" | "a4";

export interface PlacementGuideOverlayProps {
  shape: GuideShape;
  blurScore: number | null;
}

export default function PlacementGuideOverlay({ shape, blurScore }: PlacementGuideOverlayProps) {
  const isSharp = blurScore !== null && blurScore >= BLUR_WARNING_THRESHOLD;
  const guideBoxClass =
    shape === "id-card"
      ? "w-[68%] aspect-[1.586/1]" // ID-1 card ratio (Aadhaar/PAN)
      : "w-[78%] aspect-[210/297]"; // A4 portrait ratio

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div
        className={`border-2 border-dashed rounded-lg flex items-center justify-center transition-colors ${guideBoxClass} ${
          blurScore === null ? "border-white/50" : isSharp ? "border-green-400" : "border-amber-400"
        }`}
      >
        <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded-full">
          {shape === "id-card" ? "Align card here" : "Align document here"}
        </span>
      </div>

      {blurScore !== null && (
        <div
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${
            isSharp ? "bg-green-600/90 text-white" : "bg-amber-600/90 text-white"
          }`}
        >
          {isSharp ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {isSharp ? "Sharp — ready to capture" : "Too blurry — move closer to the marked distance and hold steady"}
        </div>
      )}
    </div>
  );
}
