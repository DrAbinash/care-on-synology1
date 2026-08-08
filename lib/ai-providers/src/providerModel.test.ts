import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture the model handed to each provider SDK ────────────────────────────
const getGenerativeModel = vi.fn((_args: { model: string }) => ({
  generateContent: async () => ({ response: { text: () => "CONNECTED" } }),
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class { getGenerativeModel = getGenerativeModel; },
}));

// The "openai" SDK is used by BOTH the OpenAI provider and the Ollama provider
// (Ollama talks OpenAI-compatible via new OpenAI({ baseURL })).
const openaiCreate = vi.fn(async (_args: { model: string }) => ({ choices: [{ message: { content: "CONNECTED" } }] }));
vi.mock("openai", () => ({
  default: class { chat = { completions: { create: openaiCreate } }; },
}));

const anthropicCreate = vi.fn(async (_args: { model: string }) => ({ content: [{ type: "text", text: "CONNECTED" }] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: anthropicCreate }; },
}));

// index.ts imports these at module load; stub so the module loads without a DB.
vi.mock("@workspace/db", () => ({ db: {}, aiProviderSettingsTable: {}, aiModelRoutesTable: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

import { createAiProvider, validateProviderModel } from "./index";

beforeEach(() => { getGenerativeModel.mockClear(); openaiCreate.mockClear(); anthropicCreate.mockClear(); });

describe("validateProviderModel", () => {
  it("accepts a newer gemini model by family match, and known defaults", () => {
    expect(validateProviderModel("gemini", "gemini-2.0-flash").ok).toBe(true);
    expect(validateProviderModel("gemini", "gemini-1.5-pro").ok).toBe(true);
  });
  it("rejects an empty model", () => {
    expect(validateProviderModel("gemini", "")).toMatchObject({ ok: false, message: "Model cannot be empty." });
    expect(validateProviderModel("gemini", "   ").ok).toBe(false);
  });
  it("rejects a cross-provider mismatch cleanly", () => {
    expect(validateProviderModel("gemini", "gpt-4o").ok).toBe(false);
    expect(validateProviderModel("openai", "gemini-2.0-flash").ok).toBe(false);
    expect(validateProviderModel("anthropic", "gpt-4o").ok).toBe(false);
  });
  it("accepts family-matched new models for openai + anthropic", () => {
    expect(validateProviderModel("openai", "gpt-4.1").ok).toBe(true);
    expect(validateProviderModel("openai", "o3-mini").ok).toBe(true);
    expect(validateProviderModel("anthropic", "claude-opus-4-5").ok).toBe(true);
  });
  it("rejects an unknown provider", () => {
    expect(validateProviderModel("nope", "x").ok).toBe(false);
  });
  it("accepts any pulled model for ollama", () => {
    expect(validateProviderModel("ollama", "qwen3:14b").ok).toBe(true);
    expect(validateProviderModel("ollama", "gpt-oss:20b").ok).toBe(true);
  });
});

describe("Gemini — selected model reaches the client unchanged", () => {
  it("passes the submitted model VERBATIM (regression: gemini-2.0-flash)", async () => {
    const p = await createAiProvider("gemini", "fake-key");
    const r = await p!.testConnection("gemini-2.0-flash");
    expect(r.ok).toBe(true);
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-2.0-flash" });
    expect(getGenerativeModel).not.toHaveBeenCalledWith({ model: "gemini-1.5-flash" });
  });
  it("uses the built-in probe model ONLY when no model is supplied", async () => {
    const p = await createAiProvider("gemini", "fake-key");
    await p!.testConnection();
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-1.5-flash" });
  });
  it("uses the submitted model in query() too (report generation path)", async () => {
    const p = await createAiProvider("gemini", "fake-key");
    await p!.query({ model: "gemini-2.0-flash", prompt: "hi", images: [] });
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-2.0-flash" });
  });
});

describe("OpenAI — selected model reaches the client unchanged", () => {
  it("passes the submitted model VERBATIM and not the gpt-4o-mini probe", async () => {
    const p = await createAiProvider("openai", "sk-fake");
    const r = await p!.testConnection("gpt-4o");
    expect(r.ok).toBe(true);
    expect(openaiCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
    expect(openaiCreate).not.toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
  });
  it("uses the gpt-4o-mini probe ONLY when no model is supplied", async () => {
    const p = await createAiProvider("openai", "sk-fake");
    await p!.testConnection();
    expect(openaiCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
  });
});

describe("Anthropic — selected model reaches the client unchanged", () => {
  it("passes the submitted model VERBATIM and not the haiku probe", async () => {
    const p = await createAiProvider("anthropic", "sk-ant-fake");
    const r = await p!.testConnection("claude-opus-4-5");
    expect(r.ok).toBe(true);
    expect(anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-opus-4-5" }));
    expect(anthropicCreate).not.toHaveBeenCalledWith(expect.objectContaining({ model: "claude-3-5-haiku-20241022" }));
  });
  it("uses the haiku probe ONLY when no model is supplied", async () => {
    const p = await createAiProvider("anthropic", "sk-ant-fake");
    await p!.testConnection();
    expect(anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-3-5-haiku-20241022" }));
  });
});

describe("Ollama — selected model reaches the client unchanged", () => {
  const okTags = { ok: true, json: async () => ({ models: [{ name: "gemma3:4b" }, { name: "gemma3:12b" }, { name: "qwen3:14b" }] }) };
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => okTags as unknown as Response)); });

  it("passes the submitted model VERBATIM and not the fallback probe", async () => {
    const p = await createAiProvider("ollama", undefined, "http://172.16.1.140:11434");
    const r = await p!.testConnection("qwen3:14b");
    expect(r.ok).toBe(true);
    expect(openaiCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen3:14b" }));
    expect(openaiCreate).not.toHaveBeenCalledWith(expect.objectContaining({ model: "gemma3:4b" }));
  });
  it("uses the gemma3:4b default probe ONLY when no model is supplied", async () => {
    // gemma3:4b is the routine default for the Windows OCR/AI worker.
    const p = await createAiProvider("ollama", undefined, "http://172.16.1.140:11434");
    await p!.testConnection();
    expect(openaiCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gemma3:4b" }));
  });
});
