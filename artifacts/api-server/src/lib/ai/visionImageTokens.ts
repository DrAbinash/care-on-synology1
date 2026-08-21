/**
 * Vision-token cost helpers for qwen3-vl / Ollama MRI JPEGs.
 *
 * JPEG byte size is NOT the budget driver — Ollama/qwen tokenize by spatial
 * resolution (patch grid). Draft path already resizes to max width 512, but
 * 6×512px images still ≈ 6k prompt tokens in live proof.
 *
 * Do NOT permanently downsample further until controlled A/B on clinical utility.
 */

import { EMPIRICAL_TOKENS_PER_VISION_IMAGE } from "./contextBudget";

/** Approximate Qwen2/3-VL patch size used for token estimates (public docs ~14px). */
export const QWEN_VL_PATCH_SIZE = 14;

export interface ImageDimensionMeta {
  width: number | null;
  height: number | null;
  byteSize: number;
  /** Rough spatial tokens ≈ ceil(w/p)*ceil(h/p); null if dims unknown. */
  estimatedSpatialTokens: number | null;
}

/**
 * Estimate vision spatial tokens from pixel dimensions.
 * Real Ollama counts include special tokens + text; this is a lower bound for planning.
 */
export function estimateSpatialVisionTokens(
  width: number,
  height: number,
  patchSize = QWEN_VL_PATCH_SIZE,
): number {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const p = Math.max(1, Math.floor(patchSize));
  return Math.ceil(w / p) * Math.ceil(h / p);
}

/**
 * Compare empirical (live Ollama prompt_eval) vs spatial estimate.
 * Live 6-image MRI ≈ 6453 tokens → ~1076/image including amortized prompt.
 */
export function summarizeVisionTokenBudget(opts: {
  imageCount: number;
  dimensions: Array<{ width: number | null; height: number | null; byteSize: number }>;
  observedPromptEvalCount?: number | null;
}): {
  imageCount: number;
  totalJpegBytes: number;
  empiricalEstimateTokens: number;
  spatialEstimateTokens: number | null;
  observedPromptEvalCount: number | null;
  note: string;
} {
  const totalJpegBytes = opts.dimensions.reduce((s, d) => s + (d.byteSize || 0), 0);
  const spatialParts = opts.dimensions.map((d) =>
    d.width != null && d.height != null
      ? estimateSpatialVisionTokens(d.width, d.height)
      : null,
  );
  const spatialOk = spatialParts.every((x) => x != null);
  const spatialEstimateTokens = spatialOk
    ? (spatialParts as number[]).reduce((a, b) => a + b, 0)
    : null;
  const empiricalEstimateTokens =
    Math.max(1, opts.imageCount) * EMPIRICAL_TOKENS_PER_VISION_IMAGE;

  return {
    imageCount: opts.imageCount,
    totalJpegBytes,
    empiricalEstimateTokens,
    spatialEstimateTokens,
    observedPromptEvalCount: opts.observedPromptEvalCount ?? null,
    note:
      "JPEG bytes ≠ vision tokens. Prefer spatial/patch estimates + live prompt_eval_count. " +
      "Further downscale (e.g. 384/256) is experimental — do not ship without clinical A/B.",
  };
}

/**
 * Smallest power-of-two-ish num_ctx that fits estimated request tokens with headroom.
 * Used for diagnostic scaling benches only — NOT a production default setter.
 */
export function suggestDiagnosticNumCtx(estimatedRequestTokens: number): number {
  const need = Math.max(2048, Math.ceil(estimatedRequestTokens * 1.15) + 512);
  const candidates = [4096, 6144, 8192, 12288, 16384, 24576, 32768];
  for (const c of candidates) {
    if (c >= need) return c;
  }
  return candidates[candidates.length - 1]!;
}
