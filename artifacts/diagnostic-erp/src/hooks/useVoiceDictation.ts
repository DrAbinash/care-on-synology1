import { useState, useRef, useCallback, useEffect } from "react";

export type DictationStatus = "idle" | "listening" | "paused" | "error" | "unsupported";
export type DictationAction = "insert" | "append_findings" | "append_impression" | "replace_selection";

export interface DictationCommand {
  type:
    | "newLine"
    | "newParagraph"
    | "period"
    | "comma"
    | "colon"
    | "goToFindings"
    | "goToImpression"
    | "insertNormal"
    | "insertImpression"
    | "deleteLastSentence"
    | "boldAbnormal"
    | "nextField"
    | "saveDraft"
    | "clearFindings"
    | "endReport"
    | "appendMode"
    | "replaceMode";
  payload?: string;
}

export interface VoiceDictationOptions {
  /** Auto-pause after this many seconds of silence. 0 = disabled. Default: 0 */
  silenceTimeoutSecs?: number;
  /** Recognition language. Default: "en-IN" */
  lang?: string;
}

export interface VoiceDictationHook {
  status: DictationStatus;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  clearTranscript: () => void;
  lastCommand: DictationCommand | null;
}

// ── Command vocabulary ─────────────────────────────────────────────────────────
const COMMAND_MAP: Array<{ pattern: RegExp; command: DictationCommand["type"] }> = [
  { pattern: /^new[- ]?line$/, command: "newLine" },
  { pattern: /^new[- ]?paragraph$/, command: "newParagraph" },
  { pattern: /^(full[- ]?stop|period)$/, command: "period" },
  { pattern: /^comma$/, command: "comma" },
  { pattern: /^colon$/, command: "colon" },
  { pattern: /^findings$/, command: "goToFindings" },
  { pattern: /^impression$/, command: "goToImpression" },
  { pattern: /^(insert|go to) impression$/, command: "insertImpression" },
  { pattern: /^normal study$/, command: "insertNormal" },
  { pattern: /^delete last sentence$/, command: "deleteLastSentence" },
  { pattern: /^bold abnormal$/, command: "boldAbnormal" },
  { pattern: /^next field$/, command: "nextField" },
  { pattern: /^save draft$/, command: "saveDraft" },
  { pattern: /^clear findings$/, command: "clearFindings" },
  { pattern: /^(end report|finish report)$/, command: "endReport" },
  { pattern: /^append mode$/, command: "appendMode" },
  { pattern: /^replace mode$/, command: "replaceMode" },
];

function parseCommand(text: string): DictationCommand | null {
  const normalized = text.toLowerCase().trim();
  for (const { pattern, command } of COMMAND_MAP) {
    if (pattern.test(normalized)) return { type: command };
  }
  return null;
}

// ── Inline text substitutions ─────────────────────────────────────────────────
function applyInlineSubstitutions(text: string): string {
  return text
    // Punctuation
    .replace(/\bnew[- ]?line\b/gi, "\n")
    .replace(/\bnew[- ]?paragraph\b/gi, "\n\n")
    .replace(/\bfull[- ]?stop\b/gi, ".")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bopen[- ]?bracket\b/gi, "(")
    .replace(/\bclose[- ]?bracket\b/gi, ")")
    .replace(/\bopen[- ]?parenthesis\b/gi, "(")
    .replace(/\bclose[- ]?parenthesis\b/gi, ")")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\bsemicolon\b/gi, ";")
    .replace(/\bhyphen\b/gi, "-")
    .replace(/\bdash\b/gi, "—")
    // MRI sequences
    .replace(/\bt[- ]?1[- ]?w\b/gi, "T1W")
    .replace(/\bt[- ]?2[- ]?w\b/gi, "T2W")
    .replace(/\bt[- ]?1\b/gi, "T1")
    .replace(/\bt[- ]?2\b/gi, "T2")
    .replace(/\bflair\b/gi, "FLAIR")
    .replace(/\bdwi\b/gi, "DWI")
    .replace(/\badc\b/gi, "ADC")
    .replace(/\bswi\b/gi, "SWI")
    .replace(/\bgre\b/gi, "GRE")
    .replace(/\bmra\b/gi, "MRA")
    .replace(/\bmri\b/gi, "MRI")
    .replace(/\bct\b/gi, "CT")
    .replace(/\busg\b/gi, "USG")
    .replace(/\bpet\b/gi, "PET")
    // Radiology terms
    .replace(/\bfazekas\b/gi, "Fazekas")
    .replace(/\bhyperintense\b/gi, "hyperintense")
    .replace(/\bhypointense\b/gi, "hypointense")
    .replace(/\bisointense\b/gi, "isointense")
    .replace(/\bhyper[- ]?echoic\b/gi, "hyperechoic")
    .replace(/\bhypo[- ]?echoic\b/gi, "hypoechoic")
    .replace(/\biso[- ]?echoic\b/gi, "isoechoic")
    .replace(/\bthecal sac\b/gi, "thecal sac")
    .replace(/\bforaminal\b/gi, "foraminal")
    .replace(/\blacunar\b/gi, "lacunar")
    .replace(/\bbilateral\b/gi, "bilateral")
    .replace(/\bunilateral\b/gi, "unilateral")
    .replace(/\bposterior fossa\b/gi, "posterior fossa")
    .replace(/\bligamentum flavum\b/gi, "ligamentum flavum")
    // Measurements
    .replace(/\bcentimeter(s)?\b/gi, "cm")
    .replace(/\bmillimeter(s)?\b/gi, "mm")
    // Grades
    .replace(/\bgrade (one|1)\b/gi, "Grade 1")
    .replace(/\bgrade (two|2)\b/gi, "Grade 2")
    .replace(/\bgrade (three|3)\b/gi, "Grade 3")
    .replace(/\bgrade (four|4)\b/gi, "Grade 4");
}

// ─────────────────────────────────────────────────────────────────────────────
export function useVoiceDictation(opts: VoiceDictationOptions = {}): VoiceDictationHook {
  const lang = opts.lang ?? "en-IN";
  const silenceTimeoutSecs = opts.silenceTimeoutSecs ?? 0;

  const [status, setStatus] = useState<DictationStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<DictationCommand | null>(null);

  const recognitionRef = useRef<import("../types/speech").SpeechRecognitionLike | null>(null);
  const pausedRef = useRef(false);
  const stoppedRef = useRef(false); // distinguish user stop vs unexpected end
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // ── Silence timer ──────────────────────────────────────────────────────────
  function resetSilenceTimer(onFire: () => void) {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (silenceTimeoutSecs > 0) {
      silenceTimerRef.current = setTimeout(onFire, silenceTimeoutSecs * 1000);
    }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  // ── Create recognition instance ────────────────────────────────────────────
  const createRecognition = useCallback((): import("../types/speech").SpeechRecognitionLike | null => {
    if (!isSupported) return null;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;
    return recognition;
  }, [isSupported, lang]);

  // ── Result handler ─────────────────────────────────────────────────────────
  const handleResult = useCallback((event: import("../types/speech").SpeechRecognitionEvent) => {
    let finalText = "";
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        const cmd = parseCommand(text);
        if (cmd) {
          setLastCommand(cmd);
          setTimeout(() => setLastCommand(null), 500);
          continue;
        }
        finalText += applyInlineSubstitutions(text) + " ";
      } else {
        interim += text;
      }
    }

    if (finalText) setTranscript((prev) => prev + finalText);
    setInterimTranscript(interim);
  }, []);

  // ── Start ──────────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (!isSupported) {
      setStatus("unsupported");
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (status === "listening") return;

    // Resume from paused
    if (pausedRef.current && recognitionRef.current) {
      pausedRef.current = false;
      stoppedRef.current = false;
      recognitionRef.current.start();
      setStatus("listening");
      return;
    }

    const recognition = createRecognition();
    if (!recognition) return;

    stoppedRef.current = false;

    recognition.onresult = (e: import("../types/speech").SpeechRecognitionEvent) => {
      handleResult(e);
      // Reset silence timer on every result
      resetSilenceTimer(() => {
        // Auto-pause on silence
        pausedRef.current = true;
        recognition.stop();
        setStatus("paused");
        setInterimTranscript("");
      });
    };

    recognition.onerror = (e: import("../types/speech").SpeechRecognitionErrorEvent) => {
      clearSilenceTimer();
      if (e.error === "no-speech") {
        // Trigger silence timer start
        resetSilenceTimer(() => {
          pausedRef.current = true;
          recognition.stop();
          setStatus("paused");
          setInterimTranscript("");
        });
        return;
      }
      setError(`Dictation error: ${e.error}`);
      setStatus("error");
    };

    recognition.onend = () => {
      clearSilenceTimer();
      if (stoppedRef.current || pausedRef.current) return;
      // Unexpected end — auto-restart
      try { recognition.start(); } catch { /* ignore */ }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
    setError(null);
    resetSilenceTimer(() => {
      pausedRef.current = true;
      recognition.stop();
      setStatus("paused");
      setInterimTranscript("");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported, status, createRecognition, handleResult]);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    clearSilenceTimer();
    stoppedRef.current = true;
    pausedRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setStatus("idle");
    setInterimTranscript("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pause ─────────────────────────────────────────────────────────────────
  const pause = useCallback(() => {
    if (recognitionRef.current && status === "listening") {
      clearSilenceTimer();
      pausedRef.current = true;
      recognitionRef.current.stop();
      setStatus("paused");
      setInterimTranscript("");
    }
  }, [status]);

  // ── Resume ────────────────────────────────────────────────────────────────
  const resume = useCallback(() => {
    if (status === "paused") {
      start();
    }
  }, [status, start]);

  // ── Clear ─────────────────────────────────────────────────────────────────
  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status: isSupported ? status : "unsupported",
    transcript,
    interimTranscript,
    error,
    isSupported,
    start,
    stop,
    pause,
    resume,
    clearTranscript,
    lastCommand,
  };
}
