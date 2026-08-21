/**
 * Canonical overnight MRI vision-inference options.
 *
 * Resolves through resolveLocalAiRuntime() + overnight ops controls so overnight
 * jobs and the self-test Production Auto Policy share ONE resolution path.
 */
import { resolveLocalAiRuntime, type LocalAiRuntime } from "../aiPipeline/runtimeConfig";
import {
  buildProductionVisionPolicy,
  type ProductionVisionPolicy,
} from "./productionVisionPolicy";
import {
  DEFAULT_OVERNIGHT_OPS,
  parseOvernightOpsJson,
  type OvernightOpsControls,
} from "./overnightOpsControls";

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
  /** Full canonical policy (image cap, safe mode, pause, etc.). */
  policy: ProductionVisionPolicy;
  ops: OvernightOpsControls;
}

async function loadOvernightOps(): Promise<OvernightOpsControls> {
  try {
    const { getOvernightOpsControls } = await import("./clinicalConfigService");
    return await getOvernightOpsControls();
  } catch {
    return { ...DEFAULT_OVERNIGHT_OPS };
  }
}

export async function getOvernightVisionInferenceOptions(
  forceReload = false,
): Promise<OvernightVisionInferenceOptions> {
  const runtime = await resolveLocalAiRuntime(forceReload);
  const ops = await loadOvernightOps();
  const policy = buildProductionVisionPolicy({
    model: runtime.localChatVisionModel,
    endpointUrl: runtime.ollamaBaseUrl,
    configuredNumCtx: runtime.ollamaNumCtx,
    think: runtime.ollamaThink,
    temperature: runtime.temperatureDraft,
    ops,
  });
  return {
    model: policy.model,
    endpointUrl: policy.endpointUrl,
    numCtx: policy.numCtx,
    think: policy.think,
    temperature: policy.temperature,
    concurrency: policy.concurrency,
    runtime,
    policy,
    ops,
  };
}

export { parseOvernightOpsJson, buildProductionVisionPolicy };
