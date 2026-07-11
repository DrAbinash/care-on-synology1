import { describe, it, expect } from "vitest";
import {
  parseVoiceSettings, resolveProviderChoice, VOICE_SETTING_DEFAULTS,
} from "./voiceTranscription";

// Ticket M1.6B2 Phase 3 — the pure provider-selection + settings rules.
// (The capture paths hit browser APIs and the real /api/ai/transcribe route —
// covered by the real-browser verification, not simulated here.)

describe("resolveProviderChoice — the ticket's preference order", () => {
  const env = (over: Partial<{ serverAvailable: boolean; webSpeechSupported: boolean; injectedPresent: boolean }> = {}) => ({
    serverAvailable: false, webSpeechSupported: false, injectedPresent: false, ...over,
  });

  it("no local/offline STT exists in this repo: server (when configured) → web speech → null", () => {
    expect(resolveProviderChoice("auto", env({ serverAvailable: true, webSpeechSupported: true }))).toBe("server");
    expect(resolveProviderChoice("auto", env({ webSpeechSupported: true }))).toBe("webspeech");
    expect(resolveProviderChoice("auto", env())).toBeNull();
  });

  it("explicit provider settings are honored — honestly null when unavailable", () => {
    expect(resolveProviderChoice("server", env({ serverAvailable: true }))).toBe("server");
    expect(resolveProviderChoice("server", env({ webSpeechSupported: true }))).toBeNull();
    expect(resolveProviderChoice("browser", env({ webSpeechSupported: true }))).toBe("webspeech");
    expect(resolveProviderChoice("browser", env({ serverAvailable: true }))).toBeNull();
  });

  it("an injected test queue overrides everything (harness-only global)", () => {
    expect(resolveProviderChoice("auto", env({ injectedPresent: true }))).toBe("injected");
    expect(resolveProviderChoice("server", env({ serverAvailable: true, injectedPresent: true }))).toBe("injected");
  });
});

describe("parseVoiceSettings — pacs_settings rows → typed settings", () => {
  it("defaults when nothing is stored", () => {
    expect(parseVoiceSettings(undefined)).toEqual(VOICE_SETTING_DEFAULTS);
    expect(parseVoiceSettings([])).toEqual(VOICE_SETTING_DEFAULTS);
  });

  it("parses stored rows and rejects junk values back to defaults", () => {
    const rows = [
      { key: "voice_enabled", value: "false" },
      { key: "voice_provider", value: "server" },
      { key: "voice_language", value: "en-US" },
      { key: "voice_ptt_key", value: "off" },
      { key: "voice_auto_punctuation", value: "false" },
      { key: "voice_default_mode", value: "dictation" },
      { key: "voice_confirmation_policy", value: "strict" },
      { key: "voice_input_device", value: "mic-42" },
    ];
    expect(parseVoiceSettings(rows)).toEqual({
      enabled: false, provider: "server", language: "en-US", pttKey: "off",
      autoPunctuation: false, defaultMode: "dictation", confirmationPolicy: "strict",
      inputDeviceId: "mic-42",
    });
    expect(parseVoiceSettings([
      { key: "voice_provider", value: "skynet" },
      { key: "voice_default_mode", value: "??" },
      { key: "voice_confirmation_policy", value: "" },
      { key: "voice_ptt_key", value: "F13" },
    ])).toEqual(VOICE_SETTING_DEFAULTS);
  });
});
