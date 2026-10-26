import { describe, it, expect } from "vitest";
import {
  composerRuntimeStatusMessage,
  deterministicFallbackReason,
  isDeterministicComposeFallback,
  resolveComposeDisplayStatus,
} from "./composeDisplay";

describe("composeDisplay", () => {
  it("flags deterministic fallback proposals", () => {
    expect(isDeterministicComposeFallback({ fallbackUsed: true, model: "deterministic" })).toBe(true);
    expect(isDeterministicComposeFallback({ warnings: ["deterministic_fallback"] })).toBe(true);
    expect(isDeterministicComposeFallback({ model: "qwen3:14b", fallbackUsed: false })).toBe(false);
  });

  it("resolves FALLBACK_DRAFT vs LOCAL_AI_SUCCESS (test path)", () => {
    expect(
      resolveComposeDisplayStatus({
        ok: true,
        fallbackUsed: true,
        model: "deterministic",
      }),
    ).toBe("FALLBACK_DRAFT");
    expect(
      resolveComposeDisplayStatus({
        ok: true,
        fallbackUsed: false,
        model: "qwen3:14b",
        provider: "ollama",
      }),
    ).toBe("LOCAL_AI_SUCCESS");
    expect(
      resolveComposeDisplayStatus({
        ok: true,
        fallbackUsed: false,
        model: "qwen3.7-plus",
        provider: "qwen",
      }),
    ).toBe("CLOUD_AI_SUCCESS");
  });

  it("resolves FALLBACK_DRAFT vs AI_READY (job review path)", () => {
    expect(
      resolveComposeDisplayStatus({
        status: "READY",
        fallbackUsed: true,
        model: "deterministic",
      }),
    ).toBe("FALLBACK_DRAFT");
    expect(
      resolveComposeDisplayStatus({
        status: "READY",
        fallbackUsed: false,
        model: "qwen3:14b",
        provider: "ollama",
      }),
    ).toBe("AI_READY");
  });

  it("reports clear status when composer model is blank", () => {
    expect(composerRuntimeStatusMessage({ enabled: false, model: "" })).toBe(
      "Report Composer model not configured",
    );
    expect(composerRuntimeStatusMessage({ enabled: true, model: "qwen3:14b" })).toBeNull();
  });
});

// A deterministic fallback returns `ok: true` with a draft that reads like a
// report, and `jobService` writes `safeError: null` on the READY path — so this
// sentence is the ONLY trace of the cause that reaches the browser. It has to
// carry both halves: that no AI wrote the draft, and what to change.
describe("deterministicFallbackReason", () => {
  const CONFIGURED = { runtimeEnabled: true, modelConfigured: true };

  it("names a missing composer model rather than blaming the model", () => {
    const reason = deterministicFallbackReason({ runtimeEnabled: true, modelConfigured: false });
    expect(reason).toMatch(/No Report Composer model is set/);
    expect(reason).toMatch(/AI Reporting Settings → Local AI/);
    expect(reason).not.toMatch(/timeout/i);
  });

  it("names a switched-off Local AI Assistant when a model IS set", () => {
    const reason = deterministicFallbackReason({ runtimeEnabled: false, modelConfigured: true });
    expect(reason).toMatch(/Local AI Assistant is switched off/);
    // The whole defect: the banner used to tell this operator to configure a
    // model they had already configured.
    expect(reason).not.toMatch(/No Report Composer model is set/);
  });

  it("says so when both are wrong, because enabling alone will not fix it", () => {
    const reason = deterministicFallbackReason({ runtimeEnabled: false, modelConfigured: false });
    expect(reason).toMatch(/switched off and no Report Composer model is set/);
  });

  it("turns the adapter's bare timeout code into a sentence naming the setting", () => {
    const reason = deterministicFallbackReason({ ...CONFIGURED, safeError: "ollama_timeout" });
    expect(reason).toMatch(/did not answer within the compose timeout/);
    expect(reason).toMatch(/Timeout \(sec\) in AI Reporting Settings → Local AI/);
    expect(reason).not.toBe("ollama_timeout");
  });

  it("separates an unreachable server from a slow one — different fixes", () => {
    const reason = deterministicFallbackReason({ ...CONFIGURED, safeError: "ollama_unreachable" });
    expect(reason).toMatch(/could not reach the local AI server/);
    expect(reason).toMatch(/Ollama endpoint/);
    expect(reason).not.toMatch(/compose timeout/);
  });

  it("names a model the server does not have", () => {
    const reason = deterministicFallbackReason({
      ...CONFIGURED,
      detail: 'model "qwen3:14b" not found, try pulling it first',
    });
    expect(reason).toMatch(/does not have that model installed/);
    expect(reason).toMatch(/Pull it/);
  });

  it("keeps a detail the adapter already wrote for a clinician", () => {
    const detail = "Ollama rejected the request as larger than its context window.";
    const reason = deterministicFallbackReason({
      ...CONFIGURED,
      safeError: "composer_context_budget_exceeded",
      detail,
    });
    expect(reason).toContain(detail);
    expect(reason).toMatch(/No AI wrote this draft/);
  });

  it("still says no AI wrote the draft when nothing is known about the failure", () => {
    const reason = deterministicFallbackReason({ ...CONFIGURED });
    expect(reason).toMatch(/did not answer/);
    expect(reason).toMatch(/no AI wrote this draft/i);
  });

  it("never returns a bare code, and never omits that the draft is not AI", () => {
    // The generalisation of the two defects above: before this, the timeout path
    // returned the literal string "ollama_timeout" and the unconfigured path
    // returned nothing at all.
    const inputs = [
      { runtimeEnabled: false, modelConfigured: false },
      { runtimeEnabled: false, modelConfigured: true },
      { runtimeEnabled: true, modelConfigured: false },
      { ...CONFIGURED },
      { ...CONFIGURED, safeError: "ollama_timeout" },
      { ...CONFIGURED, safeError: "ollama_unreachable" },
      { ...CONFIGURED, safeError: "compose_failed" },
      { ...CONFIGURED, safeError: "empty_model_response", detail: "The model returned no content." },
    ];
    for (const input of inputs) {
      const reason = deterministicFallbackReason(input);
      expect(reason, JSON.stringify(input)).toBeTruthy();
      expect(reason, JSON.stringify(input)).not.toMatch(/^[a-z0-9_]+$/i);
      expect(reason, JSON.stringify(input)).toMatch(/AI wrote this draft/);
      // A sentence, not a fragment: it ends with a full stop.
      expect(reason.trim().endsWith("."), JSON.stringify(input)).toBe(true);
    }
  });
});
