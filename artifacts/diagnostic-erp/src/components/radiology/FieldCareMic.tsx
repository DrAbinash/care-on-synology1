/**
 * FieldCareMic — per-field shortcut into the ONE Care voice session.
 * Does not open a second microphone; only sets dictation target and listens.
 */
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import type { VoiceSession } from "@/hooks/useVoiceSession";
import type { DictationTarget } from "@/lib/voiceCommandGrammar";

export default function FieldCareMic({
  voice,
  target,
  disabled,
  className,
}: {
  voice: VoiceSession;
  target: DictationTarget;
  disabled?: boolean;
  className?: string;
}) {
  const armed = voice.mode === "dictation" && voice.dictationTarget === target;
  const active = armed && voice.capturing;

  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "destructive" : armed ? "default" : "outline"}
      className={`h-7 px-2 text-[10px] gap-1 shrink-0 ${className ?? ""}`}
      disabled={!voice.enabled || disabled}
      data-testid={`field-care-mic-${target}`}
      title={
        !voice.enabled
          ? "Voice unavailable — enable in Radiology Settings"
          : active
            ? `Stop dictating into ${target}`
            : `Dictate into ${target} (Care voice — preview before insert)`
      }
      onClick={() => {
        if (!voice.enabled) return;
        if (active) {
          voice.stopListening();
          return;
        }
        voice.setMode("dictation");
        voice.setDictationTarget(target);
        voice.startListening("toggle");
        // Bring the unified preview/controls into view.
        document.querySelector("[data-testid='voice-command-bar']")?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }}
    >
      {active ? <MicOff size={12} /> : <Mic size={12} />}
      {active ? "Stop" : "Dictate"}
    </Button>
  );
}
