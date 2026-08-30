import { describe, it, expect } from "vitest";
import { evaluateVoiceCommand } from "./voiceSafetyPolicy";
import type { ParsedVoiceCommand } from "./voiceCommandGrammar";
import { isStaleVoiceResult } from "./voiceSessionState";

function dictateParse(text: string): ParsedVoiceCommand {
  return {
    rawTranscript: text,
    normalizedTranscript: text,
    intent: { type: "dictate", target: "findings", mode: "append", text },
    parameters: { text },
    confidenceBand: "CLEAR",
    alternatives: [],
    parseErrors: [],
  };
}

describe("voice dictation safety — finalized / study switch", () => {
  it("blocks dictate when report is finalized (isLocked context)", () => {
    const verdict = evaluateVoiceCommand(dictateParse("mild disc bulge"), {
      studyId: 1,
      dirty: false,
      isLocked: true,
      lockedByOther: false,
      lockLost: false,
      canVerify: false,
      structuredFindings: false,
      viewerAvailable: true,
      confirmationPolicy: "standard",
    });
    expect(verdict.blocked).toMatch(/finalized|read-only/i);
  });

  it("allows dictate when report is editable", () => {
    const verdict = evaluateVoiceCommand(dictateParse("mild disc bulge"), {
      studyId: 1,
      dirty: false,
      isLocked: false,
      lockedByOther: false,
      lockLost: false,
      canVerify: false,
      structuredFindings: false,
      viewerAvailable: true,
      confirmationPolicy: "standard",
    });
    expect(verdict.blocked).toBeNull();
  });

  it("study switch makes prior capture binding stale (no transcript transfer)", () => {
    const bound = { studyId: 10, nonce: 2 };
    expect(isStaleVoiceResult(bound, 10, 2)).toBe(false);
    expect(isStaleVoiceResult(bound, 11, 2)).toBe(true);
    // Nonce bump on study change also stale-ifies in-flight results
    expect(isStaleVoiceResult(bound, 11, 3)).toBe(true);
  });
});
