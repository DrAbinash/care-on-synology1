import { describe, it, expect } from "vitest";
import { resolveAiEnablement, type AiPolicyRow, type EnablementContext } from "./aiPolicy";

const ctx = (over: Partial<EnablementContext> = {}): EnablementContext => ({ globalMasterOn: true, staffId: 7, modality: "CT", studyType: "ct-brain", hospitalKey: "h1", ...over });

describe("AI enablement policy — default OFF + pilot-only (G11 safety)", () => {
  it("is OFF for everyone when the global master flag is off", () => {
    const rows: AiPolicyRow[] = [{ scope: "radiologist", scopeKey: "7", enabled: true, mode: "production" }];
    const r = resolveAiEnablement(rows, ctx({ globalMasterOn: false }));
    expect(r.enabled).toBe(false);
    expect(r.visibleToRadiologist).toBe(false);
  });

  it("is OFF by default when no policy matches (master on)", () => {
    expect(resolveAiEnablement([], ctx()).enabled).toBe(false);
  });

  it("enables shadow globally without making it visible to radiologists", () => {
    const rows: AiPolicyRow[] = [{ scope: "global", scopeKey: "*", enabled: true, mode: "shadow" }];
    const r = resolveAiEnablement(rows, ctx());
    expect(r.enabled).toBe(true);
    expect(r.visibleToRadiologist).toBe(false); // shadow: computed, never shown
  });

  it("enables a single pilot radiologist (visible)", () => {
    const rows: AiPolicyRow[] = [{ scope: "radiologist", scopeKey: "7", enabled: true, mode: "pilot" }];
    const r = resolveAiEnablement(rows, ctx());
    expect(r.visibleToRadiologist).toBe(true);
    expect(resolveAiEnablement(rows, ctx({ staffId: 999 })).visibleToRadiologist).toBe(false); // other users off
  });

  it("most-specific-wins: a radiologist disable overrides a global enable", () => {
    const rows: AiPolicyRow[] = [
      { scope: "global", scopeKey: "*", enabled: true, mode: "production" },
      { scope: "radiologist", scopeKey: "7", enabled: false, mode: "shadow" },
    ];
    expect(resolveAiEnablement(rows, ctx()).enabled).toBe(false);
    expect(resolveAiEnablement(rows, ctx({ staffId: 8 })).enabled).toBe(true); // other user follows global
  });

  it("resolves per-modality and per-study-type policies", () => {
    const rows: AiPolicyRow[] = [{ scope: "modality", scopeKey: "MR", enabled: true, mode: "pilot" }];
    expect(resolveAiEnablement(rows, ctx({ modality: "MR" })).enabled).toBe(true);
    expect(resolveAiEnablement(rows, ctx({ modality: "CT" })).enabled).toBe(false);
  });
});
