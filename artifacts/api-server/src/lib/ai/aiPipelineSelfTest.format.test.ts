import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({
  pacsSettingsTable: {},
  radiologyWorklistTable: {},
}));
vi.mock("@workspace/ai-providers", () => ({
  CANONICAL_LOCAL_CHAT_VISION_MODEL: "qwen3-vl:8b",
  CANONICAL_OLLAMA_ENDPOINT: "http://172.16.1.140:11434",
  buildOllamaChatPayload: () => ({ model: "qwen3-vl:8b", messages: [], stream: false }),
  estimateBase64DecodedBytes: () => 100,
  generateAiForTask: vi.fn(),
  loadProviderConfig: vi.fn(),
  probeOllamaReachable: vi.fn(),
  resolveTaskRoute: vi.fn(),
}));
vi.mock("../aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: vi.fn(),
}));
vi.mock("./studyImageFetch", () => ({
  orthancAuthHeaders: () => ({}),
  resolveOrthancBaseFromSources: () => null,
}));
vi.mock("../logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { formatSelfTestReport, assertDiagnosticReportPhiSafe } = await import("./aiPipelineSelfTest");
import type { AiPipelineSelfTestResult } from "./aiPipelineSelfTest";

describe("formatSelfTestReport (hardened)", () => {
  it("includes all probe sections and stays PHI-safe", () => {
    const result: AiPipelineSelfTestResult = {
      id: "abc",
      status: "completed",
      final: "PARTIAL",
      summary: "PARTIAL / FAIL — Provider OK with 1 image; fails with normal draft image count (up to 6).",
      steps: [
        {
          id: "direct-generate",
          group: "Direct Ollama",
          name: "/api/generate 1 image",
          status: "pass",
          detail: "PASS",
          elapsedMs: 13200,
        },
        {
          id: "provider-6",
          group: "Provider-only",
          name: "generateAiForTask 6 images",
          status: "fail",
          detail: "FAIL · HTTP 502",
          elapsedMs: 30100,
        },
      ],
      probes: [
        {
          label: "Direct /api/generate 1 image",
          pass: true,
          model: "qwen3-vl:8b",
          endpoint: "http://172.16.1.140:11434",
          imageCount: 1,
          totalImageBytes: 15001,
          requestBodyBytes: 20000,
          elapsedMs: 13200,
          httpStatus: 200,
          responseLength: 80,
          parserSuccess: null,
          candidateCount: null,
          safeError: null,
          stages: [],
          thinkSent: true,
          thinkValue: false,
          thinkingLength: 12,
        },
        {
          label: "Provider-only 6 images",
          pass: false,
          model: "qwen3-vl:8b",
          endpoint: "http://172.16.1.140:11434",
          imageCount: 6,
          totalImageBytes: 90000,
          requestBodyBytes: 120000,
          elapsedMs: 30100,
          httpStatus: 502,
          responseLength: 0,
          parserSuccess: null,
          candidateCount: null,
          safeError: "TIMEOUT_OR_ABORT",
          stages: [
            {
              id: "provider_request",
              status: "fail",
              detail: "FAIL 502 at 30.1s",
              elapsedMs: 30100,
            },
            {
              id: "json_parse",
              status: "not_reached",
              detail: "not reached",
            },
          ],
        },
      ],
      stagesByProbe: {},
      technical: {
        imageSelection: {
          seriesCount: 8,
          selectedCount: 6,
          perImageByteSizes: [15001, 16000, 14000, 15000, 15500, 14500],
          seriesDescriptions: ["AX T2", "AX T1", "AX FLAIR", "DWI", "ADC", "SWI"],
        },
      },
      startedAt: "2026-04-20T00:00:00.000Z",
      finishedAt: "2026-04-20T00:02:00.000Z",
      progressLabel: "done",
      safety: {
        writesClinicalReport: false,
        finalizesReport: false,
        bulkEnqueuesOvernight: false,
        diagnosticOnly: true,
      },
    };
    const text = formatSelfTestReport(result);
    expect(text).toContain("Direct /api/generate 1 image");
    expect(text).toContain("Provider-only 6 images");
    expect(text).toContain("stage provider_request: FAIL");
    expect(text).toContain("thinkingLength");
    expect(text).toContain("imageCount: 6");
    expect(assertDiagnosticReportPhiSafe(text).ok).toBe(true);
    expect(text).not.toMatch(/data:image|base64,/i);
  });
});
