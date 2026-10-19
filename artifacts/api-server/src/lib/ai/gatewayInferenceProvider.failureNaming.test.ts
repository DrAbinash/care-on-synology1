/**
 * An empty AI draft used to report one sentence regardless of what happened:
 * "gateway degraded to an empty draft (provider/parse failure)". These cases pin
 * the naming: each one isolates a single provider diagnostic, because the
 * detector for the most likely clinic cause (a model that spends its whole
 * answer budget on thinking) was unreachable until those fields were forwarded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  generateAiResponse: vi.fn(),
  requestStructuredReport: vi.fn(),
}));

/**
 * PR-A put an image-send audit writer in this provider's module graph. This suite
 * is about failure naming, so the writer is replaced at its own seam rather than
 * dragging a database into every case: the writer's behaviour is proven in
 * `imageSendAudit.request.test.ts`, and what the provider files with it is proven
 * in `gatewayInferenceProvider.localOnly.test.ts`.
 */
const auditSpy = vi.hoisted(() => vi.fn());
vi.mock("./imageSendAudit", () => ({
  recordImageSendAudit: (record: unknown) => {
    auditSpy(record);
    return Promise.resolve();
  },
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@workspace/ai-providers", () => ({
  generateAiResponse: (...args: unknown[]) => h.generateAiResponse(...args),
  requestStructuredReport: (...args: unknown[]) => h.requestStructuredReport(...args),
  defaultModelForProvider: () => "qwen3.7-plus",
}));
vi.mock("./overnightVisionConfig", () => ({
  getOvernightVisionInferenceOptions: async () => ({
    model: "qwen3-vl:8b",
    endpointUrl: "http://172.16.1.140:11434",
    numCtx: 8192,
    think: false,
    temperature: 0.2,
    policy: {
      safeMode: false,
      maxTokens: 4096, // == num_predict sent to Ollama; the budget under test
      timeoutMs: 60_000,
      maxImages: 4,
      imageCapReason: "test cap",
      numCtxSource: "env",
    },
  }),
}));
vi.mock("./clinicalConfigService", () => ({
  getOvernightOpsControls: async () => ({
    nightVisionProvider: "local",
    deepseekCloudVisionAllowed: false,
  }),
}));

const { gatewayInferenceProvider } = await import("./gatewayInferenceProvider");

const input = {
  studyInstanceUid: "1.2.840.10000.naming",
  modality: "MR",
  imageAnchors: [{ seriesUid: "1.2.s", sopUid: "1.2.i", frameNumber: 1 }],
  images: [{ imageData: "ZmFrZQ==", seriesUid: "1.2.s", sopUid: "1.2.i", frameNumber: 1 }],
};

function providerEmpty(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    text: "",
    error: undefined,
    diagnostics: {
      provider: "ollama",
      model: "qwen3-vl:8b",
      httpStatus: 200,
      responseLength: 0,
      elapsedMs: 15_000,
      errorCode: null,
      errorClass: null,
      thinkingLength: 0,
      ollamaEvalCount: null,
      finishReason: null,
      ...extra,
    },
  };
}

function providerText(text: string) {
  return {
    ...providerEmpty({ responseLength: text.length, finishReason: "stop", ollamaEvalCount: 40 }),
    text,
  };
}

function gatewayDegraded(detail: string) {
  return {
    report: {
      studyContext: { studyInstanceUid: input.studyInstanceUid, modality: "MR", imageCount: 1 },
      findings: [],
      measurements: [],
      impression: [],
    },
    degraded: true,
    provider: null,
    model: null,
    modelDigest: null,
    attempts: 1,
    detail,
  };
}

function gatewayOk(impression: string[]) {
  return {
    report: {
      studyContext: { studyInstanceUid: input.studyInstanceUid, modality: "MR", imageCount: 1 },
      findings: [],
      measurements: [],
      impression,
    },
    degraded: false,
    provider: "ollama",
    model: "qwen3-vl:8b",
    modelDigest: "sha256:x",
    attempts: 1,
    detail: "ok via ollama/qwen3-vl:8b",
  };
}

beforeEach(() => {
  h.generateAiResponse.mockReset();
  h.requestStructuredReport.mockReset();
  h.requestStructuredReport.mockResolvedValue(
    gatewayDegraded("all providers failed/invalid — deterministic-only"),
  );
});

describe("gateway inference failure naming", () => {
  it("names a truncated answer from finishReason alone", async () => {
    h.generateAiResponse.mockResolvedValue(providerEmpty({ finishReason: "length" }));
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(out.provenance.failureDetail).toContain("num_predict budget exhausted");
  });

  it("names a spent budget from evalCount reaching num_predict", async () => {
    // finishReason absent — only the eval counter can prove the budget ran out.
    h.generateAiResponse.mockResolvedValue(providerEmpty({ ollamaEvalCount: 4096 }));
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(out.provenance.failureDetail).toContain("eval=4096");
  });

  it("names a thinking-only answer from thinkingLength plus a near-full budget", async () => {
    h.generateAiResponse.mockResolvedValue(
      providerEmpty({ thinkingLength: 4090, ollamaEvalCount: 4095 }),
    );
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(out.provenance.failureDetail).toContain("thinkingLen=4090");
  });

  it("does not blame the budget when the model simply returned nothing", async () => {
    h.generateAiResponse.mockResolvedValue(providerEmpty({ ollamaEvalCount: 12 }));
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBe("EMPTY_MODEL_OUTPUT");
  });

  it("names an unparseable answer distinctly from an empty one", async () => {
    h.generateAiResponse.mockResolvedValue(providerText("Sorry, I cannot produce JSON."));
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBe("PARSE_FAILED");
    expect(out.provenance.failureDetail).toContain("could not be parsed");
    // The gateway's own verdict stays in the debug line.
    expect(out.provenance.detail).toContain("deterministic-only");
  });

  it("names a GPU exhaustion on the failed arm and keeps the recovery signal", async () => {
    h.generateAiResponse.mockResolvedValue({
      success: false,
      text: "",
      error: "CUDA error: out of memory in operation",
      diagnostics: {
        provider: "ollama",
        httpStatus: 500,
        responseLength: 0,
        elapsedMs: 800,
        errorCode: "PROVIDER_ERROR",
      },
    });
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBe("GPU_OUT_OF_MEMORY");
    // resourceFailureCode drives model unload + the overnight pause streak.
    // Naming a cause must not change it, and must not silently widen it either.
    expect(out.provenance.resourceFailureCode).toBe("GPU_OUT_OF_MEMORY");
    expect(out.provenance.degraded).toBe(true);
  });

  it("records no failure on a draft that came through", async () => {
    h.generateAiResponse.mockResolvedValue(providerText('{"findings":[]}'));
    h.requestStructuredReport.mockResolvedValue(gatewayOk(["No significant abnormality."]));
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.failureCode).toBeNull();
    expect(out.provenance.failureDetail).toBeNull();
    expect(out.draft.impression).toEqual(["No significant abnormality."]);
  });

  it("carries the named cause into the debug detail line", async () => {
    h.generateAiResponse.mockResolvedValue(providerEmpty({ finishReason: "length" }));
    const out = await gatewayInferenceProvider.infer(input);
    expect(out.provenance.detail).toContain("cause=OUTPUT_BUDGET_EXHAUSTED");
  });
});
