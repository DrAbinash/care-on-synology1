import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";
import { resolveComposerProvider, parseComposerProviderName } from "./resolveComposerProvider";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { DeepSeekComposerAdapter } from "./deepseekComposerAdapter";
import { OpenAiComposerAdapter } from "./openaiComposerAdapter";

describe("assertComposerProviderPolicy", () => {
  it("allows Ollama TEXT_ONLY", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(r).toEqual({ ok: true });
  });

  it("allows Ollama SELECTED_IMAGES with images", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "SELECTED_IMAGES",
      imageCount: 2,
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects Ollama SELECTED_IMAGES with zero images", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "SELECTED_IMAGES",
      imageCount: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_empty");
  });

  it("fails closed for DeepSeek text", () => {
    const r = assertComposerProviderPolicy({
      provider: "deepseek",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("composer_provider_not_configured");
  });

  it("fails closed for OpenAI selected images", () => {
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      cloudVisionAllowed: true,
      imageCount: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("composer_provider_not_configured");
  });
});

describe("resolveComposerProvider", () => {
  it("defaults to Ollama", () => {
    expect(resolveComposerProvider().name).toBe("ollama");
    expect(resolveComposerProvider(null).name).toBe("ollama");
    expect(parseComposerProviderName("unknown")).toBe("ollama");
  });

  it("returns fail-closed stubs for cloud providers", async () => {
    const ds = resolveComposerProvider("deepseek");
    const oa = resolveComposerProvider("openai");
    expect(ds).toBeInstanceOf(DeepSeekComposerAdapter);
    expect(oa).toBeInstanceOf(OpenAiComposerAdapter);

    const dsResult = await ds.compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "deepseek-chat",
      temperature: 0.1,
      timeoutMs: 1000,
    });
    expect(dsResult.ok).toBe(false);
    if (!dsResult.ok) {
      expect(dsResult.safeError).toBe("composer_provider_not_configured");
    }

    const oaResult = await oa.compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "gpt-4o",
      temperature: 0.1,
      timeoutMs: 1000,
      images: [{ mimeType: "image/jpeg", base64: "abc" }],
    });
    expect(oaResult.ok).toBe(false);
    if (!oaResult.ok) {
      expect(oaResult.safeError).toBe("composer_provider_not_configured");
    }
  });
});

describe("OllamaComposerAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends native /api/chat JSON with think:false and optional images[]", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ message: { content: '{"findings":"ok","impression":"ok"}' } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OllamaComposerAdapter();
    const result = await adapter.compose({
      systemPrompt: "system-prompt",
      userPrompt: "user-prompt",
      model: "llava:7b",
      temperature: 0.1,
      timeoutMs: 5000,
      numCtx: 4096,
      endpoint: "http://127.0.0.1:11434",
      localOnly: true,
      images: [{ mimeType: "image/jpeg", base64: "QUJDRA==" }],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(call[1]?.body));
    expect(body.model).toBe("llava:7b");
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.think).toBe(false);
    expect(body.options.temperature).toBe(0.1);
    expect(body.options.num_ctx).toBe(4096);
    expect(body.messages[0]).toEqual({ role: "system", content: "system-prompt" });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe("user-prompt");
    expect(body.messages[1].images).toEqual(["QUJDRA=="]);
  });

  it("blocks SSRF endpoints via validateOllamaUrl", async () => {
    const adapter = new OllamaComposerAdapter();
    const result = await adapter.compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "llama3.1:8b",
      temperature: 0.1,
      timeoutMs: 1000,
      endpoint: "http://169.254.169.254/",
      localOnly: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.safeError).toBe("composer_endpoint_blocked");
    }
  });
});
