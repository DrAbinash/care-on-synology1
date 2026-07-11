/**
 * useVoiceSession — Ticket M1.6B2 Phase 2/8.
 *
 * The ONE voice pipeline for the canonical Reporting Workspace:
 *   capture → transcription → normalization → parse → safety → preview →
 *   EXECUTE VIA THE WORKSPACE ADAPTER (which routes workflow intents through
 *   the M1.5 command dispatcher) → feedback.
 *
 * The hook owns NO workflow logic: parsing lives in lib/voiceCommandGrammar,
 * classification/gating in lib/voiceSafetyPolicy, staleness/keys in
 * lib/voiceSessionState, providers in lib/voiceTranscription. Every
 * transcription result is bound to {studyId, nonce} at capture start; results
 * arriving after a study switch are DISCARDED, never executed (Phase 5).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseVoiceTranscript, normalizeDictationText, describeIntent, describeVoiceGrammar,
  type ParsedVoiceCommand, type DictationTarget,
} from "@/lib/voiceCommandGrammar";
import {
  evaluateVoiceCommand, shouldAuditVoiceCommand,
  type VoiceContext, type VoiceSafetyVerdict,
} from "@/lib/voiceSafetyPolicy";
import { isStaleVoiceResult, type VoiceCaptureBinding } from "@/lib/voiceSessionState";
import {
  createVoiceProvider, resolveProviderChoice, isWebSpeechSupported, isInjectedProviderPresent,
  type TranscriptionSession, type VoiceProviderKind, type VoiceSettings,
} from "@/lib/voiceTranscription";

export type VoiceAuditOutcome = "executed" | "cancelled" | "rejected";

export interface VoiceExecutionResult {
  ok: boolean;
  message?: string;
  /** Inverse of a voice-made edit (single level) — Phase 6 undo. */
  undo?: (() => void) | null;
  undoLabel?: string;
}

export interface VoicePending {
  parse: ParsedVoiceCommand;
  verdict: VoiceSafetyVerdict;
  /** Editable text for dictation intents (Phase 9: transcript stays editable
   *  before insertion). */
  editableText: string | null;
}

export interface UseVoiceSessionOptions {
  studyId: number | undefined;
  settings: VoiceSettings;
  serverAvailable: boolean;
  /** Fresh workspace context — consulted at parse time AND again at execute
   *  time (context can change while a preview is open). */
  getContext: () => VoiceContext;
  /** The workspace adapter: workflow intents MUST dispatch through the M1.5
   *  command dispatcher; edits go through the same setters buttons use. */
  execute: (parse: ParsedVoiceCommand) => VoiceExecutionResult;
  onAudit: (commandType: "finalize" | "verify", outcome: VoiceAuditOutcome) => void;
}

export type VoicePhase = "idle" | "listening" | "processing";
export type VoiceTrouble = { kind: "permission" | "offline" | "error"; message: string } | null;

export function useVoiceSession(options: UseVoiceSessionOptions) {
  // Options in a ref: callbacks always see the CURRENT render's state without
  // re-arming capture effects (the adapter closes over live workspace state).
  const optsRef = useRef(options);
  optsRef.current = options;

  const { settings, serverAvailable, studyId } = options;

  const providerKind: VoiceProviderKind | null = useMemo(
    () => resolveProviderChoice(settings.provider, {
      serverAvailable,
      webSpeechSupported: isWebSpeechSupported(),
      injectedPresent: isInjectedProviderPresent(),
    }),
    [settings.provider, serverAvailable],
  );
  const enabled = settings.enabled && providerKind != null;

  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [trouble, setTrouble] = useState<VoiceTrouble>(null);
  const [interim, setInterim] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [pending, setPending] = useState<VoicePending | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mode, setMode] = useState<"command" | "dictation">(settings.defaultMode);
  const [dictationTarget, setDictationTarget] = useState<DictationTarget>("findings");
  const [captureTrigger, setCaptureTrigger] = useState<"ptt" | "toggle" | null>(null);
  const [lastUndo, setLastUndo] = useState<{ label: string; run: () => void } | null>(null);

  const sessionRef = useRef<TranscriptionSession | null>(null);
  const nonceRef = useRef(0);
  const bindingRef = useRef<VoiceCaptureBinding>({ studyId: null, nonce: 0 });

  const auditIfNeeded = useCallback((parse: ParsedVoiceCommand, outcome: VoiceAuditOutcome) => {
    if (!shouldAuditVoiceCommand(parse.intent)) return;
    const intent = parse.intent;
    if (intent?.type === "workflow" && (intent.command === "finalize" || intent.command === "verify")) {
      optsRef.current.onAudit(intent.command, outcome);
    }
  }, []);

  /** Execute NOW — re-gates against fresh context first (never trusts the
   *  context from preview time). */
  const executeNow = useCallback((parse: ParsedVoiceCommand) => {
    const ctx = optsRef.current.getContext();
    const verdict = evaluateVoiceCommand(parse, ctx);
    if (verdict.blocked) {
      setFeedback(`✗ ${verdict.blocked}`);
      auditIfNeeded(parse, "rejected");
      return;
    }
    const result = optsRef.current.execute(parse);
    setFeedback(result.ok ? `✓ ${result.message ?? "Done"}` : `✗ ${result.message ?? "Could not execute"}`);
    if (result.ok && result.undo) setLastUndo({ label: result.undoLabel ?? "voice edit", run: result.undo });
    auditIfNeeded(parse, result.ok ? "executed" : "rejected");
  }, [auditIfNeeded]);

  /** Route a parse: blocked/ambiguous/confirm → preview; safe → execute. */
  const handleParsed = useCallback((parse: ParsedVoiceCommand) => {
    const ctx = optsRef.current.getContext();
    const verdict = evaluateVoiceCommand(parse, ctx);
    const isDictate = parse.intent?.type === "dictate";
    if (verdict.blocked || parse.confidenceBand !== "CLEAR" || verdict.requiresConfirmation) {
      setPending({
        parse, verdict,
        editableText: isDictate && parse.intent?.type === "dictate" ? parse.intent.text : null,
      });
      if (verdict.blocked) auditIfNeeded(parse, "rejected");
      return;
    }
    executeNow(parse);
  }, [executeNow, auditIfNeeded]);

  const handleFinalTranscript = useCallback((transcript: string, providerConfidence: number | null, bound: VoiceCaptureBinding) => {
    setPhase("idle");
    setInterim("");
    setCaptureTrigger(null);
    const current = optsRef.current;
    if (isStaleVoiceResult(bound, current.studyId ?? null, nonceRef.current)) {
      if (transcript) setFeedback("Discarded voice input from a previous study");
      return;
    }
    setLastTranscript(transcript);
    if (!transcript.trim()) {
      setFeedback("Heard nothing — try again");
      return;
    }
    if (mode === "dictation") {
      // Dictation mode: the whole utterance is text for the selected editor;
      // ALWAYS previewed + editable before insertion (Phase 9), append-only.
      const text = normalizeDictationText(transcript, { autoPunctuation: current.settings.autoPunctuation });
      const parse: ParsedVoiceCommand = {
        rawTranscript: transcript,
        normalizedTranscript: transcript,
        intent: { type: "dictate", target: dictationTarget, mode: "append", text },
        parameters: { text },
        confidenceBand: "CLEAR",
        alternatives: [],
        parseErrors: [],
      };
      const verdict = evaluateVoiceCommand(parse, current.getContext());
      setPending({ parse, verdict, editableText: text });
      return;
    }
    handleParsed(parseVoiceTranscript(transcript, { providerConfidence }));
  }, [mode, dictationTarget, handleParsed]);

  const startListening = useCallback((trigger: "ptt" | "toggle") => {
    if (!enabled || !providerKind || sessionRef.current) return;
    // A fresh capture supersedes any open preview.
    setPending((prev) => {
      if (prev) auditIfNeeded(prev.parse, "cancelled");
      return null;
    });
    setTrouble(null);
    setFeedback(null);
    setLastTranscript("");
    nonceRef.current += 1;
    const bound: VoiceCaptureBinding = { studyId: optsRef.current.studyId ?? null, nonce: nonceRef.current };
    bindingRef.current = bound;
    setCaptureTrigger(trigger);
    const provider = createVoiceProvider(providerKind);
    sessionRef.current = provider.start(
      { lang: optsRef.current.settings.language, deviceId: optsRef.current.settings.inputDeviceId },
      {
        onInterim: (text) => setInterim(text),
        onStatus: (s) => {
          if (s === "listening") setPhase("listening");
          if (s === "processing") setPhase("processing");
        },
        onResult: (r) => {
          sessionRef.current = null;
          handleFinalTranscript(r.transcript, r.providerConfidence, bound);
        },
        onError: (message, opts) => {
          sessionRef.current = null;
          setPhase("idle");
          setInterim("");
          setCaptureTrigger(null);
          setTrouble({ kind: opts?.permission ? "permission" : opts?.offline ? "offline" : "error", message });
        },
      },
    );
  }, [enabled, providerKind, handleFinalTranscript, auditIfNeeded]);

  const stopListening = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  const toggleListening = useCallback(() => {
    if (sessionRef.current) stopListening();
    else startListening("toggle");
  }, [startListening, stopListening]);

  /** Cancel everything: abort capture, drop preview — nothing executes. */
  const cancel = useCallback(() => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    nonceRef.current += 1; // any in-flight result is now stale
    setPhase("idle");
    setInterim("");
    setCaptureTrigger(null);
    setPending((prev) => {
      if (prev) auditIfNeeded(prev.parse, "cancelled");
      return null;
    });
  }, [auditIfNeeded]);

  const confirmPending = useCallback((via: "click" | "enter") => {
    setPending((prev) => {
      if (!prev) return null;
      if (prev.verdict.blocked || !prev.parse.intent) return prev; // blocked previews only dismiss
      if (via === "enter" && !prev.verdict.confirmViaEnterAllowed) return prev;
      let parse = prev.parse;
      if (prev.editableText != null && parse.intent?.type === "dictate") {
        parse = {
          ...parse,
          intent: { ...parse.intent, text: prev.editableText },
          parameters: { ...parse.parameters, text: prev.editableText },
        };
      }
      // Execute after the state update settles — executeNow re-gates anyway.
      window.setTimeout(() => executeNow(parse), 0);
      return null;
    });
  }, [executeNow]);

  const updatePendingText = useCallback((text: string) => {
    setPending((prev) => (prev ? { ...prev, editableText: text } : prev));
  }, []);

  /** Re-parse a suggested alternative phrase (deterministic — same grammar). */
  const chooseAlternative = useCallback((phrase: string) => {
    setPending(null);
    handleParsed(parseVoiceTranscript(phrase));
  }, [handleParsed]);

  const undoLast = useCallback(() => {
    setLastUndo((prev) => {
      if (prev) {
        prev.run();
        setFeedback(`Undid: ${prev.label}`);
      }
      return null;
    });
  }, []);

  // Study switch: abort capture, drop previews — stale results must never
  // land on the next patient (Phase 5). Nonce bump makes in-flight results stale.
  const prevStudyRef = useRef(studyId);
  useEffect(() => {
    if (prevStudyRef.current === studyId) return;
    prevStudyRef.current = studyId;
    sessionRef.current?.abort();
    sessionRef.current = null;
    nonceRef.current += 1;
    setPhase("idle");
    setInterim("");
    setLastTranscript("");
    setCaptureTrigger(null);
    setPending(null);
    setFeedback(null);
    setLastUndo(null);
  }, [studyId]);

  // Abort on unmount.
  useEffect(() => () => { sessionRef.current?.abort(); }, []);

  const capturing = phase === "listening" || phase === "processing";

  return {
    enabled,
    providerKind,
    providerLabel: providerKind ? createVoiceProvider(providerKind).label : "No provider available",
    phase,
    capturing,
    captureTrigger,
    trouble,
    interim,
    lastTranscript,
    pending,
    feedback,
    mode,
    setMode,
    dictationTarget,
    setDictationTarget,
    startListening,
    stopListening,
    toggleListening,
    cancel,
    confirmPending,
    updatePendingText,
    chooseAlternative,
    undoAvailable: lastUndo != null,
    undoLabel: lastUndo?.label ?? null,
    undoLast,
    help: describeVoiceGrammar(),
    describeIntent,
  };
}

export type VoiceSession = ReturnType<typeof useVoiceSession>;
