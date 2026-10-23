/**
 * SmartDictationPanel — the hybrid dictation surface for the six MRI
 * examinations (Task 15, Part E).
 *
 * Hybrid v1 (owner-approved 2026-10-23): dictate continuously, compose on
 * command. Typed lines and completed voice captures STAGE on screen with
 * zero model calls — plain text, instant — and ONE Compose press sends the
 * whole staged batch to the composer. The conversation then reads like a
 * chat: each Compose turn shows what the composer recognised, and ONE
 * consolidated preview carries everything until the radiologist presses
 * Apply. After Apply the panel stays open for conversational corrections
 * — "remove ligamentum flavum hypertrophy", "make L4-L5 narrowing moderate
 * on the left" — which stage, compose, preview and apply in the same
 * single-batch flow against the live report.
 *
 * Pure presentation over the useSmartDictation hook. No workflow logic here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Mic, Send, X, Check, Loader2, Trash2, AlertTriangle, Shield,
  Sparkles, MessageSquareText, RotateCcw,
} from "lucide-react";
import type { useSmartDictation } from "@/hooks/useSmartDictation";

type SmartDictationVm = ReturnType<typeof useSmartDictation>;

export default function SmartDictationPanel({
  vm,
  open,
  onOpenChange,
  studyRegion,
  examLabel,
  /** Live voice-session transcript routed in by the workspace (whisper/STT). */
  liveTranscript,
  onLiveTranscriptConsumed,
  micSupported,
  micListening,
  onMicToggle,
}: {
  vm: SmartDictationVm;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studyRegion: string | null;
  examLabel: string;
  liveTranscript?: string;
  onLiveTranscriptConsumed?: () => void;
  micSupported?: boolean;
  micListening?: boolean;
  onMicToggle?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const session = vm.session;

  // Consume a completed live voice transcript into the STAGING buffer —
  // instant display, no inference. Staging during an in-flight Compose is
  // welcome: continuous dictation never blocks on the model.
  useEffect(() => {
    const t = (liveTranscript ?? "").trim();
    if (!open || !t) return;
    onLiveTranscriptConsumed?.();
    vm.stageDictation(t);
    // Only fire when a NEW transcript lands; vm identity churn must not re-send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, liveTranscript]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [session.turns.length, vm.composing]);

  const transcriptCount = useMemo(
    () => session.turns.filter((t) => t.status === "accepted").length,
    [session.turns],
  );

  function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    // Hybrid v1: a typed line STAGES like a spoken one — the model is only
    // called when the radiologist presses Compose.
    vm.stageDictation(text);
  }

  const preview = vm.preview;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[460px] p-0 flex flex-col" data-testid="smart-dictation-panel">
        <SheetHeader className="border-b px-4 py-3 space-y-1">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Sparkles size={14} className="text-violet-500" />
            Smart Dictation
          </SheetTitle>
          <SheetDescription className="text-[11px] leading-snug">
            {examLabel}
            {studyRegion ? ` · ${studyRegion}` : ""} — dictate continuously; words appear here
            instantly (no AI call while you speak). Press Compose when you finish a segment;
            nothing is written to the report until you press Apply.
          </SheetDescription>
        </SheetHeader>

        {/* ── Conversation ─────────────────────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-muted/20" data-testid="smart-dictation-thread">
          {session.turns.length === 0 && (
            <div className="text-[11px] text-muted-foreground space-y-2 pt-6">
              <MessageSquareText size={18} className="mx-auto opacity-40" />
              <p className="text-center">
                Dictate one or several findings, e.g.
              </p>
              <p className="italic text-center opacity-80">
                “Disc desiccation at L3-4 and L4-5, diffuse disc bulge at L4-5, and ligamentum
                flavum hypertrophy at L4-5.”
              </p>
              <p className="text-center">
                Then correct conversationally —
                <span className="italic"> “make L4-L5 narrowing moderate on the left”</span> or
                <span className="italic"> “remove ligamentum flavum hypertrophy.”</span>
              </p>
            </div>
          )}

          {session.turns.map((turn) => (
            <div key={turn.n} className="space-y-1" data-testid={`smart-dictation-turn-${turn.n}`}>
              {/* Radiologist bubble */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary text-primary-foreground px-3 py-1.5 text-[11px] leading-relaxed">
                  {turn.transcript}
                </div>
              </div>
              {/* Composer reply */}
              <div className="flex justify-start">
                <div
                  className={`max-w-[85%] rounded-xl rounded-bl-sm border px-3 py-1.5 text-[11px] leading-relaxed ${
                    turn.status === "accepted"
                      ? "bg-background"
                      : turn.status === "clarification"
                        ? "bg-amber-50 border-amber-200 text-amber-900"
                        : "bg-red-50 border-red-200 text-red-800"
                  }`}
                >
                  {turn.status === "accepted" ? (
                    <ul className="space-y-0.5">
                      {turn.summary?.map((line, i) => (
                        <li key={i} className={line.startsWith("Removed") ? "text-muted-foreground line-through" : ""}>
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="space-y-1">
                      <span>{turn.note}</span>
                      {/* Teach-the-dictionary hint: an unrecognized finding is a
                          vocabulary gap the doctor can close from Settings, not
                          a dead end. */}
                      {turn.status === "clarification" && /nothing matching|could not resolve|not recognise|not recognize/i.test(turn.note ?? "") && (
                        <p className="text-[10px] text-muted-foreground">
                          New finding? Teach it once under{" "}
                          <span className="font-medium">Settings → Radiology → Voice → Smart Dictation findings</span>{" "}
                          and dictation recognises it from the next turn.
                        </p>
                      )}
                    </div>
                  )}
                  {turn.phraseFallback && (
                    <div className="mt-1 text-[9px] text-muted-foreground">phrase catalog</div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {vm.composing && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground" data-testid="smart-dictation-composing">
              <Loader2 size={12} className="animate-spin" /> Composing…
            </div>
          )}
        </div>

        {/* ── Consolidated preview ────────────────────────────────────────── */}
        {vm.hasPending && preview != null && (
          <div className="border-t px-4 py-3 space-y-2 text-[11px]" data-testid="smart-dictation-preview">
            <div className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground flex items-center gap-1">
              <Shield size={11} />
              {`Consolidated preview (${vm.pendingCount} pending)`}
            </div>

            {preview.adds.length > 0 && (
              <div>
                <span className="font-semibold text-emerald-700">WILL ADD</span>
                <ul className="mt-0.5 space-y-0.5">
                  {preview.adds.map((a, i) => (
                    <li key={i} className="flex gap-1">
                      <Check size={10} className="text-emerald-600 shrink-0 mt-0.5" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.removes.length > 0 && (
              <div>
                <span className="font-semibold text-amber-800">WILL RETIRE</span>
                <ul className="mt-0.5 space-y-0.5">
                  {preview.removes.map((r, i) => (
                    <li key={i} className="flex gap-1 text-amber-800/80">
                      <X size={10} className="shrink-0 mt-0.5" />
                      <span className="line-through">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.impression && (
              <div>
                <span className="font-semibold text-violet-800">IMPRESSION</span>
                <p className="text-muted-foreground">+ {preview.impression}</p>
              </div>
            )}

            {vm.session.pendingRemovals.size > 0 && (
              <div>
                <span className="font-semibold text-amber-800">WILL REMOVE (from the report)</span>
                <ul className="mt-0.5 space-y-0.5">
                  {[...vm.session.pendingRemovals.values()].map((o) => (
                    <li key={o.id} className="flex gap-1 text-amber-800/80">
                      <X size={10} className="shrink-0 mt-0.5" />
                      <span className="line-through">{o.findingsText}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview?.hasConflicts && (
              <div className="bg-red-50 border border-red-200 rounded p-2 text-red-800" data-testid="smart-dictation-conflicts">
                <span className="font-semibold flex items-center gap-1">
                  <AlertTriangle size={10} /> MANUAL / QUICK SELECT CONFLICT
                </span>
                <ul className="mt-0.5 space-y-0.5">
                  {preview.conflicts.map((c, i) => (
                    <li key={i} className="truncate">{c}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px]">Apply will require explicit confirmation.</p>
              </div>
            )}

            <div className="flex gap-1.5 pt-1">
              <Button
                size="sm"
                className="h-7 text-[11px] gap-1 flex-1"
                data-testid="smart-dictation-apply"
                disabled={vm.composing}
                onClick={() => vm.applyAll(preview?.hasConflicts ?? false)}
              >
                <Check size={12} />
                {preview?.hasConflicts ? "Confirm apply" : "Apply all"}
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                data-testid="smart-dictation-discard"
                onClick={() => vm.discardSession()}
              >
                <Trash2 size={12} /> Discard
              </Button>
            </div>
          </div>
        )}

        {/* ── Error + retry ────────────────────────────────────────────────── */}
        {vm.error && !vm.composing && (
          <div className="flex items-center gap-2 border-t bg-amber-50 px-4 py-2 text-[11px] text-amber-900" data-testid="smart-dictation-error">
            <span className="flex-1">{vm.error}</span>
            {/* The dictated words are preserved in the thread above; Retry
                re-sends them — the radiologist never dictates twice. */}
            {vm.canRetryLast && (
              <Button
                size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                data-testid="smart-dictation-retry"
                onClick={() => vm.retryLastTurn()}
              >
                <RotateCcw size={10} /> Retry
              </Button>
            )}
            {vm.phraseFallbackAvailable && (
              <Button
                size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                data-testid="smart-dictation-phrase-retry"
                onClick={() => vm.retryWithPhraseFallback()}
              >
                <RotateCcw size={10} /> Phrase catalog
              </Button>
            )}
          </div>
        )}

        {/* ── Staged dictation — the hybrid buffer (zero AI while speaking) ── */}
        {vm.staged.trim() && (
          <div className="border-t border-dashed px-4 py-3 space-y-1.5" data-testid="smart-dictation-staged">
            <div className="flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wide text-[10px] text-violet-700 flex items-center gap-1">
                <Mic size={11} className={micListening ? "animate-pulse" : ""} />
                {`Dictating — ${vm.stagedWords} word${vm.stagedWords === 1 ? "" : "s"} (no AI call yet)`}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                data-testid="smart-dictation-staged-clear"
                onClick={() => vm.discardStaged()}
                title="Clear the staged words without composing"
              >
                <X size={12} />
              </button>
            </div>
            <p className="italic text-muted-foreground text-[11px] leading-relaxed line-clamp-6">
              {vm.staged}
            </p>
            <p className="text-[9px] text-muted-foreground">
              Press Compose when you finish speaking — one AI call for everything above.
            </p>
          </div>
        )}

        {/* ── Composer input ───────────────────────────────────────── */}
        <div className="border-t px-4 py-3 space-y-2">
          <div className="flex items-end gap-1.5">
            <textarea
              className="flex-1 min-h-[44px] max-h-[120px] resize-y rounded-lg border bg-background px-2.5 py-2 text-[11px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Dictate or type findings — they accumulate above; press Compose when done… (Enter to add, Shift+Enter for a new line)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              data-testid="smart-dictation-input"
              disabled={vm.composing}
            />
            {micSupported !== false && (
              <Button
                size="sm"
                variant={micListening ? "destructive" : "outline"}
                className="h-8 w-8 p-0"
                data-testid="smart-dictation-mic"
                onClick={() => onMicToggle?.()}
                title={micListening ? "Stop listening" : "Dictate by voice"}
              >
                {micListening ? <Mic size={13} className="animate-pulse" /> : <Mic size={13} />}
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 w-8 p-0"
              data-testid="smart-dictation-send"
              disabled={!draft.trim()}
              onClick={submit}
              title="Add to the staged dictation"
            >
              <Send size={13} />
            </Button>
          </div>
          {/* THE hybrid action: one model call for everything staged. */}
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-8 flex-1 gap-1.5 text-[11px]"
              data-testid="smart-dictation-compose"
              disabled={!vm.staged.trim() || vm.composing}
              onClick={() => vm.composeStaged()}
              title="Send everything dictated so far to the composer in ONE call"
            >
              {vm.composing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} className="text-violet-500" />
              )}
              {vm.composing
                ? "Composing…"
                : vm.stagedWords > 0
                  ? `Compose (${vm.stagedWords} words)`
                  : "Compose"}
            </Button>
          </div>
          <div className="text-[9px] text-muted-foreground leading-snug">
            Words accumulate while you speak — the AI runs only when you press Compose, and
            nothing is invented: dictated phrases map onto your own Quick Select wording.
            Clinician-owned text, measurements and patient identity are never touched.
            {transcriptCount > 0 ? ` ${transcriptCount} compose turn${transcriptCount > 1 ? "s" : ""} this session.` : ""}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
