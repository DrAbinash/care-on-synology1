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

/**
 * Ceiling on the answer the Composer asks a cloud model for. A professionalised
 * spine report runs to ~1,200 tokens and a combined cervical+lumbar report
 * beyond that; 4,096 leaves headroom without leaving the request unbounded,
 * which is what `max_tokens` was declared for and never sent.
 */
export const COMPOSER_MAX_OUTPUT_TOKENS = 4096;

/**
 * Conservative context ceiling assumed for a cloud composer request.
 *
 * CARE does not know a vendor's real window from here, and guessing high would
 * turn an over-long report into a provider error at the far end. Every model the
 * composer can currently be pointed at (gpt-4o, qwen3.7-plus, deepseek-v4) is
 * many times above this, so the number only ever refuses an absurdly large
 * request rather than a real one.
 */
export const CLOUD_COMPOSER_MAX_CONTEXT_TOKENS = 16_384;

/** Rough text-token cost of the prompt itself (same chars/4 convention as contextBudget). */
export function composerPromptTextTokens(systemPrompt: string, userPrompt: string): number {
  return Math.ceil(((systemPrompt ?? "").length + (userPrompt ?? "").length) / 4);
}

/**
 * How much room to leave for the answer. Half the input, at least one report,
 * at most `COMPOSER_MAX_OUTPUT_TOKENS`: a request that grows grows its own
 * output allowance, so a long report is not professionalised into a truncated
 * one.
 */
export function composerOutputReserveTokens(inputTokens: number): number {
  return Math.min(
    COMPOSER_MAX_OUTPUT_TOKENS,
    Math.max(COMPOSER_OUTPUT_RESERVE_TOKENS, Math.ceil(Math.max(0, inputTokens) / 2)),
  );
}

export type ComposerTextContextPlan = {
  fits: boolean;
  /** num_ctx to send for THIS local request (Ollama only). */
  numCtx: number;
  /** max_tokens to send (both transports; the cloud ceiling on the answer). */
  maxTokens: number;
  estimatedTokens: number;
  requiredTokens: number;
  ceilingTokens: number;
  reason: string;
};

/**
 * Text-only Composer context plan — the same rule the selected-image path has
 * used since #904, applied to the requests that carry NO images.
 *
 * Why this exists: the refinement/`PROFESSIONALIZE` prompt used to solve an
 * oversized report by cutting the report (first 1,200 characters of Findings,
 * first 12 observations). Cutting clinical text the radiologist wrote is the
 * failure this file's sibling docstring already calls "the one outcome a
 * radiology draft must never have". The prompt now carries the whole report and
 * this planner answers the question the cut was pretending to solve: does it
 * actually fit? When it does not, the request FAILS with the ceiling named in
 * the message instead of sending a truncated report and calling the answer
 * successful.
 */
export function planComposerTextContext(opts: {
  systemPrompt: string;
  userPrompt: string;
  transport: "ollama" | "cloud";
  /** Ollama only: the admin-configured composer window. */
  configuredNumCtx?: number;
}): ComposerTextContextPlan {
  const estimatedTokens = composerPromptTextTokens(opts.systemPrompt, opts.userPrompt);
  const maxTokens = composerOutputReserveTokens(estimatedTokens);
  const requiredTokens = estimatedTokens + maxTokens;

  if (opts.transport === "cloud") {
    const ceiling = CLOUD_COMPOSER_MAX_CONTEXT_TOKENS;
    const fits = requiredTokens <= ceiling;
    return {
      fits,
      numCtx: requiredTokens,
      maxTokens,
      estimatedTokens,
      requiredTokens,
      ceilingTokens: ceiling,
      reason: fits
        ? `~${estimatedTokens} input tokens + ${maxTokens} reserved for the answer → ${requiredTokens} of ${ceiling}`
        : `This request needs ~${requiredTokens} tokens and the Composer's cloud ceiling is ${ceiling}. `
          + "Nothing was sent. Split the report into a Findings edit and a separate Impression edit, "
          + "or shorten the narrative the AI is being asked to preserve.",
    };
  }

  const configured = Math.max(2048, Math.floor(opts.configuredNumCtx || 0));
  const ceiling = Math.max(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX, configured);
  const fits = requiredTokens <= ceiling;
  return {
    fits,
    numCtx: Math.min(ceiling, Math.max(configured, requiredTokens)),
    maxTokens,
    estimatedTokens,
    requiredTokens,
    ceilingTokens: ceiling,
    reason: fits
      ? `~${estimatedTokens} input tokens + ${maxTokens} reserved for the answer → num_ctx ${Math.min(ceiling, Math.max(configured, requiredTokens))} (configured ${configured}, ceiling ${ceiling})`
      : `This report needs ~${requiredTokens} tokens but the local Composer context ceiling is ${ceiling}, `
        + "so nothing was sent — a truncated request would silently drop part of your report. "
        + "Ask for one section at a time (Findings, then Impression), or route this study to a cloud "
        + "model in AI Reporting Settings, which is not limited by the local window.",
  };
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
    : `${imageCount} image(s) need ~${requiredTokens} tokens but the composer ceiling is ${ceiling}. Select fewer key images (${fitAtCeiling.maxImages} fit this report), or shorten the report text. Raising ollama_composer_num_ctx cannot help — resolveComposerRuntime clamps it to ${ceiling}.`;

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
