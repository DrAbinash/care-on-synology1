/**
 * Pre-adapter policy gate for Report Composer domain facade.
 * Ollama + Local OpenAI-Compatible are LOCAL (no cloud vision gate).
 * Cloud providers require API keys (DB first, then env — resolved by the caller
 * through `resolveCloudComposerConfig`, because this gate stays synchronous).
 * Cloud vision requires explicit cloudVisionAllowed for ALL cloud vendors.
 */
import { isCompatibleProviderConfigured } from "@workspace/ai-providers";
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
    if (aiMode === "SELECTED_IMAGES" && imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    // Never apply cloud_vision_not_allowed — this provider is LOCAL.
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
