import { describe, it, expect, vi, afterEach } from "vitest";

// index.ts imports @workspace/db (and @workspace/crypto) at module scope for
// its DB-backed provider registry — unrelated to the three pure/network
// functions under test here, but the import still executes and throws
// without a DATABASE_URL unless stubbed out.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

// Production code uses hardenedLocalRequest (DNS-pinned transport) instead of
// bare fetch. Delegate to global.fetch so existing mocks work.
vi.mock("./hardenedTransport", () => ({
  hardenedLocalRequest: async (url: string, init?: RequestInit) => {
    const response = await globalThis.fetch(url, init);
    return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
  },
}));

const {
  classifyOllamaModelVisionByName,
  probeOllamaReachable,
  probeOllamaModelVision,
  modelSupportsVision,
  listBuiltinModels,
  defaultModelForProvider,
} = await import("./index");

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
    // Every MedGemma tag spelling: `lookupBuiltinCapability` matches one exact
    // tag, so the name list is what covers the rest of the family.
    "medgemma1.5:4b", "medgemma1.5:4b-it", "medgemma:4b", "medgemma:27b",
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

// ─── The capability table and the name list must tell one story ──────────────
// `gemma3:12b` was declared `supportsVision: false` in BUILTIN_MODEL_CAPABILITIES
// while `classifyOllamaModelVisionByName` called the whole gemma3 family
// vision-capable. Different callers read different tables — the Composer's
// selected-image gate reads the classifier, the model registry and cloud
// image-egress policy read the table — so CARE simultaneously believed and
// disbelieved the same fact about the model the clinic actually runs. Ollama's
// own `/api/show` settled it (capabilities ["completion","vision"], CLIP vision
// projector present); these tests make the contradiction impossible to re-enter.

describe("the Ollama capability table agrees with the Ollama name list", () => {
  it.each(
    listBuiltinModels({ provider: "ollama" }).map((row) => [row.model, row.supportsVision] as const),
  )("row %s states vision=%s, which is what the classifier also says", (model, declared) => {
    expect(modelSupportsVision("ollama", model)).toBe(declared);
    expect(declared).toBe(classifyOllamaModelVisionByName(model) === "vision");
  });

  it("says gemma3:12b can see, because /api/show says it can", () => {
    expect(modelSupportsVision("ollama", "gemma3:12b")).toBe(true);
  });

  it("offers medgemma1.5:4b as a selectable local vision model", () => {
    expect(modelSupportsVision("ollama", "medgemma1.5:4b")).toBe(true);
    const offered = listBuiltinModels({ provider: "ollama", vision: true }).map((r) => r.model);
    expect(offered).toContain("medgemma1.5:4b");
  });

  it("does not let adding it move any default, which is why row order is load-bearing", () => {
    // `defaultModelForProvider` returns the FIRST vision row. medgemma1.5:4b is
    // deliberately declared after qwen3-vl:8b so no production vision default
    // changes to a model the clinic may not have installed.
    expect(defaultModelForProvider("ollama", true)).toBe("qwen3-vl:8b");
    // And the text composer default is untouched by any of this.
    expect(defaultModelForProvider("ollama", false)).toBe("qwen3-vl:8b");
  });

  it("still fails closed for a name neither table recognises", () => {
    expect(modelSupportsVision("ollama", "some-custom-org/their-finetune:latest")).toBe(false);
    expect(classifyOllamaModelVisionByName("some-custom-org/their-finetune:latest")).toBe("unknown");
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
