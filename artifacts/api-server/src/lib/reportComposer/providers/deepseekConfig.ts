/**
 * DeepSeek official API config — thin env helpers over @workspace/ai-providers.
 */
import {
  readEnvApiKey,
  readEnvBaseUrl,
  isCompatibleProviderConfigured,
  COMPATIBLE_PROVIDER_DEFAULTS,
} from "@workspace/ai-providers";

export const DEEPSEEK_OFFICIAL_BASE_URL =
  COMPATIBLE_PROVIDER_DEFAULTS.deepseek?.baseURL ?? "https://api.deepseek.com";

export const DEEPSEEK_TEXT_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";

export function getDeepSeekApiKey(): string | null {
  return readEnvApiKey("deepseek");
}

export function isDeepSeekConfigured(): boolean {
  return isCompatibleProviderConfigured("deepseek");
}

export function getDeepSeekBaseUrl(): string {
  return readEnvBaseUrl("deepseek") || DEEPSEEK_OFFICIAL_BASE_URL;
}

export function scrubDeepSeekSecrets(text: string): string {
  const key = getDeepSeekApiKey();
  if (!key) return text;
  return text.split(key).join("[REDACTED_DEEPSEEK_KEY]");
}

export function deepseekConfiguredPublicStatus(): { configured: boolean; baseUrl: string } {
  return { configured: isDeepSeekConfigured(), baseUrl: getDeepSeekBaseUrl() };
}
