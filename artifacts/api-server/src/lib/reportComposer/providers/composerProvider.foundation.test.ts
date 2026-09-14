import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";
import { resolveComposerProvider, parseComposerProviderName } from "./resolveComposerProvider";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { DeepSeekComposerAdapter } from "./deepseekComposerAdapter";
import { OpenAiComposerAdapter } from "./openaiComposerAdapter";
import { QwenComposerAdapter } from "./qwenComposerAdapter";
import { assertModelSupportsCapability } from "./modelRegistry";
import { generateAiResponse, assertCloudImageEgress } from "@workspace/ai-providers";

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

  it("fails closed for DeepSeek text when API key missing", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const r = assertComposerProviderPolicy({
      provider: "deepseek",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("deepseek_api_key_not_configured");
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
  });

  it("allows DeepSeek text when API key configured", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-test-not-real";
    const r = assertComposerProviderPolicy({
      provider: "deepseek",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(r).toEqual({ ok: true });
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    else delete process.env.DEEPSEEK_API_KEY;
  });

  it("blocks DeepSeek vision without explicit cloudVisionAllowed", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-test-not-real";
    const r = assertComposerProviderPolicy({
      provider: "deepseek",
      aiMode: "SELECTED_IMAGES",
      cloudVisionAllowed: false,
      imageCount: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_vision_not_allowed");
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    else delete process.env.DEEPSEEK_API_KEY;
  });

  it("blocks Qwen vision without cloudVisionAllowed (same policy as DeepSeek)", () => {
    const prev = process.env.QWEN_API_KEY;
    process.env.QWEN_API_KEY = "sk-qwen-test";
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      cloudVisionAllowed: false,
      imageCount: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_vision_not_allowed");
    if (prev !== undefined) process.env.QWEN_API_KEY = prev;
    else delete process.env.QWEN_API_KEY;
  });

  it("fails closed for OpenAI when key missing", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      cloudVisionAllowed: true,
      imageCount: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("openai_api_key_not_configured");
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });
});

describe("resolveComposerProvider", () => {
  it("defaults to Ollama", () => {
    expect(resolveComposerProvider().name).toBe("ollama");
    expect(resolveComposerProvider(null).name).toBe("ollama");
    expect(parseComposerProviderName("unknown")).toBe("ollama");
  });

  it("returns cloud adapters that fail closed without keys", async () => {
    const prevDs = process.env.DEEPSEEK_API_KEY;
    const prevQ = process.env.QWEN_API_KEY;
    const prevO = process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.QWEN_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(resolveComposerProvider("deepseek")).toBeInstanceOf(DeepSeekComposerAdapter);
    expect(resolveComposerProvider("qwen")).toBeInstanceOf(QwenComposerAdapter);
    expect(resolveComposerProvider("openai")).toBeInstanceOf(OpenAiComposerAdapter);

    const dsResult = await resolveComposerProvider("deepseek").compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "deepseek-v4-pro",
      temperature: 0.1,
      timeoutMs: 1000,
    });
    expect(dsResult.ok).toBe(false);
    if (!dsResult.ok) expect(dsResult.safeError).toBe("deepseek_api_key_not_configured");

    const qResult = await resolveComposerProvider("qwen").compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "qwen3.7-plus",
      temperature: 0.1,
      timeoutMs: 1000,
    });
    expect(qResult.ok).toBe(false);
    if (!qResult.ok) expect(qResult.safeError).toBe("qwen_api_key_not_configured");

    const oaResult = await resolveComposerProvider("openai").compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "gpt-4o",
      temperature: 0.1,
      timeoutMs: 1000,
    });
    expect(oaResult.ok).toBe(false);
    if (!oaResult.ok) expect(oaResult.safeError).toBe("openai_api_key_not_configured");

    if (prevDs !== undefined) process.env.DEEPSEEK_API_KEY = prevDs;
    if (prevQ !== undefined) process.env.QWEN_API_KEY = prevQ;
    if (prevO !== undefined) process.env.OPENAI_API_KEY = prevO;
  });
});

describe("model capability filtering", () => {
  it("rejects text-only DeepSeek Pro for vision", () => {
    const r = assertModelSupportsCapability("deepseek", "deepseek-v4-pro", "vision");
    expect(r.ok).toBe(false);
  });

  it("allows qwen3.7-plus for vision", () => {
    expect(assertModelSupportsCapability("qwen", "qwen3.7-plus", "vision").ok).toBe(true);
  });
});

describe("shared cloud image egress", () => {
  it("denies cloud images by default", () => {
    const r = assertCloudImageEgress({
      provider: "qwen",
      imageCount: 1,
      cloudVisionAllowed: false,
    });
    expect(r.ok).toBe(false);
  });

  it("allows cloud images only with explicit opt-in", () => {
    const r = assertCloudImageEgress({
      provider: "deepseek",
      imageCount: 1,
      cloudVisionAllowed: true,
      modelSupportsVision: true,
    });
    expect(r.ok).toBe(true);
  });

  it("generateAiResponse blocks cloud images without opt-in", async () => {
    const res = await generateAiResponse("deepseek", "Describe findings", ["base64frame"], {
      model: "deepseek-v4-flash-vision-exp",
    });
    expect(res.success).toBe(false);
    expect(res.diagnostics?.errorCode).toBe("PHI_IMAGE_CLOUD_BLOCKED");
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
    if (result.ok) expect(result.execution).toBe("LOCAL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(call[1]?.body));
    expect(body.model).toBe("llava:7b");
    expect(body.format).toBe("json");
    expect(body.think).toBe(false);
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
    if (!result.ok) expect(result.safeError).toBe("composer_endpoint_blocked");
  });
});
