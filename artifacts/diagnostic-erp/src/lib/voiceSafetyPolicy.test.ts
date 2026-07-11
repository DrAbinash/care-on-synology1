import { describe, it, expect } from "vitest";
import { parseVoiceTranscript } from "./voiceCommandGrammar";
import { evaluateVoiceCommand, shouldAuditVoiceCommand, type VoiceContext } from "./voiceSafetyPolicy";

// Ticket M1.6B2 Phase 5/6 — safety classes + context gates. Voice is only
// ever MORE restrictive than keyboard/mouse: the dispatcher handlers keep
// their own guards underneath these.

const ctx = (over: Partial<VoiceContext> = {}): VoiceContext => ({
  studyId: 7, dirty: false, isLocked: false, lockedByOther: false, lockLost: false,
  canVerify: true, structuredFindings: false, viewerAvailable: true,
  confirmationPolicy: "standard",
  ...over,
});

const evaluate = (phrase: string, c: VoiceContext = ctx()) =>
  evaluateVoiceCommand(parseVoiceTranscript(phrase), c);

describe("safety classes (Phase 6)", () => {
  it("SAFE_IMMEDIATE: focus fields, search, refresh, close panel, viewer ops", () => {
    for (const phrase of ["focus findings", "focus impression", "quick search", "close panel", "refresh queue", "search finding disc", "zoom in", "open study"]) {
      const v = evaluate(phrase);
      expect(v.safetyClass, phrase).toBe("SAFE_IMMEDIATE");
      expect(v.requiresConfirmation, phrase).toBe(false);
    }
  });

  it("REVERSIBLE_EDIT: append text, quick select/remove, modifiers, park/unpark, save, clean next/previous", () => {
    for (const phrase of ["add finding trace effusion", "impression stable", "select finding disc bulge", "remove finding disc bulge", "laterality left", "park study", "unpark", "save draft", "next study", "previous study"]) {
      const v = evaluate(phrase);
      expect(v.safetyClass, phrase).toBe("REVERSIBLE_EDIT");
      expect(v.requiresConfirmation, phrase).toBe(false);
    }
  });

  it("CONFIRM_REQUIRED: replace text, DIRTY next/previous, reload, verify", () => {
    for (const phrase of ["replace findings with normal study", "replace impression with clear"]) {
      expect(evaluate(phrase).safetyClass, phrase).toBe("CONFIRM_REQUIRED");
    }
    expect(evaluate("next study", ctx({ dirty: true })).safetyClass).toBe("CONFIRM_REQUIRED");
    expect(evaluate("previous study", ctx({ dirty: true })).safetyClass).toBe("CONFIRM_REQUIRED");
    expect(evaluate("reload current").safetyClass).toBe("CONFIRM_REQUIRED");
    expect(evaluate("verify report").safetyClass).toBe("CONFIRM_REQUIRED");
    expect(evaluate("verify report").requiresConfirmation).toBe(true);
  });

  it("HIGH_RISK: finalize/sign — confirmation required and Enter NEVER confirms", () => {
    for (const phrase of ["finalize", "sign report", "sign off"]) {
      const v = evaluate(phrase);
      expect(v.safetyClass, phrase).toBe("HIGH_RISK");
      expect(v.requiresConfirmation, phrase).toBe(true);
      expect(v.confirmViaEnterAllowed, phrase).toBe(false);
    }
    // CONFIRM_REQUIRED still allows Enter — only HIGH_RISK excludes it.
    expect(evaluate("verify report").confirmViaEnterAllowed).toBe(true);
  });

  it("strict policy also confirms REVERSIBLE_EDIT, never SAFE_IMMEDIATE", () => {
    const strict = ctx({ confirmationPolicy: "strict" });
    expect(evaluate("add finding x", strict).requiresConfirmation).toBe(true);
    expect(evaluate("select finding disc bulge", strict).requiresConfirmation).toBe(true);
    expect(evaluate("focus findings", strict).requiresConfirmation).toBe(false);
  });
});

describe("context gates (Phase 5)", () => {
  it("edits blocked while locked by another user — with the read-only reason", () => {
    const locked = ctx({ isLocked: true, lockedByOther: true });
    for (const phrase of ["add finding x", "select finding disc", "remove finding disc", "laterality left", "save", "replace impression with y"]) {
      expect(evaluate(phrase, locked).blocked, phrase).toMatch(/locked by another user/i);
    }
    // reading/navigation stays allowed
    expect(evaluate("focus findings", locked).blocked).toBeNull();
    expect(evaluate("next study", locked).blocked).toBeNull();
    expect(evaluate("search finding disc", locked).blocked).toBeNull();
  });

  it("finalized report blocks edits with the finalized reason", () => {
    const done = ctx({ isLocked: true });
    expect(evaluate("add finding x", done).blocked).toMatch(/finalized/i);
    expect(evaluate("finalize", done).blocked).toMatch(/already finalized/i);
  });

  it("voice finalize blocked on foreign lock AND on lost lock", () => {
    expect(evaluate("finalize", ctx({ lockedByOther: true, isLocked: true })).blocked).toMatch(/locked by another user/i);
    expect(evaluate("finalize", ctx({ lockLost: true })).blocked).toMatch(/lock expired/i);
  });

  it("verify blocked without permission (server re-enforces regardless)", () => {
    expect(evaluate("verify report", ctx({ canVerify: false })).blocked).toMatch(/not available/i);
    expect(evaluate("verify report", ctx({ canVerify: true })).blocked).toBeNull();
  });

  it("findings dictation blocked in structured mode; impression/recommendation still fine", () => {
    const structured = ctx({ structuredFindings: true });
    expect(evaluate("add finding x", structured).blocked).toMatch(/structured mode/i);
    expect(evaluate("impression stable", structured).blocked).toBeNull();
    expect(evaluate("add recommendation follow up", structured).blocked).toBeNull();
  });

  it("viewer ops blocked when the embedded viewer is not mounted; unsupported ops always blocked", () => {
    expect(evaluate("zoom in", ctx({ viewerAvailable: false })).blocked).toMatch(/not open/i);
    expect(evaluate("zoom in", ctx({ viewerAvailable: true })).blocked).toBeNull();
    expect(evaluate("window brain").blocked).toMatch(/does not support/i);
    expect(evaluate("length measurement").blocked).toMatch(/does not support/i);
  });
});

describe("non-CLEAR parses never execute (low-confidence rule)", () => {
  it("ambiguous and unrecognized input is blocked outright", () => {
    expect(evaluate("finding pleural effusion").blocked).toMatch(/ambiguous/i);
    expect(evaluate("make me a sandwich").blocked).toMatch(/not recognized/i);
  });

  it("a low-confidence CLEAR match arrives demoted and therefore blocked from silent execution", () => {
    const parse = parseVoiceTranscript("finalize", { providerConfidence: 0.2 });
    expect(parse.confidenceBand).toBe("AMBIGUOUS");
    expect(evaluateVoiceCommand(parse, ctx()).blocked).toMatch(/ambiguous/i);
  });
});

describe("audit scope (Phase 11)", () => {
  it("only finalize and verify voice attempts are audited", () => {
    expect(shouldAuditVoiceCommand(parseVoiceTranscript("finalize").intent)).toBe(true);
    expect(shouldAuditVoiceCommand(parseVoiceTranscript("verify report").intent)).toBe(true);
    expect(shouldAuditVoiceCommand(parseVoiceTranscript("save draft").intent)).toBe(false);
    expect(shouldAuditVoiceCommand(parseVoiceTranscript("add finding x").intent)).toBe(false);
    expect(shouldAuditVoiceCommand(null)).toBe(false);
  });
});
