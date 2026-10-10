/**
 * Pre-adapter policy gate for Report Composer domain facade.
 * Ollama + Local OpenAI-Compatible are LOCAL (no cloud vision gate) — BUT only
 * when their resolved URL actually points to a private/LAN address. A
 * "local_openai_compatible" provider pointed at a public URL is reclassified
 * as cloud and subject to all cloud vision / PHI controls.
 * Cloud providers require API keys (DB first, then env — resolved by the caller
 * through `resolveCloudComposerConfig`, because this gate stays synchronous).
 * Cloud vision requires explicit cloudVisionAllowed for ALL cloud vendors.
 */
import {
  isCompatibleProviderConfigured,
  classifyEffectiveLocality,
} from "@workspace/ai-providers";
import {
  isCloudComposerProvider,
  isLocalComposerProvider,
  type ComposerProviderName,
  type ComposerProviderImage,
} from "./types";

export type ComposerProviderPolicyInput = {
  provider: ComposerProviderName;
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  cloudVisionAllowed?: boolean;
  images?: ComposerProviderImage[];
  imageCount?: number;
  /** When set, Local OpenAI-Compatible is considered configured (endpoint present). */
  localEndpointConfigured?: boolean;
  /**
   * When set, cloud key presence is taken from this — the caller resolved it
   * from `ai_provider_settings` and then env. Omitted callers keep the previous
   * env-only answer, so nothing here silently loosens the gate.
   */
  cloudApiKeyConfigured?: boolean;
  /**
   * Resolved base URL for local providers. When provided, locality is derived
   * from the actual network destination, not the provider name. A "local"
   * provider with a public URL is reclassified as cloud for PHI egress.
   */
  resolvedUrl?: string | null;
};

export type ComposerProviderPolicyResult =
  | { ok: true }
  | { ok: false; safeError: string };

export function assertComposerProviderPolicy(
  input: ComposerProviderPolicyInput,
): ComposerProviderPolicyResult {
  const { provider, aiMode } = input;
  const cloudVisionAllowed = input.cloudVisionAllowed === true;
  const imageCount =
    input.images !== undefined ? input.images.length : Number(input.imageCount ?? 0);

  if (provider === "ollama") {
    if (aiMode === "SELECTED_IMAGES" && imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    return { ok: true };
  }

  if (isLocalComposerProvider(provider)) {
    // Optional API key is intentionally allowed. Endpoint must be configured
    // (checked via localEndpointConfigured or env at call sites).
    if (input.localEndpointConfigured === false) {
      return { ok: false, safeError: "local_openai_compatible_endpoint_not_configured" };
    }

    // Endpoint-derived locality: a "local_openai_compatible" provider whose
    // resolved URL points to a public internet address is reclassified as
    // cloud for PHI egress purposes. The URL is the ground truth, not the name.
    if (input.resolvedUrl != null && input.resolvedUrl !== "") {
      const effective = classifyEffectiveLocality(provider, input.resolvedUrl);
      if (effective.locality === "cloud") {
        // Reclassified as cloud — apply the same vision gate as any other
        // cloud provider. The key check is skipped because local_openai_compatible
        // has no cloud API key; the privacy gate is the point, not credentials.
        if (aiMode === "SELECTED_IMAGES" || imageCount > 0) {
          if (!cloudVisionAllowed) {
            return { ok: false, safeError: "cloud_vision_not_allowed" };
          }
          if (imageCount <= 0) {
            return { ok: false, safeError: "selected_images_empty" };
          }
        }
        return { ok: true };
      }
    }

    if (aiMode === "SELECTED_IMAGES" && imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    // Genuinely local (private/LAN URL or no URL resolved) — no cloud gate.
    return { ok: true };
  }

  // Anything else — including gemini and anthropic, which have provider
  // adapters but no composer adapter — is refused rather than assumed local.
  if (!isCloudComposerProvider(provider)) {
    return { ok: false, safeError: "composer_provider_not_configured" };
  }

  const keyConfigured =
    input.cloudApiKeyConfigured ?? isCompatibleProviderConfigured(provider);
  if (!keyConfigured) {
    return { ok: false, safeError: `${provider}_api_key_not_configured` };
  }

  if (aiMode === "SELECTED_IMAGES" || imageCount > 0) {
    if (!cloudVisionAllowed) {
      return { ok: false, safeError: "cloud_vision_not_allowed" };
    }
    if (imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
  }

  return { ok: true };
}
