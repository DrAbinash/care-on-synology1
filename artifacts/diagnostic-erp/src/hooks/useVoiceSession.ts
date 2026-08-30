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
import { isStaleVoiceResult, deriveVoiceUiState, voiceUiStatusLabel, type VoiceCaptureBinding } from "@/lib/voiceSessionState";
import {
  createVoiceProvider, resolveProviderChoice, isWebSpeechSupported, isInjectedProviderPresent,
  type TranscriptionSession, type VoiceProviderKind, type VoiceSettings, type TranscribeCapabilities,
} from "@/lib/voiceTranscription";
import { normalizeRadiologyDictation } from "@/lib/voiceDictationNormalize";

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
   *  before insertion). Normalized for display; raw is on parse.rawTranscript. */
  editableText: string | null;
  /** Un-normalized engine transcript for the active dictation session. */
  rawTranscript?: string | null;
}

export interface UseVoiceSessionOptions {
  studyId: number | undefined;
  settings: VoiceSettings;
  capabilities: TranscribeCapabilities;
  /** Fresh workspace context — consulted at parse time AND again at execute
   *  time (context can change while a preview is open). */
  getContext: () => VoiceContext;
  /** The workspace adapter: workflow intents MUST dispatch through the M1.5
   *  command dispatcher; edits go through the same setters buttons use. */
  execute: (parse: ParsedVoiceCommand) => VoiceExecutionResult;
  onAudit: (commandType: "finalize" | "verify", outcome: VoiceAuditOutcome) => void;
  /**
   * Optional polish for dictation text. Prefer deterministic normalization
   * only — do NOT wire an autonomous rewriting model here for clinical safety.
   */
  cleanupDictation?: (raw: string) => Promise<string>;
}

export type VoicePhase = "idle" | "requesting-permission" | "listening" | "processing";
export type VoiceTrouble = { kind: "permission" | "offline" | "error"; message: string } | null;

export function useVoiceSession(options: UseVoiceSessionOptions) {
  // Options in a ref: callbacks always see the CURRENT render's state without
  // re-arming capture effects (the adapter closes over live workspace state).
  const optsRef = useRef(options);
  optsRef.current = options;

  const { settings, capabilities, studyId } = options;

  const providerKind: VoiceProviderKind | null = useMemo(
    () => resolveProviderChoice(settings.provider, {
      localAvailable: capabilities.local,
      serverAvailable: capabilities.server,
      webSpeechSupported: isWebSpeechSupported(),
      injectedPresent: isInjectedProviderPresent(),
    }),
    [settings.provider, capabilities.local, capabilities.server],
  );
  const enabled = settings.enabled && providerKind != null;
  /** Hands-free needs a provider that can stream utterances (webspeech and
   *  injected always can; recorder providers only with live segments on). */
  const handsFreeCapable = enabled && providerKind != null &&
    createVoiceProvider(providerKind).supportsContinuous(settings);

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
  // M1.6B3 — hands-free continuous session: utterances stream through the
  // same parse→safety→preview pipeline; "go to sleep"/"wake up" pause and
  // resume, "cancel" exits, spoken "confirm" applies NON-high-risk previews.
  const [handsFree, setHandsFree] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const asleepRef = useRef(false);
  const pendingRef = useRef<VoicePending | null>(null);
  pendingRef.current = pending;

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

  const confirmPending = useCallback((via: "click" | "enter" | "voice") => {
    setPending((prev) => {
      if (!prev) return null;
      if (prev.verdict.blocked || !prev.parse.intent) return prev; // blocked previews only dismiss
      // Enter AND spoken "confirm" share the same gate — never HIGH_RISK.
      if (via !== "click" && !prev.verdict.confirmViaEnterAllowed) return prev;
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

  /** Route a parse: blocked/ambiguous/confirm → preview; safe → execute. */
  const handleParsed = useCallback((parse: ParsedVoiceCommand) => {
    // Session-level control intents never reach the workspace adapter.
    if (parse.intent?.type === "confirm") {
      const p = pendingRef.current;
      if (!p) { setFeedback("Nothing to confirm"); return; }
      if (!p.verdict.confirmViaEnterAllowed || p.verdict.blocked) {
        setFeedback("✗ This command cannot be confirmed by voice — use the Confirm button");
        return;
      }
      confirmPending("voice");
      return;
    }
    if (parse.intent?.type === "handsfree") {
      setFeedback("Hands-free mode is off — use the Hands-free button first");
      return;
    }
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
  }, [executeNow, auditIfNeeded, confirmPending]);

  const handleFinalTranscript = useCallback((transcript: string, providerConfidence: number | null, bound: VoiceCaptureBinding) => {
    setInterim("");
    setCaptureTrigger(null);
    const current = optsRef.current;
    if (isStaleVoiceResult(bound, current.studyId ?? null, nonceRef.current)) {
      setPhase("idle");
      if (transcript) setFeedback("Discarded voice input from a previous study");
      return;
    }
    setLastTranscript(transcript);
    if (!transcript.trim()) {
      setPhase("idle");
      setFeedback("Heard nothing — try again");
      return;
    }
    if (mode === "dictation") {
      // Dictation mode: whole utterance → deterministic normalize → editable preview.
      // NEVER auto-submit. Optional cleanupDictation must stay conservative (no AI rewrite).
      const { rawTranscript, normalizedTranscript } = normalizeRadiologyDictation(transcript);
      const baseText = normalizeDictationText(normalizedTranscript, { autoPunctuation: current.settings.autoPunctuation });
      const openDictationPreview = (text: string) => {
        const parse: ParsedVoiceCommand = {
          rawTranscript,
          normalizedTranscript: text,
          intent: { type: "dictate", target: dictationTarget, mode: "append", text },
          parameters: { text },
          confidenceBand: "CLEAR",
          alternatives: [],
          parseErrors: [],
        };
        const verdict = evaluateVoiceCommand(parse, current.getContext());
        setPending({ parse, verdict, editableText: text, rawTranscript });
        setPhase("idle");
        setFeedback(null);
      };
      const polish = current.cleanupDictation;
      if (polish) {
        setPhase("processing");
        setFeedback("Cleaning dictation…");
        void polish(baseText)
          .then((cleaned) => openDictationPreview((cleaned || baseText).trim() || baseText))
          .catch(() => openDictationPreview(baseText));
        return;
      }
      openDictationPreview(baseText);
      return;
    }
    setPhase("idle");
    handleParsed(parseVoiceTranscript(transcript, { providerConfidence }));
  }, [mode, dictationTarget, handleParsed]);

  const startListening = useCallback((trigger: "ptt" | "toggle") => {
    // Double-click / rapid Start must never create two recognizers.
    if (!enabled || !providerKind || sessionRef.current) return;
    // A fresh capture supersedes any open preview.
    setPending((prev) => {
      if (prev) auditIfNeeded(prev.parse, "cancelled");
      return null;
    });
    setTrouble(null);
    setFeedback(null);
    setLastTranscript("");
    setInterim("");
    setPhase("requesting-permission");
    nonceRef.current += 1;
    const bound: VoiceCaptureBinding = { studyId: optsRef.current.studyId ?? null, nonce: nonceRef.current };
    bindingRef.current = bound;
    setCaptureTrigger(trigger);
    const provider = createVoiceProvider(providerKind);
    sessionRef.current = provider.start(
      {
        lang: optsRef.current.settings.language,
        deviceId: optsRef.current.settings.inputDeviceId,
        // Live segmented interim text for recorder providers (M1.6B3).
        segmentSeconds: optsRef.current.settings.segmentSeconds,
      },
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
    // Explicit Stop terminates recognition; provider prevents auto-restart.
    sessionRef.current?.stop();
  }, []);

  const toggleListening = useCallback(() => {
    if (sessionRef.current && !handsFree) stopListening();
    else if (!sessionRef.current) startListening("toggle");
  }, [startListening, stopListening, handsFree]);

  // ── M1.6B3 — hands-free continuous session ────────────────────────────────

  /** One utterance from the continuous stream: session-control intents are
   *  handled here; everything else runs the normal pipeline. While a preview
   *  is pending, only confirm / cancel / sleep / wake are honored. */
  const handleUtterance = useCallback((transcript: string, providerConfidence: number | null, bound: VoiceCaptureBinding) => {
    const current = optsRef.current;
    if (isStaleVoiceResult(bound, current.studyId ?? null, nonceRef.current)) return;
    if (!transcript.trim()) return;
    setLastTranscript(transcript);
    const parse = parseVoiceTranscript(transcript, { providerConfidence });
    const intent = parse.intent;
    if (intent?.type === "handsfree") {
      asleepRef.current = intent.action === "sleep";
      setAsleep(asleepRef.current);
      setFeedback(asleepRef.current ? "Asleep — say “wake up” to resume" : "✓ Awake — listening for commands");
      return;
    }
    if (asleepRef.current) {
      setFeedback(`Asleep — ignored “${transcript}” (say “wake up” to resume)`);
      return;
    }
    if (intent?.type === "cancel") {
      // Exit hands-free AND drop any pending preview (audited as cancelled) —
      // spoken cancel must behave exactly like Escape.
      setPending((prev) => {
        if (prev) auditIfNeeded(prev.parse, "cancelled");
        return null;
      });
      stopHandsFreeRef.current();
      return;
    }
    if (intent?.type === "confirm") {
      const p = pendingRef.current;
      if (!p) { setFeedback("Nothing to confirm"); return; }
      if (!p.verdict.confirmViaEnterAllowed || p.verdict.blocked) {
        setFeedback("✗ This command cannot be confirmed by voice — click Confirm");
        return;
      }
      confirmPending("voice");
      return;
    }
    if (pendingRef.current) {
      setFeedback(`Confirm or cancel the pending command first (heard: “${transcript}”)`);
      return;
    }
    if (mode === "dictation") {
      const { rawTranscript, normalizedTranscript } = normalizeRadiologyDictation(transcript);
      const text = normalizeDictationText(normalizedTranscript, { autoPunctuation: current.settings.autoPunctuation });
      const dictParse: ParsedVoiceCommand = {
        rawTranscript, normalizedTranscript: text,
        intent: { type: "dictate", target: dictationTarget, mode: "append", text },
        parameters: { text }, confidenceBand: "CLEAR", alternatives: [], parseErrors: [],
      };
      setPending({
        parse: dictParse,
        verdict: evaluateVoiceCommand(dictParse, current.getContext()),
        editableText: text,
        rawTranscript,
      });
      return;
    }
    handleParsed(parse);
  }, [mode, dictationTarget, handleParsed, confirmPending, auditIfNeeded]);

  const startHandsFree = useCallback(() => {
    if (!handsFreeCapable || !providerKind || sessionRef.current) return;
    setPending(null);
    setTrouble(null);
    setFeedback("✓ Hands-free on — say “go to sleep” to pause, “cancel” to exit");
    setLastTranscript("");
    nonceRef.current += 1;
    const bound: VoiceCaptureBinding = { studyId: optsRef.current.studyId ?? null, nonce: nonceRef.current };
    bindingRef.current = bound;
    asleepRef.current = false;
    setAsleep(false);
    setHandsFree(true);
    const provider = createVoiceProvider(providerKind);
    sessionRef.current = provider.start(
      {
        lang: optsRef.current.settings.language,
        deviceId: optsRef.current.settings.inputDeviceId,
        segmentSeconds: optsRef.current.settings.segmentSeconds,
        continuous: true,
      },
      {
        onInterim: (text) => setInterim(text),
        onStatus: (s) => { if (s === "listening") setPhase("listening"); },
        onResult: (r) => handleUtterance(r.transcript, r.providerConfidence, bound),
        onError: (message, opts) => {
          sessionRef.current = null;
          setHandsFree(false);
          setAsleep(false);
          setPhase("idle");
          setInterim("");
          setTrouble({ kind: opts?.permission ? "permission" : opts?.offline ? "offline" : "error", message });
        },
      },
    );
  }, [handsFreeCapable, providerKind, handleUtterance]);

  const stopHandsFree = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    nonceRef.current += 1;
    setHandsFree(false);
    setAsleep(false);
    asleepRef.current = false;
    setPhase("idle");
    setInterim("");
    setFeedback("Hands-free off");
  }, []);
  const stopHandsFreeRef = useRef(stopHandsFree);
  stopHandsFreeRef.current = stopHandsFree;

  const toggleHandsFree = useCallback(() => {
    if (handsFree) stopHandsFree();
    else startHandsFree();
  }, [handsFree, startHandsFree, stopHandsFree]);

  /** Cancel everything: abort capture (incl. hands-free), drop preview —
   *  nothing executes. */
  const cancel = useCallback(() => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    nonceRef.current += 1; // any in-flight result is now stale
    setPhase("idle");
    setInterim("");
    setCaptureTrigger(null);
    setHandsFree(false);
    setAsleep(false);
    asleepRef.current = false;
    setPending((prev) => {
      if (prev) auditIfNeeded(prev.parse, "cancelled");
      return null;
    });
  }, [auditIfNeeded]);

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

  // Study switch: abort capture, drop previews — Patient A's dictation must
  // never silently enter Patient B's report (P0).
  const prevStudyRef = useRef(studyId);
  useEffect(() => {
    if (prevStudyRef.current === studyId) return;
    const hadUnsaved = pendingRef.current != null || Boolean(sessionRef.current);
    prevStudyRef.current = studyId;
    sessionRef.current?.abort();
    sessionRef.current = null;
    nonceRef.current += 1;
    setPhase("idle");
    setInterim("");
    setLastTranscript("");
    setCaptureTrigger(null);
    setHandsFree(false);
    setAsleep(false);
    asleepRef.current = false;
    setPending(null);
    setTrouble(null);
    setFeedback(hadUnsaved ? "Study changed — previous dictation discarded" : null);
    setLastUndo(null);
  }, [studyId]);

  // Abort on unmount — no auto-restart after teardown.
  useEffect(() => () => { sessionRef.current?.abort(); }, []);

  const capturing = phase === "listening" || phase === "processing" || phase === "requesting-permission";

  const uiState = deriveVoiceUiState({
    enabled,
    providerKind,
    phase,
    trouble,
    hasPendingPreview: pending != null,
  });
  const statusLabel = voiceUiStatusLabel(uiState, trouble?.kind);

  return {
    enabled,
    providerKind,
    providerLabel: providerKind ? createVoiceProvider(providerKind).label : "No provider available",
    phase,
    uiState,
    statusLabel,
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
    // M1.6B3 — hands-free continuous mode
    handsFree,
    asleep,
    handsFreeCapable,
    startHandsFree,
    stopHandsFree,
    toggleHandsFree,
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
