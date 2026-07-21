import { describe, it, expect } from "vitest";
import { requestStructuredReport, type GatewayDeps } from "./gateway";
import type { ProviderChoice } from "./capabilityLogic";

const validJson = (uid: string) => JSON.stringify({
  studyContext: { studyInstanceUid: uid, imageCount: 1 },
  findings: [], measurements: [], impression: [],
});

function choice(provider: string, isLocal = true): ProviderChoice {
  return { provider, model: `${provider}-m`, modelDigest: `${provider}-d`, isLocal, phiEligible: true };
}

function deps(overrides: Partial<GatewayDeps>): Partial<GatewayDeps> {
  return {
    circuitState: async () => "closed",
    recordHealth: async () => {},
    resolveDigest: async () => null,
    now: () => 0,
    ...overrides,
  };
}

const baseReq = { taskKey: "radiology_draft", studyInstanceUid: "ST1", prompt: "p", promptVersion: "v1" };

describe("AI Gateway orchestration (G7)", () => {
  it("returns a validated report on success", async () => {
    const r = await requestStructuredReport(baseReq, deps({
      selectChain: async () => [choice("ollama")],
      call: async () => ({ success: true, text: validJson("ST1") }),
    }));
    expect(r.degraded).toBe(false);
    expect(r.provider).toBe("ollama");
    expect(r.modelDigest).toBe("ollama-d");
  });

  it("degrades (never throws) when there is no eligible provider", async () => {
    const r = await requestStructuredReport(baseReq, deps({ selectChain: async () => [] }));
    expect(r.degraded).toBe(true);
    expect(r.report.findings).toEqual([]);
    expect(r.detail).toMatch(/no eligible provider/);
  });

  it("skips a provider whose breaker is open and falls back to the next", async () => {
    const calls: string[] = [];
    const r = await requestStructuredReport(baseReq, deps({
      selectChain: async () => [choice("ollama"), choice("gemini", false)],
      circuitState: async (p) => (p === "ollama" ? "open" : "closed"),
      call: async ({ provider }) => { calls.push(provider); return { success: true, text: validJson("ST1") }; },
    }));
    expect(calls).toEqual(["gemini"]); // ollama skipped (breaker open)
    expect(r.provider).toBe("gemini");
  });

  it("falls back to the next provider when the first fails", async () => {
    const calls: string[] = [];
    const r = await requestStructuredReport(baseReq, deps({
      selectChain: async () => [choice("ollama"), choice("gemini", false)],
      call: async ({ provider }) => {
        calls.push(provider);
        return provider === "ollama" ? { success: false, text: "", error: "boom" } : { success: true, text: validJson("ST1") };
      },
      maxAttempts: 1,
    } as Partial<GatewayDeps>));
    expect(r.provider).toBe("gemini");
    expect(calls).toContain("ollama");
  });

  it("degrades when every provider returns invalid contract JSON", async () => {
    const r = await requestStructuredReport(baseReq, deps({
      selectChain: async () => [choice("ollama")],
      call: async () => ({ success: true, text: "totally not json" }),
    }));
    expect(r.degraded).toBe(true);
    expect(r.detail).toMatch(/deterministic-only/);
  });

  it("passes phiPresent=true to the chain selector when images are present", async () => {
    let sawPhi: boolean | undefined;
    await requestStructuredReport({ ...baseReq, images: ["base64data"] }, deps({
      selectChain: async (_t, _r, phi) => { sawPhi = phi; return [choice("ollama")]; },
      call: async () => ({ success: true, text: validJson("ST1") }),
    }));
    expect(sawPhi).toBe(true);
  });
});
