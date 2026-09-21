/**
 * Pre-adapter policy gate for Report Composer domain facade.
 * Ollama + Local OpenAI-Compatible are LOCAL (no cloud vision gate).
 * Cloud providers require API keys (env or DB).
 * Cloud vision requires explicit cloudVisionAllowed for ALL cloud vendors.
 */
import {
  isCompatibleProviderConfigured,
  isLocalOpenAiCompatibleProvider,
} from "@workspace/ai-providers";
import type { ComposerProviderName, ComposerProviderImage } from "./types";

export type ComposerProviderPolicyInput = {
  provider: ComposerProviderName;
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  cloudVisionAllowed?: boolean;
  images?: ComposerProviderImage[];
  imageCount?: number;
  /** When set, Local OpenAI-Compatible is considered configured (endpoint present). */
  localEndpointConfigured?: boolean;
};

export type ComposerProviderPolicyResult =
  | { ok: true }
  | { ok: false; safeError: string };

function isCloud(provider: ComposerProviderName): boolean {
  return provider === "qwen" || provider === "deepseek" || provider === "openai";
}

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

  if (isLocalOpenAiCompatibleProvider(provider)) {
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

  if (!isCloud(provider)) {
    return { ok: false, safeError: "composer_provider_not_configured" };
  }

  if (!isCompatibleProviderConfigured(provider)) {
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
