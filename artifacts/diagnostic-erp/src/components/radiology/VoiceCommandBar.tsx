/**
 * VoiceCommandBar — Ticket M1.6B2 Phase 8: the minimal voice controls for the
 * canonical Reporting Workspace. Pure presentation over useVoiceSession —
 * every action goes through the session (which executes via the workspace
 * adapter → M1.5 dispatcher). No workflow logic here.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Mic, MicOff, Radio, HelpCircle, X, Check, Undo2, AlertTriangle, Loader2, Infinity as InfinityIcon, Moon,
} from "lucide-react";
import type { VoiceSession } from "@/hooks/useVoiceSession";
import type { VoiceSafetyClass } from "@/lib/voiceSafetyPolicy";

const SAFETY_CHIP: Record<VoiceSafetyClass, { label: string; cls: string }> = {
  SAFE_IMMEDIATE: { label: "safe", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  REVERSIBLE_EDIT: { label: "edit", cls: "bg-blue-50 text-blue-800 border-blue-300" },
  CONFIRM_REQUIRED: { label: "confirm required", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  HIGH_RISK: { label: "HIGH RISK", cls: "bg-red-50 text-red-800 border-red-300" },
};

export default function VoiceCommandBar({
  voice,
  embedded = false,
}: {
  voice: VoiceSession;
  /** Render controls inline (no second full-width toolbar row). */
  embedded?: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);

  const statusText = !voice.enabled
    ? "Voice unavailable"
    : voice.trouble
      ? voice.trouble.kind === "permission" ? "Mic permission denied"
        : voice.trouble.kind === "offline" ? "Offline"
        : "Error"
      : voice.phase === "listening" ? "Listening…"
      : voice.phase === "processing" ? "Processing…"
      : "Ready";

  const statusCls = !voice.enabled || voice.trouble
    ? "bg-red-50 text-red-800 border-red-300"
    : voice.phase === "listening" ? "bg-green-100 text-green-800 border-green-300"
    : voice.phase === "processing" ? "bg-blue-50 text-blue-800 border-blue-300"
    : "bg-slate-100 text-slate-700 border-slate-300";

  const controls = (
      <div className={`flex items-center gap-1 ${embedded ? "min-w-0" : "gap-1.5 px-3 py-1 flex-wrap"}`}>
        {!embedded && <Mic size={12} className="text-muted-foreground shrink-0" />}
        {/* Push-to-talk: hold with the pointer (or hold Space outside editors) */}
        <Button
          size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-1.5 select-none shrink-0"
          data-testid="voice-ptt"
          disabled={!voice.enabled}
          onPointerDown={(e) => { e.preventDefault(); voice.startListening("ptt"); }}
          onPointerUp={() => { if (voice.captureTrigger === "ptt") voice.stopListening(); }}
          onPointerLeave={() => { if (voice.captureTrigger === "ptt") voice.stopListening(); }}
          title="Hold to talk (or hold Space outside a text field)"
        >
          <Radio size={11} /> Hold
        </Button>
        {/* Toggle listen (Ctrl+Space) */}
        <Button
          size="sm" variant={voice.capturing && !voice.handsFree ? "destructive" : "outline"}
          className="h-6 text-[10px] gap-1 px-1.5 shrink-0"
          data-testid="voice-toggle"
          disabled={!voice.enabled || voice.handsFree}
          onClick={() => voice.toggleListening()}
          title="Toggle listening (Ctrl+Space); Esc cancels"
        >
          {voice.capturing && !voice.handsFree ? <MicOff size={11} /> : <Mic size={11} />}
          {voice.capturing && !voice.handsFree ? "Stop" : "Listen"}
        </Button>
        {/* M1.6B3 — hands-free continuous session (wake/sleep phrases) */}
        <Button
          size="sm" variant={voice.handsFree ? "destructive" : "outline"}
          className="h-6 text-[10px] gap-1 px-1.5 shrink-0"
          data-testid="voice-handsfree"
          disabled={!voice.enabled || (!voice.handsFree && !voice.handsFreeCapable)}
          onClick={() => voice.toggleHandsFree()}
          title={voice.handsFreeCapable || voice.handsFree
            ? "Hands-free: listen continuously; say “go to sleep”/“wake up” to pause/resume, “cancel” to exit"
            : "Hands-free needs a provider with live utterances (browser speech, or enable live segmented transcription for server/local)"}
        >
          <InfinityIcon size={11} /> <span className={embedded ? "hidden xl:inline" : undefined}>{voice.handsFree ? "End hands-free" : "Hands-free"}</span>
        </Button>
        {voice.handsFree && voice.asleep && (
          <span data-testid="voice-asleep" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] font-semibold bg-slate-100 text-slate-700 border-slate-300 shrink-0">
            <Moon size={9} /> Asleep
          </span>
        )}
        {/* Listening / provider status — always truthful */}
        <span
          data-testid="voice-status"
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] font-semibold shrink-0 ${statusCls}`}
          title={voice.providerLabel}
        >
          {voice.phase === "listening" && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-600" />
            </span>
          )}
          {voice.phase === "processing" && <Loader2 size={9} className="animate-spin" />}
          {statusText}
        </span>
        {!embedded && (
          <span className="text-muted-foreground text-[10px]" data-testid="voice-provider">{voice.providerLabel}</span>
        )}
        {/* Command vs dictation mode + dictation target */}
        <select
          className="h-6 text-[10px] border rounded-md px-1 bg-background text-muted-foreground shrink-0"
          data-testid="voice-mode"
          value={voice.mode}
          onChange={(e) => voice.setMode(e.target.value === "dictation" ? "dictation" : "command")}
          disabled={!voice.enabled}
          title="Command mode parses commands; Dictation mode inserts the whole utterance as text (previewed first)"
        >
          <option value="command">Commands</option>
          <option value="dictation">Dictate</option>
        </select>
        {voice.mode === "dictation" && (
          <select
            className="h-6 text-[10px] border rounded-md px-1 bg-background text-muted-foreground shrink-0"
            data-testid="voice-dictation-target"
            value={voice.dictationTarget}
            onChange={(e) => voice.setDictationTarget(e.target.value as typeof voice.dictationTarget)}
            title="Where dictated text is appended"
          >
            <option value="findings">→ Findings</option>
            <option value="impression">→ Impression</option>
            <option value="recommendation">→ Recommendation</option>
          </select>
        )}
        {/* Live transcript — fills remaining space instead of leaving a dead gap */}
        <span className={`text-muted-foreground italic truncate ${embedded ? "flex-1 min-w-[4rem] max-w-[18rem]" : "max-w-[280px]"}`} data-testid="voice-transcript">
          {voice.interim || voice.lastTranscript || ""}
        </span>
        {voice.feedback && (
          <span className="text-[10px] shrink-0" data-testid="voice-feedback">{voice.feedback}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {voice.undoAvailable && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-1.5"
              data-testid="voice-undo" onClick={() => voice.undoLast()} title={`Undo ${voice.undoLabel ?? ""}`}>
              <Undo2 size={11} /> Undo
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" data-testid="voice-help"
            onClick={() => setHelpOpen((v) => !v)} title="Supported voice commands">
            <HelpCircle size={12} />
          </Button>
        </div>
      </div>
  );

  const extras = (
    <>
      {/* Recognition/permission trouble — retry, never block keyboard/mouse */}
      {voice.trouble && (
        <div className="flex items-center gap-2 px-3 py-1 bg-red-50 border-t border-red-200 text-red-800" data-testid="voice-trouble">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="flex-1">{voice.trouble.message} Keyboard and mouse keep working normally.</span>
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => voice.startListening("toggle")}>
            Retry
          </Button>
        </div>
      )}

      {/* Interpreted-command preview: confirm/cancel gate (Phase 6/7) */}
      {voice.pending && (
        <div className="flex flex-col gap-1.5 px-3 py-2 border-t bg-background" data-testid="voice-preview">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground">Heard:</span>
            <span className="italic">“{voice.pending.parse.rawTranscript}”</span>
            {voice.pending.parse.intent && (
              <>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold" data-testid="voice-pending-intent">
                  {voice.describeIntent(voice.pending.parse.intent)}
                </span>
                <span className={`text-[9px] font-semibold rounded-full px-1.5 py-0.5 border ${SAFETY_CHIP[voice.pending.verdict.safetyClass].cls}`}>
                  {SAFETY_CHIP[voice.pending.verdict.safetyClass].label}
                </span>
              </>
            )}
          </div>
          {voice.pending.verdict.blocked ? (
            <div className="flex items-center gap-2">
              <AlertTriangle size={12} className="text-red-700 shrink-0" />
              <span className="text-red-700" data-testid="voice-blocked-reason">{voice.pending.verdict.blocked}</span>
            </div>
          ) : null}
          {voice.pending.parse.parseErrors.length > 0 && (
            <div className="text-amber-800">{voice.pending.parse.parseErrors.join(" · ")}</div>
          )}
          {voice.pending.parse.alternatives.length > 0 && !voice.pending.parse.intent && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-muted-foreground">Did you mean:</span>
              {voice.pending.parse.alternatives.slice(0, 3).map((alt, i) => (
                <Button key={alt} size="sm" variant="outline" className="h-6 text-[10px]"
                  data-testid={`voice-alt-${i}`} onClick={() => voice.chooseAlternative(alt)}>
                  {alt}
                </Button>
              ))}
            </div>
          )}
          {voice.pending.editableText != null && !voice.pending.verdict.blocked && (
            <textarea
              className="w-full min-h-[52px] resize-y rounded-md border bg-background text-xs p-2"
              data-testid="voice-pending-text"
              value={voice.pending.editableText}
              onChange={(e) => voice.updatePendingText(e.target.value)}
              placeholder="Edit the dictated text before inserting…"
            />
          )}
          <div className="flex items-center gap-2">
            {!voice.pending.verdict.blocked && voice.pending.parse.intent && (
              <Button size="sm" className="h-6 text-[10px] gap-1" data-testid="voice-confirm"
                onClick={() => voice.confirmPending("click")}>
                <Check size={11} />
                Confirm{voice.pending.verdict.safetyClass === "HIGH_RISK" ? " (existing finalize confirmation still follows)" : ""}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" data-testid="voice-cancel"
              onClick={() => voice.cancel()}>
              <X size={11} /> Cancel{voice.pending.verdict.confirmViaEnterAllowed ? "" : ""} (Esc)
            </Button>
            {voice.pending.verdict.confirmViaEnterAllowed && !voice.pending.verdict.blocked && (
              <span className="text-[10px] text-muted-foreground">Enter confirms</span>
            )}
            {voice.pending.verdict.safetyClass === "HIGH_RISK" && !voice.pending.verdict.blocked && (
              <span className="text-[10px] text-red-700 font-semibold">Voice alone never finalizes — click Confirm, then the standard finalize confirmation runs.</span>
            )}
          </div>
        </div>
      )}

      {/* Help popover — the grammar, straight from the parser */}
      {helpOpen && (
        <div className="px-3 py-2 border-t bg-background max-h-[220px] overflow-y-auto" data-testid="voice-help-panel">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
            {voice.help.map((group) => (
              <div key={group.category}>
                <div className="font-semibold text-[10px] uppercase text-muted-foreground mt-1">{group.category}</div>
                {group.examples.map((ex) => (
                  <div key={ex} className="text-[10px]">{ex}</div>
                ))}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">
            Hold Space (outside a text field) or the Hold button to talk · Ctrl+Space toggles listening · Esc cancels ·
            Enter or a spoken “confirm” applies non-finalize previews · Hands-free listens continuously with
            “go to sleep”/“wake up”. Voice never bypasses locks, permissions or confirmations.
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="min-w-0 flex-1 flex flex-col" data-testid="voice-bar">
        {controls}
        {extras}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b bg-muted/10 text-[11px]" data-testid="voice-bar">
      {controls}
      {extras}
    </div>
  );
}
