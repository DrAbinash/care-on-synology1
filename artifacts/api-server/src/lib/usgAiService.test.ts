import { describe, it, expect } from "vitest";
import { generateUsgSuggestions, acceptUsgSuggestion, type UsgAiProvider, type RawAiSuggestion } from "./usgAiService";
import { buildUsgAiSuggestion, AiWriteViolationError } from "./usgAiAssistant";

// A resolved Enablement, as the canonical resolveAiEnablementForUser would return.
const enablement = (globalMasterOn: boolean, mode: "shadow" | "pilot" | "production" = "pilot") => {
  if (!globalMasterOn) return { enabled: false, mode: "shadow" as const, visibleToRadiologist: false, reason: "global master off" };
  const visibleToRadiologist = mode === "pilot" || mode === "production";
  return { enabled: true, mode, visibleToRadiologist, reason: "global:*" };
};

const provider = (raw: RawAiSuggestion[], available = true): UsgAiProvider => ({
  available: async () => available,
  generate: async () => raw,
});

const RAW: RawAiSuggestion = { kind: "finding", section: "Liver", text: "Hepatomegaly.", rationale: "span 17cm", confidence: 0.8 };

describe("P8 usgAiService — visibility + availability (honest states)", () => {
  it("hides AI when the global master is OFF", async () => {
    const r = await generateUsgSuggestions(provider([RAW]), enablement(false), {});
    expect(r.visible).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it("hides AI in shadow mode (not visible to radiologist)", async () => {
    const r = await generateUsgSuggestions(provider([RAW]), enablement(true, "shadow"), {});
    expect(r.visible).toBe(false);
  });

  it("reports unavailable (no fabrication) when the gateway is down", async () => {
    const r = await generateUsgSuggestions(provider([RAW], false), enablement(true), {});
    expect(r.visible).toBe(true);
    expect(r.available).toBe(false);
    expect(r.suggestions).toEqual([]);
    expect(r.reason).toMatch(/unavailable/i);
  });

  it("returns validated accept-only suggestions when visible + available", async () => {
    const r = await generateUsgSuggestions(provider([RAW]), enablement(true), {});
    expect(r.suggestions.length).toBe(1);
    expect(r.suggestions[0].writeTarget).toBe("draft_suggestion");
    expect(r.suggestions[0].requiresHumanAcceptance).toBe(true);
  });

  it("DROPS a suggestion containing fetal sex (PCPNDT), never surfaces it", async () => {
    const bad: RawAiSuggestion = { kind: "finding", text: "Male fetus.", rationale: "r", confidence: 0.9 };
    const r = await generateUsgSuggestions(provider([bad, RAW]), enablement(true), {});
    expect(r.suggestions.length).toBe(1); // only the safe one
    expect(r.suggestions[0].text).toBe("Hepatomegaly.");
  });
});

describe("P8 usgAiService — accept boundary (the ONLY write path)", () => {
  const good = buildUsgAiSuggestion(RAW);

  it("appends to a draft on accept, non-destructively", () => {
    const r = acceptUsgSuggestion("Liver enlarged.", good, true);
    expect(r.changed).toBe(true);
    expect(r.text).toBe("Liver enlarged.\nHepatomegaly.");
  });

  it("does nothing unless accepted", () => {
    expect(acceptUsgSuggestion("x", good, false).changed).toBe(false);
  });

  it("THROWS AiWriteViolationError if a suggestion is forged to target a signed report", () => {
    const forged = { ...good, writeTarget: "patient_reports" as unknown as typeof good.writeTarget };
    expect(() => acceptUsgSuggestion("", forged, true)).toThrow(AiWriteViolationError);
  });
});
