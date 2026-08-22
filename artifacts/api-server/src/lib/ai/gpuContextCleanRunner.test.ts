import { describe, expect, it } from "vitest";
import {
  decideGpuContextProbeAction,
  formatGpuContextDiagnosticReport,
  GPU_CONTEXT_CLEAN_RUNNER_MATRIX,
  type GpuContextProbeRow,
} from "./gpuContextCleanRunner";
import { isModelAbsentFromPs, type OllamaPsSnapshot } from "./ollamaRunnerDiagnostics";

function emptyRow(partial: Partial<GpuContextProbeRow> & Pick<GpuContextProbeRow, "id" | "imageCount" | "numCtx">): GpuContextProbeRow {
  return {
    optional: false,
    skipped: false,
    skipReason: null,
    pass: true,
    httpStatus: 200,
    elapsedMs: 1000,
    estimatedRequestTokens: 1000,
    ollamaRequestTokens: 1000,
    ollamaAvailableContext: 4096,
    errorCode: null,
    gpuOutOfMemory: false,
    contextBudgetExceeded: false,
    outputBudgetExhausted: false,
    responseLength: 20,
    parserSuccess: null,
    candidateCount: null,
    usableOutput: true,
    psBefore: "ps=0 runners",
    psAfter: "ps=1 qwen",
    runnerClearedBeforeRequest: true,
    ...partial,
  };
}

describe("GPU_CONTEXT_CLEAN_RUNNER_MATRIX", () => {
  it("matches the minimal benchmark (4096 1/2 img, 6144 1 img)", () => {
    expect(GPU_CONTEXT_CLEAN_RUNNER_MATRIX.map((c) => `${c.imageCount}@${c.numCtx}`)).toEqual([
      "1@4096",
      "2@4096",
      "1@6144",
    ]);
    expect(GPU_CONTEXT_CLEAN_RUNNER_MATRIX.filter((c) => c.optional).length).toBe(0);
  });
});

describe("decideGpuContextProbeAction", () => {
  const cell2 = GPU_CONTEXT_CLEAN_RUNNER_MATRIX[1]!;
  const cell6144 = GPU_CONTEXT_CLEAN_RUNNER_MATRIX[2]!;

  it("stops remaining after GPU_OUT_OF_MEMORY", () => {
    const prior = [
      emptyRow({
        id: "gpu-1-4096",
        imageCount: 1,
        numCtx: 4096,
        pass: false,
        gpuOutOfMemory: true,
        errorCode: "GPU_OUT_OF_MEMORY",
      }),
    ];
    const d = decideGpuContextProbeAction({
      cell: cell2,
      prior,
      availableImageCount: 6,
      hardStop: "none",
    });
    expect(d.action).toBe("skip");
    expect(d.hardStop).toBe("gpu_out_of_memory");
  });

  it("skips larger N@same ctx after CONTEXT_BUDGET_EXCEEDED", () => {
    const prior = [
      emptyRow({
        id: "gpu-1-4096",
        imageCount: 1,
        numCtx: 4096,
        pass: false,
        contextBudgetExceeded: true,
        errorCode: "CONTEXT_BUDGET_EXCEEDED",
      }),
    ];
    const skip2 = decideGpuContextProbeAction({
      cell: cell2,
      prior,
      availableImageCount: 6,
      hardStop: "none",
    });
    expect(skip2.action).toBe("skip");
    expect(skip2.hardStop).toBe("none");
    const runHigherCtx = decideGpuContextProbeAction({
      cell: cell6144,
      prior,
      availableImageCount: 6,
      hardStop: "none",
    });
    expect(runHigherCtx.action).toBe("run");
  });

  it("stops when runner was not cleared", () => {
    const prior = [
      emptyRow({
        id: "gpu-1-4096",
        imageCount: 1,
        numCtx: 4096,
        runnerClearedBeforeRequest: false,
        pass: false,
        errorCode: "RUNNER_NOT_CLEARED",
      }),
    ];
    const d = decideGpuContextProbeAction({
      cell: cell6144,
      prior,
      availableImageCount: 6,
      hardStop: "none",
    });
    expect(d.action).toBe("skip");
    expect(d.hardStop).toBe("runner_not_cleared");
  });
});

describe("formatGpuContextDiagnosticReport", () => {
  it("emits a compact paste-back table without claiming production defaults changed", () => {
    const text = formatGpuContextDiagnosticReport({
      selfTestId: "abc",
      model: "qwen3-vl:8b",
      endpoint: "http://172.16.1.140:11434",
      availableImageCount: 6,
      hardStop: "none",
      rows: [
        emptyRow({ id: "gpu-1-4096", imageCount: 1, numCtx: 4096 }),
      ],
      productionDefaultsChanged: false,
    });
    expect(text).toContain("GPU/CONTEXT CLEAN-RUNNER DIAGNOSTIC");
    expect(text).toContain("productionDefaultsChanged: false");
    expect(text).toContain("gpu-1-4096 | 1 | 4096");
    expect(text).not.toMatch(/patient|accession|studyInstanceUid/i);
  });
});

describe("isModelAbsentFromPs", () => {
  it("treats empty runners as absent", () => {
    const ps: OllamaPsSnapshot = {
      capturedAt: new Date().toISOString(),
      ok: true,
      httpStatus: 200,
      runnerCount: 0,
      runners: [],
      totalSizeVramBytes: null,
    };
    expect(isModelAbsentFromPs(ps, "qwen3-vl:8b")).toBe(true);
  });

  it("detects matching runner present", () => {
    const ps: OllamaPsSnapshot = {
      capturedAt: new Date().toISOString(),
      ok: true,
      httpStatus: 200,
      runnerCount: 1,
      runners: [
        {
          model: "qwen3-vl:8b",
          sizeBytes: 1,
          sizeVramBytes: 1,
          contextLength: 8192,
          expiresAt: null,
          done: true,
        },
      ],
      totalSizeVramBytes: 1,
    };
    expect(isModelAbsentFromPs(ps, "qwen3-vl:8b")).toBe(false);
  });
});
