import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

const { buildOllamaChatPayload, stripThinkBlocks, createAiProvider } = await import("./index");

describe("buildOllamaChatPayload — overnight MRI native /api/chat", () => {
  it("puts model, options.num_ctx, think=false, and images on the request body", () => {
    const body = buildOllamaChatPayload({
      model: "qwen3-vl:8b",
      prompt: "draft this MRI",
      images: ["data:image/jpeg;base64,abc123", "def456"],
      numCtx: 16384,
      think: false,
      temperature: 0.1,
      maxTokens: 4096,
    });
    expect(body.model).toBe("qwen3-vl:8b");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.options).toEqual({
      num_ctx: 16384,
      temperature: 0.1,
      num_predict: 4096,
    });
    const messages = body.messages as Array<{ images?: string[]; content: string }>;
    expect(messages[0].content).toBe("draft this MRI");
    expect(messages[0].images).toEqual(["abc123", "def456"]);
  });
});

describe("stripThinkBlocks", () => {
  it("removes <think>…</think> even when think=false was ignored", () => {
    const raw = "<think>long reasoning about edema</think>\n{\"findings\":[]}";
    expect(stripThinkBlocks(raw)).toBe("{\"findings\":[]}");
    expect(stripThinkBlocks(raw)).not.toMatch(/<think>/i);
  });
});

describe("OllamaProvider.query posts native /api/chat payload", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("sends qwen3-vl:8b + num_ctx 16384 + think false and strips think from the response", async () => {
    let capturedUrl = "";
    let captured: Record<string, unknown> = {};
    global.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      captured = JSON.parse(String((init as RequestInit).body));
      return {
        ok: true,
        json: async () => ({
          message: { content: "<think>hidden</think>{\"impression\":[\"limited review\"]}" },
        }),
      };
    }) as unknown as typeof fetch;

    const p = await createAiProvider("ollama", undefined, "http://192.168.1.250:11434");
    const r = await p!.query({
      model: "qwen3-vl:8b",
      prompt: "MRI draft",
      images: [],
      numCtx: 16384,
      think: false,
    });

    expect(capturedUrl).toBe("http://192.168.1.250:11434/api/chat");
    expect(captured.model).toBe("qwen3-vl:8b");
    expect(captured.think).toBe(false);
    expect((captured.options as { num_ctx: number }).num_ctx).toBe(16384);
    expect(r.success).toBe(true);
    expect(r.text).not.toMatch(/<think>/i);
    expect(r.text).toContain("limited review");
  });
});
