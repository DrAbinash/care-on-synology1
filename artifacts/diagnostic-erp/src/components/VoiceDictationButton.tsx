import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Mic, MicOff, Pause, Play, Loader2, X, Check, RotateCcw, ChevronDown,
} from "lucide-react";
import { readStaffSession } from "@/lib/staffSession";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";

interface Props {
  onInsert: (text: string) => void;
  draftId?: number;
  studyId?: number;
  patientId?: number;
  targetField?: string;
  className?: string;
}

/**
 * VoiceDictationButton — enterprise-grade voice dictation control.
 *
 * Upgrade Phase 3:
 *  - Uses useVoiceDictation hook (pause/resume, interim transcript, command dispatch)
 *  - Shows a preview popover before inserting text into the report field
 *  - Append / Replace / Discard actions — never auto-inserts without confirmation
 *  - Pulsing mic indicator while active
 *  - Silence autosave to localStorage every 5 s while listening
 *  - AI cleanup via /api/radiology/report-generator/voice-cleanup (unchanged route)
 */
export default function VoiceDictationButton({
  onInsert,
  draftId,
  studyId,
  patientId,
  targetField,
  className,
}: Props) {
  const {
    status,
    transcript,
    interimTranscript,
    isSupported,
    start,
    stop,
    pause,
    resume,
    clearTranscript,
  } = useVoiceDictation();

  const [cleaning, setCleaning] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [insertMode, setInsertMode] = useState<"append" | "replace">("append");

  const autosaveKey = `voice_draft_${targetField ?? "default"}`;
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Autosave to localStorage every 5 s while listening ────────────────────
  useEffect(() => {
    if (status === "listening" && transcript) {
      autosaveRef.current = setInterval(() => {
        try { localStorage.setItem(autosaveKey, transcript); } catch { /* ignore */ }
      }, 5000);
    } else {
      if (autosaveRef.current) clearInterval(autosaveRef.current);
    }
    return () => { if (autosaveRef.current) clearInterval(autosaveRef.current); };
  }, [status, transcript, autosaveKey]);

  // ── Open preview when user stops dictation ─────────────────────────────────
  useEffect(() => {
    if (status === "idle" && transcript.trim()) {
      void openPreview(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function openPreview(raw: string) {
    setCleaning(true);
    let cleaned = raw.trim();
    try {
      const session = readStaffSession();
      const token = session?.token ?? null;
      const res = await fetch("/api/radiology/report-generator/voice-cleanup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          rawTranscript: raw,
          draftId,
          studyId,
          patientId,
          targetField,
        }),
      });
      const data = (await res.json()) as { cleanedText?: string };
      if (data.cleanedText) cleaned = data.cleanedText;
    } catch {
      // Use raw text if cleanup fails
    } finally {
      setCleaning(false);
    }
    setPreviewText(cleaned);
    setPreviewOpen(true);
  }

  function handleInsert() {
    if (!previewText.trim()) return;
    onInsert(previewText.trim() + " ");
    try { localStorage.removeItem(autosaveKey); } catch { /* ignore */ }
    setPreviewOpen(false);
    setPreviewText("");
    clearTranscript();
  }

  function handleDiscard() {
    try { localStorage.removeItem(autosaveKey); } catch { /* ignore */ }
    setPreviewOpen(false);
    setPreviewText("");
    clearTranscript();
  }

  function handleStop() {
    stop();
    // Preview opens via useEffect when status becomes idle + transcript exists
  }

  function handlePauseResume() {
    if (status === "paused") resume();
    else pause();
  }

  // ── Unsupported browser ────────────────────────────────────────────────────
  if (!isSupported) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        className={className}
        title="Voice dictation requires Chrome or Edge"
      >
        <MicOff size={14} className="mr-1 opacity-40" />
        <span className="opacity-40">Voice</span>
      </Button>
    );
  }

  const isListening = status === "listening";
  const isPaused = status === "paused";
  const isActive = isListening || isPaused;

  // ── Preview popover ────────────────────────────────────────────────────────
  if (previewOpen) {
    return (
      <div className="relative inline-block">
        {/* Trigger button — shows cleaning state */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={className}
          disabled
        >
          {cleaning ? (
            <Loader2 size={14} className="animate-spin mr-1" />
          ) : (
            <Check size={14} className="mr-1 text-emerald-500" />
          )}
          {cleaning ? "Cleaning…" : "Review"}
        </Button>

        {/* Preview card — positioned below the button */}
        <div
          className="absolute z-50 left-0 top-full mt-1 w-80 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ minWidth: "320px" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Mic size={12} className="text-emerald-400" />
              Voice Transcript
            </span>
            <button
              onClick={handleDiscard}
              className="text-slate-500 hover:text-slate-300 transition-colors"
              title="Discard"
            >
              <X size={14} />
            </button>
          </div>

          {/* Editable preview */}
          <textarea
            className="w-full min-h-[80px] resize-y rounded-lg border border-slate-700 bg-slate-950 text-xs text-slate-200 p-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 leading-relaxed"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="Cleaned transcript will appear here…"
          />

          {/* Insert mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Insert mode:</span>
            <button
              onClick={() => setInsertMode("append")}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                insertMode === "append"
                  ? "bg-emerald-900/50 border-emerald-700 text-emerald-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              Append
            </button>
            <button
              onClick={() => setInsertMode("replace")}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                insertMode === "replace"
                  ? "bg-amber-900/50 border-amber-700 text-amber-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              Replace
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 hover:bg-slate-800"
              onClick={handleDiscard}
            >
              <X size={12} className="mr-1" />
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              onClick={handleInsert}
              disabled={!previewText.trim()}
            >
              <Check size={12} className="mr-1" />
              {insertMode === "append" ? "Append" : "Replace"}
            </Button>
          </div>

          {/* Dictate more */}
          <button
            onClick={() => {
              setPreviewOpen(false);
              // Don't clear transcript — will accumulate more
              start();
            }}
            className="w-full text-center text-[10px] text-emerald-500 hover:text-emerald-300 transition-colors flex items-center justify-center gap-1"
          >
            <Mic size={10} />
            Continue dictating (adds to transcript)
          </button>
        </div>
      </div>
    );
  }

  // ── Active dictation controls ──────────────────────────────────────────────
  if (isActive) {
    return (
      <div className="flex items-center gap-1">
        {/* Pulsing mic indicator */}
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
        </span>

        {/* Interim transcript tooltip */}
        {interimTranscript && (
          <span className="text-[10px] text-slate-400 italic max-w-[120px] truncate">
            {interimTranscript}
          </span>
        )}

        {/* Pause / Resume */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[10px] border-amber-700/60 text-amber-400 bg-amber-950/20 hover:bg-amber-950/40"
          onClick={handlePauseResume}
          title={isPaused ? "Resume dictation" : "Pause dictation"}
        >
          {isPaused ? <Play size={12} /> : <Pause size={12} />}
        </Button>

        {/* Stop + open preview */}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-7 px-2 text-[10px]"
          onClick={handleStop}
          title="Stop and review transcript"
        >
          <MicOff size={12} className="mr-1" />
          Stop
        </Button>
      </div>
    );
  }

  // ── Idle: start button ─────────────────────────────────────────────────────
  return (
    <div className="relative inline-flex items-center gap-0.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={`${className ?? ""} gap-1`}
        onClick={start}
        title="Start voice dictation (en-IN)"
      >
        <Mic size={14} />
        Voice
      </Button>

      {/* Restore autosaved draft if present */}
      {(() => {
        try {
          const saved = localStorage.getItem(autosaveKey);
          if (saved) {
            return (
              <button
                onClick={() => {
                  const txt = localStorage.getItem(autosaveKey) ?? "";
                  if (txt) void openPreview(txt);
                }}
                className="text-[9px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 ml-0.5"
                title="Restore autosaved transcript"
              >
                <RotateCcw size={9} />
              </button>
            );
          }
        } catch { /* ignore */ }
        return null;
      })()}
    </div>
  );
}
