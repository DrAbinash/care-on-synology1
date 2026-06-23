import { useState, useRef, useCallback, useEffect } from "react";

export type DictationStatus = "idle" | "listening" | "paused" | "error" | "unsupported";
export type DictationAction = "insert" | "append_findings" | "append_impression" | "replace_selection";

export interface DictationCommand {
  type:
    | "newLine"
    | "period"
    | "comma"
    | "goToFindings"
    | "goToImpression"
    | "insertNormal"
    | "insertImpression"
    | "deleteLastSentence"
    | "boldAbnormal"
    | "nextField"
    | "saveDraft";
  payload?: string;
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

// These are patterns matched against normalized (lowercase, trimmed) final results.
const COMMAND_MAP: Array<{ pattern: RegExp; command: DictationCommand["type"]; }> = [
  { pattern: /^new[- ]?line$/, command: "newLine" },
  { pattern: /^(full[- ]?stop|period)$/, command: "period" },
  { pattern: /^comma$/, command: "comma" },
  { pattern: /^findings$/, command: "goToFindings" },
  { pattern: /^impression$/, command: "goToImpression" },
  { pattern: /^(insert|go to) impression$/, command: "insertImpression" },
  { pattern: /^normal study$/, command: "insertNormal" },
  { pattern: /^delete last sentence$/, command: "deleteLastSentence" },
  { pattern: /^bold abnormal$/, command: "boldAbnormal" },
  { pattern: /^next field$/, command: "nextField" },
  { pattern: /^save draft$/, command: "saveDraft" },
];

function parseCommand(text: string): DictationCommand | null {
  const normalized = text.toLowerCase().trim();
  for (const { pattern, command } of COMMAND_MAP) {
    if (pattern.test(normalized)) return { type: command };
  }
  return null;
}

// Replace command utterances with their punctuation equivalents.
function applyInlineSubstitutions(text: string): string {
  return text
    .replace(/\bnew[- ]?line\b/gi, "\n")
    .replace(/\bfull[- ]?stop\b/gi, ".")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bopen[- ]?bracket\b/gi, "(")
    .replace(/\bclose[- ]?bracket\b/gi, ")")
    .replace(/\bopen[- ]?parenthesis\b/gi, "(")
    .replace(/\bclose[- ]?parenthesis\b/gi, ")")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\bsemicolon\b/gi, ";")
    .replace(/\bhyphen\b/gi, "-")
    .replace(/\bdash\b/gi, "—");
}


export function useVoiceDictation(): VoiceDictationHook {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<DictationCommand | null>(null);

  const recognitionRef = useRef<import("../types/speech").SpeechRecognitionLike | null>(null);
  const pausedRef = useRef(false);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const createRecognition = useCallback((): import("../types/speech").SpeechRecognitionLike | null => {
    if (!isSupported) return null;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.maxAlternatives = 1;
    return recognition;
  }, [isSupported]);

  const handleResult = useCallback((event: import("../types/speech").SpeechRecognitionEvent) => {
    let finalText = "";
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        // Check if the whole utterance is a command
        const cmd = parseCommand(text);
        if (cmd) {
          setLastCommand(cmd);
          // Reset after a tick so consumers can react
          setTimeout(() => setLastCommand(null), 500);
          // Don't add commands to transcript
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

  const start = useCallback(() => {
    if (!isSupported) {
      setStatus("unsupported");
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (status === "listening") return;

    // Reuse existing recognition if paused
    if (pausedRef.current && recognitionRef.current) {
      pausedRef.current = false;
      recognitionRef.current.start();
      setStatus("listening");
      return;
    }

    const recognition = createRecognition();
    if (!recognition) return;

    recognition.onresult = handleResult;
    recognition.onerror = (e: import("../types/speech").SpeechRecognitionErrorEvent) => {
      if (e.error === "no-speech") return; // benign
      setError(`Dictation error: ${e.error}`);
      setStatus("error");
    };
    recognition.onend = () => {
      if (!pausedRef.current && status !== "idle") {
        // Auto-restart if unexpectedly ended
        try { recognition.start(); } catch { /* ignore */ }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
    setError(null);
  }, [isSupported, status, createRecognition, handleResult]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    pausedRef.current = false;
    setStatus("idle");
    setInterimTranscript("");
  }, []);

  const pause = useCallback(() => {
    if (recognitionRef.current && status === "listening") {
      pausedRef.current = true;
      recognitionRef.current.stop();
      setStatus("paused");
    }
  }, [status]);

  const resume = useCallback(() => {
    if (status === "paused") {
      start();
    }
  }, [status, start]);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
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
