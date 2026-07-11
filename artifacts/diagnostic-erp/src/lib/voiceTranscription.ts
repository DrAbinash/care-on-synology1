/**
 * voiceTranscription.ts — Ticket M1.6B2 Phase 3.
 *
 * The ONE transcription-provider layer for the canonical voice pipeline.
 * Three providers behind one interface:
 *
 *  - "server":    MediaRecorder capture → POST /api/ai/transcribe (the
 *                 EXISTING server-side Gemini endpoint; audio goes only to the
 *                 clinic's own API server, which holds the provider key —
 *                 no keys or external calls in the frontend).
 *  - "webspeech": browser Web Speech API (the existing production dictation
 *                 mechanism; Chrome's engine is itself cloud-backed).
 *  - "injected":  deterministic transcripts from window.__voiceInjectedTranscripts,
 *                 flowing through the SAME callbacks as real capture. Only
 *                 selectable when a test harness set that global before load;
 *                 it exists so verification can drive the real pipeline in
 *                 environments without microphones and is inert in production.
 *
 * No local/offline STT exists in this repo (grounded), so provider order is
 * server (when configured) → Web Speech → unavailable.
 */

// Relative import (not "@/lib/…") so root-level vitest, which has no alias
// map for this package, can still run the pure tests in this module.
import { api } from "./fetchApi";
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionLike,
} from "../types/speech";

export type VoiceProviderKind = "server" | "webspeech" | "injected";
export type VoiceProviderSetting = "auto" | "server" | "browser";

export type VoiceCaptureStatus =
  | "available" | "unavailable" | "permission-denied"
  | "listening" | "processing" | "error" | "offline";

export interface TranscriptionResult {
  transcript: string;
  /** Raw engine confidence 0..1 when supplied (Web Speech); null otherwise. */
  providerConfidence: number | null;
}

export interface TranscriptionCallbacks {
  onInterim: (text: string) => void;
  onResult: (r: TranscriptionResult) => void;
  onStatus: (s: VoiceCaptureStatus) => void;
  onError: (message: string, opts?: { permission?: boolean; offline?: boolean }) => void;
}

export interface TranscriptionSession {
  /** Finish the capture and deliver the result. */
  stop: () => void;
  /** Discard the capture — no result will be delivered. */
  abort: () => void;
}

export interface TranscriptionProvider {
  kind: VoiceProviderKind;
  label: string;
  start: (opts: { lang: string; deviceId?: string | null }, cb: TranscriptionCallbacks) => TranscriptionSession;
}

// ── Settings (persisted as pacs_settings rows, category "voice") ────────────

export interface VoiceSettings {
  enabled: boolean;
  provider: VoiceProviderSetting;
  language: string;
  pttKey: "Space" | "off";
  autoPunctuation: boolean;
  defaultMode: "command" | "dictation";
  confirmationPolicy: "standard" | "strict";
  inputDeviceId: string | null;
}

export const VOICE_SETTING_DEFAULTS: VoiceSettings = {
  enabled: true,
  provider: "auto",
  language: "en-IN",
  pttKey: "Space",
  autoPunctuation: true,
  defaultMode: "command",
  confirmationPolicy: "standard",
  inputDeviceId: null,
};

type SettingRow = { key: string; value: string | null; category?: string | null };

export function parseVoiceSettings(rows: SettingRow[] | undefined | null): VoiceSettings {
  const get = (key: string) => rows?.find((r) => r.key === key)?.value ?? null;
  const bool = (key: string, dflt: boolean) => {
    const v = get(key);
    return v == null || v === "" ? dflt : v === "true";
  };
  const provider = get("voice_provider");
  const mode = get("voice_default_mode");
  const policy = get("voice_confirmation_policy");
  const ptt = get("voice_ptt_key");
  return {
    enabled: bool("voice_enabled", VOICE_SETTING_DEFAULTS.enabled),
    provider: provider === "server" || provider === "browser" ? provider : "auto",
    language: get("voice_language") || VOICE_SETTING_DEFAULTS.language,
    pttKey: ptt === "off" ? "off" : "Space",
    autoPunctuation: bool("voice_auto_punctuation", VOICE_SETTING_DEFAULTS.autoPunctuation),
    defaultMode: mode === "dictation" ? "dictation" : "command",
    confirmationPolicy: policy === "strict" ? "strict" : "standard",
    inputDeviceId: get("voice_input_device") || null,
  };
}

// ── Provider selection (pure) ────────────────────────────────────────────────

export interface ProviderEnvironment {
  serverAvailable: boolean;
  webSpeechSupported: boolean;
  injectedPresent: boolean;
}

/** Preference order per M1.6B2: no local/offline STT exists in this repo, so
 *  the existing server-side integration wins when configured, then browser
 *  Web Speech, then honestly unavailable. An injected test queue overrides
 *  everything — it only exists in harness-controlled pages. */
export function resolveProviderChoice(
  setting: VoiceProviderSetting,
  env: ProviderEnvironment,
): VoiceProviderKind | null {
  if (env.injectedPresent) return "injected";
  if (setting === "server") return env.serverAvailable ? "server" : null;
  if (setting === "browser") return env.webSpeechSupported ? "webspeech" : null;
  if (env.serverAvailable) return "server";
  if (env.webSpeechSupported) return "webspeech";
  return null;
}

export function isWebSpeechSupported(): boolean {
  return typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

declare global {
  interface Window {
    /** Test-harness queue of deterministic transcripts (see header). */
    __voiceInjectedTranscripts?: Array<string | { text: string; confidence?: number }>;
  }
}

export function isInjectedProviderPresent(): boolean {
  return typeof window !== "undefined" && Array.isArray(window.__voiceInjectedTranscripts);
}

/** Server capability probe — reports only a boolean, never key material. */
export async function fetchServerTranscribeAvailable(): Promise<boolean> {
  try {
    const res = await api.get<{ available?: boolean }>("/api/ai/transcribe/status");
    return Boolean(res?.available);
  } catch {
    return false;
  }
}

// ── Web Speech provider ──────────────────────────────────────────────────────

function createWebSpeechProvider(): TranscriptionProvider {
  return {
    kind: "webspeech",
    label: "Browser speech (Web Speech API)",
    start({ lang }, cb) {
      const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!SR) {
        cb.onError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
        return { stop: () => undefined, abort: () => undefined };
      }
      const recognition: SpeechRecognitionLike = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.maxAlternatives = 1;

      let finalText = "";
      let confidenceSum = 0;
      let confidenceCount = 0;
      let stopped = false;
      let aborted = false;
      let sawAnyResult = false;
      let lastStartAt = Date.now();

      // Any surfaced error terminates the session — no silent restart loops.
      const fail = (message: string, opts?: { permission?: boolean; offline?: boolean }) => {
        if (aborted) return;
        aborted = true;
        window.clearTimeout(watchdog);
        recognition.onend = null;
        try { recognition.abort(); } catch { /* not started */ }
        cb.onError(message, opts);
      };

      // Some environments (headless browsers, engines with no speech backend)
      // accept start() and then emit NOTHING — no onstart, no error, no end.
      // A capture that never gets a single engine signal must fail truthfully
      // instead of pretending to listen forever.
      let gotEngineSignal = false;
      const engineSignal = () => { gotEngineSignal = true; window.clearTimeout(watchdog); };
      const watchdog = window.setTimeout(() => {
        if (!gotEngineSignal) {
          fail("The browser's speech engine is not responding — it may be unavailable here. Try the server provider.", { offline: true });
        }
      }, 4000);
      recognition.onstart = engineSignal;

      recognition.onresult = (e: SpeechRecognitionEvent) => {
        engineSignal();
        sawAnyResult = true;
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const alt = result[0];
          if (!alt) continue;
          if (result.isFinal) {
            finalText += alt.transcript + " ";
            if (typeof alt.confidence === "number" && alt.confidence > 0) {
              confidenceSum += alt.confidence;
              confidenceCount += 1;
            }
          } else {
            interim += alt.transcript;
          }
        }
        cb.onInterim(interim);
      };

      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        engineSignal();
        if (aborted || e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          fail("Microphone access was denied. Allow the microphone in your browser's site settings.", { permission: true });
        } else if (e.error === "network") {
          fail("Speech service unreachable — check the network connection.", { offline: true });
        } else {
          fail(`Speech recognition error: ${e.error}`);
        }
      };

      recognition.onend = () => {
        engineSignal();
        if (aborted) return;
        if (!stopped) {
          // The engine ends sessions on its own after silence — restart so a
          // held push-to-talk keeps capturing until the user releases. But an
          // IMMEDIATE end with no results means the speech service is dead
          // (headless/offline browsers do this without any error event) —
          // surface that instead of restarting forever.
          if (!sawAnyResult && Date.now() - lastStartAt < 1500) {
            fail("The browser's speech service is unavailable here — try the server provider or check connectivity.", { offline: true });
            return;
          }
          lastStartAt = Date.now();
          try { recognition.start(); } catch { /* already restarted */ }
          return;
        }
        cb.onResult({
          transcript: finalText.trim(),
          providerConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : null,
        });
      };

      recognition.start();
      cb.onStatus("listening");

      return {
        stop: () => {
          stopped = true;
          cb.onStatus("processing");
          try { recognition.stop(); } catch { /* not started */ }
        },
        abort: () => {
          aborted = true;
          recognition.onend = null;
          try { recognition.abort(); } catch { /* not started */ }
        },
      };
    },
  };
}

// ── Server provider (MediaRecorder → existing /api/ai/transcribe) ───────────

function createServerProvider(): TranscriptionProvider {
  return {
    kind: "server",
    label: "Server transcription (clinic AI provider)",
    start({ deviceId }, cb) {
      let recorder: MediaRecorder | null = null;
      let stream: MediaStream | null = null;
      let aborted = false;
      const chunks: Blob[] = [];

      const cleanup = () => {
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
      };

      const startCapture = async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          });
        } catch (err) {
          const name = err instanceof DOMException ? err.name : "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            cb.onError("Microphone access was denied. Allow the microphone in your browser's site settings.", { permission: true });
          } else if (name === "NotFoundError" || name === "OverconstrainedError") {
            cb.onError("No usable microphone found. Check the input device in Voice settings.");
          } else {
            cb.onError("Could not open the microphone.");
          }
          return;
        }
        if (aborted) { cleanup(); return; }
        try {
          recorder = new MediaRecorder(stream);
        } catch {
          cleanup();
          cb.onError("Audio recording is not supported in this browser.");
          return;
        }
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          cleanup();
          if (aborted) return;
          const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
          if (blob.size === 0) {
            cb.onResult({ transcript: "", providerConfidence: null });
            return;
          }
          cb.onStatus("processing");
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result ?? "");
            const audioBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
            api.post<{ text?: string }>("/api/ai/transcribe", { audioBase64, mimeType: blob.type })
              .then((res) => {
                if (aborted) return;
                cb.onResult({ transcript: (res.text ?? "").trim(), providerConfidence: null });
              })
              .catch((err) => {
                if (aborted) return;
                const offline = typeof navigator !== "undefined" && !navigator.onLine;
                cb.onError(
                  err instanceof Error ? err.message : "Server transcription failed.",
                  { offline },
                );
              });
          };
          reader.onerror = () => cb.onError("Could not read the recorded audio.");
          reader.readAsDataURL(blob);
        };
        recorder.start();
        cb.onStatus("listening");
      };

      void startCapture();

      return {
        stop: () => {
          if (recorder && recorder.state !== "inactive") recorder.stop();
          else cleanup();
        },
        abort: () => {
          aborted = true;
          if (recorder && recorder.state !== "inactive") recorder.stop();
          cleanup();
        },
      };
    },
  };
}

// ── Injected provider (deterministic test transcripts) ──────────────────────

function createInjectedProvider(): TranscriptionProvider {
  return {
    kind: "injected",
    label: "Injected (test)",
    start(_opts, cb) {
      let aborted = false;
      cb.onStatus("listening");
      const next = window.__voiceInjectedTranscripts?.shift();
      const entry = typeof next === "string" ? { text: next, confidence: undefined } : next;
      if (entry?.text) cb.onInterim(entry.text);
      return {
        stop: () => {
          if (aborted) return;
          cb.onStatus("processing");
          cb.onResult({
            transcript: entry?.text ?? "",
            providerConfidence: typeof entry?.confidence === "number" ? entry.confidence : null,
          });
        },
        abort: () => { aborted = true; },
      };
    },
  };
}

export function createVoiceProvider(kind: VoiceProviderKind): TranscriptionProvider {
  switch (kind) {
    case "server": return createServerProvider();
    case "webspeech": return createWebSpeechProvider();
    case "injected": return createInjectedProvider();
  }
}
