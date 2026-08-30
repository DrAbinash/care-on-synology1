/**
 * voiceTranscription.ts — Ticket M1.6B2 Phase 3, extended by M1.6B3.
 *
 * The ONE transcription-provider layer for the canonical voice pipeline.
 * Four providers behind one interface:
 *
 *  - "local":     MediaRecorder capture → POST /api/ai/transcribe/local — the
 *                 clinic's OWN self-hosted STT server (whisper.cpp /
 *                 faster-whisper etc.), proxied server-side so audio never
 *                 leaves the clinic network and the STT address never reaches
 *                 the browser.
 *  - "server":    MediaRecorder capture → POST /api/ai/transcribe (the
 *                 existing server-side Gemini endpoint; the provider key
 *                 stays server-side).
 *  - "webspeech": browser Web Speech API (Chrome's engine is cloud-backed).
 *  - "injected":  deterministic transcripts from window.__voiceInjectedTranscripts,
 *                 flowing through the SAME callbacks as real capture. Only
 *                 selectable when a test harness set that global before load;
 *                 inert in production.
 *
 * Preference order (M1.6B2/B3): local when configured → server when
 * configured → Web Speech → honestly unavailable.
 *
 * M1.6B3 additions: SEGMENTED live transcription for the recorder providers
 * (self-contained N-second recordings transcribed as they complete — interim
 * text while you speak, final = the ordered concatenation) and CONTINUOUS
 * sessions (one onResult per utterance/segment; the session stays open) for
 * the hands-free mode.
 */

// Relative import (not "@/lib/…") so root-level vitest, which has no alias
// map for this package, can still run the pure tests in this module.
import { api } from "./fetchApi";
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionLike,
} from "../types/speech";

export type VoiceProviderKind = "local" | "server" | "webspeech" | "injected";
export type VoiceProviderSetting = "auto" | "local" | "server" | "browser";

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
  /** Single-utterance sessions: fires ONCE with the whole capture.
   *  Continuous sessions: fires once per utterance/segment. */
  onResult: (r: TranscriptionResult) => void;
  onStatus: (s: VoiceCaptureStatus) => void;
  onError: (message: string, opts?: { permission?: boolean; offline?: boolean }) => void;
}

export interface TranscriptionStartOptions {
  lang: string;
  deviceId?: string | null;
  /** >0 → recorder providers stream self-contained segments of this length
   *  (live interim text); 0/absent → one batch upload on stop. */
  segmentSeconds?: number;
  /** Hands-free: deliver one onResult per utterance/segment and keep the
   *  session open until stop()/abort(). */
  continuous?: boolean;
}

export interface TranscriptionSession {
  /** Finish the capture (single-utterance: deliver the result). */
  stop: () => void;
  /** Discard the capture — no further results will be delivered. */
  abort: () => void;
}

export interface TranscriptionProvider {
  kind: VoiceProviderKind;
  label: string;
  /** Whether this provider can run a continuous (hands-free) session with
   *  the given settings. */
  supportsContinuous: (settings: VoiceSettings) => boolean;
  start: (opts: TranscriptionStartOptions, cb: TranscriptionCallbacks) => TranscriptionSession;
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
  /** M1.6B3 — live segmented transcription for recorder providers. 0 = off. */
  segmentSeconds: number;
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
  segmentSeconds: 0,
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
  const seg = Number(get("voice_segment_seconds"));
  return {
    enabled: bool("voice_enabled", VOICE_SETTING_DEFAULTS.enabled),
    provider: provider === "server" || provider === "browser" || provider === "local" ? provider : "auto",
    language: get("voice_language") || VOICE_SETTING_DEFAULTS.language,
    pttKey: ptt === "off" ? "off" : "Space",
    autoPunctuation: bool("voice_auto_punctuation", VOICE_SETTING_DEFAULTS.autoPunctuation),
    defaultMode: mode === "dictation" ? "dictation" : "command",
    confirmationPolicy: policy === "strict" ? "strict" : "standard",
    inputDeviceId: get("voice_input_device") || null,
    segmentSeconds: Number.isInteger(seg) && seg >= 2 && seg <= 30 ? seg : 0,
  };
}

// ── Per-radiologist overrides (M1.6B3, radiologist_voice_preferences) ───────

/** User values may only TIGHTEN policy (disable voice for self, raise
 *  strictness) or pick personal ergonomics. Provider + local-STT + segment
 *  config stay clinic-owned on purpose. */
export interface VoiceUserPrefs {
  enabledOverride: "inherit" | "off";
  pttKey: "inherit" | "Space" | "off";
  defaultMode: "inherit" | "command" | "dictation";
  confirmationPolicy: "inherit" | "strict";
  language: string;      // "" = inherit
  autoPunctuation: "inherit" | "on" | "off";
  inputDevice: string;   // "" = inherit
}

export const VOICE_USER_PREF_DEFAULTS: VoiceUserPrefs = {
  enabledOverride: "inherit", pttKey: "inherit", defaultMode: "inherit",
  confirmationPolicy: "inherit", language: "", autoPunctuation: "inherit", inputDevice: "",
};

export function parseVoiceUserPrefs(raw: unknown): VoiceUserPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(key: string, allowed: readonly T[], dflt: T): T => {
    const v = r[key];
    return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
  };
  return {
    enabledOverride: pick("enabledOverride", ["inherit", "off"], "inherit"),
    pttKey: pick("pttKey", ["inherit", "Space", "off"], "inherit"),
    defaultMode: pick("defaultMode", ["inherit", "command", "dictation"], "inherit"),
    confirmationPolicy: pick("confirmationPolicy", ["inherit", "strict"], "inherit"),
    language: typeof r.language === "string" ? r.language : "",
    autoPunctuation: pick("autoPunctuation", ["inherit", "on", "off"], "inherit"),
    inputDevice: typeof r.inputDevice === "string" ? r.inputDevice : "",
  };
}

/** Clinic settings ⊕ user overrides. Tighten-only by construction: enabled
 *  can only go false, confirmation only up to strict; everything else is
 *  personal ergonomics. */
export function mergeVoiceSettings(clinic: VoiceSettings, user: VoiceUserPrefs | null | undefined): VoiceSettings {
  if (!user) return clinic;
  return {
    ...clinic,
    enabled: clinic.enabled && user.enabledOverride !== "off",
    confirmationPolicy:
      clinic.confirmationPolicy === "strict" || user.confirmationPolicy === "strict" ? "strict" : "standard",
    pttKey: user.pttKey === "inherit" ? clinic.pttKey : user.pttKey,
    defaultMode: user.defaultMode === "inherit" ? clinic.defaultMode : user.defaultMode,
    language: user.language.trim() || clinic.language,
    autoPunctuation: user.autoPunctuation === "inherit" ? clinic.autoPunctuation : user.autoPunctuation === "on",
    inputDeviceId: user.inputDevice.trim() || clinic.inputDeviceId,
  };
}

// ── Provider selection (pure) ────────────────────────────────────────────────

export interface ProviderEnvironment {
  localAvailable: boolean;
  serverAvailable: boolean;
  webSpeechSupported: boolean;
  injectedPresent: boolean;
}

/** Preference order: the clinic's own STT server first, then the existing
 *  server-side provider, then browser Web Speech, then honestly unavailable.
 *  An injected test queue overrides everything — it only exists in
 *  harness-controlled pages. */
export function resolveProviderChoice(
  setting: VoiceProviderSetting,
  env: ProviderEnvironment,
): VoiceProviderKind | null {
  if (env.injectedPresent) return "injected";
  if (setting === "local") return env.localAvailable ? "local" : null;
  if (setting === "server") return env.serverAvailable ? "server" : null;
  if (setting === "browser") return env.webSpeechSupported ? "webspeech" : null;
  if (env.localAvailable) return "local";
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

export interface TranscribeCapabilities { server: boolean; local: boolean; }

/** Server capability probe — booleans only, never keys or addresses. */
export async function fetchTranscribeCapabilities(): Promise<TranscribeCapabilities> {
  try {
    const res = await api.get<{ available?: boolean; server?: boolean; local?: boolean }>("/api/ai/transcribe/status");
    return { server: Boolean(res?.server ?? res?.available), local: Boolean(res?.local) };
  } catch {
    return { server: false, local: false };
  }
}

// ── Web Speech provider ──────────────────────────────────────────────────────

function createWebSpeechProvider(): TranscriptionProvider {
  return {
    kind: "webspeech",
    label: "Browser speech (Web Speech API)",
    supportsContinuous: () => true,
    start({ lang, continuous }, cb) {
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
      /** Bounded silence restarts — never infinite loops on a dead engine. */
      let silenceRestartCount = 0;
      const MAX_SILENCE_RESTARTS = 40;
      /** Highest ResultList index already committed (Chrome ResultList is cumulative). */
      let committedResultIndex = -1;

      // Any surfaced error terminates the session — no silent restart loops.
      const fail = (message: string, opts?: { permission?: boolean; offline?: boolean }) => {
        if (aborted) return;
        aborted = true;
        stopped = true;
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
        silenceRestartCount = 0; // speech activity resets the silence-restart budget
        let interim = "";
        // Prefer engine's resultIndex, but never re-commit earlier finals.
        const startIndex = Math.max(e.resultIndex, committedResultIndex + 1);
        for (let i = startIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const alt = result[0];
          if (!alt) continue;
          if (result.isFinal) {
            const piece = alt.transcript.replace(/\s+/g, " ").trim();
            if (!piece) {
              committedResultIndex = i;
              continue;
            }
            if (continuous) {
              // Hands-free: each final result IS one utterance.
              cb.onResult({
                transcript: piece,
                providerConfidence: typeof alt.confidence === "number" && alt.confidence > 0 ? alt.confidence : null,
              });
            } else {
              // Commit finals once — skip exact trailing duplicates from engine restarts.
              const next = finalText.trim();
              if (!next) {
                finalText = piece + " ";
              } else if (next.endsWith(piece) || piece === next) {
                /* already committed */
              } else if (piece.startsWith(next) && piece.length > next.length) {
                finalText = piece + " ";
              } else {
                finalText = `${next} ${piece} `;
              }
              if (typeof alt.confidence === "number" && alt.confidence > 0) {
                confidenceSum += alt.confidence;
                confidenceCount += 1;
              }
            }
            committedResultIndex = i;
          } else {
            interim += alt.transcript;
          }
        }
        // Display: committed finals + current interim (interim never written into finals here).
        if (!continuous) {
          const committed = finalText.trim();
          const live = interim.trim();
          cb.onInterim(committed && live ? `${committed} ${live}` : (live || committed));
        } else {
          cb.onInterim(interim);
        }
      };

      recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
        engineSignal();
        if (aborted || e.error === "aborted") return;
        // no-speech: engine may still end and restart via onend — do not fail the session.
        if (e.error === "no-speech") return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          fail("Microphone access was denied. Allow the microphone in your browser's site settings.", { permission: true });
        } else if (e.error === "network") {
          fail("Speech service unreachable — check the network connection.", { offline: true });
        } else if (e.error === "audio-capture") {
          fail("Could not capture audio from the microphone.");
        } else {
          fail("Speech recognition failed. Try again or switch provider in Voice settings.");
        }
      };

      recognition.onend = () => {
        engineSignal();
        if (aborted) return;
        if (!stopped) {
          // The engine ends sessions on its own after silence — restart so a
          // held push-to-talk / continuous Listen keeps capturing until Stop.
          // Explicit Stop sets stopped=true and prevents restart.
          if (!sawAnyResult && Date.now() - lastStartAt < 1500) {
            fail("The browser's speech service is unavailable here — try the server provider or check connectivity.", { offline: true });
            return;
          }
          if (silenceRestartCount >= MAX_SILENCE_RESTARTS) {
            fail("Dictation stopped after repeated silence restarts. Click Listen to continue.");
            return;
          }
          silenceRestartCount += 1;
          lastStartAt = Date.now();
          // New recognition session → fresh ResultList; keep finalText.
          committedResultIndex = -1;
          try { recognition.start(); } catch { /* already restarted */ }
          return;
        }
        if (!continuous) {
          cb.onResult({
            transcript: finalText.trim(),
            providerConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : null,
          });
        }
      };

      recognition.start();
      cb.onStatus("listening");

      return {
        stop: () => {
          // Explicit Stop always terminates recognition and blocks auto-restart.
          stopped = true;
          if (!continuous) cb.onStatus("processing");
          try { recognition.stop(); } catch { /* not started */ }
        },
        abort: () => {
          aborted = true;
          stopped = true;
          window.clearTimeout(watchdog);
          recognition.onend = null;
          try { recognition.abort(); } catch { /* not started */ }
        },
      };
    },
  };
}

// ── Recorder providers (server + local STT via MediaRecorder) ───────────────

const RECORDER_ENDPOINTS: Record<"server" | "local", { endpoint: string; label: string }> = {
  server: { endpoint: "/api/ai/transcribe", label: "Server transcription (clinic AI provider)" },
  local: { endpoint: "/api/ai/transcribe/local", label: "Local STT server (clinic network)" },
};

function createRecorderProvider(kind: "server" | "local"): TranscriptionProvider {
  const { endpoint, label } = RECORDER_ENDPOINTS[kind];
  return {
    kind,
    label,
    // Hands-free on batch uploads needs live segments — otherwise nothing
    // would ever come back while the session runs.
    supportsContinuous: (settings) => settings.segmentSeconds > 0,
    start({ deviceId, segmentSeconds, continuous }, cb) {
      const segMs = segmentSeconds && segmentSeconds > 0 ? segmentSeconds * 1000 : 0;
      let recorder: MediaRecorder | null = null;
      let stream: MediaStream | null = null;
      let aborted = false;
      let stopping = false;
      let segmentTimer: number | null = null;
      /** Ordered transcription chain — segment texts append in capture order. */
      let uploadChain: Promise<void> = Promise.resolve();
      let committed = "";

      const cleanup = () => {
        if (segmentTimer != null) window.clearTimeout(segmentTimer);
        segmentTimer = null;
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
      };

      const transcribeBlob = (blob: Blob): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result ?? "");
            const audioBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
            api.post<{ text?: string }>(endpoint, { audioBase64, mimeType: blob.type })
              .then((res) => resolve((res.text ?? "").trim()))
              .catch(reject);
          };
          reader.onerror = () => reject(new Error("Could not read the recorded audio."));
          reader.readAsDataURL(blob);
        });

      const surfaceUploadError = (err: unknown) => {
        if (aborted) return;
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        aborted = true;
        cleanup();
        cb.onError(err instanceof Error ? err.message : `${label} failed.`, { offline });
      };

      /** One self-contained recording segment on the shared stream. Segments
       *  (not timeslices) so every upload is an independently decodable file. */
      const startSegment = () => {
        if (aborted || !stream) return;
        const chunks: Blob[] = [];
        let rec: MediaRecorder;
        try {
          rec = new MediaRecorder(stream);
        } catch {
          aborted = true;
          cleanup();
          cb.onError("Audio recording is not supported in this browser.");
          return;
        }
        recorder = rec;
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
          const isFinalSegment = stopping || aborted;
          if (aborted) { cleanup(); return; }
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          if (!isFinalSegment) startSegment(); // keep capturing while this uploads
          else cleanup();
          uploadChain = uploadChain.then(async () => {
            if (aborted) return;
            const text = blob.size > 0 ? await transcribeBlob(blob) : "";
            if (aborted) return;
            if (continuous) {
              if (text) cb.onResult({ transcript: text, providerConfidence: null });
              if (isFinalSegment) cb.onStatus("available");
            } else if (segMs > 0) {
              committed = [committed, text].filter(Boolean).join(" ");
              cb.onInterim(committed);
              if (isFinalSegment) cb.onResult({ transcript: committed, providerConfidence: null });
            } else if (isFinalSegment) {
              cb.onResult({ transcript: text, providerConfidence: null });
            }
          }).catch(surfaceUploadError);
        };
        rec.start();
        if (segMs > 0) {
          segmentTimer = window.setTimeout(() => {
            if (rec.state !== "inactive") rec.stop();
          }, segMs);
        }
      };

      const begin = async () => {
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
        startSegment();
        if (!aborted) cb.onStatus("listening");
      };

      void begin();

      return {
        stop: () => {
          stopping = true;
          if (segmentTimer != null) window.clearTimeout(segmentTimer);
          if (recorder && recorder.state !== "inactive") {
            if (!continuous) cb.onStatus("processing");
            recorder.stop();
          } else {
            cleanup();
            if (!continuous) cb.onResult({ transcript: committed, providerConfidence: null });
          }
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
    supportsContinuous: () => true,
    start({ continuous }, cb) {
      let aborted = false;
      cb.onStatus("listening");
      if (continuous) {
        // Deliver one queue entry per tick — deterministic utterance stream.
        const timer = window.setInterval(() => {
          if (aborted) return;
          const next = window.__voiceInjectedTranscripts?.shift();
          if (next == null) return;
          const entry = typeof next === "string" ? { text: next, confidence: undefined } : next;
          if (!entry.text) return;
          cb.onResult({
            transcript: entry.text,
            providerConfidence: typeof entry.confidence === "number" ? entry.confidence : null,
          });
        }, 300);
        const end = () => { aborted = true; window.clearInterval(timer); };
        return { stop: end, abort: end };
      }
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
    case "local": return createRecorderProvider("local");
    case "server": return createRecorderProvider("server");
    case "webspeech": return createWebSpeechProvider();
    case "injected": return createInjectedProvider();
  }
}
