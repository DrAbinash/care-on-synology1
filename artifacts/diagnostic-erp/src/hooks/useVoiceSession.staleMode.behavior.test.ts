/**
 * PR #1174 — the FieldCareMic stale-closure defect, proven at the hook level.
 *
 * FieldCareMic (the per-field Dictate button on every editor in the canonical
 * Reporting Workspace) does THREE things in one click:
 *
 *     voice.setMode("dictation");
 *     voice.setDictationTarget(target);
 *     voice.startListening("toggle");
 *
 * `startListening` binds the provider's onResult to the `handleFinalTranscript`
 * closure of the CURRENT render — which still carries the PREVIOUS mode and
 * dictation target, because React has not re-rendered between the setter calls
 * and the start call. The utterance therefore routes as whatever the mode was
 * BEFORE the click: dictation prose spoken into "Dictate into Impression"
 * gets parsed as a voice COMMAND (default mode), and after dictating into
 * Findings, the next Dictate into Impression lands in Findings.
 *
 * This test reproduces the exact one-tick sequence against a real render of
 * useVoiceSession with the deterministic injected provider, and asserts the
 * result routes per the mode and target the radiologist selected — not the
 * ones the closure happened to freeze.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceSession, type VoiceExecutionResult } from "./useVoiceSession";
import { VOICE_SETTING_DEFAULTS, type VoiceSettings, type TranscribeCapabilities } from "@/lib/voiceTranscription";
import type { VoiceContext } from "@/lib/voiceSafetyPolicy";

// The null-render probe pattern this package uses (see
// useDraftPersistence.behavior.test.ts): only the host root and event targets
// are stubbed; React, hooks and the voice session all execute unchanged.
function hostContainer(): HTMLElement {
  const document = Object.assign(new EventTarget(), {
    nodeType: 9,
    activeElement: null,
    documentElement: null,
  });
  const window = Object.assign(new EventTarget(), {
    document,
    HTMLIFrameElement: class {},
    __voiceInjectedTranscripts: [] as Array<string | { text: string; confidence?: number }>,
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return Object.assign(new EventTarget(), {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
  }) as unknown as HTMLElement;
}

type Session = ReturnType<typeof useVoiceSession>;

let root: Root | null = null;
let result: Session | null = null;
const execute = vi.fn<(parse: Parameters<Session["execute"]>[0] extends never ? never : import("@/lib/voiceCommandGrammar").ParsedVoiceCommand) => VoiceExecutionResult>(() => ({ ok: true, message: "done" }));

const settings: VoiceSettings = { ...VOICE_SETTING_DEFAULTS, enabled: true };
const capabilities: TranscribeCapabilities = { server: false, local: false };

function Probe({ studyId }: { studyId?: number }) {
  const session = useVoiceSession({
    studyId,
    settings,
    capabilities,
    getContext: (): VoiceContext => ({
      studyId: studyId ?? null,
      dirty: false,
      isLocked: false,
      lockedByOther: false,
      lockLost: false,
      canVerify: false,
      structuredFindings: false,
      requiresCatalogConfirm: () => false,
      viewerAvailable: false,
      confirmationPolicy: "standard",
    }),
    execute: (parse) => execute(parse),
    onAudit: () => {},
  });
  result = session;
  return null;
}

async function render(studyId = 41) {
  await act(async () => {
    root!.render(createElement(Probe, { studyId }));
  });
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  root = createRoot(hostContainer());
});

afterEach(async () => {
  await act(async () => { root!.unmount(); });
  result = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FieldCareMic's one-tick setMode + setDictationTarget + startListening (#1174)", () => {
  it("the first Dictate click from command mode routes the utterance as DICTATION", async () => {
    (window.__voiceInjectedTranscripts as unknown[]).push(
      "There is a subtle abnormality within the mid portion of the Achilles tendon",
    );
    await render();
    expect(result!.mode).toBe("command"); // the pre-click state

    // FieldCareMic's exact click sequence, in ONE act.
    await act(async () => {
      result!.setMode("dictation");
      result!.setDictationTarget("impression");
      result!.startListening("toggle");
    });
    await act(async () => { result!.stopListening(); });
    await settle();

    // The utterance must arrive as a dictation preview into impression —
    // not be parsed as a voice command.
    expect(result!.pending).not.toBeNull();
    expect(result!.pending?.parse.intent?.type).toBe("dictate");
    expect(
      (result!.pending?.parse.intent as { target?: string } | undefined)?.target,
    ).toBe("impression");
    expect(result!.pending?.editableText).toContain("Achilles");
  });

  it("switching the field mic re-targets: findings dictation, then impression dictation", async () => {
    await render();
    (window.__voiceInjectedTranscripts as unknown[]).push("Findings wording.");
    await act(async () => {
      result!.setMode("dictation");
      result!.setDictationTarget("findings");
      result!.startListening("toggle");
    });
    await act(async () => { result!.stopListening(); });
    await settle();
    expect((result!.pending?.parse.intent as { target?: string })?.target).toBe("findings");

    // Second field mic click — target changes in the same tick as the start.
    (window.__voiceInjectedTranscripts as unknown[]).push("Impression wording.");
    await act(async () => {
      result!.setMode("dictation");
      result!.setDictationTarget("impression");
      result!.startListening("toggle");
    });
    await act(async () => { result!.stopListening(); });
    await settle();
    expect((result!.pending?.parse.intent as { target?: string })?.target).toBe("impression");
  });

  it("a plain command capture (mode unchanged before start) still parses commands", async () => {
    (window.__voiceInjectedTranscripts as unknown[]).push("insert normal study");
    await render();
    await act(async () => { result!.startListening("ptt"); });
    await act(async () => { result!.stopListening(); });
    await settle();
    const intent = result!.pending?.parse.intent;
    expect(intent == null || intent.type !== "dictate").toBe(true);
  });
});
