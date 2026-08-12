/**
 * VoiceBar — floating chrome over the Care useVoiceSession pipeline.
 * Replaces the old Z.ai MediaRecorder stub so there is ONE mic path.
 */
import { Mic, MicOff, X, Radio, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceSession } from "@/hooks/useVoiceSession";
import { useWorkspaceSelector } from "@/lib/zai-workspace/store";

export function VoiceBar({ voice }: { voice: VoiceSession }) {
  const show = useWorkspaceSelector((s) => s.showVoiceBar);
  const toggle = useWorkspaceSelector((s) => s.toggleVoiceBar);

  if (!show) return null;

  const listening = voice.capturing && !voice.handsFree;
  const status = !voice.enabled
    ? "Voice unavailable — enable in Radiology Settings"
    : voice.trouble
      ? voice.trouble.message
      : voice.phase === "listening"
        ? `Listening (${voice.providerLabel})…`
        : voice.phase === "processing"
          ? "Processing…"
          : voice.pending
            ? "Confirm pending command ↑"
            : `Ready · ${voice.providerLabel}`;

  return (
    <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2" data-testid="care-voice-float">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border bg-slate-900 pl-3 pr-1.5 py-1.5 shadow-2xl max-w-[min(92vw,42rem)]",
          listening || voice.handsFree ? "border-emerald-400 ring-2 ring-emerald-400/30" : "border-slate-700",
        )}
      >
        <button
          type="button"
          disabled={!voice.enabled}
          onPointerDown={(e) => {
            e.preventDefault();
            if (voice.enabled) voice.startListening("ptt");
          }}
          onPointerUp={() => {
            if (voice.captureTrigger === "ptt") voice.stopListening();
          }}
          onPointerLeave={() => {
            if (voice.captureTrigger === "ptt") voice.stopListening();
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition shrink-0",
            listening ? "bg-rose-500 text-white animate-pulse" : "bg-slate-700 text-slate-300 hover:bg-slate-600",
            !voice.enabled && "opacity-40 cursor-not-allowed",
          )}
          title="Hold to talk (Care voice session)"
        >
          {listening ? <MicOff className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          disabled={!voice.enabled || voice.handsFree}
          onClick={() => voice.toggleListening()}
          className={cn(
            "flex h-7 px-2 items-center justify-center rounded-full text-[10px] font-semibold transition shrink-0",
            listening ? "bg-rose-600 text-white" : "bg-slate-700 text-slate-200 hover:bg-slate-600",
          )}
          title="Toggle listen (Ctrl+Space)"
        >
          <Mic className="h-3 w-3 mr-1" />
          {listening ? "Stop" : "Listen"}
        </button>
        <div className="min-w-[160px] max-w-[28rem] truncate">
          <div className="text-[11px] text-slate-200 truncate">
            {voice.interim || voice.lastTranscript || voice.feedback || (
              <span className="text-slate-400 italic">{status}</span>
            )}
          </div>
        </div>
        {voice.undoAvailable && (
          <button
            type="button"
            className="flex h-6 items-center gap-1 rounded-full px-2 text-[10px] text-amber-300 hover:bg-slate-700"
            onClick={() => voice.undoLast()}
            title={`Undo ${voice.undoLabel ?? "last voice edit"}`}
          >
            <Undo2 className="h-3 w-3" /> Undo
          </button>
        )}
        <button
          type="button"
          onClick={toggle}
          className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-700"
          title="Hide floating voice bar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
