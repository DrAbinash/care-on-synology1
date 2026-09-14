/**
 * OpenAI official API config — architecture-ready (env or ai_provider_settings).
 */
import {
  readEnvApiKey,
  readEnvBaseUrl,
  isCompatibleProviderConfigured,
  COMPATIBLE_PROVIDER_DEFAULTS,
} from "@workspace/ai-providers";

export const OPENAI_OFFICIAL_BASE_URL =
  COMPATIBLE_PROVIDER_DEFAULTS.openai?.baseURL ?? "https://api.openai.com/v1";

export const OPENAI_DEFAULT_TEXT_MODEL = "gpt-4o";

export function isOpenAiConfigured(): boolean {
  return isCompatibleProviderConfigured("openai");
}

export function getOpenAiBaseUrl(): string {
  return readEnvBaseUrl("openai") || OPENAI_OFFICIAL_BASE_URL;
}

export function openaiConfiguredPublicStatus(): {
  configured: boolean;
  baseUrl: string;
  defaultModel: string;
} {
  return {
    configured: isOpenAiConfigured(),
    baseUrl: getOpenAiBaseUrl(),
    defaultModel: OPENAI_DEFAULT_TEXT_MODEL,
  };
}

void readEnvApiKey;
