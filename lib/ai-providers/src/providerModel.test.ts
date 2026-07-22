import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the model handed to the Gemini SDK.
const getGenerativeModel = vi.fn((_args: { model: string }) => ({
  generateContent: async () => ({ response: { text: () => "CONNECTED" } }),
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class { getGenerativeModel = getGenerativeModel; },
}));
// index.ts imports these at module load; stub so the module loads without a DB.
vi.mock("@workspace/db", () => ({ db: {}, aiProviderSettingsTable: {}, aiModelRoutesTable: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

import { createAiProvider, validateProviderModel } from "./index";

beforeEach(() => { getGenerativeModel.mockClear(); });

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
  });
  it("rejects an unknown provider", () => {
    expect(validateProviderModel("nope", "x").ok).toBe(false);
  });
  it("accepts any pulled model for ollama", () => {
    expect(validateProviderModel("ollama", "qwen3:14b").ok).toBe(true);
    expect(validateProviderModel("ollama", "gpt-oss:20b").ok).toBe(true);
  });
});

describe("GeminiProvider.testConnection — the selected model reaches the client unchanged", () => {
  it("passes the submitted model to GoogleGenerativeAI VERBATIM (regression: gemini-2.0-flash)", async () => {
    const p = await createAiProvider("gemini", "fake-key");
    const r = await p!.testConnection("gemini-2.0-flash");
    expect(r.ok).toBe(true);
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-2.0-flash" });
    // The old hard-coded fallback must NOT be used when a model is supplied.
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
