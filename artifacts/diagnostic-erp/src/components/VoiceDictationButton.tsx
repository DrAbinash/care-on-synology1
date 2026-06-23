import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { readStaffSession } from "@/lib/staffSession";

interface Props {
  onInsert: (text: string) => void;
  draftId?: number;
  studyId?: number;
  patientId?: number;
  targetField?: string;
  className?: string;
}

export default function VoiceDictationButton({
  onInsert,
  draftId,
  studyId,
  patientId,
  targetField,
  className,
}: Props) {
  const [listening, setListening] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  function start() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const SR: (new () => any) | undefined =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      win.SpeechRecognition ?? win.webkitSpeechRecognition;

    if (!SR) {
      alert("Voice dictation requires Chrome or Edge.");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const recognition = new SR();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    recognition.lang = "en-IN";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    recognition.continuous = true;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    recognition.interimResults = false;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    recognition.onresult = async (event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += (event.results[i]?.[0]?.transcript ?? "") + " ";
      }
      if (!transcript.trim()) return;

      setCleaning(true);
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
            rawTranscript: transcript,
            draftId,
            studyId,
            patientId,
            targetField,
          }),
        });
        const data = (await res.json()) as { cleanedText?: string };
        onInsert((data.cleanedText ?? transcript.trim()) + " ");
      } catch {
        onInsert(transcript.trim() + " ");
      } finally {
        setCleaning(false);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    recognition.onend = () => { setListening(false); };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    recognition.onerror = () => { setListening(false); };

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={listening ? "destructive" : "outline"}
      className={className}
      onClick={listening ? stop : start}
      title={listening ? "Stop voice dictation" : "Start voice dictation (en-IN)"}
    >
      {cleaning ? (
        <Loader2 size={14} className="animate-spin mr-1" />
      ) : listening ? (
        <MicOff size={14} className="mr-1" />
      ) : (
        <Mic size={14} className="mr-1" />
      )}
      {listening ? "Stop" : "Voice"}
    </Button>
  );
}
