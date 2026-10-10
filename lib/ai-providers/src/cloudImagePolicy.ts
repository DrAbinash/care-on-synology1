/**
 * Central cloud image egress policy for @workspace/ai-providers.
 * DEFAULT = DENY for all non-local providers. Explicit trial opt-in required.
 * Local OpenAI-compatible servers are LOCAL — never gated as cloud — BUT only
 * when their resolved URL actually points to a private/LAN address. A
 * "local_openai_compatible" provider pointed at a public URL is reclassified
 * as cloud and subject to all image egress controls.
 */
import { isLocalExecutionProvider } from "./openAiCompatible";
import { classifyEffectiveLocality } from "./providerLocality";

export type CloudImageEgressInput = {
  provider: string;
  imageCount: number;
  /** Explicit clinic/trial flag — must be true for ANY cloud image egress. */
  cloudVisionAllowed?: boolean;
  /** Model must be vision-capable when images present. */
  modelSupportsVision?: boolean;
  /**
   * Resolved base URL for the provider. When provided, locality is derived from
   * the actual network destination, not the provider name. A "local" provider
   * with a public URL is reclassified as cloud.
   */
  resolvedUrl?: string | null;
};

export type CloudImageEgressResult =
  | { ok: true }
  | { ok: false; errorCode: string; error: string };

export function assertCloudImageEgress(input: CloudImageEgressInput): CloudImageEgressResult {
  if (input.imageCount <= 0) return { ok: true };

  // Endpoint-derived locality: when a resolved URL is available, classify based
  // on the actual destination. Otherwise fall back to name-based classification.
  const isLocal = input.resolvedUrl != null
    ? classifyEffectiveLocality(input.provider, input.resolvedUrl).locality === "local"
    : isLocalExecutionProvider(input.provider);

  if (isLocal) return { ok: true };

  if (input.cloudVisionAllowed !== true) {
    return {
      ok: false,
      errorCode: "PHI_IMAGE_CLOUD_BLOCKED",
      error: "Clinical images cannot be sent to cloud AI providers without explicit cloudVisionAllowed.",
    };
  }
  if (input.modelSupportsVision === false) {
    return {
      ok: false,
      errorCode: "MODEL_NOT_VISION_CAPABLE",
      error: "Selected cloud model does not support vision.",
    };
  }
  return { ok: true };
}
