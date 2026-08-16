/**
 * Canonical overnight MRI vision-inference options.
 *
 * Resolves through resolveLocalAiRuntime() so overnight jobs use the SAME
 * endpoint/model as Local AI Test Connection, OCR, and radiology Local AI.
 */
import { resolveLocalAiRuntime, type LocalAiRuntime } from "../aiPipeline/runtimeConfig";

export interface OvernightVisionInferenceOptions {
  /** Ollama model tag — always the canonical local chat/vision model. */
  model: string;
  /** Ollama base URL from the same runtime resolver. */
  endpointUrl: string;
  /** Ollama options.num_ctx */
  numCtx: number;
  /** Ollama native `think` flag (false = no chain-of-thought) */
  think: boolean;
  temperature: number;
  /** End-to-end AI shadow concurrency ceiling */
  concurrency: number;
  runtime: LocalAiRuntime;
}

export async function getOvernightVisionInferenceOptions(
  forceReload = false,
): Promise<OvernightVisionInferenceOptions> {
  const runtime = await resolveLocalAiRuntime(forceReload);
  return {
    model: runtime.localChatVisionModel,
    endpointUrl: runtime.ollamaBaseUrl,
    numCtx: runtime.ollamaNumCtx,
    think: runtime.ollamaThink,
    temperature: runtime.temperatureDraft,
    concurrency: runtime.aiConcurrency,
    runtime,
  };
}
