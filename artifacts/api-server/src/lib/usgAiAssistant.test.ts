import { describe, it, expect } from "vitest";
import {
  buildUsgAiSuggestion, assertAiWriteAllowed, gateUsgAiVisibility,
  acceptSuggestionIntoDraft, AiWriteViolationError,
} from "./usgAiAssistant";
import type { Enablement } from "./ai/aiPolicy";

const enablement = (over: Partial<Enablement> = {}): Enablement => ({
  enabled: true, mode: "pilot", visibleToRadiologist: true, reason: "radiologist:7", ...over,
});

describe("P8 usgAiAssistant — hard write guard", () => {
  it("allows only the draft_suggestion target", () => {
    expect(() => assertAiWriteAllowed("draft_suggestion")).not.toThrow();
  });

  it("THROWS for patient_reports / finalize / sign — no override", () => {
    for (const t of ["patient_reports", "finalize", "sign", "signed_report", "draft"]) {
      expect(() => assertAiWriteAllowed(t)).toThrow(AiWriteViolationError);
    }
  });
});

describe("P8 usgAiAssistant — suggestion construction invariants", () => {
  it("every suggestion is accept-only and targets a draft", () => {
    const s = buildUsgAiSuggestion({ kind: "finding", section: "Liver", text: "Hepatomegaly.", rationale: "span 17cm", confidence: 0.8 });
    expect(s.writeTarget).toBe("draft_suggestion");
    expect(s.status).toBe("suggested");
    expect(s.requiresHumanAcceptance).toBe(true);
    expect(s.confidence).toBe(0.8);
  });

  it("clamps confidence to [0,1]", () => {
    expect(buildUsgAiSuggestion({ kind: "impression", text: "x", rationale: "y", confidence: 5 }).confidence).toBe(1);
    expect(buildUsgAiSuggestion({ kind: "impression", text: "x", rationale: "y", confidence: -1 }).confidence).toBe(0);
  });

  it("blocks any fetal sex / gender content (PCPNDT)", () => {
    for (const bad of ["Male fetus.", "The gender is apparent.", "fetal sex visible"]) {
      expect(() => buildUsgAiSuggestion({ kind: "finding", text: bad, rationale: "r", confidence: 0.5 })).toThrow(/PCPNDT/);
    }
  });
});

describe("P8 usgAiAssistant — visibility reuses the canonical enablement", () => {
  it("hidden unless the canonical policy makes AI visible", () => {
    expect(gateUsgAiVisibility(enablement({ visibleToRadiologist: false })).visible).toBe(false);
    expect(gateUsgAiVisibility(enablement({ visibleToRadiologist: true })).visible).toBe(true);
  });
});

describe("P8 usgAiAssistant — acceptance is explicit and non-destructive", () => {
  const s = buildUsgAiSuggestion({ kind: "finding", section: "Liver", text: "Hepatomegaly.", rationale: "span 17cm", confidence: 0.8 });

  it("does nothing unless the human accepts", () => {
    const r = acceptSuggestionIntoDraft("Liver normal.", s, false);
    expect(r.changed).toBe(false);
    expect(r.text).toBe("Liver normal.");
  });

  it("appends on accept without overwriting existing radiologist text", () => {
    const r = acceptSuggestionIntoDraft("Liver span increased.", s, true);
    expect(r.changed).toBe(true);
    expect(r.preservedExisting).toBe(true);
    expect(r.text).toBe("Liver span increased.\nHepatomegaly.");
  });

  it("is idempotent — does not duplicate already-present text", () => {
    const r = acceptSuggestionIntoDraft("Hepatomegaly.", s, true);
    expect(r.changed).toBe(false);
    expect(r.text).toBe("Hepatomegaly.");
  });

  it("fills empty text on accept", () => {
    const r = acceptSuggestionIntoDraft("", s, true);
    expect(r.text).toBe("Hepatomegaly.");
    expect(r.preservedExisting).toBe(false);
  });
});
