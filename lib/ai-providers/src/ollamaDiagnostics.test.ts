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
      think: false,
    });
    expect(result.success).toBe(false);
    expect(result.diagnostics?.resolvedEndpoint).toBe("http://172.16.1.140:11434");
    expect(result.diagnostics?.model).toBe("qwen3-vl:8b");
    expect(result.diagnostics?.numberOfImages).toBe(1);
    expect(result.diagnostics?.timeoutMsConfigured).toBe(1000);
    expect(result.diagnostics?.timeoutStage).toBe("provider_http");
    expect(result.diagnostics?.errorCode).toBe("TIMEOUT_OR_ABORT");
    expect(result.diagnostics?.thinkSent).toBe(true);
    expect(result.diagnostics?.thinkValue).toBe(false);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/connectivity test/);
  });

  it("records Ollama duration/eval/thinking metadata without response text", async () => {
    const { createAiProvider } = await import("./index");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: { content: "FINDINGS:\nOK\nIMPRESSION:\nOK", thinking: "x".repeat(50) },
        done: true,
        done_reason: "stop",
        total_duration: 12_000_000_000,
        load_duration: 1_000_000_000,
        prompt_eval_count: 100,
        eval_count: 40,
      }),
    })) as unknown as typeof fetch;

    const provider = await createAiProvider("ollama", undefined, "http://172.16.1.140:11434");
    const result = await provider!.query({
      model: "qwen3-vl:8b",
      prompt: "x",
      images: ["aaaa"],
      // omit think — matches /api/ai-reporting/draft
    });
    expect(result.success).toBe(true);
    expect(result.diagnostics?.thinkSent).toBe(false);
    expect(result.diagnostics?.thinkingLength).toBe(50);
    expect(result.diagnostics?.ollamaTotalDurationNs).toBe(12_000_000_000);
    expect(result.diagnostics?.ollamaEvalCount).toBe(40);
    expect(result.diagnostics?.requestBodyBytes).toBeGreaterThan(0);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/FINDINGS|xxxxx/);
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
