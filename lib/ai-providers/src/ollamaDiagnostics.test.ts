import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

const { estimateBase64DecodedBytes, buildOllamaChatPayload } = await import("./index");

describe("estimateBase64DecodedBytes", () => {
  it("estimates decoded size from base64 length", () => {
    // "aaaa" -> 3 bytes
    expect(estimateBase64DecodedBytes("aaaa")).toBe(3);
  });

  it("strips data-url prefix", () => {
    expect(estimateBase64DecodedBytes("data:image/jpeg;base64,aaaa")).toBe(3);
  });
});

describe("OllamaProvider query diagnostics", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("records PHI-safe failure diagnostics including timeout stage", async () => {
    const { createAiProvider } = await import("./index");
    global.fetch = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;

    const provider = await createAiProvider("ollama", undefined, "http://172.16.1.140:11434");
    expect(provider).not.toBeNull();
    const result = await provider!.query({
      model: "qwen3-vl:8b",
      prompt: "connectivity test",
      images: ["aaaa"],
      timeoutMs: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.diagnostics?.resolvedEndpoint).toBe("http://172.16.1.140:11434");
    expect(result.diagnostics?.model).toBe("qwen3-vl:8b");
    expect(result.diagnostics?.numberOfImages).toBe(1);
    expect(result.diagnostics?.timeoutMsConfigured).toBe(1000);
    expect(result.diagnostics?.timeoutStage).toBe("provider_http");
    expect(result.diagnostics?.errorCode).toBe("TIMEOUT_OR_ABORT");
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/connectivity test/);
  });

  it("buildOllamaChatPayload still strips data-url images", () => {
    const body = buildOllamaChatPayload({
      model: "qwen3-vl:8b",
      prompt: "x",
      images: ["data:image/jpeg;base64,abcd"],
      think: false,
    });
    const msg = (body.messages as Array<{ images?: string[] }>)[0];
    expect(msg?.images?.[0]).toBe("abcd");
  });
});
