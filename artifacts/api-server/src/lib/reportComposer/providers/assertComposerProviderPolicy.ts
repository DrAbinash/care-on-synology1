/**
 * Pre-adapter policy gate for Report Composer providers.
 * Ollama remains default. DeepSeek allowed when API key is configured.
 * Cloud vision requires explicit cloudVisionAllowed (trial opt-in).
 */
import { isDeepSeekConfigured } from "./deepseekConfig";
import type { ComposerProviderName, ComposerProviderImage } from "./types";

export type ComposerProviderPolicyInput = {
  provider: ComposerProviderName;
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  /** Explicit clinic/trial opt-in for sending images to cloud. */
  cloudVisionAllowed?: boolean;
  images?: ComposerProviderImage[];
  imageCount?: number;
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

  if (provider === "deepseek") {
    if (!isDeepSeekConfigured()) {
      return { ok: false, safeError: "deepseek_api_key_not_configured" };
    }
    if (aiMode === "SELECTED_IMAGES" || imageCount > 0) {
      if (!cloudVisionAllowed) {
        return { ok: false, safeError: "deepseek_cloud_vision_not_allowed" };
      }
      if (imageCount <= 0) {
        return { ok: false, safeError: "selected_images_empty" };
      }
    }
    return { ok: true };
  }

  // openai — still fail closed in this trial PR
  void cloudVisionAllowed;
  void aiMode;
  void imageCount;
  return { ok: false, safeError: "composer_provider_not_configured" };
}
