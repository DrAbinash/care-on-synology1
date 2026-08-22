/**
 * Ollama context-budget helpers — pure, PHI-safe.
 *
 * Live caredeoghar proof (2026-04): 6 draft-shaped MRI JPEGs → ~6453 prompt
 * tokens rejected against available context 4096 when options.num_ctx was omitted.
 */
export const OLLAMA_DEFAULT_CTX_WHEN_UNSET = 4096;
/** Lowest context that fits the measured ~6453-token 6-image MRI payload with headroom. */
export const PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX = 8192;
/** Empirical tokens/image from live 6-image / 6453-token rejection (includes amortized prompt). */
export const EMPIRICAL_TOKENS_PER_VISION_IMAGE = Math.ceil(6453 / 6); // 1076

export interface ContextExceededInfo {
  code: "CONTEXT_BUDGET_EXCEEDED";
  requestTokens: number | null;
  availableContext: number | null;
  rawMessage: string;
}

/** Parse Ollama exceed_context_size_error (nested JSON or plain text). */
export function parseOllamaContextExceeded(errorMessage: string | null | undefined): ContextExceededInfo | null {
  const raw = errorMessage ?? "";
  if (!raw) return null;
  const looks =
    /exceed_context_size_error|exceeds the available context size|n_prompt_tokens/i.test(raw);
  if (!looks) return null;

  let requestTokens: number | null = null;
  let availableContext: number | null = null;

  const reqMatch = raw.match(/request\s*\((\d+)\s*tokens?\)/i);
  if (reqMatch) requestTokens = Number(reqMatch[1]);
  const availMatch = raw.match(/available context size\s*\((\d+)\s*tokens?\)/i);
  if (availMatch) availableContext = Number(availMatch[1]);
  const promptTok = raw.match(/"n_prompt_tokens"\s*:\s*(\d+)/i);
  if (promptTok && requestTokens == null) requestTokens = Number(promptTok[1]);

  return {
    code: "CONTEXT_BUDGET_EXCEEDED",
    requestTokens,
    availableContext,
    rawMessage: raw.slice(0, 400),
  };
}

export function estimateVisionPromptTokens(opts: {
  imageCount: number;
  promptLength?: number;
  tokensPerImage?: number;
}): number {
  const per = opts.tokensPerImage ?? EMPIRICAL_TOKENS_PER_VISION_IMAGE;
  const textTok = Math.ceil((opts.promptLength ?? 0) / 4);
  // Empirically per-image already amortizes some prompt; add text only when large.
  return Math.max(1, opts.imageCount) * per + Math.max(0, textTok - 200);
}

export function contextHeadroom(opts: {
  availableContext: number;
  estimatedOrRequestTokens: number;
}): number {
  return opts.availableContext - opts.estimatedOrRequestTokens;
}

/**
 * Interactive /api/ai-reporting/draft num_ctx resolution.
 * Does NOT silently omit num_ctx (that forced Ollama's ~4096 default).
 * Prefers 8192 for multi-image MRI over blindly using 16384.
 */
export function resolveInteractiveDraftNumCtx(opts: {
  configuredNumCtx: number;
  imageCount: number;
  draftNumCtxOverride?: number | null;
}): { requestedNumCtx: number; configuredNumCtx: number; reason: string } {
  const configured = Math.max(2048, Math.floor(opts.configuredNumCtx || OLLAMA_DEFAULT_CTX_WHEN_UNSET));
  if (opts.draftNumCtxOverride != null && Number.isFinite(opts.draftNumCtxOverride)) {
    const v = Math.max(2048, Math.floor(opts.draftNumCtxOverride));
    return {
      requestedNumCtx: v,
      configuredNumCtx: configured,
      reason: "OLLAMA_DRAFT_NUM_CTX override",
    };
  }
  if (opts.imageCount <= 1) {
    const requested = Math.min(configured, PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    return {
      requestedNumCtx: requested,
      configuredNumCtx: configured,
      reason: "single-image; explicit num_ctx (avoid silent Ollama ~4096 default)",
    };
  }
  // Multi-image MRI ~6453 tokens observed: prefer 8192 over configured 16384.
  // Still request at least 8192 even if configured is lower (otherwise repeats live failure).
  const requested = Math.max(
    PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX,
    Math.min(configured, PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX),
  );
  return {
    requestedNumCtx: requested,
    configuredNumCtx: configured,
    reason:
      configured > PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX
        ? `multi-image prefers ${PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX} over configured ${configured} (lowest that fits measured ~6453 tokens); set OLLAMA_DRAFT_NUM_CTX to raise`
        : `multi-image requests ${requested} (configured=${configured})`,
  };
}

/** Cap overnight image count so estimated tokens fit num_ctx with reserves. */
export function maxImagesForContextBudget(opts: {
  numCtx: number;
  tokensPerImage?: number;
  promptReserveTokens?: number;
  outputReserveTokens?: number;
  hardCap?: number;
}): { maxImages: number; estimatedTokenBudget: number; reason: string } {
  const numCtx = Math.max(2048, opts.numCtx);
  const per = opts.tokensPerImage ?? EMPIRICAL_TOKENS_PER_VISION_IMAGE;
  const promptReserve = opts.promptReserveTokens ?? 800;
  const outputReserve = opts.outputReserveTokens ?? 1024;
  const hardCap = opts.hardCap ?? 20;
  const budget = Math.max(per, numCtx - promptReserve - outputReserve);
  const maxImages = Math.max(1, Math.min(hardCap, Math.floor(budget / per)));
  return {
    maxImages,
    estimatedTokenBudget: budget,
    reason: `num_ctx=${numCtx} − promptReserve=${promptReserve} − outputReserve=${outputReserve} → ~${budget} image tokens ÷ ${per}/img → max ${maxImages} (cap ${hardCap})`,
  };
}

export function classifyContextBudgetCheck(opts: {
  configuredNumCtx: number | null;
  requestedNumCtx: number | null;
  availableContext: number | null;
  requestTokens: number | null;
  estimatedTokens?: number | null;
}): {
  ok: boolean;
  code: "OK" | "CONTEXT_BUDGET_EXCEEDED" | "NUM_CTX_NOT_SENT" | "UNKNOWN";
  headroom: number | null;
  detail: string;
} {
  const tokens = opts.requestTokens ?? opts.estimatedTokens ?? null;
  const available =
    opts.availableContext ?? opts.requestedNumCtx ?? opts.configuredNumCtx ?? null;

  if (opts.requestedNumCtx == null && (opts.requestTokens ?? 0) > OLLAMA_DEFAULT_CTX_WHEN_UNSET) {
    return {
      ok: false,
      code: "NUM_CTX_NOT_SENT",
      headroom: null,
      detail: `options.num_ctx was not sent; Ollama likely used ~${OLLAMA_DEFAULT_CTX_WHEN_UNSET} while request needed ${opts.requestTokens} tokens`,
    };
  }

  if (tokens != null && available != null) {
    const headroom = available - tokens;
    if (headroom < 0) {
      return {
        ok: false,
        code: "CONTEXT_BUDGET_EXCEEDED",
        headroom,
        detail: `requestTokens=${tokens} availableContext=${available} headroom=${headroom}`,
      };
    }
    return {
      ok: true,
      code: "OK",
      headroom,
      detail: `configured=${opts.configuredNumCtx} requested=${opts.requestedNumCtx} tokens=${tokens} headroom=${headroom}`,
    };
  }

  return {
    ok: true,
    code: "UNKNOWN",
    headroom: null,
    detail: "insufficient token metadata",
  };
}
