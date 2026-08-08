import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveLocalAiRuntime = vi.fn();
const mockGetProviderApiKey = vi.fn();
const mockResolveTaskRoute = vi.fn();
const mockClassifyOllamaModelVisionByName = vi.fn();
const mockProbeOllamaReachable = vi.fn();
const mockProbeOllamaModelVision = vi.fn();

vi.mock("../aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: (...args: unknown[]) => mockResolveLocalAiRuntime(...args),
}));

vi.mock("@workspace/ai-providers", () => ({
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  resolveTaskRoute: (...args: unknown[]) => mockResolveTaskRoute(...args),
  classifyOllamaModelVisionByName: (...args: unknown[]) => mockClassifyOllamaModelVisionByName(...args),
  probeOllamaReachable: (...args: unknown[]) => mockProbeOllamaReachable(...args),
  probeOllamaModelVision: (...args: unknown[]) => mockProbeOllamaModelVision(...args),
}));

const { resolveOcrProvider, maskEndpointUrl } = await import("./ocrProviderResolver");

const RUNTIME = (overrides: Partial<Record<string, unknown>> = {}) => ({
  ollamaBaseUrl: "http://100.79.100.41:11434",
  aiMode: "standard",
  modelFast: "gemma3:1b",
  modelStandard: "gemma3:4b",
  modelDeep: "qwen3:14b",
  modelVision: "llava:13b",
  ollamaEnabled: true,
  source: "clinic_settings",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "";
  mockResolveTaskRoute.mockResolvedValue(null);
  mockGetProviderApiKey.mockResolvedValue(null);
  mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME({ ollamaEnabled: false, modelVision: "" }));
  mockClassifyOllamaModelVisionByName.mockReturnValue("unknown");
  mockProbeOllamaReachable.mockResolvedValue({ reachable: true, models: ["llava:13b"] });
  mockProbeOllamaModelVision.mockResolvedValue(null);
});

describe("resolveOcrProvider — auto policy (no explicit route)", () => {
  it("chooses Ollama when enabled, model looks vision-capable, and reachable", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME());
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({
      provider: "ollama",
      endpointUrl: "http://100.79.100.41:11434",
      model: "llava:13b",
    });
  });

  it("falls back to manual entry (none) when Ollama is unreachable and no Gemini key exists", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME());
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: false, error: "fetch failed: ECONNREFUSED" });

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_unreachable" });
    expect(result.ollama.reachable).toBe(false);
    expect(result.ollama.reachabilityError).toContain("ECONNREFUSED");
  });

  it("falls back to Gemini when Ollama is unreachable but Gemini is configured", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME());
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: false, error: "timeout" });
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-test-key" });
  });

  it("rejects a text-only Ollama model (name heuristic) without wasting a reachability probe", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME({ modelVision: "gpt-oss:20b" }));
    mockClassifyOllamaModelVisionByName.mockReturnValue("text-only");

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_model_not_vision_capable" });
    expect(mockProbeOllamaReachable).not.toHaveBeenCalled();
  });

  it("rejects a text-only Ollama model per the server's own /api/show capabilities report", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME({ modelVision: "some-custom-finetune:latest" }));
    mockClassifyOllamaModelVisionByName.mockReturnValue("unknown");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: true, models: ["some-custom-finetune:latest"] });
    mockProbeOllamaModelVision.mockResolvedValue(false);

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "none", reason: "ollama_model_not_vision_capable" });
    expect(mockProbeOllamaModelVision).toHaveBeenCalled();
  });

  it("accepts an unknown-name model when the server reports vision capabilities", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME({ modelVision: "some-custom-finetune:latest" }));
    mockClassifyOllamaModelVisionByName.mockReturnValue("unknown");
    mockProbeOllamaReachable.mockResolvedValue({ reachable: true, models: ["some-custom-finetune:latest"] });
    mockProbeOllamaModelVision.mockResolvedValue(true);

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({
      provider: "ollama",
      endpointUrl: "http://100.79.100.41:11434",
      model: "some-custom-finetune:latest",
    });
  });

  it("falls through to Gemini when Ollama is disabled", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME({ ollamaEnabled: false }));
    mockGetProviderApiKey.mockImplementation(async (name: string) => (name === "gemini" ? "AIza-test-key" : null));

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-test-key" });
  });
});

describe("resolveOcrProvider — explicit form_f_id_ocr route", () => {
  it("honours an explicit Ollama route without probing Gemini", async () => {
    mockResolveLocalAiRuntime.mockResolvedValue(RUNTIME());
    mockResolveTaskRoute.mockResolvedValue({
      provider: "ollama",
      model: "llava:13b",
      endpointUrl: "http://100.79.100.41:11434",
    });
    mockClassifyOllamaModelVisionByName.mockReturnValue("vision");

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({
      provider: "ollama",
      endpointUrl: "http://100.79.100.41:11434",
      model: "llava:13b",
    });
  });

  it("honours an explicit Gemini route", async () => {
    mockResolveTaskRoute.mockResolvedValue({ provider: "gemini", model: "gemini-2.0-flash" });
    mockGetProviderApiKey.mockResolvedValue("AIza-route-key");

    const result = await resolveOcrProvider();

    expect(result.chosen).toEqual({ provider: "gemini", apiKey: "AIza-route-key" });
  });
});

describe("maskEndpointUrl", () => {
  it("keeps port and masks host segments for diagnostics display", () => {
    const masked = maskEndpointUrl("http://100.79.100.41:11434");
    expect(masked).toContain(":11434");
    expect(masked).not.toBe("http://100.79.100.41:11434");
    expect(maskEndpointUrl(null)).toBeNull();
  });
});
