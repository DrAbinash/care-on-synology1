import { describe, it, expect } from "vitest";
import {
  classifyResourceFailure,
  parseGpuOutOfMemory,
  RESOURCE_FAILURE_CODES,
} from "./providerResourceErrors";
import { formatPsSummary, type OllamaPsSnapshot } from "./ollamaRunnerDiagnostics";
import {
  estimateSpatialVisionTokens,
  suggestDiagnosticNumCtx,
  summarizeVisionTokenBudget,
} from "./visionImageTokens";
import { auditOvernightImageSelection } from "./mriSeriesSelectionDesign";
import { resolveInteractiveDraftNumCtx, PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX } from "./contextBudget";

describe("providerResourceErrors", () => {
  it("exposes permanent failure codes including GPU_OUT_OF_MEMORY", () => {
    expect(RESOURCE_FAILURE_CODES).toContain("GPU_OUT_OF_MEMORY");
    expect(RESOURCE_FAILURE_CODES).toContain("CONTEXT_BUDGET_EXCEEDED");
    expect(RESOURCE_FAILURE_CODES).toContain("EMPTY_MODEL_OUTPUT");
    expect(RESOURCE_FAILURE_CODES).toContain("QUARANTINED");
  });

  it("parses cudaMalloc OOM", () => {
    const p = parseGpuOutOfMemory(
      "Ollama /api/chat 500: cudaMalloc failed: out of memory failed to allocate CUDA buffer of size 1420000000",
    );
    expect(p?.code).toBe("GPU_OUT_OF_MEMORY");
  });

  it("never classifies CUDA OOM as EMPTY", () => {
    const c = classifyResourceFailure({
      success: false,
      httpStatus: 500,
      errorMessage: "cudaMalloc failed: out of memory",
      responseLength: 0,
    });
    expect(c.code).toBe("GPU_OUT_OF_MEMORY");
    expect(c.stopLargerProbes).toBe(true);
    expect(c.code).not.toBe("EMPTY_MODEL_OUTPUT");
  });

  it("classifies empty success as EMPTY_MODEL_OUTPUT", () => {
    const c = classifyResourceFailure({
      success: true,
      httpStatus: 200,
      responseLength: 0,
    });
    expect(c.code).toBe("EMPTY_MODEL_OUTPUT");
  });

  it("maps TIMEOUT_OR_ABORT alias to PROVIDER_TIMEOUT", () => {
    const c = classifyResourceFailure({
      success: false,
      errorCode: "TIMEOUT_OR_ABORT",
      errorMessage: "aborted",
    });
    expect(c.code).toBe("PROVIDER_TIMEOUT");
  });
});

describe("visionImageTokens", () => {
  it("estimates spatial tokens from dimensions (not JPEG bytes)", () => {
    // 512x512 / 14 ≈ 37*37 = 1369
    expect(estimateSpatialVisionTokens(512, 512)).toBe(37 * 37);
  });

  it("shows JPEG bytes are tiny vs token estimates", () => {
    const s = summarizeVisionTokenBudget({
      imageCount: 6,
      dimensions: Array.from({ length: 6 }, () => ({
        width: 512,
        height: 512,
        byteSize: 40_000,
      })),
    });
    expect(s.totalJpegBytes).toBeLessThan(300_000);
    expect(s.empiricalEstimateTokens).toBeGreaterThan(6000);
    expect(s.spatialEstimateTokens).toBeGreaterThan(5000);
  });

  it("suggests num_ctx that fits estimate without forcing 16384 for small payloads", () => {
    expect(suggestDiagnosticNumCtx(2000)).toBe(4096);
    expect(suggestDiagnosticNumCtx(6453)).toBe(8192);
  });
});

describe("overnight selection audit", () => {
  it("flags large caps and missing SeriesDescription", () => {
    const audit = auditOvernightImageSelection({
      modality: "MR",
      contextBudgetMaxImages: 13,
      series: [
        { seriesUid: "S1", seriesNumber: 1, seriesDescription: null, instanceCount: 30 },
        { seriesUid: "S2", seriesNumber: 2, seriesDescription: null, instanceCount: 30 },
        { seriesUid: "S3", seriesNumber: 3, seriesDescription: null, instanceCount: 30 },
        { seriesUid: "S4", seriesNumber: 4, seriesDescription: null, instanceCount: 30 },
        { seriesUid: "S5", seriesNumber: 5, seriesDescription: null, instanceCount: 30 },
      ],
    });
    expect(audit.historicalHardCap).toBe(20);
    expect(audit.effectiveMaxImages).toBe(13);
    expect(audit.totalWouldSelect).toBeLessThanOrEqual(13);
    expect(audit.warnings.some((w) => /SeriesDescription/i.test(w))).toBe(true);
    expect(audit.proposedNextSteps.some((s) => /16384/i.test(s))).toBe(true);
  });

  it("does not change interactive draft preference away from 8192", () => {
    const r = resolveInteractiveDraftNumCtx({ configuredNumCtx: 16384, imageCount: 6 });
    expect(r.requestedNumCtx).toBe(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });
});

describe("ollamaRunnerDiagnostics format", () => {
  it("formats PHI-safe ps summary", () => {
    const ps: OllamaPsSnapshot = {
      capturedAt: new Date().toISOString(),
      ok: true,
      httpStatus: 200,
      runnerCount: 2,
      runners: [
        {
          model: "qwen3-vl:8b",
          sizeBytes: 1e9,
          sizeVramBytes: 5e9,
          contextLength: 4096,
          expiresAt: null,
          done: true,
        },
        {
          model: "qwen3-vl:8b",
          sizeBytes: 1e9,
          sizeVramBytes: 6e9,
          contextLength: 8192,
          expiresAt: null,
          done: false,
        },
      ],
      totalSizeVramBytes: 11e9,
    };
    const s = formatPsSummary(ps);
    expect(s).toMatch(/ps=2/);
    expect(s).toMatch(/ctx=4096/);
    expect(s).toMatch(/ctx=8192/);
    expect(s).not.toMatch(/patient|FINDINGS|base64/i);
  });
});
