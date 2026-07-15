import { describe, it, expect, vi, beforeEach } from "vitest";

// Fix for the Form F OCR bug this test suite guards against: OCR was
// hardwired to require a Gemini API key, so a clinic running Ollama locally
// (no Gemini key anywhere) saw "OCR unavailable" even though a fully
// working local AI provider was configured and reachable. These tests
// exercise resolveOcrProvider()'s decision tree directly against a mocked
// @workspace/ai-providers, so they verify the POLICY (Ollama-first,
// Gemini-fallback, explicit-route-wins) without needing a real database or
// network — the resolver's only real-world dependencies.

const mockLoadProviderConfig = vi.fn();
const mockGetProviderApiKey = vi.fn();
const mockResolveTaskRoute = vi.fn();
const mockClassifyOllamaModelVisionByName = vi.fn();
const mockProbeOllamaReachable = vi.fn();
const mockProbeOllamaModelVision = vi.fn();

vi.mock("@workspace/ai-providers", () => ({
  loadProviderConfig: (...args: unknown[]) => mockLoadProviderConfig(...args),
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  resolveTaskRoute: (...args: unknown[]) => mockResolveTaskRoute(...args),
  classifyOllamaModelVisionByName: (...args: unknown[]) => mockClassifyOllamaModelVisionByName(...args),
  probeOllamaReachable: (...args: unknown[]) => mockProbeOllamaReachable(...args),
  probeOllamaModelVision: (...args: unknown[]) => mockProbeOllamaModelVision(...args),
}));

const { resolveOcrProvider, maskEndpointUrl } = await import("./ocrProviderResolver");

const OLLAMA_ROW = (overrides: Partial<Record<string, unknown>> = {}) => ({
  provider: "ollama",
  isEnabled: true,
  isDefault: false,
  hasApiKey: false,
  hasEndpointUrl: true,
  defaultModel: "llava:13b",
  endpointUrl: "http://100.79.100.41:11434",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "";
  // Defaults: nothing configured, no explicit route — most tests override.
  mockResolveTaskRoute.mockResolvedValue(null);
  mockGetProviderApiKey.mockResolvedValue(null);
  mockLoadProviderConfig.mockImplementation(async (name: string) =>
    name === "ollama" ? { provider: "ollama", isEnabled: false, isDefault: false, hasApiKey: false, hasEndpointUrl: false, defaultModel: null, endpointUrl: null } : null,
  );
  mockClassifyOllamaModelVisionByName.mockReturnValue("unknown");
  mockProbeOllamaReachable.mockResolvedValue({ reachable: true, models: ["llava:13b"] });
  mockProbeOllamaModelVision.mockResolvedValue(null); // server doesn't report capabilities
});

describe("resolveOcrProvider — auto policy (no explicit route)", () => {
  it("chooses Ollama when enabled, model looks vision-capable, and reachable", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW() : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "ollama", endpointUrl: "http://100.79.100.41:11434", model: "llava:13b" });
  });

  it("falls back to manual entry (none) when Ollama is unreachable and no Gemini key exists", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW() : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: false, error: "fetch failed: ECONNREFUSED" });

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_unreachable" });
    expect(result.ollama.reachable).toBe(false);
    expect(result.ollama.reachabilityError).toContain("ECONNREFUSED");
  });

  it("falls back to Gemini when Ollama is unreachable but Gemini is configured", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW() : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: false, error: "timeout" });
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-test-key" });
  });

  it("rejects a text-only Ollama model (name heuristic) without wasting a reachability probe", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW({ defaultModel: "gpt-oss:20b" }) : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("text-only");

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_model_not_vision_capable" });
    expect(mockProbeOllamaReachable).not.toHaveBeenCalled();
  });

  it("rejects a text-only Ollama model per the server's own /api/show capabilities report, even if the name heuristic doesn't recognize it", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW({ defaultModel: "some-custom-finetune:latest" }) : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("unknown");
    mockProbeOllamaModelVision.mockResolvedValue(false); // server explicitly says no vision capability

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_model_not_vision_capable" });
    expect(result.ollama.visionClassification).toBe("server-confirmed-text-only");
  });

  it("attempts an unrecognized model name when the server doesn't report capabilities either (best-effort, not a false negative)", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW({ defaultModel: "some-custom-finetune:latest" }) : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("unknown");
    mockProbeOllamaModelVision.mockResolvedValue(null); // server silent on capabilities

    const result = await resolveOcrProvider();

    expect(result.chosen.provider).toBe("ollama");
  });

  it("skips Ollama entirely and uses Gemini when Ollama has no model configured", async () => {
    mockLoadProviderConfig.mockImplementation(async (name: string) =>
      name === "ollama" ? OLLAMA_ROW({ defaultModel: null }) : null,
    );
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-test-key" });
    expect(mockProbeOllamaReachable).not.toHaveBeenCalled();
  });

  it("uses Gemini directly (no wasted Ollama probe) when Ollama isn't enabled at all", async () => {
    // Default beforeEach: ollama isEnabled=false
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-test-key" });
    expect(mockProbeOllamaReachable).not.toHaveBeenCalled();
  });

  it("falls back to the AI_INTEGRATIONS_GEMINI_API_KEY env var when no DB-configured Gemini key exists (back-compat)", async () => {
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "env-fallback-key";
    mockGetProviderApiKey.mockResolvedValue(null);

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "env-fallback-key" });
  });

  it("reports manual entry (none / no_provider_configured) when neither Ollama nor Gemini is configured", async () => {
    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "no_provider_configured" });
  });
});

describe("resolveOcrProvider — explicit admin-configured route (Model Routing UI)", () => {
  it("honors an explicit Ollama route even though the auto policy would have picked Gemini as the global default", async () => {
    mockResolveTaskRoute.mockResolvedValue({ provider: "ollama", model: "qwen2.5-vl:7b" });
    mockLoadProviderConfig.mockImplementation(async (name: string) =>
      name === "ollama" ? OLLAMA_ROW({ defaultModel: "llava:13b" }) : null,
    );
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    // Uses the ROUTE's model (qwen2.5-vl:7b), not the provider row's default model.
    expect(result.chosen).toEqual({ provider: "ollama", endpointUrl: "http://100.79.100.41:11434", model: "qwen2.5-vl:7b" });
  });

  it("does NOT fall back to Gemini when the explicit Ollama route fails — an explicit choice is not silently overridden", async () => {
    mockResolveTaskRoute.mockResolvedValue({ provider: "ollama", model: "llava:13b" });
    mockLoadProviderConfig.mockImplementation(async (name: string) => (name === "ollama" ? OLLAMA_ROW() : null));
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: false, error: "connection refused" });
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_unreachable" });
  });

  it("honors an explicit Gemini route", async () => {
    mockResolveTaskRoute.mockResolvedValue({ provider: "gemini" });
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-explicit" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-explicit" });
  });
});

describe("maskEndpointUrl", () => {
  it("masks the hostname while keeping the protocol/port visible for diagnostics", () => {
    const masked = maskEndpointUrl("http://100.79.100.41:11434");
    expect(masked).not.toBe("http://100.79.100.41:11434");
    expect(masked).toMatch(/^http:\/\//);
    expect(masked).toContain(":11434");
  });

  it("returns null for a null/empty URL rather than throwing", () => {
    expect(maskEndpointUrl(null)).toBeNull();
  });
});
