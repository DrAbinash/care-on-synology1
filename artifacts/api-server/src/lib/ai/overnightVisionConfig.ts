/**
 * Canonical overnight MRI vision-inference options.
 *
 * Single source of truth for the Ollama payload used by the shadow/overnight
 * radiology draft worker. Env defaults live in aiPipeline/config.ts
 * (AI_MODEL_VISION, OLLAMA_NUM_CTX, OLLAMA_THINK, AI_TEMPERATURE_DRAFT,
 * AI_CONCURRENCY). Do not scatter hard-coded model names in callers.
 */
import { loadAiPipelineConfig } from "../aiPipeline/config";

export interface OvernightVisionInferenceOptions {
  /** Ollama model tag, e.g. qwen3-vl:8b */
  model: string;
  /** Ollama options.num_ctx */
  numCtx: number;
  /** Ollama native `think` flag (false = no chain-of-thought) */
  think: boolean;
  temperature: number;
  /** End-to-end AI shadow concurrency ceiling */
  concurrency: number;
}

export function getOvernightVisionInferenceOptions(): OvernightVisionInferenceOptions {
  const cfg = loadAiPipelineConfig();
  return {
    model: cfg.modelVision,
    numCtx: cfg.ollamaNumCtx,
    think: cfg.ollamaThink,
    temperature: cfg.temperatureDraft,
    concurrency: cfg.aiConcurrency,
  };
}
