import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../featureFlags", () => ({
  isFeatureEnabledServer: vi.fn(async () => true),
}));

vi.mock("../aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: vi.fn(async () => ({
    ollamaBaseUrl: "http://172.16.1.140:11434",
    ollamaEnabled: true,
    modelStandard: "qwen3-vl:8b",
    localChatVisionModel: "qwen3-vl:8b",
    ollamaUrlSource: "canonical",
    modelStandardSource: "canonical",
    timeoutFastSeconds: 30,
  })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => [{
            ollamaEnabled: true,
            ollamaBaseUrl: "http://172.16.1.140:11434",
            ollamaModel: "qwen3-vl:8b",
            ollamaLocalOnly: true,
          }]),
        })),
      })),
    })),
  },
  clinicSettingsTable: {},
}));

vi.mock("./overnightVisionConfig", () => ({
  getOvernightVisionInferenceOptions: vi.fn(async () => ({
    model: "qwen3-vl:8b",
    endpointUrl: "http://172.16.1.140:11434",
    numCtx: 16384,
    think: false,
    temperature: 0.1,
    concurrency: 1,
  })),
}));

const mockQuery = vi.fn(async (_opts?: unknown) => ({ success: true, text: "AI_DRAFT_VERIFY_OK" }));
vi.mock("@workspace/ai-providers", () => ({
  probeOllamaReachable: vi.fn(async () => ({ reachable: true, error: null })),
  createAiProvider: vi.fn(async () => ({
    query: (opts: unknown) => mockQuery(opts),
    testConnection: vi.fn(),
  })),
}));

vi.mock("./clinicalConfigService", () => ({
  AI_MASTER_FLAG: "ff_radiology_ai",
  getSchedulerConfig: vi.fn(async () => ({
    draftTiming: "on_arrival",
    nightStart: "23:00",
    nightEnd: "06:00",
    quietStart: "08:00",
    quietEnd: "20:00",
    maxConcurrentJobs: 2,
    gpuLimitPercent: 90,
    cpuLimitPercent: 80,
    skipFinalizedReports: true,
    skipUnchangedStudies: true,
  })),
  getModalityPolicies: vi.fn(async () => [
    { modality: "MR", mode: "immediate" },
    { modality: "CT", mode: "immediate" },
  ]),
}));

vi.mock("./shadowPipeline", () => ({
  AI_SHADOW_PIPELINE_JOB: "ai_shadow_pipeline",
}));

vi.mock("../radiologyJobs", () => ({
  jobBacklogCounts: vi.fn(async () => ({ pending: 0, running: 0, deadLetter: 0 })),
  listDeadLetterJobs: vi.fn(async () => []),
}));

vi.mock("../ssrf/ollamaUrlGuard", () => ({
  validateOllamaUrl: vi.fn(() => ({ ok: true, url: new URL("http://172.16.1.140:11434") })),
}));

describe("runOllamaAiDraftVerify", () => {
  beforeEach(async () => {
    mockQuery.mockClear();
    const hb = await import("../radiologyJobConsumerHeartbeat");
    hb.resetRadiologyJobConsumerHeartbeatForTests();
    hb.markRadiologyJobConsumerRegistered();
    hb.recordRadiologyJobCronTick({
      peak: false,
      aiBlocked: false,
      dueAi: 0,
      ran: 0,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "qwen3-vl:8b" }] }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  it("passes when master flag, ollama, and canonical vision model are ready", async () => {
    const { runOllamaAiDraftVerify } = await import("./ollamaDraftVerify");
    const result = await runOllamaAiDraftVerify({ runDraft: true });
    expect(result.ok).toBe(true);
    expect(result.blockingFailed).toBe(false);
    expect(mockQuery).toHaveBeenCalled();
    const modelCheck = result.checks.find((c) => c.name.includes("Canonical local"));
    expect(modelCheck?.status).toBe("PASS");
    expect(modelCheck?.detail).toContain("qwen3-vl:8b");
    expect(modelCheck?.detail).toContain("172.16.1.140");
    const worker = result.checks.find((c) => c.name === "Overnight worker");
    expect(worker?.status).toBe("PASS");
  });

  it("fails when the queue has pending jobs and the consumer is not registered", async () => {
    const hb = await import("../radiologyJobConsumerHeartbeat");
    hb.resetRadiologyJobConsumerHeartbeatForTests();
    const jobs = await import("../radiologyJobs");
    vi.mocked(jobs.jobBacklogCounts).mockResolvedValueOnce({
      pending: 3693,
      running: 0,
      deadLetter: 658,
    });
    const { runOllamaAiDraftVerify } = await import("./ollamaDraftVerify");
    const result = await runOllamaAiDraftVerify({ runDraft: false });
    expect(result.ok).toBe(false);
    expect(result.blockingFailed).toBe(true);
    const worker = result.checks.find((c) => c.name === "Overnight worker");
    expect(worker?.status).toBe("FAIL");
    expect(worker?.detail).toMatch(/STOPPED/);
    const backlog = result.checks.find((c) => c.name === "Shadow pipeline backlog");
    expect(backlog?.status).toBe("FAIL");
  });
});
