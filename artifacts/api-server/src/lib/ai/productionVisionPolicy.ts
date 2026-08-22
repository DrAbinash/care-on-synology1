/**
 * Canonical overnight / Production Auto Policy for qwen3-vl vision drafts.
 *
 * Self-test "PRODUCTION AUTO POLICY" and shadowPipeline MUST call the same
 * resolve + budget + error classification path. No second resolver.
 */
import { estimateVisionPromptTokens, maxImagesForContextBudget } from "./contextBudget";
import {
  classifyResourceFailure,
  parseGpuOutOfMemory,
  type ResourceFailureCode,
} from "./providerResourceErrors";
import {
  DEFAULT_OVERNIGHT_OPS,
  parseOvernightOpsJson,
  resolveOvernightImageCap,
  resolveOvernightNumCtx,
  type OvernightOpsControls,
} from "./overnightOpsControls";
import { parseOllamaContextExceeded } from "./contextBudget";

export interface ProductionVisionPolicy {
  model: string;
  endpointUrl: string;
  /** Effective num_ctx for overnight / Production Auto Policy. */
  numCtx: number;
  numCtxSource: string;
  think: boolean;
  temperature: number;
  concurrency: 1;
  maxImages: number;
  imageCapReason: string;
  safeMode: boolean;
  overnightPaused: boolean;
  pauseReason: string | null;
  maxTokens: number;
  timeoutMs: number;
  /** Infra/diagnostic: short output; clinical overnight still uses structured draft. */
  ops: OvernightOpsControls;
  configuredNumCtx: number;
  reason: string;
}

export interface PreflightImageBudgetResult {
  requestedImages: number;
  selectedImages: number;
  numCtx: number;
  estimatedTokens: number;
  reduced: boolean;
  reasonForReduction: string | null;
  fits: boolean;
}

/**
 * Pure preflight: shrink N until estimated tokens fit num_ctx with reserves.
 * Prefer reducing images over sending a request that will HTTP 400.
 */
export function preflightReduceImagesForContext(opts: {
  requestedImages: number;
  numCtx: number;
  promptLength?: number;
  outputReserveTokens?: number;
  minImages?: number;
}): PreflightImageBudgetResult {
  const minImages = Math.max(1, opts.minImages ?? 1);
  const requested = Math.max(0, Math.floor(opts.requestedImages));
  const outputReserve = opts.outputReserveTokens ?? 1024;
  const usable = Math.max(512, opts.numCtx - outputReserve);

  let n = requested;
  let estimated = estimateVisionPromptTokens({
    imageCount: Math.max(1, n),
    promptLength: opts.promptLength,
  });
  let reduced = false;
  let reason: string | null = null;

  while (n > minImages && estimated > usable) {
    n -= 1;
    reduced = true;
    estimated = estimateVisionPromptTokens({
      imageCount: n,
      promptLength: opts.promptLength,
    });
  }

  if (n >= 1 && estimated > usable) {
    // Even 1 image may not fit (extreme) — still select 1 and mark unfit.
    reason = `even ${n} image(s) estTokens=${estimated} exceed usable context ${usable} (num_ctx=${opts.numCtx} − reserve ${outputReserve})`;
    return {
      requestedImages: requested,
      selectedImages: n,
      numCtx: opts.numCtx,
      estimatedTokens: estimated,
      reduced,
      reasonForReduction: reason,
      fits: false,
    };
  }

  if (reduced) {
    reason = `reduced ${requested} → ${n} so estTokens=${estimated} ≤ usable ${usable} (num_ctx=${opts.numCtx})`;
  }

  return {
    requestedImages: requested,
    selectedImages: Math.max(minImages, n),
    numCtx: opts.numCtx,
    estimatedTokens: estimated,
    reduced,
    reasonForReduction: reason,
    fits: estimated <= usable,
  };
}

/** Build policy from runtime + ops controls (pure aside from inputs). */
export function buildProductionVisionPolicy(opts: {
  model: string;
  endpointUrl: string;
  configuredNumCtx: number;
  think: boolean;
  temperature: number;
  ops?: OvernightOpsControls | null;
}): ProductionVisionPolicy {
  const ops = opts.ops ?? DEFAULT_OVERNIGHT_OPS;
  const { numCtx, source: numCtxSource } = resolveOvernightNumCtx({
    configuredNumCtx: opts.configuredNumCtx,
    visionCtx: ops.visionCtx,
  });
  const budget = maxImagesForContextBudget({ numCtx, hardCap: 20 });
  const cap = resolveOvernightImageCap({
    imageCap: ops.imageCap,
    safeMode: ops.safeMode,
    contextBudgetMaxImages: budget.maxImages,
  });

  return {
    model: opts.model,
    endpointUrl: opts.endpointUrl,
    numCtx,
    numCtxSource,
    think: ops.safeMode ? false : opts.think,
    temperature: opts.temperature,
    concurrency: 1,
    maxImages: cap.maxImages,
    imageCapReason: cap.reason,
    safeMode: ops.safeMode,
    overnightPaused: ops.paused,
    pauseReason: ops.pauseReason,
    maxTokens: ops.safeMode ? 1024 : 4096,
    timeoutMs: 10 * 60_000,
    ops,
    configuredNumCtx: opts.configuredNumCtx,
    reason: [
      ops.safeMode ? "Safe Mode ON" : "Safe Mode OFF",
      `num_ctx=${numCtx} (${numCtxSource})`,
      cap.reason,
      ops.paused ? `PAUSED: ${ops.pauseReason ?? "operator"}` : "not paused",
    ].join("; "),
  };
}

export function classifyOvernightProviderFailure(opts: {
  success: boolean;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  responseLength?: number | null;
}): {
  code: ResourceFailureCode | "OK" | "UNKNOWN";
  stopRetries: boolean;
  allowOneRecovery: boolean;
  detail: string;
} {
  const gpu = parseGpuOutOfMemory(opts.errorMessage) || parseGpuOutOfMemory(opts.errorCode);
  const ctx = parseOllamaContextExceeded(opts.errorMessage ?? "");
  const classified = classifyResourceFailure({
    success: opts.success,
    httpStatus: opts.httpStatus,
    errorCode:
      opts.errorCode ??
      (gpu ? "GPU_OUT_OF_MEMORY" : ctx ? "CONTEXT_BUDGET_EXCEEDED" : null),
    errorMessage: opts.errorMessage,
    responseLength: opts.responseLength,
  });

  if (classified.code === "GPU_OUT_OF_MEMORY") {
    return {
      code: "GPU_OUT_OF_MEMORY",
      stopRetries: true,
      allowOneRecovery: true,
      detail: classified.detail,
    };
  }
  if (classified.code === "CONTEXT_BUDGET_EXCEEDED") {
    return {
      code: "CONTEXT_BUDGET_EXCEEDED",
      stopRetries: true,
      allowOneRecovery: true,
      detail: classified.detail,
    };
  }
  return {
    code: classified.code,
    stopRetries: false,
    allowOneRecovery: false,
    detail: classified.detail,
  };
}

export { parseOvernightOpsJson, DEFAULT_OVERNIGHT_OPS };
