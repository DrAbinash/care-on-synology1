/**
 * Ollama names a too-large request explicitly. The composer adapter used to
 * throw that answer away and report `ollama_http_400`, which told the
 * radiologist nothing about what to do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";

// Production code uses hardenedLocalRequest (DNS-pinned transport) instead of
// bare fetch. Delegate to global.fetch so existing mocks work.
vi.mock("@workspace/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/ai-providers")>();
  return {
    ...actual,
    hardenedLocalRequest: async (url: string, init?: RequestInit) => {
      const response = await globalThis.fetch(url, init);
      return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
    },
  };
});

const CONTEXT_ERROR = JSON.stringify({
  error: {
    code: "exceed_context_size_error",
    model_name: "qwen3-vl:8b",
    n_prompt_tokens: 8317,
    n_ctx: 8192,
    message: "exceed_context_size_error: the request (8317 tokens) exceeds the available context size (8192 tokens)",
  },
});

const baseRequest = {
  systemPrompt: "system",
  userPrompt: "user",
  model: "qwen3-vl:8b",
  temperature: 0.1,
  timeoutMs: 5_000,
  numCtx: 8192,
  endpoint: "http://127.0.0.1:11434",
  localOnly: true,
  images: [{ mimeType: "image/jpeg" as const, base64: "AAAJPEG" }],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OllamaComposerAdapter context-overflow naming", () => {
  it("turns an HTTP 400 exceed_context_size_error into composer_context_budget_exceeded", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => CONTEXT_ERROR });
    const res = await new OllamaComposerAdapter().compose(baseRequest);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.safeError).toBe("composer_context_budget_exceeded");
    expect(res.detail).toMatch(/8317/);
    expect(res.detail).toMatch(/8192/);
    expect(res.detail).toMatch(/fewer key images/i);
  });

  it("keeps plain HTTP failures named by status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "gpu out of memory" });
    const res = await new OllamaComposerAdapter().compose(baseRequest);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.safeError).toBe("ollama_http_500");
    expect(res.detail).toBeUndefined();
  });

  it("recognises a context error surfaced through the thrown message", async () => {
    fetchMock.mockRejectedValue(new Error(CONTEXT_ERROR));
    const res = await new OllamaComposerAdapter().compose(baseRequest);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.safeError).toBe("composer_context_budget_exceeded");
  });

  it("still reports timeouts and unreachable servers as before", async () => {
    fetchMock.mockRejectedValue(new Error("This operation was aborted due to timeout"));
    const timeout = await new OllamaComposerAdapter().compose(baseRequest);
    expect(!timeout.ok && timeout.safeError).toBe("ollama_timeout");

    fetchMock.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
    const down = await new OllamaComposerAdapter().compose(baseRequest);
    expect(!down.ok && down.safeError).toBe("ollama_unreachable");
  });

  it("forwards the requested num_ctx for a successful vision compose", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: "{\"findings\":\"F\"}" } }),
    });
    const res = await new OllamaComposerAdapter().compose({ ...baseRequest, numCtx: 6878 });
    expect(res.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.options.num_ctx).toBe(6878);
    expect(body.messages[1].images).toEqual(["AAAJPEG"]);
  });

  it("survives an unreadable error body without inventing an error name", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => { throw new Error("stream broken"); } });
    const res = await new OllamaComposerAdapter().compose(baseRequest);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.safeError).toBe("ollama_http_502");
  });
});
