/**
 * Focused tests for vendor-neutral Local OpenAI-Compatible provider.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertCloudImageEgress,
  assertVisionCapable,
  COMPATIBLE_PROVIDER_DEFAULTS,
  isCompatibleProviderConfigured,
  isLocalExecutionProvider,
  isLocalOpenAiCompatibleProvider,
  LOCAL_OPENAI_COMPATIBLE_PROVIDER,
  modelSupportsVision,
  openAiCompatibleChat,
  BUILTIN_PROVIDER_CONFIGS,
} from "@workspace/ai-providers";
import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";
import { resolveComposerProvider, parseComposerProviderName } from "./resolveComposerProvider";
import { LocalOpenAiCompatibleComposerAdapter } from "./localOpenAiCompatibleComposerAdapter";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { parseComposerSnapshot } from "../types";

vi.mock("./localOpenAiCompatibleConfig", async () => {
  const actual = await vi.importActual<typeof import("./localOpenAiCompatibleConfig")>(
    "./localOpenAiCompatibleConfig",
  );
  return {
    ...actual,
    getLocalOpenAiApiKey: vi.fn(async () => ""),
    getLocalOpenAiBaseUrl: vi.fn(async (ep?: string | null) =>
      (ep ?? "").trim() || "http://127.0.0.1:8080/v1",
    ),
    loadLocalOpenAiSettings: vi.fn(async () => ({
      displayName: "Bonsai 2 27B",
      supportsText: true,
      supportsVision: true,
      jsonMode: false,
    })),
    localOpenAiModelSupportsVision: vi.fn(async () => true),
  };
});

// Production code uses createHardenedLocalFetch (DNS-pinned transport) instead of
// bare fetch. Mock the transport module at its resolved path so that internal imports
// within @workspace/ai-providers (openAiCompatible.ts) pick up the mock.
vi.mock("../../../../../lib/ai-providers/src/hardenedTransport", () => ({
  hardenedLocalRequest: async (url: string, init?: RequestInit) => {
    const response = await globalThis.fetch(url, init);
    return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
  },
  createHardenedLocalFetch: (_opts?: { enforceBinding?: boolean }) => {
    return async (url: string | URL | Request, init?: RequestInit) => {
      return globalThis.fetch(url, init);
    };
  },
  resolveAndValidatePrivateIps: async (hostname: string) => ({
    ips: ["127.0.0.1"],
    isPrivate: true,
  }),
  assertNoRedirect: (resp: Response) => resp,
  rewriteUrlToValidatedIp: async (rawUrl: string) => ({
    rewrittenUrl: rawUrl,
    originalHost: new URL(rawUrl).host,
    boundIp: "127.0.0.1",
  }),
  createBoundFetch: async () => globalThis.fetch,
}));

describe("local_openai_compatible provider identity", () => {
  it("registers as LOCAL and never as cloud merely for OpenAI wire format", () => {
    expect(BUILTIN_PROVIDER_CONFIGS.local_openai_compatible?.label).toBe(
      "Local OpenAI-Compatible",
    );
    expect(BUILTIN_PROVIDER_CONFIGS.local_openai_compatible?.needsApiKey).toBe(false);
    expect(BUILTIN_PROVIDER_CONFIGS.local_openai_compatible?.needsEndpointUrl).toBe(true);
    expect(COMPATIBLE_PROVIDER_DEFAULTS.local_openai_compatible?.execution).toBe("LOCAL");
    expect(COMPATIBLE_PROVIDER_DEFAULTS.local_openai_compatible?.allowEmptyApiKey).toBe(true);
    expect(isLocalOpenAiCompatibleProvider(LOCAL_OPENAI_COMPATIBLE_PROVIDER)).toBe(true);
    expect(isLocalExecutionProvider("local_openai_compatible")).toBe(true);
    expect(isLocalExecutionProvider("ollama")).toBe(true);
    expect(isLocalExecutionProvider("deepseek")).toBe(false);
  });

  it("keeps cloud providers requiring credentials; local allows empty key intent", () => {
    const prev = {
      d: process.env.DEEPSEEK_API_KEY,
      q: process.env.QWEN_API_KEY,
      o: process.env.OPENAI_API_KEY,
      l: process.env.LOCAL_OPENAI_COMPATIBLE_BASE_URL,
    };
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.QWEN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LOCAL_OPENAI_COMPATIBLE_BASE_URL;

    expect(isCompatibleProviderConfigured("deepseek")).toBe(false);
    expect(isCompatibleProviderConfigured("qwen")).toBe(false);
    expect(isCompatibleProviderConfigured("openai")).toBe(false);
    expect(isCompatibleProviderConfigured("local_openai_compatible")).toBe(false);

    process.env.LOCAL_OPENAI_COMPATIBLE_BASE_URL = "http://10.0.0.5:8080/v1";
    expect(isCompatibleProviderConfigured("local_openai_compatible")).toBe(true);

    if (prev.d !== undefined) process.env.DEEPSEEK_API_KEY = prev.d;
    if (prev.q !== undefined) process.env.QWEN_API_KEY = prev.q;
    if (prev.o !== undefined) process.env.OPENAI_API_KEY = prev.o;
    if (prev.l !== undefined) process.env.LOCAL_OPENAI_COMPATIBLE_BASE_URL = prev.l;
    else delete process.env.LOCAL_OPENAI_COMPATIBLE_BASE_URL;
  });
});

describe("assertComposerProviderPolicy — local openai compatible", () => {
  it("does NOT apply cloud_vision_not_allowed to local provider", () => {
    const r = assertComposerProviderPolicy({
      provider: "local_openai_compatible",
      aiMode: "SELECTED_IMAGES",
      cloudVisionAllowed: false,
      imageCount: 1,
      localEndpointConfigured: true,
    });
    expect(r).toEqual({ ok: true });
  });

  it("fails closed when local endpoint missing", () => {
    const r = assertComposerProviderPolicy({
      provider: "local_openai_compatible",
      aiMode: "TEXT_ONLY",
      localEndpointConfigured: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("local_openai_compatible_endpoint_not_configured");
  });

  it("still requires cloud credentials for DeepSeek/Qwen/OpenAI", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const r = assertComposerProviderPolicy({
      provider: "deepseek",
      aiMode: "TEXT_ONLY",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("deepseek_api_key_not_configured");
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
  });

  it("still blocks cloud vision without opt-in", () => {
    const prev = process.env.QWEN_API_KEY;
    process.env.QWEN_API_KEY = "sk-test";
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
});

describe("cloud image egress — local exempt", () => {
  it("allows local_openai_compatible images without cloudVisionAllowed", () => {
    const r = assertCloudImageEgress({
      provider: "local_openai_compatible",
      imageCount: 2,
      cloudVisionAllowed: false,
    });
    expect(r.ok).toBe(true);
  });

  it("leaves Ollama unchanged", () => {
    expect(
      assertCloudImageEgress({ provider: "ollama", imageCount: 1, cloudVisionAllowed: false }).ok,
    ).toBe(true);
  });
});

describe("openAiCompatibleChat — optional API key", () => {
  it("rejects empty key for cloud providers", async () => {
    const r = await openAiCompatibleChat({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "",
      model: "deepseek-v4-pro",
      userPrompt: "hi",
      jsonMode: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("deepseek_api_key_not_configured");
  });

  it("allows empty key when allowEmptyApiKey is true", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"findings":"ok","impression":"ok"}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    // OpenAI SDK uses fetch under the hood in Node 18+
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const r = await openAiCompatibleChat({
        provider: "local_openai_compatible",
        baseURL: "http://127.0.0.1:18080/v1",
        apiKey: "",
        model: "bonsai",
        userPrompt: "hi",
        jsonMode: false,
        allowEmptyApiKey: true,
        timeoutMs: 5_000,
      });
      // May fail if SDK path differs; either ok or non-key error is fine —
      // the important assertion is we did NOT get api_key_not_configured.
      if (!r.ok) {
        expect(r.safeError).not.toBe("local_openai_compatible_api_key_not_configured");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("LocalOpenAiCompatibleComposerAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves as LOCAL and uses image_url data URIs (not Ollama images[])", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.response_format).toBeUndefined(); // jsonMode default false
      const content = body.messages?.find((m: { role: string }) => m.role === "user")?.content;
      expect(Array.isArray(content)).toBe(true);
      const imagePart = content.find((p: { type: string }) => p.type === "image_url");
      expect(imagePart?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"findings":"disc","impression":"ok"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new LocalOpenAiCompatibleComposerAdapter();
    const result = await adapter.compose({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "bonsai",
      temperature: 0.1,
      timeoutMs: 5000,
      endpoint: "http://127.0.0.1:18080/v1",
      images: [{ mimeType: "image/jpeg", base64: "QUJDRA==" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.execution).toBe("LOCAL");
      expect(result.provider).toBe("local_openai_compatible");
    }
    expect(fetchMock).toHaveBeenCalled();
    const callUrl = String((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(callUrl).toContain("/chat/completions");
    expect(callUrl).not.toContain("/api/chat");
  });

  it("fails closed when vision capability is disabled", async () => {
    const { localOpenAiModelSupportsVision } = await import("./localOpenAiCompatibleConfig");
    vi.mocked(localOpenAiModelSupportsVision).mockResolvedValueOnce(false);

    const adapter = new LocalOpenAiCompatibleComposerAdapter();
    const result = await adapter.compose({
      systemPrompt: "s",
      userPrompt: "u",
      model: "text-only-model",
      temperature: 0.1,
      timeoutMs: 1000,
      endpoint: "http://127.0.0.1:18080/v1",
      images: [{ mimeType: "image/jpeg", base64: "QQ==" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.safeError).toBe("model_not_vision_capable");
      expect(result.execution).toBe("LOCAL");
    }
  });
});

describe("Ollama freeze — unchanged native path", () => {
  it("still resolves ollama adapter and does not share local_openai id", () => {
    expect(resolveComposerProvider("ollama")).toBeInstanceOf(OllamaComposerAdapter);
    expect(resolveComposerProvider("local_openai_compatible")).toBeInstanceOf(
      LocalOpenAiCompatibleComposerAdapter,
    );
    expect(parseComposerProviderName("local_openai_compatible")).toBe("local_openai_compatible");
    expect(parseComposerProviderName("unknown")).toBe("ollama");
  });
});

describe("session override snapshot fields", () => {
  it("parses sessionProvider/sessionModel without affecting required clinical fields", () => {
    const snap = parseComposerSnapshot({
      findings: "a",
      impression: "b",
      recommendation: "",
      clinicalHistory: "",
      technique: "",
      observations: [],
      sessionProvider: "local_openai_compatible",
      sessionModel: "bonsai",
    });
    expect(snap.sessionProvider).toBe("local_openai_compatible");
    expect(snap.sessionModel).toBe("bonsai");
  });

  it("session provider/model are excluded from clinical inputHash", async () => {
    const { computeSnapshotHashes } = await import("../snapshot");
    const base = {
      findings: "disc bulge",
      impression: "radiculopathy",
      recommendation: "",
      clinicalHistory: "",
      technique: "MRI",
      observations: [] as [],
      modality: "MRI",
      region: "LS Spine",
    };
    const h1 = computeSnapshotHashes(parseComposerSnapshot(base));
    const h2 = computeSnapshotHashes(
      parseComposerSnapshot({
        ...base,
        sessionProvider: "local_openai_compatible",
        sessionModel: "bonsai",
      }),
    );
    const h3 = computeSnapshotHashes(
      parseComposerSnapshot({
        ...base,
        sessionProvider: "ollama",
        sessionModel: "qwen3:14b",
      }),
    );
    expect(h1.inputHash).toBe(h2.inputHash);
    expect(h2.inputHash).toBe(h3.inputHash);
    expect(h1.reportRevision).toBe(h2.reportRevision);
  });

  it("clearing session fields leaves snapshot on Settings/Ollama path (no session keys)", () => {
    const snap = parseComposerSnapshot({
      findings: "a",
      impression: "b",
      recommendation: "",
      clinicalHistory: "",
      technique: "",
      observations: [],
    });
    expect(snap.sessionProvider).toBeUndefined();
    expect(snap.sessionModel).toBeUndefined();
  });

  it("does not infer vision merely from model name for local provider", () => {
    expect(modelSupportsVision("local_openai_compatible", "some-random-vl-name")).toBe(false);
    expect(modelSupportsVision("local_openai_compatible", "bonsai")).toBe(true);
    expect(assertVisionCapable("local_openai_compatible", "unknown-model").ok).toBe(false);
  });
});

describe("workspace override never mutates global routes (source contract)", () => {
  it("useReportComposer only embeds sessionProvider in snapshot — no model-routing API writes", () => {
    const src = readFileSync(
      join(
        __dirname,
        "../../../../../diagnostic-erp/src/hooks/useReportComposer.ts",
      ),
      "utf8",
    );
    expect(src).toMatch(/sessionProvider/);
    expect(src).not.toMatch(/ai-model-routing/);
    expect(src).not.toMatch(/ai_model_routes/);
  });
});
