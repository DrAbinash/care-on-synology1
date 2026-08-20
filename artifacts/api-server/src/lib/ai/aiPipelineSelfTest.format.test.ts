import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({
  pacsSettingsTable: {},
  radiologyWorklistTable: {},
}));
vi.mock("@workspace/ai-providers", () => ({
  CANONICAL_LOCAL_CHAT_VISION_MODEL: "qwen3-vl:8b",
  CANONICAL_OLLAMA_ENDPOINT: "http://172.16.1.140:11434",
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

const { formatSelfTestReport } = await import("./aiPipelineSelfTest");
import type { AiPipelineSelfTestResult } from "./aiPipelineSelfTest";

describe("formatSelfTestReport", () => {
  it("renders a pasteable PHI-safe report", () => {
    const result: AiPipelineSelfTestResult = {
      id: "abc",
      status: "completed",
      final: "PARTIAL",
      summary: "PARTIAL / FAIL — Direct vision healthy; CARE application path failed.",
      steps: [
        {
          id: "direct-vision",
          group: "Direct qwen vision",
          name: "Ollama /api/generate",
          status: "pass",
          detail: "HTTP 200 · 13.2 sec · non-empty",
          elapsedMs: 13200,
        },
        {
          id: "care-pipeline",
          group: "CARE AI pipeline",
          name: "/api/ai-reporting/draft path",
          status: "fail",
          detail: "502 after 30.1 sec — AbortError/TIMEOUT_OR_ABORT",
          elapsedMs: 30100,
        },
      ],
      technical: {
        ollamaEndpoint: "http://172.16.1.140:11434",
        model: "qwen3-vl:8b",
        imageBytes: 15001,
      },
      startedAt: "2026-04-20T00:00:00.000Z",
      finishedAt: "2026-04-20T00:01:00.000Z",
      progressLabel: "done",
    };
    const text = formatSelfTestReport(result);
    expect(text).toContain("AI PIPELINE SELF-TEST");
    expect(text).toContain("PARTIAL");
    expect(text).toContain("Direct vision healthy");
    expect(text).toContain("172.16.1.140:11434");
    expect(text).not.toMatch(/data:image|base64,/i);
  });
});
