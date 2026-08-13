import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../featureFlags", () => ({
  isFeatureEnabledServer: vi.fn(async () => true),
}));

vi.mock("../aiPipeline/runtimeConfig", () => ({
  resolveLocalAiRuntime: vi.fn(async () => ({
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaEnabled: true,
    modelStandard: "gemma3:4b",
    timeoutFastSeconds: 30,
  })),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => [{
              ollamaEnabled: true,
              ollamaBaseUrl: "http://127.0.0.1:11434",
              ollamaModel: "gemma3:4b",
              ollamaLocalOnly: true,
            }]),
          })),
        })),
      })),
    },
  };
});

vi.mock("@workspace/ai-providers", () => ({
  probeOllamaReachable: vi.fn(async () => ({ reachable: true, error: null })),
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
  validateOllamaUrl: vi.fn(() => ({ ok: true, url: new URL("http://127.0.0.1:11434") })),
}));

describe("runOllamaAiDraftVerify", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "gemma3:4b" }] }),
          };
        }
        if (url.includes("/api/generate")) {
          return {
            ok: true,
            json: async () => ({ response: "AI_DRAFT_VERIFY_OK" }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  it("returns ok when all blocking checks pass", async () => {
    const { runOllamaAiDraftVerify } = await import("./ollamaDraftVerify");
    const result = await runOllamaAiDraftVerify({ runDraft: true });
    expect(result.ok).toBe(true);
    expect(result.blockingFailed).toBe(false);
    expect(result.checks.some((c) => c.name === "Reachability" && c.status === "PASS")).toBe(true);
    expect(result.checks.some((c) => c.name === "Sample Ollama generation" && c.status === "PASS")).toBe(true);
  });

  it("skips draft generation on dry run", async () => {
    const { runOllamaAiDraftVerify } = await import("./ollamaDraftVerify");
    const result = await runOllamaAiDraftVerify({ runDraft: false });
    const draftCheck = result.checks.find((c) => c.name === "Sample Ollama generation");
    expect(draftCheck?.status).toBe("SKIPPED");
  });
});
