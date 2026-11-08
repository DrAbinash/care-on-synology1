/**
 * Z.ai GLM open platform — international OpenAI-compatible.
 * Endpoint verified: https://api.z.ai/api/paas/v4
 * Models verified: glm-5.3-flash (default), glm-5.3 (flagship)
 */
import {
  readEnvApiKey,
  readEnvBaseUrl,
  isCompatibleProviderConfigured,
  COMPATIBLE_PROVIDER_DEFAULTS,
} from "@workspace/ai-providers";

export const ZAI_OFFICIAL_BASE_URL =
  COMPATIBLE_PROVIDER_DEFAULTS.zai?.baseURL ?? "https://api.z.ai/api/paas/v4";

export const ZAI_DEFAULT_MODEL = "glm-5.3-flash";

export function getZaiApiKey(): string | null {
  return readEnvApiKey("zai");
}

export function isZaiConfigured(): boolean {
  return isCompatibleProviderConfigured("zai");
}

export function getZaiBaseUrl(): string {
  return readEnvBaseUrl("zai") || ZAI_OFFICIAL_BASE_URL;
}

export function zaiConfiguredPublicStatus(): {
  configured: boolean;
  baseUrl: string;
  model: string;
} {
  return {
    configured: isZaiConfigured(),
    baseUrl: getZaiBaseUrl(),
    model: ZAI_DEFAULT_MODEL,
  };
}
