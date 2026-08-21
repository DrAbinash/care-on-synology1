import { describe, it, expect } from "vitest";
import {
  DEFAULT_OVERNIGHT_OPS,
  parseOvernightOpsJson,
  recordOvernightResourceFailure,
  recordOvernightResourceSuccess,
  resolveOvernightImageCap,
  resolveOvernightNumCtx,
} from "./overnightOpsControls";
import {
  buildProductionVisionPolicy,
  preflightReduceImagesForContext,
  classifyOvernightProviderFailure,
} from "./productionVisionPolicy";
import { decideFailure } from "../radiologyJobRules";
import { refineDisplayStatusFromAiDraftPointer } from "./overnightAiDraftStatus";

describe("overnightOpsControls", () => {
  it("defaults preserve current production (not paused, auto, current ctx)", () => {
    expect(DEFAULT_OVERNIGHT_OPS.paused).toBe(false);
    expect(DEFAULT_OVERNIGHT_OPS.imageCap).toBe("auto");
    expect(DEFAULT_OVERNIGHT_OPS.visionCtx).toBe("current");
    expect(DEFAULT_OVERNIGHT_OPS.safeMode).toBe(false);
  });

  it("visionCtx=current does not force 16384", () => {
    const r = resolveOvernightNumCtx({ configuredNumCtx: 16384, visionCtx: "current" });
    expect(r.numCtx).toBe(16384);
    expect(r.source).toMatch(/unchanged/i);
  });

  it("Safe Mode forces exactly one image", () => {
    const r = resolveOvernightImageCap({
      imageCap: "6",
      safeMode: true,
      contextBudgetMaxImages: 13,
    });
    expect(r.maxImages).toBe(1);
  });

  it("pauses overnight after 3 consecutive same resource failures", () => {
    let ops = { ...DEFAULT_OVERNIGHT_OPS };
    ops = recordOvernightResourceFailure(ops, "GPU_OUT_OF_MEMORY", 3);
    ops = recordOvernightResourceFailure(ops, "GPU_OUT_OF_MEMORY", 3);
    expect(ops.paused).toBe(false);
    ops = recordOvernightResourceFailure(ops, "GPU_OUT_OF_MEMORY", 3);
    expect(ops.paused).toBe(true);
    expect(ops.pauseReason).toMatch(/PAUSED/);
  });

  it("success clears streak but not operator pause", () => {
    const paused = {
      ...DEFAULT_OVERNIGHT_OPS,
      paused: true,
      pauseReason: "operator",
      resourceFailStreak: 2,
      lastResourceFailCode: "GPU_OUT_OF_MEMORY",
    };
    const next = recordOvernightResourceSuccess(paused);
    expect(next.resourceFailStreak).toBe(0);
    expect(next.paused).toBe(true);
  });

  it("parses ops json safely", () => {
    expect(parseOvernightOpsJson('{"imageCap":"4","safeMode":true}').imageCap).toBe("4");
    expect(parseOvernightOpsJson("not-json").imageCap).toBe("auto");
  });
});

describe("productionVisionPolicy preflight", () => {
  it("reduces image count before oversized provider request", () => {
    const r = preflightReduceImagesForContext({
      requestedImages: 20,
      numCtx: 8192,
      promptLength: 500,
    });
    expect(r.reduced).toBe(true);
    expect(r.selectedImages).toBeLessThan(20);
    expect(r.fits).toBe(true);
  });

  it("buildProductionVisionPolicy Safe Mode uses 1 image and does not invent 16384", () => {
    const p = buildProductionVisionPolicy({
      model: "qwen3-vl:8b",
      endpointUrl: "http://127.0.0.1:11434",
      configuredNumCtx: 16384,
      think: false,
      temperature: 0.1,
      ops: { ...DEFAULT_OVERNIGHT_OPS, safeMode: true, visionCtx: "current" },
    });
    expect(p.maxImages).toBe(1);
    expect(p.numCtx).toBe(16384);
    expect(p.safeMode).toBe(true);
  });

  it("classifies CUDA OOM for one recovery, then stop", () => {
    const f = classifyOvernightProviderFailure({
      success: false,
      httpStatus: 500,
      errorMessage: "cudaMalloc failed: out of memory",
    });
    expect(f.code).toBe("GPU_OUT_OF_MEMORY");
    expect(f.allowOneRecovery).toBe(true);
    expect(f.stopRetries).toBe(true);
  });
});

describe("resource failures never ordinary-retry", () => {
  const NOW = new Date("2026-08-21T00:00:00Z");
  it("GPU_OUT_OF_MEMORY abandons immediately", () => {
    const d = decideFailure({
      retryCount: 0,
      maxRetries: 5,
      now: NOW,
      error: "GPU_OUT_OF_MEMORY: cudaMalloc failed",
    });
    expect(d.status).toBe("abandoned");
    expect(d.nextRetryAt).toBeNull();
  });

  it("CONTEXT_BUDGET_EXCEEDED abandons immediately", () => {
    const d = decideFailure({
      retryCount: 0,
      maxRetries: 5,
      now: NOW,
      error: "CONTEXT_BUDGET_EXCEEDED requestTokens=6453",
    });
    expect(d.status).toBe("abandoned");
  });
});

describe("worklist truth for resource failures", () => {
  it("maps GPU failure pointer away from READY/EMPTY", () => {
    const s = refineDisplayStatusFromAiDraftPointer("READY", {
      clinicalStatus: "ERROR",
      failureCode: "GPU_OUT_OF_MEMORY",
    });
    expect(s).toBe("GPU_MEMORY");
  });

  it("maps context failure pointer to CONTEXT_LIMIT", () => {
    const s = refineDisplayStatusFromAiDraftPointer("ERROR", {
      failureCode: "CONTEXT_BUDGET_EXCEEDED",
    });
    expect(s).toBe("CONTEXT_LIMIT");
  });
});
