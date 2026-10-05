/**
 * Selected-image Composer context budget — a thin projection of the EXISTING
 * `lib/ai/contextBudget` estimator onto the Report Composer's vision request.
 *
 * Why this exists: the composer sent `options.num_ctx` straight from
 * `clinic_settings.ollama_composer_num_ctx` (default 4096) while CARE's own
 * measured cost is ~1076 tokens per key image. Four images therefore cost more
 * context than the default window holds, and the request either fails or is
 * silently truncated by Ollama. The overnight pipeline and the interactive
 * `/api/ai-reporting/draft` path already size their context with these helpers;
 * the composer was the one vision caller that did not.
 *
 * No new estimator lives here. `EMPIRICAL_TOKENS_PER_VISION_IMAGE`,
 * `estimateVisionPromptTokens`, `maxImagesForContextBudget` and
 * `PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX` are the same values the rest of CARE
 * already trusts.
 *
 * Safety rules this upholds:
 *  - num_ctx is chosen PER REQUEST only. Ollama's server config and every other
 *    task's context stay untouched.
 *  - The chosen value never exceeds the ceiling the composer clamp already
 *    enforces (`PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX` = 8192, which is also the
 *    upper bound of `resolveComposerRuntime`'s clamp), so this cannot silently
 *    inflate context beyond what an admin could already configure.
 *  - It never lowers an admin's configured value.
 *  - When the request cannot fit even at the ceiling it FAILS CLEARLY instead of
 *    sending a request Ollama would truncate — truncating clinical input is the
 *    one outcome a radiology draft must never have.
 *  - TEXT_ONLY composition is not routed through this at all.
 */
import {
  EMPIRICAL_TOKENS_PER_VISION_IMAGE,
  PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX,
  estimateVisionPromptTokens,
  maxImagesForContextBudget,
} from "../ai/contextBudget";
import { COMPOSER_MAX_SELECTED_KEY_IMAGES } from "./types";

/** JSON draft of a full report needs room to answer, not just to read. */
export const COMPOSER_OUTPUT_RESERVE_TOKENS = 1024;

/** Rough text-token cost of the prompt itself (same chars/4 convention as contextBudget). */
export function composerPromptTextTokens(systemPrompt: string, userPrompt: string): number {
  return Math.ceil(((systemPrompt ?? "").length + (userPrompt ?? "").length) / 4);
}

export type ComposerVisionContextPlan = {
  fits: boolean;
  /** num_ctx to send for THIS request. Equals configured when configured already fits. */
  numCtx: number;
  /** Images + prompt + output reserve. */
  requiredTokens: number;
  /** Images + prompt, without the output reserve. */
  estimatedTokens: number;
  configuredNumCtx: number;
  ceilingNumCtx: number;
  /** How many images would fit at the ceiling for this same prompt. */
  maxImagesAtCeiling: number;
  /** Radiologist-readable, surfaced through provenance.degradedReason. */
  reason: string;
};

export function planComposerVisionContext(opts: {
  imageCount: number;
  systemPrompt: string;
  userPrompt: string;
  configuredNumCtx: number;
  maxImages?: number;
}): ComposerVisionContextPlan {
  const imageCount = Math.max(0, Math.floor(opts.imageCount));
  const configured = Math.max(2048, Math.floor(opts.configuredNumCtx || 0));
  // Never lower what the clinic configured; never exceed the ceiling the
  // composer clamp already allows.
  const ceiling = Math.max(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX, configured);
  const hardCap = opts.maxImages ?? COMPOSER_MAX_SELECTED_KEY_IMAGES;

  const estimatedTokens = estimateVisionPromptTokens({
    imageCount,
    promptLength: (opts.systemPrompt ?? "").length + (opts.userPrompt ?? "").length,
  });
  const requiredTokens = estimatedTokens + COMPOSER_OUTPUT_RESERVE_TOKENS;
  const numCtx = Math.min(ceiling, Math.max(configured, requiredTokens));
  const fits = requiredTokens <= ceiling;

  const fitAtCeiling = maxImagesForContextBudget({
    numCtx: ceiling,
    promptReserveTokens: composerPromptTextTokens(opts.systemPrompt, opts.userPrompt),
    outputReserveTokens: COMPOSER_OUTPUT_RESERVE_TOKENS,
    hardCap,
  });

  const reason = fits
    ? `${imageCount} image(s) ≈ ${estimatedTokens} tokens (${EMPIRICAL_TOKENS_PER_VISION_IMAGE}/image) + ${COMPOSER_OUTPUT_RESERVE_TOKENS} output reserve → num_ctx ${numCtx} (configured ${configured}, ceiling ${ceiling})`
    : `${imageCount} image(s) need ~${requiredTokens} tokens but the composer ceiling is ${ceiling}. Select fewer key images (${fitAtCeiling.maxImages} fit this report), or shorten the report text, or raise ollama_composer_num_ctx above ${ceiling} in clinic settings.`;

  return {
    fits,
    numCtx,
    requiredTokens,
    estimatedTokens,
    configuredNumCtx: configured,
    ceilingNumCtx: ceiling,
    maxImagesAtCeiling: fitAtCeiling.maxImages,
    reason,
  };
}
