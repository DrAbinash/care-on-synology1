/**
 * Permanent resource / provider failure semantics for radiology AI.
 * CUDA OOM must never collapse into EMPTY / READY / generic HTTP.
 */

export const RESOURCE_FAILURE_CODES = [
  "CONTEXT_BUDGET_EXCEEDED",
  "GPU_OUT_OF_MEMORY",
  "PROVIDER_TIMEOUT",
  "PROVIDER_HTTP_ERROR",
  "PARSE_FAILED",
  "OUTPUT_BUDGET_EXHAUSTED",
  "EMPTY_MODEL_OUTPUT",
  "QUARANTINED",
] as const;

export type ResourceFailureCode = (typeof RESOURCE_FAILURE_CODES)[number];

export interface GpuifiedResourceFailure {
  code: ResourceFailureCode | "OK" | "UNKNOWN";
  httpStatus: number | null;
  detail: string;
  /** True when the runner may be wedged / VRAM fragmented — larger probes should stop. */
  stopLargerProbes: boolean;
}

const CUDA_OOM_RE =
  /cudaMalloc|out of memory|CUDA error|failed to allocate CUDA|ggml_cuda|gpu.?oom|VRAM/i;

/**
 * HTTP 200 with empty `message.content` but eval_count at num_predict — common on
 * qwen3-vl when chain-of-thought consumed the output budget (even with think:false).
 */
export function detectOutputBudgetExhausted(opts: {
  responseLength?: number | null;
  thinkingLength?: number | null;
  evalCount?: number | null;
  numPredict?: number | null;
  finishReason?: string | null;
}): boolean {
  const responseLength = opts.responseLength ?? 0;
  if (responseLength > 0) return false;

  const finish = (opts.finishReason ?? "").trim().toLowerCase();
  if (finish === "length") return true;

  const evalCount = opts.evalCount;
  const numPredict = opts.numPredict;
  if (
    numPredict != null &&
    numPredict > 0 &&
    evalCount != null &&
    evalCount >= numPredict
  ) {
    return true;
  }

  const thinkingLength = opts.thinkingLength ?? 0;
  if (
    thinkingLength > 0 &&
    numPredict != null &&
    numPredict > 0 &&
    evalCount != null &&
    evalCount >= numPredict - 1
  ) {
    return true;
  }

  return false;
}

/** Parse Ollama / CUDA OOM from HTTP body or thrown message (PHI-safe slice). */
export function parseGpuOutOfMemory(errorMessage: string | null | undefined): {
  code: "GPU_OUT_OF_MEMORY";
  rawMessage: string;
} | null {
  const raw = (errorMessage ?? "").slice(0, 500);
  if (!raw || !CUDA_OOM_RE.test(raw)) return null;
  return { code: "GPU_OUT_OF_MEMORY", rawMessage: raw.slice(0, 400) };
}

/**
 * Classify a provider/probe outcome into stable failure codes.
 * Prefer specific codes over HTTP_* / EMPTY.
 */
export function classifyResourceFailure(opts: {
  success: boolean;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  responseLength?: number | null;
  parserSuccess?: boolean | null;
  quarantined?: boolean | null;
  thinkingLength?: number | null;
  evalCount?: number | null;
  numPredict?: number | null;
  finishReason?: string | null;
}): GpuifiedResourceFailure {
  const msg = opts.errorMessage ?? "";
  const codeHint = opts.errorCode ?? "";

  if (opts.quarantined) {
    return {
      code: "QUARANTINED",
      httpStatus: opts.httpStatus ?? null,
      detail: "findings quarantined by trust gauntlet",
      stopLargerProbes: false,
    };
  }

  if (
    codeHint === "CONTEXT_BUDGET_EXCEEDED" ||
    /CONTEXT_BUDGET_EXCEEDED|exceed_context_size_error|exceeds the available context size/i.test(
      `${codeHint} ${msg}`,
    )
  ) {
    return {
      code: "CONTEXT_BUDGET_EXCEEDED",
      httpStatus: opts.httpStatus ?? 400,
      detail: msg.slice(0, 300) || "request exceeds available context",
      stopLargerProbes: false,
    };
  }

  if (codeHint === "GPU_OUT_OF_MEMORY" || parseGpuOutOfMemory(msg) || parseGpuOutOfMemory(codeHint)) {
    return {
      code: "GPU_OUT_OF_MEMORY",
      httpStatus: opts.httpStatus ?? 500,
      detail: (parseGpuOutOfMemory(msg)?.rawMessage ?? msg).slice(0, 300) || "CUDA / GPU out of memory",
      stopLargerProbes: true,
    };
  }

  if (
    codeHint === "TIMEOUT_OR_ABORT" ||
    codeHint === "PROVIDER_TIMEOUT" ||
    /aborted|timed out|TimeoutError/i.test(msg)
  ) {
    return {
      code: "PROVIDER_TIMEOUT",
      httpStatus: opts.httpStatus ?? null,
      detail: msg.slice(0, 300) || "provider timeout",
      stopLargerProbes: false,
    };
  }

  if (
    codeHint === "OUTPUT_BUDGET_EXHAUSTED" ||
    (opts.success &&
      detectOutputBudgetExhausted({
        responseLength: opts.responseLength,
        thinkingLength: opts.thinkingLength,
        evalCount: opts.evalCount,
        numPredict: opts.numPredict,
        finishReason: opts.finishReason,
      }))
  ) {
    const evalCount = opts.evalCount ?? "—";
    const numPredict = opts.numPredict ?? "—";
    const thinkingLength = opts.thinkingLength ?? 0;
    return {
      code: "OUTPUT_BUDGET_EXHAUSTED",
      httpStatus: opts.httpStatus ?? 200,
      detail:
        `num_predict budget exhausted with empty content (eval=${evalCount} num_predict=${numPredict} thinkingLen=${thinkingLength})`,
      stopLargerProbes: false,
    };
  }

  if (opts.success && (opts.responseLength ?? 0) === 0) {
    return {
      code: "EMPTY_MODEL_OUTPUT",
      httpStatus: opts.httpStatus ?? 200,
      detail: "provider returned HTTP success with empty model text",
      stopLargerProbes: false,
    };
  }

  if (opts.success && opts.parserSuccess === false) {
    return {
      code: "PARSE_FAILED",
      httpStatus: opts.httpStatus ?? 200,
      detail: "model output could not be parsed into usable draft sections",
      stopLargerProbes: false,
    };
  }

  if (opts.success) {
    return {
      code: "OK",
      httpStatus: opts.httpStatus ?? 200,
      detail: "ok",
      stopLargerProbes: false,
    };
  }

  if (opts.httpStatus != null && opts.httpStatus >= 400) {
    return {
      code: "PROVIDER_HTTP_ERROR",
      httpStatus: opts.httpStatus,
      detail: msg.slice(0, 300) || `HTTP ${opts.httpStatus}`,
      stopLargerProbes: false,
    };
  }

  if (/HTTP_\d+/.test(codeHint)) {
    return {
      code: "PROVIDER_HTTP_ERROR",
      httpStatus: opts.httpStatus ?? null,
      detail: msg.slice(0, 300) || codeHint,
      stopLargerProbes: false,
    };
  }

  return {
    code: "UNKNOWN",
    httpStatus: opts.httpStatus ?? null,
    detail: msg.slice(0, 300) || codeHint || "unknown provider failure",
    stopLargerProbes: false,
  };
}
