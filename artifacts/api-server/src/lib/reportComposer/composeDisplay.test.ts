import { describe, it, expect } from "vitest";
import {
  composerRuntimeStatusMessage,
  isDeterministicComposeFallback,
  resolveComposeDisplayStatus,
} from "./composeDisplay";

describe("composeDisplay", () => {
  it("flags deterministic fallback", () => {
    expect(isDeterministicComposeFallback({ fallbackUsed: true, model: "deterministic" })).toBe(true);
    expect(isDeterministicComposeFallback({ model: "gemma3:12b", fallbackUsed: false })).toBe(false);
  });

  it("resolves LOCAL_AI_SUCCESS vs FALLBACK_DRAFT", () => {
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
        model: "gemma3:12b",
        provider: "ollama",
      }),
    ).toBe("LOCAL_AI_SUCCESS");
  });

  it("reports clear status when composer model blank", () => {
    expect(composerRuntimeStatusMessage({ enabled: false, model: "" })).toBe(
      "Report Composer model not configured",
    );
  });
});
