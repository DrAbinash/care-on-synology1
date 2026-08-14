import { describe, it, expect, vi, afterEach } from "vitest";

// index.ts imports @workspace/db (and @workspace/crypto) at module scope for
// its DB-backed provider registry — unrelated to the three pure/network
// functions under test here, but the import still executes and throws
// without a DATABASE_URL unless stubbed out.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

const { classifyOllamaModelVisionByName, probeOllamaReachable, probeOllamaModelVision } = await import("./index");

// Locks down the Form F OCR fix's model-capability heuristics: an admin
// pointing OCR at a text-only Ollama model (e.g. the built-in default
// "gpt-oss:20b") must get a clear "select a vision-capable model" message
// rather than a silent OCR failure — these tests are the contract for the
// name-pattern side of that check (see ocrProviderResolver.ts for the
// server-capability-first, name-heuristic-fallback policy that uses this).

describe("classifyOllamaModelVisionByName", () => {
  it.each([
    "llava:13b", "llava-llama3:latest", "bakllava:7b", "moondream:latest",
    "minicpm-v:8b", "pixtral:12b", "llama3.2-vision:11b", "llama3.2-vision:90b",
    "qwen2.5-vl:7b", "qwen2-vl:7b", "qwen3-vl:8b", "gemma3:12b", "gemma3:27b",
  ])("classifies %s as vision-capable", (model) => {
    expect(classifyOllamaModelVisionByName(model)).toBe("vision");
  });

  it.each([
    "gpt-oss:20b", "gpt-oss:120b", "llama3.1:70b", "llama3.2:3b", "llama3:8b",
    "mistral:7b", "mixtral:8x7b", "phi3:14b", "phi4:latest", "qwen2.5:32b",
    "deepseek-r1:14b", "codellama:13b", "gemma2:9b", "gemma:7b", "gemma3:1b",
  ])("classifies %s as text-only", (model) => {
    expect(classifyOllamaModelVisionByName(model)).toBe("text-only");
  });

  it("classifies an unrecognized model name as unknown rather than guessing", () => {
    expect(classifyOllamaModelVisionByName("some-custom-org/their-finetune:latest")).toBe("unknown");
  });

  it("classifies an empty/missing model as unknown", () => {
    expect(classifyOllamaModelVisionByName("")).toBe("unknown");
  });
});

describe("probeOllamaReachable", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("reports reachable with the model list when /api/tags responds 200", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: "llava:13b" }, { name: "gemma3:12b" }] }),
    })) as unknown as typeof fetch;

    const result = await probeOllamaReachable("http://100.79.100.41:11434");

    expect(result.reachable).toBe(true);
    expect(result.models).toEqual(["llava:13b", "gemma3:12b"]);
  });

  it("reports unreachable with the status code when the server responds non-2xx", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;

    const result = await probeOllamaReachable("http://100.79.100.41:11434");

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("503");
  });

  it("reports unreachable (not a throw) when fetch itself rejects — e.g. the Windows PC is off", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

    const result = await probeOllamaReachable("http://100.79.100.41:11434");

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("probeOllamaModelVision", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("returns true when /api/show reports a vision capability", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ capabilities: ["completion", "vision"] }) })) as unknown as typeof fetch;

    expect(await probeOllamaModelVision("http://100.79.100.41:11434", "llava:13b")).toBe(true);
  });

  it("returns false when /api/show reports capabilities without vision", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ capabilities: ["completion"] }) })) as unknown as typeof fetch;

    expect(await probeOllamaModelVision("http://100.79.100.41:11434", "gpt-oss:20b")).toBe(false);
  });

  it("returns null (unknown, not false) when the server doesn't report a capabilities field at all — older Ollama versions", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;

    expect(await probeOllamaModelVision("http://100.79.100.41:11434", "llava:13b")).toBeNull();
  });

  it("returns null (not false) on a network error, so callers fall back to the name heuristic instead of a false negative", async () => {
    global.fetch = vi.fn(async () => { throw new Error("timeout"); }) as unknown as typeof fetch;

    expect(await probeOllamaModelVision("http://100.79.100.41:11434", "llava:13b")).toBeNull();
  });
});
