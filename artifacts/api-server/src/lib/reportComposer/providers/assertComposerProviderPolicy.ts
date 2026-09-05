/**
 * Pre-adapter policy gate for Report Composer providers.
 * Fail closed for cloud providers in this foundation PR.
 */
import type { ComposerProviderName } from "./types";

export type ComposerProviderPolicyInput = {
  provider: ComposerProviderName;
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  /** Future clinic setting — currently always treated as false. */
  cloudVisionAllowed?: boolean;
  imageCount: number;
};

export type ComposerProviderPolicyResult =
  | { ok: true }
  | { ok: false; safeError: string };

/**
 * Current behaviour:
 * - Ollama text: allowed
 * - Ollama selected images: allowed (caller still runs ownership/vision/SSRF checks)
 * - DeepSeek/OpenAI: composer_provider_not_configured
 */
export function assertComposerProviderPolicy(
  input: ComposerProviderPolicyInput,
): ComposerProviderPolicyResult {
  const { provider, aiMode, imageCount } = input;
  const cloudVisionAllowed = input.cloudVisionAllowed === true;

  if (provider === "ollama") {
    if (aiMode === "SELECTED_IMAGES" && imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    return { ok: true };
  }

  // deepseek | openai — not configured in this foundation PR
  void cloudVisionAllowed;
  void aiMode;
  void imageCount;
  return { ok: false, safeError: "composer_provider_not_configured" };
}
