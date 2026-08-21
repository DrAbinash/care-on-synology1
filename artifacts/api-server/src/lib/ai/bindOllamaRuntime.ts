/**
 * Bind @workspace/ai-providers Ollama generate paths to the existing
 * resolveLocalAiRuntime() — one canonical clinic/runtime endpoint source.
 * Not a second resolver.
 */
import { bindOllamaRuntimeEndpointResolver } from "@workspace/ai-providers";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";

let bound = false;

export function bindCanonicalOllamaRuntimeResolver(): void {
  if (bound) return;
  bindOllamaRuntimeEndpointResolver(async () => {
    const runtime = await resolveLocalAiRuntime();
    return {
      endpointUrl: runtime.ollamaBaseUrl,
      model: runtime.localChatVisionModel,
    };
  });
  bound = true;
}
