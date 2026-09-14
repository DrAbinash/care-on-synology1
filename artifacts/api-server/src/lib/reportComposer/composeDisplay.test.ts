import { describe, it, expect } from "vitest";
import {
  composerRuntimeStatusMessage,
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
