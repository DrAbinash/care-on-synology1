import { describe, it, expect } from "vitest";
import {
  parseVoiceSettings, parseVoiceUserPrefs, mergeVoiceSettings, resolveProviderChoice,
  VOICE_SETTING_DEFAULTS, VOICE_USER_PREF_DEFAULTS,
} from "./voiceTranscription";

// Ticket M1.6B2 Phase 3 + M1.6B3 — the pure provider-selection, settings and
// per-user merge rules. (The capture paths hit browser APIs and the real
// transcription routes — covered by the real-browser verification.)

describe("resolveProviderChoice — the ticket's preference order", () => {
  const env = (over: Partial<{ localAvailable: boolean; serverAvailable: boolean; webSpeechSupported: boolean; injectedPresent: boolean }> = {}) => ({
    localAvailable: false, serverAvailable: false, webSpeechSupported: false, injectedPresent: false, ...over,
  });

  it("auto: the clinic's own STT server first, then server provider, then web speech, then null", () => {
    expect(resolveProviderChoice("auto", env({ localAvailable: true, serverAvailable: true, webSpeechSupported: true }))).toBe("local");
    expect(resolveProviderChoice("auto", env({ serverAvailable: true, webSpeechSupported: true }))).toBe("server");
    expect(resolveProviderChoice("auto", env({ webSpeechSupported: true }))).toBe("webspeech");
    expect(resolveProviderChoice("auto", env())).toBeNull();
  });

  it("explicit provider settings are honored — honestly null when unavailable", () => {
    expect(resolveProviderChoice("local", env({ localAvailable: true }))).toBe("local");
    expect(resolveProviderChoice("local", env({ serverAvailable: true, webSpeechSupported: true }))).toBeNull();
    expect(resolveProviderChoice("server", env({ serverAvailable: true }))).toBe("server");
    expect(resolveProviderChoice("server", env({ webSpeechSupported: true }))).toBeNull();
    expect(resolveProviderChoice("browser", env({ webSpeechSupported: true }))).toBe("webspeech");
    expect(resolveProviderChoice("browser", env({ localAvailable: true }))).toBeNull();
  });

  it("an injected test queue overrides everything (harness-only global)", () => {
    expect(resolveProviderChoice("auto", env({ injectedPresent: true }))).toBe("injected");
    expect(resolveProviderChoice("local", env({ localAvailable: true, injectedPresent: true }))).toBe("injected");
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
      { key: "voice_provider", value: "local" },
      { key: "voice_language", value: "en-US" },
      { key: "voice_ptt_key", value: "off" },
      { key: "voice_auto_punctuation", value: "false" },
      { key: "voice_default_mode", value: "dictation" },
      { key: "voice_confirmation_policy", value: "strict" },
      { key: "voice_input_device", value: "mic-42" },
      { key: "voice_segment_seconds", value: "5" },
    ];
    expect(parseVoiceSettings(rows)).toEqual({
      enabled: false, provider: "local", language: "en-US", pttKey: "off",
      autoPunctuation: false, defaultMode: "dictation", confirmationPolicy: "strict",
      inputDeviceId: "mic-42", segmentSeconds: 5,
    });
    expect(parseVoiceSettings([
      { key: "voice_provider", value: "skynet" },
      { key: "voice_default_mode", value: "??" },
      { key: "voice_confirmation_policy", value: "" },
      { key: "voice_ptt_key", value: "F13" },
      { key: "voice_segment_seconds", value: "999" },   // out of range → off
    ])).toEqual(VOICE_SETTING_DEFAULTS);
    expect(parseVoiceSettings([{ key: "voice_segment_seconds", value: "1" }]).segmentSeconds).toBe(0); // <2s → off
  });
});

describe("M1.6B3 — per-radiologist overrides merge (tighten-only)", () => {
  const clinic = { ...VOICE_SETTING_DEFAULTS, enabled: true, confirmationPolicy: "standard" as const };

  it("parseVoiceUserPrefs tolerates junk and missing fields", () => {
    expect(parseVoiceUserPrefs(null)).toEqual(VOICE_USER_PREF_DEFAULTS);
    expect(parseVoiceUserPrefs({ enabledOverride: "on-always", pttKey: 7 })).toEqual(VOICE_USER_PREF_DEFAULTS);
    expect(parseVoiceUserPrefs({ enabledOverride: "off", language: "hi-IN" }))
      .toEqual({ ...VOICE_USER_PREF_DEFAULTS, enabledOverride: "off", language: "hi-IN" });
  });

  it("inherit everywhere → clinic settings unchanged", () => {
    expect(mergeVoiceSettings(clinic, VOICE_USER_PREF_DEFAULTS)).toEqual(clinic);
    expect(mergeVoiceSettings(clinic, null)).toEqual(clinic);
  });

  it("enabled can only be turned OFF by the user, never on", () => {
    expect(mergeVoiceSettings(clinic, { ...VOICE_USER_PREF_DEFAULTS, enabledOverride: "off" }).enabled).toBe(false);
    const clinicOff = { ...clinic, enabled: false };
    // there is no user value that re-enables a clinic-disabled voice layer
    expect(mergeVoiceSettings(clinicOff, VOICE_USER_PREF_DEFAULTS).enabled).toBe(false);
    expect(mergeVoiceSettings(clinicOff, { ...VOICE_USER_PREF_DEFAULTS, enabledOverride: "inherit" }).enabled).toBe(false);
  });

  it("confirmation policy can only get stricter", () => {
    expect(mergeVoiceSettings(clinic, { ...VOICE_USER_PREF_DEFAULTS, confirmationPolicy: "strict" }).confirmationPolicy).toBe("strict");
    const strictClinic = { ...clinic, confirmationPolicy: "strict" as const };
    // user "inherit" cannot weaken a strict clinic
    expect(mergeVoiceSettings(strictClinic, VOICE_USER_PREF_DEFAULTS).confirmationPolicy).toBe("strict");
  });

  it("personal ergonomics override; provider/segments stay clinic-owned", () => {
    const merged = mergeVoiceSettings(
      { ...clinic, pttKey: "Space", defaultMode: "command", language: "en-IN", autoPunctuation: true, segmentSeconds: 5, provider: "server" },
      { ...VOICE_USER_PREF_DEFAULTS, pttKey: "off", defaultMode: "dictation", language: "hi-IN", autoPunctuation: "off", inputDevice: "mic-9" },
    );
    expect(merged.pttKey).toBe("off");
    expect(merged.defaultMode).toBe("dictation");
    expect(merged.language).toBe("hi-IN");
    expect(merged.autoPunctuation).toBe(false);
    expect(merged.inputDeviceId).toBe("mic-9");
    // clinic-owned knobs pass through untouched — no per-user override exists
    expect(merged.provider).toBe("server");
    expect(merged.segmentSeconds).toBe(5);
  });
});
